import { expect, test, vi } from "vitest";
import {
  AgentWorkplace,
  parseMailSendRequest,
  parseMailAttachmentSelection,
} from "../src/index.js";
const mailbox = {
  mailboxId: "11111111-1111-4111-8111-111111111111",
  accountId: "22222222-2222-4222-8222-222222222222",
  address: "sample@mail.agentworkplace.dev",
};
test("mailbox discovery uses API authorization, pagination and validated responses", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json({ mailboxes: [mailbox], nextCursor: mailbox.mailboxId }),
    )
    .mockResolvedValueOnce(Response.json(mailbox));
  const client = new AgentWorkplace({
    baseUrl: "https://api.example.test",
    fetch,
  });
  expect(
    await client.listMailboxes(
      { apiKey: "test-key" },
      { limit: 1, after: mailbox.mailboxId },
    ),
  ).toEqual({ mailboxes: [mailbox], nextCursor: mailbox.mailboxId });
  expect(
    await client.getMailbox({ humanSession: true }, mailbox.mailboxId),
  ).toEqual(mailbox);
  expect(String(fetch.mock.calls[0]![0])).toContain(
    `v1/mailboxes?after=${mailbox.mailboxId}&limit=1`,
  );
  expect(
    new Headers(fetch.mock.calls[0]![1]?.headers).get("Authorization"),
  ).toBe("Bearer test-key");
  expect(fetch.mock.calls[1]![1]?.credentials).toBe("include");
});
test("choice conflicts preserve safe revision and request identity, malformed mailboxes fail closed", async () => {
  const requestId = "33333333-3333-4333-8333-333333333333";
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: "address_unavailable",
            message: "Address unavailable",
            choiceRevision: 2,
          },
        },
        { status: 409, headers: { "X-Request-ID": requestId } },
      ),
    )
    .mockResolvedValueOnce(Response.json({ ...mailbox, address: "invalid" }));
  const client = new AgentWorkplace({
    baseUrl: "https://api.example.test",
    fetch,
  });
  await expect(
    client.signup({
      name: "Agent",
      nominatedEmail: "owner@example.test",
      bootstrapProof: "a".repeat(43),
      mailboxAddressChoice: { kind: "exact", localPart: "sample" },
    }),
  ).rejects.toMatchObject({
    status: 409,
    code: "address_unavailable",
    choiceRevision: 2,
    requestId,
  });
  await expect(
    client.getMailbox({ apiKey: "test" }, mailbox.mailboxId),
  ).rejects.toMatchObject({ status: 200, code: undefined });
});

test("correspondence retrieval uses HTTP only and preserves exact representations and safe response contracts", async () => {
  const text = "\ufeff\0reply\r\n🙂";
  const summary = {
    messageId: mailbox.accountId,
    mailboxId: mailbox.mailboxId,
    direction: "incoming",
    operationId: null,
    createdAt: "2026-09-14T00:00:00.123456Z",
    trashedAt: null,
    retainedBytes: new TextEncoder().encode(text).length,
    display: { "message-id": "<reply@example.test>" },
    metadataOmissions: [],
    attachmentOmissions: 1,
  };
  const message = {
    ...summary,
    text: { state: "present", content: text },
    html: { state: "absent" },
  };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json({ messages: [summary], nextCursor: null }),
    )
    .mockResolvedValueOnce(Response.json(message))
    .mockResolvedValueOnce(Response.json({ omissions: [], nextCursor: null }))
    .mockResolvedValueOnce(
      Response.json({
        ...message,
        html: { state: "absent", content: "invented" },
      }),
    );
  const client = new AgentWorkplace({
    baseUrl: "https://api.example.test",
    fetch,
  });
  await expect(
    client.listMailMessages(
      { apiKey: "private" },
      {
        mailboxId: mailbox.mailboxId,
        after: "cursor",
        limit: 1,
        view: "trash",
      },
    ),
  ).resolves.toEqual({ messages: [summary], nextCursor: null });
  await expect(
    client.getMailMessage({ humanSession: true }, mailbox.accountId, {
      mailboxId: mailbox.mailboxId,
    }),
  ).resolves.toEqual(message);
  await expect(
    client.listMailOmissions({ apiKey: "private" }),
  ).resolves.toEqual({ omissions: [], nextCursor: null });
  const first = new URL(String(fetch.mock.calls[0]![0]));
  expect(first.pathname).toBe("/v1/mail/messages");
  expect(first.searchParams.get("mailboxId")).toBe(mailbox.mailboxId);
  expect(first.searchParams.get("view")).toBe("trash");
  expect(fetch.mock.calls[1]![1]?.credentials).toBe("include");
  expect(
    fetch.mock.calls.every(
      (call) => !call[1]?.body && call[1]?.method === "GET",
    ),
  ).toBe(true);
  await expect(
    client.getMailMessage({ apiKey: "private" }, mailbox.accountId),
  ).rejects.toThrow("invalid response");
});

