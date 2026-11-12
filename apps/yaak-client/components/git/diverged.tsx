import type { DivergedStrategy } from "@yaakapp-internal/git";
import { InlineCode } from "@yaakapp-internal/ui";
import { Trans, i18n, useTranslation } from "@yaakapp-internal/i18n";
import { useState } from "react";
import { showDialog } from "../../lib/dialog";
import { DialogFooter } from "../core/Dialog";
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
    <div className="flex flex-col gap-4">
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
      <DialogFooter
        inline
        actions={[
          { label: t("common.cancel"), onClick: handleCancel },
          {
            label: selected != null ? resolutionLabel[selected] : t("common.selectOption"),
            color: selected === "force_reset" ? "danger" : "primary",
            disabled: selected == null,
            onClick: handleSubmit,
          },
        ]}
      />
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
      size: "sm",
      disableClose: true,
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
