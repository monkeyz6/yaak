import { JSONPath } from "jsonpath-plus";

export interface SseSummary {
  fragmentCount: number;
  summary: string;
  /** Format detected from the stream. Only set when computed with mode "auto" */
  detectedMode?: SseTextMode | null;
  /** Joined thinking/reasoning deltas (e.g. Anthropic thinking, OpenAI reasoning summaries) */
  reasoning?: string;
  reasoningFragmentCount?: number;
}

export type SseTextMode =
  | "auto"
  | "openai_chat"
  | "openai_responses"
  | "anthropic"
  | "custom_jsonpath";

interface ParsedSsePayload {
  data: string;
  eventType: string;
}

type JSONPathJson = null | boolean | number | string | object | unknown[];

const STANDARD_SSE_FIELD = /^(event|id|retry):/i;

export function candidateJsonPayloadsFromSseText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.split(/\n{2,}/);
  const candidates: string[] = [];

  for (const block of blocks) {
    const lines = block.split("\n");
    const dataLines = lines
      .map((line) => {
        const match = /^data:(?: ?)(.*)$/.exec(line);
        return match?.[1];
      })
      .filter((line): line is string => line != null);

    if (dataLines.length > 0) {
      const payload = dataLines.join("\n").trim();
      if (payload) {
        candidates.push(payload);
      }
      continue;
    }

    const trimmedBlock = block.trim();
    if (!trimmedBlock) {
      continue;
    }

    if (isParsableJson(trimmedBlock)) {
      candidates.push(trimmedBlock);
      continue;
    }

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (
        !trimmedLine ||
        trimmedLine.startsWith(":") ||
        STANDARD_SSE_FIELD.test(trimmedLine) ||
        !isParsableJson(trimmedLine)
      ) {
        continue;
      }
      candidates.push(trimmedLine);
    }
  }

  return candidates;
}

export function computeSseSummary(text: string, keyPath: string): SseSummary {
  const fragments: string[] = [];

  for (const payload of candidateJsonPayloadsFromSseText(text)) {
    const fragment = extractSseValueAtPath(payload, keyPath);
    if (fragment != null) {
      fragments.push(fragment);
    }
  }

  return {
    fragmentCount: fragments.length,
    summary: fragments.join(""),
  };
}

export function computeReadableSseText(
  text: string,
  mode: SseTextMode,
  customJsonPath = "",
): SseSummary {
  const events = parsedPayloadsFromSseText(text);
  const effectiveMode = mode === "auto" ? detectSseTextMode(events) : mode;
  const fragments: string[] = [];
  const reasoningFragments: string[] = [];

  for (const event of events) {
    const fragment = extractReadableFragment(event, effectiveMode, customJsonPath);
    if (fragment != null) fragments.push(fragment);
    const reasoning = extractReasoningFragment(event, effectiveMode);
    if (reasoning != null) reasoningFragments.push(reasoning);
  }

  return {
    fragmentCount: fragments.length,
    summary: fragments.join(""),
    detectedMode: mode === "auto" && effectiveMode !== "auto" ? effectiveMode : null,
    reasoning: reasoningFragments.join(""),
    reasoningFragmentCount: reasoningFragments.length,
  };
}

export function extractSseValueAtPath(payload: string, keyPath: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  const path = keyPath.trim();
  if (!path) {
    return null;
  }

  let result: unknown;
  try {
    result = JSONPath({ path, json: parsed as JSONPathJson });
  } catch {
    return null;
  }

  if (Array.isArray(result)) {
    const fragments = result
      .map((item) => stringifySummaryValue(item))
      .filter((item): item is string => item != null);
    return fragments.length > 0 ? fragments.join("") : null;
  }

  return stringifySummaryValue(result);
}

function stringifySummaryValue(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function isParsableJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function parsedPayloadsFromSseText(text: string): ParsedSsePayload[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const events: ParsedSsePayload[] = [];

  for (const block of normalized.split(/\n{2,}/)) {
    let eventType = "";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue;
      const eventMatch = /^event:(?: ?)(.*)$/.exec(line);
      if (eventMatch) {
        eventType = eventMatch[1]?.trim() ?? "";
        continue;
      }
      const dataMatch = /^data:(?: ?)(.*)$/.exec(line);
      if (dataMatch) data.push(dataMatch[1] ?? "");
    }
    if (data.length > 0) {
      const payload = data.join("\n").trim();
      if (payload && payload !== "[DONE]") events.push({ data: payload, eventType });
      continue;
    }
    const raw = block.trim();
    if (isParsableJson(raw)) events.push({ data: raw, eventType: "" });
  }
  return events;
}

