import { beforeEach, describe, expect, test, vi } from "vitest";

const decrypt = vi.fn<(template: string) => Promise<string>>();
vi.mock("./encryption", () => ({ convertTemplateToInsecure: (t: string) => decrypt(t) }));

const {
  encryptionKeyMarker,
  getEncryptedVariableName,
  rememberEncryptedVariableName,
  resolveEncryptedVariableName,
} = await import("./secureTemplateCache");

// The cache is module-level, so every test uses its own ciphertexts
let n = 0;
const nextTemplate = () => `\${[ secure(value=b64'test-${++n}') ]}`;

beforeEach(() => decrypt.mockReset());

describe("resolveEncryptedVariableName", () => {
  test("records the variable name and decrypts each ciphertext once", async () => {
    const template = nextTemplate();
    decrypt.mockResolvedValue("${[ seedance ]}");
    await Promise.all([
      resolveEncryptedVariableName(template, "k1"),
      resolveEncryptedVariableName(template, "k1"),
    ]);
    await resolveEncryptedVariableName(template, "k1");
    expect(getEncryptedVariableName(template)).toBe("seedance");
    expect(decrypt).toHaveBeenCalledTimes(1);
  });

  test("keeps only null, never the plaintext, for a literal secret", async () => {
    const template = nextTemplate();
    decrypt.mockResolvedValue("sk-live-secret");
    await resolveEncryptedVariableName(template, "k1");
    expect(getEncryptedVariableName(template)).toBeNull();
  });

  test("doesn't retry a failure until the key changes", async () => {
    const template = nextTemplate();
    decrypt.mockRejectedValue(new Error("no key"));
    await resolveEncryptedVariableName(template, "none");
    await resolveEncryptedVariableName(template, "none");
    expect(decrypt).toHaveBeenCalledTimes(1);
    expect(getEncryptedVariableName(template)).toBeUndefined();

    decrypt.mockResolvedValue("${[ kling ]}");
    await resolveEncryptedVariableName(template, "k2");
    expect(decrypt).toHaveBeenCalledTimes(2);
    expect(getEncryptedVariableName(template)).toBe("kling");
  });
});

describe("rememberEncryptedVariableName", () => {
  test("seeds the cache without decrypting", async () => {
    const template = nextTemplate();
    rememberEncryptedVariableName(template, "kling");
    await resolveEncryptedVariableName(template, "k1");
    expect(getEncryptedVariableName(template)).toBe("kling");
    expect(decrypt).not.toHaveBeenCalled();
  });
});

describe("encryptionKeyMarker", () => {
  test("is stable per key, differs between keys, and doesn't contain the key", () => {
    const key = { encryptedKey: "wrapped-key-abc" };
    expect(encryptionKeyMarker(null)).toBe("none");
    expect(encryptionKeyMarker(key)).toBe(encryptionKeyMarker({ ...key }));
    expect(encryptionKeyMarker(key)).not.toBe(encryptionKeyMarker({ encryptedKey: "other" }));
    expect(encryptionKeyMarker(key)).not.toContain("wrapped");
  });
});
