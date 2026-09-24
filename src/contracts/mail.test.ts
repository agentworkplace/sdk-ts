import { expect, test } from "vitest";
import {
  mailChangesSchema,
  mailChangesRequestSchema,
  mailAttachmentSchema,
  mailAttachmentListRequestSchema,
  mailContentChangeRequestSchema,
  mailContentAcknowledgementSchema,
  mailBodyRepresentationSchema,
  mailMessageSchema,
  mailCorrespondenceSchema,
  sendMailRequestSchema,
} from "./mail.js";
const request = {
  operationId: "11111111-1111-4111-8111-111111111111",
  to: "human@example.test",
  subject: "Requested demo",
  text: "Hello",
};
test("outgoing mail bounds UTF-8 bytes rather than characters", () => {
  expect(
    sendMailRequestSchema.safeParse({ ...request, text: "🌍".repeat(65536) })
      .success,
  ).toBe(true);
  expect(
    sendMailRequestSchema.safeParse({
      ...request,
      text: "🌍".repeat(65536) + "a",
    }).success,
  ).toBe(false);
  expect(
    sendMailRequestSchema.safeParse({ ...request, text: "é".repeat(131072) })
      .success,
  ).toBe(true);
  expect(
    sendMailRequestSchema.safeParse({ ...request, subject: "é".repeat(500) })
      .success,
  ).toBe(false);
});
test.each([
  { text: "\ud800" },
  { text: "a\0b" },
  { subject: "subject\r\nBcc: hidden@example.test" },
  { to: [] },
  { to: ["one@example.test"], bcc: ["one@example.test"] },
  { to: "one@example.test,two@example.test" },
  { html: "<b>unsupported</b>" },
  { attachments: [] },
])("rejects unsupported or unsafe outgoing input %o", (change) => {
  expect(
    sendMailRequestSchema.safeParse({ ...request, ...change }).success,
  ).toBe(false);
});
test("intentional empty plain text remains valid", () => {
  expect(
    sendMailRequestSchema.safeParse({ ...request, text: "", subject: "" })
      .success,
  ).toBe(true);
});

test("validates truthful operation states and receipt availability", async () => {
  const { mailOperationSchema } = await import("./mail.js");
  const operation = {
    operationId: "11111111-1111-4111-8111-111111111111",
    mailboxId: "22222222-2222-4222-8222-222222222222",
    state: "uncertain",
    contentRetained: false,
    receipt: { available: false, reason: "expired" },
  };
  expect(mailOperationSchema.safeParse(operation).success).toBe(true);
  expect(
    mailOperationSchema.safeParse({ ...operation, state: "delivered" }).success,
  ).toBe(false);
  expect(
    mailOperationSchema.safeParse({
      ...operation,
      receipt: { available: true },
    }).success,
  ).toBe(false);
  expect(
    mailOperationSchema.safeParse({
      ...operation,
      receipt: { available: false, reason: "lost" },
    }).success,
  ).toBe(false);
});

test("representation contracts preserve exact strings and reject invented absent or unknown content", () => {
  const content =
    "\ufeff\0reply\r\n\u001b]8;;https://untrusted.example\u0007link";
  expect(
    mailBodyRepresentationSchema.parse({ state: "present", content }),
  ).toEqual({ state: "present", content });
  expect(
    mailBodyRepresentationSchema.parse({ state: "present", content: "" }),
  ).toEqual({ state: "present", content: "" });
  for (const state of ["absent", "unknown"]) {
    expect(mailBodyRepresentationSchema.safeParse({ state }).success).toBe(
      true,
    );
    expect(
      mailBodyRepresentationSchema.safeParse({ state, content: "" }).success,
    ).toBe(false);
  }
  expect(
    mailBodyRepresentationSchema.safeParse({
      state: "present",
      content: "é".repeat(524289),
    }).success,
  ).toBe(false);
});
test("message contract bounds combined content and validates exact retained-byte accounting", () => {
  const value = {
    messageId: request.operationId,
    mailboxId: request.operationId,
    direction: "incoming",
    operationId: null,
    createdAt: "2026-09-14T00:00:00.123456Z",
    trashedAt: null,
    retainedBytes: 2,
    display: {},
    metadataOmissions: [],
    attachmentOmissions: 0,
    text: { state: "present", content: "é" },
    html: { state: "absent" },
  };
  expect(mailMessageSchema.safeParse(value).success).toBe(true);
  expect(
    mailMessageSchema.safeParse({ ...value, retainedBytes: 1 }).success,
  ).toBe(false);
});

