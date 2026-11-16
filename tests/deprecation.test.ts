import { expect, it, vi } from "vitest";

import { AgentWorkplace } from "../src/client.js";
import type { AgentWorkplaceDeprecation } from "../src/deprecation.js";
import { AgentWorkplaceInputError } from "../src/errors.js";

const requestId = "0b8f5d2e-8f2a-4b6e-9c3d-1a2b3c4d5e6f";
const deprecationHeaders = {
  Deprecation: "@1796083200",
  Sunset: "Mon, 01 Mar 2027 00:00:00 GMT",
  Link: '<https://agentworkplace.dev/changelog/example>; rel="deprecation"; type="text/html"',
  "X-Request-ID": requestId,
};

function client(
  headers: Record<string, string>,
  onDeprecation: (deprecation: AgentWorkplaceDeprecation) => void,
  status = 200,
) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    status === 200
      ? Response.json({ acknowledged: true }, { headers })
      : Response.json(
          { error: { code: "test_conflict", message: "Conflict" } },
          { status, headers },
        ),
  );
  return new AgentWorkplace({ fetch, onDeprecation });
}

const trash = (workplace: AgentWorkplace) =>
  workplace.trashMailMessage({ apiKey: "key" }, "message");

it("reports a deprecated operation with its dates, link and request ID", async () => {
  const onDeprecation = vi.fn();
  await trash(client(deprecationHeaders, onDeprecation));
  expect(onDeprecation).toHaveBeenCalledExactlyOnceWith({
    method: "POST",
    path: "/v1/mail/messages/message/trash",
    deprecatedAt: new Date("2026-12-01T00:00:00Z"),
    sunsetAt: new Date("2027-03-01T00:00:00Z"),
    link: "https://agentworkplace.dev/changelog/example",
    requestId,
  });
});

it("reports the notice before throwing an API error", async () => {
  const onDeprecation = vi.fn();
  await expect(
    trash(client(deprecationHeaders, onDeprecation, 409)),
  ).rejects.toMatchObject({ code: "test_conflict", status: 409 });
  expect(onDeprecation).toHaveBeenCalledOnce();
});

it("stays silent for operations that are not deprecated", async () => {
  const onDeprecation = vi.fn();
  await trash(client({ "X-Request-ID": requestId }, onDeprecation));
  expect(onDeprecation).not.toHaveBeenCalled();
});

it.each([
  ["a date that is not RFC 9745", { Deprecation: "true" }],
  ["a fractional date", { Deprecation: "@1796083200.5" }],
])("ignores %s", async (_label, headers) => {
  const onDeprecation = vi.fn();
  await trash(client(headers, onDeprecation));
  expect(onDeprecation).not.toHaveBeenCalled();
});

it("keeps only usable Sunset and HTTPS deprecation links", async () => {
  const onDeprecation = vi.fn();
  await trash(
    client(
      {
        Deprecation: "@1796083200",
        Sunset: "soon",
        Link: '<http://agentworkplace.dev/changelog/plain>; rel="deprecation", <https://agentworkplace.dev/docs>; rel=alternate, <https://agentworkplace.dev/changelog/secure>; rel="sunset deprecation"',
      },
      onDeprecation,
    ),
  );
  expect(onDeprecation).toHaveBeenCalledExactlyOnceWith({
    method: "POST",
    path: "/v1/mail/messages/message/trash",
    deprecatedAt: new Date("2026-12-01T00:00:00Z"),
    link: "https://agentworkplace.dev/changelog/secure",
  });
});

it("ignores failing handlers so the request outcome is unchanged", async () => {
  await expect(
    trash(
      client(deprecationHeaders, () => {
        throw new Error("handler failed");
      }),
    ),
  ).resolves.toEqual({ acknowledged: true });
  await expect(
    trash(
      client(deprecationHeaders, (() =>
        Promise.reject(new Error("async handler failed"))) as never),
    ),
  ).resolves.toEqual({ acknowledged: true });
});

it("rejects an onDeprecation that is not a function", () => {
  expect(() => new AgentWorkplace({ onDeprecation: "warn" as never })).toThrow(
    AgentWorkplaceInputError,
  );
});
