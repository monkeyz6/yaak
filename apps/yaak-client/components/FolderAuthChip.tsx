import { useTranslation } from "@yaakapp-internal/i18n";
import type { Environment, Folder } from "@yaakapp-internal/models";
import { environmentsAtom, foldersAtom, patchModel } from "@yaakapp-internal/models";
import { Icon } from "@yaakapp-internal/ui";
import classNames from "classnames";
import { atom, useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";
import { useEffect, useMemo, useReducer, useState } from "react";
import { openFolderSettings } from "../commands/openFolderSettings";
import { activeEnvironmentIdAtom } from "../hooks/useActiveEnvironment";
import { activeWorkspaceMetaAtom } from "../hooks/useActiveWorkspace";
import { convertTemplateToSecure } from "../lib/encryption";
import {
  collectFolderVisibleVariableNames,
  getFolderAuthSwitchSource,
  variableTag,
  withAuthField,
} from "../lib/folderAuthSwitch";
import { jotaiStore } from "../lib/jotai";
import {
  encryptionKeyMarker,
  getEncryptedVariableName,
  rememberEncryptedVariableName,
  resolveEncryptedVariableName,
} from "../lib/secureTemplateCache";
import { showErrorToast, showToast } from "../lib/toast";
import { Button } from "./core/Button";
import type { DropdownItem } from "./core/Dropdown";
import { Dropdown } from "./core/Dropdown";

/** Changes when the workspace key is entered or replaced, so failed decrypts get retried. */
const encryptionKeyMarkerAtom = atom((get) =>
  encryptionKeyMarker(get(activeWorkspaceMetaAtom)?.encryptionKey),
);

/** null until the persisted preference loads, so hidden chips don't flash on at startup. */
export const sidebarFolderAuthChipsVisibleAtom = atom<boolean | null>(null);

type ChipSource = {
  field: string;
  /** Set for a plain `${[ name ]}` reference */
  variableName: string | null;
  /** Set for an encrypted value; the name comes from decrypting it */
  encryptedTemplate: string | null;
  disabled: true | "conditional" | false;
};

type ChipModel = Omit<ChipSource, "variableName"> & { variableName: string };

function readChipSource(folder: Folder | undefined): ChipSource | null {
  if (folder == null) return null;
  const source = getFolderAuthSwitchSource(folder);
  if (source == null) return null;
  const disabled = folder.authentication?.disabled;
  return {
    ...source,
    disabled: disabled === true ? true : typeof disabled === "string" ? "conditional" : false,
  };
}

function sameSource(a: ChipSource | null, b: ChipSource | null): boolean {
  return (
    a?.field === b?.field &&
    a?.variableName === b?.variableName &&
    a?.encryptedTemplate === b?.encryptedTemplate &&
    a?.disabled === b?.disabled
  );
}

export function FolderAuthChip({
  folderId,
  tabbable = true,
}: {
  folderId: string;
  /** False keeps the chip out of the Tab order (it is still clickable). */
  tabbable?: boolean;
}) {
  const { t } = useTranslation();
  const source = useAtomValue(
    useMemo(
      () =>
        selectAtom(
          foldersAtom,
          (folders) => readChipSource(folders.find((folder) => folder.id === folderId)),
          sameSource,
        ),
      [folderId],
    ),
  );
  const [items, setItems] = useState<DropdownItem[]>([]);

  // Encrypted values are decrypted in the background (once per ciphertext, see
  // secureTemplateCache); re-render when the result lands. Retried when the workspace key changes.
  const encryptedTemplate = source?.encryptedTemplate ?? null;
  const keyMarker = useAtomValue(encryptionKeyMarkerAtom);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (encryptedTemplate == null || getEncryptedVariableName(encryptedTemplate) !== undefined) {
      return;
    }
    let alive = true;
    void resolveEncryptedVariableName(encryptedTemplate, keyMarker).then(() => {
      if (alive) rerender();
    });
    return () => {
      alive = false;
    };
  }, [encryptedTemplate, keyMarker]);

  const variableName =
    source == null
      ? null
      : (source.variableName ??
        (encryptedTemplate == null ? null : (getEncryptedVariableName(encryptedTemplate) ?? null)));
  if (source == null || variableName == null) return null;
  const chip: ChipModel = { ...source, variableName };

  const refreshItems = () => setItems(buildItems(folderId, chip, t));
  const title = [
    chip.variableName,
    chip.encryptedTemplate != null && t("folderAuth.encryptedHint"),
    chip.disabled === true && t("folderAuth.authDisabled"),
    chip.disabled === "conditional" && t("folderAuth.authConditional"),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Dropdown
      items={items}
      onOpen={refreshItems}
      filterPlaceholder={t("folderAuth.searchVariables", { field: fieldLabel(chip.field, t) })}
    >
      <button
        type="button"
        title={title}
        aria-label={title}
        tabIndex={tabbable ? undefined : -1}
        data-disable-hotkey=""
        className={classNames(
          "group/chip h-5 px-1 rounded border border-transparent outline-hidden",
          "inline-flex items-center gap-0.5 min-w-0 max-w-36",
          "text-2xs text-text-subtlest",
          // Quiet until the sidebar row is hovered or selected (or the chip has focus).
          // NOTE: Written out in full so Tailwind's scanner picks the classes up.
          "[.tree-item:hover_&]:border-border-subtle [.tree-item:hover_&]:text-text-subtle",
          "[.tree-item.selected_&]:border-border-subtle [.tree-item.selected_&]:text-text-subtle",
          // The row loses :hover once the mouse moves into the menu; stay active while it's open
          "aria-expanded:border-border-subtle aria-expanded:text-text aria-expanded:bg-surface-highlight",
          "hover:text-text! hover:bg-surface-highlight focus-visible:border-border-focus!",
          chip.disabled === true && "opacity-50",
        )}
        onPointerDown={(event) => {
          event.stopPropagation();
          refreshItems();
        }}
        // Enter/Space open the menu through a click, which has no pointerdown; fill the items
        // first so the menu doesn't open empty ("No matches") for a frame.
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") refreshItems();
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <span
          className={classNames(
            "relative inline-flex shrink-0",
            chip.disabled === true &&
              "after:absolute after:inset-x-0 after:top-1/2 after:h-px after:bg-current",
          )}
        >
          <Icon icon="key_round" size="xs" />
        </span>
        {/* Narrow sidebar: key icon only, so folder names keep their room. Name is in the tooltip. */}
        <span className="hidden @min-[15rem]/sidebar:inline truncate font-mono">
          {chip.variableName}
        </span>
        <Icon
          icon="chevron_down"
          size="xs"
          className={classNames(
            "shrink-0 text-text-subtlest hidden group-focus-visible/chip:inline-block",
            "group-aria-expanded/chip:inline-block",
            "[.tree-item:hover_&]:inline-block [.tree-item.selected_&]:inline-block",
          )}
        />
      </button>
    </Dropdown>
  );
}

