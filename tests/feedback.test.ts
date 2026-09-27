import { describe, expect, it, vi } from "vitest";
import { AgentWorkplace } from "../src/client.js";

const id = "b151a1e9-7734-4fee-83e1-5d64beb2de8c";
const receipt = {
  feedbackId: "294635a1-62a6-44bb-a232-fac34176a310",
  submissionId: id,
  state: "received",
  receivedAt: "2026-09-26T00:00:00.000Z",
};

describe("feedback SDK", () => {
  it.each([{ apiKey: "private-key" }, { humanSession: true as const }])(
    "submits with explicit %j authority and parses a stored receipt",
    async (authorization) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(Response.json(receipt, { status: 201 }));
      const client = new AgentWorkplace({
        baseUrl: "https://api.example.test",
        fetch,
      });
      await expect(
        client.submitFeedback(authorization, {
          submissionId: id,
          message: "Bug",
          category: "bug",
        }),
      ).resolves.toEqual(receipt);
      const [url, init] = fetch.mock.calls[0]!;
      expect(String(url)).toBe("https://api.example.test/v1/feedback");
      expect(init).toMatchObject({ method: "POST", redirect: "error" });
      expect(JSON.parse(String(init!.body))).toEqual({
        submissionId: id,
        message: "Bug",
        category: "bug",
      });
      expect(new Headers(init!.headers).get("Authorization")).toBe(
        "apiKey" in authorization ? "Bearer private-key" : null,
      );
      expect(init!.credentials).toBe(
        "apiKey" in authorization ? undefined : "include",
      );
    },
  );

  it("rejects malformed submissions before dispatch and malformed receipts after dispatch", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ ...receipt, state: "reviewed" }));
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.test",
      fetch,
    });
    expect(() =>
      client.submitFeedback(
        { apiKey: "key" },
        { submissionId: "bad", message: "Bug" },
      ),
    ).toThrow(TypeError);
    expect(fetch).not.toHaveBeenCalled();
    await expect(
      client.submitFeedback(
        { apiKey: "key" },
        { submissionId: id, message: "Bug" },
      ),
    ).rejects.toMatchObject({ status: 200 });
  });
});
