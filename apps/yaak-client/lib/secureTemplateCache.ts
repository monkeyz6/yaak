import { convertTemplateToInsecure } from "./encryption";
import { getPureVariableName } from "./folderAuthSwitch";

/**
 * Which variable an encrypted (`secure(...)`) auth value refers to, keyed by the ciphertext.
 *
 * Only the outcome is kept: the variable name, or `null` when the plaintext is anything else (eg. a
 * literal secret). The decrypted plaintext itself is never stored.
 *
 * Sidebar rows are virtualized and remount while scrolling, so each ciphertext is decrypted once.
 * Ciphertexts are unique per encryption, so an entry can't go stale for a changed value.
 *
 * A failed decrypt (eg. the workspace key isn't entered yet) is remembered per key state only, so
 * remounts don't hammer the backend, but entering or changing the key retries it.
 */
const variableNames = new Map<string, string | null>();
const failedForKey = new Map<string, string>();
const inflight = new Map<string, Promise<void>>();

/** The variable name, null when it isn't a single variable reference, undefined when unknown. */
export function getEncryptedVariableName(template: string): string | null | undefined {
  return variableNames.get(template);
}

export function rememberEncryptedVariableName(template: string, name: string) {
  variableNames.set(template, name);
  failedForKey.delete(template);
}

/**
 * Decrypt once and record what it refers to. `keyMarker` identifies the current workspace key
 * state (see {@link encryptionKeyMarker}); a previous failure is only retried when it changes.
 */
export function resolveEncryptedVariableName(template: string, keyMarker: string): Promise<void> {
  if (variableNames.has(template)) return Promise.resolve();
  if (failedForKey.get(template) === keyMarker) return Promise.resolve();
  const pending = inflight.get(template);
  if (pending != null) return pending;

  const promise = convertTemplateToInsecure(template)
    .then(
      (plaintext) => {
        variableNames.set(template, getPureVariableName(plaintext));
        failedForKey.delete(template);
      },
      () => {
        failedForKey.set(template, keyMarker);
      },
    )
    .finally(() => inflight.delete(template));
  inflight.set(template, promise);
  return promise;
}

/** A short fingerprint of the workspace key state, so the key itself isn't kept as a cache key. */
export function encryptionKeyMarker(
  encryptionKey: { encryptedKey: string } | null | undefined,
): string {
  if (encryptionKey == null) return "none";
  const value = encryptionKey.encryptedKey;
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  }
  return `${value.length}:${hash}`;
}
