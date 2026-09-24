import { describe, expect, it, vi } from "vitest";
import { AgentWorkplace } from "../src/client.js";
const accountId = "9ea2537a-ea98-4322-8c1b-c43458937c47";
const id = "5fd2a353-c80e-41ea-89f8-29a12bcbd786";
const operationId = "45cd98f5-fb56-4fc1-922b-c3ee80c6168e";
describe("credential HTTP transport", () => {
  it("preserves canonical human, departed and explicit email-like names without deriving labels", async () => {
    const participants = [
      {
        id: accountId,
        name: "Human",
        kind: "human",
        role: "member",
        state: "active",
        departureKind: null,
        departedAt: null,
      },
      {
        id,
        name: "Human",
        kind: "human",
        role: "member",
        state: "removed",
        departureKind: "departed",
        departedAt: "2026-09-13T00:00:00Z",
      },
      {
        id: operationId,
        name: "Chosen <public@example.test>",
        kind: "human",
        role: "member",
        state: "active",
        departureKind: null,
        departedAt: null,
      },
    ];
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ participants }));
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.test",
      fetch,
    });
    expect(await client.listParticipants({ apiKey: "test-key" })).toEqual({
      participants,
    });
    expect(fetch.mock.calls[0]![0].toString()).toBe(
      "https://api.example.test/v1/accounts",
    );
    fetch.mockResolvedValue(
      Response.json({
        participants: [
          { ...participants[0], loginEmail: "private@example.test" },
        ],
      }),
    );
    await expect(
      client.listParticipants({ apiKey: "test-key" }),
    ).rejects.toThrow("invalid response");
  });
  it("uses explicit agent authentication for management and saved-candidate authentication for completion", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ id, key: "new-secret" }))
      .mockResolvedValueOnce(Response.json({ renamed: true }))
      .mockResolvedValueOnce(Response.json({ revoked: true }))
      .mockResolvedValueOnce(Response.json({ id, key: "recovered-secret" }))
      .mockResolvedValueOnce(
        Response.json({
          id,
          key: "candidate-secret",
          predecessorId: accountId,
          operationId,
        }),
      )
      .mockResolvedValueOnce(Response.json({ completed: true }));
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.test",
      fetch,
    });
    const auth = { apiKey: "old-secret" };
    await client.createAgentKey(auth, accountId, "Work");
    await client.renameAgentKey(auth, accountId, id, "Renamed");
    await client.revokeAgentKey(auth, accountId, id);
    await client.recoverAgentKeys(auth, accountId, "Recovery");
    const candidate = await client.beginKeyRotation(
      "old-secret",
      operationId,
      "Rotation",
    );
    await client.completeKeyRotation(candidate.key, operationId);
    expect(fetch.mock.calls.map((c) => c[1]?.method)).toEqual([
      "POST",
      "PATCH",
      "DELETE",
      "POST",
      "POST",
      "POST",
    ]);
    expect(
      new Headers(fetch.mock.calls[5]![1]!.headers).get("Authorization"),
    ).toBe("Bearer candidate-secret");
    expect(fetch.mock.calls.every((c) => c[1]?.redirect === "error")).toBe(
      true,
    );
    expect(fetch.mock.calls[3]![0].toString()).toBe(
      `https://api.example.test/v1/accounts/${accountId}/keys/recover`,
    );
  });
  it("uses native browser cookies only when explicitly requested and rejects secrets in metadata", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ keys: [] }))
      .mockResolvedValueOnce(
        Response.json({
          keys: [
            {
              id,
              name: "Work",
              enabled: true,
              createdAt: "2026-09-12T00:00:00Z",
              expiresAt: null,
              key: "must-not-leak",
            },
          ],
        }),
      );
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.test",
      fetch,
    });
    expect(
      await client.listAgentKeys({ humanSession: true }, accountId),
    ).toEqual({ keys: [] });
    expect(fetch.mock.calls[0]![1]?.credentials).toBe("include");
    expect(
      new Headers(fetch.mock.calls[0]![1]!.headers).has("Authorization"),
    ).toBe(false);
    await expect(
      client.listAgentKeys({ humanSession: true }, accountId),
    ).rejects.toThrow("invalid response");
  });
  it("never sends keys to non-loopback HTTP for any new operation", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = new AgentWorkplace({
      baseUrl: "http://api.example.test",
      fetch,
    });
    const auth = { apiKey: "secret" };
    for (const result of [
      client.listAgentKeys(auth, accountId),
      client.createAgentKey(auth, accountId, "Work"),
      client.renameAgentKey(auth, accountId, id, "Name"),
      client.revokeAgentKey(auth, accountId, id),
      client.recoverAgentKeys(auth, accountId, "Recovery"),
      client.beginKeyRotation("secret", operationId, "Rotation"),
      client.completeKeyRotation("secret", operationId),
    ])
      await expect(result).rejects.toThrow("require HTTPS");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("lists and removes participants without accepting caller-supplied workplace authority", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ participants: [] }))
      .mockResolvedValueOnce(Response.json({ removed: true, accountId }));
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.test",
      fetch,
    });
    expect(await client.listParticipants({ apiKey: "secret" })).toEqual({
      participants: [],
    });
    expect(
      await client.removeParticipant({ apiKey: "secret" }, accountId),
    ).toEqual({ removed: true, accountId });
    expect(fetch.mock.calls[0]![0].toString()).toBe(
      "https://api.example.test/v1/accounts",
    );
    expect(fetch.mock.calls[1]![0].toString()).toBe(
      `https://api.example.test/v1/accounts/${accountId}`,
    );
    expect(fetch.mock.calls[1]![1]?.method).toBe("DELETE");
  });
});
