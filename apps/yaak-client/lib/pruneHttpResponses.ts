import type { HttpResponse } from "@yaakapp-internal/models";

export function pickHttpResponseToKeep(
  responses: HttpResponse[],
  pinnedId: string | null,
): HttpResponse | null {
  if (responses.length === 0) return null;

  const inFlight = responses.filter((r) => r.state !== "closed");
  if (inFlight[0] != null) return inFlight[0];

  if (pinnedId != null) {
    const pinned = responses.find((r) => r.id === pinnedId);
    if (pinned != null) return pinned;
  }

  return responses[0] ?? null;
}

export function collectHttpResponseKeepIds(
  responses: HttpResponse[],
  getPinnedId: (latestResponseId: string) => string | null,
): { keepIds: string[]; deleteCount: number } {
  const byRequest = new Map<string, HttpResponse[]>();
  for (const response of responses) {
    const group = byRequest.get(response.requestId);
    if (group == null) {
      byRequest.set(response.requestId, [response]);
    } else {
      group.push(response);
    }
  }

  const keepIds: string[] = [];
  let deleteCount = 0;
  for (const group of byRequest.values()) {
    const latestId = group[0]?.id;
    const pinnedId = latestId == null ? null : getPinnedId(latestId);
    const keep = pickHttpResponseToKeep(group, pinnedId);
    if (keep == null) continue;
    keepIds.push(keep.id);
    deleteCount += group.filter((r) => r.state === "closed" && r.id !== keep.id).length;
  }

  return { keepIds, deleteCount };
}
