import { expect, test } from "vitest";
import {
  chatAddRequestSchema,
  chatConversationRequestSchema,
  chatConversationSchema,
  chatConversationWithAccountsSchema,
  chatCreateRequestSchema,
  chatDeletedOutcomeSchema,
  chatEntriesRequestSchema,
  chatEntriesSchema,
  chatEntriesWithAccountsSchema,
  chatEntrySchema,
  chatLatestEntrySchema,
  chatListPageSchema,
  chatListRequestSchema,
  chatMembershipOutcomeSchema,
  chatPostRequestSchema,
  chatSequenceSchema,
  chatTextSchema,
  chatTopicSchema,
} from "./chat.js";

const alice = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bob = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const operationId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const entry = {
  entryId: operationId,
  conversationId: operationId,
  actorId: alice,
  sequence: "9007199254740993",
  createdAt: "2026-10-09T12:00:00.000Z",
};

test("Chat positions retain exact bigint values without accepting numeric approximations", () => {
  for (const value of ["0", "1", "9007199254740993", "9223372036854775807"])
    expect(chatSequenceSchema.parse(value)).toBe(value);
  for (const value of [
    1,
    "",
    "-1",
    "01",
    "1.0",
    "1e3",
    "1\n",
    "no",
    "9223372036854775808",
  ])
    expect(chatSequenceSchema.safeParse(value).success).toBe(false);
});

test("text is bounded by UTF-8 bytes and preserves whitespace exactly", () => {
  for (const value of [
    "a".repeat(64_000),
    "é".repeat(32_000),
    "😀".repeat(16_000),
    " \n ",
  ])
    expect(chatTextSchema.parse(value)).toBe(value);
  for (const value of [
    "",
    "a".repeat(64_001),
    "é".repeat(32_000) + "a",
    "😀".repeat(16_001),
    "\0",
    "\ud800",
  ])
    expect(chatTextSchema.safeParse(value).success).toBe(false);
  expect(chatTopicSchema.safeParse("😀".repeat(250)).success).toBe(true);
  expect(chatTopicSchema.safeParse("😀".repeat(251)).success).toBe(false);
});

test("creation requires explicit retry identity and two distinct canonical accounts", () => {
  expect(
    chatCreateRequestSchema.parse({
      operationId,
      accountIds: [alice.toUpperCase(), bob],
    }),
  ).toEqual({ operationId, accountIds: [alice, bob] });
  for (const value of [
    { accountIds: [alice, bob] },
    { operationId, accountIds: [alice] },
    { operationId, accountIds: [alice, alice.toUpperCase()] },
    { operationId, accountIds: [alice, bob], ownerId: alice },
  ])
    expect(chatCreateRequestSchema.safeParse(value).success).toBe(false);
  expect(
    chatAddRequestSchema.safeParse({ operationId, accountIds: [bob] }).success,
  ).toBe(true);
  expect(chatAddRequestSchema.safeParse({ accountIds: [bob] }).success).toBe(
    false,
  );
});

test("references contain only typed resource identifiers, never fetched content or URLs", () => {
  const input = { operationId, text: "Read this" };
  expect(chatPostRequestSchema.parse(input)).toEqual({
    ...input,
    references: [],
  });
  for (const reference of [
    { kind: "file", fileId: alice },
    { kind: "mail_message", mailboxId: alice, messageId: bob },
  ]) {
    expect(
      chatPostRequestSchema.safeParse({ ...input, references: [reference] })
        .success,
    ).toBe(true);
    expect(
      chatPostRequestSchema.safeParse({
        ...input,
        references: [reference, reference],
      }).success,
    ).toBe(false);
    expect(
      chatPostRequestSchema.safeParse({
        ...input,
        references: [{ ...reference, url: "https://example.com" }],
      }).success,
    ).toBe(false);
  }
  expect(
    chatPostRequestSchema.safeParse({
      ...input,
      references: [{ kind: "url", url: "https://example.com" }],
    }).success,
  ).toBe(false);
});

test("entry kinds keep messages and attributable membership changes distinct", () => {
  expect(
    chatEntrySchema.safeParse({
      ...entry,
      kind: "message",
      text: "hello",
      references: [],
    }).success,
  ).toBe(true);
  expect(
    chatEntrySchema.safeParse({ ...entry, kind: "removed", accountIds: [bob] })
      .success,
  ).toBe(true);
  for (const value of [
    { ...entry, kind: "removed", accountIds: [] },
    {
      ...entry,
      kind: "message",
      text: "hello",
      references: [],
      accountIds: [bob],
    },
    { ...entry, sequence: "0", kind: "left", accountIds: [alice] },
  ])
    expect(chatEntrySchema.safeParse(value).success).toBe(false);
  expect(
    chatMembershipOutcomeSchema.safeParse({
      conversationId: operationId,
      changed: true,
      entry: null,
    }).success,
  ).toBe(false);
});

test("deleted retry results cannot carry erased content", () => {
  const deleted = {
    state: "deleted",
    conversationId: operationId,
    deletedAt: entry.createdAt,
  };
  expect(chatDeletedOutcomeSchema.parse(deleted)).toEqual(deleted);
  expect(
    chatDeletedOutcomeSchema.safeParse({ ...deleted, topic: "private" })
      .success,
  ).toBe(false);
});

test("discovery and catch-up have bounded, explicit continuation requests", () => {
  expect(chatListRequestSchema.parse({})).toEqual({ limit: 20 });
  expect(chatEntriesRequestSchema.parse({})).toEqual({ after: "0", limit: 20 });
  expect(
    chatEntriesRequestSchema.parse({ after: "9007199254740993", limit: "50" }),
  ).toEqual({ after: "9007199254740993", limit: 50 });
  for (const value of [
    { limit: 51 },
    { limit: 0 },
    { offset: 1 },
    { after: "" },
  ])
    expect(chatEntriesRequestSchema.safeParse(value).success).toBe(false);
});

