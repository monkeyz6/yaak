import { useGit } from "@yaakapp-internal/git";
import { i18n, useTranslation } from "@yaakapp-internal/i18n";
import { showDialog } from "../../lib/dialog";
import { Button } from "../core/Button";
import { IconButton } from "../core/IconButton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@yaakapp-internal/ui";
import { useGitCallbacks } from "./callbacks";
import { addGitRemote } from "./showAddRemoteDialog";

interface Props {
  dir: string;
  onDone: () => void;
}

export function GitRemotesDialog({ dir }: Props) {
  const { t } = useTranslation();
  const callbacks = useGitCallbacks(dir);
  const [{ remotes }, { rmRemote }] = useGit(dir, callbacks);

  return (
    <Table scrollable>
      <TableHead>
        <TableRow>
          <TableHeaderCell>{t("git.name")}</TableHeaderCell>
          <TableHeaderCell>URL</TableHeaderCell>
          <TableHeaderCell>
            <Button
              className="text-text-subtle ml-auto"
              size="2xs"
              color="primary"
              title={t("git.addRemote")}
              variant="border"
              onClick={() => addGitRemote(dir)}
            >
              {t("git.addRemote")}
            </Button>
          </TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {remotes.data?.map((r) => (
          <TableRow key={r.name + r.url}>
            <TableCell>{r.name}</TableCell>
            <TableCell>{r.url}</TableCell>
            <TableCell>
              <IconButton
                size="sm"
                className="text-text-subtle ml-auto"
                icon="trash"
                title={t("git.removeRemote")}
                onClick={() => rmRemote.mutate({ name: r.name })}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

GitRemotesDialog.show = (dir: string) => {
  showDialog({
    id: "git-remotes",
    title: i18n.t("git.manageRemotes"),
    size: "md",
    render: ({ hide }) => <GitRemotesDialog onDone={hide} dir={dir} />,
  });
};
