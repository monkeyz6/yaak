import type { HttpResponse } from "@yaakapp-internal/models";
import { describe, expect, it } from "vitest";
import { collectHttpResponseKeepIds, pickHttpResponseToKeep } from "./pruneHttpResponses";

function response(
  partial: Pick<HttpResponse, "id" | "requestId" | "state"> & Partial<HttpResponse>,
): HttpResponse {
  return {
    model: "http_response",
    createdAt: "",
    updatedAt: "",
    workspaceId: "ws_1",
    bodyPath: null,
    contentLength: null,
    contentLengthCompressed: null,
    elapsed: 0,
    elapsedHeaders: 0,
    elapsedDns: 0,
    error: null,
    headers: [],
    remoteAddr: null,
    requestContentLength: null,
    requestHeaders: [],
    status: 200,
    statusReason: null,
    url: "https://example.com",
    version: null,
    ...partial,
  };
}

describe("pickHttpResponseToKeep", () => {
  it("returns null for an empty list", () => {
    expect(pickHttpResponseToKeep([], null)).toBeNull();
  });

  it("keeps the latest closed response when nothing is pinned", () => {
    const latest = response({ id: "rs_new", requestId: "rq_1", state: "closed" });
    const older = response({ id: "rs_old", requestId: "rq_1", state: "closed" });
    expect(pickHttpResponseToKeep([latest, older], null)?.id).toBe("rs_new");
  });

  it("keeps a pinned response instead of the latest", () => {
    const latest = response({ id: "rs_new", requestId: "rq_1", state: "closed" });
    const older = response({ id: "rs_old", requestId: "rq_1", state: "closed" });
    expect(pickHttpResponseToKeep([latest, older], "rs_old")?.id).toBe("rs_old");
  });

  it("prefers an in-flight response over a pin", () => {
    const inFlight = response({ id: "rs_live", requestId: "rq_1", state: "connected" });
    const pinned = response({ id: "rs_pin", requestId: "rq_1", state: "closed" });
    expect(pickHttpResponseToKeep([inFlight, pinned], "rs_pin")?.id).toBe("rs_live");
  });
});

describe("collectHttpResponseKeepIds", () => {
  it("keeps one response per request and counts the rest", () => {
    const responses = [
      response({ id: "rs_a2", requestId: "rq_a", state: "closed" }),
      response({ id: "rs_a1", requestId: "rq_a", state: "closed" }),
      response({ id: "rs_b1", requestId: "rq_b", state: "closed" }),
    ];
    const result = collectHttpResponseKeepIds(responses, () => null);
    expect(result.keepIds).toEqual(["rs_a2", "rs_b1"]);
    expect(result.deleteCount).toBe(1);
  });

  it("keeps a pinned response and counts the rest", () => {
    const responses = [
      response({ id: "rs_new", requestId: "rq_a", state: "closed" }),
      response({ id: "rs_old", requestId: "rq_a", state: "closed" }),
    ];
    const result = collectHttpResponseKeepIds(responses, (latestId) =>
      latestId === "rs_new" ? "rs_old" : null,
    );
    expect(result.keepIds).toEqual(["rs_old"]);
    expect(result.deleteCount).toBe(1);
  });

  it("does not count extra in-flight responses as deletable", () => {
    const responses = [
      response({ id: "rs_live_2", requestId: "rq_a", state: "connected" }),
      response({ id: "rs_live_1", requestId: "rq_a", state: "initialized" }),
      response({ id: "rs_old", requestId: "rq_a", state: "closed" }),
    ];
    const result = collectHttpResponseKeepIds(responses, () => null);
    expect(result.keepIds).toEqual(["rs_live_2"]);
    expect(result.deleteCount).toBe(1);
  });
});
