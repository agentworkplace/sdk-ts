import { expect, test, vi } from "vitest";
import { walkMail, type MailExportVisitStore } from "../src/mail-export.js";
import {
  AgentWorkplace,
  AgentWorkplaceError,
  type MailMessage,
} from "../src/index.js";
const id = (n: number) =>
  `${n.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
const mailboxId = id(1);
const message = (messageId = id(2)): MailMessage => ({
  messageId,
  mailboxId,
  direction: "incoming",
  operationId: null,
  createdAt: "2026-09-18T00:00:00.000001Z",
  trashedAt: null,
  retainedBytes: 0,
  display: {},
  metadataOmissions: [],
  attachmentOmissions: 0,
  text: { state: "present", content: "" },
  html: { state: "unknown" },
});
type Reads = Parameters<typeof walkMail>[1];
function reads(): Reads {
  return {
    preparations: vi.fn(async () => ({ preparations: [], nextCursor: null })),
    omissions: vi.fn(async () => ({ omissions: [], nextCursor: null })),
    checkpoint: vi.fn(async () => ({ checkpoint: "before" })),
    changes: vi.fn<Reads["changes"]>(async () => ({
      state: "changes",
      items: [],
      nextCursor: null,
      checkpoint: "after",
    })),
    message: vi.fn(async (messageId) => message(messageId)),
    page: vi.fn(async () => ({ messages: [], nextCursor: null })),
    thread: vi.fn<Reads["thread"]>(async (seedMessageId) => ({
      state: "indexing",
      mailboxId,
      seedMessageId,
    })),
    attachments: vi.fn(async (messageId) => ({
      messageId,
      attachments: [],
      nextAfter: null,
      preparation: null,
    })),
  };
}
function visits(): MailExportVisitStore {
  const keys = new Set<string>();
  return {
    addIfNew: vi.fn(async (key) => {
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    }),
  };
}
async function collect<T>(items: AsyncIterable<T>) {
  const result: T[] = [];
  for await (const item of items) result.push(item);
  return result;
}

test("Mail inventory applies backpressure and preserves present-empty versus unknown bodies", async () => {
  const r = reads();
  const input = {
    mailboxId,
    scope: { kind: "message", messageId: id(2) },
  } as const;
  const walk = walkMail(input, r, visits());
  const start = await walk.next();
  expect(start.value).toMatchObject({ kind: "start", checkpoint: "before" });
  expect(r.message).not.toHaveBeenCalled();
  const content = await walk.next();
  expect(content.value).toEqual({ kind: "message", message: message() });
  expect(r.attachments).not.toHaveBeenCalled();
  // Consumer mutation must not redirect subsequent attachment retrieval.
  if (content.value?.kind === "message")
    content.value.message.messageId = id(9);
  await walk.next();
  expect(r.attachments).toHaveBeenCalledWith(id(2), undefined);
  expect(r.changes).not.toHaveBeenCalled();
  expect((await walk.next()).value).toMatchObject({
    kind: "complete",
    coverage: "non_snapshot",
    messages: 1,
    issues: 0,
    mailboxChanges: "none_observed",
  });
});

test("Mailbox inventory follows empty pages, includes trash and records disappearance or duplicate discovery", async () => {
  const r = reads();
  vi.mocked(r.page)
    .mockResolvedValueOnce({ messages: [], nextCursor: "continue" })
    .mockResolvedValueOnce({
      messages: [message(id(2)), message(id(3))],
      nextCursor: null,
    })
    .mockResolvedValueOnce({ messages: [message(id(2))], nextCursor: null });
  vi.mocked(r.message).mockImplementation(async (messageId) => {
    if (messageId === id(3))
      throw new AgentWorkplaceError("Gone", { status: 404, code: "not_found" });
    return message(messageId);
  });
  const items = await collect(
    walkMail({ mailboxId, scope: { kind: "mailbox" } }, r, visits()),
  );
  expect(vi.mocked(r.page).mock.calls).toEqual([
    ["all", undefined],
    ["all", "continue"],
    ["trash", undefined],
  ]);
  expect(items.filter((item) => item.kind === "message")).toHaveLength(1);
  expect(items.filter((item) => item.kind === "issue")).toEqual([
    { kind: "issue", messageId: id(3), code: "not_found" },
    { kind: "issue", messageId: id(2), code: "message_revisited" },
  ]);
  expect(items.at(-1)).toMatchObject({
    kind: "complete",
    messages: 1,
    issues: 2,
  });
});

test("Mail inventory follows empty attachment pages without accumulating a manifest", async () => {
  const r = reads();
  vi.mocked(r.attachments)
    .mockResolvedValueOnce({
      messageId: id(2),
      attachments: [],
      nextAfter: 99,
      preparation: null,
    })
    .mockResolvedValueOnce({
      messageId: id(2),
      attachments: [],
      nextAfter: null,
      preparation: null,
    });
  await collect(
    walkMail(
      { mailboxId, scope: { kind: "message", messageId: id(2) } },
      r,
      visits(),
    ),
  );
  expect(vi.mocked(r.attachments).mock.calls).toEqual([
    [id(2), undefined],
    [id(2), 99],
  ]);
});

test("Thread indexing pauses without an internal retry loop or false completion", async () => {
  const r = reads();
  const items = await collect(
    walkMail(
      { mailboxId, scope: { kind: "thread", messageId: id(2) } },
      r,
      visits(),
    ),
  );
  expect(items.at(-1)).toEqual({
    kind: "incomplete",
    reason: "thread_indexing",
  });
  expect(r.thread).toHaveBeenCalledTimes(1);
  expect(r.message).not.toHaveBeenCalled();
  expect(r.changes).not.toHaveBeenCalled();
});

test("Thread inventory follows empty candidate pages but rejects changed grouping", async () => {
  const r = reads();
  const page = {
    state: "ready",
    mailboxId,
    seedMessageId: id(2),
    groupId: id(4),
    revision: "1",
    association: "historical_hints",
    messages: [],
    nextCursor: "continue",
  } as const;
  vi.mocked(r.thread)
    .mockResolvedValueOnce({ ...page, messages: [] })
    .mockResolvedValueOnce({
      ...page,
      messages: [],
      revision: "2",
      nextCursor: null,
    });
  await expect(
    collect(
      walkMail(
        { mailboxId, scope: { kind: "thread", messageId: id(2) } },
        r,
        visits(),
      ),
    ),
  ).rejects.toMatchObject({ code: "invalid_response" });
  expect(vi.mocked(r.thread).mock.calls).toEqual([
    [id(2), undefined],
    [id(2), "continue"],
  ]);
});

test("Mail inventory rejects cyclic pagination and foreign message responses", async () => {
  const r = reads();
  vi.mocked(r.page).mockResolvedValue({ messages: [], nextCursor: "same" });
  await expect(
    collect(walkMail({ mailboxId, scope: { kind: "mailbox" } }, r, visits())),
  ).rejects.toMatchObject({ code: "invalid_response" });
  expect(r.page).toHaveBeenCalledTimes(2);
  const foreign = reads();
  vi.mocked(foreign.message).mockResolvedValue({
    ...message(),
    mailboxId: id(9),
  });
  await expect(
    collect(
      walkMail(
        { mailboxId, scope: { kind: "message", messageId: id(2) } },
        foreign,
        visits(),
      ),
    ),
  ).rejects.toMatchObject({ code: "invalid_response" });
  expect(foreign.attachments).not.toHaveBeenCalled();
});

test("Authority loss propagates; an expired observation checkpoint never claims no changes", async () => {
  const r = reads();
  vi.mocked(r.attachments).mockRejectedValue(
    new AgentWorkplaceError("Denied", { status: 401, code: "access_denied" }),
  );
  await expect(
    collect(
      walkMail(
        { mailboxId, scope: { kind: "message", messageId: id(2) } },
        r,
        visits(),
      ),
    ),
  ).rejects.toMatchObject({ status: 401 });
  const gap = reads();
  vi.mocked(gap.changes).mockResolvedValue({
    state: "gap",
    reason: "history_expired",
    baselineRequired: true,
  });
  const items = await collect(
    walkMail({ mailboxId, scope: { kind: "mailbox" } }, gap, visits()),
  );
  expect(items.at(-1)).toMatchObject({
    kind: "complete",
    mailboxChanges: "unknown",
  });
});

test("Public SDK Mail inventory uses only scoped authorized HTTP reads", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ checkpoint: "before" }))
    .mockResolvedValueOnce(Response.json(message()))
    .mockResolvedValueOnce(
      Response.json({
        messageId: id(2),
        attachments: [],
        nextAfter: null,
        preparation: null,
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        state: "changes",
        items: [],
        nextCursor: null,
        checkpoint: "after",
      }),
    );
  const client = new AgentWorkplace({
    baseUrl: "https://api.example.test",
    fetch,
  });
  const items = await collect(
    client.walkRetainedMail(
      { apiKey: "private" },
      { mailboxId, scope: { kind: "message", messageId: id(2) } },
      visits(),
    ),
  );
  expect(items.at(-1)).toMatchObject({ kind: "complete", messages: 1 });
  expect(
    fetch.mock.calls.map(([url]) => new URL(String(url)).pathname),
  ).toEqual([
    "/v1/mail/checkpoint",
    `/v1/mail/messages/${id(2)}`,
    `/v1/mail/messages/${id(2)}/attachments`,
    "/v1/mail/changes",
  ]);
  for (const [url, init] of fetch.mock.calls) {
    expect(new URL(String(url)).searchParams.get("mailboxId")).toBe(mailboxId);
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer private",
    );
  }
});

test("Mailbox export includes pending-only parts and omission pages without requiring retained bodies", async () => {
  const r = reads();
  const preparation = {
    messageId: id(3),
    mailboxId,
    state: "pending" as const,
    preparedAt: "2026-09-18T00:00:00Z",
    expiresAt: "2026-09-19T00:00:00Z",
    registeredParts: 1,
    totalParts: 2,
  };
  vi.mocked(r.preparations)
    .mockResolvedValueOnce({ preparations: [], nextCursor: "next" })
    .mockResolvedValueOnce({ preparations: [preparation], nextCursor: null });
  vi.mocked(r.omissions)
    .mockResolvedValueOnce({ omissions: [], nextCursor: "more" })
    .mockResolvedValueOnce({
      omissions: [
        {
          omissionId: id(4),
          mailboxId,
          reason: "body_too_large",
          finishedAt: "2026-09-18T00:00:00Z",
        },
      ],
      nextCursor: null,
    });
  const items = await collect(
    walkMail({ mailboxId, scope: { kind: "mailbox" } }, r, visits()),
  );
  expect(r.message).not.toHaveBeenCalled();
  expect(r.attachments).toHaveBeenCalledWith(id(3), undefined);
  expect(items.filter((i) => i.kind === "preparations")).toHaveLength(2);
  expect(items.filter((i) => i.kind === "omissions")).toHaveLength(2);
  expect(items.at(-1)).toMatchObject({
    kind: "complete",
    messages: 0,
    issues: 0,
  });
});

test("A body disappearing does not suppress still-visible attachment metadata", async () => {
  const r = reads();
  vi.mocked(r.message).mockRejectedValue(
    new AgentWorkplaceError("Missing", { status: 404, code: "not_found" }),
  );
  const items = await collect(
    walkMail(
      { mailboxId, scope: { kind: "message", messageId: id(2) } },
      r,
      visits(),
    ),
  );
  expect(items.map((i) => i.kind)).toEqual([
    "start",
    "issue",
    "attachments",
    "complete",
  ]);
  expect(items.at(-1)).toMatchObject({ issues: 1 });
});

test("Supplemental Mail inventory rejects foreign metadata and repeated empty cursors", async () => {
  const r = reads();
  vi.mocked(r.preparations).mockResolvedValue({
    preparations: [],
    nextCursor: "same",
  });
  await expect(
    collect(walkMail({ mailboxId, scope: { kind: "mailbox" } }, r, visits())),
  ).rejects.toMatchObject({ code: "invalid_response" });
  expect(r.preparations).toHaveBeenCalledTimes(2);
  const foreign = reads();
  vi.mocked(foreign.omissions).mockResolvedValue({
    omissions: [
      {
        omissionId: id(4),
        mailboxId: id(9),
        reason: "body_too_large",
        finishedAt: "2026-09-18T00:00:00Z",
      },
    ],
    nextCursor: null,
  });
  await expect(
    collect(
      walkMail({ mailboxId, scope: { kind: "mailbox" } }, foreign, visits()),
    ),
  ).rejects.toMatchObject({ code: "invalid_response" });
});
