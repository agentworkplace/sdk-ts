import { expect, it } from "vitest";
import {
  ownerEmailBeginSchema,
  ownerEmailCodeSchema,
  ownerEmailStatusSchema,
  ownerEmailResendSchema,
} from "./access.js";
const receiptProof = "a".repeat(43),
  operationId = "21e14f1e-f0f1-4e59-8bd5-384bc70ed1c9";
it("requires private receipt, exact ASCII proof and explicit generation", () => {
  const valid = { receiptProof, operationId, code: "012345", generation: 1 };
  expect(ownerEmailCodeSchema.safeParse(valid).success).toBe(true);
  for (const code of ["12345", "012345\n", "１２３４５６", "abcdef"])
    expect(ownerEmailCodeSchema.safeParse({ ...valid, code }).success).toBe(
      false,
    );
  for (const generation of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    expect(
      ownerEmailResendSchema.safeParse({
        receiptProof,
        operationId,
        generation,
      }).success,
    ).toBe(false);
  expect(
    ownerEmailCodeSchema.safeParse({
      ...valid,
      newEmail: "injected@example.test",
    }).success,
  ).toBe(false);
});
it("normalizes the destination and rejects internal or extra identity fields", () => {
  expect(
    ownerEmailBeginSchema.parse({ receiptProof, newEmail: "Next@EXAMPLE.test" })
      .newEmail,
  ).toBe("next@example.test");
  expect(
    ownerEmailBeginSchema.safeParse({
      receiptProof,
      newEmail: "agent@example.invalid",
    }).success,
  ).toBe(false);
  expect(
    ownerEmailBeginSchema.safeParse({
      receiptProof,
      newEmail: "next@example.test",
      accountId: operationId,
    }).success,
  ).toBe(false);
});
it("represents unavailable receipt without asserting failure and excludes identity details", () => {
  expect(ownerEmailStatusSchema.parse({ operation: null })).toEqual({
    operation: null,
  });
  const operation = {
    operationId,
    state: "completed",
    generation: 2,
    createdAt: "2026-09-18T00:00:00Z",
    expiresAt: "2026-09-18T00:10:00Z",
    receiptExpiresAt: "2026-10-18T00:00:00Z",
    finishedAt: "2026-09-18T00:05:00Z",
  };
  expect(ownerEmailStatusSchema.safeParse({ operation }).success).toBe(true);
  expect(
    ownerEmailStatusSchema.safeParse({
      operation: { ...operation, newEmail: "private@example.test" },
    }).success,
  ).toBe(false);
});
