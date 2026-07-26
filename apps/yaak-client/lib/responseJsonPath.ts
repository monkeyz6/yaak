import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

export interface JsonPathAtPosition {
  /** JSONPath expression for the value under the cursor, e.g. `$.data.items[0].id` */
  path: string;
  /** Last object key on the path, if any. Useful as a default variable name */
  lastSegment: string | null;
}

const IDENTIFIER_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const VALUE_NODES = new Set(["Object", "Array", "String", "Number", "True", "False", "Null"]);

/**
 * Compute the JSONPath of the JSON value at `pos` in a JSON(C) document. Returns null when the
 * position is not inside a JSON value (e.g. whitespace between top-level tokens) or the
 * document is not parseable as JSON.
 */
export function jsonPathAtPosition(state: EditorState, pos: number): JsonPathAtPosition | null {
  const tree = syntaxTree(state);
  let node: SyntaxNode | null = tree.resolveInner(pos, 1);
  if (node == null || node.type.isError || !isPathNode(node)) {
    const before = tree.resolveInner(pos, -1);
    if (before != null && !before.type.isError && isPathNode(before)) node = before;
  }
  if (node == null || node.type.isError) return null;

  // Hovering a property name targets that property's value
  if (node.name === "PropertyName") {
    const value = lastValueChild(node.parent);
    if (value != null) node = value;
  }

  // Walk up to the nearest value node
  while (node != null && !VALUE_NODES.has(node.name)) {
    node = node.parent;
  }
  if (node == null) return null;

  const segments: string[] = [];
  let lastSegment: string | null = null;
  let current: SyntaxNode = node;

  while (current.parent != null) {
    const parent: SyntaxNode = current.parent;
    if (parent.name === "Property") {
      const keyNode = parent.getChild("PropertyName");
      if (keyNode == null) return null;
      const key = parseKey(state.sliceDoc(keyNode.from, keyNode.to));
      if (key == null) return null;
      segments.unshift(IDENTIFIER_KEY.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`);
      if (lastSegment == null) lastSegment = key;
    } else if (parent.name === "Array") {
      let index = 0;
      for (let sibling = current.prevSibling; sibling != null; sibling = sibling.prevSibling) {
        if (VALUE_NODES.has(sibling.name)) index += 1;
      }
      segments.unshift(`[${index}]`);
    }
    current = parent;
  }

  return { path: `$${segments.join("")}`, lastSegment };
}

function isPathNode(node: SyntaxNode): boolean {
  return VALUE_NODES.has(node.name) || node.name === "PropertyName" || node.name === "Property";
}

function lastValueChild(property: SyntaxNode | null): SyntaxNode | null {
  if (property == null) return null;
  for (let child = property.lastChild; child != null; child = child.prevSibling) {
    if (VALUE_NODES.has(child.name)) return child;
  }
  return null;
}

function parseKey(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    try {
      // JSONC keys are still JSON strings; single quotes are invalid but be lenient
      return trimmed.startsWith('"') ? (JSON.parse(trimmed) as string) : trimmed.slice(1, -1);
    } catch {
      return null;
    }
  }
  return trimmed.length > 0 ? trimmed : null;
}
