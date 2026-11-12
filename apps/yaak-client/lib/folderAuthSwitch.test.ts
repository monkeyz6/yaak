import { parseTemplate } from "@yaakapp-internal/templates";
import { describe, expect, test } from "vitest";
import {
  collectFolderVisibleVariableNames,
  getFolderAuthSwitchSource,
  getPureVariableName,
  isSecureTemplate,
  variableTag,
  withAuthField,
} from "./folderAuthSwitch";

describe("getPureVariableName", () => {
  test("reads a single variable tag, including dotted and dashed names", () => {
    expect(getPureVariableName("${[ seedance ]}")).toBe("seedance");
    expect(getPureVariableName("${[ a.b ]}")).toBe("a.b");
    expect(getPureVariableName("${[ a-b ]}")).toBe("a-b");
    const parsed = parseTemplate("${[ a.b ]}").tokens.filter((token) => token.type !== "eof");
    expect(parsed).toEqual([{ type: "tag", val: { type: "var", name: "a.b" } }]);
  });

  test("rejects anything that is not exactly one variable", () => {
    expect(getPureVariableName("Bearer ${[ x ]}")).toBeNull();
    expect(getPureVariableName("literal")).toBeNull();
    expect(getPureVariableName("${[ secure(password='x') ]}")).toBeNull();
    expect(getPureVariableName("${[ a ]} ${[ b ]}")).toBeNull();
    expect(getPureVariableName(" ${[ x ]}")).toBeNull();
    expect(getPureVariableName(12)).toBeNull();
    expect(getPureVariableName(null)).toBeNull();
  });
});

describe("getFolderAuthSwitchSource without a chip", () => {
  test("returns null without own auth, for unknown types, and for non-variable secrets", () => {
    expect(
      getFolderAuthSwitchSource({
        authenticationType: null,
        authentication: { token: "${[ x ]}" },
      }),
    ).toBeNull();
    expect(
      getFolderAuthSwitchSource({
        authenticationType: "none",
        authentication: { token: "${[ x ]}" },
      }),
    ).toBeNull();
    expect(
      getFolderAuthSwitchSource({
        authenticationType: "custom",
        authentication: { token: "${[ x ]}" },
      }),
    ).toBeNull();
    expect(
      getFolderAuthSwitchSource({
        authenticationType: "oauth2",
        authentication: { clientSecret: "literal", password: "${[ other ]}" },
      }),
    ).toBeNull();
  });
});

describe("withAuthField", () => {
  test("replaces only the secret field", () => {
    expect(
      withAuthField(
        { token: "${[ seedance ]}", prefix: "Bearer", disabled: true },
        "token",
        variableTag("kling"),
      ),
    ).toEqual({ token: "${[ kling ]}", prefix: "Bearer", disabled: true });
  });
});

describe("collectFolderVisibleVariableNames", () => {
  test("walks the folder, then ancestors, then the active and base environments", () => {
    expect(
      collectFolderVisibleVariableNames({
        folderId: "child",
        folders: [
          { id: "child", folderId: "parent" },
          { id: "parent", folderId: null },
        ],
        environments: [
          {
            parentModel: "folder",
            parentId: "child",
            variables: [
              { enabled: true, name: "near" },
              { enabled: false, name: "off" },
              { enabled: true, name: "" },
            ],
          },
          {
            parentModel: "folder",
            parentId: "parent",
            variables: [
              { enabled: true, name: "far" },
              { enabled: true, name: "near" },
            ],
          },
        ],
        activeEnvironment: {
          variables: [
            { enabled: true, name: "active" },
            { enabled: true, name: "far" },
          ],
        },
        baseEnvironment: { variables: [{ enabled: true, name: "base" }] },
      }),
    ).toEqual(["near", "far", "active", "base"]);
  });
});

// Same shape as what Yaak stores for an encrypted field
const SECURE = "${[ secure(value=b64'WUVOQ19lVUUwYXpO') ]}";

describe("isSecureTemplate", () => {
  test("accepts exactly one secure() call", () => {
    expect(isSecureTemplate(SECURE)).toBe(true);
  });

  test("rejects plain references, mixed text, other functions, and non-strings", () => {
    expect(isSecureTemplate("${[ seedance ]}")).toBe(false);
    expect(isSecureTemplate(`Bearer ${SECURE}`)).toBe(false);
    expect(isSecureTemplate("${[ uuid() ]}")).toBe(false);
    expect(isSecureTemplate("")).toBe(false);
    expect(isSecureTemplate(null)).toBe(false);
  });
});

describe("getFolderAuthSwitchSource", () => {
  test("gives the name for a plain reference", () => {
    expect(
      getFolderAuthSwitchSource({
        authenticationType: "bearer",
        authentication: { token: "${[ seedance ]}" },
      }),
    ).toEqual({ field: "token", variableName: "seedance", encryptedTemplate: null });
  });

  test("gives the ciphertext for an encrypted value", () => {
    expect(
      getFolderAuthSwitchSource({
        authenticationType: "bearer",
        authentication: { prefix: "Bearer ", token: SECURE },
      }),
    ).toEqual({ field: "token", variableName: null, encryptedTemplate: SECURE });
  });

  test("returns null for literals and unknown types", () => {
    expect(
      getFolderAuthSwitchSource({
        authenticationType: "bearer",
        authentication: { token: "sk-1" },
      }),
    ).toBeNull();
    expect(
      getFolderAuthSwitchSource({
        authenticationType: "custom",
        authentication: { token: SECURE },
      }),
    ).toBeNull();
  });
});

describe("variableTag", () => {
  test("round-trips through the parser", () => {
    expect(getPureVariableName(variableTag("a.b-c"))).toBe("a.b-c");
  });
});
