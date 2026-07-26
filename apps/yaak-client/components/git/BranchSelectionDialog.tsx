import { useTranslation } from "@yaakapp-internal/i18n";
import { HStack, VStack } from "@yaakapp-internal/ui";
import { useState } from "react";
import { Button } from "../core/Button";
import { Select } from "../core/Select";

interface Props {
  branches: string[];
  onCancel: () => void;
  onSelect: (branch: string) => void;
  selectText: string;
}

export function BranchSelectionDialog({ branches, onCancel, onSelect, selectText }: Props) {
  const { t } = useTranslation();
  const [branch, setBranch] = useState<string>("__NONE__");
  return (
    <VStack
      className="mb-4"
      as="form"
      space={4}
      onSubmit={(e) => {
        e.preventDefault();
        onSelect(branch);
      }}
    >
      <Select
        name="branch"
        hideLabel
        label={t("git.branch")}
        value={branch}
        options={branches.map((b) => ({ label: b, value: b }))}
        onChange={setBranch}
      />
      <HStack space={2} justifyContent="end">
        <Button onClick={onCancel} variant="border" color="secondary">
          {t("common.cancel")}
        </Button>
        <Button type="submit" color="primary">
          {selectText}
        </Button>
      </HStack>
    </VStack>
  );
}
