import { parse as jsonLintParse } from "@prantlf/jsonlint";

export type AiRequestFormat = "anthropic_messages" | "openai_chat_completions" | "openai_responses";

export type ConversionWarningCode =
  | "dropped_field"
  | "dropped_content"
  | "dropped_image"
  | "dropped_tool"
  | "dropped_tool_choice"
  | "dropped_tool_result_image"
  | "dropped_stop"
  | "unsupported_role"
  | "non_message_item"
  | "model_preserved"
  | "defaulted_max_tokens"
  | "invalid_tool_arguments";

export interface ConversionWarning {
  code: ConversionWarningCode;
  path?: string;
  params?: Record<string, string | number>;
}

export interface AiConversionResult {
  body: Record<string, unknown>;
  warnings: ConversionWarning[];
  droppedFields: string[];
}

const ANTHROPIC_DEFAULT_MAX_TOKENS = 4096;

export function parseAiRequestBody(text: string): unknown {
  return jsonLintParse(text, {
    mode: "cjson",
    ignoreTrailingCommas: true,
  });
}

// ---------------------------------------------------------------------------
// Normalized intermediate model
// ---------------------------------------------------------------------------

type NormalizedPart =
  | { kind: "text"; text: string }
  | { kind: "image"; mediaType: string | null; base64: string | null; url: string | null }
  | { kind: "toolUse"; id: string | null; name: string; input: unknown; inputRaw: string | null }
  | { kind: "toolResult"; toolUseId: string | null; text: string; isError: boolean };

interface NormalizedMessage {
  role: "user" | "assistant";
  parts: NormalizedPart[];
}

interface NormalizedTool {
  name: string;
  description?: string;
  parameters?: unknown;
}

type NormalizedToolChoice =
  | { kind: "auto" }
  | { kind: "none" }
  | { kind: "required" }
  | { kind: "tool"; name: string };

interface NormalizedRequest {
  model?: unknown;
  system: string[];
  messages: NormalizedMessage[];
  tools: NormalizedTool[];
  toolChoice?: NormalizedToolChoice;
  stream?: unknown;
  temperature?: unknown;
  topP?: unknown;
  maxTokens?: unknown;
  stop?: unknown;
}

class Warnings {
  warnings: ConversionWarning[] = [];
  droppedFields: string[] = [];

  add(code: ConversionWarningCode, path?: string, params?: Record<string, string | number>) {
    this.warnings.push({ code, ...(path != null && { path }), ...(params != null && { params }) });
  }

