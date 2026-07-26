import { describe, expect, it } from "vitest";
import {
  convertAiRequestBody,
  detectAiRequestFormat,
  parseAiRequestBody,
  type AiRequestFormat,
} from "./aiRequestConversion";

const FORMATS: AiRequestFormat[] = [
  "anthropic_messages",
  "openai_chat_completions",
  "openai_responses",
];

const TEXT_BODIES: Record<AiRequestFormat, Record<string, unknown>> = {
  anthropic_messages: {
    model: "claude-sonnet-5",
    system: "Be helpful",
    max_tokens: 512,
    messages: [{ role: "user", content: "Hello" }],
  },
  openai_chat_completions: {
    model: "gpt-5",
    max_completion_tokens: 512,
    messages: [
      { role: "system", content: "Be helpful" },
      { role: "user", content: "Hello" },
    ],
  },
  openai_responses: {
    model: "gpt-5",
    instructions: "Be helpful",
    max_output_tokens: 512,
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Hello" }] }],
  },
};

describe("convertAiRequestBody text conversions", () => {
  it("converts between all six directions", () => {
    for (const source of FORMATS) {
      for (const target of FORMATS) {
        if (source === target) continue;
        const result = convertAiRequestBody(TEXT_BODIES[source], source, target);
        expect(result.body.model, `${source} -> ${target}`).toBeDefined();
        const json = JSON.stringify(result.body);
        expect(json, `${source} -> ${target}`).toContain("Hello");
        expect(json, `${source} -> ${target}`).toContain("Be helpful");
      }
    }
  });

  it("merges system and developer messages and maps token limits", () => {
    const result = convertAiRequestBody(
      {
        model: "gpt-5",
        max_tokens: 256,
        messages: [
          { role: "system", content: "One" },
          { role: "developer", content: "Two" },
          { role: "user", content: "Hi" },
        ],
      },
      "openai_chat_completions",
      "anthropic_messages",
    );
    expect(result.body.system).toBe("One\n\nTwo");
    expect(result.body.max_tokens).toBe(256);
  });

  it("defaults max_tokens with a warning when converting to Anthropic", () => {
    const result = convertAiRequestBody(
      { model: "gpt-5", messages: [{ role: "user", content: "Hi" }] },
      "openai_chat_completions",
      "anthropic_messages",
    );
    expect(result.body.max_tokens).toBe(4096);
    expect(result.warnings.some((w) => w.code === "defaulted_max_tokens")).toBe(true);
  });

  it("drops stop sequences when converting to Responses", () => {
    const result = convertAiRequestBody(
      { ...TEXT_BODIES.anthropic_messages, stop_sequences: ["END"] },
      "anthropic_messages",
      "openai_responses",
    );
    expect(result.body.stop).toBeUndefined();
    expect(result.warnings.some((w) => w.code === "dropped_stop")).toBe(true);
    expect(result.droppedFields).toContain("$.stop_sequences");
  });

  it("round-trips a text conversation between Chat and Anthropic", () => {
    const forward = convertAiRequestBody(
      TEXT_BODIES.openai_chat_completions,
      "openai_chat_completions",
      "anthropic_messages",
    );
    const back = convertAiRequestBody(
      forward.body,
      "anthropic_messages",
      "openai_chat_completions",
    );
    expect(back.body.messages).toEqual(TEXT_BODIES.openai_chat_completions.messages);
    expect(back.body.max_completion_tokens).toBe(512);
  });
});

