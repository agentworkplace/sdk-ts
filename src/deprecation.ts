/** A deprecation the API announced on a response; the request itself still ran. */
export interface AgentWorkplaceDeprecation {
  /** HTTP method of the request that returned the notice. */
  method: string;
  /** Request path, without the query, such as `/v1/mail/messages/<id>`. */
  path: string;
  /** When the API deprecated the operation (`Deprecation`). */
  deprecatedAt: Date;
  /** When the operation may stop working (`Sunset`), if the API set one. */
  sunsetAt?: Date;
  /** The public announcement and replacement (`Link rel="deprecation"`). */
  link?: string;
  /** The response's `X-Request-ID`, for support reports. */
  requestId?: string;
}

/** RFC 9745 Date: `@` and whole Unix seconds. */
function deprecationDate(value: string | null) {
  const match = value === null ? null : /^@(-?\d{1,12})$/.exec(value.trim());
  return match ? new Date(Number(match[1]) * 1000) : undefined;
}

/** RFC 8594 IMF-fixdate. */
function sunsetDate(value: string | null) {
  if (value === null || value.length > 64) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** The first HTTPS `rel="deprecation"` target in an RFC 8288 `Link` header. */
function deprecationLink(value: string | null) {
  if (value === null || value.length > 2048) return undefined;
  for (const match of value.matchAll(/<([^>]*)>([^,<]*)/g)) {
    const relation = /;\s*rel\s*=\s*(?:"([^"]*)"|([^\s;,]+))/i.exec(
      match[2] ?? "",
    );
    const relations = (relation?.[1] ?? relation?.[2] ?? "")
      .toLowerCase()
      .split(/\s+/);
    if (!relations.includes("deprecation")) continue;
    try {
      const url = new URL(match[1] ?? "");
      if (url.protocol === "https:" && !url.username && !url.password)
        return url.href;
    } catch {
      // A malformed target is not an announcement.
    }
  }
  return undefined;
}

export function responseDeprecation(
  response: Response,
  request: { method: string; url: URL; requestId: string | undefined },
): AgentWorkplaceDeprecation | undefined {
  const deprecatedAt = deprecationDate(response.headers.get("Deprecation"));
  if (deprecatedAt === undefined) return undefined;
  const sunsetAt = sunsetDate(response.headers.get("Sunset"));
  const link = deprecationLink(response.headers.get("Link"));
  return {
    method: request.method,
    path: request.url.pathname,
    deprecatedAt,
    ...(sunsetAt === undefined ? {} : { sunsetAt }),
    ...(link === undefined ? {} : { link }),
    ...(request.requestId === undefined
      ? {}
      : { requestId: request.requestId }),
  };
}

/** Calls the application's handler without letting it change the request's outcome. */
export function notifyDeprecation(
  handler: ((deprecation: AgentWorkplaceDeprecation) => void) | undefined,
  deprecation: AgentWorkplaceDeprecation | undefined,
) {
  if (handler === undefined || deprecation === undefined) return;
  try {
    const result: unknown = handler(deprecation);
    if (
      typeof result === "object" &&
      result !== null &&
      typeof (result as { then?: unknown }).then === "function"
    )
      (result as PromiseLike<unknown>).then(undefined, () => undefined);
  } catch {
    // A failing handler must not turn a completed request into a failure.
  }
}
