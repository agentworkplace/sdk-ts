import { describe, expect, it, vi } from "vitest";
import {
  DocumentationClient,
  DocumentationError,
} from "../src/documentation.js";

const page = {
  path: "/documentation/guides/send-mail",
  title: "Send Mail",
  description: "Send a message",
  group: ["Documentation", "Guides"],
};
const operation = {
  path: "/api/reference/access/signupAgent",
  title: "Create workplace",
  description: "POST /v1/workplaces",
  group: ["API Reference", "Endpoints", "Access"],
};
const index = { schemaVersion: 1, pages: [page, operation] };
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function markdown(value: string, status = 200) {
  return new Response(value, {
    status,
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
function client(transport: typeof fetch) {
  return new DocumentationClient({
    baseUrl: "https://docs.example.test",
    fetch: transport,
  });
}

async function code(action: () => Promise<unknown>, expected: string) {
  await expect(action()).rejects.toMatchObject({
    name: "DocumentationError",
    code: expected,
  });
}

describe("DocumentationClient", () => {
  it("lists and searches without product authorization or credentials", async () => {
    const transport = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("docs-index.json")
        ? json(index)
        : json({
            schemaVersion: 1,
            results: [
              {
                path: operation.path,
                title: operation.title,
                excerpt: "POST /v1/workplaces",
              },
            ],
          }),
    ) as unknown as typeof fetch;
    const docs = client(transport);
    expect(await docs.list()).toEqual(index.pages);
    expect(await docs.search("sign up")).toEqual([
      {
        path: operation.path,
        title: operation.title,
        excerpt: "POST /v1/workplaces",
      },
    ]);
    expect(transport).toHaveBeenNthCalledWith(
      1,
      "https://docs.example.test/docs-index.json",
      expect.objectContaining({
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "omit",
        redirect: "manual",
      }),
    );
    expect(transport).toHaveBeenNthCalledWith(
      2,
      "https://docs.example.test/docs-search.json?query=sign%20up",
      expect.objectContaining({ credentials: "omit" }),
    );
  });

  it("reads an advertised guide or API page and preserves Markdown exactly", async () => {
    const text =
      "# Send Mail\n\n```sh\nagent-workplace mail send\n```\n\u202e\n";
    const transport = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith(".md") ? markdown(text) : json(index),
    ) as unknown as typeof fetch;
    const docs = client(transport);
    expect(await docs.read("documentation/guides/send-mail")).toEqual({
      path: page.path,
      title: page.title,
      markdown: text,
    });
    expect(await docs.read(operation.path)).toMatchObject({
      path: operation.path,
    });
    expect(transport).toHaveBeenNthCalledWith(
      2,
      "https://docs.example.test/documentation/guides/send-mail.md",
      expect.objectContaining({ headers: { Accept: "text/markdown" } }),
    );
  });

  it.each([
    "https://evil.example/documentation",
    "/documentation/../api/reference/access/signupAgent",
    "/documentation/guides/send-mail.md",
    "/documentation/guides/send-mail?x=1",
    "/documentation/guides/send-mail#section",
    "/documentation//guides/send-mail",
  ])("rejects invalid path %s before transport", async (path) => {
    const transport = vi.fn() as unknown as typeof fetch;
    await code(() => client(transport).read(path), "invalid_path");
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects paths absent from the index before a page request", async () => {
    const transport = vi.fn(async () => json(index)) as unknown as typeof fetch;
    await code(
      () => client(transport).read("/documentation/guides/read-mail"),
      "invalid_path",
    );
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("accepts canonical section roots and rejects a removed page after index lookup", async () => {
    const root = {
      path: "/documentation",
      title: "Welcome",
      description: "Start here",
      group: ["Documentation"],
    };
    const readRoot = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith(".md")
        ? markdown("# Welcome\n")
        : json({ schemaVersion: 1, pages: [root] }),
    ) as unknown as typeof fetch;
    expect(await client(readRoot).read("/documentation")).toMatchObject({
      markdown: "# Welcome\n",
    });

    const missing = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith(".md")
        ? new Response(null, { status: 404 })
        : json(index),
    ) as unknown as typeof fetch;
    await code(() => client(missing).read(page.path), "not_found");
    expect(missing).toHaveBeenCalledTimes(2);
  });

  it("rejects an HTML challenge mislabeled as Markdown", async () => {
    const transport = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith(".md")
        ? markdown("<!doctype html><html><body>Access</body></html>")
        : json(index),
    ) as unknown as typeof fetch;
    await code(() => client(transport).read(page.path), "unexpected_content");
  });

  it.each([
    [
      new Response("<html>Access</html>", {
        headers: { "Content-Type": "text/html" },
      }),
      "unexpected_content",
    ],
    [
      new Response(null, {
        status: 302,
        headers: { Location: "https://login.example/" },
      }),
      "redirect",
    ],
    [new Response(null, { status: 503 }), "http_error"],
    [new Response(null, { status: 404 }), "not_found"],
    [json({ schemaVersion: 2, pages: [] }), "invalid_response"],
    [
      new Response("{", { headers: { "Content-Type": "application/json" } }),
      "invalid_response",
    ],
  ])("rejects unsafe or unavailable responses", async (response, expected) => {
    const transport = vi.fn(async () => response) as unknown as typeof fetch;
    await code(() => client(transport).list(), expected);
  });

  it.each([
    [302, "application/json", "redirect"],
    [404, "application/json", "not_found"],
    [503, "application/json", "http_error"],
    [200, "text/html", "unexpected_content"],
  ])(
    "cancels an unconsumed %i %s response without delaying %s",
    async (status, contentType, expected) => {
      const cancel = vi.fn(() => new Promise<void>(() => undefined));
      const response = new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("<html>Access</html>"));
          },
          cancel,
        }),
        { status, headers: { "Content-Type": contentType } },
      );
      let signal: AbortSignal | undefined;
      const transport = vi.fn(
        async (_url: string | URL | Request, init?: RequestInit) => {
          signal = init?.signal ?? undefined;
          return response;
        },
      ) as unknown as typeof fetch;
      await code(() => client(transport).list(), expected);
      expect(cancel).toHaveBeenCalledOnce();
      expect(signal?.aborted).toBe(true);
    },
  );

  it("does not wait for cancellation after an oversized stream", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(512 * 1024 + 1));
        },
        cancel,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
    await code(
      () =>
        client(vi.fn(async () => response) as unknown as typeof fetch).list(),
      "response_too_large",
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("reads a successful streaming response without cancellation", async () => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          const bytes = new TextEncoder().encode(JSON.stringify(index));
          controller.enqueue(bytes.subarray(0, 25));
          controller.enqueue(bytes.subarray(25));
          controller.close();
        },
        cancel,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
    expect(
      await client(
        vi.fn(async () => response) as unknown as typeof fetch,
      ).list(),
    ).toEqual(index.pages);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies and timeout without exposing body text", async () => {
    const huge = new Response("x".repeat(512 * 1024 + 1), {
      headers: { "Content-Type": "application/json" },
    });
    await code(
      () => client(vi.fn(async () => huge) as unknown as typeof fetch).list(),
      "response_too_large",
    );
    const timeout = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    ) as unknown as typeof fetch;
    vi.useFakeTimers();
    try {
      const pending = client(timeout).list();
      const assertion = expect(pending).rejects.toMatchObject({
        code: "timeout",
      });
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns typed, safe errors", () => {
    const error = new DocumentationError(
      "Documentation redirected",
      "redirect",
      302,
    );
    expect(error).toMatchObject({ code: "redirect", status: 302 });
    expect(JSON.stringify(error)).not.toContain("login.example");
  });
});
