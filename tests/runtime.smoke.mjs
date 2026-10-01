import assert from "node:assert/strict";
import { AgentWorkplace, DocumentationClient } from "../dist/index.js";

const originalFetch = globalThis.fetch;
const requests = [];
const transport = async (input, init) => {
  const url = String(input);
  requests.push(url);
  if (url.endsWith("/health")) {
    assert.equal(init.redirect, "error");
    return Response.json({ status: "ok" });
  }
  assert.equal(url, "https://docs.agentworkplace.dev/docs-index.json");
  assert.equal(init.credentials, "omit");
  assert.equal(init.redirect, "manual");
  return Response.json({ schemaVersion: 1, pages: [] });
};
try {
  globalThis.fetch = transport;
  for (const client of [
    new AgentWorkplace(),
    new AgentWorkplace({}),
    new AgentWorkplace({ fetch: transport }),
  ])
    assert.deepEqual(await client.health(), { status: "ok" });
  for (const docs of [
    new DocumentationClient(),
    new DocumentationClient({}),
    new DocumentationClient({ fetch: transport }),
  ])
    assert.deepEqual(await docs.list(), []);
  assert.deepEqual(requests, [
    ...Array(3).fill("https://api.agentworkplace.dev/health"),
    ...Array(3).fill("https://docs.agentworkplace.dev/docs-index.json"),
  ]);
} finally {
  globalThis.fetch = originalFetch;
}

const client = new AgentWorkplace({
  baseUrl: "https://api.example.test",
  fetch: async () =>
    new Response(JSON.stringify({ status: "ok" }), {
      headers: { "content-type": "application/json" },
    }),
});
assert.deepEqual(await client.health(), { status: "ok" });

const ownershipRequests = [];
const humanClient = new AgentWorkplace({
  baseUrl: "https://api.example.test",
  fetch: async (url, init) => {
    ownershipRequests.push(String(url));
    assert.equal(init.method, "POST");
    assert.equal(init.credentials, "include");
    assert.equal(init.redirect, "error");
    assert.equal(new Headers(init.headers).has("Authorization"), false);
    const input = JSON.parse(init.body);
    assert.equal(input.token, "a".repeat(43));
    if (String(url).endsWith("/confirm"))
      assert.equal(input.acceptOwnership, true);
    return Response.json({ state: "confirmed" });
  },
});
assert.equal("confirmOwnership" in humanClient, false);
assert.deepEqual(
  await humanClient.previewOwnership({ token: "a".repeat(43) }),
  { state: "confirmed" },
);
assert.deepEqual(
  await humanClient.acceptOwnership({
    token: "a".repeat(43),
    acceptOwnership: true,
  }),
  { state: "confirmed" },
);
assert.deepEqual(ownershipRequests, [
  "https://api.example.test/v1/access/ownership/preview",
  "https://api.example.test/v1/access/ownership/confirm",
]);
