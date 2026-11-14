import { afterEach, expect, it, vi } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { AgentWorkplace } from "../src/client.js";
import { AgentWorkplaceInputError } from "../src/errors.js";
import { sdkVersion } from "../src/version.js";

const respond = () =>
  vi.fn<typeof globalThis.fetch>(async () =>
    Response.json({ acknowledged: true }),
  );

const userAgentOf = async (
  client: AgentWorkplace,
  fetch: ReturnType<typeof respond>,
) => {
  await client.trashMailMessage({ apiKey: "key" }, "message");
  return new Headers(fetch.mock.calls[0]![1]?.headers).get("User-Agent");
};

afterEach(() => {
  vi.unstubAllGlobals();
});

it("reports the version in package.json", () => {
  expect(sdkVersion).toBe(manifest.version);
});

it("names the SDK, after any application tokens, on server runtimes", async () => {
  let fetch = respond();
  expect(await userAgentOf(new AgentWorkplace({ fetch }), fetch)).toBe(
    `agent-workplace-sdk/${sdkVersion}`,
  );
  fetch = respond();
  expect(
    await userAgentOf(
      new AgentWorkplace({
        fetch,
        userAgent: "agent-workplace-cli/0.15.0",
      }),
      fetch,
    ),
  ).toBe(`agent-workplace-cli/0.15.0 agent-workplace-sdk/${sdkVersion}`);
});

it("sends no User-Agent from browsers, so no preflight is added", async () => {
  vi.stubGlobal("process", undefined);
  const fetch = respond();
  const client = new AgentWorkplace({
    fetch,
    userAgent: "dashboard/1",
  });
  vi.unstubAllGlobals();
  expect(await userAgentOf(client, fetch)).toBeNull();
});

it.each([
  "",
  "agent workplace",
  "cli/1 sdk/2 extra/3",
  "cli/1 (darwin)",
  "cli/1\r\nX-Injected: yes",
  `${"a".repeat(41)}/1`,
  42,
])("refuses an unsafe userAgent %j", (userAgent) => {
  expect(
    () =>
      new AgentWorkplace({
        fetch: respond(),
        userAgent: userAgent as string,
      }),
  ).toThrow(AgentWorkplaceInputError);
});
