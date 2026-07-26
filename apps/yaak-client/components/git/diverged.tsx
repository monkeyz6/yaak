import type { DivergedStrategy } from "@yaakapp-internal/git";
import { Trans, i18n, useTranslation } from "@yaakapp-internal/i18n";
import { HStack, InlineCode } from "@yaakapp-internal/ui";
import { useState } from "react";
import { showDialog } from "../../lib/dialog";
import { Button } from "../core/Button";
import { RadioCards } from "../core/RadioCards";

type Resolution = "force_reset" | "merge";

interface DivergedDialogProps {
  remote: string;
  branch: string;
  onResult: (strategy: DivergedStrategy) => void;
  onHide: () => void;
}

function DivergedDialog({ remote, branch, onResult, onHide }: DivergedDialogProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Resolution | null>(null);

  const resolutionLabel: Record<Resolution, string> = {
    force_reset: t("git.forcePull"),
    merge: t("git.merge"),
  };

  const handleSubmit = () => {
    if (selected == null) return;
    onResult(selected);
    onHide();
  };

  const handleCancel = () => {
    onResult("cancel");
    onHide();
  };

  return (
    <div className="flex flex-col gap-4 mb-4">
      <p className="text-text-subtle">
        <Trans
          i18nKey="git.divergedPrompt"
          values={{ ref: `${remote}/${branch}` }}
          components={{ 1: <InlineCode /> }}
        />
      </p>
      <RadioCards
        name="diverged-strategy"
        value={selected}
        onChange={setSelected}
        options={[
          {
            value: "merge",
            label: t("git.mergeCommit"),
            description: t("git.mergeCommitDescription"),
          },
          {
            value: "force_reset",
            label: t("git.forcePull"),
            description: t("git.forcePullDescription"),
          },
        ]}
      />
      <HStack space={2} justifyContent="start" className="flex-row-reverse">
        <Button
          color={selected === "force_reset" ? "danger" : "primary"}
          disabled={selected == null}
          onClick={handleSubmit}
        >
          {selected != null ? resolutionLabel[selected] : t("common.selectOption")}
        </Button>
        <Button variant="border" onClick={handleCancel}>
          {t("common.cancel")}
        </Button>
      </HStack>
    </div>
  );
}

export async function promptDivergedStrategy({
  remote,
  branch,
}: {
  remote: string;
  branch: string;
}): Promise<DivergedStrategy> {
  return new Promise((resolve) => {
    showDialog({
      id: "git-diverged",
      title: i18n.t("git.branchesDiverged"),
      hideX: true,
      size: "sm",
      disableBackdropClose: true,
      onClose: () => resolve("cancel"),
      render: ({ hide }) =>
        DivergedDialog({
          remote,
          branch,
          onHide: hide,
          onResult: resolve,
        }),
    });
  });
}