test("lifecycle uses POST with explicit targeting and never retries an uncertain response", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () => Response.json({ acknowledged: true }));
  const client = new AgentWorkplace({
    baseUrl: "https://api.example.test",
    fetch,
  });
  for (const action of ["trash", "restore", "purge"] as const) {
    await expect(
      client[`${action}MailMessage`]({ humanSession: true }, "a/b", {
        mailboxId: mailbox.mailboxId,
      }),
    ).resolves.toEqual({ acknowledged: true });
    const [url, options] = fetch.mock.calls.at(-1)!;
    expect(String(url)).toBe(
      `https://api.example.test/v1/mail/messages/a%2Fb/${action}`,
    );
    expect(options).toMatchObject({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ mailboxId: mailbox.mailboxId }),
    });
  }
  fetch.mockRejectedValueOnce(new TypeError("lost response"));
  await expect(
    client.purgeMailMessage({ apiKey: "private" }, mailbox.accountId),
  ).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(4);
  fetch.mockResolvedValueOnce(
    Response.json({ acknowledged: true, refunded: true }),
  );
  await expect(
    client.trashMailMessage({ apiKey: "private" }, mailbox.accountId),
  ).rejects.toThrow("invalid response");
});

test("public request parser makes a bounded valid copy suitable for a private retry receipt", () => {
  const input = {
    operationId: "11111111-1111-4111-8111-111111111111",
    to: ["one@example.test"],
    bcc: ["hidden@example.test"],
    subject: "demo",
    text: "body",
  };
  const parsed = parseMailSendRequest(input);
  input.bcc[0] = "changed@example.test";
  expect(parsed.bcc).toEqual(["hidden@example.test"]);
  expect(() => parseMailSendRequest({ ...input, cc: input.bcc })).toThrow(
    "Invalid Mail send request",
  );
});

test("archive and literal filters use authorized HTTP with independent cursors", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ messages: [], nextCursor: "next" }))
    .mockResolvedValueOnce(Response.json({ acknowledged: true }))
    .mockResolvedValueOnce(Response.json({ acknowledged: true }));
  const client = new AgentWorkplace({
    baseUrl: "https://api.example.test",
    fetch,
  });
  expect(
    await client.listMailMessages(
      { apiKey: "fixture" },
      {
        view: "archive",
        direction: "incoming",
        subject: "100%_ + ?",
        after: "cursor",
        limit: 2,
      },
    ),
  ).toEqual({ messages: [], nextCursor: "next" });
  const url = new URL(String(fetch.mock.calls[0]![0]));
  expect(Object.fromEntries(url.searchParams)).toEqual({
    view: "archive",
    direction: "incoming",
    subject: "100%_ + ?",
    after: "cursor",
    limit: "2",
  });
  await client.archiveMailMessage({ apiKey: "fixture" }, mailbox.mailboxId, {
    mailboxId: mailbox.mailboxId,
  });
  await client.unarchiveMailMessage({ humanSession: true }, mailbox.mailboxId);
  expect(String(fetch.mock.calls[1]![0])).toContain(
    `/messages/${mailbox.mailboxId}/archive`,
  );
  expect(fetch.mock.calls[1]![1]?.body).toBe(
    JSON.stringify({ mailboxId: mailbox.mailboxId }),
  );
  expect(String(fetch.mock.calls[2]![0])).toContain(
    `/messages/${mailbox.mailboxId}/unarchive`,
  );
  expect(fetch.mock.calls[2]![1]?.credentials).toBe("include");
});

