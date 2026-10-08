import { expect, test, vi } from "vitest";
import { AgentWorkplace } from "../src/client.js";
import { compareNotificationPositions } from "../src/notifications.js";
const account = "11111111-1111-4111-8111-111111111111";
const position = `np1.${account}.9007199254740993`;
const endpoint = {
  id: account,
  accountId: account,
  url: "https://receiver.example/private-hook",
  profile: { kind: "standard" },
  createdBy: account,
  createdAt: "2026-10-08T00:00:00.000Z",
  disabledAt: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
};
const endpointStatus = { position, unreadCount: 0, oldestUnreadAt: null };
const secret = `whsec_${"A".repeat(43)}=`;

test("endpoint methods preserve auth, target, cancellation and empty removal responses", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ endpoint, secret }, { status: 201 }))
    .mockResolvedValueOnce(
      Response.json({ endpoints: [endpoint], status: endpointStatus }),
    )
    .mockResolvedValueOnce(Response.json({ endpoint, status: endpointStatus }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  const client = new AgentWorkplace({
    baseUrl: "https://api.example.test",
    fetch,
  });
  const signal = new AbortController().signal;
  expect(
    await client.registerNotificationEndpoint(
      { apiKey: "private-key" },
      { url: endpoint.url, profile: { kind: "standard" }, accountId: account },
      { signal },
    ),
  ).toEqual({ endpoint, secret });
  expect(
    await client.listNotificationEndpoints(
      { humanSession: true },
      { accountId: account },
      { signal },
    ),
  ).toEqual({ endpoints: [endpoint], status: endpointStatus });
  expect(
    await client.inspectNotificationEndpoint(
      { apiKey: "key" },
      account,
      { accountId: account },
      { signal },
    ),
  ).toEqual({ endpoint, status: endpointStatus });
  expect(
    await client.removeNotificationEndpoint(
      { apiKey: "key" },
      account,
      { accountId: account },
      { signal },
    ),
  ).toBeUndefined();
  const calls = fetch.mock.calls;
  expect(JSON.parse(String(calls[0]![1]?.body))).toEqual({
    url: endpoint.url,
    profile: { kind: "standard" },
    accountId: account,
  });
  expect(new Headers(calls[0]![1]?.headers).get("Authorization")).toBe(
    "Bearer private-key",
  );
  expect(calls[1]![1]?.credentials).toBe("include");
  expect(
    calls.every(
      ([, options]) =>
        options?.signal === signal &&
        options.redirect === "error" &&
        !!new Headers(options.headers).get("X-Request-ID"),
    ),
  ).toBe(true);
  expect(
    calls
      .slice(1)
      .map(([url]) => new URL(String(url)).searchParams.get("accountId")),
  ).toEqual([account, account, account]);
  expect(new URL(String(calls[2]![0])).pathname).toBe(
    `/v1/notifications/endpoints/${account}`,
  );
  expect(calls[3]![1]?.method).toBe("DELETE");
  expect(calls[3]![1]?.body).toBeUndefined();
});

test("endpoint input rejects malformed IDs and tokens without network or sensitive errors", () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const client = new AgentWorkplace({ fetch });
  for (const run of [
    () =>
      client.registerNotificationEndpoint(
        { apiKey: "key" },
        {
          url: endpoint.url,
          profile: { kind: "standard" },
          token: "private-token",
        },
      ),
    () =>
      client.registerNotificationEndpoint(
        { apiKey: "key" },
        {
          url: endpoint.url,
          profile: { kind: "bearer" },
          token: "private\nheader",
        },
      ),
    () =>
      client.inspectNotificationEndpoint({ apiKey: "key" }, "../private-hook"),
    () =>
      client.removeNotificationEndpoint({ apiKey: "key" }, account, {
        accountId: "private-target",
      }),
    () =>
      client.listNotificationEndpoints(
        { apiKey: "key" },
        { accountId: "private-target" },
      ),
  ]) {
    expect(run).toThrow(TypeError);
    try {
      run();
    } catch (error) {
      expect(String(error)).not.toContain("private");
    }
  }
  expect(fetch).not.toHaveBeenCalled();
});

test("private endpoint responses never survive as parsing error causes", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      new Response("private-response-token", { status: 200 }),
    )
    .mockResolvedValueOnce(
      Response.json({
        endpoints: [{ ...endpoint, "private-extra-key": "private-token" }],
        status: endpointStatus,
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        endpoint: { ...endpoint, profile: { kind: "bearer" } },
        secret,
      }),
    )
    .mockResolvedValueOnce(Response.json({ removed: true }));
  const client = new AgentWorkplace({ fetch });
  const operations = [
    () => client.listNotificationEndpoints({ apiKey: "key" }),
    () => client.listNotificationEndpoints({ apiKey: "key" }),
    () =>
      client.registerNotificationEndpoint(
        { apiKey: "key" },
        {
          url: endpoint.url,
          profile: { kind: "bearer" },
          token: "private-token",
        },
      ),
    () => client.removeNotificationEndpoint({ apiKey: "key" }, account),
  ];
  for (const operation of operations) {
    const error = await operation().catch((value: unknown) => value);
    expect(error).toMatchObject({ name: "AgentWorkplaceError", status: 200 });
    expect((error as Error).cause).toBeUndefined();
    expect(String(error)).not.toContain("private");
  }
});

