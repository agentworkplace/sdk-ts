import { z } from "zod";
export const mailboxAddressChoiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("automatic") }).strict(),
  z
    .object({
      kind: z.literal("exact"),
      localPart: z.string().trim().min(3).max(48),
    })
    .strict(),
]);
export type MailboxAddressChoice = z.infer<typeof mailboxAddressChoiceSchema>;
export const mailboxSchema = z.object({
  mailboxId: z.uuid(),
  accountId: z.uuid(),
  address: z.email(),
});
export type Mailbox = z.infer<typeof mailboxSchema>;
export const mailboxListRequestSchema = z
  .object({
    after: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export const mailboxListSchema = z.object({
  mailboxes: z.array(mailboxSchema),
  nextCursor: z.uuid().nullable(),
});
export type MailboxList = z.infer<typeof mailboxListSchema>;

// Runtime-independent UTF-8 wire bound (contracts are also used outside Node).
function utf8Bytes(value: string) {
  let size = 0;
  // Index code points directly: a character iterator adds substantial allocation
  // pressure when validating many maximum-size retained Mail representations.
  for (let index = 0; index < value.length; index++) {
    const point = value.codePointAt(index)!;
    size += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (point > 0xffff) index++;
  }
  return size;
}

/** Canonical wire recipient groups. Preserve external local-part case and aliases. */
export function normalizeMailRecipients(input: {
  to: string | string[];
  cc?: string[];
  bcc?: string[];
}) {
  const canonical = (address: string) => {
    const at = address.lastIndexOf("@");
    const domain = address.slice(at + 1).toLowerCase();
    const local = address.slice(0, at);
    return `${domain === "mail.agentworkplace.dev" ? local.toLowerCase() : local}@${domain}`;
  };
  const unique = (values: string[]) => [...new Set(values.map(canonical))];
  const to = unique(typeof input.to === "string" ? [input.to] : input.to);
  const cc = unique(input.cc ?? []).filter((address) => !to.includes(address));
  const bcc = unique(input.bcc ?? []);
  return { to, cc, bcc };
}
function validRecipients(input: {
  to: string | string[];
  cc?: string[];
  bcc?: string[];
}) {
  const { to, cc, bcc } = normalizeMailRecipients(input);
  return (
    to.length > 0 &&
    to.length + cc.length + bcc.length <= 10 &&
    !bcc.some((address) => to.includes(address) || cc.includes(address))
  );
}
const recipientAddress = z.email().max(320);
export const mailRecipientsSchema = z
  .object({
    to: z.array(recipientAddress).min(1).max(10),
    cc: z.array(recipientAddress).max(10),
    bcc: z.array(recipientAddress).max(10),
  })
  .strict()
  .refine(validRecipients);
export type MailRecipients = z.infer<typeof mailRecipientsSchema>;

/** Explicit immutable sources; never provider URLs or mutable latest revisions. */
export const mailOutgoingAttachmentSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("files"),
      workplaceId: z.uuid().transform((value) => value.toLowerCase()),
      fileId: z.uuid().transform((value) => value.toLowerCase()),
      revisionId: z.uuid().transform((value) => value.toLowerCase()),
    })
    .strict(),
  z
    .object({
      kind: z.literal("mail"),
      workplaceId: z.uuid().transform((value) => value.toLowerCase()),
      mailboxId: z.uuid().transform((value) => value.toLowerCase()),
      messageId: z.uuid().transform((value) => value.toLowerCase()),
      attachmentId: z.uuid().transform((value) => value.toLowerCase()),
    })
    .strict(),
]);
export type MailOutgoingAttachmentSource = z.infer<
  typeof mailOutgoingAttachmentSourceSchema
>;
export const mailAttachmentSelectionSchema = z
  .array(mailOutgoingAttachmentSourceSchema)
  .min(1)
  .max(10);
const outgoingAttachments = mailAttachmentSelectionSchema.optional();

/** Up to ten unique recipients and one immutable UTF-8 plain-text body. */
export const sendMailRequestSchema = z
  .object({
    operationId: z.uuid(),
    mailboxId: z.uuid().optional(),
    attachments: outgoingAttachments,
    to: z.union([recipientAddress, z.array(recipientAddress).min(1)]),
    cc: z.array(recipientAddress).optional(),
    bcc: z.array(recipientAddress).optional(),
    subject: z
      .string()
      .max(998)
      .refine(
        (value) =>
          !/[\r\n\0]/.test(value) &&
          !/\p{Surrogate}/u.test(value) &&
          utf8Bytes(value) <= 998,
      ),
    text: z
      .string()
      .max(262144)
      .refine(
        (value) =>
          !value.includes("\0") &&
          !/\p{Surrogate}/u.test(value) &&
          utf8Bytes(value) <= 262144,
      ),
  })
  .strict()
  .refine(validRecipients);
