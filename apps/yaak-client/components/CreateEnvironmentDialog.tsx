import { createWorkspaceModel } from "@yaakapp-internal/models";
import { useId, useState } from "react";
import { useTranslation } from "@yaakapp-internal/i18n";
import { useToggle } from "../hooks/useToggle";
import { ColorIndicator } from "./ColorIndicator";
import { Checkbox } from "./core/Checkbox";
import { ColorPickerWithThemeColors } from "./core/ColorPicker";
import { DialogFooter } from "./core/Dialog";
import { Label } from "./core/Label";
import { PlainInput } from "./core/PlainInput";

interface Props {
  onCreate: (id: string) => void;
  hide: () => void;
  workspaceId: string;
}

export function CreateEnvironmentDialog({ workspaceId, hide, onCreate }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState<string>("");
  const [color, setColor] = useState<string | null>(null);
  const [sharable, toggleSharable] = useToggle(false);
  const formId = useId();
  return (
    <form
      id={formId}
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const id = await createWorkspaceModel({
          model: "environment",
          name,
          color,
          variables: [],
          public: sharable,
          workspaceId,
          parentModel: "environment",
        });
        hide();
        onCreate(id);
      }}
    >
      <PlainInput
        label={t("environment.name")}
        required
        defaultValue={name}
        onChange={setName}
        placeholder={t("environment.namePlaceholder")}
      />
      <Checkbox
        checked={sharable}
        title={t("environment.share")}
        help={t("environment.shareHelp")}
        onChange={toggleSharable}
      />
      <div>
        <Label htmlFor="color" className="mb-1.5" help={t("environment.colorHelp")}>
          {t("environment.color")}
        </Label>
        <ColorPickerWithThemeColors onChange={setColor} color={color} />
      </div>
      <DialogFooter
        inline
        actions={[
          {
            label: t("environment.create"),
            color: "secondary",
            form: formId,
            leftSlot: color != null ? <ColorIndicator color={color} /> : undefined,
          },
        ]}
      />
    </form>
  );
}
