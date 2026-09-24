import { describe, expect, it, vi } from "vitest";
import { AgentWorkplace } from "../src/client.js";

const accountId = "9ea2537a-ea98-4322-8c1b-c43458937c47";
const workplaceId = "45cd98f5-fb56-4fc1-922b-c3ee80c6168e";
const keyId = "5fd2a353-c80e-41ea-89f8-29a12bcbd786";
describe("access transport", () => {
  it.each(["free", "pro"] as const)(
    "reads %s allowances with browser session authority",
    async (plan) => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        Response.json({
          accountId,
          workplaceId,
          role: "owner",
          workplaceState: "confirmed",
          storage: {
            limitBytes: plan === "pro" ? 50_000_000_000 : 5_000_000_000,
            usedBytes: 10,
            heldBytes: 20,
            availableBytes:
              (plan === "pro" ? 50_000_000_000 : 5_000_000_000) - 30,
          },
          free: {
            ...(plan === "pro" ? { plan } : {}),
            confirmedAt: "2026-09-12T00:00:00Z",
            periodStart: "2026-09-12T00:00:00Z",
            periodEnd: "2026-10-12T00:00:00Z",
            outboundLimit: plan === "pro" ? 2000 : 200,
            inboundLimit: plan === "pro" ? 5000 : 1000,
            storageLimit: plan === "pro" ? "50 GB" : "5 GB",
            outboundUsed: 2,
            inboundUsed: 20,
            storageUsedBytes: 10,
          },
        }),
      );
      const client = new AgentWorkplace({
        baseUrl: "https://api.example.test",
        fetch,
      });
      expect(await client.humanAccessStatus()).toMatchObject({
        role: "owner",
        free: { outboundUsed: 2, outboundLimit: plan === "pro" ? 2000 : 200 },
        storage: { usedBytes: 10, heldBytes: 20 },
      });
      expect(fetch.mock.calls[0]![0].toString()).toBe(
        "https://api.example.test/v1/access/human",
      );
      expect(fetch.mock.calls[0]![1]).toMatchObject({
        method: "GET",
        credentials: "include",
        redirect: "error",
      });
      expect(
        new Headers(fetch.mock.calls[0]![1]!.headers).has("Authorization"),
      ).toBe(false);
    },
  );
  it.each([{ apiKey: "private-test-key" }, { humanSession: true as const }])(
    "reads additive account status with explicit authorization %j",
    async (authorization) => {
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
        Response.json({
          accountId,
          workplaceId,
          kind: "agent",
          state: "active",
          role: "member",
          workplaceState: "unconfirmed",
          cleanupAt: "2026-10-11T00:00:00Z",
          cleanupWarning: null,
          free: null,
          storage: {
            limitBytes: 100000000,
            usedBytes: 64,
            heldBytes: 128,
            availableBytes: 99999808,
          },
          starter: {
            outboundLimit: 2,
            inboundLimit: 20,
            storageLimit: "100 MB",
            outboundUsed: 0,
            inboundUsed: 0,
            storageUsedBytes: 0,
          },
        }),
      );
      const client = new AgentWorkplace({
        baseUrl: "https://api.example.test",
        fetch,
      });
      expect(await client.accountStatus(authorization)).toMatchObject({
        storage: {
          limitBytes: 100000000,
          usedBytes: 64,
          heldBytes: 128,
          availableBytes: 99999808,
        },
        role: "member",
        workplaceState: "unconfirmed",
      });
      expect(fetch.mock.calls[0]![0].toString()).toBe(
        "https://api.example.test/v1/access/account",
      );
      const init = fetch.mock.calls[0]![1]!;
      expect(init.redirect).toBe("error");
      expect(new Headers(init.headers).get("Authorization")).toBe(
        "apiKey" in authorization ? "Bearer private-test-key" : null,
      );
      if ("humanSession" in authorization)
        expect(init.credentials).toBe("include");
    },
  );
  it("preserves signup identity and sends explicit credentials only on authenticated operations", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json({
          accountId,
          workplaceId,
          cleanupAt: "2026-10-11T00:00:00Z",
          credential: { id: keyId, key: "private-test-key" },
        }),
      )
      .mockResolvedValueOnce(Response.json({ acknowledged: true }));
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.test",
      fetch,
    });
    const input = {
      name: "Agent",
      nominatedEmail: "owner@example.test",
      bootstrapProof: "a".repeat(43),
    };
    const signup = await client.signup(input);
    await client.acknowledgeSignup(signup.credential.key);
    expect(fetch.mock.calls[0]?.[0].toString()).toBe(
      "https://api.example.test/v1/workplaces",
    );
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify(input),
      redirect: "error",
    });
    expect(
      new Headers(fetch.mock.calls[0]?.[1]?.headers).has("Authorization"),
    ).toBe(false);
    expect(
      new Headers(fetch.mock.calls[1]?.[1]?.headers).get("Authorization"),
    ).toBe("Bearer private-test-key");
    expect(
      new Headers(fetch.mock.calls[1]?.[1]?.headers).get("X-Request-ID"),
    ).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("retains safe API error codes and does not expose malformed credential responses", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "recovery_unavailable",
              message: "Access operation rejected",
            },
          },
          { status: 409 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ private: "do-not-expose" }));
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.test",
      fetch,
    });
    await expect(client.acknowledgeSignup("key")).rejects.toMatchObject({
      status: 409,
      code: "recovery_unavailable",
    });
    await expect(client.accessStatus("key")).rejects.toMatchObject({
      message: "The Agent Workplace API returned an invalid response",
    });
  });
});