export type SendMailRequest = z.infer<typeof sendMailRequestSchema>;

/** Agent-authored reply/forward intent; destinations for replies are server-selected. */
export const composeMailRequestSchema = z
  .object({
    operationId: z.uuid(),
    mailboxId: z.uuid().optional(),
    sourceMessageId: z.uuid(),
    attachments: outgoingAttachments,
    kind: z.enum(["reply", "reply_all", "forward"]),
    to: z.array(recipientAddress).min(1).max(10).optional(),
    cc: z.array(recipientAddress).max(10).optional(),
    bcc: z.array(recipientAddress).max(10).optional(),
    subject: sendMailRequestSchema.shape.subject,
    text: sendMailRequestSchema.shape.text,
  })
  .strict()
  .refine((value) =>
    value.kind === "forward"
      ? !!value.to &&
        validRecipients({ to: value.to, cc: value.cc, bcc: value.bcc })
      : value.to === undefined &&
        value.cc === undefined &&
        value.bcc === undefined,
  );
export type ComposeMailRequest = z.infer<typeof composeMailRequestSchema>;

// Supported RFC 5322 dot-atom subset; quoted and domain-literal IDs are rejected.
const messageIdAtom = "[!#$%&'*+\\-/0-9=?A-Z^_`a-z{|}~]+";
const messageIdDotAtom = `${messageIdAtom}(?:\\.${messageIdAtom})*`;
const rfcMessageId = z
  .string()
  .max(998)
  .regex(new RegExp(`^<${messageIdDotAtom}@${messageIdDotAtom}>$`));
export const mailCorrespondenceSchema = z
  .object({
    kind: z.enum(["reply", "reply_all", "forward"]),
    sourceMessageId: z.uuid(),
    messageId: rfcMessageId,
    inReplyTo: rfcMessageId.optional(),
    references: z.array(rfcMessageId).max(100),
  })
  .strict()
  .refine((value) => utf8Bytes(value.references.join(" ")) <= 8192);
export type MailCorrespondence = z.infer<typeof mailCorrespondenceSchema>;

export const mailOperationIdSchema = z.uuid();
export const mailOperationSchema = z.object({
  operationId: z.uuid(),
  mailboxId: z.uuid(),
  state: z.enum(["queued", "uncertain", "accepted", "failed", "canceled"]),
  contentRetained: z.boolean(),
  recipientCount: z.number().int().min(1).max(10).optional(),
  receipt: z.discriminatedUnion("available", [
    z.object({
      available: z.literal(true),
      createdAt: z.iso.datetime(),
      firstClaimAt: z.iso.datetime().nullable(),
      acceptanceObservedAt: z.iso.datetime().nullable(),
      suppressedAt: z.iso.datetime().nullable().optional(),
      stoppedAt: z.iso.datetime().nullable(),
      submissions: z.number().int().min(0).max(3),
    }),
    z.object({
      available: z.literal(false),
      reason: z.enum(["expired", "evidence_unavailable"]),
    }),
  ]),
});
export type MailOperation = z.infer<typeof mailOperationSchema>;

/** Presence is evidence: legacy zero-byte representations can remain unknown. */
export const mailBodyRepresentationSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("present"),
      content: z
        .string()
        .max(1048576)
        .refine(
          (value) =>
            !/\p{Surrogate}/u.test(value) && utf8Bytes(value) <= 1048576,
        ),
    })
    .strict(),
  z.object({ state: z.literal("absent") }).strict(),
  z.object({ state: z.literal("unknown") }).strict(),
]);
export type MailBodyRepresentation = z.infer<
  typeof mailBodyRepresentationSchema
>;
export const mailDisplayFieldSchema = z.enum([
  "from",
  "subject",
  "to",
  "cc",
  "reply-to",
  "message-id",
  "in-reply-to",
  "references",
  "auto-submitted",
]);
const displayValue = z
  .string()
  .max(8192)
  .refine((value) => !/\p{Surrogate}/u.test(value) && utf8Bytes(value) <= 8192);