test("composition uses HTTP and validates immutable request shapes without accepting reply recipient overrides", async () => {
  const { parseMailComposeRequest } = await import("../src/index.js");
  const input = {
    operationId: mailbox.accountId,
    sourceMessageId: mailbox.mailboxId,
    kind: "reply_all" as const,
    subject: "Reply",
    text: "Content",
  };
  const request = parseMailComposeRequest(input);
  expect(request).toEqual(input);
  expect(() =>
    parseMailComposeRequest({ ...input, to: ["override@example.test"] }),
  ).toThrow("Invalid Mail composition request");
  expect(() =>
    parseMailComposeRequest({ ...input, kind: "forward" }),
  ).toThrow();
  const result = {
    operationId: input.operationId,
    mailboxId: mailbox.mailboxId,
    state: "queued",
    contentRetained: true,
    recipientCount: 2,
    receipt: { available: false, reason: "evidence_unavailable" },
  };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(Response.json(result));
  const client = new AgentWorkplace({
    baseUrl: "https://api.example.test",
    fetch,
  });
  expect(await client.composeMail({ apiKey: "fixture-key" }, request)).toEqual(
    result,
  );
  expect(String(fetch.mock.calls[0]![0])).toBe(
    "https://api.example.test/v1/mail/compose",
  );
  expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual(request);
});

test("sender blocks use bounded authorized HTTP and validate returned state", async () => {
  const state = {
    mailboxId: mailbox.mailboxId,
    sender: "Exact@example.test",
    blocked: true,
  };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json(state))
    .mockResolvedValueOnce(Response.json({ ...state, blocked: false }))
    .mockResolvedValueOnce(
      Response.json({
        blocks: [
          { sender: state.sender, createdAt: "2026-09-18T00:00:00.000Z" },
        ],
        nextCursor: null,
      }),
    )
    .mockResolvedValueOnce(Response.json({ ...state, blocked: "yes" }));
  const client = new AgentWorkplace({ baseUrl: "https://example.test", fetch });
  expect(
    await client.blockMailSender(
      { apiKey: "fixture" },
      { sender: state.sender, mailboxId: mailbox.mailboxId },
    ),
  ).toEqual(state);
  expect(
    await client.unblockMailSender(
      { apiKey: "fixture" },
      { sender: state.sender },
    ),
  ).toMatchObject({ blocked: false });
  await client.listMailSenderBlocks(
    { apiKey: "fixture" },
    { mailboxId: mailbox.mailboxId, after: "cursor", limit: 1 },
  );
  expect(new URL(String(fetch.mock.calls[0]![0])).pathname).toBe(
    "/v1/mail/sender-blocks/block",
  );
  expect(fetch.mock.calls[0]![1]?.body).toBe(
    JSON.stringify({ sender: state.sender, mailboxId: mailbox.mailboxId }),
  );
  expect(new URL(String(fetch.mock.calls[1]![0])).pathname).toBe(
    "/v1/mail/sender-blocks/unblock",
  );
  expect(
    Object.fromEntries(new URL(String(fetch.mock.calls[2]![0])).searchParams),
  ).toEqual({ mailboxId: mailbox.mailboxId, after: "cursor", limit: "1" });
  await expect(
    client.blockMailSender({ apiKey: "fixture" }, { sender: state.sender }),
  ).rejects.toThrow();
});

