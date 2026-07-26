import { useGitLog } from "@yaakapp-internal/git";
import { useTranslation } from "@yaakapp-internal/i18n";
import { formatDistanceToNowStrict } from "date-fns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TruncatedWideTableCell,
} from "@yaakapp-internal/ui";

export function HistoryDialog({ dir }: { dir: string }) {
  const { t } = useTranslation();
  const log = useGitLog(dir);

  return (
    <div className="pl-5 pr-1 pb-1">
      <Table scrollable className="px-1">
        <TableHead>
          <TableRow>
            <TableHeaderCell>{t("git.message")}</TableHeaderCell>
            <TableHeaderCell>{t("git.author")}</TableHeaderCell>
            <TableHeaderCell>{t("git.when")}</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {(log.data ?? []).map((l) => (
            <TableRow key={l.oid}>
              <TruncatedWideTableCell>
                {l.message || <em className="text-text-subtle">{t("git.noCommitMessage")}</em>}
              </TruncatedWideTableCell>
              <TableCell>
                <span title={t("git.authorEmail", { email: l.author.email })}>
                  {l.author.name || t("git.unknownAuthor")}
                </span>
              </TableCell>
              <TableCell className="text-text-subtle">
                <span title={l.when}>
                  {t("git.timeAgo", { time: formatDistanceToNowStrict(l.when) })}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