export const mailDisplayMetadataSchema = z
  .object({
    from: displayValue.optional(),
    subject: displayValue.optional(),
    to: displayValue.optional(),
    cc: displayValue.optional(),
    "reply-to": displayValue.optional(),
    "message-id": displayValue.optional(),
    "in-reply-to": displayValue.optional(),
    references: displayValue.optional(),
    "auto-submitted": displayValue.optional(),
  })
  .strict();
export const mailMessageSummarySchema = z
  .object({
    messageId: z.uuid(),
    mailboxId: z.uuid(),
    direction: z.enum(["incoming", "outgoing"]),
    operationId: z.uuid().nullable(),
    createdAt: z.iso.datetime(),
    trashedAt: z.iso.datetime().nullable(),
    archivedAt: z.iso.datetime().nullable().optional(),
    retainedBytes: z.number().int().min(0).max(1048576),
    display: mailDisplayMetadataSchema,
    metadataOmissions: z.array(mailDisplayFieldSchema).max(9),
    attachmentOmissions: z.number().int().min(0),
    attachmentProgress: z
      .object({
        total: z.number().int().min(0),
        pending: z.number().int().min(0),
        retained: z.number().int().min(0).max(10),
        omitted: z.number().int().min(0),
      })
      .strict()
      .refine(
        (value) =>
          value.pending + value.retained + value.omitted === value.total,
      )
      .optional(),
    outgoingRecipients: mailRecipientsSchema.optional(),
    correspondence: mailCorrespondenceSchema.optional(),
  })
  .strict();
export type MailMessageSummary = z.infer<typeof mailMessageSummarySchema>;
export const mailMessageSchema = mailMessageSummarySchema
  .extend({
    text: mailBodyRepresentationSchema,
    html: mailBodyRepresentationSchema,
  })
  .refine(
    (value) =>
      (value.text.state === "present" ? utf8Bytes(value.text.content) : 0) +
        (value.html.state === "present" ? utf8Bytes(value.html.content) : 0) ===
      value.retainedBytes,
  );
export type MailMessage = z.infer<typeof mailMessageSchema>;
export const mailTargetRequestSchema = z
  .object({ mailboxId: z.uuid().optional() })
  .strict();
export const mailMessageListRequestSchema = mailTargetRequestSchema.extend({
  after: z
    .string()
    .max(512)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  view: z.enum(["active", "archive", "all", "trash"]).default("active"),
  direction: z.enum(["incoming", "outgoing"]).optional(),
  subject: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .refine((value) => !/[\p{Cc}\p{Surrogate}]/u.test(value))
    .transform((value) => value.toLowerCase())
    .optional(),
});
export type MailMessageListRequest = z.input<
  typeof mailMessageListRequestSchema
>;
export const mailMessageListSchema = z
  .object({
    messages: z.array(mailMessageSummarySchema).max(100),
    nextCursor: z.string().max(512).nullable(),
  })
  .strict();
