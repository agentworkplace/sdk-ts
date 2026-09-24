import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { AgentWorkplace, AgentWorkplaceError } from "../src/index.js";
import type { AgentWorkplaceOptions, HealthResponse } from "../src/index.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const responseRequestId = "4f641382-6a56-41f5-b418-e20309e0b168";

function jsonResponseWithRequestId(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "X-Request-ID": responseRequestId,
    },
  });
}

describe("AgentWorkplace", () => {
  it("does not bind Fetch to the SDK instance in browser runtimes", async () => {
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.test",
      fetch: async function (this: unknown) {
        expect(this).toBeUndefined();
        return Response.json({ status: "ok" });
      },
    });
    await expect(client.health()).resolves.toEqual({ status: "ok" });
  });
  it("constructs a client from explicit options", () => {
    const options = {
      baseUrl: "https://api.example.com",
      fetch: vi.fn(),
    } satisfies AgentWorkplaceOptions;

    expect(new AgentWorkplace(options)).toBeInstanceOf(AgentWorkplace);
  });

  it.each([
    ["", "must not be empty"],
    ["relative/path", "must be an absolute URL"],
    ["ftp://api.example.com", "must use HTTP or HTTPS"],
    ["https://user:secret@api.example.com", "must not include credentials"],
    ["https://api.example.com?region=us", "must not include a query"],
    ["https://api.example.com#health", "must not include a fragment"],
  ])("rejects invalid base URL %s", (baseUrl, message) => {
    expect(() => new AgentWorkplace({ baseUrl })).toThrowError(message);
  });

  it("requests and validates health through a normalized base URL", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      jsonResponse({ status: "ok" }),
    );
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.com/v1",
      fetch,
    });

    const result = await client.health();

    expect(result).toEqual({ status: "ok" });
    expectTypeOf(result).toEqualTypeOf<HealthResponse>();
    expect(fetch).toHaveBeenCalledOnce();

    const [url, init] = fetch.mock.calls[0] ?? [];

    expect(url).toBeInstanceOf(URL);
    expect(String(url)).toBe("https://api.example.com/v1/health");
    expect(init?.method).toBe("GET");
    expect(init?.headers).toMatchObject({ Accept: "application/json" });
    expect((init?.headers as Record<string, string>)["X-Request-ID"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("generates a different request ID for each request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      jsonResponse({ status: "ok" }),
    );
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.com",
      fetch,
    });

    await client.health();
    await client.health();

    const firstHeaders = fetch.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >;
    const secondHeaders = fetch.mock.calls[1]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(firstHeaders["X-Request-ID"]).not.toBe(
      secondHeaders["X-Request-ID"],
    );
  });

  it("does not duplicate a trailing slash", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      jsonResponse({ status: "ok" }),
    );
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.com/v1/",
      fetch,
    });

    await client.health();

    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "https://api.example.com/v1/health",
    );
  });

  it("rejects a malformed successful response", async () => {
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.com",
      fetch: vi.fn(async () => jsonResponse({ status: "degraded" })),
    });

    const error = await client.health().catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(AgentWorkplaceError);
    expect(error).toMatchObject({
      status: 200,
      code: undefined,
      message: "The Agent Workplace API returned an invalid response",
    });
    expect((error as Error).cause).toBeDefined();
  });

  it("rejects invalid JSON from a successful response", async () => {
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.com",
      fetch: vi.fn(async () => new Response("not json", { status: 200 })),
    });

    await expect(client.health()).rejects.toMatchObject({
      status: 200,
      message: "The Agent Workplace API returned invalid JSON",
    });
  });

  it("surfaces a valid Agent Workplace error envelope", async () => {
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.com",
      fetch: vi.fn(async () =>
        jsonResponseWithRequestId(
          { error: { code: "service_unavailable", message: "Try again" } },
          503,
        ),
      ),
    });

    await expect(client.health()).rejects.toMatchObject({
      name: "AgentWorkplaceError",
      status: 503,
      code: "service_unavailable",
      message: "Try again",
      requestId: responseRequestId,
    });
  });

  it("fails safely for malformed JSON error envelopes", async () => {
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.com",
      fetch: vi.fn(async () =>
        jsonResponse({ message: "provider secret" }, 500),
      ),
    });

    const error = await client.health().catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      status: 500,
      code: undefined,
      message: "Request failed with status 500",
    });
    expect(String(error)).not.toContain("provider secret");
  });

  it("treats malformed error codes as an invalid error envelope", async () => {
    const secretMessage = "provider secret";
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.com",
      fetch: vi.fn(async () =>
        jsonResponse(
          { error: { code: "INVALID-CODE", message: secretMessage } },
          500,
        ),
      ),
    });

    const error = await client.health().catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      status: 500,
      code: undefined,
      message: "Request failed with status 500",
    });
    expect(String(error)).not.toContain(secretMessage);
  });

  it("fails safely for non-JSON error responses", async () => {
    const secretBody = "upstream credential: secret-value";
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.com",
      fetch: vi.fn(async () => new Response(secretBody, { status: 502 })),
    });

    const error = await client.health().catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      status: 502,
      code: undefined,
      message: "Request failed with status 502",
    });
    expect(String(error)).not.toContain(secretBody);
  });

  it("surfaces a valid response request ID on malformed responses", async () => {
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.com",
      fetch: vi.fn(async () =>
        jsonResponseWithRequestId({ status: "degraded" }),
      ),
    });

    await expect(client.health()).rejects.toMatchObject({
      status: 200,
      requestId: responseRequestId,
    });
  });

  it("ignores an invalid response request ID", async () => {
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.com",
      fetch: vi.fn(
        async () =>
          new Response("not json", {
            status: 502,
            headers: { "X-Request-ID": "untrusted-value" },
          }),
      ),
    });

    await expect(client.health()).rejects.toMatchObject({
      status: 502,
      requestId: undefined,
    });
  });

  it("preserves native fetch failures", async () => {
    const networkError = new TypeError("fetch failed");
    const client = new AgentWorkplace({
      baseUrl: "https://api.example.com",
      fetch: vi.fn(async () => Promise.reject(networkError)),
    });

    await expect(client.health()).rejects.toBe(networkError);
  });
});

