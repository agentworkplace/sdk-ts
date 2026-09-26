import { describe, expect, it, vi } from "vitest";
import {
  AgentWorkplace,
  AgentWorkplaceError,
  parseHumanInvitationFile,
} from "../src/index.js";

const invitation = {
  id: globalThis.crypto.randomUUID(),
  workplaceId: globalThis.crypto.randomUUID(),
  accountId: globalThis.crypto.randomUUID(),
  issuerId: globalThis.crypto.randomUUID(),
  kind: "agent",
  role: "member",
  name: "Second agent",
  state: "pending",
  createdAt: "2026-09-16T00:00:00.000Z",
  expiresAt: "2026-09-23T00:00:00.000Z",
};
const code = "A".repeat(43);
const handoff = {
  invitationId: invitation.id,
  handoffId: globalThis.crypto.randomUUID(),
};
const recovery = {
  ...handoff,
  recoveryProof: "E".repeat(43),
};
const admission = {
  ...handoff,
  workplaceId: invitation.workplaceId,
  accountId: invitation.accountId,
  role: "member",
  mailbox: {
    mailboxId: globalThis.crypto.randomUUID(),
    accountId: invitation.accountId,
    address: "second@example.test",
  },
  recoveryExpiresAt: invitation.expiresAt,
  credential: { id: globalThis.crypto.randomUUID(), key: "private-agent-key" },
};

describe("invitation SDK transport", () => {
  it("issues human invitations with admin authority and accepts with cookie-only human requests", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({ ...invitation, kind: "human", code }),
      )
      .mockResolvedValueOnce(Response.json({ acknowledged: true }))
      .mockResolvedValueOnce(
        Response.json({
          admitted: true,
          accountId: invitation.accountId,
          workplaceId: invitation.workplaceId,
          mailbox: admission.mailbox,
        }),
      );
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.test",
      fetch,
    });
    await client.createHumanInvitation(
      { apiKey: "admin-key" },
      { email: "human@example.test" },
    );
    const input = {
      invitationId: invitation.id,
      code,
      email: "human@example.test",
    };
    await client.requestHumanInvitationCode(input);
    await client.acceptHumanInvitation({ ...input, otp: "123456" });
    expect(
      new Headers(fetch.mock.calls[0]![1]!.headers).get("Authorization"),
    ).toBe("Bearer admin-key");
    for (const [url, init] of fetch.mock.calls.slice(1)) {
      expect(init).toMatchObject({
        credentials: "include",
        method: "POST",
        redirect: "error",
      });
      expect(new Headers(init!.headers).has("Authorization")).toBe(false);
      expect(String(url)).not.toContain(code);
      expect(String(url)).not.toContain(input.email);
    }
    const file = {
      version: 1,
      kind: "human-invitation",
      origin: "https://api.example.test",
      invitationId: invitation.id,
      accountId: invitation.accountId,
      workplaceId: invitation.workplaceId,
      code,
    };
    expect(parseHumanInvitationFile(file)).toEqual(file);
    for (const bad of [
      { ...file, kind: "invitation" },
      { ...file, origin: "https://api.example.test/" },
      { ...file, email: input.email },
    ])
      expect(() => parseHumanInvitationFile(bad)).toThrow(
        "Invalid human invitation file",
      );
  });
  it("keeps preview, redemption and private recovery in POST bodies, with no account credential", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({ ...invitation, workplaceName: "Shared workplace" }),
      )
      .mockResolvedValueOnce(Response.json(admission))
      .mockResolvedValueOnce(Response.json(admission));
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.test",
      fetch,
    });
    await client.previewInvitation({ invitationId: invitation.id, code });
    expect(await client.redeemAgentInvitation({ ...recovery, code })).toEqual(
      admission,
    );
    expect(await client.recoverInvitationCredential(recovery)).toEqual(
      admission,
    );
    for (const [index, route] of ["preview", "redeem", "recover"].entries()) {
      const [url, init] = fetch.mock.calls[index]!;
      expect(String(url)).toBe(
        `https://api.example.test/v1/invitations/${route}`,
      );
      expect(init).toMatchObject({ method: "POST", redirect: "error" });
      const headers = new Headers(init!.headers);
      expect(headers.has("Authorization")).toBe(false);
      expect(headers.get("X-Request-ID")).toMatch(/^[0-9a-f-]{36}$/);
      expect(String(url)).not.toContain(code);
      expect(String(url)).not.toContain(recovery.recoveryProof);
    }
    expect(JSON.parse(fetch.mock.calls[2]![1]!.body as string)).toEqual(
      recovery,
    );
  });
  it.each([{ apiKey: "admin-key" }, { humanSession: true as const }])(
    "uses explicit administration and acknowledgement authority %j",
    async (authorization) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(Response.json({ ...invitation, code }))
        .mockResolvedValueOnce(
          Response.json({ items: [invitation], nextCursor: null }),
        )
        .mockResolvedValueOnce(Response.json({ canceled: true }))
        .mockResolvedValueOnce(Response.json({ acknowledged: true }));
      const client = new AgentWorkplace({
        baseUrl: "https://api.example.test",
        fetch,
      });
      expect(
        await client.createAgentInvitation(authorization, {
          name: "Second agent",
        }),
      ).toMatchObject({ code });
      await client.listInvitations(authorization, {
        after: invitation.id,
        state: "pending",
      });
      await client.cancelInvitation(authorization, invitation.id);
      await client.acknowledgeInvitation(authorization, handoff);
      expect(String(fetch.mock.calls[1]![0])).toContain(
        `?after=${invitation.id}`,
      );
      expect(String(fetch.mock.calls[1]![0])).toContain("&state=pending");
      expect(fetch.mock.calls[2]![1]!.method).toBe("DELETE");
      expect(JSON.parse(fetch.mock.calls[3]![1]!.body as string)).toEqual(
        handoff,
      );
      for (const [, init] of fetch.mock.calls) {
        const headers = new Headers(init!.headers);
        if ("apiKey" in authorization)
          expect(headers.get("Authorization")).toBe("Bearer admin-key");
        else {
          expect(init!.credentials).toBe("include");
          expect(headers.has("Authorization")).toBe(false);
        }
      }
    },
  );
  it("rejects malformed recovery responses without exposing the returned key", async () => {
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.test",
      fetch: async () => Response.json({ ...admission, accountId: "invalid" }),
    });
    const error = await client
      .recoverInvitationCredential(recovery)
      .catch((error) => error as Error);
    expect(error).toBeInstanceOf(AgentWorkplaceError);
    expect(String(error)).not.toContain(admission.credential.key);
  });
});

