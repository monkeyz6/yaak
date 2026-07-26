import { open } from "@tauri-apps/plugin-dialog";
import { gitClone } from "@yaakapp-internal/git";
import { useTranslation } from "@yaakapp-internal/i18n";
import { Banner, VStack } from "@yaakapp-internal/ui";
import { useState } from "react";
import { openWorkspaceFromSyncDir } from "../commands/openWorkspaceFromSyncDir";
import { appInfo } from "../lib/appInfo";
import { CommercialUseBanner } from "./CommercialUseBanner";
import { showErrorToast } from "../lib/toast";
import { Button } from "./core/Button";
import { Checkbox } from "./core/Checkbox";
import { IconButton } from "./core/IconButton";
import { PlainInput } from "./core/PlainInput";
import { promptCredentials } from "./git/credentials";

interface Props {
  hide: () => void;
}

// Detect path separator from an existing path (defaults to /)
function getPathSeparator(path: string): string {
  return path.includes("\\") ? "\\" : "/";
}

export function CloneGitRepositoryDialog({ hide }: Props) {
  const { t } = useTranslation();
  const [url, setUrl] = useState<string>("");
  const [baseDirectory, setBaseDirectory] = useState<string>(appInfo.defaultProjectDir);
  const [directoryOverride, setDirectoryOverride] = useState<string | null>(null);
  const [hasSubdirectory, setHasSubdirectory] = useState(false);
  const [subdirectory, setSubdirectory] = useState<string>("");
  const [isCloning, setIsCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const repoName = extractRepoName(url);
  const sep = getPathSeparator(baseDirectory);
  const computedDirectory = repoName ? `${baseDirectory}${sep}${repoName}` : baseDirectory;
  const directory = directoryOverride ?? computedDirectory;
  const workspaceDirectory =
    hasSubdirectory && subdirectory ? `${directory}${sep}${subdirectory}` : directory;

  const handleSelectDirectory = async () => {
    const dir = await open({
      title: t("git.selectDirectory"),
      directory: true,
      multiple: false,
    });
    if (dir != null) {
      setBaseDirectory(dir);
      setDirectoryOverride(null);
    }
  };

  const handleClone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url || !directory) return;

    setIsCloning(true);
    setError(null);

    try {
      const result = await gitClone(url, directory, promptCredentials);

      if (result.type === "needs_credentials") {
        setError(result.error ?? t("git.cloneAuthFailed"));
        return;
      }

      // Open the workspace from the cloned directory (or subdirectory)
      await openWorkspaceFromSyncDir.mutateAsync(workspaceDirectory);

      hide();
    } catch (err) {
      setError(String(err));
      showErrorToast({
        id: "git-clone-error",
        title: t("git.cloneFailedTitle"),
        message: String(err),
      });
    } finally {
      setIsCloning(false);
    }
  };

  return (
    <VStack as="form" space={3} alignItems="start" className="pb-3" onSubmit={handleClone}>
      {error && (
        <Banner color="danger" className="w-full">
          {error}
        </Banner>
      )}

      <CommercialUseBanner source="git-clone" title={t("git.usingGitForWork")} />

      <PlainInput
        required
        label={t("git.repositoryUrl")}
        placeholder="https://github.com/user/repo.git"
        defaultValue={url}
        onChange={setUrl}
      />

      <PlainInput
        label={t("git.directory")}
        placeholder={appInfo.defaultProjectDir}
        defaultValue={directory}
        onChange={setDirectoryOverride}
        rightSlot={
          <IconButton
            size="xs"
            className="mr-0.5 h-auto! my-0.5"
            icon="folder"
            title={t("git.browse")}
            onClick={handleSelectDirectory}
          />
        }
      />

      <Checkbox
        checked={hasSubdirectory}
        onChange={setHasSubdirectory}
        title={t("git.workspaceInSubdirectory")}
        help={t("git.workspaceInSubdirectoryHelp")}
      />

      {hasSubdirectory && (
        <PlainInput
          label={t("git.subdirectory")}
          placeholder="path/to/workspace"
          defaultValue={subdirectory}
          onChange={setSubdirectory}
        />
      )}

      <Button
        type="submit"
        color="primary"
        className="w-full mt-3"
        disabled={!url || !directory || isCloning}
        isLoading={isCloning}
      >
        {isCloning ? t("git.cloning") : t("git.cloneRepository")}
      </Button>
    </VStack>
  );
}

function extractRepoName(url: string): string {
  // Handle various Git URL formats:
  // https://github.com/user/repo.git
  // git@github.com:user/repo.git
  // https://github.com/user/repo
  const match = url.match(/\/([^/]+?)(\.git)?$/);
  if (match?.[1]) {
    return match[1];
  }
  // Fallback for SSH-style URLs
  const sshMatch = url.match(/:([^/]+?)(\.git)?$/);
  if (sshMatch?.[1]) {
    return sshMatch[1];
  }
  return "";
}
