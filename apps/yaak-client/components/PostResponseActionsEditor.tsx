import { useTranslation } from "@yaakapp-internal/i18n";
import type { HttpRequest, PostResponseAction } from "@yaakapp-internal/models";
import { patchModel } from "@yaakapp-internal/models";
import { HStack, Icon, VStack } from "@yaakapp-internal/ui";
import classNames from "classnames";
import { useAtom } from "jotai";
import { useCallback, useEffect } from "react";
import { generateId } from "../lib/generateId";
import { recentlyAddedPostActionIdAtom } from "../lib/postActionHighlight";
import { Button } from "./core/Button";
import { Checkbox } from "./core/Checkbox";
import { IconButton } from "./core/IconButton";
import { Input } from "./core/Input";

interface Props {
  request: HttpRequest;
}

const VARIABLE_NAME_PATTERN = /^[a-z_][a-z0-9_.-]*$/i;

export function PostResponseActionsEditor({ request }: Props) {
  const { t } = useTranslation();
  const actions = request.postResponseActions;
  const [recentlyAddedId, setRecentlyAddedId] = useAtom(recentlyAddedPostActionIdAtom);

  useEffect(() => {
    if (recentlyAddedId == null) return;
    const timeout = setTimeout(() => setRecentlyAddedId(null), 2500);
    return () => clearTimeout(timeout);
  }, [recentlyAddedId, setRecentlyAddedId]);
  const updateActions = useCallback(
    (postResponseActions: PostResponseAction[]) => patchModel(request, { postResponseActions }),
    [request],
  );

  const updateAction = useCallback(
    (index: number, patch: Partial<PostResponseAction>) => {
      const next = actions.map((action, actionIndex) =>
        actionIndex === index ? { ...action, ...patch } : action,
      );
      return updateActions(next);
    },
    [actions, updateActions],
  );

  const moveAction = useCallback(
    (index: number, offset: -1 | 1) => {
      const target = index + offset;
      if (target < 0 || target >= actions.length) return;
      const next = [...actions];
      const currentAction = next[index];
      const targetAction = next[target];
      if (currentAction == null || targetAction == null) return;
      next[index] = targetAction;
      next[target] = currentAction;
      return updateActions(next);
    },
    [actions, updateActions],
  );

  return (
    <VStack space={2} className="h-full min-h-0 py-1 pr-1">
      <div className="shrink-0">
        <Button
          size="sm"
          variant="border"
          leftSlot={<Icon icon="plus" />}
          onClick={() =>
            updateActions([
              ...actions,
              {
                id: generateId(),
                enabled: true,
                type: "set_environment_variable",
                jsonPath: "$.data.token",
                variableName: "ACCESS_TOKEN",
              },
            ])
          }
        >
          {t("postResponse.add")}
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {actions.length === 0 ? (
          <div className="h-full min-h-32 flex flex-col items-center justify-center gap-3 text-text-subtle">
            <Icon icon="variable" size="lg" />
            <span>{t("postResponse.empty")}</span>
          </div>
        ) : (
          <VStack space={2}>
            {actions.map((action, index) => (
              <div
                key={action.id ?? String(index)}
                className={classNames(
                  "grid grid-cols-[auto_minmax(10rem,0.7fr)_minmax(14rem,1fr)_auto] gap-2 items-end border-b border-border-subtle pb-2",
                  action.id != null &&
                    action.id === recentlyAddedId &&
                    "rounded ring-1 ring-primary transition-shadow",
                )}
              >
                <Checkbox
                  hideLabel
                  title={t("postResponse.enable")}
                  checked={action.enabled !== false}
                  onChange={(enabled) => updateAction(index, { enabled })}
                />
                <Input
                  label={t("postResponse.variable")}
                  defaultValue={action.variableName}
                  forceUpdateKey={`${action.id}:variable`}
                  placeholder="ACCESS_TOKEN"
                  stateKey={`post-action-variable.${request.id}.${action.id}`}
                  validate={(value) => VARIABLE_NAME_PATTERN.test(value)}
                  onChange={(variableName) => updateAction(index, { variableName })}
                />
                <Input
                  label={t("postResponse.jsonPath")}
                  defaultValue={action.jsonPath}
                  forceUpdateKey={`${action.id}:jsonpath`}
                  placeholder="$.data.token"
                  stateKey={`post-action-jsonpath.${request.id}.${action.id}`}
                  validate={(value) => value.trim().startsWith("$")}
                  onChange={(jsonPath) => updateAction(index, { jsonPath })}
                />
                <HStack space={0.5} className="pb-0.5">
                  <IconButton
                    icon={action.secure ? "lock" : "lock_open"}
                    title={t(action.secure ? "postResponse.secureOn" : "postResponse.secureOff")}
                    className={classNames(action.secure && "text-primary")}
                    onClick={() => updateAction(index, { secure: !action.secure })}
                  />
                  <IconButton
                    icon="arrow_up"
                    title={t("postResponse.moveUp")}
                    disabled={index === 0}
                    onClick={() => moveAction(index, -1)}
                  />
                  <IconButton
                    icon="arrow_down"
                    title={t("postResponse.moveDown")}
                    disabled={index === actions.length - 1}
                    onClick={() => moveAction(index, 1)}
                  />
                  <IconButton
                    icon="trash"
                    title={t("postResponse.remove")}
                    color="danger"
                    onClick={() =>
                      updateActions(actions.filter((_, actionIndex) => actionIndex !== index))
                    }
                  />
                </HStack>
              </div>
            ))}
          </VStack>
        )}
      </div>
    </VStack>
  );
}
