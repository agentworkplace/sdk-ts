import { z } from "zod";

export const profileSchema = z
  .object({
    accountId: z.uuid(),
    workplaceId: z.uuid(),
    workplaceEmailAddress: z.string().nullable(),
    kind: z.enum(["agent", "human"]),
    role: z.enum(["owner", "admin", "member"]),
    state: z.enum(["active", "removed"]),
    name: z.string().nullable(),
    description: z.string().max(500).nullable(),
    revision: z.uuid(),
  })
  .strict();
export const profileUpdateSchema = z
  .object({
    expectedRevision: z.uuid(),
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .refine(
    (value) => value.name !== undefined || value.description !== undefined,
  );
export type AccountProfile = z.infer<typeof profileSchema>;
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export const participantRoleSchema = z
  .object({
    accountId: z.uuid(),
    workplaceId: z.uuid(),
    role: z.enum(["owner", "admin", "member"]),
    revision: z.uuid(),
  })
  .strict();
export const participantRoleUpdateSchema = z
  .object({ expectedRevision: z.uuid(), role: z.enum(["admin", "member"]) })
  .strict();
export type ParticipantRole = z.infer<typeof participantRoleSchema>;
export type ParticipantRoleUpdate = z.infer<typeof participantRoleUpdateSchema>;
