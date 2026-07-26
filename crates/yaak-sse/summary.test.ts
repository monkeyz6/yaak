import { describe, expect, it } from "vitest";
import { computeReadableSseText, computeSseSummary, extractSseValueAtPath } from "./summary";

describe("extractSseValueAtPath", () => {
  it("supports simple paths", () => {
    expect(
      extractSseValueAtPath(
        JSON.stringify({ choices: [{ delta: { content: "hello" } }] }),
        "$.choices[0].delta.content",
      ),
    ).toBe("hello");
  });

  it("supports full JSONPath expressions", () => {
    expect(
      extractSseValueAtPath(
        JSON.stringify({
          choices: [
            { delta: { role: "assistant" } },
            { delta: { content: "hello" } },
            { delta: { content: " world" } },
          ],
        }),
        "$.choices[*].delta.content",
      ),
    ).toBe("hello world");
  });

  it("returns null when a JSONPath expression has no matches", () => {
    expect(extractSseValueAtPath(JSON.stringify({ delta: {} }), "$.delta.text")).toBeNull();
  });
});

describe("computeReadableSseText", () => {
  it("auto-detects OpenAI Chat Completions on compatible gateways", () => {
    const text = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "hello" } }] })}`,
      "",
      `data: ${JSON.stringify({ choices: [{ delta: { content: " world" } }] })}`,
      "",
      "data: [DONE]",
    ].join("\n");
    expect(computeReadableSseText(text, "auto")).toEqual({
      fragmentCount: 2,
      summary: "hello world",
      detectedMode: "openai_chat",
      reasoning: "",
      reasoningFragmentCount: 0,
    });
  });

  it("only includes Responses output text deltas", () => {
    const text = [
      `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "hello" })}`,
      "",
      `event: response.function_call_arguments.delta\ndata: ${JSON.stringify({ type: "response.function_call_arguments.delta", delta: "not text" })}`,
    ].join("\n");
    expect(computeReadableSseText(text, "auto").summary).toBe("hello");
  });

  it("only includes Anthropic text content deltas", () => {
    const text = [
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hello" } })}`,
      "",
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "input_json_delta", partial_json: "{}" } })}`,
    ].join("\n");
    expect(computeReadableSseText(text, "auto").summary).toBe("hello");
  });

  it("supports multiline data and custom JSONPath", () => {
    const text = `data: {"delta":\ndata: "hello"}\n\n`;
    expect(computeReadableSseText(text, "custom_jsonpath", "$.delta").summary).toBe("hello");
  });

  it("ignores comments, completion markers, and non-text Chat deltas", () => {
    const text = [
      ": keep-alive",
      "",
      `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant" } }] })}`,
      "",
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ id: "call_1" }] } }] })}`,
      "",
      `data: ${JSON.stringify({ choices: [{ delta: { content: "hello" } }] })}`,
      "",
      "data: [DONE]",
    ].join("\n");
    expect(computeReadableSseText(text, "auto")).toEqual({
      fragmentCount: 1,
      summary: "hello",
      detectedMode: "openai_chat",
      reasoning: "",
      reasoningFragmentCount: 0,
    });
  });

  it("returns no detected mode for non-AI streams in auto mode", () => {
    const text = [
      `data: ${JSON.stringify({ level: "info", message: "server started" })}`,
      "",
      `data: ${JSON.stringify({ level: "warn", message: "high memory" })}`,
    ].join("\n");
    const result = computeReadableSseText(text, "auto");
    expect(result.detectedMode).toBeNull();
    expect(result.fragmentCount).toBe(0);
  });

  it("does not report a detected mode for fixed modes", () => {
    const text = `data: ${JSON.stringify({ choices: [{ delta: { content: "hi" } }] })}\n\n`;
    const result = computeReadableSseText(text, "openai_chat");
    expect(result.summary).toBe("hi");
    expect(result.detectedMode).toBeNull();
  });

  it("returns nothing when a fixed mode does not match the stream", () => {
    const text = `data: ${JSON.stringify({ choices: [{ delta: { content: "hi" } }] })}\n\n`;
    const result = computeReadableSseText(text, "anthropic");
    expect(result.fragmentCount).toBe(0);
    expect(result.summary).toBe("");
  });

  it("detects Responses streams without event lines", () => {
    const text = [
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "hel" })}`,
      "",
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "lo" })}`,
    ].join("\n");
    expect(computeReadableSseText(text, "auto")).toEqual({
      fragmentCount: 2,
      summary: "hello",
      detectedMode: "openai_responses",
      reasoning: "",
      reasoningFragmentCount: 0,
    });
  });

  it("extracts Anthropic thinking deltas as reasoning", () => {
    const text = [
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "thinking_delta", thinking: "let me think" } })}`,
      "",
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "the answer" } })}`,
    ].join("\n");
    const result = computeReadableSseText(text, "auto");
    expect(result.detectedMode).toBe("anthropic");
    expect(result.summary).toBe("the answer");
    expect(result.reasoning).toBe("let me think");
    expect(result.reasoningFragmentCount).toBe(1);
  });

  it("extracts OpenAI Responses reasoning summary deltas", () => {
    const text = [
      `event: response.reasoning_summary_text.delta\ndata: ${JSON.stringify({ type: "response.reasoning_summary_text.delta", delta: "thinking..." })}`,
      "",
      `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: "answer" })}`,
    ].join("\n");
    const result = computeReadableSseText(text, "auto");
    expect(result.detectedMode).toBe("openai_responses");
    expect(result.summary).toBe("answer");
    expect(result.reasoning).toBe("thinking...");
  });

  it("extracts reasoning_content from OpenAI-compatible chat streams", () => {
    const text = [
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "hmm, " } }] })}`,
      "",
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "okay" } }] })}`,
      "",
      `data: ${JSON.stringify({ choices: [{ delta: { content: "result" } }] })}`,
    ].join("\n");
    const result = computeReadableSseText(text, "auto");
    expect(result.detectedMode).toBe("openai_chat");
    expect(result.summary).toBe("result");
    expect(result.reasoning).toBe("hmm, okay");
    expect(result.reasoningFragmentCount).toBe(2);
  });
});

describe("computeSseSummary", () => {
  it("concatenates JSONPath matches across SSE messages", () => {
    expect(
      computeSseSummary(
        [
          `data: ${JSON.stringify({ choices: [{ delta: { content: "hello" } }] })}`,
          "",
          `data: ${JSON.stringify({ choices: [{ delta: { content: " world" } }] })}`,
          "",
        ].join("\n"),
        "$.choices[*].delta.content",
      ),
    ).toEqual({
      fragmentCount: 2,
      summary: "hello world",
    });
  });
});