describe("image conversions", () => {
  const PNG = "aGVsbG8=";

  it("maps Anthropic base64 images to Chat data URIs and back", () => {
    const anthropic = {
      model: "claude-sonnet-5",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is this?" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } },
          ],
        },
      ],
    };
    const chat = convertAiRequestBody(anthropic, "anthropic_messages", "openai_chat_completions");
    const content = (chat.body.messages as Record<string, unknown>[])[0]?.content as Record<
      string,
      unknown
    >[];
    expect(content[1]).toEqual({
      type: "image_url",
      image_url: { url: `data:image/png;base64,${PNG}` },
    });
    expect(chat.warnings.filter((w) => w.code.startsWith("dropped"))).toEqual([]);

    const back = convertAiRequestBody(chat.body, "openai_chat_completions", "anthropic_messages");
    const backContent = (back.body.messages as Record<string, unknown>[])[0]?.content as Record<
      string,
      unknown
    >[];
    expect(backContent[1]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: PNG },
    });
  });

  it("maps URL images to Responses input_image", () => {
    const chat = {
      model: "gpt-5",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Describe" },
            { type: "image_url", image_url: { url: "https://example.com/cat.png" } },
          ],
        },
      ],
    };
    const result = convertAiRequestBody(chat, "openai_chat_completions", "openai_responses");
    const input = result.body.input as Record<string, unknown>[];
    const content = input[0]?.content as Record<string, unknown>[];
    expect(content[1]).toEqual({ type: "input_image", image_url: "https://example.com/cat.png" });
  });
});

describe("tool conversions", () => {
  const CHAT_TOOLS_BODY = {
    model: "gpt-5",
    messages: [
      { role: "user", content: "What is the weather in Paris?" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "get_weather", arguments: '{"city":"Paris"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "Sunny, 21C" },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get the weather",
          parameters: { type: "object", properties: { city: { type: "string" } } },
        },
      },
    ],
    tool_choice: "auto",
  };

  it("converts Chat tool calls to Anthropic tool_use/tool_result blocks", () => {
    const result = convertAiRequestBody(
      CHAT_TOOLS_BODY,
      "openai_chat_completions",
      "anthropic_messages",
    );
    const messages = result.body.messages as Record<string, unknown>[];
    expect(messages).toHaveLength(3);
    const assistantContent = messages[1]?.content as Record<string, unknown>[];
    expect(assistantContent[0]).toEqual({
      type: "tool_use",
      id: "call_1",
      name: "get_weather",
      input: { city: "Paris" },
    });
    const toolResult = (messages[2]?.content as Record<string, unknown>[])[0];
    expect(toolResult).toEqual({
      type: "tool_result",
      tool_use_id: "call_1",
      content: "Sunny, 21C",
    });
    expect(result.body.tools).toEqual([
      {
        name: "get_weather",
        description: "Get the weather",
        input_schema: { type: "object", properties: { city: { type: "string" } } },
      },
    ]);
    expect(result.body.tool_choice).toEqual({ type: "auto" });
  });

  it("converts Chat tool calls to Responses function_call items", () => {
    const result = convertAiRequestBody(
      CHAT_TOOLS_BODY,
      "openai_chat_completions",
      "openai_responses",
    );
    const input = result.body.input as Record<string, unknown>[];
    expect(input[1]).toEqual({
      type: "function_call",
      call_id: "call_1",
      name: "get_weather",
      arguments: '{"city":"Paris"}',
    });
    expect(input[2]).toEqual({
      type: "function_call_output",
      call_id: "call_1",
      output: "Sunny, 21C",
    });
    expect(result.body.tools).toEqual([
      {
        type: "function",
        name: "get_weather",
        description: "Get the weather",
        parameters: { type: "object", properties: { city: { type: "string" } } },
      },
    ]);
  });

  it("round-trips tools from Chat through Anthropic and back", () => {
    const forward = convertAiRequestBody(
      CHAT_TOOLS_BODY,
      "openai_chat_completions",
      "anthropic_messages",
    );
    const back = convertAiRequestBody(
      forward.body,
      "anthropic_messages",
      "openai_chat_completions",
    );
    const messages = back.body.messages as Record<string, unknown>[];
    const assistant = messages.find((m) => m.role === "assistant");
    expect(assistant?.tool_calls).toEqual([
      {
        id: "call_1",
        type: "function",
        function: { name: "get_weather", arguments: '{"city":"Paris"}' },
      },
    ]);
    const tool = messages.find((m) => m.role === "tool");
    expect(tool).toEqual({ role: "tool", tool_call_id: "call_1", content: "Sunny, 21C" });
  });

  it("maps tool_choice variants across formats", () => {
    const anthropic = {
      model: "claude-sonnet-5",
      max_tokens: 10,
      messages: [{ role: "user", content: "Hi" }],
      tools: [{ name: "f", input_schema: { type: "object" } }],
      tool_choice: { type: "any" },
    };
    const chat = convertAiRequestBody(anthropic, "anthropic_messages", "openai_chat_completions");
    expect(chat.body.tool_choice).toBe("required");
    const responses = convertAiRequestBody(anthropic, "anthropic_messages", "openai_responses");
    expect(responses.body.tool_choice).toBe("required");

    const named = convertAiRequestBody(
      { ...anthropic, tool_choice: { type: "tool", name: "f" } },
      "anthropic_messages",
      "openai_responses",
    );
    expect(named.body.tool_choice).toEqual({ type: "function", name: "f" });
  });

  it("replaces unparseable tool arguments with an empty object and warns", () => {
    const result = convertAiRequestBody(
      {
        model: "gpt-5",
        messages: [
          {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "c1", type: "function", function: { name: "f", arguments: "{oops" } },
            ],
          },
        ],
      },
      "openai_chat_completions",
      "anthropic_messages",
    );
    const content = (result.body.messages as Record<string, unknown>[])[0]?.content as Record<
      string,
      unknown
    >[];
    expect(content[0]?.input).toEqual({});
    expect(result.warnings.some((w) => w.code === "invalid_tool_arguments")).toBe(true);
  });

  it("drops non-function tools with a warning", () => {
    const result = convertAiRequestBody(
      {
        model: "claude-sonnet-5",
        max_tokens: 10,
        messages: [{ role: "user", content: "Hi" }],
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      },
      "anthropic_messages",
      "openai_chat_completions",
    );
    expect(result.body.tools).toBeUndefined();
    expect(result.warnings.some((w) => w.code === "dropped_tool")).toBe(true);
  });
});