test("Mail lifecycle accepts explicit actions and rejects invented outcome evidence", () => {
  expect(
    mailContentChangeRequestSchema.parse({
      messageId: request.operationId,
      action: "trash",
    }),
  ).toEqual({ messageId: request.operationId, action: "trash" });
  for (const value of [
    { messageId: "bad", action: "trash" },
    { messageId: request.operationId, action: "recall" },
    { messageId: request.operationId, action: "purge", mailboxId: "bad" },
  ])
    expect(mailContentChangeRequestSchema.safeParse(value).success).toBe(false);
  expect(
    mailContentAcknowledgementSchema.safeParse({ acknowledged: true }).success,
  ).toBe(true);
  expect(
    mailContentAcknowledgementSchema.safeParse({
      acknowledged: true,
      recalled: true,
    }).success,
  ).toBe(false);
});

test("admits ten unique visible/hidden recipients with deterministic visible dedup", async () => {
  const { normalizeMailRecipients } = await import("./mail.js");
  const input = {
    ...request,
    to: ["First@EXAMPLE.test", "First@example.test"],
    cc: ["First@example.test", "second@example.test"],
    bcc: ["hidden@example.test", "hidden@example.test"],
  };
  expect(sendMailRequestSchema.safeParse(input).success).toBe(true);
  expect(normalizeMailRecipients(input)).toEqual({
    to: ["First@example.test"],
    cc: ["second@example.test"],
    bcc: ["hidden@example.test"],
  });
  expect(
    sendMailRequestSchema.safeParse({
      ...request,
      to: Array.from({ length: 10 }, (_, n) => `r${n}@example.test`),
    }).success,
  ).toBe(true);
  expect(
    sendMailRequestSchema.safeParse({
      ...request,
      to: Array.from({ length: 11 }, (_, n) => `r${n}@example.test`),
    }).success,
  ).toBe(false);
  expect(
    sendMailRequestSchema.safeParse({
      ...request,
      cc: ["copy@EXAMPLE.test"],
      bcc: ["copy@example.test"],
    }).success,
  ).toBe(false);
  expect(
    normalizeMailRecipients({
      to: [
        "Agent@MAIL.AGENTWORKPLACE.DEV",
        "agent@mail.agentworkplace.dev",
        "Case@example.test",
        "case@example.test",
        "case+tag@example.test",
      ],
    }).to,
  ).toEqual([
    "agent@mail.agentworkplace.dev",
    "Case@example.test",
    "case@example.test",
    "case+tag@example.test",
  ]);
});

test.each([
  "<simple@example.test>",
  "<first.second@host>",
  "<!#$%&'*+-/=?^_`{|}~@right!#$%&'*+-/=?^_`{|}~.test>",
])("correspondence accepts supported dot-atom identifier: %s", (value) => {
  expect(
    mailCorrespondenceSchema.shape.messageId.safeParse(value).success,
  ).toBe(true);
});

test.each([
  "<.left@example.test>",
  "<left.@example.test>",
  "<left..part@example.test>",
  "<left@.example.test>",
  "<left@example.test.>",
  "<left@example..test>",
  "<@example.test>",
  "<left@>",
  "<left@example.test>\n",
  "<left@example.test>\r\n",
  "<left@exam\u0000ple.test>",
  "<left@example.test> <second@example.test>",
  // Valid RFC forms outside the supported dot-atom subset.
  '<"quoted left"@example.test>',
  "<left@[127.0.0.1]>",
])(
  "correspondence rejects malformed or unsupported identifier: %s",
  (value) => {
    expect(
      mailCorrespondenceSchema.shape.messageId.safeParse(value).success,
    ).toBe(false);
  },
);

test("suppression observation is optional for older servers and validates its timestamp", async () => {
  const { mailOperationSchema } = await import("./mail.js");
  const operation = {
    operationId: "11111111-1111-4111-8111-111111111111",
    mailboxId: "22222222-2222-4222-8222-222222222222",
    state: "uncertain",
    contentRetained: true,
    receipt: {
      available: true,
      createdAt: "2026-09-18T00:00:00.000Z",
      firstClaimAt: null,
      acceptanceObservedAt: null,
      stoppedAt: null,
      submissions: 1,
    },
  };
  for (const suppressedAt of [undefined, null, "2026-09-18T00:00:01.000Z"])
    expect(
      mailOperationSchema.safeParse({
        ...operation,
        receipt: { ...operation.receipt, suppressedAt },
      }).success,
    ).toBe(true);
  expect(
    mailOperationSchema.safeParse({
      ...operation,
      receipt: { ...operation.receipt, suppressedAt: "unknown" },
    }).success,
  ).toBe(false);
});