test("endpoint failures retain safe server codes, request IDs and retry delays", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async (_url, options) =>
      Response.json(
        {
          error: {
            code: "notification_endpoint_limit",
            message: "Endpoint limit reached",
          },
        },
        {
          status: 409,
          headers: {
            "X-Request-ID": new Headers(options?.headers).get("X-Request-ID")!,
            "Retry-After": "60",
          },
        },
      ),
    );
  const client = new AgentWorkplace({ fetch });
  const error = await client
    .registerNotificationEndpoint(
      { apiKey: "key" },
      { url: endpoint.url, profile: { kind: "standard" } },
    )
    .catch((value: unknown) => value);
  expect(error).toMatchObject({
    status: 409,
    code: "notification_endpoint_limit",
    retryAfterSeconds: 60,
    requestId: new Headers(fetch.mock.calls[0]![1]?.headers).get(
      "X-Request-ID",
    ),
  });
});
test("compares exact positions and rejects different account scopes", () => {
  expect(
    compareNotificationPositions(position, `np1.${account}.9007199254740992`),
  ).toBe(1);
  expect(compareNotificationPositions(position, position)).toBe(0);
  expect(() =>
    compareNotificationPositions(
      position,
      position.replace(account, "22222222-2222-4222-8222-222222222222"),
    ),
  ).toThrow(TypeError);
});
test("notification methods preserve authorization, request shape and cancellation", async () => {
  const status = { position, unreadCount: 0, oldestUnreadAt: null };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json(status))
    .mockResolvedValueOnce(
      Response.json({ notifications: [], nextCursor: null }),
    )
    .mockResolvedValue(Response.json({ acknowledged: true }));
  const client = new AgentWorkplace({
    baseUrl: "https://api.example.test",
    fetch,
  });
  const signal = new AbortController().signal;
  expect(
    await client.getNotificationStatus(
      { apiKey: "private-key" },
      { accountId: account },
      { signal },
    ),
  ).toEqual(status);
  expect(fetch.mock.calls[0]![1]?.signal).toBe(signal);
  expect(
    new Headers(fetch.mock.calls[0]![1]?.headers).get("Authorization"),
  ).toBe("Bearer private-key");
  await client.listNotifications(
    { humanSession: true },
    { filter: "all", after: "all/token", limit: 2 },
  );
  const query = new URL(String(fetch.mock.calls[1]![0]));
  expect(query.searchParams.get("after")).toBe("all/token");
  expect(fetch.mock.calls[1]![1]?.credentials).toBe("include");
  await client.markNotificationsRead({ apiKey: "key" }, { through: position });
  expect(JSON.parse(String(fetch.mock.calls[2]![1]?.body))).toEqual({
    through: position,
  });
  expect(String(fetch.mock.calls[2]![0])).toBe(
    "https://api.example.test/v1/notifications/read",
  );
});
test("rejects malformed requests locally and malformed responses safely", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(Response.json({ position: 42, unreadCount: -1 }));
  const client = new AgentWorkplace({
    baseUrl: "https://api.example.test",
    fetch,
  });
  expect(() =>
    client.markNotificationsRead({ apiKey: "key" }, { through: "123" }),
  ).toThrow(TypeError);
  expect(fetch).not.toHaveBeenCalled();
  await expect(
    client.getNotificationStatus({ apiKey: "key" }),
  ).rejects.toMatchObject({ status: 200 });
});

test("endpoint test returns validated acceptance, preserves scope and cancellation, and never retries uncertain POSTs", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json({ accepted: true, testId: account }, { status: 202 }),
    )
    .mockResolvedValueOnce(
      Response.json(
        { accepted: true, testId: "private-invalid-id" },
        { status: 202 },
      ),
    );
  const client = new AgentWorkplace({
    baseUrl: "https://api.example.test",
    fetch,
  });
  const signal = new AbortController().signal;
  expect(
    await client.testNotificationEndpoint(
      { apiKey: "key" },
      account,
      { accountId: account },
      { signal },
    ),
  ).toEqual({ accepted: true, testId: account });
  const [url, init] = fetch.mock.calls[0]!;
  expect(String(url)).toBe(
    `https://api.example.test/v1/notifications/endpoints/${account}/test?accountId=${account}`,
  );
  expect(init).toMatchObject({ method: "POST", signal });
  expect(init?.body).toBeUndefined();
  expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer key");
  try {
    await client.testNotificationEndpoint({ apiKey: "key" }, account);
    expect.unreachable();
  } catch (error) {
    expect(String(error)).not.toContain("private-invalid-id");
    expect((error as Error).cause).toBeUndefined();
  }
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(() =>
    client.testNotificationEndpoint({ apiKey: "key" }, "bad-id"),
  ).toThrow(TypeError);
  expect(fetch).toHaveBeenCalledTimes(2);
});
