import {
  sendMailRequestSchema,
  mailAttachmentSelectionSchema,
  type MailOutgoingAttachmentSource,
  composeMailRequestSchema,
  type ComposeMailRequest,
  type SendMailRequest,
} from "./contracts/mail.js";

/** Validate and copy an immutable send request before saving it for retries.
 * This does not submit mail or allocate an operation identity. */
export function parseMailSendRequest(value: unknown): SendMailRequest {
  const result = sendMailRequestSchema.safeParse(value);
  if (!result.success) throw new TypeError("Invalid Mail send request");
  return result.data;
}

export function parseMailComposeRequest(value: unknown): ComposeMailRequest {
  const result = composeMailRequestSchema.safeParse(value);
  if (!result.success) throw new TypeError("Invalid Mail composition request");
  return result.data;
}

/** Validate/copy an ordered immutable source selection without contacting a server. */
export function parseMailAttachmentSelection(
  value: unknown,
): MailOutgoingAttachmentSource[] {
  const result = mailAttachmentSelectionSchema.safeParse(value);
  if (!result.success) throw new TypeError("Invalid Mail attachment selection");
  return result.data;
}
