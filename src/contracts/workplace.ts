import { z } from "zod";

export const workplaceSettingsSchema = z
  .object({
    workplaceId: z.uuid(),
    name: z.string(),
    description: z.string().max(500).nullable(),
    revision: z.uuid(),
  })
  .strict();
export const workplaceSettingsUpdateSchema = z
  .object({
    expectedRevision: z.uuid(),
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .refine(
    (value) => value.name !== undefined || value.description !== undefined,
  );
export type WorkplaceSettings = z.infer<typeof workplaceSettingsSchema>;
export type WorkplaceSettingsUpdate = z.infer<
  typeof workplaceSettingsUpdateSchema
>;
