import { expect, it, vi } from "vitest";
import { AgentWorkplace } from "../src/index.js";

it("uses private browser POSTs with cookies and no agent authorization", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json({ state: "confirmed" }),
  );
  const client = new AgentWorkplace({
    baseUrl: "https://api.example.test",
    fetch,
  });
  const token = "a".repeat(43);
  await client.previewOwnership({ token });
  await client.acceptOwnership({ token, acceptOwnership: true });
  expect("confirmOwnership" in client).toBe(false);
  expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
    "https://api.example.test/v1/access/ownership/preview",
    "https://api.example.test/v1/access/ownership/confirm",
  ]);
  for (const [, init] of fetch.mock.calls) {
    expect(init).toMatchObject({
      method: "POST",
      credentials: "include",
      redirect: "error",
    });
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
  }
  expect(JSON.parse(fetch.mock.calls[1]![1]!.body as string)).toEqual({
    token,
    acceptOwnership: true,
  });
});

it("never returns private fields or a session token from a completion response", async () => {
  const fetch = async () =>
    Response.json({ state: "confirmed", token: "must-not-leak" });
  await expect(
    new AgentWorkplace({ fetch }).previewOwnership({ token: "a".repeat(43) }),
  ).resolves.toStrictEqual({ state: "confirmed" });
  await expect(
    new AgentWorkplace({
      fetch,
      unknownResponseFields: "reject",
    }).previewOwnership({ token: "a".repeat(43) }),
  ).rejects.toMatchObject({
    message: "The Agent Workplace API returned an invalid response",
  });
});
