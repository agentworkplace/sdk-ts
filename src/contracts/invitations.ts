import { z } from "zod";
import { mailboxAddressChoiceSchema, mailboxSchema } from "./mail.js";
import { agentCredentialSchema } from "./credentials.js";

// A canonical base64url encoding of 32 bytes has only these final characters.
export const invitationProofSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
export const invitationSchema = z
  .object({
    id: z.uuid(),
    workplaceId: z.uuid(),
    accountId: z.uuid(),
    issuerId: z.uuid(),
    kind: z.enum(["agent", "human"]),
    role: z.enum(["admin", "member"]),
    name: z.string().min(1).max(100).nullable(),
    state: z.enum(["pending", "consumed", "canceled", "expired"]),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export const createAgentInvitationRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    role: z.enum(["admin", "member"]).optional(),
  })
  .strict();
export const issuedAgentInvitationSchema = invitationSchema.extend({
  kind: z.literal("agent"),
  code: invitationProofSchema,
});
export const invitationListRequestSchema = z
  .object({
    after: z.uuid().optional(),
    state: z.literal("pending").optional(),
  })
  .strict();
export const invitationListSchema = z
  .object({
    items: z.array(invitationSchema).max(100),
    nextCursor: z.uuid().nullable(),
  })
  .strict();
export const invitationPreviewRequestSchema = z
  .object({
    invitationId: z.uuid(),
    code: invitationProofSchema,
  })
  .strict();
export const invitationPreviewSchema = invitationSchema.extend({
  workplaceName: z.string(),
});
export const invitationHandoffRequestSchema = z
  .object({
    invitationId: z.uuid(),
    handoffId: z.uuid(),
  })
  .strict();
export const invitationRecoveryRequestSchema =
  invitationHandoffRequestSchema.extend({
    recoveryProof: invitationProofSchema,
  });
export const invitationRedemptionRequestSchema =
  invitationRecoveryRequestSchema.extend({
    code: invitationProofSchema,
    mailboxAddressChoice: mailboxAddressChoiceSchema.optional(),
  });
export const invitationAdmissionSchema = z
  .object({
    invitationId: z.uuid(),
    handoffId: z.uuid(),
    workplaceId: z.uuid(),
    accountId: z.uuid(),
    role: z.enum(["owner", "admin", "member"]),
    mailbox: mailboxSchema,
    recoveryExpiresAt: z.iso.datetime(),
    credential: agentCredentialSchema,
  })
  .strict();
export const invitationCanceledSchema = z
  .object({ canceled: z.literal(true) })
  .strict();

export type Invitation = z.infer<typeof invitationSchema>;
export type CreateAgentInvitationRequest = z.infer<
  typeof createAgentInvitationRequestSchema
>;
export type IssuedAgentInvitation = z.infer<typeof issuedAgentInvitationSchema>;
export type InvitationList = z.infer<typeof invitationListSchema>;
export type InvitationPreviewRequest = z.infer<
  typeof invitationPreviewRequestSchema
>;
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;
export type InvitationHandoffRequest = z.infer<
  typeof invitationHandoffRequestSchema
>;
export type InvitationRecoveryRequest = z.infer<
  typeof invitationRecoveryRequestSchema
>;
export type InvitationRedemptionRequest = z.infer<
  typeof invitationRedemptionRequestSchema
>;
export type InvitationAdmission = z.infer<typeof invitationAdmissionSchema>;

export const createHumanInvitationRequestSchema = z
  .object({
    email: z
      .string()
      .trim()
      .pipe(z.email())
      .transform((value) => value.toLowerCase()),
    name: z.string().trim().min(1).max(100).optional(),
    role: z.enum(["admin", "member"]).optional(),
  })
  .strict();
export const issuedHumanInvitationSchema = invitationSchema.extend({
  kind: z.literal("human"),
  code: invitationProofSchema,
});
export const humanInvitationCodeRequestSchema =
  invitationPreviewRequestSchema.extend({
    email: z
      .string()
      .trim()
      .pipe(z.email())
      .transform((value) => value.toLowerCase()),
  });
export const humanInvitationAcceptRequestSchema =
  humanInvitationCodeRequestSchema.extend({ otp: z.string().regex(/^\d{6}$/) });
export const humanInvitationAdmissionSchema = z
  .object({
    admitted: z.literal(true),
    accountId: z.uuid(),
    workplaceId: z.uuid(),
    mailbox: mailboxSchema,
  })
  .strict();
export type CreateHumanInvitationRequest = z.infer<
  typeof createHumanInvitationRequestSchema
>;
export type IssuedHumanInvitation = z.infer<typeof issuedHumanInvitationSchema>;
export type HumanInvitationCodeRequest = z.infer<
  typeof humanInvitationCodeRequestSchema
>;
export type HumanInvitationAcceptRequest = z.infer<
  typeof humanInvitationAcceptRequestSchema
>;
export type HumanInvitationAdmission = z.infer<
  typeof humanInvitationAdmissionSchema
>;

export const humanInvitationFileSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("human-invitation"),
    origin: z.url().regex(/^https?:\/\/[^/?#@]+$/),
    invitationId: z.uuid(),
    workplaceId: z.uuid(),
    accountId: z.uuid(),
    code: invitationProofSchema,
  })
  .strict();
export type HumanInvitationFile = z.infer<typeof humanInvitationFileSchema>;