it("sends an immutable Mail operation through HTTP and reads its validated status", async () => {
  const operationId = "11111111-1111-4111-8111-111111111111";
  const operation = {
    operationId,
    mailboxId: "22222222-2222-4222-8222-222222222222",
    state: "uncertain",
    contentRetained: true,
    receipt: {
      available: true,
      createdAt: "2026-09-18T00:00:00.000Z",
      firstClaimAt: "2026-09-18T00:00:00.000Z",
      acceptanceObservedAt: null,
      suppressedAt: "2026-09-18T00:00:01.000Z",
      stoppedAt: null,
      submissions: 1,
    },
  };
  const calls: Array<{
    url: string;
    method: string | undefined;
    headers: Headers;
    body: unknown;
  }> = [];
  const client = new AgentWorkplace({
    baseUrl: "https://api.example.test",
    fetch: async (url, init) => {
      calls.push({
        url: String(url),
        method: init?.method,
        headers: new Headers(init?.headers),
        body: init?.body,
      });
      return jsonResponse(operation);
    },
  });
  const input = {
    operationId,
    to: "requested@example.test",
    subject: "Demo",
    text: "only requested content",
  };
  expect(await client.sendMail({ apiKey: "fixture" }, input)).toEqual(
    operation,
  );
  expect(
    await client.getMailOperation({ apiKey: "fixture" }, operationId),
  ).toEqual(operation);
  expect(calls[0]).toMatchObject({
    url: "https://api.example.test/v1/mail/send",
    method: "POST",
    body: JSON.stringify(input),
  });
  expect(calls[0]!.headers.get("Authorization")).toBe("Bearer fixture");
  expect(calls[0]!.headers.get("X-Request-ID")).toMatch(/^[0-9a-f-]{36}$/);
  expect(calls[1]!.url).toBe(
    `https://api.example.test/v1/mail/operations/${operationId}`,
  );
  const malformed = new AgentWorkplace({
    baseUrl: "https://api.example.test",
    fetch: async () => jsonResponse({ ...operation, state: "delivered" }),
  });
  await expect(
    malformed.getMailOperation({ apiKey: "fixture" }, operationId),
  ).rejects.toBeInstanceOf(AgentWorkplaceError);
});