export type MailMessageList = z.infer<typeof mailMessageListSchema>;
export const mailOmissionListRequestSchema = mailTargetRequestSchema.extend({
  after: z
    .string()
    .max(512)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type MailOmissionListRequest = z.input<
  typeof mailOmissionListRequestSchema
>;
export const mailOmissionSchema = z
  .object({
    omissionId: z.uuid(),
    mailboxId: z.uuid(),
    finishedAt: z.iso.datetime(),
    reason: z.enum([
      "sender_blocked",
      "body_too_large",
      "attachment_only",
      "incoming_limited",
      "storage_limited",
    ]),
  })
  .strict();
export const mailOmissionListSchema = z
  .object({
    omissions: z.array(mailOmissionSchema).max(100),
    nextCursor: z.string().max(512).nullable(),
  })
  .strict();
export type MailOmissionList = z.infer<typeof mailOmissionListSchema>;

// Encoded Mail pagination positions are untrusted wire data, never authority.
export const mailPagePositionSchema = z
  .object({
    version: z.literal(1),
    mailboxId: z.uuid(),
    view: z.enum([
      "active",
      "archive",
      "all",
      "trash",
      "omissions",
      "preparations",
    ]),
    queryHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    time: z.iso.datetime().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/),
    id: z.uuid(),
  })
  .strict();
export type MailPagePosition = z.infer<typeof mailPagePositionSchema>;
export const mailMessageReadRequestSchema = mailTargetRequestSchema.extend({
  messageId: z.uuid(),
});
export const mailMetadataOmissionsSchema = z
  .array(mailDisplayFieldSchema)
  .max(9);

export const mailContentActionSchema = z.enum([
  "trash",
  "restore",
  "purge",
  "archive",
  "unarchive",
]);
export type MailContentAction = z.infer<typeof mailContentActionSchema>;
export const mailContentChangeRequestSchema =
  mailMessageReadRequestSchema.extend({
    action: mailContentActionSchema,
  });
export const mailContentAcknowledgementSchema = z
  .object({
    acknowledged: z.literal(true),
  })
  .strict();
export type MailContentAcknowledgement = z.infer<
  typeof mailContentAcknowledgementSchema
>;

export const mailSenderBlockRequestSchema = mailTargetRequestSchema.extend({
  sender: recipientAddress,
});
export type MailSenderBlockRequest = z.infer<
  typeof mailSenderBlockRequestSchema
>;
export const mailSenderBlockStateSchema = z
  .object({
    mailboxId: z.uuid(),
    sender: recipientAddress,
    blocked: z.boolean(),
  })
  .strict();
export type MailSenderBlockState = z.infer<typeof mailSenderBlockStateSchema>;
export const mailSenderBlockListRequestSchema = mailTargetRequestSchema.extend({
  after: z
    .string()
    .max(512)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type MailSenderBlockListRequest = z.input<
  typeof mailSenderBlockListRequestSchema
>;
export const mailSenderBlockListSchema = z
  .object({
    blocks: z
      .array(
        z
          .object({ sender: recipientAddress, createdAt: z.iso.datetime() })
          .strict(),
      )
      .max(100),
    nextCursor: z.string().max(512).nullable(),
  })
  .strict();
export type MailSenderBlockList = z.infer<typeof mailSenderBlockListSchema>;
export const mailSenderBlockPositionSchema = z
  .object({
    version: z.literal(1),
    mailboxId: z.uuid(),
    id: z.uuid(),
  })
  .strict();

export const mailThreadReadRequestSchema = mailMessageReadRequestSchema.extend({
  after: mailMessageListRequestSchema.shape.after,
  limit: mailMessageListRequestSchema.shape.limit,
});
export type MailThreadReadRequest = z.input<typeof mailThreadReadRequestSchema>;
export const mailThreadPositionSchema = mailPagePositionSchema
  .pick({ time: true, id: true })
  .extend({
    version: z.literal(1),
    mailboxId: z.uuid(),
    seedMessageId: z.uuid(),
    groupId: z.uuid(),
    revision: z.string().regex(/^[1-9][0-9]{0,18}$/),
  });
export const mailThreadMessageSchema = mailMessageSummarySchema.extend({
  limitedFields: z
    .array(
      z.enum([
        "message-id",
        "in-reply-to",
        "references",
        "observed-message-id",
      ]),
    )
    .max(4),
  observedRfcMessageId: rfcMessageId.nullable(),
});
export const mailThreadSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("indexing"),
      mailboxId: z.uuid(),
      seedMessageId: z.uuid(),
    })
    .strict(),
  z
    .object({
      state: z.literal("ready"),
      mailboxId: z.uuid(),
      seedMessageId: z.uuid(),
      groupId: z.uuid(),
      revision: z.string().regex(/^[1-9][0-9]{0,18}$/),
      association: z.literal("historical_hints"),
      messages: z.array(mailThreadMessageSchema).max(100),
      nextCursor: z.string().max(512).nullable(),
    })
    .strict(),
]);
export type MailThread = z.infer<typeof mailThreadSchema>;

