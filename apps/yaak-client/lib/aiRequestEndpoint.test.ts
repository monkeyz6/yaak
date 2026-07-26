import { describe, expect, it } from "vitest";
import { convertAiRequestEndpoint } from "./aiRequestEndpoint";

describe("convertAiRequestEndpoint", () => {
  it("swaps Anthropic URL and headers to OpenAI Chat", () => {
    const result = convertAiRequestEndpoint(
      {
        url: "https://api.anthropic.com/v1/messages",
        headers: [
          { enabled: true, name: "x-api-key", value: "sk-key" },
          { enabled: true, name: "anthropic-version", value: "2023-06-01" },
          { enabled: true, name: "Content-Type", value: "application/json" },
        ],
      },
      "anthropic_messages",
      "openai_chat_completions",
    );
    expect(result.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(result.headers).toEqual([
      { enabled: true, name: "Content-Type", value: "application/json" },
      { enabled: true, name: "Authorization", value: "Bearer sk-key" },
    ]);
    expect(result.notes).toEqual([]);
  });

  it("swaps OpenAI URL and headers to Anthropic", () => {
    const result = convertAiRequestEndpoint(
      {
        url: "https://api.openai.com/v1/chat/completions",
        headers: [{ enabled: true, name: "Authorization", value: "Bearer sk-key" }],
      },
      "openai_chat_completions",
      "anthropic_messages",
    );
    expect(result.url).toBe("https://api.anthropic.com/v1/messages");
    expect(result.headers).toEqual([
      { enabled: true, name: "x-api-key", value: "sk-key" },
      { enabled: true, name: "anthropic-version", value: "2023-06-01" },
    ]);
  });

  it("keeps headers when converting between the two OpenAI formats", () => {
    const result = convertAiRequestEndpoint(
      {
        url: "https://api.openai.com/v1/chat/completions?beta=1",
        headers: [{ enabled: true, name: "Authorization", value: "Bearer sk" }],
      },
      "openai_chat_completions",
      "openai_responses",
    );
    expect(result.url).toBe("https://api.openai.com/v1/responses?beta=1");
    expect(result.headers).toBeNull();
  });

  it("reports unrecognized URLs without changing them", () => {
    const result = convertAiRequestEndpoint(
      { url: "https://gateway.test/ai", headers: [] },
      "openai_chat_completions",
      "anthropic_messages",
    );
    expect(result.url).toBeNull();
    expect(result.notes).toContain("url_not_recognized");
  });

  it("notes a missing auth token instead of inventing one", () => {
    const result = convertAiRequestEndpoint(
      { url: "https://api.openai.com/v1/chat/completions", headers: [] },
      "openai_chat_completions",
      "anthropic_messages",
    );
    expect(result.notes).toContain("auth_token_missing");
    expect(result.headers).toEqual([
      { enabled: true, name: "anthropic-version", value: "2023-06-01" },
    ]);
  });

  it("preserves template tags in migrated values", () => {
    const result = convertAiRequestEndpoint(
      {
        url: "${[ base_url ]}/v1/messages",
        headers: [{ enabled: true, name: "x-api-key", value: "${[ api_key ]}" }],
      },
      "anthropic_messages",
      "openai_responses",
    );
    expect(result.url).toBe("${[ base_url ]}/v1/responses");
    expect(result.headers).toEqual([
      { enabled: true, name: "Authorization", value: "Bearer ${[ api_key ]}" },
    ]);
  });
});