  drop(
    path: string,
    code: ConversionWarningCode = "dropped_field",
    params?: Record<string, string | number>,
  ) {
    if (!this.droppedFields.includes(path)) this.droppedFields.push(path);
    this.add(code, path, params);
  }
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

const FORMAT_PATH_HINTS: Record<AiRequestFormat, RegExp> = {
  anthropic_messages: /\/v1\/messages\/?$/i,
  openai_chat_completions: /\/v1\/chat\/completions\/?$/i,
  openai_responses: /\/v1\/responses\/?$/i,
};

export function detectAiRequestFormat(body: unknown, url = ""): AiRequestFormat | null {
  if (!isRecord(body)) return null;
  if ("input" in body || "instructions" in body || "max_output_tokens" in body) {
    return "openai_responses";
  }

  const messages = Array.isArray(body.messages) ? body.messages : null;
  if (messages != null) {
    // Content-block and role shapes are the strongest signals
    for (const message of messages) {
      if (!isRecord(message)) continue;
      if (message.role === "tool" || Array.isArray(message.tool_calls)) {
        return "openai_chat_completions";
      }
      if (!Array.isArray(message.content)) continue;
      for (const part of message.content) {
        if (!isRecord(part)) continue;
        if (part.type === "tool_use" || part.type === "tool_result" || part.type === "image") {
          return "anthropic_messages";
        }
        if (part.type === "image_url" || part.type === "input_audio") {
          return "openai_chat_completions";
        }
      }
    }
    if (
      "system" in body ||
      "stop_sequences" in body ||
      "top_k" in body ||
      /anthropic/i.test(url) ||
      FORMAT_PATH_HINTS.anthropic_messages.test(url)
    ) {
      return "anthropic_messages";
    }
    if (
      "max_completion_tokens" in body ||
      "response_format" in body ||
      "parallel_tool_calls" in body
    ) {
      return "openai_chat_completions";
    }
  }

  for (const [format, pattern] of Object.entries(FORMAT_PATH_HINTS) as [
    AiRequestFormat,
    RegExp,
  ][]) {
    if (pattern.test(url)) return format;
  }
  return messages != null ? "openai_chat_completions" : null;
}

// ---------------------------------------------------------------------------
// Conversion entry point
// ---------------------------------------------------------------------------

export function convertAiRequestBody(
  body: unknown,
  source: AiRequestFormat,
  target: AiRequestFormat,
): AiConversionResult {
  if (!isRecord(body)) throw new Error("AI request body must be a JSON object");
  const warnings = new Warnings();
  const normalized = normalize(body, source, warnings);
  const converted = denormalize(normalized, target, warnings);

  if (target === "openai_responses" && normalized.stop != null) {
    warnings.drop(source === "anthropic_messages" ? "$.stop_sequences" : "$.stop", "dropped_stop");
  }

  if (source !== target && normalized.model != null) {
    warnings.add("model_preserved", "$.model");
  }

  return { body: converted, warnings: warnings.warnings, droppedFields: warnings.droppedFields };
}

// ---------------------------------------------------------------------------
// Normalization (source format -> intermediate model)
// ---------------------------------------------------------------------------

function normalize(
  body: Record<string, unknown>,
  source: AiRequestFormat,
  warnings: Warnings,
): NormalizedRequest {
  const normalized: NormalizedRequest = {
    model: body.model,
    system: [],
    messages: [],
    tools: [],
    stream: body.stream,
    temperature: body.temperature,
    topP: body.top_p,
  };

  if (source === "anthropic_messages") {
    normalized.maxTokens = body.max_tokens;
    normalized.stop = body.stop_sequences;
    normalized.system.push(...readTextContent(body.system, "$.system", warnings));
    readAnthropicMessages(body.messages, normalized, warnings);
    normalized.tools = readTools(body.tools, "anthropic_messages", warnings);
    normalized.toolChoice = readToolChoice(body.tool_choice, "anthropic_messages", warnings);
    collectUnknown(
      body,
      [
        "model",
        "system",
        "messages",
        "stream",
        "temperature",
        "top_p",
        "max_tokens",
        "stop_sequences",
        "tools",
        "tool_choice",
      ],
      warnings,
    );
  } else if (source === "openai_chat_completions") {
    normalized.maxTokens = body.max_completion_tokens ?? body.max_tokens;
    normalized.stop = body.stop;
    readChatMessages(body.messages, normalized, warnings);
    normalized.tools = readTools(body.tools, "openai_chat_completions", warnings);
    normalized.toolChoice = readToolChoice(body.tool_choice, "openai_chat_completions", warnings);
    collectUnknown(
      body,
      [
        "model",
        "messages",
        "stream",
        "temperature",
        "top_p",
        "max_completion_tokens",
        "max_tokens",
        "stop",
        "tools",
        "tool_choice",
      ],
      warnings,
    );
  } else {
    normalized.maxTokens = body.max_output_tokens;
    normalized.stop = undefined;
    normalized.system.push(...readTextContent(body.instructions, "$.instructions", warnings));
    readResponsesInput(body.input, normalized, warnings);
    normalized.tools = readTools(body.tools, "openai_responses", warnings);
    normalized.toolChoice = readToolChoice(body.tool_choice, "openai_responses", warnings);
    collectUnknown(
      body,
      [
        "model",
        "instructions",
        "input",
        "stream",
        "temperature",
        "top_p",
        "max_output_tokens",
        "tools",
        "tool_choice",
      ],
      warnings,
    );
  }
  return normalized;
}

function readAnthropicMessages(value: unknown, normalized: NormalizedRequest, warnings: Warnings) {
  if (!Array.isArray(value)) return;
  value.forEach((raw, index) => {
    const path = `$.messages[${index}]`;
    if (!isRecord(raw)) {
      warnings.drop(path, "non_message_item");
      return;
    }
    const role = raw.role;
    if (role !== "user" && role !== "assistant") {
      warnings.drop(path, "unsupported_role", { role: String(role) });
      return;
    }
    const parts = readAnthropicContent(raw.content, `${path}.content`, warnings);
    collectUnknown(raw, ["role", "content"], warnings, path);
    if (parts.length > 0) normalized.messages.push({ role, parts });
  });
}

function readAnthropicContent(value: unknown, path: string, warnings: Warnings): NormalizedPart[] {
  if (typeof value === "string") return value.length > 0 ? [{ kind: "text", text: value }] : [];
  if (!Array.isArray(value)) {
    if (value != null) warnings.drop(path, "dropped_content");
    return [];
  }
  const parts: NormalizedPart[] = [];
  value.forEach((part, index) => {
    const partPath = `${path}[${index}]`;
    if (!isRecord(part)) {
      warnings.drop(partPath, "dropped_content");
      return;
    }
    if (part.type === "text" && typeof part.text === "string") {
      parts.push({ kind: "text", text: part.text });
    } else if (part.type === "image" && isRecord(part.source)) {
      const source = part.source;
      if (source.type === "base64" && typeof source.data === "string") {
        parts.push({
          kind: "image",
          mediaType: typeof source.media_type === "string" ? source.media_type : null,
          base64: source.data,
          url: null,
        });
      } else if (source.type === "url" && typeof source.url === "string") {
        parts.push({ kind: "image", mediaType: null, base64: null, url: source.url });
      } else {
        warnings.drop(partPath, "dropped_image");
      }
    } else if (part.type === "tool_use") {
      parts.push({
        kind: "toolUse",
        id: typeof part.id === "string" ? part.id : null,
        name: typeof part.name === "string" ? part.name : "",
        input: part.input,
        inputRaw: null,
      });
    } else if (part.type === "tool_result") {
      parts.push({
        kind: "toolResult",
        toolUseId: typeof part.tool_use_id === "string" ? part.tool_use_id : null,
        text: readToolResultText(part.content, partPath, warnings),
        isError: part.is_error === true,
      });
    } else {
      warnings.drop(partPath, "dropped_content");
    }
  });
  return parts;
}

function readToolResultText(value: unknown, path: string, warnings: Warnings): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  const text: string[] = [];
  value.forEach((part, index) => {
    if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
      text.push(part.text);
    } else {
      warnings.drop(`${path}.content[${index}]`, "dropped_tool_result_image");
    }
  });
  return text.join("");
}

