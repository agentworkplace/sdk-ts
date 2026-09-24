import { describe, expect, it } from "vitest";
import {
  deletionConfirmationSchema,
  deletionProofSchema,
  deletionStatusSchema,
} from "./access.js";
describe("deletion evidence contracts", () => {
  it("requires an operation-bound six-digit code and private proof", () => {
    const valid = {
      receiptProof: "a".repeat(43),
      code: "012345",
      challengeId: "21e14f1e-f0f1-4e59-8bd5-384bc70ed1c9",
    };
    expect(deletionConfirmationSchema.safeParse(valid).success).toBe(true);
    expect(
      deletionConfirmationSchema.safeParse({ ...valid, code: "12345" }).success,
    ).toBe(false);
    expect(
      deletionProofSchema.safeParse({ receiptProof: "email@example.test" })
        .success,
    ).toBe(false);
  });
  it("does not expose identity or resource data through receipt status", () => {
    const valid = {
      state: "deleted",
      initiatedAt: "2026-09-12T00:00:00Z",
      receiptExpiresAt: "2026-10-12T00:00:00Z",
    };
    expect(deletionStatusSchema.safeParse(valid).success).toBe(true);
    expect(
      deletionStatusSchema.safeParse({ ...valid, workplaceId: "private" })
        .success,
    ).toBe(false);
  });
});
