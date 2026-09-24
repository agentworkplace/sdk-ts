import { describe, expect, it } from "vitest";
import {
  signupRequestSchema,
  ownershipConfirmationRequestSchema,
  signupResponseSchema,
  storageUsageSchema,
  accessStatusSchema,
  accountAccessStatusSchema,
  nominationCorrectionRequestSchema,
  nominationCancellationRequestSchema,
} from "./access.js";

const request = {
  name: " Agent ",
  nominatedEmail: "Owner@Example.test",
  bootstrapProof: "a".repeat(43),
};
describe("access wire contracts", () => {
  it("requires a nomination-scoped six-digit confirmation code", () => {
    const input = {
      nominationId: "1c9c6078-c31d-40a0-8452-43038dc056e9",
      code: "001234",
    };
    expect(ownershipConfirmationRequestSchema.parse(input)).toEqual(input);
    for (const code of ["12345", "1234567", "12a456", 123456, undefined])
      expect(
        ownershipConfirmationRequestSchema.safeParse({ ...input, code })
          .success,
      ).toBe(false);
    expect(
      ownershipConfirmationRequestSchema.safeParse({
        ...input,
        email: "owner@example.test",
      }).success,
    ).toBe(false);
  });
  it("requires explicit nomination targets and validates corrected human emails", () => {
    const nominationId = "1c9c6078-c31d-40a0-8452-43038dc056e9";
    expect(
      nominationCorrectionRequestSchema.parse({
        nominationId,
        nominatedEmail: "Owner+Tag@Example.test",
      }),
    ).toEqual({ nominationId, nominatedEmail: "owner+tag@example.test" });
    for (const invalid of [
      { nominatedEmail: "owner@example.test" },
      { nominationId, nominatedEmail: "agent@agent.invalid" },
      { nominationId, nominatedEmail: "invalid" },
      {
        nominationId,
        nominatedEmail: "owner@example.test",
        workplaceId: nominationId,
      },
    ])
      expect(nominationCorrectionRequestSchema.safeParse(invalid).success).toBe(
        false,
      );
    expect(
      nominationCancellationRequestSchema.safeParse({ nominationId }).success,
    ).toBe(true);
    expect(
      nominationCancellationRequestSchema.safeParse({
        nominatedEmail: "owner@example.test",
      }).success,
    ).toBe(false);
  });
  it("normalizes enrollment inputs and rejects invalid proof or human email", () => {
    expect(signupRequestSchema.parse(request)).toMatchObject({
      name: "Agent",
      nominatedEmail: "owner@example.test",
    });
    for (const change of [
      { bootstrapProof: "short" },
      { nominatedEmail: "agent@agent.invalid" },
      { name: "" },
      { role: "owner" },
    ])
      expect(
        signupRequestSchema.safeParse({ ...request, ...change }).success,
      ).toBe(false);
  });
  it("requires a coherent account/allowance state without signup metadata", () => {
    const status = {
      accountId: "1c9c6078-c31d-40a0-8452-43038dc056e9",
      workplaceId: "2c9c6078-c31d-40a0-8452-43038dc056e9",
      kind: "human",
      role: "member",
      state: "active",
      workplaceState: "unconfirmed",
      cleanupAt: "2026-10-11T00:00:00Z",
      cleanupWarning: null,
      free: null,
      starter: {
        outboundLimit: 2,
        inboundLimit: 20,
        storageLimit: "100 MB",
        outboundUsed: 0,
        inboundUsed: 0,
        storageUsedBytes: 0,
      },
    };
    expect(accountAccessStatusSchema.parse(status)).toEqual(status);
    const storage = {
      limitBytes: 100000000,
      usedBytes: 64,
      heldBytes: 128,
      availableBytes: 99999808,
    };
    expect(
      accountAccessStatusSchema.parse({ ...status, storage }).storage,
    ).toEqual(storage);
    expect(
      accountAccessStatusSchema.safeParse({
        ...status,
        storage: { ...storage, heldBytes: -1 },
      }).success,
    ).toBe(false);
    for (const change of [
      { cleanupAt: null },
      { starter: null },
      { workplaceState: "deleting" },
      { state: "removed" },
      { workplaceState: "confirmed" },
      { kind: "service" },
    ])
      expect(
        accountAccessStatusSchema.safeParse({ ...status, ...change }).success,
      ).toBe(false);
  });
  it("does not accept incomplete credential or status responses", () => {
    expect(
      signupResponseSchema.safeParse({ credential: { key: "key" } }).success,
    ).toBe(false);
    expect(accessStatusSchema.safeParse({ acknowledged: true }).success).toBe(
      false,
    );
  });
});

it("validates exact retained-byte status without accepting fractional or negative capacity", () => {
  const snapshot = {
    limitBytes: 100_000_000,
    usedBytes: 12,
    heldBytes: 34,
    availableBytes: 99_999_954,
  };
  expect(storageUsageSchema.parse(snapshot)).toEqual(snapshot);
  for (const field of Object.keys(snapshot)) {
    for (const invalid of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1])
      expect(
        storageUsageSchema.safeParse({ ...snapshot, [field]: invalid }).success,
      ).toBe(false);
  }
});