function readChatMessages(value: unknown, normalized: NormalizedRequest, warnings: Warnings) {
  if (!Array.isArray(value)) return;
  value.forEach((raw, index) => {
    const path = `$.messages[${index}]`;
    if (!isRecord(raw)) {
      warnings.drop(path, "non_message_item");
      return;
    }
    const role = raw.role;
    if (role === "system" || role === "developer") {
      collectUnknown(raw, ["role", "content", "name"], warnings, path);
      normalized.system.push(...readTextContent(raw.content, `${path}.content`, warnings));
      return;
    }
    if (role === "tool") {
      collectUnknown(raw, ["role", "content", "tool_call_id"], warnings, path);
      normalized.messages.push({
        role: "user",
        parts: [
          {
            kind: "toolResult",
            toolUseId: typeof raw.tool_call_id === "string" ? raw.tool_call_id : null,
            text: readTextContent(raw.content, `${path}.content`, warnings).join(""),
            isError: false,
          },
        ],
      });
      return;
    }
    if (role !== "user" && role !== "assistant") {
      warnings.drop(path, "unsupported_role", { role: String(role) });
      return;
    }

    const parts: NormalizedPart[] = readChatContent(raw.content, `${path}.content`, warnings);
    if (role === "assistant" && Array.isArray(raw.tool_calls)) {
      raw.tool_calls.forEach((call, callIndex) => {
        const callPath = `${path}.tool_calls[${callIndex}]`;
        if (!isRecord(call) || !isRecord(call.function)) {
          warnings.drop(callPath, "dropped_tool");
          return;
        }
        parts.push({
          kind: "toolUse",
          id: typeof call.id === "string" ? call.id : null,
          name: typeof call.function.name === "string" ? call.function.name : "",
          input: undefined,
          inputRaw: typeof call.function.arguments === "string" ? call.function.arguments : null,
        });
      });
    }
    collectUnknown(raw, ["role", "content", "name", "tool_calls"], warnings, path);
    if (parts.length > 0) normalized.messages.push({ role, parts });
  });
}