test("attachment status uses bounded HTTP pagination and validates responses", async () => {
  const page = {
    messageId: mailbox.accountId,
    attachments: [],
    nextAfter: null,
    preparation: null,
  };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json(page))
    .mockResolvedValueOnce(Response.json({ ...page, providerId: "private" }));
  const client = new AgentWorkplace({
    baseUrl: "https://api.example.test",
    fetch,
  });
  expect(
    await client.listMailAttachments({ apiKey: "private" }, mailbox.accountId, {
      mailboxId: mailbox.mailboxId,
      after: 0,
      limit: 2,
    }),
  ).toEqual(page);
  expect(String(fetch.mock.calls[0]![0])).toContain(
    `/attachments?mailboxId=${mailbox.mailboxId}&after=0&limit=2`,
  );
  await expect(
    client.listMailAttachments({ apiKey: "private" }, mailbox.accountId),
  ).rejects.toThrow();
});

test("pending preparation discovery uses the API and keeps cursor scope opaque", async () => {
  const page = { preparations: [], nextCursor: null };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(Response.json(page));
  const client = new AgentWorkplace({
    baseUrl: "https://api.example.test",
    fetch,
  });
  expect(
    await client.listMailPreparations(
      { apiKey: "private" },
      { mailboxId: mailbox.mailboxId, after: "opaque", limit: 2 },
    ),
  ).toEqual(page);
  expect(String(fetch.mock.calls[0]![0])).toContain(
    `/preparations?mailboxId=${mailbox.mailboxId}&after=opaque&limit=2`,
  );
});

test.each(["abc", "abd", "ab", "abcd"])(
  "attachment byte transport checks integrity for %s without credentials",
  async (body) => {
    const attachment = {
      attachmentId: mailbox.mailboxId,
      ordinal: 0,
      filename: null,
      contentType: "text/plain",
      disposition: null,
      contentId: null,
      state: "retained",
      bytes: 3,
      sha256:
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json({
        messageId: mailbox.accountId,
        attachment,
        url: "https://blob.example.test/temporary",
        expiresAt: "2030-01-01T00:00:00Z",
      }),
    );
    const transferFetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(body));
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.test",
      fetch,
      transferFetch,
    });
    const result = client.downloadMailAttachment(
      { apiKey: "private" },
      { messageId: mailbox.accountId, attachmentId: mailbox.mailboxId },
    );
    if (body === "abc")
      expect(new TextDecoder().decode((await result).bytes)).toBe("abc");
    else
      await expect(result).rejects.toMatchObject({
        code: "transfer_interrupted",
      });
    expect(transferFetch.mock.calls[0]![1]).toMatchObject({
      credentials: "omit",
      redirect: "error",
    });
    expect(transferFetch.mock.calls[0]![1]?.headers).toBeUndefined();
    expect(fetch.mock.calls[0]![1]?.method).toBe("POST");
  },
);

test("attachment grant identity mismatch is rejected before any byte request", async () => {
  const transferFetch = vi.fn<typeof globalThis.fetch>();
  const client = new AgentWorkplace({
    baseUrl: "https://api.example.test",
    transferFetch,
    fetch: async () =>
      Response.json({
        messageId: mailbox.mailboxId,
        attachment: {
          attachmentId: mailbox.mailboxId,
          ordinal: 0,
          filename: null,
          contentType: null,
          disposition: null,
          contentId: null,
          state: "retained",
          bytes: 0,
          sha256: "a".repeat(64),
        },
        url: "https://blob.example.test/temporary",
        expiresAt: "2030-01-01T00:00:00Z",
      }),
  });
  await expect(
    client.downloadMailAttachment(
      { apiKey: "private" },
      { messageId: mailbox.accountId, attachmentId: mailbox.mailboxId },
    ),
  ).rejects.toThrow();
  expect(transferFetch).not.toHaveBeenCalled();
});