export const mailAttachmentListRequestSchema = mailTargetRequestSchema.extend({
  messageId: z.uuid(),
  after: z.coerce.number().int().min(0).max(2147483647).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type MailAttachmentListRequest = z.input<
  typeof mailAttachmentListRequestSchema
>;
const attachmentDisplay = z.object({
  attachmentId: z.uuid(),
  ordinal: z.number().int().min(0),
  filename: z.string().max(1024).nullable(),
  contentType: z.string().max(255).nullable(),
  disposition: z.enum(["inline", "attachment"]).nullable(),
  contentId: z.string().max(1024).nullable(),
});
export const mailRetainedAttachmentSchema = attachmentDisplay
  .extend({
    state: z.literal("retained"),
    bytes: z.number().int().min(0).max(10000000),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const mailAttachmentSchema = z.discriminatedUnion("state", [
  attachmentDisplay.extend({ state: z.literal("pending") }).strict(),
  mailRetainedAttachmentSchema,
  attachmentDisplay
    .extend({
      state: z.literal("omitted"),
      reason: z.enum([
        "part_too_large",
        "attachment_count",
        "attachment_bytes",
        "storage_limited",
        "incoming_limited",
        "retrieval_expired",
        "preparation_canceled",
      ]),
    })
    .strict(),
]);
export const mailAttachmentListSchema = z
  .object({
    messageId: z.uuid(),
    attachments: z.array(mailAttachmentSchema).max(100),
    nextAfter: z.number().int().min(0).nullable(),
    preparation: z
      .object({
        state: z.enum(["pending", "complete"]),
        expiresAt: z.iso.datetime(),
        registeredParts: z.number().int().min(0),
        totalParts: z.number().int().min(0),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type MailAttachmentList = z.infer<typeof mailAttachmentListSchema>;

export const mailPreparationListRequestSchema = mailOmissionListRequestSchema;
export type MailPreparationListRequest = z.input<
  typeof mailPreparationListRequestSchema
>;
export const mailPreparationListSchema = z
  .object({
    preparations: z
      .array(
        z
          .object({
            messageId: z.uuid(),
            mailboxId: z.uuid(),
            state: z.literal("pending"),
            preparedAt: z.iso.datetime(),
            expiresAt: z.iso.datetime(),
            registeredParts: z.number().int().min(0),
            totalParts: z.number().int().min(0),
          })
          .strict(),
      )
      .max(100),
    nextCursor: z.string().max(512).nullable(),
  })
  .strict();
export type MailPreparationList = z.infer<typeof mailPreparationListSchema>;

export const mailAttachmentDownloadRequestSchema =
  mailTargetRequestSchema.extend({
    messageId: z.uuid(),
    attachmentId: z.uuid(),
  });
export type MailAttachmentDownloadRequest = z.infer<
  typeof mailAttachmentDownloadRequestSchema
>;
export const mailAttachmentDownloadGrantSchema = z
  .object({
    messageId: z.uuid(),
    attachment: mailRetainedAttachmentSchema,
    url: z.url(),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export type MailAttachmentDownloadGrant = z.infer<
  typeof mailAttachmentDownloadGrantSchema
>;

/** Opaque, scoped Mail consumer position; it is not authorization evidence. */
export const mailChangeCursorSchema = z.string().min(1).max(512);
export const mailCheckpointRequestSchema = z
  .object({ mailboxId: z.uuid() })
  .strict();
export type MailCheckpointRequest = z.infer<typeof mailCheckpointRequestSchema>;
export const mailCheckpointSchema = z.object({
  checkpoint: mailChangeCursorSchema,
});
export type MailCheckpoint = z.infer<typeof mailCheckpointSchema>;
export const mailChangesRequestSchema = z
  .object({
    mailboxId: z.uuid(),
    cursor: mailChangeCursorSchema,
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type MailChangesRequest = z.infer<typeof mailChangesRequestSchema>;
export const mailChangesSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("gap"),
    reason: z.enum(["history_expired", "checkpoint_unavailable"]),
    baselineRequired: z.literal(true),
  }),
  z
    .object({
      state: z.literal("changes"),
      items: z
        .array(
          z.object({
            id: z.uuid(),
            position: z
              .string()
              .regex(/^[1-9][0-9]{0,18}$/)
              .refine((value) => BigInt(value) <= 9223372036854775807n),
            resourceKind: z.enum([
              "message",
              "arrival",
              "operation",
              "mailbox",
            ]),
            resourceId: z.uuid(),
            actorId: z.uuid().nullable(),
            occurredAt: z.iso.datetime(),
          }),
        )
        .max(100),
      nextCursor: mailChangeCursorSchema.nullable(),
      checkpoint: mailChangeCursorSchema.nullable(),
    })
    .refine(
      (value) => (value.nextCursor === null) !== (value.checkpoint === null),
    ),
]);
export type MailChanges = z.infer<typeof mailChangesSchema>;

export const mailOperationListRequestSchema = z
  .object({
    mailboxId: z.uuid(),
    after: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type MailOperationListRequest = z.infer<
  typeof mailOperationListRequestSchema
>;
export const mailOperationListSchema = z.object({
  operations: z.array(z.object({ operationId: z.uuid() })).max(100),
  nextCursor: z.uuid().nullable(),
});
export type MailOperationList = z.infer<typeof mailOperationListSchema>;