function readChatContent(value: unknown, path: string, warnings: Warnings): NormalizedPart[] {
  if (typeof value === "string") return value.length > 0 ? [{ kind: "text", text: value }] : [];
  if (!Array.isArray(value)) {
    if (value != null) warnings.drop(path, "dropped_content");
    return [];
  }
  const parts: NormalizedPart[] = [];
  value.forEach((part, index) => {
    const partPath = `${path}[${index}]`;
    if (!isRecord(part)) {
      warnings.drop(partPath, "dropped_content");
      return;
    }
    if (part.type === "text" && typeof part.text === "string") {
      parts.push({ kind: "text", text: part.text });
    } else if (part.type === "image_url") {
      const imageUrl = isRecord(part.image_url) ? part.image_url.url : part.image_url;
      if (typeof imageUrl === "string") {
        parts.push(imagePartFromUrl(imageUrl));
      } else {
        warnings.drop(partPath, "dropped_image");
      }
    } else {
      warnings.drop(partPath, "dropped_content");
    }
  });
  return parts;
}

function readResponsesInput(value: unknown, normalized: NormalizedRequest, warnings: Warnings) {
  if (typeof value === "string") {
    if (value.length > 0)
      normalized.messages.push({ role: "user", parts: [{ kind: "text", text: value }] });
    return;
  }
  if (!Array.isArray(value)) return;

  value.forEach((raw, index) => {
    const path = `$.input[${index}]`;
    if (!isRecord(raw)) {
      warnings.drop(path, "non_message_item");
      return;
    }

    if (raw.type === "function_call") {
      normalized.messages.push({
        role: "assistant",
        parts: [
          {
            kind: "toolUse",
            id: typeof raw.call_id === "string" ? raw.call_id : null,
            name: typeof raw.name === "string" ? raw.name : "",
            input: undefined,
            inputRaw: typeof raw.arguments === "string" ? raw.arguments : null,
          },
        ],
      });
      return;
    }
    if (raw.type === "function_call_output") {
      normalized.messages.push({
        role: "user",
        parts: [
          {
            kind: "toolResult",
            toolUseId: typeof raw.call_id === "string" ? raw.call_id : null,
            text: typeof raw.output === "string" ? raw.output : "",
            isError: false,
          },
        ],
      });
      return;
    }
    if (raw.type != null && raw.type !== "message") {
      warnings.drop(path, "non_message_item");
      return;
    }

    const role = raw.role;
    if (role === "system" || role === "developer") {
      collectUnknown(raw, ["type", "role", "content"], warnings, path);
      normalized.system.push(...readTextContent(raw.content, `${path}.content`, warnings));
      return;
    }
    if (role !== "user" && role !== "assistant") {
      warnings.drop(path, "unsupported_role", { role: String(role) });
      return;
    }
    collectUnknown(raw, ["type", "role", "content"], warnings, path);
    const parts = readResponsesContent(raw.content, `${path}.content`, warnings);
    if (parts.length > 0) normalized.messages.push({ role, parts });
  });
}

