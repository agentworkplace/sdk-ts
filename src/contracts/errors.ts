import { z } from "zod";

export const apiErrorCodeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);

export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const commonApiErrorCodes = {
  internalError: "internal_error",
  notFound: "not_found",
} as const satisfies Record<string, ApiErrorCode>;

export const apiErrorSchema = z.object({
  code: apiErrorCodeSchema,
  choiceRevision: z.number().int().nonnegative().optional(),
  message: z.string().min(1),
});

export type ApiError = z.infer<typeof apiErrorSchema>;

export const apiErrorResponseSchema = z.object({
  error: apiErrorSchema,
});

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
