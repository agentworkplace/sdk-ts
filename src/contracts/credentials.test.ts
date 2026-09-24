import { describe, expect, it } from "vitest";
import {
  agentCredentialSchema,
  agentKeyListSchema,
  agentKeyNameSchema,
  keyRotationRequestSchema,
} from "./credentials.js";
describe("credential contracts", () => {
  it("accepts bounded names and rejects unsupported privileged fields", () => {
    expect(agentKeyNameSchema.parse({ name: " Work key " })).toEqual({
      name: "Work key",
    });
    for (const value of [
      { name: " " },
      { name: "x".repeat(33) },
      { name: "Key", enabled: true },
    ])
      expect(agentKeyNameSchema.safeParse(value).success).toBe(false);
    expect(
      keyRotationRequestSchema.safeParse({
        name: "Key",
        operationId: "unbound",
      }).success,
    ).toBe(false);
  });
  it("keeps private issuance separate from strict metadata", () => {
    const id = "12345678-1234-4123-8123-123456789abc";
    expect(agentCredentialSchema.parse({ id, key: "private-once" })).toEqual({
      id,
      key: "private-once",
    });
    const metadata = {
      id,
      name: "Work",
      enabled: true,
      createdAt: "2026-09-12T00:00:00.000Z",
      expiresAt: null,
    };
    expect(agentKeyListSchema.safeParse({ keys: [metadata] }).success).toBe(
      true,
    );
    expect(
      agentKeyListSchema.safeParse({
        keys: [{ ...metadata, key: "hash-or-secret" }],
      }).success,
    ).toBe(false);
  });
});
