import { z } from "zod";

export const agentKeyNameSchema = z
  .object({ name: z.string().trim().min(1).max(32) })
  .strict();
export const agentKeyTargetSchema = z.object({ accountId: z.uuid() }).strict();
export const agentKeyIdSchema = agentKeyTargetSchema.extend({
  keyId: z.uuid(),
});
export const agentKeyMetadataSchema = z
  .object({
    id: z.uuid(),
    name: z.string().nullable(),
    enabled: z.boolean(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime().nullable(),
  })
  .strict();
export const agentKeyListSchema = z
  .object({ keys: z.array(agentKeyMetadataSchema) })
  .strict();
export const agentCredentialSchema = z
  .object({ id: z.uuid(), key: z.string().min(1) })
  .strict();
export const agentKeyRevokedSchema = z
  .object({ revoked: z.literal(true) })
  .strict();
export const agentKeyRenamedSchema = z
  .object({ renamed: z.literal(true) })
  .strict();
export const keyRotationRequestSchema = agentKeyNameSchema.extend({
  operationId: z.uuid(),
});
export const keyRotationResponseSchema = agentCredentialSchema.extend({
  operationId: z.uuid(),
  predecessorId: z.uuid(),
});
export const keyRotationCompletionSchema = z
  .object({ operationId: z.uuid() })
  .strict();
export const keyRotationCompletedSchema = z
  .object({ completed: z.literal(true) })
  .strict();
export type AgentKeyList = z.infer<typeof agentKeyListSchema>;
export type AgentCredential = z.infer<typeof agentCredentialSchema>;
export type KeyRotationResponse = z.infer<typeof keyRotationResponseSchema>;

export const participantListSchema = z
  .object({
    participants: z.array(
      z
        .object({
          id: z.uuid(),
          name: z.string().nullable(),
          kind: z.enum(["agent", "human"]),
          role: z.enum(["owner", "admin", "member"]),
          state: z.enum(["active", "removed"]),
          departureKind: z.enum(["departed", "removed"]).nullable(),
          departedAt: z.iso.datetime().nullable(),
        })
        .strict(),
    ),
  })
  .strict();
export const participantRemovedSchema = z
  .object({ removed: z.literal(true), accountId: z.uuid() })
  .strict();
export type ParticipantList = z.infer<typeof participantListSchema>;
