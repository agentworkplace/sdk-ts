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

// This probe also runs from a clean packed-client installation on each supported
// Node line. A caller ceiling must reject metadata before fetching byte grants.
const downloadId = "11111111-1111-4111-8111-111111111111";
let transferCalls = 0;
const downloadClient = new AgentWorkplace({
  baseUrl: "https://api.example.test",
  transferFetch: async () => {
    transferCalls++;
    throw new Error("Unexpected byte transfer");
  },
  fetch: async (url) =>
    Response.json({
      ...(String(url).includes("/mail/")
        ? {
            messageId: downloadId,
            attachment: {
              attachmentId: downloadId,
              ordinal: 0,
              filename: null,
              contentType: null,
              disposition: null,
              contentId: null,
              state: "retained",
              bytes: 262145,
              sha256: "a".repeat(64),
            },
          }
        : {
            file: {
              workplaceId: downloadId,
              fileId: downloadId,
              revisionId: downloadId,
              version: downloadId,
              name: "text.txt",
              reference: `awp:file:${downloadId}:${downloadId}`,
              revisionReference: `awp:file:${downloadId}:${downloadId}:revision:${downloadId}`,
              byteLength: 262145,
              contentType: "text/plain",
              sha256: "a".repeat(64),
              actorId: downloadId,
              createdAt: "2026-10-10T00:00:00.000Z",
            },
          }),
      url: "https://storage.example.test/private",
      expiresAt: "2030-01-01T00:00:00Z",
    }),
});
for (const operation of [
  () =>
    downloadClient.downloadFile(
      { apiKey: "probe" },
      { workplaceId: downloadId, fileId: downloadId },
      { maxBytes: 262144 },
    ),
  () =>
    downloadClient.downloadMailAttachment(
      { apiKey: "probe" },
      { messageId: downloadId, attachmentId: downloadId },
      { maxBytes: 262144 },
    ),
])
  await assert.rejects(operation, { code: "download_too_large", status: 0 });
assert.equal(transferCalls, 0);
