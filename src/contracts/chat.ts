import { z } from "zod";

const id = z.uuid().transform((value) => value.toLowerCase());
const cursor = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/);
const instant = z.iso.datetime();

// No Node dependency: these wire schemas also run in browsers and public clients.
function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

/** Canonical decimal PostgreSQL bigint; zero is the position before creation. */
export const chatSequenceSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,18})$/)
  .refine(
    (value) =>
      /^(0|[1-9][0-9]{0,18})$/.test(value) &&
      BigInt(value) <= 9223372036854775807n,
  );
export type ChatSequence = z.infer<typeof chatSequenceSchema>;
const entrySequence = chatSequenceSchema.refine((value) => value !== "0");

export const chatTextSchema = z
  .string()
  .min(1)
  .max(64_000)
  .refine(
    (value) => !/[\0\p{Surrogate}]/u.test(value) && utf8Bytes(value) <= 64_000,
  );
export const chatTopicSchema = z
  .string()
  .min(1)
  .max(1_000)
  .refine(
    (value) => !/[\0\p{Surrogate}]/u.test(value) && utf8Bytes(value) <= 1_000,
  );

/** Identifiers only. Resolving a reference is a separate, authorized resource read. */
export const chatReferenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file"), fileId: id }).strict(),
  z
    .object({ kind: z.literal("mail_message"), mailboxId: id, messageId: id })
    .strict(),
]);
export type ChatReference = z.infer<typeof chatReferenceSchema>;
const references = z
  .array(chatReferenceSchema)
  .max(10)
  .refine(
    (values) =>
      new Set(values.map((value) => JSON.stringify(value))).size ===
      values.length,
  );
const accountIds = z
  .array(id)
  .min(1)
  .max(100)
  .refine((values) => new Set(values).size === values.length);

export const chatParticipantSchema = z
  .object({ accountId: id, joinedSequence: entrySequence })
  .strict();
export type ChatParticipant = z.infer<typeof chatParticipantSchema>;
export const chatConversationSchema = z
  .object({
    conversationId: id,
    topic: chatTopicSchema.nullable(),
    createdAt: instant,
    participants: z.array(chatParticipantSchema).max(100),
    latestSequence: entrySequence,
  })
  .strict();
export type ChatConversation = z.infer<typeof chatConversationSchema>;

const entryFields = {
  entryId: id,
  conversationId: id,
  sequence: entrySequence,
  actorId: id,
  createdAt: instant,
};
export const chatMessageSchema = z
  .object({
    ...entryFields,
    kind: z.literal("message"),
    text: chatTextSchema,
    references,
  })
  .strict();
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export const chatSystemEntrySchema = z
  .object({
    ...entryFields,
    kind: z.enum(["created", "joined", "left", "removed"]),
    accountIds,
  })
  .strict();
export const chatEntrySchema = z.discriminatedUnion("kind", [
  chatMessageSchema,
  chatSystemEntrySchema,
]);
export type ChatEntry = z.infer<typeof chatEntrySchema>;

/** Includes the creator; backend verifies that every account is an active agent. */
export const chatCreateRequestSchema = z
  .object({
    operationId: id,
    accountIds: accountIds.refine((values) => values.length >= 2),
    topic: chatTopicSchema.optional(),
  })
  .strict();
export type ChatCreateRequest = z.infer<typeof chatCreateRequestSchema>;
export const chatPostRequestSchema = z
  .object({
    operationId: id,
    text: chatTextSchema,
    references: references.default([]),
  })
  .strict();
export type ChatPostRequest = z.input<typeof chatPostRequestSchema>;

/** Every membership intent has durable identity, including successful no-ops. */
export const chatAddRequestSchema = z
  .object({ operationId: id, accountIds })
  .strict();
export type ChatAddRequest = z.infer<typeof chatAddRequestSchema>;
export const chatLeaveRequestSchema = z.object({ operationId: id }).strict();
export type ChatLeaveRequest = z.infer<typeof chatLeaveRequestSchema>;
export const chatRemoveRequestSchema = z
  .object({ operationId: id, accountId: id })
  .strict();
export type ChatRemoveRequest = z.infer<typeof chatRemoveRequestSchema>;

/** Deleted retry evidence carries no topic, text, participant list, or references. */
export const chatDeletedOutcomeSchema = z
  .object({
    state: z.literal("deleted"),
    conversationId: id,
    deletedAt: instant,
  })
  .strict();
export const chatCreateOutcomeSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("created"),
      conversationId: id,
      sequence: z.literal("1"),
    })
    .strict(),
  chatDeletedOutcomeSchema,
]);
export type ChatCreateOutcome = z.infer<typeof chatCreateOutcomeSchema>;
export const chatPostOutcomeSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("posted"), entry: chatMessageSchema }).strict(),
  chatDeletedOutcomeSchema,
]);
export type ChatPostOutcome = z.infer<typeof chatPostOutcomeSchema>;
export const chatMembershipOutcomeSchema = z
  .object({
    conversationId: id,
    changed: z.boolean(),
    entry: chatSystemEntrySchema.nullable(),
  })
  .strict()
  .refine((value) => value.changed === (value.entry !== null));
export type ChatMembershipOutcome = z.infer<typeof chatMembershipOutcomeSchema>;
export const chatDeleteOutcomeSchema = chatDeletedOutcomeSchema.extend({
  storageReleased: z.literal(true),
  cleanup: z.enum(["pending", "complete"]),
});
export type ChatDeleteOutcome = z.infer<typeof chatDeleteOutcomeSchema>;

export const chatListRequestSchema = z
  .object({
    after: cursor.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export type ChatListRequest = z.input<typeof chatListRequestSchema>;
export const chatListSchema = z
  .object({
    conversations: z.array(chatConversationSchema).max(50),
    nextCursor: cursor.nullable(),
  })
  .strict();
export type ChatList = z.infer<typeof chatListSchema>;
export const chatEntriesRequestSchema = z
  .object({
    after: chatSequenceSchema.default("0"),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export type ChatEntriesRequest = z.input<typeof chatEntriesRequestSchema>;
export const chatEntriesSchema = z
  .object({
    entries: z.array(chatEntrySchema).max(50),
    nextAfter: entrySequence.nullable(),
    latestSequence: entrySequence,
  })
  .strict();
export type ChatEntries = z.infer<typeof chatEntriesSchema>;

/** Encoded discovery cursor: data for traversal, never authorization. */
export const chatListPositionSchema = z
  .object({
    version: z.literal(1),
    workplaceId: id,
    accountId: id,
    admin: z.boolean(),
    through: chatSequenceSchema,
    after: chatSequenceSchema,
  })
  .strict();
