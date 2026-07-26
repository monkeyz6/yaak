import type { Extension } from "@codemirror/state";
import { hoverTooltip } from "@codemirror/view";
import { i18n } from "@yaakapp-internal/i18n";
import type { JsonPathAtPosition } from "../../../../lib/responseJsonPath";
import { jsonPathAtPosition } from "../../../../lib/responseJsonPath";

const MAX_PATH_PREVIEW = 50;

/**
 * Hover tooltip for JSON response bodies that offers to extract the hovered value
 * into a post-response action.
 */
export function postActionExtractor(onPick: (result: JsonPathAtPosition) => void): Extension {
  return hoverTooltip(
    (view, pos) => {
      const result = jsonPathAtPosition(view.state, pos);
      if (result == null) return null;

      return {
        pos,
        above: true,
        create() {
          const dom = document.createElement("div");
          const $extract = document.createElement("button");
          const path =
            result.path.length > MAX_PATH_PREVIEW
              ? `${result.path.slice(0, MAX_PATH_PREVIEW)}…`
              : result.path;
          $extract.textContent = `${i18n.t("postResponse.extractValue")} · ${path}`;
          $extract.addEventListener("click", () => onPick(result));
          dom.appendChild($extract);
          return { dom };
        },
      };
    },
    { hoverTime: 300 },
  );
}
