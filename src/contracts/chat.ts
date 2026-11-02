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

/** `created` (the default) is the complete discovery order; `activity` puts
 * the most recently created or posted-to conversation first. */
export const chatListOrderSchema = z.enum(["created", "activity"]);
export type ChatListOrder = z.infer<typeof chatListOrderSchema>;
/** Opt-in listing additions. On the wire, one comma-separated `include`. */
export const chatListIncludeSchema = z.enum(["accounts", "latest_entry"]);
export type ChatListInclude = z.infer<typeof chatListIncludeSchema>;
const listInclude = z
  .union([
    z
      .string()
      .max(64)
      .regex(/^[a-z_]+(,[a-z_]+)*$/)
      .transform((value) => value.split(",")),
    z.array(chatListIncludeSchema).max(2),
  ])
  .pipe(
    z
      .array(chatListIncludeSchema)
      .min(1)
      .max(2)
      .refine((values) => new Set(values).size === values.length),
  );
export const chatListRequestSchema = z
  .object({
    after: cursor.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    // No default: omitting it keeps requests readable by earlier servers.
    order: chatListOrderSchema.optional(),
    include: listInclude.optional(),
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

/** Plain-text start of a message, at most 280 UTF-8 bytes. */
export const chatPreviewSchema = z
  .string()
  .max(280)
  .refine(
    (value) => !/[\0\p{Surrogate}]/u.test(value) && utf8Bytes(value) <= 280,
  );
/** The entry that last moved the conversation in activity order: its latest
 * message, or its creation entry before any message. */
export const chatLatestEntrySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("message"),
      sequence: entrySequence,
      actorId: id,
      createdAt: instant,
      preview: chatPreviewSchema,
      truncated: z.boolean(),
      referenceCount: z.number().int().min(0).max(10),
    })
    .strict(),
  z
    .object({
      kind: z.literal("created"),
      sequence: z.literal("1"),
      actorId: id,
      createdAt: instant,
      accountIds,
    })
    .strict(),
]);
export type ChatLatestEntry = z.infer<typeof chatLatestEntrySchema>;
export const chatConversationWithLatestEntrySchema = chatConversationSchema
  .extend({ latestEntry: chatLatestEntrySchema })
  .strict();
export type ChatConversationWithLatestEntry = z.infer<
  typeof chatConversationWithLatestEntrySchema
>;
/** Opt-in account summaries; responses without it keep their original shape. */
const include = z.enum(["accounts"]).optional();
export const chatConversationRequestSchema = z.object({ include }).strict();
export type ChatConversationRequest = z.input<
  typeof chatConversationRequestSchema
>;
export const chatEntriesRequestSchema = z
  .object({
    after: chatSequenceSchema.default("0"),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    include,
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

/** Current descriptive data for an account on the page. The account ID is the
 * identity; names are mutable, may repeat, and are untrusted display text. */
export const chatAccountSummarySchema = z
  .object({
    accountId: id,
    name: z.string().nullable(),
    kind: z.enum(["agent", "human"]),
    state: z.enum(["active", "removed"]),
  })
  .strict();
export type ChatAccountSummary = z.infer<typeof chatAccountSummarySchema>;
const accountSummaries = (maximum: number) =>
  z
    .array(chatAccountSummarySchema)
    .max(maximum)
    .refine(
      (values) =>
        new Set(values.map((value) => value.accountId)).size === values.length,
    );
export const chatConversationWithAccountsSchema = chatConversationSchema
  .extend({ accounts: accountSummaries(100) })
  .strict();
export type ChatConversationWithAccounts = z.infer<
  typeof chatConversationWithAccountsSchema
>;
/** One actor plus up to 100 affected accounts for each of 50 entries. */
export const chatEntriesWithAccountsSchema = chatEntriesSchema
  .extend({ accounts: accountSummaries(50 * 101) })
  .strict();
export type ChatEntriesWithAccounts = z.infer<
  typeof chatEntriesWithAccountsSchema
>;

/** Each listed conversation names up to 100 participants, its latest actor
 * and up to 100 created accounts. */
export const chatListAccountsSchema = accountSummaries(50 * 201);
/** A list page with exactly the requested additions. */
export function chatListPageSchema(include: readonly ChatListInclude[] = []) {
  const latest = include.includes("latest_entry");
  const page = z.object({
    conversations: z
      .array(
        latest ? chatConversationWithLatestEntrySchema : chatConversationSchema,
      )
      .max(50),
    nextCursor: cursor.nullable(),
  });
  return (
    include.includes("accounts")
      ? page.extend({ accounts: chatListAccountsSchema })
      : page
  ).strict();
}
/** Whether a page has an addition: a literal tuple says exactly; a widened
 * array leaves it possible. */
type Requested<
  Include extends readonly ChatListInclude[],
  Key extends ChatListInclude,
> = Key extends Include[number]
  ? number extends Include["length"]
    ? "maybe"
    : "yes"
  : "no";
/** The list page for an `include` value, typed by what it requests. */
export type ChatListPage<
  Include extends readonly ChatListInclude[] = readonly [],
> = {
  conversations: (Requested<Include, "latest_entry"> extends "yes"
    ? ChatConversationWithLatestEntry
    : Requested<Include, "latest_entry"> extends "maybe"
      ? ChatConversation & { latestEntry?: ChatLatestEntry }
      : ChatConversation)[];
  nextCursor: string | null;
} & (Requested<Include, "accounts"> extends "yes"
  ? { accounts: ChatAccountSummary[] }
  : Requested<Include, "accounts"> extends "maybe"
    ? { accounts?: ChatAccountSummary[] }
    : unknown);

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
/** Encoded activity cursor: continues below the last returned position. */
export const chatActivityPositionSchema = z
  .object({
    version: z.literal(1),
    order: z.literal("activity"),
    workplaceId: id,
    accountId: id,
    admin: z.boolean(),
    before: chatSequenceSchema,
  })
  .strict();