describe("fresh nomination authorization", () => {
  it.each([null, invitation.id])(
    "sends the observed generation %s without retrying conflict",
    async (expectedNominationId) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(
          Response.json({
            nomination:
              expectedNominationId === null
                ? null
                : {
                    id: expectedNominationId,
                    agentId: invitation.issuerId,
                    email: "owner@example.test",
                  },
            cleanupAt: "2026-10-01T00:00:00.000Z",
          }),
        )
        .mockResolvedValueOnce(
          Response.json(
            { error: { code: "conflict", message: "Nomination changed" } },
            { status: 409 },
          ),
        );
      const client = new AgentWorkplace({
        baseUrl: "https://api.example.test",
        fetch,
      });
      const current = await client.currentNomination("agent-key");
      expect(current.nomination?.id ?? null).toBe(expectedNominationId);
      await expect(
        client.authorizeNomination("agent-key", {
          expectedNominationId,
          nominatedEmail: "replacement@example.test",
        }),
      ).rejects.toBeInstanceOf(AgentWorkplaceError);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(String(fetch.mock.calls[0]![0])).toBe(
        "https://api.example.test/v1/access/nomination",
      );
      const [url, init] = fetch.mock.calls[1]!;
      expect(String(url)).toBe(
        "https://api.example.test/v1/access/nomination/authorize",
      );
      expect(init!.method).toBe("POST");
      expect(new Headers(init!.headers).get("Authorization")).toBe(
        "Bearer agent-key",
      );
      expect(JSON.parse(init!.body as string)).toEqual({
        expectedNominationId,
        nominatedEmail: "replacement@example.test",
      });
    },
  );
});
