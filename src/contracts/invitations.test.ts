import { describe, expect, it } from "vitest";
import {
  createAgentInvitationRequestSchema,
  invitationProofSchema,
  invitationRedemptionRequestSchema,
  invitationRecoveryRequestSchema,
  invitationSchema,
} from "./invitations.js";

describe("invitation wire boundaries", () => {
  it("accepts canonical recipient proofs and rejects alternate encodings", () => {
    for (const suffix of "AEIMQUYcgkosw048") {
      const proof = "A".repeat(42) + suffix;
      expect(invitationProofSchema.parse(proof)).toBe(proof);
    }
    for (const proof of [
      "a".repeat(43),
      "a".repeat(42),
      "a".repeat(44),
      "A".repeat(43) + "=",
      " A".repeat(22),
    ])
      expect(invitationProofSchema.safeParse(proof).success).toBe(false);
  });
  it("admits only the approved invitation roles and normalized name", () => {
    expect(
      createAgentInvitationRequestSchema.parse({ name: " Agent " }),
    ).toEqual({ name: "Agent" });
    for (const input of [
      { name: " " },
      { name: "x".repeat(101) },
      { name: "Agent", role: "owner" },
      { name: "Agent", workplaceId: "9ea2537a-ea98-4322-8c1b-c43458937c47" },
    ])
      expect(createAgentInvitationRequestSchema.safeParse(input).success).toBe(
        false,
      );
  });
  it("requires the private handoff proof independently from the invitation code", () => {
    const input = {
      invitationId: "9ea2537a-ea98-4322-8c1b-c43458937c47",
      handoffId: "9ea2537a-ea98-4322-8c1b-c43458937c47",
      recoveryProof: "A".repeat(43),
      code: "A".repeat(43),
    };
    expect(invitationRedemptionRequestSchema.parse(input)).toEqual(input);
    expect(
      invitationRedemptionRequestSchema.safeParse({
        ...input,
        recoveryProof: undefined,
      }).success,
    ).toBe(false);
    expect(invitationRecoveryRequestSchema.safeParse(input).success).toBe(
      false,
    );
    const recovery = {
      invitationId: input.invitationId,
      handoffId: input.handoffId,
      recoveryProof: input.recoveryProof,
    };
    expect(invitationRecoveryRequestSchema.parse(recovery)).toEqual(recovery);
    expect(
      invitationRedemptionRequestSchema.safeParse({
        ...input,
        invitationId: "not-an-id",
      }).success,
    ).toBe(false);
  });
  it("rejects secret expansion of ordinary invitation records", () => {
    const row = {
      id: "9ea2537a-ea98-4322-8c1b-c43458937c47",
      accountId: "9ea2537a-ea98-4322-8c1b-c43458937c47",
      workplaceId: "9ea2537a-ea98-4322-8c1b-c43458937c47",
      issuerId: "9ea2537a-ea98-4322-8c1b-c43458937c47",
      kind: "agent",
      role: "member",
      name: null,
      state: "expired",
      createdAt: "2026-09-01T00:00:00.000Z",
      expiresAt: "2026-09-08T00:00:00.000Z",
    };
    expect(invitationSchema.parse(row)).toEqual(row);
    for (const field of [
      "code",
      "proofHash",
      "encryptedCredential",
      "credential",
    ])
      expect(
        invitationSchema.safeParse({ ...row, [field]: "secret" }).success,
      ).toBe(false);
  });
});
