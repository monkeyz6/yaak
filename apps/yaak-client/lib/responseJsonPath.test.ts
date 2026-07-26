import { EditorState } from "@codemirror/state";
import { jsonc } from "@shopify/lang-jsonc";
import { describe, expect, it } from "vitest";
import { jsonPathAtPosition } from "./responseJsonPath";

function stateFor(doc: string) {
  return EditorState.create({ doc, extensions: [jsonc()] });
}

function pathAt(doc: string, target: string): string | null {
  const index = doc.indexOf(target);
  if (index === -1) throw new Error(`target not found: ${target}`);
  const state = stateFor(doc);
  return jsonPathAtPosition(state, index + Math.floor(target.length / 2))?.path ?? null;
}

describe("jsonPathAtPosition", () => {
  const doc = JSON.stringify(
    {
      data: {
        token: "abc-123",
        items: [{ id: 1 }, { id: 2, tags: ["x", "y"] }],
        "weird key": true,
        count: 10,
      },
      ok: null,
    },
    null,
    2,
  );

  it("resolves nested object values", () => {
    expect(pathAt(doc, '"abc-123"')).toBe("$.data.token");
    expect(pathAt(doc, "10")).toBe("$.data.count");
  });

  it("resolves array indices", () => {
    expect(pathAt(doc, '"id": 1')).toBe("$.data.items[0].id");
    expect(pathAt(doc, '"id": 2')).toBe("$.data.items[1].id");
    expect(pathAt(doc, '"y"')).toBe("$.data.items[1].tags[1]");
  });

  it("uses bracket notation for non-identifier keys", () => {
    expect(pathAt(doc, "true")).toBe('$.data["weird key"]');
  });

  it("targets the property value when hovering its key", () => {
    expect(pathAt(doc, '"token"')).toBe("$.data.token");
  });

  it("resolves null and root values", () => {
    expect(pathAt(doc, "null")).toBe("$.ok");
    expect(pathAt("42", "42")).toBe("$");
  });

  it("reports the last object key as lastSegment", () => {
    const state = stateFor(doc);
    const pos = doc.indexOf('"abc-123"') + 2;
    expect(jsonPathAtPosition(state, pos)?.lastSegment).toBe("token");
    const tagPos = doc.indexOf('"y"') + 1;
    expect(jsonPathAtPosition(state, tagPos)?.lastSegment).toBe("tags");
  });

  it("handles escaped keys", () => {
    const escaped = '{"a\\"b": 1}';
    expect(pathAt(escaped, "1")).toBe('$["a\\"b"]');
  });
});
