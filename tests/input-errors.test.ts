import { expect, test, vi } from "vitest";
import {
  AgentWorkplace,
  AgentWorkplaceInputError,
  parseFileReference,
} from "../src/index.js";

test("rejected caller input is a typed TypeError with a stable code", () => {
  let error: unknown;
  try {
    parseFileReference("24e02cd0-f2ce-4af1-9b34-94be61a435cd");
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(AgentWorkplaceInputError);
  expect(error).toBeInstanceOf(TypeError);
  expect(error).toMatchObject({
    name: "AgentWorkplaceInputError",
    code: "invalid_input",
    message: "Invalid file reference",
  });
});

test("client methods reject malformed input before sending", () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const client = new AgentWorkplace({
    baseUrl: "https://api.example.test",
    fetch,
  });
  expect(() =>
    client.getChatConversation({ apiKey: "key" }, "not-a-uuid"),
  ).toThrow(AgentWorkplaceInputError);
  expect(fetch).not.toHaveBeenCalled();
});
