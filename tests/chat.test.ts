import { expect, test, vi } from "vitest";
import { AgentWorkplace } from "../src/client.js";

const conversationId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const operationId = "33333333-3333-4333-8333-333333333333";
const createdAt = "2026-10-09T00:00:00.000Z";
const conversation = {
  conversationId,
  topic: "Coordination",
  createdAt,
  participants: [{ accountId, joinedSequence: "1" }],
  latestSequence: "9007199254740993",
};
const message = {
  conversationId,
  entryId: operationId,
  actorId: accountId,
  createdAt,
  sequence: "9007199254740993",
  kind: "message",
  text: "é\n<safe>",
  references: [],
};
const membership = { conversationId, changed: false, entry: null };
const deleted = { conversationId, state: "deleted", deletedAt: createdAt };
const authorization = { apiKey: "test-key" };

test("all Chat methods preserve routes, operation identity, lossless sequences and cancellation", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const client = new AgentWorkplace({ fetch });
  const signal = new AbortController().signal;
  const options = { signal };
  const cases: {
    path: string;
    method: string;
    response: unknown;
    body?: unknown;
    invoke(): Promise<unknown>;
  }[] = [
    {
      path: "?limit=20",
      method: "GET",
      response: { conversations: [conversation], nextCursor: null },
      invoke: () => client.listChatConversations(authorization, {}, options),
    },
    {
      path: "",
      method: "POST",
      response: { state: "created", conversationId, sequence: "1" },
      body: {
        operationId,
        accountIds: [accountId, conversationId],
        topic: "Coordination",
      },
      invoke: () =>
        client.createChatConversation(
          authorization,
          {
            operationId,
            accountIds: [accountId, conversationId],
            topic: "Coordination",
          },
          options,
        ),
    },
    {
      path: `/${conversationId}`,
      method: "GET",
      response: conversation,
      invoke: () =>
        client.getChatConversation(authorization, conversationId, options),
    },
    {
      path: `/${conversationId}/entries?after=9007199254740992&limit=1`,
      method: "GET",
      response: {
        entries: [message],
        nextAfter: null,
        latestSequence: message.sequence,
      },
      invoke: () =>
        client.readChatEntries(
          authorization,
          conversationId,
          { after: "9007199254740992", limit: 1 },
          options,
        ),
    },
    {
      path: `/${conversationId}/messages`,
      method: "POST",
      response: { state: "posted", entry: message },
      body: { operationId, text: message.text, references: [] },
      invoke: () =>
        client.postChatMessage(
          authorization,
          conversationId,
          { operationId, text: message.text },
          options,
        ),
    },
    {
      path: `/${conversationId}/participants`,
      method: "POST",
      response: membership,
      body: { operationId, accountIds: [accountId] },
      invoke: () =>
        client.addChatParticipants(
          authorization,
          conversationId,
          { operationId, accountIds: [accountId] },
          options,
        ),
    },
    {
      path: `/${conversationId}/leave`,
      method: "POST",
      response: membership,
      body: { operationId },
      invoke: () =>
        client.leaveChatConversation(
          authorization,
          conversationId,
          { operationId },
          options,
        ),
    },
    {
      path: `/${conversationId}/remove`,
      method: "POST",
      response: membership,
      body: { operationId, accountId },
      invoke: () =>
        client.removeChatParticipant(
          authorization,
          conversationId,
          { operationId, accountId },
          options,
        ),
    },
    {
      path: `/${conversationId}`,
      method: "DELETE",
      response: { ...deleted, storageReleased: true, cleanup: "pending" },
      invoke: () =>
        client.deleteChatConversation(authorization, conversationId, options),
    },
  ];
  for (const item of cases) {
    fetch.mockResolvedValueOnce(Response.json(item.response));
    await expect(item.invoke()).resolves.toEqual(item.response);
    const [url, init] = fetch.mock.calls.at(-1)!;
    expect(String(url)).toBe(
      `https://api.agentworkplace.dev/v1/chat/conversations${item.path}`,
    );
    expect(init).toMatchObject({
      method: item.method,
      signal,
      redirect: "error",
    });
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer test-key",
    );
    expect(init?.body).toBe(
      item.body === undefined ? undefined : JSON.stringify(item.body),
    );
  }
  expect(fetch).toHaveBeenCalledTimes(cases.length);
});

test("Chat human session requests include cookies and deleted retries stay explicit", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(Response.json(deleted));
  const client = new AgentWorkplace({ fetch });
  await expect(
    client.postChatMessage({ humanSession: true }, conversationId, {
      operationId,
      text: "lost response",
    }),
  ).resolves.toEqual(deleted);
  expect(fetch.mock.calls[0]?.[1]?.credentials).toBe("include");
  expect(
    new Headers(fetch.mock.calls[0]?.[1]?.headers).has("Authorization"),
  ).toBe(false);
});

test("invalid Chat requests fail before transmission without leaking input", () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const client = new AgentWorkplace({ fetch });
  for (const invoke of [
    () => client.getChatConversation(authorization, "../private"),
    () =>
      client.postChatMessage(authorization, conversationId, {
        operationId,
        text: "é".repeat(32001),
      }),
    () =>
      client.readChatEntries(authorization, conversationId, {
        after: "9007199254740993x",
      }),
    () =>
      client.createChatConversation(authorization, {
        operationId,
        accountIds: [accountId],
      }),
    () =>
      client.addChatParticipants(authorization, conversationId, {
        operationId,
        accountIds: [accountId, accountId],
      }),
  ])
    expect(invoke).toThrow(TypeError);
  expect(fetch).not.toHaveBeenCalled();
});

test("malformed Chat responses never retain private text in validation causes", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    Response.json({
      state: "posted",
      entry: { ...message, sequence: "private-text" },
    }),
  );
  const error: unknown = await new AgentWorkplace({ fetch })
    .postChatMessage(authorization, conversationId, {
      operationId,
      text: "test",
    })
    .catch((value: unknown) => value);
  expect(error).toMatchObject({ name: "AgentWorkplaceError", status: 200 });
  expect((error as Error).cause).toBeUndefined();
  expect(String(error)).not.toContain("private-text");
});