const OPENAI_RESPONSES_TEXT_DELTA = "response.output_text.delta";
const OPENAI_RESPONSES_REASONING_DELTAS = new Set([
  "response.reasoning_summary_text.delta",
  "response.reasoning_text.delta",
]);
const ANTHROPIC_TEXT_DELTAS = new Set(["text_delta", "thinking_delta"]);

function detectSseTextMode(events: ParsedSsePayload[]): SseTextMode | null {
  for (const event of events) {
    const parsed = parseRecord(event.data);
    const type = event.eventType || stringAt(parsed, "type") || "";
    if (type === OPENAI_RESPONSES_TEXT_DELTA || OPENAI_RESPONSES_REASONING_DELTAS.has(type)) {
      return "openai_responses";
    }
    const deltaType = stringAt(parsed, "delta.type");
    if (
      type === "content_block_delta" ||
      (deltaType != null && ANTHROPIC_TEXT_DELTAS.has(deltaType))
    ) {
      return "anthropic";
    }
    if (Array.isArray(parsed?.choices)) return "openai_chat";
  }
  return null;
}

function extractReadableFragment(
  event: ParsedSsePayload,
  mode: SseTextMode | null,
  customJsonPath: string,
): string | null {
  if (mode === "custom_jsonpath") return extractSseValueAtPath(event.data, customJsonPath);
  const parsed = parseRecord(event.data);
  if (parsed == null) return null;

  if (mode === "openai_chat") {
    const choices = parsed.choices;
    if (!Array.isArray(choices)) return null;
    return (
      choices
        .map((choice) => (isRecord(choice) && isRecord(choice.delta) ? choice.delta.content : null))
        .filter((value): value is string => typeof value === "string")
        .join("") || null
    );
  }

  if (mode === "openai_responses") {
    const type = event.eventType || stringAt(parsed, "type");
    return type === OPENAI_RESPONSES_TEXT_DELTA && typeof parsed.delta === "string"
      ? parsed.delta
      : null;
  }

  if (mode === "anthropic") {
    const type = event.eventType || stringAt(parsed, "type");
    if (type !== "content_block_delta" || !isRecord(parsed.delta)) return null;
    return parsed.delta.type === "text_delta" && typeof parsed.delta.text === "string"
      ? parsed.delta.text
      : null;
  }
  return null;
}

function extractReasoningFragment(
  event: ParsedSsePayload,
  mode: SseTextMode | null,
): string | null {
  if (mode == null || mode === "custom_jsonpath") return null;
  const parsed = parseRecord(event.data);
  if (parsed == null) return null;

  if (mode === "openai_chat") {
    // OpenAI-compatible providers (e.g. DeepSeek) stream reasoning on the delta
    const choices = parsed.choices;
    if (!Array.isArray(choices)) return null;
    return (
      choices
        .map((choice) => {
          if (!isRecord(choice) || !isRecord(choice.delta)) return null;
          const reasoning = choice.delta.reasoning_content ?? choice.delta.reasoning;
          return typeof reasoning === "string" ? reasoning : null;
        })
        .filter((value): value is string => value != null)
        .join("") || null
    );
  }

  if (mode === "openai_responses") {
    const type = event.eventType || stringAt(parsed, "type") || "";
    return OPENAI_RESPONSES_REASONING_DELTAS.has(type) && typeof parsed.delta === "string"
      ? parsed.delta
      : null;
  }

  if (mode === "anthropic") {
    const type = event.eventType || stringAt(parsed, "type");
    if (type !== "content_block_delta" || !isRecord(parsed.delta)) return null;
    return parsed.delta.type === "thinking_delta" && typeof parsed.delta.thinking === "string"
      ? parsed.delta.thinking
      : null;
  }

  return null;
}

function parseRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function stringAt(value: Record<string, unknown> | null, path: string): string | null {
  let current: unknown = value;
  for (const part of path.split(".")) {
    if (!isRecord(current)) return null;
    current = current[part];
  }
  return typeof current === "string" ? current : null;
}
