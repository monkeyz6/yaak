import { parseTemplate } from "@yaakapp-internal/templates";

/** The one secret field the sidebar chip switches. Unknown types have no chip. */
const AUTH_SECRET_FIELD: Record<string, string> = {
  bearer: "token",
  apikey: "value",
  basic: "password",
  digest: "password",
  windows: "password",
  jwt: "secret",
  oauth2: "clientSecret",
  awsv4: "secretAccessKey",
  oauth1: "consumerSecret",
};

export function getAuthSecretField(authenticationType: string | null): string | null {
  if (authenticationType == null) return null;
  return AUTH_SECRET_FIELD[authenticationType] ?? null;
}

/** A template that is exactly one variable tag, with nothing else around it. */
export function getPureVariableName(template: unknown): string | null {
  if (typeof template !== "string" || template === "") return null;
  try {
    const tokens = parseTemplate(template).tokens.filter((token) => token.type !== "eof");
    const token = tokens.length === 1 ? tokens[0] : null;
    if (token == null || token.type !== "tag" || token.val.type !== "var") return null;
    return token.val.name === "" ? null : token.val.name;
  } catch {
    return null;
  }
}

/** A template that is exactly one `secure(...)` call, ie. an encrypted value. */
export function isSecureTemplate(template: unknown): template is string {
  if (typeof template !== "string" || template === "") return false;
  try {
    const tokens = parseTemplate(template).tokens.filter((token) => token.type !== "eof");
    const token = tokens.length === 1 ? tokens[0] : null;
    return token?.type === "tag" && token.val.type === "fn" && token.val.name === "secure";
  } catch {
    return false;
  }
}

/** The canonical tag text for a variable reference. */
export function variableTag(name: string): string {
  return `\${[ ${name} ]}`;
}

/**
 * What the chip switches on a folder. A plain reference gives its variable name directly. An
 * encrypted value gives the ciphertext; the caller decrypts it and only shows a chip when the
 * plaintext turns out to be a single variable reference.
 */
export type FolderAuthSwitchSource =
  | { field: string; variableName: string; encryptedTemplate: null }
  | { field: string; variableName: null; encryptedTemplate: string };

export function getFolderAuthSwitchSource(folder: {
  authenticationType: string | null;
  authentication: Record<string, unknown> | null;
}): FolderAuthSwitchSource | null {
  const field = getAuthSecretField(folder.authenticationType);
  if (field == null || folder.authentication == null) return null;
  const raw = folder.authentication[field];
  const variableName = getPureVariableName(raw);
  if (variableName != null) return { field, variableName, encryptedTemplate: null };
  if (isSecureTemplate(raw)) return { field, variableName: null, encryptedTemplate: raw };
  return null;
}

export function withAuthField(
  auth: Record<string, unknown>,
  field: string,
  value: string,
): Record<string, unknown> {
  return { ...auth, [field]: value };
}

type NamedVariable = { enabled?: boolean; name: string };

type FolderRef = { id: string; folderId: string | null };

type EnvironmentRef = {
  parentModel: string;
  parentId: string | null;
  variables: NamedVariable[];
};

/** Enabled variable names visible to a folder: own env, ancestors, active env, then base. */
export function collectFolderVisibleVariableNames(args: {
  folderId: string;
  folders: FolderRef[];
  environments: EnvironmentRef[];
  activeEnvironment: { variables: NamedVariable[] } | null;
  baseEnvironment: { variables: NamedVariable[] } | null;
}): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const folderId of folderChain(args.folders, args.folderId)) {
    const environment = args.environments.find(
      (item) => item.parentModel === "folder" && item.parentId === folderId,
    );
    pushVariableNames(names, seen, environment?.variables);
  }
  pushVariableNames(names, seen, args.activeEnvironment?.variables);
  pushVariableNames(names, seen, args.baseEnvironment?.variables);
  return names;
}

function folderChain(folders: FolderRef[], folderId: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  let current: string | null = folderId;
  while (current != null && !seen.has(current)) {
    seen.add(current);
    ids.push(current);
    current = folders.find((folder) => folder.id === current)?.folderId ?? null;
  }
  return ids;
}

function pushVariableNames(
  names: string[],
  seen: Set<string>,
  variables: NamedVariable[] | undefined,
) {
  for (const variable of variables ?? []) {
    if (!variable.enabled || variable.name === "" || seen.has(variable.name)) continue;
    seen.add(variable.name);
    names.push(variable.name);
  }
}
