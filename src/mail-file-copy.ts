import type { AgentWorkplace, CredentialAuthorization } from "./client.js";
import {
  mailAttachmentDownloadRequestSchema,
  type MailAttachmentDownloadRequest,
} from "./contracts/mail.js";
import type { BeginFileUploadRequest } from "./contracts/files.js";
import {
  prepareFileUpload,
  parseFileUploadRequest,
  fileBytesHash,
} from "./files.js";

type CopyClient = Pick<
  AgentWorkplace,
  | "downloadMailAttachment"
  | "beginFileUpload"
  | "finalizeFileUpload"
  | "uploadFileFromSource"
>;
export type MailAttachmentFileCopyRequest = Omit<
  Parameters<typeof prepareFileUpload>[0],
  "contentType"
> & {
  source: MailAttachmentDownloadRequest;
};
/** Persist before Files admission. Contains identities/checksums, never bytes or grants. */
export interface MailAttachmentFileCopyIntent {
  version: 1;
  source: MailAttachmentDownloadRequest;
  request: BeginFileUploadRequest;
}
export function parseMailAttachmentFileCopyIntent(
  value: unknown,
): MailAttachmentFileCopyIntent {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    const record = value as MailAttachmentFileCopyIntent;
    if (
      record.version !== 1 ||
      Object.keys(record).sort().join() !== "request,source,version"
    )
      throw new Error();
    const source = mailAttachmentDownloadRequestSchema.parse(record.source);
    const request = parseFileUploadRequest(record.request);
    if (request.byteLength > 10_000_000) throw new Error();
    return { version: 1, source, request };
  } catch {
    throw new TypeError("Invalid Mail attachment copy intent");
  }
}

export async function copyAttachmentToFile(
  client: CopyClient,
  auth: CredentialAuthorization,
  input: MailAttachmentFileCopyRequest,
  saveIntent: (intent: MailAttachmentFileCopyIntent) => Promise<void>,
) {
  if (typeof saveIntent !== "function")
    throw new TypeError("A copy intent persistence callback is required");
  const { source: unparsed, ...destination } = input;
  const source = mailAttachmentDownloadRequestSchema.parse(unparsed);
  // Validate destination/operation identity before requesting source bytes.
  prepareFileUpload(
    { ...destination, contentType: "application/octet-stream" },
    new Uint8Array(),
  );
  const downloaded = await client.downloadMailAttachment(auth, source);
  const intent = parseMailAttachmentFileCopyIntent({
    version: 1,
    source,
    request: prepareFileUpload(
      {
        ...destination,
        contentType:
          downloaded.attachment.contentType ?? "application/octet-stream",
      },
      downloaded.bytes,
    ),
  });
  // Parsing creates a separate object; caller mutation cannot alter this request.
  await saveIntent(parseMailAttachmentFileCopyIntent(intent));
  return transfer(client, auth, intent, downloaded.bytes);
}

export function resumeAttachmentFileCopy(
  client: CopyClient,
  auth: CredentialAuthorization,
  value: MailAttachmentFileCopyIntent,
) {
  return transfer(client, auth, parseMailAttachmentFileCopyIntent(value));
}

async function transfer(
  client: CopyClient,
  auth: CredentialAuthorization,
  intent: MailAttachmentFileCopyIntent,
  available?: Uint8Array,
) {
  // Replay admission first, including after a lost response. A completed copy
  // must not depend on continued Mail access or retention.
  const begun = await client.beginFileUpload(auth, intent.request);
  if (begun.state !== "pending") return begun;
  if (begun.transferState === "planned" || begun.transferState === "creating")
    return begun;
  const ref = {
    workplaceId: intent.request.workplaceId,
    uploadId: begun.uploadId,
  };
  if (
    !available ||
    begun.transferState === "completing" ||
    begun.transferState === "closed"
  ) {
    // Even an open source can have all parts uploaded before a process died.
    const finalized = await client.finalizeFileUpload(auth, ref);
    if (finalized.state !== "pending" || finalized.transferState !== "open")
      return finalized;
  }
  const bytes =
    available ??
    (await client.downloadMailAttachment(auth, intent.source)).bytes;
  if (
    bytes.byteLength !== intent.request.byteLength ||
    fileBytesHash(bytes) !== intent.request.sha256
  )
    throw new TypeError("Attachment bytes differ from the saved copy intent");
  return client.uploadFileFromSource(auth, intent.request, {
    byteLength: bytes.byteLength,
    read: async (offset, length) => bytes.subarray(offset, offset + length),
  });
}
