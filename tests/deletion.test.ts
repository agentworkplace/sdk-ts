import { describe, expect, it, vi } from "vitest";
import { AgentWorkplace } from "../src/client.js";
const proof = "a".repeat(43);
const id = "21e14f1e-f0f1-4e59-8bd5-384bc70ed1c9";
const status = {
  state: "deleting",
  initiatedAt: "2026-09-12T00:00:00.000Z",
  receiptExpiresAt: "2026-10-12T00:00:00.000Z",
};
describe("private deletion transport", () => {
  it("uses native cookies for owner actions and body proof for post-session status", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({
          challengeId: id,
          expiresAt: "2026-09-12T00:10:00.000Z",
        }),
      )
      .mockImplementation(async () => Response.json(status));
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.test",
      fetch,
    });
    await client.requestWorkplaceDeletion(proof);
    await client.confirmWorkplaceDeletion({
      challengeId: id,
      code: "123456",
      receiptProof: proof,
    });
    await client.workplaceDeletionStatus(proof);
    expect(fetch.mock.calls.map((call) => call[1]?.credentials)).toEqual([
      "include",
      "include",
      undefined,
    ]);
    for (const [url, request] of fetch.mock.calls) {
      expect(url.toString()).not.toContain(proof);
      expect(request?.redirect).toBe("error");
      expect(request?.method).toBe("POST");
      expect(new Headers(request?.headers).get("Authorization")).toBeNull();
    }
  });
  it("rejects unsafe origins and private data in receipt responses", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        Response.json({ ...status, email: "private@example.test" }),
      );
    const unsafe = new AgentWorkplace({
      baseUrl: "http://remote.example.test",
      fetch,
    });
    await expect(unsafe.workplaceDeletionStatus(proof)).rejects.toThrow(
      "HTTPS",
    );
    expect(fetch).not.toHaveBeenCalled();
    const safe = new AgentWorkplace({
      baseUrl: "https://api.example.test",
      fetch,
    });
    await expect(safe.workplaceDeletionStatus(proof)).rejects.toThrow(
      "invalid response",
    );
  });
});
