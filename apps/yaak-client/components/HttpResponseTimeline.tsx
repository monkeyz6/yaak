import type {
  AnyModel,
  HttpResponse,
  HttpResponseEvent,
  HttpResponseEventData,
} from "@yaakapp-internal/models";
import { i18n, useTranslation } from "@yaakapp-internal/i18n";
import { foldersAtom, workspacesAtom } from "@yaakapp-internal/models";
import { useAtomValue } from "jotai";
import { type ReactNode, useMemo, useState } from "react";
import { useHttpResponseEvents } from "../hooks/useHttpResponseEvents";
import { useAllRequests } from "../hooks/useAllRequests";
import { resolvedModelName } from "../lib/resolvedModelName";
import { Editor } from "./core/Editor/LazyEditor";
import { type EventDetailAction, EventDetailHeader, EventViewer } from "./core/EventViewer";
import { EventViewerRow } from "./core/EventViewerRow";
import { HttpStatusTagRaw } from "./core/HttpStatusTag";
import { Icon, type IconProps } from "@yaakapp-internal/ui";
import { KeyValueRow, KeyValueRows } from "./core/KeyValueRow";
import type { TimelineViewMode } from "./HttpResponsePane";

interface Props {
  response: HttpResponse;
  viewMode: TimelineViewMode;
}

export function HttpResponseTimeline({ response, viewMode }: Props) {
  return <Inner key={response.id} response={response} viewMode={viewMode} />;
}

