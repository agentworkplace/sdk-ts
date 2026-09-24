import { expect, it, vi } from "vitest";
import { AgentWorkplace } from "../src/client.js";
const id = "9ea2537a-ea98-4322-8c1b-c43458937c47";
const revision = "45cd98f5-fb56-4fc1-922b-c3ee80c6168e";
const profile = {
  accountId: id,
  workplaceId: id,
  workplaceEmailAddress: "agent@mail.agentworkplace.dev",
  kind: "agent",
  role: "member",
  state: "active",
  name: "Agent",
  description: null,
  revision,
};
const settings = {
  workplaceId: id,
  name: "Workplace",
  description: null,
  revision,
};
it.each([{ apiKey: "private-key" }, { humanSession: true as const }])(
  "preserves explicit revision and authority for descriptive edits %j",
  async (authority) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(profile))
      .mockResolvedValueOnce(Response.json(profile))
      .mockResolvedValueOnce(Response.json(settings))
      .mockResolvedValueOnce(Response.json(settings));
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.test",
      fetch,
    });
    await client.getProfile(authority, id);
    await client.updateProfile(authority, id, {
      expectedRevision: revision,
      description: null,
    });
    await client.getWorkplaceSettings(authority);
    await client.updateWorkplaceSettings(authority, {
      expectedRevision: revision,
      name: "Workplace",
    });
    expect(
      fetch.mock.calls.map(([url]) => new URL(String(url)).pathname),
    ).toEqual([
      `/v1/accounts/${id}`,
      `/v1/accounts/${id}`,
      "/v1/workplace",
      "/v1/workplace",
    ]);
    for (const index of [1, 3]) {
      const init = fetch.mock.calls[index]![1]!;
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(init.body as string)).toHaveProperty(
        "expectedRevision",
        revision,
      );
      if ("apiKey" in authority)
        expect(new Headers(init.headers).get("Authorization")).toBe(
          "Bearer private-key",
        );
      else {
        expect(init.credentials).toBe("include");
        expect(new Headers(init.headers).has("Authorization")).toBe(false);
      }
    }
  },
);
it("returns stale-write errors without fetching a replacement revision or retrying", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(
      Response.json(
        { error: { code: "profile_conflict", message: "Profile changed" } },
        { status: 409 },
      ),
    );
  const client = new AgentWorkplace({
    baseUrl: "https://api.example.test",
    fetch,
  });
  await expect(
    client.updateProfile({ apiKey: "private-key" }, id, {
      expectedRevision: revision,
      name: "New",
    }),
  ).rejects.toMatchObject({ status: 409, code: "profile_conflict" });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("keeps role revisions and role endpoints separate from descriptive edits", async () => {
  const current = { accountId: id, workplaceId: id, role: "member", revision };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () => Response.json(current));
  const client = new AgentWorkplace({
    baseUrl: "https://api.example.test",
    fetch,
  });
  await client.getParticipantRole({ apiKey: "private-key" }, id);
  await client.updateParticipantRole({ apiKey: "private-key" }, id, {
    expectedRevision: revision,
    role: "admin",
  });
  expect(
    fetch.mock.calls.map(([url]) => new URL(String(url)).pathname),
  ).toEqual([`/v1/accounts/${id}/role`, `/v1/accounts/${id}/role`]);
  expect(fetch.mock.calls[1]![1]!.method).toBe("PATCH");
  expect(JSON.parse(fetch.mock.calls[1]![1]!.body as string)).toEqual({
    expectedRevision: revision,
    role: "admin",
  });
});