test("attachment wire states exclude provider details and require retained integrity or terminal reason", () => {
  const part = {
    attachmentId: request.operationId,
    ordinal: 0,
    filename: null,
    contentType: null,
    disposition: null,
    contentId: null,
  };
  expect(
    mailAttachmentSchema.safeParse({ ...part, state: "pending" }).success,
  ).toBe(true);
  expect(
    mailAttachmentSchema.safeParse({
      ...part,
      state: "retained",
      bytes: 0,
      sha256: "a".repeat(64),
    }).success,
  ).toBe(true);
  expect(
    mailAttachmentSchema.safeParse({
      ...part,
      state: "omitted",
      reason: "storage_limited",
    }).success,
  ).toBe(true);
  expect(
    mailAttachmentSchema.safeParse({
      ...part,
      state: "omitted",
      reason: "preparation_canceled",
    }).success,
  ).toBe(true);
  for (const extra of [
    { state: "omitted", reason: "unknown_reason" },
    { state: "retained" },
    { state: "omitted" },
    { state: "pending", providerId: "private" },
    { state: "pending", downloadUrl: "https://private.test" },
  ])
    expect(mailAttachmentSchema.safeParse({ ...part, ...extra }).success).toBe(
      false,
    );
  expect(
    mailAttachmentListRequestSchema.safeParse({
      messageId: request.operationId,
      after: -1,
    }).success,
  ).toBe(false);
  expect(
    mailAttachmentListRequestSchema.safeParse({
      messageId: request.operationId,
      limit: 101,
    }).success,
  ).toBe(false);
});

test("attachment progress counts reject inconsistent totals", () => {
  const value = {
    messageId: request.operationId,
    mailboxId: request.operationId,
    direction: "incoming",
    operationId: null,
    createdAt: "2026-09-18T00:00:00Z",
    trashedAt: null,
    retainedBytes: 0,
    display: {},
    metadataOmissions: [],
    attachmentOmissions: 0,
    text: { state: "absent" },
    html: { state: "absent" },
    attachmentProgress: { total: 3, retained: 1, pending: 2, omitted: 0 },
  };
  expect(mailMessageSchema.safeParse(value).success).toBe(true);
  expect(
    mailMessageSchema.safeParse({
      ...value,
      attachmentProgress: { ...value.attachmentProgress, pending: 3 },
    }).success,
  ).toBe(false);
});

test("Mail change pages require one continuation and bounded positions", () => {
  const checkpoint = {
    state: "changes",
    items: [],
    nextCursor: null,
    checkpoint: "opaque",
  };
  expect(mailChangesSchema.safeParse(checkpoint).success).toBe(true);
  expect(
    mailChangesSchema.safeParse({ ...checkpoint, checkpoint: null }).success,
  ).toBe(false);
  expect(
    mailChangesSchema.safeParse({ ...checkpoint, nextCursor: "also" }).success,
  ).toBe(false);
  expect(
    mailChangesSchema.safeParse({
      state: "gap",
      reason: "history_expired",
      baselineRequired: true,
    }).success,
  ).toBe(true);
  expect(
    mailChangesSchema.safeParse({
      state: "gap",
      reason: "history_expired",
      baselineRequired: false,
    }).success,
  ).toBe(false);
  const item = {
    id: request.operationId,
    resourceId: request.operationId,
    resourceKind: "message",
    actorId: null,
    position: "9223372036854775807",
    occurredAt: "2026-09-18T00:00:00Z",
  };
  expect(
    mailChangesSchema.safeParse({ ...checkpoint, items: [item] }).success,
  ).toBe(true);
  for (const position of ["0", "01", "-1", "9223372036854775808"])
    expect(
      mailChangesSchema.safeParse({
        ...checkpoint,
        items: [{ ...item, position }],
      }).success,
    ).toBe(false);
  for (const limit of [0, 101, 1.5])
    expect(
      mailChangesRequestSchema.safeParse({
        mailboxId: request.operationId,
        cursor: "opaque",
        limit,
      }).success,
    ).toBe(false);
});

test("outgoing attachment selections accept only bounded immutable resource references", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const part = { kind: "files", workplaceId: id, fileId: id, revisionId: id };
  const request = {
    operationId: id,
    to: "recipient@example.test",
    subject: "Copy",
    text: "body",
  };
  expect(
    sendMailRequestSchema.safeParse({ ...request, attachments: [part] })
      .success,
  ).toBe(true);
  for (const attachments of [
    [],
    Array.from({ length: 11 }, () => part),
    [{ ...part, revisionId: "latest" }],
    [{ ...part, url: "https://example.test/private" }],
    [{ kind: "mail", workplaceId: id, messageId: id, attachmentId: id }],
  ])
    expect(
      sendMailRequestSchema.safeParse({ ...request, attachments }).success,
    ).toBe(false);
});
