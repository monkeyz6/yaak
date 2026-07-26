import type { HttpRequestHeader } from "@yaakapp-internal/models";
import type { AiRequestFormat } from "./aiRequestConversion";

const ENDPOINT_PATHS: Record<AiRequestFormat, string> = {
  anthropic_messages: "/v1/messages",
  openai_chat_completions: "/v1/chat/completions",
  openai_responses: "/v1/responses",
};

const KNOWN_PATH_PATTERN = /\/v1\/(?:messages|chat\/completions|responses)(?=\/?(?:$|\?))/i;

const ANTHROPIC_VERSION_HEADER = "anthropic-version";
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";

export type EndpointNote = "url_not_recognized" | "auth_token_missing";

export interface AiEndpointConversion {
  /** New request URL, or null when it does not need to change */
  url: string | null;
  /** New full header list, or null when headers do not need to change */
  headers: HttpRequestHeader[] | null;
  notes: EndpointNote[];
}

/**
 * Compute the URL and auth-header changes needed so a converted request body can be
 * sent to the matching endpoint. Values are computed on a best-effort basis and the
 * caller decides whether to apply them.
 */
export function convertAiRequestEndpoint(
  request: { url: string; headers: HttpRequestHeader[] },
  source: AiRequestFormat,
  target: AiRequestFormat,
): AiEndpointConversion {
  if (source === target) return { url: null, headers: null, notes: [] };

  const notes: EndpointNote[] = [];
  const url = convertUrl(request.url, target);
  if (url == null && request.url.trim().length > 0) notes.push("url_not_recognized");

  const sourceVendor = vendorOf(source);
  const targetVendor = vendorOf(target);
  const headers =
    sourceVendor === targetVendor ? null : convertAuthHeaders(request.headers, targetVendor, notes);

  return { url, headers, notes };
}

function convertUrl(url: string, target: AiRequestFormat): string | null {
  if (!KNOWN_PATH_PATTERN.test(url)) return null;
  let next = url.replace(KNOWN_PATH_PATTERN, ENDPOINT_PATHS[target]);
  const targetVendor = vendorOf(target);
  if (targetVendor === "openai") {
    next = next.replace(/\bapi\.anthropic\.com\b/i, "api.openai.com");
  } else {
    next = next.replace(/\bapi\.openai\.com\b/i, "api.anthropic.com");
  }
  return next === url ? null : next;
}

function vendorOf(format: AiRequestFormat): "anthropic" | "openai" {
  return format === "anthropic_messages" ? "anthropic" : "openai";
}

function convertAuthHeaders(
  headers: HttpRequestHeader[],
  targetVendor: "anthropic" | "openai",
  notes: EndpointNote[],
): HttpRequestHeader[] | null {
  const findValue = (name: string) =>
    headers.find((h) => h.enabled !== false && h.name.trim().toLowerCase() === name)?.value;

  if (targetVendor === "openai") {
    const apiKey = findValue("x-api-key");
    const kept = headers.filter((h) => {
      const name = h.name.trim().toLowerCase();
      return name !== "x-api-key" && name !== ANTHROPIC_VERSION_HEADER;
    });
    if (kept.length === headers.length && apiKey == null) return null;
    if (apiKey != null) {
      if (findValue("authorization") == null) {
        kept.push({ enabled: true, name: "Authorization", value: `Bearer ${apiKey}` });
      }
    } else if (findValue("authorization") == null) {
      notes.push("auth_token_missing");
    }
    return kept;
  }

  const authorization = findValue("authorization");
  const token = authorization?.replace(/^\s*Bearer\s+/i, "") ?? null;
  const kept = headers.filter((h) => h.name.trim().toLowerCase() !== "authorization");
  const changed = kept.length !== headers.length;
  if (token != null && findValue("x-api-key") == null) {
    kept.push({ enabled: true, name: "x-api-key", value: token });
  } else if (token == null && findValue("x-api-key") == null) {
    notes.push("auth_token_missing");
  }
  if (findValue(ANTHROPIC_VERSION_HEADER) == null) {
    kept.push({ enabled: true, name: ANTHROPIC_VERSION_HEADER, value: DEFAULT_ANTHROPIC_VERSION });
  }
  return changed || kept.length !== headers.length ? kept : null;
}
