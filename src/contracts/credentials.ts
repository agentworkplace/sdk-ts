import { z } from "zod";

import { agentGrantScopeSchema, agentGrantScopes } from "./agent-grants.js";

export const agentKeyNameSchema = z
  .object({ name: z.string().trim().min(1).max(32) })
  .strict();
/** A scoped key carries one to nine distinct agent grant scope groups. */
export const agentKeyScopesSchema = z
  .array(agentGrantScopeSchema)
  .min(1)
  .max(agentGrantScopes.length)
  .refine((scopes) => new Set(scopes).size === scopes.length, {
    message: "Scopes must be distinct",
  });
/** Creating a key with scopes; an omitted list issues an unscoped key. */
export const agentKeyCreateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(32),
    scopes: agentKeyScopesSchema.optional(),
  })
  .strict();
/** Listing returns scopes only on request: released clients reject the field. */
export const agentKeyListQuerySchema = z
  .object({ include: z.literal("scopes").optional() })
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
/** Key metadata with its scopes; `null` is an unscoped key. */
export const agentKeyScopedMetadataSchema = agentKeyMetadataSchema
  .extend({ scopes: agentKeyScopesSchema.nullable() })
  .strict();
export const agentKeyScopedListSchema = z
  .object({ keys: z.array(agentKeyScopedMetadataSchema) })
  .strict();
export const agentCredentialSchema = z
  .object({ id: z.uuid(), key: z.string().min(1) })
  .strict();
/** Replace every key, or keep the key authenticating this request and revoke the
 * rest. The second form lets an agent save its replacement before losing access. */
export const agentKeyRecoveryRequestSchema = z.union([
  agentKeyNameSchema,
  z.object({ keepCurrentKey: z.literal(true) }).strict(),
]);
export const agentKeysRecoveredSchema = z
  .object({ recovered: z.literal(true), id: z.uuid() })
  .strict();
export const agentKeyRecoverySchema = z.union([
  agentCredentialSchema,
  agentKeysRecoveredSchema,
]);
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
export type AgentKeyScopedList = z.infer<typeof agentKeyScopedListSchema>;
export type AgentKeyScopes = z.infer<typeof agentKeyScopesSchema>;
export type AgentCredential = z.infer<typeof agentCredentialSchema>;
export type KeyRotationResponse = z.infer<typeof keyRotationResponseSchema>;

const participantSchema = z
  .object({
    id: z.uuid(),
    name: z.string().nullable(),
    kind: z.enum(["agent", "human"]),
    role: z.enum(["owner", "admin", "member"]),
    state: z.enum(["active", "removed"]),
    departureKind: z.enum(["departed", "removed"]).nullable(),
    departedAt: z.iso.datetime().nullable(),
  })
  .strict();
export const participantListSchema = z
  .object({ participants: z.array(participantSchema) })
  .strict();
/** Opt-in workplace email addresses; responses without it keep their shape. */
export const participantListRequestSchema = z
  .object({ include: z.enum(["mailboxAddress"]).optional() })
  .strict();
export type ParticipantListRequest = z.input<
  typeof participantListRequestSchema
>;
/** Adds each active participant's designated Mailbox address (else null).
 * It names the address only and grants no Mailbox access. */
export const participantListWithMailboxesSchema = z
  .object({
    participants: z.array(
      participantSchema
        .extend({ mailboxAddress: z.string().max(320).nullable() })
        .strict(),
    ),
  })
  .strict();
export type ParticipantListWithMailboxes = z.infer<
  typeof participantListWithMailboxesSchema
>;
export const participantRemovedSchema = z
  .object({ removed: z.literal(true), accountId: z.uuid() })
  .strict();
export type ParticipantList = z.infer<typeof participantListSchema>;
