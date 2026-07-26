import { useTranslation } from "@yaakapp-internal/i18n";
import type { WebsocketConnection } from "@yaakapp-internal/models";
import { deleteModel, getModel } from "@yaakapp-internal/models";
import { HStack, Icon } from "@yaakapp-internal/ui";
import { differenceInHours, differenceInMinutes, format, isToday, isYesterday } from "date-fns";
import { deleteWebsocketConnections } from "../commands/deleteWebsocketConnections";
import { Dropdown, type DropdownItem } from "./core/Dropdown";
import { formatMillis } from "./core/HttpResponseDurationTag";
import { IconButton } from "./core/IconButton";

interface Props {
  connections: WebsocketConnection[];
  activeConnection: WebsocketConnection;
  onPinnedConnectionId: (id: string) => void;
}

export function RecentWebsocketConnectionsDropdown({
  activeConnection,
  connections,
  onPinnedConnectionId,
}: Props) {
  const { t } = useTranslation();
  const latestConnectionId = connections[0]?.id ?? "n/a";
  const connectionHistoryItems: DropdownItem[] = [];
  let lastHistoryGroup: string | null = null;
  let hasRecentConnections = false;
  let hasShownRecentEmptyState = false;
  const now = new Date();

  for (const c of connections) {
    const createdAt = `${c.createdAt}Z`;
    const createdAtDate = new Date(createdAt);
    const minutesAgo = differenceInMinutes(now, createdAtDate);
    const hoursAgo = differenceInHours(now, createdAtDate);
    const isJustNow = minutesAgo < 5;
    let historyGroup = format(createdAtDate, "MMM d, yyyy");
    if (isJustNow) historyGroup = t("common.justNow");
    else if (minutesAgo < 15) historyGroup = t("common.fiveMinutesAgo");
    else if (minutesAgo < 60) historyGroup = t("common.fifteenMinutesAgo");
    else if (hoursAgo < 3) historyGroup = t("common.oneHourAgo");
    else if (hoursAgo < 6) historyGroup = t("common.threeHoursAgo");
    else if (isToday(createdAtDate)) historyGroup = t("common.today");
    else if (isYesterday(createdAtDate)) historyGroup = t("common.yesterday");
    else if (createdAtDate.getFullYear() === now.getFullYear())
      historyGroup = format(createdAtDate, "MMM d");
    const absoluteTime = format(createdAt, "MMM d, yyyy, h:mm:ss a O");

    if (isJustNow) {
      hasRecentConnections = true;
    } else if (!hasRecentConnections && !hasShownRecentEmptyState) {
      connectionHistoryItems.push({
        type: "content",
        label: (
          <span className="block px-4 py-1 text-sm text-text-subtle">
            {t("common.noRecentConnections")}
          </span>
        ),
      });
      hasShownRecentEmptyState = true;
    }

    if (!isJustNow && historyGroup !== lastHistoryGroup) {
      connectionHistoryItems.push({
        type: "separator",
        label: <span title={absoluteTime}>{historyGroup}</span>,
      });
      lastHistoryGroup = historyGroup;
    }

    connectionHistoryItems.push({
      label: (
        <HStack space={2} className="text-sm" title={absoluteTime}>
          <span className="font-mono">{formatMillis(c.elapsed)}</span>
        </HStack>
      ),
      leftSlot: activeConnection?.id === c.id ? <Icon icon="check" /> : <Icon icon="empty" />,
      onSelect: () => onPinnedConnectionId(c.id),
    });
  }

  if (!hasRecentConnections && !hasShownRecentEmptyState) {
    connectionHistoryItems.push({
      type: "content",
      label: (
        <span className="block px-4 py-1 text-sm text-text-subtle">
          {t("common.noRecentConnections")}
        </span>
      ),
    });
  }

  return (
    <Dropdown
      items={[
        {
          label: t("common.clearConnection"),
          onSelect: () => deleteModel(activeConnection),
          disabled: connections.length === 0,
        },
        {
          label: t("common.clearConnections", { count: connections.length }),
          onSelect: () => {
            const request = getModel("websocket_request", activeConnection.requestId);
            if (request != null) {
              deleteWebsocketConnections.mutate(request);
            }
          },
          hidden: connections.length <= 1,
          disabled: connections.length === 0,
        },
        { type: "separator", label: t("common.history") },
        ...connectionHistoryItems,
      ]}
    >
      <IconButton
        title={t("common.showConnectionHistory")}
        icon={activeConnection?.id === latestConnectionId ? "history" : "pin"}
        className="m-0.5 text-text-subtle"
        size="sm"
        iconSize="md"
      />
    </Dropdown>
  );
}
