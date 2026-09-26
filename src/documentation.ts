import { z } from "zod";

const canonicalPath = z
  .string()
  .regex(/^\/(?:documentation|api)(?:\/[A-Za-z0-9_-]+)*$/);
const pageSchema = z.object({
  path: canonicalPath,
  title: z.string().min(1),
  description: z.string(),
  group: z.array(z.string().min(1)).min(1),
});
const resultSchema = z.object({
  path: canonicalPath,
  title: z.string().min(1),
  excerpt: z.string(),
});
const indexSchema = z.object({
  schemaVersion: z.literal(1),
  pages: z.array(pageSchema),
});
const searchSchema = z.object({
  schemaVersion: z.literal(1),
  results: z.array(resultSchema).max(10),
});

export type DocumentationPage = z.infer<typeof pageSchema>;
export type DocumentationSearchResult = z.infer<typeof resultSchema>;
export interface DocumentationReadResult {
  path: string;
  title: string;
  markdown: string;
}

export type DocumentationErrorCode =
  | "invalid_path"
  | "invalid_query"
  | "not_found"
  | "http_error"
  | "redirect"
  | "unexpected_content"
  | "invalid_response"
  | "response_too_large"
  | "timeout"
  | "network_error";

export class DocumentationError extends Error {
  readonly code: DocumentationErrorCode;
  readonly status?: number;

  constructor(message: string, code: DocumentationErrorCode, status?: number) {
    super(message);
    this.name = "DocumentationError";
    this.code = code;
    this.status = status;
  }
}

export interface DocumentationClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
}

const jsonLimit = 512 * 1024;
const markdownLimit = 2 * 1024 * 1024;
const timeoutMs = 10_000;

function normalizePath(input: string): string {
  const path = input.startsWith("/") ? input : `/${input}`;
  if (!canonicalPath.safeParse(path).success)
    throw new DocumentationError("Invalid documentation path", "invalid_path");
  return path;
}

async function boundedText(response: Response, limit: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  let finished = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        break;
      }
      size += value.byteLength;
      if (size > limit)
        throw new DocumentationError(
          "Documentation response is too large",
          "response_too_large",
        );
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    if (!finished) {
      try {
        // Do not let a stalled stream cancellation delay the original error.
        void reader.cancel().catch(() => undefined);
      } catch {
        // The request error remains authoritative.
      }
    }
    reader.releaseLock();
  }
}

function cancelUnconsumed(
  response: Response,
  controller: AbortController,
): void {
  controller.abort();
  try {
    // Some injected Fetch implementations do not connect AbortSignal to the body.
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // Preserve the status, redirect, or content-type error.
  }
}

export class DocumentationClient {
  private readonly origin: string;
  private readonly transport: typeof fetch;

  constructor(options: DocumentationClientOptions) {
    const url = new URL(options.baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new TypeError("Documentation base URL must be an HTTP origin");
    this.origin = url.origin;
    this.transport = options.fetch ?? fetch;
  }

  private async request(path: string, accept: string, limit: number) {
    const url = `${this.origin}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.transport(url, {
        method: "GET",
        headers: { Accept: accept },
        credentials: "omit",
        redirect: "manual",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      const rejectResponse = (error: DocumentationError): never => {
        cancelUnconsumed(response, controller);
        throw error;
      };
      if (
        response.redirected ||
        (response.status >= 300 && response.status < 400)
      )
        return rejectResponse(
          new DocumentationError(
            "Documentation redirected",
            "redirect",
            response.status,
          ),
        );
      if (response.url && response.url !== url)
        return rejectResponse(
          new DocumentationError(
            "Documentation redirected",
            "redirect",
            response.status,
          ),
        );
      if (response.status === 404)
        return rejectResponse(
          new DocumentationError(
            "Documentation page not found",
            "not_found",
            404,
          ),
        );
      if (!response.ok)
        return rejectResponse(
          new DocumentationError(
            "Documentation is unavailable",
            "http_error",
            response.status,
          ),
        );
      const contentType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      const validType =
        accept === "application/json"
          ? contentType === "application/json" || contentType?.endsWith("+json")
          : contentType === "text/markdown";
      if (!validType)
        return rejectResponse(
          new DocumentationError(
            "Unexpected documentation content type",
            "unexpected_content",
          ),
        );
      return await boundedText(response, limit);
    } catch (error) {
      if (error instanceof DocumentationError) throw error;
      if (controller.signal.aborted)
        throw new DocumentationError(
          "Documentation request timed out",
          "timeout",
        );
      throw new DocumentationError(
        "Unable to reach documentation",
        "network_error",
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async json(path: string): Promise<unknown> {
    const body = await this.request(path, "application/json", jsonLimit);
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new DocumentationError(
        "Invalid documentation response",
        "invalid_response",
      );
    }
  }

  async list(): Promise<DocumentationPage[]> {
    const parsed = indexSchema.safeParse(await this.json("/docs-index.json"));
    if (!parsed.success)
      throw new DocumentationError(
        "Invalid documentation index",
        "invalid_response",
      );
    const paths = new Set(parsed.data.pages.map((page) => page.path));
    if (paths.size !== parsed.data.pages.length)
      throw new DocumentationError(
        "Invalid documentation index",
        "invalid_response",
      );
    return parsed.data.pages;
  }

  async search(query: string): Promise<DocumentationSearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length > 200)
      throw new DocumentationError(
        "Invalid documentation query",
        "invalid_query",
      );
    const parsed = searchSchema.safeParse(
      await this.json(`/docs-search.json?query=${encodeURIComponent(trimmed)}`),
    );
    if (!parsed.success)
      throw new DocumentationError(
        "Invalid documentation search response",
        "invalid_response",
      );
    if (
      new Set(parsed.data.results.map((result) => result.path)).size !==
      parsed.data.results.length
    )
      throw new DocumentationError(
        "Invalid documentation search response",
        "invalid_response",
      );
    return parsed.data.results;
  }

  async read(input: string): Promise<DocumentationReadResult> {
    const path = normalizePath(input);
    const page = (await this.list()).find((entry) => entry.path === path);
    if (!page)
      throw new DocumentationError(
        "Documentation path is not in the index",
        "invalid_path",
      );
    const markdown = await this.request(
      `${path}.md`,
      "text/markdown",
      markdownLimit,
    );
    if (/^\s*(?:<!doctype html|<html\b)/i.test(markdown))
      throw new DocumentationError(
        "Unexpected documentation content type",
        "unexpected_content",
      );
    if (!markdown.trim())
      throw new DocumentationError(
        "Invalid documentation page",
        "invalid_response",
      );
    return { path, title: page.title, markdown };
  }
}