function Inner({ response, viewMode }: Props) {
  const { t } = useTranslation();
  const [showRaw, setShowRaw] = useState(false);
  const { data: events, error, isLoading } = useHttpResponseEvents(response);

  // Generate plain text representation of all events (with prefixes for timeline view)
  const plainText = useMemo(() => {
    if (!events || events.length === 0) return "";
    return events.map((event) => formatEventText(event.event, true)).join("\n");
  }, [events]);

  // Plain text view - show all events as text in an editor
  if (viewMode === "text") {
    if (isLoading) {
      return <div className="p-4 text-text-subtlest">{t("timeline.loading")}</div>;
    } else if (error) {
      return <div className="p-4 text-danger">{String(error)}</div>;
    } else if (!events || events.length === 0) {
      return <div className="p-4 text-text-subtlest">{t("timeline.empty")}</div>;
    } else {
      return (
        <Editor language="timeline" defaultValue={plainText} readOnly stateKey={null} hideGutter />
      );
    }
  }

  return (
    <EventViewer
      events={events ?? []}
      getEventKey={(event) => event.id}
      error={error ? String(error) : null}
      isLoading={isLoading}
      loadingMessage={t("timeline.loading")}
      emptyMessage={t("timeline.empty")}
      splitLayoutStorageKey="http_response_events"
      defaultRatio={0.25}
      renderRow={({ event, isActive, onClick }) => {
        const display = getEventDisplay(event.event);
        return (
          <EventViewerRow
            isActive={isActive}
            onClick={onClick}
            icon={<Icon color={display.color} icon={display.icon} size="sm" />}
            content={display.summary}
            timestamp={event.createdAt}
          />
        );
      }}
      renderDetail={({ event, onClose }) => (
        <EventDetails event={event} showRaw={showRaw} setShowRaw={setShowRaw} onClose={onClose} />
      )}
    />
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function EventDetails({
  event,
  showRaw,
  setShowRaw,
  onClose,
}: {
  event: HttpResponseEvent;
  showRaw: boolean;
  setShowRaw: (v: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { label } = getEventDisplay(event.event);
  const e = event.event;
  const settingSourceModels = useSettingSourceModels();

  const actions: EventDetailAction[] = [
    {
      key: "toggle-raw",
      label: showRaw ? t("timeline.formatted") : t("timeline.text"),
      onClick: () => setShowRaw(!showRaw),
    },
  ];

  // Determine the title based on event type
  const title = (() => {
    switch (e.type) {
      case "header_up":
        return t("timeline.headerSent");
      case "header_down":
        return t("timeline.headerReceived");
      case "send_url":
        return t("timeline.request");
      case "receive_url":
        return t("timeline.response");
      case "redirect":
        return t("timeline.redirect");
      case "setting":
        return t("timeline.applySetting");
      case "chunk_sent":
        return t("timeline.dataSent");
      case "chunk_received":
        return t("timeline.dataReceived");
      case "dns_resolved":
        return e.overridden ? t("timeline.dnsOverride") : t("timeline.dnsResolution");
      default:
        return label;
    }
  })();

  // Render content based on view mode and event type
  const renderContent = () => {
    // Raw view - show plaintext representation (without prefix)
    if (showRaw) {
      const rawText = formatEventText(event.event, false);
      return <Editor language="text" defaultValue={rawText} readOnly stateKey={null} hideGutter />;
    }

    // Headers - show name and value
    if (e.type === "header_up" || e.type === "header_down") {
      return (
        <KeyValueRows>
          <KeyValueRow label={t("timeline.header")}>{e.name}</KeyValueRow>
          <KeyValueRow label={t("timeline.value")}>{e.value}</KeyValueRow>
        </KeyValueRows>
      );
    }

    // Request URL - show all URL parts separately
    if (e.type === "send_url") {
      const auth = e.username || e.password ? `${e.username}:${e.password}@` : "";
      const isDefaultPort =
        (e.scheme === "http" && e.port === 80) || (e.scheme === "https" && e.port === 443);
      const portStr = isDefaultPort ? "" : `:${e.port}`;
      const query = e.query ? `?${e.query}` : "";
      const fragment = e.fragment ? `#${e.fragment}` : "";
      const fullUrl = `${e.scheme}://${auth}${e.host}${portStr}${e.path}${query}${fragment}`;
      return (
        <KeyValueRows>
          <KeyValueRow label="URL">{fullUrl}</KeyValueRow>
          <KeyValueRow label={t("timeline.method")}>{e.method}</KeyValueRow>
          <KeyValueRow label={t("timeline.scheme")}>{e.scheme}</KeyValueRow>
          {e.username ? (
            <KeyValueRow label={t("timeline.username")}>{e.username}</KeyValueRow>
          ) : null}
          {e.password ? (
            <KeyValueRow label={t("settings.password")}>{e.password}</KeyValueRow>
          ) : null}
          <KeyValueRow label={t("settings.host")}>{e.host}</KeyValueRow>
          {!isDefaultPort ? <KeyValueRow label={t("settings.port")}>{e.port}</KeyValueRow> : null}
          <KeyValueRow label={t("timeline.path")}>{e.path}</KeyValueRow>
          {e.query ? <KeyValueRow label={t("timeline.query")}>{e.query}</KeyValueRow> : null}
          {e.fragment ? (
            <KeyValueRow label={t("timeline.fragment")}>{e.fragment}</KeyValueRow>
          ) : null}
        </KeyValueRows>
      );
    }

    // Response status - show version and status separately
    if (e.type === "receive_url") {
      return (
        <KeyValueRows>
          <KeyValueRow label={t("timeline.httpVersion")}>{e.version}</KeyValueRow>
          <KeyValueRow label={t("timeline.status")}>
            <HttpStatusTagRaw status={e.status} />
          </KeyValueRow>
        </KeyValueRows>
      );
    }

    // Redirect - show status, URL, and behavior
    if (e.type === "redirect") {
      const droppedHeaders = e.dropped_headers ?? [];
      return (
        <KeyValueRows>
          <KeyValueRow label={t("timeline.status")}>
            <HttpStatusTagRaw status={e.status} />
          </KeyValueRow>
          <KeyValueRow label={t("timeline.location")}>{e.url}</KeyValueRow>
          <KeyValueRow label={t("timeline.behavior")}>
            {e.behavior === "drop_body"
              ? t("timeline.behaviorDropBody")
              : t("timeline.behaviorPreserve")}
          </KeyValueRow>
          <KeyValueRow label={t("timeline.bodyDropped")}>
            {e.dropped_body ? t("timeline.yes") : t("timeline.no")}
          </KeyValueRow>
          <KeyValueRow label={t("timeline.headersDropped")}>
            {droppedHeaders.length > 0 ? droppedHeaders.join(", ") : "--"}
          </KeyValueRow>
        </KeyValueRows>
      );
    }

    // Settings - show as key/value
    if (e.type === "setting") {
      return (
        <KeyValueRows>
          <KeyValueRow label={t("timeline.setting")}>{e.name}</KeyValueRow>
          <KeyValueRow label={t("timeline.value")}>{e.value}</KeyValueRow>
          {e.source_model != null ? (
            <KeyValueRow label={t("timeline.source")}>
              {formatSettingSource(e, settingSourceModels)}
            </KeyValueRow>
          ) : null}
        </KeyValueRows>
      );
    }

    if (e.type === "post_response_action") {
      return (
        <KeyValueRows>
          <KeyValueRow label={t("timeline.variable")}>{e.variable_name}</KeyValueRow>
          <KeyValueRow label={t("timeline.environment")}>
            {e.environment_name || e.environment_id}
          </KeyValueRow>
          <KeyValueRow label={t("timeline.status")}>{e.status}</KeyValueRow>
          <KeyValueRow label={t("timeline.message")}>{e.message}</KeyValueRow>
        </KeyValueRows>
      );
    }

    // Chunks - show formatted bytes
    if (e.type === "chunk_sent" || e.type === "chunk_received") {
      return <div className="font-mono text-editor">{formatBytes(e.bytes)}</div>;
    }

    // DNS Resolution - show hostname, addresses, and timing
    if (e.type === "dns_resolved") {
      return (
        <KeyValueRows>
          <KeyValueRow label={t("timeline.hostname")}>{e.hostname}</KeyValueRow>
          <KeyValueRow label={t("timeline.addresses")}>{e.addresses.join(", ")}</KeyValueRow>
          <KeyValueRow label={t("timeline.duration")}>
            {e.overridden ? (
              <span className="text-text-subtlest">--</span>
            ) : (
              `${String(e.duration)}ms`
            )}
          </KeyValueRow>
          {e.overridden ? (
            <KeyValueRow label={t("timeline.source")}>
              {t("timeline.workspaceOverride")}
            </KeyValueRow>
          ) : null}
        </KeyValueRows>
      );
    }

    // Default - use summary
    const { summary } = getEventDisplay(event.event);
    return <div className="font-mono text-editor">{summary}</div>;
  };
  return (
    <div className="flex flex-col gap-2 h-full">
      <EventDetailHeader
        title={title}
        timestamp={event.createdAt}
        actions={actions}
        onClose={onClose}
      />
      {renderContent()}
    </div>
  );
}

type EventTextParts = { prefix: ">" | "<" | "*"; text: string };

/** Get the prefix and text for an event */
function getEventTextParts(event: HttpResponseEventData): EventTextParts {
  switch (event.type) {
    case "send_url":
      return {
        prefix: ">",
        text: `${event.method} ${event.path}${event.query ? `?${event.query}` : ""}${event.fragment ? `#${event.fragment}` : ""}`,
      };
    case "receive_url":
      return { prefix: "<", text: `${event.version} ${event.status}` };
    case "header_up":
      return { prefix: ">", text: `${event.name}: ${event.value}` };
    case "header_down":
      return { prefix: "<", text: `${event.name}: ${event.value}` };
    case "redirect": {
      const behavior = event.behavior === "drop_body" ? "drop body" : "preserve";
      const droppedHeaders = event.dropped_headers ?? [];
      const dropped = [
        event.dropped_body ? "body dropped" : null,
        droppedHeaders.length > 0 ? `headers dropped: ${droppedHeaders.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(", ");
      return {
        prefix: "*",
        text: `Redirect ${event.status} -> ${event.url} (${behavior}${dropped ? `, ${dropped}` : ""})`,
      };
    }
    case "setting":
      return { prefix: "*", text: `Setting ${event.name}=${event.value}` };
    case "info":
      return { prefix: "*", text: event.message };
    case "post_response_action":
      return {
        prefix: "*",
        text: `Post-response ${event.variable_name}: ${event.message}`,
      };
    case "chunk_sent":
      return { prefix: "*", text: `[${formatBytes(event.bytes)} sent]` };
    case "chunk_received":
      return { prefix: "*", text: `[${formatBytes(event.bytes)} received]` };
    case "dns_resolved":
      if (event.overridden) {
        return {
          prefix: "*",
          text: `DNS override ${event.hostname} -> ${event.addresses.join(", ")}`,
        };
      }
      return {
        prefix: "*",
        text: `DNS resolved ${event.hostname} to ${event.addresses.join(", ")} (${event.duration}ms)`,
      };
    default:
      return { prefix: "*", text: "[unknown event]" };
  }
}

/** Format event as plaintext, optionally with curl-style prefix (> outgoing, < incoming, * info) */
function formatEventText(event: HttpResponseEventData, includePrefix: boolean): string {
  const { prefix, text } = getEventTextParts(event);
  return includePrefix ? `${prefix} ${text}` : text;
}

function useSettingSourceModels() {
  const requests = useAllRequests();
  const folders = useAtomValue(foldersAtom);
  const workspaces = useAtomValue(workspacesAtom);

  return useMemo<AnyModel[]>(
    () => [...requests, ...folders, ...workspaces],
    [requests, folders, workspaces],
  );
}

function formatSettingSource(
  event: Extract<HttpResponseEventData, { type: "setting" }>,
  models: AnyModel[],
): string {
  const sourceModel = event.source_model;
  if (sourceModel == null || sourceModel === "default") {
    return i18n.t("timeline.sourceDefault");
  }

  const model =
    event.source_id == null
      ? null
      : (models.find((m) => m.model === sourceModel && m.id === event.source_id) ?? null);
  const name = model == null ? event.source_name : resolvedModelName(model);
  const label = sourceModel.replaceAll("_", " ");
  return name == null || name.length === 0 ? label : `${name} (${label})`;
}

function formatSettingSourceModel(event: Extract<HttpResponseEventData, { type: "setting" }>) {
  const sourceModel = event.source_model;
  if (sourceModel == null || sourceModel === "default" || sourceModel === "workspace") {
    return null;
  }

  return sourceModel;
}

type EventDisplay = {
  icon: IconProps["icon"];
  color: IconProps["color"];
  label: string;
  summary: ReactNode;
};

function getEventDisplay(event: HttpResponseEventData): EventDisplay {
  switch (event.type) {
    case "setting":
      const sourceModel = formatSettingSourceModel(event);
      return {
        icon: "settings",
        color: "secondary",
        label: i18n.t("timeline.setting"),
        summary: `${event.name} = ${event.value}${sourceModel == null ? "" : ` (${sourceModel})`}`,
      };
    case "info":
      return {
        icon: "info",
        color: "secondary",
        label: i18n.t("response.info"),
        summary: event.message,
      };
    case "post_response_action":
      return {
        icon:
          event.status === "success"
            ? "check"
            : event.status === "warning"
              ? "alert_triangle"
              : "circle_alert",
        color:
          event.status === "success" ? "success" : event.status === "warning" ? "notice" : "danger",
        label: i18n.t("timeline.postResponseAction"),
        summary: `${event.variable_name}: ${event.message}`,
      };
    case "redirect": {
      const droppedHeaders = event.dropped_headers ?? [];
      const dropped = [
        event.dropped_body ? i18n.t("timeline.dropBody") : null,
        droppedHeaders.length > 0
          ? droppedHeaders.length === 1
            ? i18n.t("timeline.dropHeadersOne", { count: droppedHeaders.length })
            : i18n.t("timeline.dropHeadersMany", { count: droppedHeaders.length })
          : null,
      ]
        .filter(Boolean)
        .join(", ");
      return {
        icon: "arrow_big_right_dash",
        color: "success",
        label: i18n.t("timeline.redirect"),
        summary: `${i18n.t("timeline.redirectingSummary", {
          status: event.status,
          url: event.url,
        })}${dropped ? ` (${dropped})` : ""}`,
      };
    }
    case "send_url":
      return {
        icon: "arrow_big_up_dash",
        color: "primary",
        label: i18n.t("timeline.request"),
        summary: `${event.method} ${event.path}${event.query ? `?${event.query}` : ""}${event.fragment ? `#${event.fragment}` : ""}`,
      };
    case "receive_url":
      return {
        icon: "arrow_big_down_dash",
        color: "info",
        label: i18n.t("timeline.response"),
        summary: `${event.version} ${event.status}`,
      };
    case "header_up":
      return {
        icon: "arrow_big_up_dash",
        color: "primary",
        label: i18n.t("timeline.header"),
        summary: `${event.name}: ${event.value}`,
      };
    case "header_down":
      return {
        icon: "arrow_big_down_dash",
        color: "info",
        label: i18n.t("timeline.header"),
        summary: `${event.name}: ${event.value}`,
      };

    case "chunk_sent":
      return {
        icon: "info",
        color: "secondary",
        label: i18n.t("timeline.chunk"),
        summary: i18n.t("timeline.chunkSentSummary", { size: formatBytes(event.bytes) }),
      };
    case "chunk_received":
      return {
        icon: "info",
        color: "secondary",
        label: i18n.t("timeline.chunk"),
        summary: i18n.t("timeline.chunkReceivedSummary", { size: formatBytes(event.bytes) }),
      };
    case "dns_resolved":
      return {
        icon: "globe",
        color: event.overridden ? "success" : "secondary",
        label: event.overridden ? i18n.t("timeline.dnsOverride") : "DNS",
        summary: event.overridden
          ? i18n.t("timeline.dnsOverriddenSummary", {
              hostname: event.hostname,
              addresses: event.addresses.join(", "),
            })
          : i18n.t("timeline.dnsResolvedSummary", {
              hostname: event.hostname,
              addresses: event.addresses.join(", "),
              duration: event.duration,
            }),
      };
    default:
      return {
        icon: "info",
        color: "secondary",
        label: i18n.t("timeline.unknown"),
        summary: i18n.t("timeline.unknownEvent"),
      };
  }
}