function buildItems(
  folderId: string,
  chip: ChipModel,
  t: (key: string, options?: Record<string, unknown>) => string,
): DropdownItem[] {
  const folder = jotaiStore.get(foldersAtom).find((item) => item.id === folderId);
  if (folder == null) return [];
  const workspaceId = folder.workspaceId;
  const visible = collectFolderVisibleVariableNames({
    folderId,
    folders: jotaiStore.get(foldersAtom),
    environments: jotaiStore.get(environmentsAtom),
    activeEnvironment: activeEnvironment(workspaceId),
    baseEnvironment: baseEnvironment(workspaceId),
  });

  // Just the variable names, alphabetically. The current one is listed even if it doesn't
  // resolve from this folder, so the ✓ always shows.
  const names = [...new Set([chip.variableName, ...visible])].sort((a, b) => a.localeCompare(b));

  return [
    ...names.map((name): DropdownItem => ({
      label: name,
      leftSlot: name === chip.variableName ? <Icon icon="check" /> : <Icon icon="empty" />,
      onSelect: () => switchVariable(folderId, chip.field, name, chip.variableName, t),
    })),
    {
      label: t("folderAuth.openAuthSettings"),
      leftSlot: <Icon icon="settings" />,
      onSelect: () => openFolderSettings(folderId, "auth"),
    },
  ];
}

function fieldLabel(
  field: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  switch (field) {
    case "token":
      return t("folderAuth.fields.token");
    case "value":
      return t("folderAuth.fields.value");
    case "password":
      return t("folderAuth.fields.password");
    case "secret":
      return t("folderAuth.fields.secret");
    case "clientSecret":
      return t("folderAuth.fields.clientSecret");
    case "secretAccessKey":
      return t("folderAuth.fields.secretAccessKey");
    case "consumerSecret":
      return t("folderAuth.fields.consumerSecret");
    default:
      return field;
  }
}

async function switchVariable(
  folderId: string,
  field: string,
  name: string,
  currentName: string,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (name === currentName) return;
  const folder = jotaiStore.get(foldersAtom).find((item) => item.id === folderId);
  if (folder == null) return;
  const source = getFolderAuthSwitchSource(folder);
  if (source == null || source.field !== field) return;
  const before = folder.authentication[field];

  // Keep the user's choice: an encrypted reference is written back encrypted.
  const plainTag = variableTag(name);
  let nextValue = plainTag;
  if (source.encryptedTemplate != null) {
    try {
      nextValue = await convertTemplateToSecure(plainTag);
      // Seed the cache so the chip shows the new name without another decrypt round-trip
      rememberEncryptedVariableName(nextValue, name);
    } catch (err) {
      showErrorToast({
        id: `folder-auth-switch-error::${folderId}`,
        title: t("folderAuth.encryptFailed"),
        message: err,
      });
      return;
    }
  }

  // Re-read after the await so a concurrent edit to another auth field isn't overwritten. If the
  // secret field itself changed meanwhile (eg. a second, quicker switch), that newer value wins.
  const latest = jotaiStore.get(foldersAtom).find((item) => item.id === folderId);
  if (latest == null || latest.authentication?.[field] !== before) return;
  await patchModel(latest, {
    authentication: withAuthField(latest.authentication, field, nextValue),
  });
  showToast({
    id: `folder-auth-switch::${folderId}`,
    timeout: 5000,
    message: t("folderAuth.switched", { folder: folder.name, variable: name }),
    action: ({ hide }) => (
      <Button
        size="xs"
        variant="border"
        onClick={async () => {
          // Only undo if the field still holds what we wrote; restore just that field
          const fresh = jotaiStore.get(foldersAtom).find((item) => item.id === folderId);
          if (fresh != null && fresh.authentication?.[field] === nextValue) {
            await patchModel(fresh, {
              authentication: { ...fresh.authentication, [field]: before },
            });
          }
          hide();
        }}
      >
        {t("common.undo")}
      </Button>
    ),
  });
}

function activeEnvironment(workspaceId: string): Environment | null {
  const activeId = jotaiStore.get(activeEnvironmentIdAtom);
  return (
    jotaiStore
      .get(environmentsAtom)
      .find(
        (environment) => environment.workspaceId === workspaceId && environment.id === activeId,
      ) ?? null
  );
}

function baseEnvironment(workspaceId: string): Environment | null {
  return (
    jotaiStore
      .get(environmentsAtom)
      .find(
        (environment) =>
          environment.workspaceId === workspaceId && environment.parentModel === "workspace",
      ) ?? null
  );
}