const signupInput = {
  name: "Agent",
  nominatedEmail: "owner@example.test",
  bootstrapProof: "a".repeat(43),
};
const accessOperations = [
  [
    "confirmation",
    (client: AgentWorkplace) =>
      client.confirmOwnership("private-test-key", {
        nominationId: keyId,
        code: "012345",
      }),
  ],
  [
    "correction",
    (client: AgentWorkplace) =>
      client.correctNomination("private-test-key", {
        nominationId: keyId,
        nominatedEmail: "owner@example.test",
      }),
  ],
  [
    "cancellation",
    (client: AgentWorkplace) =>
      client.cancelNomination("private-test-key", { nominationId: keyId }),
  ],
  ["signup", (client: AgentWorkplace) => client.signup(signupInput)],
  [
    "acknowledgement",
    (client: AgentWorkplace) => client.acknowledgeSignup("private-test-key"),
  ],
  [
    "status",
    (client: AgentWorkplace) => client.accessStatus("private-test-key"),
  ],
  [
    "resend",
    (client: AgentWorkplace) => client.resendNomination("private-test-key"),
  ],
] as const;

describe.each(accessOperations)("%s transport security", (_name, operation) => {
  it.each([
    "http://api.example.test",
    "http://localhost.evil.test",
    "http://127.0.0.1.evil.test",
    "http://[::2]",
  ])("rejects %s before Fetch receives secrets", async (baseUrl) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({}));
    const client = new AgentWorkplace({ baseUrl, fetch });
    const error = await operation(client).catch((error) => error);
    expect(fetch).not.toHaveBeenCalled();
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toContain("HTTPS or loopback HTTP");
    expect(error.message).not.toContain(signupInput.bootstrapProof);
    expect(error.message).not.toContain("private-test-key");
  });
  it.each([
    "https://api.example.test",
    "http://localhost:3003",
    "http://127.0.0.1:3003",
    "http://[::1]:3003",
  ])("preserves %s and rejects redirects", async (baseUrl) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json({
        accountId,
        workplaceId,
        cleanupAt: "2026-10-11T00:00:00Z",
        credential: { id: keyId, key: "private-test-key" },
        acknowledged: true,
        canceled: true,
        confirmed: true,
        nominationId: keyId,
        state: "queued",
        role: "admin",
        workplaceState: "unconfirmed",
        nomination: null,
        free: null,
        starter: {
          outboundLimit: 2,
          inboundLimit: 20,
          storageLimit: "100 MB",
          outboundUsed: 0,
          inboundUsed: 0,
          storageUsedBytes: 0,
        },
      }),
    );
    await operation(new AgentWorkplace({ baseUrl, fetch }));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe("error");
  });
});
it("preserves non-sensitive health checks over non-loopback HTTP", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(Response.json({ status: "ok" }));
  await expect(
    new AgentWorkplace({ baseUrl: "http://api.example.test", fetch }).health(),
  ).resolves.toEqual({ status: "ok" });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(
    new Headers(fetch.mock.calls[0]?.[1]?.headers).has("Authorization"),
  ).toBe(false);
  expect(fetch.mock.calls[0]?.[1]?.body).toBeUndefined();
});
