import { i18n } from "@yaakapp-internal/i18n";
import type { BatchUpsertResult } from "@yaakapp-internal/models";
import { FormattedError, VStack } from "@yaakapp-internal/ui";
import { Button } from "../components/core/Button";
import { ImportDataDialog } from "../components/ImportDataDialog";
import { activeWorkspaceAtom } from "../hooks/useActiveWorkspace";
import { createFastMutation } from "../hooks/useFastMutation";
import { showAlert } from "./alert";
import { showDialog } from "./dialog";
import { jotaiStore } from "./jotai";
import { router } from "./router";
import { invokeCmd } from "./tauri";

export const importData = createFastMutation({
  mutationKey: ["import_data"],
  onError: (err: string) => {
    showAlert({
      id: "import-failed",
      title: i18n.t("importExport.importFailed"),
      size: "md",
      body: <FormattedError>{err}</FormattedError>,
    });
  },
  mutationFn: async () => {
    return new Promise<void>((resolve, reject) => {
      showDialog({
        id: "import",
        title: i18n.t("mainMenu.importData"),
        size: "sm",
        render: ({ hide }) => {
          const importAndHide = async (filePath: string) => {
            try {
              const didImport = await performImport(filePath);
              if (!didImport) {
                return;
              }
              resolve();
            } catch (err) {
              reject(err);
            } finally {
              hide();
            }
          };
          return <ImportDataDialog importData={importAndHide} />;
        },
      });
    });
  },
});

function importedCountLabel(oneKey: string, manyKey: string, count: number): string {
  return count === 1 ? i18n.t(oneKey, { count }) : i18n.t(manyKey, { count });
}

async function performImport(filePath: string): Promise<boolean> {
  const activeWorkspace = jotaiStore.get(activeWorkspaceAtom);
  const imported = await invokeCmd<BatchUpsertResult>("cmd_import_data", {
    filePath,
    workspaceId: activeWorkspace?.id,
  });

  const importedWorkspace = imported.workspaces[0];

  showDialog({
    id: "import-complete",
    title: i18n.t("importExport.importComplete"),
    size: "sm",
    hideX: true,
    render: ({ hide }) => {
      return (
        <VStack space={3} className="pb-4">
          <ul className="list-disc pl-6">
            {imported.workspaces.length > 0 && (
              <li>
                {importedCountLabel(
                  "importExport.workspaceOne",
                  "importExport.workspaceMany",
                  imported.workspaces.length,
                )}
              </li>
            )}
            {imported.environments.length > 0 && (
              <li>
                {importedCountLabel(
                  "importExport.environmentOne",
                  "importExport.environmentMany",
                  imported.environments.length,
                )}
              </li>
            )}
            {imported.folders.length > 0 && (
              <li>
                {importedCountLabel(
                  "importExport.folderOne",
                  "importExport.folderMany",
                  imported.folders.length,
                )}
              </li>
            )}
            {imported.httpRequests.length > 0 && (
              <li>
                {importedCountLabel(
                  "importExport.httpRequestOne",
                  "importExport.httpRequestMany",
                  imported.httpRequests.length,
                )}
              </li>
            )}
            {imported.grpcRequests.length > 0 && (
              <li>
                {importedCountLabel(
                  "importExport.grpcRequestOne",
                  "importExport.grpcRequestMany",
                  imported.grpcRequests.length,
                )}
              </li>
            )}
            {imported.websocketRequests.length > 0 && (
              <li>
                {importedCountLabel(
                  "importExport.websocketRequestOne",
                  "importExport.websocketRequestMany",
                  imported.websocketRequests.length,
                )}
              </li>
            )}
          </ul>
          <div>
            <Button className="ml-auto" onClick={hide} color="primary">
              {i18n.t("common.done")}
            </Button>
          </div>
        </VStack>
      );
    },
  });

  if (importedWorkspace != null) {
    const environmentId = imported.environments[0]?.id ?? null;
    await router.navigate({
      to: "/workspaces/$workspaceId",
      params: { workspaceId: importedWorkspace.id },
      search: { environment_id: environmentId },
    });
  }

  return true;
}