test("Mail catch-up clients preserve opaque cursors, gaps, scope and response validation", async () => {
  const gap = {
    state: "gap",
    reason: "history_expired",
    baselineRequired: true,
  };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ checkpoint: "opaque" }))
    .mockResolvedValueOnce(Response.json(gap))
    .mockResolvedValueOnce(
      Response.json({
        operations: [{ operationId: mailbox.mailboxId }],
        nextCursor: null,
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        state: "changes",
        items: [],
        checkpoint: null,
        nextCursor: null,
      }),
    );
  const client = new AgentWorkplace({
    baseUrl: "https://api.example.test",
    fetch,
  });
  expect(
    await client.getMailCheckpoint(
      { humanSession: true },
      { mailboxId: mailbox.mailboxId },
    ),
  ).toEqual({ checkpoint: "opaque" });
  expect(
    await client.listMailChanges(
      { apiKey: "test-key" },
      { mailboxId: mailbox.mailboxId, cursor: "opaque/+?", limit: 1 },
    ),
  ).toEqual(gap);
  expect(
    new URL(String(fetch.mock.calls[1]![0])).searchParams.get("cursor"),
  ).toBe("opaque/+?");
  expect(fetch.mock.calls[0]![1]?.credentials).toBe("include");
  expect(
    new Headers(fetch.mock.calls[1]![1]?.headers).get("Authorization"),
  ).toBe("Bearer test-key");
  expect(
    await client.listMailOperations(
      { apiKey: "test-key" },
      { mailboxId: mailbox.mailboxId, after: mailbox.mailboxId, limit: 1 },
    ),
  ).toEqual({
    operations: [{ operationId: mailbox.mailboxId }],
    nextCursor: null,
  });
  await expect(
    client.listMailChanges(
      { apiKey: "test-key" },
      { mailboxId: mailbox.mailboxId, cursor: "opaque" },
    ),
  ).rejects.toMatchObject({
    name: "AgentWorkplaceError",
    status: 200,
    code: undefined,
  });
});

test("attachment request parsing preserves immutable selection and refuses URLs or latest", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const part = { kind: "files", workplaceId: id, fileId: id, revisionId: id };
  const request = {
    operationId: id,
    to: "recipient@example.test",
    subject: "Copy",
    text: "body",
    attachments: [part],
  };
  expect(parseMailSendRequest(request).attachments).toEqual([part]);
  expect(() =>
    parseMailSendRequest({
      ...request,
      attachments: [{ ...part, revisionId: "latest" }],
    }),
  ).toThrow();
  expect(() =>
    parseMailSendRequest({
      ...request,
      attachments: [{ ...part, url: "https://example.test/content" }],
    }),
  ).toThrow();
});

test("standalone attachment selection parsing copies normalized ordered refs and rejects unsupported shapes", () => {
  const id = "ABCDEFAB-1234-4123-8123-ABCDEFABCDEF";
  const part = { kind: "files", workplaceId: id, fileId: id, revisionId: id };
  const input = [part];
  const selected = parseMailAttachmentSelection(input);
  expect(selected).toEqual([
    {
      kind: "files",
      workplaceId: id.toLowerCase(),
      fileId: id.toLowerCase(),
      revisionId: id.toLowerCase(),
    },
  ]);
  part.revisionId = "latest";
  expect(selected[0]!.kind === "files" && selected[0]!.revisionId).toBe(
    id.toLowerCase(),
  );
  for (const invalid of [
    undefined,
    [],
    Array(11).fill(selected[0]),
    [{ ...selected[0], url: "https://example.test" }],
    input,
  ])
    expect(() => parseMailAttachmentSelection(invalid)).toThrow(
      "Invalid Mail attachment selection",
    );
});
