import { useTranslation } from "@yaakapp-internal/i18n";
import type { HttpResponse } from "@yaakapp-internal/models";
import { deleteModel } from "@yaakapp-internal/models";
import { HStack, Icon } from "@yaakapp-internal/ui";
import { differenceInHours, differenceInMinutes, format, isToday, isYesterday } from "date-fns";
import { useDeleteHttpResponses } from "../hooks/useDeleteHttpResponses";
import { useKeyValue } from "../hooks/useKeyValue";
import { DismissibleBanner } from "./core/DismissibleBanner";
import { Dropdown, type DropdownItem } from "./core/Dropdown";
import { formatMillis } from "./core/HttpResponseDurationTag";
import { HttpStatusTag } from "./core/HttpStatusTag";
import { IconButton } from "./core/IconButton";
import { SizeTag } from "./core/SizeTag";

interface Props {
  responses: HttpResponse[];
  activeResponse: HttpResponse;
  onPinnedResponseId: (id: string) => void;
  className?: string;
}

export const RecentHttpResponsesDropdown = function ResponsePane({
  activeResponse,
  responses,
  onPinnedResponseId,
}: Props) {
  const { t } = useTranslation();
  const deleteAllResponses = useDeleteHttpResponses(activeResponse?.requestId);
  const movedActionsBannerId = "response-actions-moved-to-response-menu-2026-07-02-v2";
  const { value: dismissedMovedActions } = useKeyValue<boolean>({
    namespace: "global",
    key: ["dismiss-banner", movedActionsBannerId],
    fallback: false,
  });
  const latestResponseId = responses[0]?.id ?? "n/a";
  const responseHistoryItems: DropdownItem[] = [];
  let lastHistoryGroup: string | null = null;
  let hasRecentResponses = false;
  let hasShownRecentEmptyState = false;
  const now = new Date();

  for (const r of responses) {
    const createdAt = `${r.createdAt}Z`;
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
      hasRecentResponses = true;
    } else if (!hasRecentResponses && !hasShownRecentEmptyState) {
      responseHistoryItems.push({
        type: "content",
        label: (
          <span className="block px-4 py-1 text-sm text-text-subtle">
            {t("common.noRecentRequests")}
          </span>
        ),
      });
      hasShownRecentEmptyState = true;
    }

    if (!isJustNow && historyGroup !== lastHistoryGroup) {
      responseHistoryItems.push({
        type: "separator",
        label: <span title={absoluteTime}>{historyGroup}</span>,
      });
      lastHistoryGroup = historyGroup;
    }

    responseHistoryItems.push({
      label: (
        <HStack space={2} className="text-sm" title={absoluteTime}>
          <HttpStatusTag short className="text-xs" response={r} />
          <span className="text-text-subtlest">&bull;</span>
          <span className="font-mono">{r.elapsed >= 0 ? formatMillis(r.elapsed) : "n/a"}</span>
          <span className="text-text-subtlest">&bull;</span>
          <SizeTag
            className="text-xs"
            contentLength={r.contentLength ?? 0}
            contentLengthCompressed={r.contentLengthCompressed}
          />
        </HStack>
      ),
      leftSlot: activeResponse?.id === r.id ? <Icon icon="check" /> : <Icon icon="empty" />,
      onSelect: () => {
        onPinnedResponseId(r.id);
      },
    });
  }

  if (!hasRecentResponses && !hasShownRecentEmptyState) {
    responseHistoryItems.push({
      type: "content",
      label: (
        <span className="block px-4 py-1 text-sm text-text-subtle">
          {t("common.noRecentRequests")}
        </span>
      ),
    });
  }

  return (
    <Dropdown
      items={[
        {
          label: t("common.delete"),
          leftSlot: <Icon icon="trash" />,
          onSelect: () => deleteModel(activeResponse),
        },
        {
          label: t("response.deleteAll"),
          leftSlot: <Icon icon="trash" />,
          onSelect: deleteAllResponses.mutate,
          disabled: responses.length === 0,
        },
        {
          label: t("response.unpinResponse"),
          onSelect: () => onPinnedResponseId(activeResponse.id),
          leftSlot: <Icon icon="unpin" />,
          hidden: latestResponseId === activeResponse.id,
          disabled: responses.length === 0,
        },
        {
          type: "content",
          hidden: dismissedMovedActions === true,
          label: (
            <DismissibleBanner
              id={movedActionsBannerId}
              color="info"
              size="xs"
              className="max-w-72"
            >
              <p>{t("response.actionsMovedToResponseMenu")}</p>
            </DismissibleBanner>
          ),
        },
        {
          type: "separator",
          label: t("common.recent"),
        },
        ...responseHistoryItems,
      ]}
    >
      <IconButton
        title={t("response.showResponseHistory")}
        icon={activeResponse?.id === latestResponseId ? "history" : "pin"}
        className="m-0.5 text-text-subtle"
        size="sm"
        iconSize="md"
      />
    </Dropdown>
  );
};
