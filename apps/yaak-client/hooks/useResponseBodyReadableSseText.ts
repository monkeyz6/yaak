import { useQuery } from "@tanstack/react-query";
import type { HttpResponse } from "@yaakapp-internal/models";
import type { SseSummary, SseTextMode } from "@yaakapp-internal/sse";
import { getResponseBodyReadableSseText } from "../lib/responseBody";

export function useResponseBodyReadableSseText(
  response: HttpResponse,
  mode: SseTextMode | "off",
  customJsonPath: string,
) {
  return useQuery<SseSummary>({
    enabled: mode !== "off",
    placeholderData: (previous) => previous,
    queryKey: [
      "response-body-readable-sse-text",
      response.id,
      response.updatedAt,
      response.contentLength,
      mode,
      customJsonPath,
    ],
    queryFn: () =>
      getResponseBodyReadableSseText(response, mode === "off" ? "auto" : mode, customJsonPath),
  });
}
