import {
  fileDeletionRequestSchema,
  type FileDeletionRequest,
  fileTrashRequestSchema,
  type FileTrashRequest,
} from "./contracts/files.js";
import { md5 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  filesOrganizationRequestSchema,
  restoreFileRevisionRequestSchema,
  beginFileUploadRequestSchema,
  fileRefSchema,
  type BeginFileUploadRequest,
} from "./contracts/files.js";
const partBytes = 8 * 1024 * 1024;
/** Reopen the same immutable bytes on every read/retry. Reads return at most
 * length bytes; EOF returns an empty array. A stable length alone does not prove
 * identity: preparation hashes every byte and upload must check frozen part
 * digests again before dispatch. The SDK consumes a returned window before the
 * next read and copies transfer bodies, so sources may reuse their read buffer.
 * The caller owns closing its source. */
export interface FileUploadSource {
  readonly byteLength: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}
function base64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}
/** MD5 binds the provider's part checksum; SHA-256 identifies published content. */
export function prepareFileUpload(
  input: {
    workplaceId: string;
    operationId: string;
    target: BeginFileUploadRequest["target"];
    contentType: string;
    expiresAt: string;
  },
  bytes: Uint8Array,
): BeginFileUploadRequest {
  if (bytes.byteLength > 64 * 1024 * 1024)
    throw new TypeError("Files are limited to 64 MiB");
  const multipartParts = [];
  for (
    let offset = 0;
    offset < Math.max(1, bytes.length);
    offset += partBytes
  ) {
    const part = bytes.subarray(offset, offset + partBytes);
    multipartParts.push({
      partNumber: multipartParts.length + 1,
      byteLength: part.length,
      contentMd5: base64(md5(part)),
    });
  }
  return beginFileUploadRequestSchema.parse({
    ...input,
    byteLength: bytes.length,
    sha256: bytesToHex(sha256(bytes)),
    contentMd5: base64(md5(bytes)),
    multipartParts,
  });
}

/** Creates the same immutable intent as prepareFileUpload without accumulating
 * content. No admission or transfer occurs here; persist the result before use. */
export async function prepareFileUploadFromSource(
  input: Parameters<typeof prepareFileUpload>[0],
  source: FileUploadSource,
): Promise<BeginFileUploadRequest> {
  const byteLength = source.byteLength;
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0 ||
    byteLength > 2_000_000_000
  )
    throw new TypeError("Files are limited to 2,000,000,000 bytes");
  const contentHash = sha256.create(),
    contentDigest = md5.create();
  const multipartParts: BeginFileUploadRequest["multipartParts"] = [];
  for (let offset = 0; offset < Math.max(1, byteLength); offset += partBytes) {
    const length = Math.min(partBytes, byteLength - offset);
    const bytes = await source.read(offset, length);
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength !== length ||
      source.byteLength !== byteLength
    )
      throw new TypeError("Upload source length changed during preparation");
    contentHash.update(bytes);
    contentDigest.update(bytes);
    multipartParts.push({
      partNumber: multipartParts.length + 1,
      byteLength: length,
      contentMd5: base64(md5(bytes)),
    });
  }
  const extra = await source.read(byteLength, 1);
  if (
    !(extra instanceof Uint8Array) ||
    extra.byteLength !== 0 ||
    source.byteLength !== byteLength
  )
    throw new TypeError("Upload source length changed during preparation");
  return beginFileUploadRequestSchema.parse({
    ...input,
    byteLength,
    sha256: bytesToHex(contentHash.digest()),
    contentMd5: base64(contentDigest.digest()),
    multipartParts,
  });
}
export function parseFileReference(reference: string) {
  const match = /^awp:file:([^:]+):([^:]+)(?::revision:([^:]+))?$/.exec(
    reference,
  );
  if (!match) throw new TypeError("Invalid file reference");
  const parsed = fileRefSchema.safeParse({
    workplaceId: match[1],
    fileId: match[2],
    ...(match[3] ? { revisionId: match[3] } : {}),
  });
  if (!parsed.success) throw new TypeError("Invalid file reference");
  return parsed.data;
}
export function fileBytesHash(bytes: Uint8Array) {
  return bytesToHex(sha256(bytes));
}

export function parseFileUploadRequest(value: unknown) {
  const parsed = beginFileUploadRequestSchema.safeParse(value);
  if (!parsed.success) throw new TypeError("Invalid file upload request");
  return parsed.data;
}

export function parseFilesOrganizationRequest(value: unknown) {
  const result = filesOrganizationRequestSchema.safeParse(value);
  if (!result.success)
    throw new TypeError("Invalid Files organization request");
  return result.data;
}

export function parseRestoreFileRevisionRequest(value: unknown) {
  const parsed = restoreFileRevisionRequestSchema.safeParse(value);
  if (!parsed.success) throw new TypeError("Invalid file restoration request");
  return parsed.data;
}

export function parseFileTrashRequest(value: unknown): FileTrashRequest {
  const parsed = fileTrashRequestSchema.safeParse(value);
  if (!parsed.success) throw new TypeError("Invalid file trash request");
  return parsed.data;
}

export function parseFileDeletionRequest(value: unknown): FileDeletionRequest {
  const parsed = fileDeletionRequestSchema.safeParse(value);
  if (!parsed.success) throw new TypeError("Invalid file deletion request");
  return parsed.data;
}