function readResponsesContent(value: unknown, path: string, warnings: Warnings): NormalizedPart[] {
  if (typeof value === "string") return value.length > 0 ? [{ kind: "text", text: value }] : [];
  if (!Array.isArray(value)) {
    if (value != null) warnings.drop(path, "dropped_content");
    return [];
  }
  const parts: NormalizedPart[] = [];
  value.forEach((part, index) => {
    const partPath = `${path}[${index}]`;
    if (!isRecord(part)) {
      warnings.drop(partPath, "dropped_content");
      return;
    }
    if (
      typeof part.text === "string" &&
      (part.type === "text" || part.type === "input_text" || part.type === "output_text")
    ) {
      parts.push({ kind: "text", text: part.text });
    } else if (part.type === "input_image") {
      const imageUrl = part.image_url;
      if (typeof imageUrl === "string") {
        parts.push(imagePartFromUrl(imageUrl));
      } else {
        warnings.drop(partPath, "dropped_image");
      }
    } else {
      warnings.drop(partPath, "dropped_content");
    }
  });
  return parts;
}

function readTextContent(value: unknown, path: string, warnings: Warnings): string[] {
  if (typeof value === "string") return value.length > 0 ? [value] : [];
  if (value == null) return [];
  if (!Array.isArray(value)) {
    warnings.drop(path, "dropped_content");
    return [];
  }
  const text: string[] = [];
  value.forEach((part, index) => {
    const partPath = `${path}[${index}]`;
    if (
      isRecord(part) &&
      typeof part.text === "string" &&
      (part.type === "text" || part.type === "input_text" || part.type === "output_text")
    ) {
      text.push(part.text);
    } else {
      warnings.drop(partPath, "dropped_content");
    }
  });
  return text;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

function readTools(value: unknown, source: AiRequestFormat, warnings: Warnings): NormalizedTool[] {
  if (!Array.isArray(value)) return [];
  const tools: NormalizedTool[] = [];
  value.forEach((raw, index) => {
    const path = `$.tools[${index}]`;
    if (!isRecord(raw)) {
      warnings.drop(path, "dropped_tool");
      return;
    }
    if (source === "anthropic_messages") {
      // Server tools (web search, computer use, ...) carry a versioned `type`
      if (typeof raw.type === "string" && raw.type !== "custom") {
        warnings.drop(path, "dropped_tool");
        return;
      }
      if (typeof raw.name !== "string") {
        warnings.drop(path, "dropped_tool");
        return;
      }
      tools.push({
        name: raw.name,
        ...(typeof raw.description === "string" && { description: raw.description }),
        ...(raw.input_schema != null && { parameters: raw.input_schema }),
      });
    } else if (source === "openai_chat_completions") {
      if (
        raw.type !== "function" ||
        !isRecord(raw.function) ||
        typeof raw.function.name !== "string"
      ) {
        warnings.drop(path, "dropped_tool");
        return;
      }
      tools.push({
        name: raw.function.name,
        ...(typeof raw.function.description === "string" && {
          description: raw.function.description,
        }),
        ...(raw.function.parameters != null && { parameters: raw.function.parameters }),
      });
    } else {
      if (raw.type !== "function" || typeof raw.name !== "string") {
        warnings.drop(path, "dropped_tool");
        return;
      }
      tools.push({
        name: raw.name,
        ...(typeof raw.description === "string" && { description: raw.description }),
        ...(raw.parameters != null && { parameters: raw.parameters }),
      });
    }
  });
  return tools;
}

function readToolChoice(
  value: unknown,
  source: AiRequestFormat,
  warnings: Warnings,
): NormalizedToolChoice | undefined {
  if (value == null) return undefined;
  const path = "$.tool_choice";

  if (source === "anthropic_messages") {
    if (!isRecord(value)) {
      warnings.drop(path, "dropped_tool_choice");
      return undefined;
    }
    if (value.type === "auto") return { kind: "auto" };
    if (value.type === "none") return { kind: "none" };
    if (value.type === "any") return { kind: "required" };
    if (value.type === "tool" && typeof value.name === "string") {
      return { kind: "tool", name: value.name };
    }
    warnings.drop(path, "dropped_tool_choice");
    return undefined;
  }

  if (value === "auto") return { kind: "auto" };
  if (value === "none") return { kind: "none" };
  if (value === "required") return { kind: "required" };
  if (isRecord(value) && value.type === "function") {
    const name =
      source === "openai_chat_completions"
        ? isRecord(value.function)
          ? value.function.name
          : undefined
        : value.name;
    if (typeof name === "string") return { kind: "tool", name };
  }
  warnings.drop(path, "dropped_tool_choice");
  return undefined;
}

// ---------------------------------------------------------------------------
// Denormalization (intermediate model -> target format)
// ---------------------------------------------------------------------------

function denormalize(
  request: NormalizedRequest,
  target: AiRequestFormat,
  warnings: Warnings,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  setDefined(body, "model", request.model);

  if (target === "anthropic_messages") {
    denormalizeAnthropic(request, body, warnings);
  } else if (target === "openai_chat_completions") {
    denormalizeChat(request, body, warnings);
  } else {
    denormalizeResponses(request, body, warnings);
  }

  setDefined(body, "stream", request.stream);
  setDefined(body, "temperature", request.temperature);
  setDefined(body, "top_p", request.topP);
  return body;
}

function denormalizeAnthropic(
  request: NormalizedRequest,
  body: Record<string, unknown>,
  warnings: Warnings,
) {
  setDefined(body, "system", request.system.length > 0 ? request.system.join("\n\n") : undefined);

  // Anthropic requires alternating roles; merge consecutive same-role messages
  const merged: NormalizedMessage[] = [];
  for (const message of request.messages) {
    const previous = merged[merged.length - 1];
    if (previous != null && previous.role === message.role) {
      previous.parts.push(...message.parts);
    } else {
      merged.push({ role: message.role, parts: [...message.parts] });
    }
  }

  let callIndex = 0;
  body.messages = merged.map((message) => ({
    role: message.role,
    content: anthropicContentFromParts(message.parts, warnings, () => `toolu_${++callIndex}`),
  }));

  if (request.maxTokens == null) {
    body.max_tokens = ANTHROPIC_DEFAULT_MAX_TOKENS;
    warnings.add("defaulted_max_tokens", "$.max_tokens", { value: ANTHROPIC_DEFAULT_MAX_TOKENS });
  } else {
    body.max_tokens = request.maxTokens;
  }
  setDefined(body, "stop_sequences", normalizeStopToArray(request.stop));

  if (request.tools.length > 0) {
    body.tools = request.tools.map((tool) => ({
      name: tool.name,
      ...(tool.description != null && { description: tool.description }),
      input_schema: tool.parameters ?? { type: "object", properties: {} },
    }));
  }
  if (request.toolChoice != null) {
    const choice = request.toolChoice;
    body.tool_choice =
      choice.kind === "tool"
        ? { type: "tool", name: choice.name }
        : { type: choice.kind === "required" ? "any" : choice.kind };
  }
}

function anthropicContentFromParts(
  parts: NormalizedPart[],
  warnings: Warnings,
  nextToolId: () => string,
): unknown {
  if (parts.length === 1 && parts[0]?.kind === "text") return parts[0].text;
  return parts.map((part) => {
    if (part.kind === "text") return { type: "text", text: part.text };
    if (part.kind === "image") {
      if (part.base64 != null) {
        return {
          type: "image",
          source: { type: "base64", media_type: part.mediaType ?? "image/png", data: part.base64 },
        };
      }
      return { type: "image", source: { type: "url", url: part.url ?? "" } };
    }
    if (part.kind === "toolUse") {
      return {
        type: "tool_use",
        id: part.id ?? nextToolId(),
        name: part.name,
        input: toolInputAsObject(part, warnings),
      };
    }
    return {
      type: "tool_result",
      tool_use_id: part.toolUseId ?? "",
      content: part.text,
      ...(part.isError && { is_error: true }),
    };
  });
}

function denormalizeChat(
  request: NormalizedRequest,
  body: Record<string, unknown>,
  warnings: Warnings,
) {
  const messages: Record<string, unknown>[] = [];
  if (request.system.length > 0) {
    messages.push({ role: "system", content: request.system.join("\n\n") });
  }

  let callIndex = 0;
  for (const message of request.messages) {
    if (message.role === "assistant") {
      const text = joinTextParts(message.parts);
      const toolCalls = message.parts
        .filter(
          (part): part is Extract<NormalizedPart, { kind: "toolUse" }> => part.kind === "toolUse",
        )
        .map((part) => ({
          id: part.id ?? `call_${++callIndex}`,
          type: "function",
          function: { name: part.name, arguments: toolInputAsString(part) },
        }));
      for (const part of message.parts) {
        if (part.kind === "image") warnings.add("dropped_image", "$.messages");
      }
      messages.push({
        role: "assistant",
        content: text.length > 0 ? text : null,
        ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
      });
      continue;
    }

    // User messages: tool results become their own `tool` messages, in order
    let pending: NormalizedPart[] = [];
    const flush = () => {
      if (pending.length === 0) return;
      messages.push({ role: "user", content: chatUserContentFromParts(pending) });
      pending = [];
    };
    for (const part of message.parts) {
      if (part.kind === "toolResult") {
        flush();
        messages.push({
          role: "tool",
          tool_call_id: part.toolUseId ?? "",
          content: part.text,
        });
        if (part.isError) warnings.add("dropped_content", "$.messages", { detail: "is_error" });
      } else if (part.kind === "toolUse") {
        warnings.add("dropped_tool", "$.messages");
      } else {
        pending.push(part);
      }
    }
    flush();
  }

  body.messages = messages;
  setDefined(body, "max_completion_tokens", request.maxTokens);
  setDefined(body, "stop", request.stop);

  if (request.tools.length > 0) {
    body.tools = request.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        ...(tool.description != null && { description: tool.description }),
        ...(tool.parameters != null && { parameters: tool.parameters }),
      },
    }));
  }
  if (request.toolChoice != null) {
    const choice = request.toolChoice;
    body.tool_choice =
      choice.kind === "tool" ? { type: "function", function: { name: choice.name } } : choice.kind;
  }
}

