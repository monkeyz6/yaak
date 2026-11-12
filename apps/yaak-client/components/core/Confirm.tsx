import type { Color } from "@yaakapp-internal/plugins";
import { useTranslation } from "@yaakapp-internal/i18n";
import type { FormEvent } from "react";
import { useId, useState } from "react";
import { CopyIconButton } from "../CopyIconButton";
import { DialogFooter } from "./Dialog";
import { PlainInput } from "./PlainInput";

export interface ConfirmProps {
  onHide: () => void;
  onResult: (result: boolean) => void;
  confirmText?: string;
  requireTyping?: string;
  color?: Color;
}

export function Confirm({
  onHide,
  onResult,
  confirmText,
  requireTyping,
  color = "primary",
}: ConfirmProps) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState<string>("");
  const formId = useId();
  const handleHide = () => {
    onResult(false);
    onHide();
  };

  const didConfirm = !requireTyping || confirm === requireTyping;

  const handleSuccess = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (didConfirm) {
      onResult(true);
      onHide();
    }
  };

  return (
    <form id={formId} className="flex flex-col" onSubmit={handleSuccess}>
      {requireTyping && (
        <PlainInput
          autoFocus
          onChange={setConfirm}
          placeholder={requireTyping}
          labelRightSlot={
            <CopyIconButton
              tabIndex={-1}
              text={requireTyping}
              title={t("deleteModel.copyName")}
              className="text-text-subtlest"
              iconSize="sm"
              size="2xs"
            />
          }
          label={<>{t("deleteModel.typeToConfirm", { name: requireTyping })}</>}
        />
      )}
      <DialogFooter
        inline
        actions={[
          { label: t("common.cancel"), onClick: handleHide },
          {
            label: confirmText ?? t("common.confirm"),
            color,
            form: formId,
            disabled: !didConfirm,
            autoFocus: !requireTyping,
          },
        ]}
      />
    </form>
  );
}
