import { z } from "zod";

export const feedbackCategorySchema = z.enum(["bug", "suggestion", "general"]);

export const feedbackSubmissionSchema = z.strictObject({
  submissionId: z.uuid(),
  message: z.string(),
  category: feedbackCategorySchema.optional(),
  relatedRequestId: z.uuid().optional(),
});

export const feedbackReceiptSchema = z.strictObject({
  feedbackId: z.uuid(),
  submissionId: z.uuid(),
  state: z.literal("received"),
  receivedAt: z.iso.datetime({ offset: true }),
});

export type FeedbackSubmission = z.infer<typeof feedbackSubmissionSchema>;
export type FeedbackReceipt = z.infer<typeof feedbackReceiptSchema>;
export type FeedbackCategory = z.infer<typeof feedbackCategorySchema>;