describe("unknown field handling", () => {
  it("drops Responses-specific fields with warnings", () => {
    const result = convertAiRequestBody(
      {
        model: "gpt-5",
        input: "Hi",
        previous_response_id: "resp_1",
        reasoning: { effort: "high" },
        store: false,
      },
      "openai_responses",
      "openai_chat_completions",
    );
    expect(result.droppedFields).toEqual(
      expect.arrayContaining(["$.previous_response_id", "$.reasoning", "$.store"]),
    );
    expect(result.body.messages).toEqual([{ role: "user", content: "Hi" }]);
  });

  it("records a model warning when converting between vendors", () => {
    const result = convertAiRequestBody(
      TEXT_BODIES.anthropic_messages,
      "anthropic_messages",
      "openai_chat_completions",
    );
    expect(result.warnings.some((w) => w.code === "model_preserved")).toBe(true);
  });
});

describe("detectAiRequestFormat", () => {
  it("detects by structural signals", () => {
    expect(detectAiRequestFormat({ input: "Hi" })).toBe("openai_responses");
    expect(detectAiRequestFormat(TEXT_BODIES.anthropic_messages)).toBe("anthropic_messages");
    expect(detectAiRequestFormat(TEXT_BODIES.openai_chat_completions)).toBe(
      "openai_chat_completions",
    );
  });

  it("detects minimal Anthropic bodies via content blocks on unknown gateways", () => {
    const minimal = {
      model: "claude-sonnet-5",
      max_tokens: 100,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: "x" } },
          ],
        },
      ],
    };
    expect(detectAiRequestFormat(minimal, "https://gateway.test/ai")).toBe("anthropic_messages");
  });

  it("detects Chat bodies via tool role messages", () => {
    const body = {
      model: "gpt-5",
      messages: [{ role: "tool", tool_call_id: "c", content: "done" }],
    };
    expect(detectAiRequestFormat(body, "https://gateway.test/ai")).toBe("openai_chat_completions");
  });

  it("falls back to URL path hints", () => {
    expect(detectAiRequestFormat({ foo: 1 }, "https://api.openai.com/v1/responses")).toBe(
      "openai_responses",
    );
    expect(detectAiRequestFormat({ foo: 1 }, "https://api.anthropic.com/v1/messages")).toBe(
      "anthropic_messages",
    );
  });
});

describe("parseAiRequestBody", () => {
  it("parses JSONC with comments and trailing commas", () => {
    const parsed = parseAiRequestBody('{\n  // model\n  "model": "gpt-5",\n}');
    expect(parsed).toEqual({ model: "gpt-5" });
  });
});