test("account summaries are opt-in because published clients parse responses strictly", () => {
  const conversation = {
    conversationId: operationId,
    topic: null,
    createdAt: entry.createdAt,
    participants: [{ accountId: alice, joinedSequence: "1" }],
    latestSequence: "1",
  };
  const page = { entries: [], nextAfter: null, latestSequence: "1" };
  const summary = {
    accountId: alice,
    name: "Alice",
    kind: "agent",
    state: "active",
  };
  // Base schemas are what SDK 0.7.0 and earlier enforce.
  expect(
    chatConversationSchema.safeParse({ ...conversation, accounts: [] }).success,
  ).toBe(false);
  expect(chatEntriesSchema.safeParse({ ...page, accounts: [] }).success).toBe(
    false,
  );
  expect(
    chatConversationWithAccountsSchema.parse({
      ...conversation,
      accounts: [summary],
    }).accounts,
  ).toEqual([summary]);
  expect(
    chatEntriesWithAccountsSchema.safeParse({
      ...page,
      accounts: [
        { ...summary, accountId: alice.toUpperCase() },
        { accountId: bob, name: null, kind: "human", state: "removed" },
      ],
    }).success,
  ).toBe(true);
  for (const accounts of [
    [summary, summary],
    [{ ...summary, email: "alice@example.com" }],
    [{ ...summary, role: "admin" }],
    [{ ...summary, state: "deleted" }],
  ])
    expect(
      chatEntriesWithAccountsSchema.safeParse({ ...page, accounts }).success,
    ).toBe(false);
  expect(
    chatConversationWithAccountsSchema.safeParse(conversation).success,
  ).toBe(false);
  expect(
    chatConversationWithAccountsSchema.safeParse({
      ...conversation,
      accounts: Array.from({ length: 101 }, (_, index) => ({
        ...summary,
        accountId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`,
      })),
    }).success,
  ).toBe(false);

  expect(chatConversationRequestSchema.parse({})).toEqual({});
  expect(chatConversationRequestSchema.parse({ include: "accounts" })).toEqual({
    include: "accounts",
  });
  expect(chatEntriesRequestSchema.parse({ include: "accounts" })).toEqual({
    after: "0",
    limit: 20,
    include: "accounts",
  });
  for (const value of [
    { include: "profiles" },
    { include: "" },
    { include: ["accounts"] },
    { expand: "accounts" },
  ]) {
    expect(chatConversationRequestSchema.safeParse(value).success).toBe(false);
    expect(chatEntriesRequestSchema.safeParse(value).success).toBe(false);
  }
});

test("activity listing options are opt-in and validated", () => {
  // The default request names neither option, so earlier servers accept it.
  expect(chatListRequestSchema.parse({})).toEqual({ limit: 20 });
  expect(
    chatListRequestSchema.parse({
      order: "activity",
      include: "accounts,latest_entry",
    }),
  ).toEqual({
    limit: 20,
    order: "activity",
    include: ["accounts", "latest_entry"],
  });
  expect(
    chatListRequestSchema.parse({ include: ["latest_entry"] }).include,
  ).toEqual(["latest_entry"]);
  for (const value of [
    { order: "recent" },
    { include: "" },
    { include: "accounts,accounts" },
    { include: "messages" },
    { include: "accounts, latest_entry" },
    { include: [] },
    { include: ["accounts", "latest_entry", "accounts"] },
  ])
    expect(chatListRequestSchema.safeParse(value).success).toBe(false);
});

test("list pages carry exactly the requested additions", () => {
  const conversation = {
    conversationId: operationId,
    topic: null,
    createdAt: entry.createdAt,
    participants: [{ accountId: alice, joinedSequence: "1" }],
    latestSequence: "3",
  };
  const latestEntry = {
    kind: "message",
    sequence: "3",
    actorId: alice,
    createdAt: entry.createdAt,
    preview: "Morning",
    truncated: false,
    referenceCount: 1,
  };
  const accounts = [
    { accountId: alice, name: "Alice", kind: "agent", state: "active" },
  ];
  const plain = { conversations: [conversation], nextCursor: null };
  expect(chatListPageSchema().parse(plain)).toEqual(plain);
  expect(chatListPageSchema().safeParse({ ...plain, accounts }).success).toBe(
    false,
  );
  const both = {
    conversations: [{ ...conversation, latestEntry }],
    nextCursor: null,
    accounts,
  };
  expect(chatListPageSchema(["accounts", "latest_entry"]).parse(both)).toEqual(
    both,
  );
  expect(chatListPageSchema(["accounts"]).safeParse(both).success).toBe(false);
  expect(
    chatListPageSchema(["latest_entry"]).safeParse({
      conversations: [conversation],
      nextCursor: null,
    }).success,
  ).toBe(false);
  expect(
    chatLatestEntrySchema.parse({
      kind: "created",
      sequence: "1",
      actorId: alice,
      createdAt: entry.createdAt,
      accountIds: [alice, bob],
    }).kind,
  ).toBe("created");
  for (const preview of ["a".repeat(281), "é".repeat(141), "\0"])
    expect(
      chatLatestEntrySchema.safeParse({ ...latestEntry, preview }).success,
    ).toBe(false);
  expect(
    chatLatestEntrySchema.safeParse({ ...latestEntry, text: "full" }).success,
  ).toBe(false);
});
