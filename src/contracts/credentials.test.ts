import { describe, expect, it } from "vitest";
import { agentGrantScopes } from "./agent-grants.js";
import {
  agentCredentialSchema,
  agentKeyCreateRequestSchema,
  agentKeyListQuerySchema,
  agentKeyListSchema,
  agentKeyNameSchema,
  agentKeyScopedListSchema,
  agentKeyScopesSchema,
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
    // Scopes appear only in the opt-in shape, so released strict clients
    // never see them.
    expect(
      agentKeyListSchema.safeParse({ keys: [{ ...metadata, scopes: null }] })
        .success,
    ).toBe(false);
    for (const scopes of [null, ["mail"], ["mail", "files"]])
      expect(
        agentKeyScopedListSchema.safeParse({ keys: [{ ...metadata, scopes }] })
          .success,
      ).toBe(true);
  });
  it("bounds key scopes to distinct grant groups", () => {
    expect(
      agentKeyCreateRequestSchema.parse({
        name: "Triage",
        scopes: ["mail", "files"],
      }),
    ).toEqual({ name: "Triage", scopes: ["mail", "files"] });
    expect(agentKeyCreateRequestSchema.parse({ name: "Full" })).toEqual({
      name: "Full",
    });
    expect(agentKeyScopesSchema.safeParse([...agentGrantScopes]).success).toBe(
      true,
    );
    for (const scopes of [
      [],
      ["mail", "mail"],
      ["admin"],
      ["unscoped"],
      [...agentGrantScopes, "mail"],
    ])
      expect(agentKeyScopesSchema.safeParse(scopes).success, `${scopes}`).toBe(
        false,
      );
    expect(
      agentKeyCreateRequestSchema.safeParse({
        name: "Key",
        scopes: ["mail"],
        permissions: { scopes: ["billing"] },
      }).success,
    ).toBe(false);
    expect(agentKeyListQuerySchema.parse({ include: "scopes" })).toEqual({
      include: "scopes",
    });
    expect(agentKeyListQuerySchema.parse({})).toEqual({});
    expect(
      agentKeyListQuerySchema.safeParse({ include: "permissions" }).success,
    ).toBe(false);
  });
});