function chatUserContentFromParts(parts: NormalizedPart[]): unknown {
  if (parts.length === 1 && parts[0]?.kind === "text") return parts[0].text;
  const content: unknown[] = [];
  for (const part of parts) {
    if (part.kind === "text") {
      content.push({ type: "text", text: part.text });
    } else if (part.kind === "image") {
      content.push({ type: "image_url", image_url: { url: imageUrlFromPart(part) } });
    }
  }
  return content;
}

function denormalizeResponses(
  request: NormalizedRequest,
  body: Record<string, unknown>,
  warnings: Warnings,
) {
  setDefined(
    body,
    "instructions",
    request.system.length > 0 ? request.system.join("\n\n") : undefined,
  );

  let callIndex = 0;
  const input: Record<string, unknown>[] = [];
  for (const message of request.messages) {
    let pending: NormalizedPart[] = [];
    const flush = () => {
      if (pending.length === 0) return;
      input.push({
        type: "message",
        role: message.role,
        content: pending.map((part) => {
          if (part.kind === "text") {
            return {
              type: message.role === "assistant" ? "output_text" : "input_text",
              text: part.text,
            };
          }
          return { type: "input_image", image_url: imageUrlFromPart(part as ImagePart) };
        }),
      });
      pending = [];
    };
    for (const part of message.parts) {
      if (part.kind === "toolUse") {
        flush();
        input.push({
          type: "function_call",
          call_id: part.id ?? `call_${++callIndex}`,
          name: part.name,
          arguments: toolInputAsString(part),
        });
      } else if (part.kind === "toolResult") {
        flush();
        input.push({
          type: "function_call_output",
          call_id: part.toolUseId ?? "",
          output: part.text,
        });
        if (part.isError) warnings.add("dropped_content", "$.input", { detail: "is_error" });
      } else if (part.kind === "image" && message.role === "assistant") {
        warnings.add("dropped_image", "$.input");
      } else {
        pending.push(part);
      }
    }
    flush();
  }
  body.input = input;
  setDefined(body, "max_output_tokens", request.maxTokens);

  if (request.tools.length > 0) {
    body.tools = request.tools.map((tool) => ({
      type: "function",
      name: tool.name,
      ...(tool.description != null && { description: tool.description }),
      ...(tool.parameters != null && { parameters: tool.parameters }),
    }));
  }
  if (request.toolChoice != null) {
    const choice = request.toolChoice;
    body.tool_choice =
      choice.kind === "tool" ? { type: "function", name: choice.name } : choice.kind;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ImagePart = Extract<NormalizedPart, { kind: "image" }>;
type ToolUsePart = Extract<NormalizedPart, { kind: "toolUse" }>;

const DATA_URI_PATTERN = /^data:([^;,]+);base64,(.*)$/;

function imagePartFromUrl(url: string): NormalizedPart {
  const match = DATA_URI_PATTERN.exec(url);
  if (match != null && match[1] != null && match[2] != null) {
    return { kind: "image", mediaType: match[1], base64: match[2], url: null };
  }
  return { kind: "image", mediaType: null, base64: null, url };
}

function imageUrlFromPart(part: ImagePart): string {
  if (part.base64 != null) {
    return `data:${part.mediaType ?? "image/png"};base64,${part.base64}`;
  }
  return part.url ?? "";
}

function toolInputAsObject(part: ToolUsePart, warnings: Warnings): unknown {
  if (isRecord(part.input)) return part.input;
  if (part.inputRaw != null) {
    try {
      const parsed: unknown = JSON.parse(part.inputRaw);
      if (isRecord(parsed)) return parsed;
    } catch {
      // fall through to the warning below
    }
    warnings.add("invalid_tool_arguments", undefined, { name: part.name });
  }
  return {};
}

function toolInputAsString(part: ToolUsePart): string {
  if (part.inputRaw != null) return part.inputRaw;
  if (part.input === undefined) return "{}";
  try {
    return JSON.stringify(part.input);
  } catch {
    return "{}";
  }
}

function joinTextParts(parts: NormalizedPart[]): string {
  return parts
    .filter((part): part is Extract<NormalizedPart, { kind: "text" }> => part.kind === "text")
    .map((part) => part.text)
    .join("");
}

function normalizeStopToArray(value: unknown): unknown {
  if (typeof value === "string") return [value];
  return value;
}

function collectUnknown(
  body: Record<string, unknown>,
  known: string[],
  warnings: Warnings,
  basePath = "$",
) {
  for (const key of Object.keys(body)) {
    if (!known.includes(key)) warnings.drop(`${basePath}.${key}`);
  }
}

function setDefined(target: Record<string, unknown>, key: string, value: unknown) {
  if (value !== undefined && value !== null) target[key] = value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
