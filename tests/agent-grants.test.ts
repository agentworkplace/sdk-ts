import { describe, expect, it, vi } from "vitest";
import { AgentWorkplace } from "../src/client.js";
import { AgentWorkplaceError } from "../src/errors.js";

const accountId = "9ea2537a-ea98-4322-8c1b-c43458937c47";
const grantId = "5fd2a353-c80e-41ea-89f8-29a12bcbd786";
const humanId = "45cd98f5-fb56-4fc1-922b-c3ee80c6168e";
const grant = {
  id: grantId,
  clientName: "Claude",
  clientHost: "claude.ai",
  method: "authorization_code",
  scopes: ["mail", "files"],
  authorizedBy: { id: humanId, name: "Owner" },
  createdAt: "2026-10-18T00:00:00.000Z",
};

function client(fetch: typeof globalThis.fetch) {
  return new AgentWorkplace({ baseUrl: "https://api.example.test", fetch });
}
const header = (
  fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>,
  call: number,
) => new Headers(fetch.mock.calls[call]![1]!.headers).get("Authorization");

describe("agent grant transport", () => {
  it("sends grant access tokens as bearer credentials", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ grants: [grant] }));
    await client(fetch).listAgentGrants({ accessToken: "a.b.c" }, accountId);
    expect(header(fetch, 0)).toBe("Bearer a.b.c");
  });

  it("lists and revokes grants by key or dashboard session", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ grants: [grant] }))
      .mockResolvedValueOnce(Response.json({ revoked: true }));
    const sdk = client(fetch);
    expect(await sdk.listAgentGrants({ apiKey: "key" }, accountId)).toEqual({
      grants: [grant],
    });
    expect(fetch.mock.calls[0]![0].toString()).toBe(
      `https://api.example.test/v1/accounts/${accountId}/grants`,
    );
    expect(
      await sdk.revokeAgentGrant({ humanSession: true }, accountId, grantId),
    ).toEqual({ revoked: true });
    expect(fetch.mock.calls[1]![1]).toMatchObject({
      method: "DELETE",
      credentials: "include",
    });
    expect(header(fetch, 1)).toBeNull();
  });

  it("rejects grant lists that expose more than the safe projection", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json({
        grants: [{ ...grant, clientId: "https://claude.ai/client.json" }],
      }),
    );
    await expect(
      client(fetch).listAgentGrants({ apiKey: "key" }, accountId),
    ).rejects.toThrow("invalid response");
  });

  it("exposes the scopes an insufficient-scope failure needs", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json(
        {
          error: {
            code: "insufficient_scope",
            message: "Missing scope",
            scopes: ["files"],
          },
        },
        { status: 403 },
      ),
    );
    const failure = await client(fetch)
      .listAgentGrants({ accessToken: "a.b.c" }, accountId)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AgentWorkplaceError);
    expect(failure).toMatchObject({
      status: 403,
      code: "insufficient_scope",
      scopes: ["files"],
    });
  });

  it("sends consent and device decisions with the dashboard session only", async () => {
    const details = {
      client: { name: "Claude", host: "claude.ai" },
      redirect: { host: "claude.ai", loopback: false },
      scopes: ["mail"],
      workplace: { id: humanId, name: "Workplace" },
      agents: [{ id: accountId, name: "Agent" }],
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(details))
      .mockResolvedValueOnce(
        Response.json({
          redirectTo: "https://claude.ai/api/mcp/auth_callback",
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          client: details.client,
          scopes: details.scopes,
          workplace: details.workplace,
          agents: details.agents,
        }),
      )
      .mockResolvedValueOnce(Response.json({ approved: true }));
    const sdk = client(fetch);
    await sdk.getOAuthConsentDetails("signed=query");
    await sdk.decideOAuthConsent({
      query: "signed=query",
      accept: true,
      accountId,
      scopes: ["mail"],
    });
    await sdk.enterOAuthDeviceCode("ABCD-EFGH");
    await sdk.decideOAuthDeviceCode({
      userCode: "abcd-efgh",
      accept: true,
      accountId,
      scopes: ["mail"],
    });
    for (const [index, path] of [
      "v1/oauth/consent/details",
      "v1/oauth/consent",
      "v1/oauth/device",
      "v1/oauth/device/decision",
    ].entries()) {
      expect(fetch.mock.calls[index]![0].toString()).toBe(
        `https://api.example.test/${path}`,
      );
      expect(fetch.mock.calls[index]![1]).toMatchObject({
        method: "POST",
        credentials: "include",
      });
      expect(header(fetch, index)).toBeNull();
    }
    expect(JSON.parse(String(fetch.mock.calls[3]![1]!.body))).toMatchObject({
      userCode: "ABCDEFGH",
    });
  });
});
