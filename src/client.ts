import {
  billingInvoiceListSchema,
  type BillingInvoiceListRequest,
  billingStatusSchema,
  billingCommandSchema,
  type BillingCommandRequest,
  billingPurchaseSchema,
  billingPaymentActionSchema,
  type BillingPurchaseRequest,
  type BillingPaymentRequest,
} from "./contracts/billing.js";
import {
  walkMail,
  type MailExportRequest,
  type MailExportVisitStore,
} from "./mail-export.js";
import {
  copyAttachmentToFile,
  resumeAttachmentFileCopy,
  type MailAttachmentFileCopyRequest,
  type MailAttachmentFileCopyIntent,
} from "./mail-file-copy.js";
import {
  downloadToSink,
  type FileDownloadSink,
  type FileDownloadOptions,
} from "./files-download.js";
import {
  walkTree,
  walkRetained,
  type FilesTreeVisitStore,
} from "./files-tree.js";
import {
  prepareFileUpload,
  prepareFileUploadFromSource,
  parseFileUploadRequest,
  fileBytesHash,
  type FileUploadSource,
} from "./files.js";
import { md5 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  filesCheckpointSchema,
  filesChangesSchema,
  filesBaselineSchema,
  fileDeletionResultSchema,
  type FileDeletionRequest,
  type FileDeletionOperationRef,
  fileTrashListSchema,
  fileTrashResultSchema,
  type FileTrashRequest,
  type FileTrashOperationRef,
  fileHistorySchema,
  fileRestorationResultSchema,
  type RestoreFileRevisionRequest,
  type FileRestorationRef,
  filesTreeSchema,
  filesEntrySchema,
  filesOrganizationResultSchema,
  type FilesOrganizationRequest,
  fileUploadStatusSchema,
  fileUploadPartsSchema,
  filePartGrantSchema,
  fileMetadataSchema,
  fileListSchema,
  fileDownloadGrantSchema,
  type BeginFileUploadRequest,
  type FileUploadRef,
  type FileRef,
} from "./contracts/files.js";
import {
  profileSchema,
  type ProfileUpdate,
  participantRoleSchema,
  type ParticipantRoleUpdate,
} from "./contracts/accounts.js";
import {
  workplaceSettingsSchema,
  type WorkplaceSettingsUpdate,
} from "./contracts/workplace.js";
import {
  issuedAgentInvitationSchema,
  issuedHumanInvitationSchema,
  humanInvitationAdmissionSchema,
  type CreateHumanInvitationRequest,
  type HumanInvitationCodeRequest,
  type HumanInvitationAcceptRequest,
  invitationListSchema,
  invitationPreviewSchema,
  invitationAdmissionSchema,
  invitationCanceledSchema,
  type CreateAgentInvitationRequest,
  type InvitationPreviewRequest,
  type InvitationRedemptionRequest,
  type InvitationRecoveryRequest,
  type InvitationHandoffRequest,
} from "./contracts/invitations.js";
import {
  mailCheckpointSchema,
  mailChangesSchema,
  mailOperationListSchema,
  type MailCheckpointRequest,
  type MailChangesRequest,
  type MailOperationListRequest,
  mailContentAcknowledgementSchema,
  mailMessageListSchema,
  mailSenderBlockStateSchema,
  mailSenderBlockListSchema,
  type MailSenderBlockRequest,
  type MailSenderBlockListRequest,
  mailMessageSchema,
  mailAttachmentListSchema,
  mailPreparationListSchema,
  mailAttachmentDownloadGrantSchema,
  type MailAttachmentDownloadRequest,
  mailThreadSchema,
  mailOmissionListSchema,
  mailboxSchema,
  mailboxListSchema,
  mailOperationSchema,
  type SendMailRequest,
  type ComposeMailRequest,
} from "./contracts/mail.js";
import {
  agentKeyListSchema,
  participantListSchema,
  participantRemovedSchema,
  agentCredentialSchema,
  agentKeyRevokedSchema,
  agentKeyRenamedSchema,
  keyRotationResponseSchema,
  keyRotationCompletedSchema,
} from "./contracts/credentials.js";
import {
  ownerEmailOperationSchema,
  ownerEmailStatusSchema,
  type OwnerEmailBegin,
  type OwnerEmailCode,
  type OwnerEmailResend,
  type OwnerEmailOperationReference,
  signupResponseSchema,
  deletionRequestResponseSchema,
  deletionStatusSchema,
  acknowledgementResponseSchema,
  accessStatusSchema,
  accountAccessStatusSchema,
  nominationSendResponseSchema,
  nominationCancellationResponseSchema,
  currentNominationSchema,
  type NominationAuthorizationRequest,
  nominationCorrectionResponseSchema,
  type NominationCancellationRequest,
  type NominationCorrectionRequest,
  type SignupRequest,
  type OwnershipConfirmationRequest,
  ownershipConfirmationResponseSchema,
  humanAccessStatusSchema,
} from "./contracts/access.js";
import { apiErrorResponseSchema } from "./contracts/errors.js";
import { healthResponseSchema } from "./contracts/health.js";
import type { HealthResponse } from "./contracts/health.js";

import { AgentWorkplaceError } from "./errors.js";

export interface AgentWorkplaceOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  /** Fetch for API-issued Files byte grants; defaults to the configured fetch.
   * Use a separate transport when API admission adds private headers. */
  transferFetch?: typeof globalThis.fetch;
}

export type CredentialAuthorization =
  { apiKey: string } | { humanSession: true };

type ResponseParser<T> = (value: unknown) => T;

const requestIdHeader = "X-Request-ID";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function responseRequestId(response: Response): string | undefined {
  const value = response.headers.get(requestIdHeader);
  return value !== null && uuidPattern.test(value) ? value : undefined;
}

function secureTransport(url: URL) {
  return (
    !url.username &&
    !url.password &&
    (url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  );
}
function transferUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Invalid Files transfer URL");
  }
  if (!secureTransport(url))
    throw new TypeError(
      "Files transfers require HTTPS or loopback HTTP without URL credentials",
    );
  return url.href;
}

function normalizeBaseUrl(value: string): URL {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError("Agent Workplace base URL must not be empty");
  }

  let url: URL;

  try {
    url = new globalThis.URL(value);
  } catch (cause) {
    throw new TypeError("Agent Workplace base URL must be an absolute URL", {
      cause,
    });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Agent Workplace base URL must use HTTP or HTTPS");
  }

  if (url.username !== "" || url.password !== "") {
    throw new TypeError(
      "Agent Workplace base URL must not include credentials",
    );
  }

  if (url.search !== "") {
    throw new TypeError("Agent Workplace base URL must not include a query");
  }

  if (url.hash !== "") {
    throw new TypeError("Agent Workplace base URL must not include a fragment");
  }

  if (!url.pathname.endsWith("/")) {
    url.pathname += "/";
  }

  return url;
}

export class AgentWorkplace {
  readonly #baseUrl: URL;
  readonly #fetch: typeof globalThis.fetch;
  readonly #transferFetch: typeof globalThis.fetch;

  constructor(options: AgentWorkplaceOptions) {
    if (typeof options !== "object" || options === null) {
      throw new TypeError("Agent Workplace options are required");
    }

    this.#baseUrl = normalizeBaseUrl(options.baseUrl);

    const fetchImplementation = options.fetch ?? globalThis.fetch;

    if (typeof fetchImplementation !== "function") {
      throw new TypeError("A Fetch API implementation is required");
    }

    this.#fetch = fetchImplementation;
    const transferFetch = options.transferFetch ?? fetchImplementation;
    if (typeof transferFetch !== "function")
      throw new TypeError("A Files Fetch API implementation is required");
    this.#transferFetch = transferFetch;
  }

  async health(): Promise<HealthResponse> {
    return this.#request(
      "health",
      (value) => healthResponseSchema.parse(value),
      { allowInsecureHttp: true },
    );
  }

  createAgentInvitation(
    authorization: CredentialAuthorization,
    input: CreateAgentInvitationRequest,
  ) {
    return this.#request(
      "v1/invitations",
      (value) => issuedAgentInvitationSchema.parse(value),
      {
        ...this.#credentialAuthorization(authorization),
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }
  createHumanInvitation(
    authorization: CredentialAuthorization,
    input: CreateHumanInvitationRequest,
  ) {
    return this.#request(
      "v1/invitations/human",
      (value) => issuedHumanInvitationSchema.parse(value),
      {
        ...this.#credentialAuthorization(authorization),
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }
  requestHumanInvitationCode(input: HumanInvitationCodeRequest) {
    return this.#request(
      "v1/invitations/human/code",
      (value) => acknowledgementResponseSchema.parse(value),
      {
        credentials: "include",
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }
  acceptHumanInvitation(input: HumanInvitationAcceptRequest) {
    return this.#request(
      "v1/invitations/human/accept",
      (value) => humanInvitationAdmissionSchema.parse(value),
      {
        credentials: "include",
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }
  listInvitations(
    authorization: CredentialAuthorization,
    input: { after?: string; state?: "pending" } = {},
  ) {
    const query = new URLSearchParams();
    if (input.after !== undefined) query.set("after", input.after);
    if (input.state !== undefined) query.set("state", input.state);
    return this.#request(
      `v1/invitations${query.size ? `?${query}` : ""}`,
      (value) => invitationListSchema.parse(value),
      this.#credentialAuthorization(authorization),
    );
  }
  cancelInvitation(
    authorization: CredentialAuthorization,
    invitationId: string,
  ) {
    return this.#request(
      `v1/invitations/${encodeURIComponent(invitationId)}`,
      (value) => invitationCanceledSchema.parse(value),
      {
        ...this.#credentialAuthorization(authorization),
        method: "DELETE",
      },
    );
  }
  previewInvitation(input: InvitationPreviewRequest) {
    return this.#request(
      "v1/invitations/preview",
      (value) => invitationPreviewSchema.parse(value),
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }
  redeemAgentInvitation(input: InvitationRedemptionRequest) {
    return this.#request(
      "v1/invitations/redeem",
      (value) => invitationAdmissionSchema.parse(value),
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }
  recoverInvitationCredential(input: InvitationRecoveryRequest) {
    return this.#request(
      "v1/invitations/recover",
      (value) => invitationAdmissionSchema.parse(value),
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }
  acknowledgeInvitation(
    authorization: CredentialAuthorization,
    input: InvitationHandoffRequest,
  ) {
    return this.#request(
      "v1/invitations/acknowledge",
      (value) => acknowledgementResponseSchema.parse(value),
      {
        ...this.#credentialAuthorization(authorization),
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }

  signup(input: SignupRequest) {
    return this.#request(
      "v1/workplaces",
      (value) => signupResponseSchema.parse(value),
      { method: "POST", body: JSON.stringify(input) },
    );
  }

  acknowledgeSignup(apiKey: string) {
    return this.#request(
      "v1/access/acknowledge",
      (value) => acknowledgementResponseSchema.parse(value),
      { method: "POST", apiKey },
    );
  }

  accessStatus(apiKey: string) {
    return this.#request(
      "v1/access",
      (value) => accessStatusSchema.parse(value),
      { apiKey },
    );
  }

  listTrashedFiles(
    authorization: CredentialAuthorization,
    input: { workplaceId: string; after?: string; limit?: number },
  ) {
    const query = new URLSearchParams({ workplaceId: input.workplaceId });
    if (input.after) query.set("after", input.after);
    if (input.limit !== undefined) query.set("limit", String(input.limit));
    return this.#request(
      `v1/files/trash?${query}`,
      (v) => fileTrashListSchema.parse(v),
      this.#credentialAuthorization(authorization),
    );
  }
  changeFileTrash(
    authorization: CredentialAuthorization,
    input: FileTrashRequest,
  ) {
    return this.#request(
      "v1/files/trash-operations",
      (v) => fileTrashResultSchema.parse(v),
      {
        ...this.#credentialAuthorization(authorization),
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }
  getFileTrashOperation(
    authorization: CredentialAuthorization,
    input: FileTrashOperationRef,
  ) {
    return this.#request(
      `v1/files/trash-operations/${encodeURIComponent(input.operationId)}?${new URLSearchParams({ workplaceId: input.workplaceId })}`,
      (v) => fileTrashResultSchema.parse(v),
      this.#credentialAuthorization(authorization),
    );
  }
  beginFileDeletion(
    authorization: CredentialAuthorization,
    input: FileDeletionRequest,
  ) {
    return this.#request(
      "v1/files/deletion-operations",
      (v) => fileDeletionResultSchema.parse(v),
      {
        ...this.#credentialAuthorization(authorization),
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }
  getFileDeletionOperation(
    authorization: CredentialAuthorization,
    input: FileDeletionOperationRef,
  ) {
    return this.#request(
      `v1/files/deletion-operations/${encodeURIComponent(input.operationId)}?${new URLSearchParams({ workplaceId: input.workplaceId })}`,
      (v) => fileDeletionResultSchema.parse(v),
      this.#credentialAuthorization(authorization),
    );
  }
  listFileRevisions(
    authorization: CredentialAuthorization,
    input: {
      workplaceId: string;
      fileId: string;
      after?: string;
      limit?: number;
    },
  ) {
    const query = new URLSearchParams({ workplaceId: input.workplaceId });
    if (input.after) query.set("after", input.after);
    if (input.limit !== undefined) query.set("limit", String(input.limit));
    return this.#request(
      `v1/files/${encodeURIComponent(input.fileId)}/revisions?${query}`,
      (v) => fileHistorySchema.parse(v),
      this.#credentialAuthorization(authorization),
    );
  }
  restoreFileRevision(
    authorization: CredentialAuthorization,
    input: RestoreFileRevisionRequest,
  ) {
    return this.#request(
      "v1/files/restorations",
      (v) => fileRestorationResultSchema.parse(v),
      {
        ...this.#credentialAuthorization(authorization),
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }
  getFileRestoration(
    authorization: CredentialAuthorization,
    input: FileRestorationRef,
  ) {
    return this.#request(
      `v1/files/restorations/${encodeURIComponent(input.operationId)}?${new URLSearchParams({ workplaceId: input.workplaceId })}`,
      (v) => fileRestorationResultSchema.parse(v),
      this.#credentialAuthorization(authorization),
    );
  }
  getFilesCheckpoint(
    authorization: CredentialAuthorization,
    input: { workplaceId: string },
  ) {
    const query = new URLSearchParams({ workplaceId: input.workplaceId });
    return this.#request(
      `v1/files/checkpoint?${query}`,
      (v) => filesCheckpointSchema.parse(v),
      this.#credentialAuthorization(authorization),
    );
  }
  listFilesChanges(
    authorization: CredentialAuthorization,
    input: { workplaceId: string; cursor: string; limit?: number },
  ) {
    const query = new URLSearchParams({ workplaceId: input.workplaceId });
    if (input.cursor !== undefined) query.set("cursor", String(input.cursor));
    if (input.limit !== undefined) query.set("limit", String(input.limit));
    return this.#request(
      `v1/files/changes?${query}`,
      (v) => filesChangesSchema.parse(v),
      this.#credentialAuthorization(authorization),
    );
  }
  listFilesBaseline(
    authorization: CredentialAuthorization,
    input: { workplaceId: string; after?: string; limit?: number },
  ) {
    const query = new URLSearchParams({ workplaceId: input.workplaceId });
    if (input.after !== undefined) query.set("after", String(input.after));
    if (input.limit !== undefined) query.set("limit", String(input.limit));
    return this.#request(
      `v1/files/baseline?${query}`,
      (v) => filesBaselineSchema.parse(v),
      this.#credentialAuthorization(authorization),
    );
  }
  /** Retained workplace inventory includes previous revisions and trash. */
  walkRetainedFiles(
    authorization: CredentialAuthorization,
    input: { workplaceId: string },
  ) {
    const { workplaceId } = input;
    return walkRetained(workplaceId, {
      checkpoint: () => this.getFilesCheckpoint(authorization, { workplaceId }),
      changes: (cursor) =>
        this.listFilesChanges(authorization, { workplaceId, cursor, limit: 1 }),
      baseline: (after) =>
        this.listFilesBaseline(authorization, {
          workplaceId,
          after,
          limit: 100,
        }),
      history: (fileId, after) =>
        this.listFileRevisions(authorization, {
          workplaceId,
          fileId,
          after,
          limit: 100,
        }),
    });
  }
  /** Best-effort paged inventory with pinned file metadata, not a snapshot.
   * Names remain untrusted; filesystem consumers own safe path handling. */
  walkFilesTree(
    authorization: CredentialAuthorization,
    input: { workplaceId: string; parentId?: string | null },
    options: { visits?: FilesTreeVisitStore } = {},
  ) {
    const { workplaceId } = input;
    return walkTree(
      input,
      {
        checkpoint: () =>
          this.getFilesCheckpoint(authorization, { workplaceId }),
        changes: (cursor) =>
          this.listFilesChanges(authorization, {
            workplaceId,
            cursor,
            limit: 1,
          }),
        entry: (entryId) =>
          this.getFilesEntry(authorization, { workplaceId, entryId }),
        file: (fileId) => this.getFile(authorization, { workplaceId, fileId }),
        page: (parentId, after) =>
          this.listFilesTree(authorization, {
            workplaceId,
            parentId,
            after,
            limit: 100,
          }),
      },
      options.visits,
    );
  }
  listFilesTree(
    authorization: CredentialAuthorization,
    input: {
      workplaceId: string;
      parentId?: string | null;
      after?: string;
      limit?: number;
    },
  ) {
    const query = new URLSearchParams({ workplaceId: input.workplaceId });
    if (input.parentId) query.set("parentId", input.parentId);
    if (input.after) query.set("after", input.after);
    if (input.limit !== undefined) query.set("limit", String(input.limit));
    return this.#request(
      `v1/files/entries?${query}`,
      (v) => filesTreeSchema.parse(v),
      this.#credentialAuthorization(authorization),
    );
  }
  getFilesEntry(
    authorization: CredentialAuthorization,
    input: { workplaceId: string; entryId: string },
  ) {
    return this.#request(
      `v1/files/entries/${encodeURIComponent(input.entryId)}?${new URLSearchParams({ workplaceId: input.workplaceId })}`,
      (v) => filesEntrySchema.parse(v),
      this.#credentialAuthorization(authorization),
    );
  }
  organizeFiles(
    authorization: CredentialAuthorization,
    input: FilesOrganizationRequest,
  ) {
    return this.#request(
      "v1/files/organization",
      (v) => filesOrganizationResultSchema.parse(v),
      {
        ...this.#credentialAuthorization(authorization),
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }
  /** Explicit transfer keeps grants out of ordinary results. Persist the request
   * before calling when a process must recover an uncertain admission response. */
  async uploadFile(
    authorization: CredentialAuthorization,
    input: BeginFileUploadRequest,
    data: Uint8Array,
  ) {
    if (data.byteLength > 64 * 1024 * 1024)
      throw new TypeError("Files are limited to 64 MiB");
    const bytes = new Uint8Array(data);
    return this.uploadFileFromSource(authorization, input, {
      byteLength: bytes.length,
      read: async (offset, length) => bytes.subarray(offset, offset + length),
    });
  }
  /** Reads a stable source in bounded parts, checking every reread against the
   * frozen manifest before dispatch. The caller owns source lifetime/closing. */
  async uploadFileFromSource(
    authorization: CredentialAuthorization,
    request: BeginFileUploadRequest,
    source: FileUploadSource,
  ) {
    const input = parseFileUploadRequest(request);
    const verified = await prepareFileUploadFromSource(input, source);
    if (
      verified.sha256 !== input.sha256 ||
      verified.contentMd5 !== input.contentMd5 ||
      verified.byteLength !== input.byteLength ||
      JSON.stringify(verified.multipartParts) !==
        JSON.stringify(input.multipartParts)
    )
      throw new TypeError("Upload bytes differ from the immutable request");
    const begun = await this.beginFileUpload(authorization, input);
    if (begun.state !== "pending") return begun;
    const ref = { workplaceId: input.workplaceId, uploadId: begun.uploadId };
    if (begun.transferState === "creating" || begun.transferState === "planned")
      return begun;
    if (
      begun.transferState === "completing" ||
      begun.transferState === "closed"
    )
      return this.finalizeFileUpload(authorization, ref);
    const observation = await this.getFileUploadedParts(authorization, ref);
    if (observation.upload.state !== "pending") return observation.upload;
    if (
      observation.upload.transferState === "closed" ||
      observation.upload.transferState === "completing"
    )
      return this.finalizeFileUpload(authorization, ref);
    if (observation.presentPartNumbers === null) return observation.upload;
    const present = new Set(observation.presentPartNumbers);
    if (
      observation.presentPartNumbers.some(
        (number) =>
          !input.multipartParts.some((part) => part.partNumber === number),
      )
    )
      throw new AgentWorkplaceError("Invalid upload part observation", {
        status: 0,
        code: "invalid_response",
      });
    let offset = 0;
    const dispatchedHash = sha256.create();
    for (const part of input.multipartParts) {
      const read = await source.read(offset, part.byteLength);
      if (
        !(read instanceof Uint8Array) ||
        read.byteLength !== part.byteLength ||
        source.byteLength !== input.byteLength
      )
        throw new TypeError("Upload source length changed before dispatch");
      // Own this bounded body; subsequent caller mutation cannot alter a PUT.
      const bytes = new Uint8Array(read);
      if (btoa(String.fromCharCode(...md5(bytes))) !== part.contentMd5)
        throw new TypeError("Upload bytes differ from the immutable request");
      dispatchedHash.update(bytes);
      if (present.has(part.partNumber)) {
        offset += part.byteLength;
        continue;
      }
      const grant = await this.getFilePartGrant(
        authorization,
        ref,
        part.partNumber,
      );
      let response: Response;
      try {
        response = await this.#transferFetch(transferUrl(grant.url), {
          method: "PUT",
          headers: grant.headers,
          body: bytes,
          redirect: "error",
          credentials: "omit",
          signal: AbortSignal.timeout(60000),
        });
      } catch {
        throw new AgentWorkplaceError(
          "File transfer interrupted; inspect the saved upload before retrying",
          { status: 0, code: "transfer_interrupted" },
        );
      }
      await response.body?.cancel().catch(() => {});
      if (!response.ok)
        throw new AgentWorkplaceError("File part transfer was rejected", {
          status: response.status,
          code: "transfer_rejected",
        });
      offset += part.byteLength;
    }
    const extra = await source.read(input.byteLength, 1);
    if (
      !(extra instanceof Uint8Array) ||
      extra.length ||
      source.byteLength !== input.byteLength ||
      bytesToHex(dispatchedHash.digest()) !== input.sha256
    )
      throw new TypeError("Upload bytes differ from the immutable request");
    return this.finalizeFileUpload(authorization, ref);
  }
  async uploadText(
    authorization: CredentialAuthorization,
    input: Parameters<typeof prepareFileUpload>[0],
    text: string,
  ) {
    const bytes = new TextEncoder().encode(text);
    if (bytes.length > 1024 * 1024)
      throw new TypeError("Text uploads are limited to 1 MiB");
    return this.uploadFile(
      authorization,
      prepareFileUpload(input, bytes),
      bytes,
    );
  }
  /** Writes bounded ranges with backpressure and final SHA-256 verification.
   * Persisted prefixes require their pinned revision/length/hash and rehashing. */
  downloadFileTo(
    authorization: CredentialAuthorization,
    ref: FileRef,
    sink: FileDownloadSink,
    options: FileDownloadOptions = {},
  ) {
    return downloadToSink(ref, sink, options, {
      metadata: () => this.getFile(authorization, ref),
      grant: (pinned) => this.getFileDownloadGrant(authorization, pinned),
      transfer: (url, init) => this.#transferFetch(transferUrl(url), init),
    });
  }
  async downloadFile(authorization: CredentialAuthorization, ref: FileRef) {
    const grant = await this.getFileDownloadGrant(authorization, ref);
    if (grant.file.byteLength > 64 * 1024 * 1024)
      throw new TypeError(
        "Whole-buffer downloads are limited to 64 MiB; use downloadFileTo",
      );
    let response: Response;
    try {
      response = await this.#transferFetch(transferUrl(grant.url), {
        redirect: "error",
        credentials: "omit",
        signal: AbortSignal.timeout(60000),
      });
    } catch {
      throw new AgentWorkplaceError("File download interrupted", {
        status: 0,
        code: "transfer_interrupted",
      });
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw new AgentWorkplaceError("File download unavailable", {
        status: response.status,
        code: "transfer_rejected",
      });
    }
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.length;
        if (length > grant.file.byteLength || length > 64 * 1024 * 1024)
          throw new Error("length");
        chunks.push(chunk.value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      if (
        length !== grant.file.byteLength ||
        fileBytesHash(bytes) !== grant.file.sha256
      )
        throw new Error("integrity");
      return { file: grant.file, bytes };
    } catch {
      throw new AgentWorkplaceError(
        "File download integrity or transport check failed",
        { status: 0, code: "transfer_interrupted" },
      );
    } finally {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  beginFileUpload(
    authorization: CredentialAuthorization,
    input: BeginFileUploadRequest,
  ) {
    return this.#request(
      "v1/files/uploads",
      (value) => fileUploadStatusSchema.parse(value),
      {
        ...this.#credentialAuthorization(authorization),
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }
  getFileUpload(authorization: CredentialAuthorization, ref: FileUploadRef) {
    return this.#request(
      `v1/files/uploads/${encodeURIComponent(ref.uploadId)}?${new URLSearchParams({ workplaceId: ref.workplaceId })}`,
      (value) => fileUploadStatusSchema.parse(value),
      this.#credentialAuthorization(authorization),
    );
  }
  getFileUploadedParts(
    authorization: CredentialAuthorization,
    ref: FileUploadRef,
  ) {
    return this.#request(
      `v1/files/uploads/${encodeURIComponent(ref.uploadId)}/parts?${new URLSearchParams({ workplaceId: ref.workplaceId })}`,
      (value) => {
        const result = fileUploadPartsSchema.parse(value);
        if (result.upload.uploadId !== ref.uploadId)
          throw new Error("Mismatched upload");
        return result;
      },
      this.#credentialAuthorization(authorization),
    );
  }
  cancelFileUpload(authorization: CredentialAuthorization, ref: FileUploadRef) {
    return this.#request(
      `v1/files/uploads/${encodeURIComponent(ref.uploadId)}/cancel?${new URLSearchParams({ workplaceId: ref.workplaceId })}`,
      (value) => fileUploadStatusSchema.parse(value),
      { ...this.#credentialAuthorization(authorization), method: "POST" },
    );
  }
  finalizeFileUpload(
    authorization: CredentialAuthorization,
    ref: FileUploadRef,
  ) {
    return this.#request(
      `v1/files/uploads/${encodeURIComponent(ref.uploadId)}/finalize?${new URLSearchParams({ workplaceId: ref.workplaceId })}`,
      (value) => fileUploadStatusSchema.parse(value),
      { ...this.#credentialAuthorization(authorization), method: "POST" },
    );
  }
  getFilePartGrant(
    authorization: CredentialAuthorization,
    ref: FileUploadRef,
    partNumber: number,
  ) {
    return this.#request(
      `v1/files/uploads/${encodeURIComponent(ref.uploadId)}/parts/${encodeURIComponent(partNumber)}?${new URLSearchParams({ workplaceId: ref.workplaceId })}`,
      (value) => filePartGrantSchema.parse(value),
      { ...this.#credentialAuthorization(authorization), method: "POST" },
    );
  }
  listFiles(
    authorization: CredentialAuthorization,
    input: { workplaceId: string; after?: string; limit?: number },
  ) {
    const query = new URLSearchParams({ workplaceId: input.workplaceId });
    if (input.after !== undefined) query.set("after", input.after);
    if (input.limit !== undefined) query.set("limit", String(input.limit));
    return this.#request(
      `v1/files?${query}`,
      (value) => fileListSchema.parse(value),
      this.#credentialAuthorization(authorization),
    );
  }
  getFile(authorization: CredentialAuthorization, ref: FileRef) {
    const query = new URLSearchParams({ workplaceId: ref.workplaceId });
    if (ref.revisionId) query.set("revisionId", ref.revisionId);
    return this.#request(
      `v1/files/${encodeURIComponent(ref.fileId)}?${query}`,
      (value) => fileMetadataSchema.parse(value),
      this.#credentialAuthorization(authorization),
    );
  }
  getFileDownloadGrant(authorization: CredentialAuthorization, ref: FileRef) {
    const query = new URLSearchParams({ workplaceId: ref.workplaceId });
    if (ref.revisionId) query.set("revisionId", ref.revisionId);
    return this.#request(
      `v1/files/${encodeURIComponent(ref.fileId)}/download?${query}`,
      (value) => fileDownloadGrantSchema.parse(value),
      { ...this.#credentialAuthorization(authorization), method: "POST" },
    );
  }

  listMailboxes(
    authorization: CredentialAuthorization,
    input: { after?: string; limit?: number } = {},
  ) {
    const query = new URLSearchParams();
    if (input.after !== undefined) query.set("after", input.after);
    if (input.limit !== undefined) query.set("limit", String(input.limit));
    return this.#request(
      `v1/mailboxes${query.size ? `?${query}` : ""}`,
      (value) => mailboxListSchema.parse(value),
      this.#credentialAuthorization(authorization),
    );
  }
  getMailbox(authorization: CredentialAuthorization, mailboxId: string) {
    return this.#request(
      `v1/mailboxes/${encodeURIComponent(mailboxId)}`,
      (value) => mailboxSchema.parse(value),
      this.#credentialAuthorization(authorization),
    );
  }
  /** Reuse the same operation ID and immutable payload after an uncertain response. */
  sendMail(authorization: CredentialAuthorization, input: SendMailRequest) {
    return this.#request(
      "v1/mail/send",
      (value) => mailOperationSchema.parse(value),
      {
        ...this.#credentialAuthorization(authorization),
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }
  /** Server freezes source-derived destinations and content on first admission. */
  composeMail(
    authorization: CredentialAuthorization,
    input: ComposeMailRequest,
  ) {
    return this.#request(
      "v1/mail/compose",
      (value) => mailOperationSchema.parse(value),
      {
        ...this.#credentialAuthorization(authorization),
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }
  getMailOperation(
    authorization: CredentialAuthorization,
    operationId: string,
  ) {
    return this.#request(
      `v1/mail/operations/${encodeURIComponent(operationId)}`,
      (value) => mailOperationSchema.parse(value),
      this.#credentialAuthorization(authorization),
    );
  }
  blockMailSender(
    authorization: CredentialAuthorization,
    input: MailSenderBlockRequest,
  ) {
    return this.#request(
      "v1/mail/sender-blocks/block",
      (value) => mailSenderBlockStateSchema.parse(value),
      {
        ...this.#credentialAuthorization(authorization),
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }
  unblockMailSender(
    authorization: CredentialAuthorization,
    input: MailSenderBlockRequest,
  ) {
    return this.#request(
      "v1/mail/sender-blocks/unblock",
      (value) => mailSenderBlockStateSchema.parse(value),
      {
        ...this.#credentialAuthorization(authorization),
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }
  listMailSenderBlocks(
    authorization: CredentialAuthorization,
    input: MailSenderBlockListRequest = {},
  ) {
    const query = new URLSearchParams();
    if (input.mailboxId !== undefined) query.set("mailboxId", input.mailboxId);
    if (input.after !== undefined) query.set("after", input.after);
    if (input.limit !== undefined) query.set("limit", String(input.limit));
    return this.#request(
      `v1/mail/sender-blocks${query.size ? `?${query}` : ""}`,
      (value) => mailSenderBlockListSchema.parse(value),
      this.#credentialAuthorization(authorization),
    );
  }
  /** Streams a current retained-Mail inventory; the caller owns private output
   * and verified attachment downloads. Supply a fresh visit store per walk. */
  walkRetainedMail(
    authorization: CredentialAuthorization,
    input: MailExportRequest,
    visits: MailExportVisitStore,
  ) {
    const mailboxId = input.mailboxId.toLowerCase();
    return walkMail(
      input,
      {
        checkpoint: () => this.getMailCheckpoint(authorization, { mailboxId }),
        preparations: (after) =>
          this.listMailPreparations(authorization, {
            mailboxId,
            after,
            limit: 100,
          }),
        omissions: (after) =>
          this.listMailOmissions(authorization, {
            mailboxId,
            after,
            limit: 100,
          }),
        changes: (cursor) =>
          this.listMailChanges(authorization, { mailboxId, cursor, limit: 1 }),
        message: (id) => this.getMailMessage(authorization, id, { mailboxId }),
        page: (view, after) =>
          this.listMailMessages(authorization, {
            mailboxId,
            view,
            after,
            limit: 100,
          }),
        thread: (id, after) =>
          this.getMailThread(authorization, id, {
            mailboxId,
            after,
            limit: 100,
          }),
        attachments: (id, after) =>
          this.listMailAttachments(authorization, id, {
            mailboxId,
            after,
            limit: 100,
          }),
      },
      visits,
    );
  }
  getMailCheckpoint(
    authorization: CredentialAuthorization,
    input: MailCheckpointRequest,
  ) {
    const query = new URLSearchParams({ mailboxId: input.mailboxId });
    return this.#request(
      `v1/mail/checkpoint?${query}`,
      (value) => mailCheckpointSchema.parse(value),
      this.#credentialAuthorization(authorization),
    );
  }
  listMailChanges(
    authorization: CredentialAuthorization,
    input: Omit<MailChangesRequest, "limit"> & { limit?: number },
  ) {
    const query = new URLSearchParams({
      mailboxId: input.mailboxId,
      cursor: input.cursor,
    });
    if (input.limit !== undefined) query.set("limit", String(input.limit));
    return this.#request(
      `v1/mail/changes?${query}`,
      (value) => mailChangesSchema.parse(value),
      this.#credentialAuthorization(authorization),
    );
  }
  listMailOperations(
    authorization: CredentialAuthorization,
    input: Omit<MailOperationListRequest, "limit"> & { limit?: number },
  ) {
    const query = new URLSearchParams({ mailboxId: input.mailboxId });
    if (input.after !== undefined) query.set("after", input.after);
    if (input.limit !== undefined) query.set("limit", String(input.limit));
    return this.#request(
      `v1/mail/operations?${query}`,
      (value) => mailOperationListSchema.parse(value),
      this.#credentialAuthorization(authorization),
    );
  }
  listMailMessages(
    authorization: CredentialAuthorization,
    input: {
      mailboxId?: string;
      after?: string;
      limit?: number;
      view?: "active" | "archive" | "all" | "trash";
      direction?: "incoming" | "outgoing";
      subject?: string;
    } = {},
  ) {
    const query = new URLSearchParams();
    if (input.mailboxId !== undefined) query.set("mailboxId", input.mailboxId);
    if (input.after !== undefined) query.set("after", input.after);
    if (input.limit !== undefined) query.set("limit", String(input.limit));
    if (input.view !== undefined) query.set("view", input.view);
    if (input.direction !== undefined) query.set("direction", input.direction);
    if (input.subject !== undefined) query.set("subject", input.subject);
    return this.#request(
      `v1/mail/messages${query.size ? `?${query}` : ""}`,
      (value) => mailMessageListSchema.parse(value),
      this.#credentialAuthorization(authorization),
    );
  }
  getMailMessage(
    authorization: CredentialAuthorization,
    messageId: string,
    input: { mailboxId?: string } = {},
  ) {
    const query = new URLSearchParams();
    if (input.mailboxId !== undefined) query.set("mailboxId", input.mailboxId);
    return this.#request(
      `v1/mail/messages/${encodeURIComponent(messageId)}${query.size ? `?${query}` : ""}`,
      (value) => mailMessageSchema.parse(value),
      this.#credentialAuthorization(authorization),
    );
  }
  getMailAttachmentDownloadGrant(
    authorization: CredentialAuthorization,
    ref: MailAttachmentDownloadRequest,
  ) {
    const query = new URLSearchParams();
    if (ref.mailboxId !== undefined) query.set("mailboxId", ref.mailboxId);
    return this.#request(
      `v1/mail/messages/${encodeURIComponent(ref.messageId)}/attachments/${encodeURIComponent(ref.attachmentId)}/download${query.size ? `?${query}` : ""}`,
      (value) => {
        const grant = mailAttachmentDownloadGrantSchema.parse(value);
        if (
          grant.messageId !== ref.messageId ||
          grant.attachment.attachmentId !== ref.attachmentId
        )
          throw new Error("Attachment identity mismatch");
        return grant;
      },
      { ...this.#credentialAuthorization(authorization), method: "POST" },
    );
  }
  /** Client-mediated independent Files copy; save the private intent before admission. */
  copyMailAttachmentToFile(
    authorization: CredentialAuthorization,
    input: MailAttachmentFileCopyRequest,
    saveIntent: (intent: MailAttachmentFileCopyIntent) => Promise<void>,
  ) {
    return copyAttachmentToFile(this, authorization, input, saveIntent);
  }
  /** Reuses the original destination operation before requesting source bytes. */
  resumeMailAttachmentFileCopy(
    authorization: CredentialAuthorization,
    intent: MailAttachmentFileCopyIntent,
  ) {
    return resumeAttachmentFileCopy(this, authorization, intent);
  }
  async downloadMailAttachment(
    authorization: CredentialAuthorization,
    ref: MailAttachmentDownloadRequest,
  ) {
    const grant = await this.getMailAttachmentDownloadGrant(authorization, ref);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await this.#transferFetch(transferUrl(grant.url), {
        redirect: "error",
        credentials: "omit",
        signal: AbortSignal.timeout(60000),
      });
      if (response.status !== 200 || !response.body) {
        await response.body?.cancel().catch(() => {});
        throw new Error("Unavailable attachment");
      }
      reader = response.body.getReader();
      const bytes = new Uint8Array(grant.attachment.bytes);
      let offset = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (offset + chunk.value.length > bytes.length)
          throw new Error("Attachment length mismatch");
        bytes.set(chunk.value, offset);
        offset += chunk.value.length;
      }
      if (
        offset !== bytes.length ||
        fileBytesHash(bytes) !== grant.attachment.sha256
      )
        throw new Error("Attachment integrity mismatch");
      return {
        messageId: grant.messageId,
        attachment: grant.attachment,
        bytes,
      };
    } catch {
      throw new AgentWorkplaceError(
        "Attachment download integrity or transport check failed",
        { status: 0, code: "transfer_interrupted" },
      );
    } finally {
      if (reader) {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
    }
  }
  listMailPreparations(
    authorization: CredentialAuthorization,
    input: { mailboxId?: string; after?: string; limit?: number } = {},
  ) {
    const query = new URLSearchParams();
    if (input.mailboxId !== undefined) query.set("mailboxId", input.mailboxId);
    if (input.after !== undefined) query.set("after", input.after);
    if (input.limit !== undefined) query.set("limit", String(input.limit));
    return this.#request(
      `v1/mail/preparations${query.size ? `?${query}` : ""}`,
      (value) => mailPreparationListSchema.parse(value),
      this.#credentialAuthorization(authorization),
    );
  }
  listMailAttachments(
    authorization: CredentialAuthorization,
    messageId: string,
    input: { mailboxId?: string; after?: number; limit?: number } = {},
  ) {
    const query = new URLSearchParams();
    if (input.mailboxId !== undefined) query.set("mailboxId", input.mailboxId);
    if (input.after !== undefined) query.set("after", String(input.after));
    if (input.limit !== undefined) query.set("limit", String(input.limit));
    return this.#request(
      `v1/mail/messages/${encodeURIComponent(messageId)}/attachments${query.size ? `?${query}` : ""}`,
      (value) => mailAttachmentListSchema.parse(value),
      this.#credentialAuthorization(authorization),
    );
  }
  getMailThread(
    authorization: CredentialAuthorization,
    messageId: string,
    input: { mailboxId?: string; after?: string; limit?: number } = {},
  ) {
    const query = new URLSearchParams();
    if (input.mailboxId !== undefined) query.set("mailboxId", input.mailboxId);
    if (input.after !== undefined) query.set("after", input.after);
    if (input.limit !== undefined) query.set("limit", String(input.limit));
    return this.#request(
      `v1/mail/messages/${encodeURIComponent(messageId)}/thread${query.size ? `?${query}` : ""}`,
      (value) => mailThreadSchema.parse(value),
      this.#credentialAuthorization(authorization),
    );
  }
  listMailOmissions(
    authorization: CredentialAuthorization,
    input: { mailboxId?: string; after?: string; limit?: number } = {},
  ) {
    const query = new URLSearchParams();
    if (input.mailboxId !== undefined) query.set("mailboxId", input.mailboxId);
    if (input.after !== undefined) query.set("after", input.after);
    if (input.limit !== undefined) query.set("limit", String(input.limit));
    return this.#request(
      `v1/mail/omissions${query.size ? `?${query}` : ""}`,
      (value) => mailOmissionListSchema.parse(value),
      this.#credentialAuthorization(authorization),
    );
  }
  archiveMailMessage(
    authorization: CredentialAuthorization,
    messageId: string,
    input: { mailboxId?: string } = {},
  ) {
    return this.#request(
      `v1/mail/messages/${encodeURIComponent(messageId)}/archive`,
      (value) => mailContentAcknowledgementSchema.parse(value),
      {
        ...this.#credentialAuthorization(authorization),
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }
  unarchiveMailMessage(
    authorization: CredentialAuthorization,
    messageId: string,
    input: { mailboxId?: string } = {},
  ) {
    return this.#request(
      `v1/mail/messages/${encodeURIComponent(messageId)}/unarchive`,
      (value) => mailContentAcknowledgementSchema.parse(value),
      {
        ...this.#credentialAuthorization(authorization),
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }
  trashMailMessage(
    authorization: CredentialAuthorization,
    messageId: string,
    input: { mailboxId?: string } = {},
  ) {
    return this.#request(
      `v1/mail/messages/${encodeURIComponent(messageId)}/trash`,
      (value) => mailContentAcknowledgementSchema.parse(value),
      {
        ...this.#credentialAuthorization(authorization),
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }
  restoreMailMessage(
    authorization: CredentialAuthorization,
    messageId: string,
    input: { mailboxId?: string } = {},
  ) {
    return this.#request(
      `v1/mail/messages/${encodeURIComponent(messageId)}/restore`,
      (value) => mailContentAcknowledgementSchema.parse(value),
      {
        ...this.#credentialAuthorization(authorization),
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }
  purgeMailMessage(
    authorization: CredentialAuthorization,
    messageId: string,
    input: { mailboxId?: string } = {},
  ) {
    return this.#request(
      `v1/mail/messages/${encodeURIComponent(messageId)}/purge`,
      (value) => mailContentAcknowledgementSchema.parse(value),
      {
        ...this.#credentialAuthorization(authorization),
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }
  accountStatus(authorization: CredentialAuthorization) {
    return this.#request(
      "v1/access/account",
      (value) => accountAccessStatusSchema.parse(value),
      this.#credentialAuthorization(authorization),
    );
  }

  currentNomination(apiKey: string) {
    return this.#request(
      "v1/access/nomination",
      (value) => currentNominationSchema.parse(value),
      { apiKey },
    );
  }
  authorizeNomination(apiKey: string, input: NominationAuthorizationRequest) {
    return this.#request(
      "v1/access/nomination/authorize",
      (value) => nominationCorrectionResponseSchema.parse(value),
      {
        apiKey,
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }

  resendNomination(apiKey: string) {
    return this.#request(
      "v1/access/nomination/send",
      (value) => nominationSendResponseSchema.parse(value),
      { method: "POST", apiKey },
    );
  }

  correctNomination(apiKey: string, input: NominationCorrectionRequest) {
    return this.#request(
      "v1/access/nomination/correct",
      (value) => nominationCorrectionResponseSchema.parse(value),
      {
        method: "POST",
        apiKey,
        body: JSON.stringify(input),
      },
    );
  }

  cancelNomination(apiKey: string, input: NominationCancellationRequest) {
    return this.#request(
      "v1/access/nomination/cancel",
      (value) => nominationCancellationResponseSchema.parse(value),
      {
        method: "POST",
        apiKey,
        body: JSON.stringify(input),
      },
    );
  }

  humanAccessStatus() {
    return this.#request(
      "v1/access/human",
      (value) => humanAccessStatusSchema.parse(value),
      { credentials: "include" },
    );
  }

  confirmOwnership(apiKey: string, input: OwnershipConfirmationRequest) {
    return this.#request(
      "v1/access/nomination/confirm",
      (value) => ownershipConfirmationResponseSchema.parse(value),
      {
        method: "POST",
        apiKey,
        body: JSON.stringify(input),
      },
    );
  }

  beginOwnerEmailChange(input: OwnerEmailBegin) {
    return this.#request(
      "v1/access/email-change/begin",
      (value) => ownerEmailOperationSchema.parse(value),
      { method: "POST", credentials: "include", body: JSON.stringify(input) },
    );
  }

  confirmOwnerCurrentEmail(input: OwnerEmailCode) {
    return this.#request(
      "v1/access/email-change/current-proof",
      (value) => ownerEmailOperationSchema.parse(value),
      { method: "POST", credentials: "include", body: JSON.stringify(input) },
    );
  }

  confirmOwnerNewEmail(input: OwnerEmailCode) {
    return this.#request(
      "v1/access/email-change/new-proof",
      (value) => ownerEmailOperationSchema.parse(value),
      { method: "POST", credentials: "include", body: JSON.stringify(input) },
    );
  }

  resendOwnerEmailProof(input: OwnerEmailResend) {
    return this.#request(
      "v1/access/email-change/resend",
      (value) => ownerEmailOperationSchema.parse(value),
      { method: "POST", credentials: "include", body: JSON.stringify(input) },
    );
  }

  cancelOwnerEmailChange(input: OwnerEmailOperationReference) {
    return this.#request(
      "v1/access/email-change/cancel",
      (value) => ownerEmailOperationSchema.parse(value),
      { method: "POST", credentials: "include", body: JSON.stringify(input) },
    );
  }

  ownerEmailChangeStatus(receiptProof: string) {
    return this.#request(
      "v1/access/email-change/status",
      (value) => ownerEmailStatusSchema.parse(value),
      {
        method: "POST",
        credentials: "omit",
        body: JSON.stringify({ receiptProof }),
      },
    );
  }

  requestWorkplaceDeletion(receiptProof: string) {
    return this.#request(
      "v1/access/deletion/challenge",
      (value) => deletionRequestResponseSchema.parse(value),
      {
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ receiptProof }),
      },
    );
  }
  confirmWorkplaceDeletion(input: {
    challengeId: string;
    code: string;
    receiptProof: string;
  }) {
    return this.#request(
      "v1/access/deletion/confirm",
      (value) => deletionStatusSchema.parse(value),
      {
        method: "POST",
        credentials: "include",
        body: JSON.stringify(input),
      },
    );
  }
  workplaceDeletionStatus(receiptProof: string) {
    return this.#request(
      "v1/access/deletion/status",
      (value) => deletionStatusSchema.parse(value),
      {
        method: "POST",
        body: JSON.stringify({ receiptProof }),
      },
    );
  }

  getParticipantRole(
    authorization: CredentialAuthorization,
    accountId: string,
  ) {
    return this.#request(
      `v1/accounts/${encodeURIComponent(accountId)}/role`,
      (value) => participantRoleSchema.parse(value),
      this.#credentialAuthorization(authorization),
    );
  }
  updateParticipantRole(
    authorization: CredentialAuthorization,
    accountId: string,
    input: ParticipantRoleUpdate,
  ) {
    return this.#request(
      `v1/accounts/${encodeURIComponent(accountId)}/role`,
      (value) => participantRoleSchema.parse(value),
      {
        ...this.#credentialAuthorization(authorization),
        method: "PATCH",
        body: JSON.stringify(input),
      },
    );
  }
  getProfile(authorization: CredentialAuthorization, accountId: string) {
    return this.#request(
      `v1/accounts/${encodeURIComponent(accountId)}`,
      (value) => profileSchema.parse(value),
      this.#credentialAuthorization(authorization),
    );
  }
  updateProfile(
    authorization: CredentialAuthorization,
    accountId: string,
    input: ProfileUpdate,
  ) {
    return this.#request(
      `v1/accounts/${encodeURIComponent(accountId)}`,
      (value) => profileSchema.parse(value),
      {
        ...this.#credentialAuthorization(authorization),
        method: "PATCH",
        body: JSON.stringify(input),
      },
    );
  }
  requestBillingPurchase(
    authorization: CredentialAuthorization,
    input: BillingPurchaseRequest,
  ) {
    return this.#request(
      "v1/workplace/billing/purchases",
      (value) => billingPurchaseSchema.parse(value),
      {
        ...this.#credentialAuthorization(authorization),
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }
  getBillingPurchase(
    authorization: CredentialAuthorization,
    purchaseId: string,
  ) {
    return this.#request(
      `v1/workplace/billing/purchases/${encodeURIComponent(purchaseId)}`,
      (value) => billingPurchaseSchema.parse(value),
      this.#credentialAuthorization(authorization),
    );
  }
  /** Sensitive native payment link. Do not log or persist the returned URL. */
  getBillingPaymentAction(
    authorization: CredentialAuthorization,
    input: BillingPaymentRequest = {},
  ) {
    return this.#request(
      "v1/workplace/billing/payment",
      (value) => billingPaymentActionSchema.parse(value),
      {
        ...this.#credentialAuthorization(authorization),
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }
  listBillingInvoices(
    authorization: CredentialAuthorization,
    input: BillingInvoiceListRequest = {},
  ) {
    const query = input.after
      ? `?${new URLSearchParams({ after: input.after })}`
      : "";
    return this.#request(
      `v1/workplace/billing/invoices${query}`,
      (value) => billingInvoiceListSchema.parse(value),
      this.#credentialAuthorization(authorization),
    );
  }
  /** Sensitive native document link. Do not log or persist the returned URL. */
  getBillingInvoiceLink(
    authorization: CredentialAuthorization,
    reference: string,
  ) {
    return this.#request(
      `v1/workplace/billing/invoices/${encodeURIComponent(reference)}/link`,
      (value) => billingPaymentActionSchema.parse(value),
      { ...this.#credentialAuthorization(authorization), method: "POST" },
    );
  }
  getBillingStatus(authorization: CredentialAuthorization) {
    return this.#request(
      "v1/workplace/billing",
      (value) => billingStatusSchema.parse(value),
      this.#credentialAuthorization(authorization),
    );
  }
  requestBillingCommand(
    authorization: CredentialAuthorization,
    input: BillingCommandRequest,
  ) {
    return this.#request(
      "v1/workplace/billing/commands",
      (value) => billingCommandSchema.parse(value),
      {
        ...this.#credentialAuthorization(authorization),
        method: "POST",
        body: JSON.stringify(input),
      },
    );
  }
  getBillingCommand(authorization: CredentialAuthorization, commandId: string) {
    return this.#request(
      `v1/workplace/billing/commands/${encodeURIComponent(commandId)}`,
      (value) => billingCommandSchema.parse(value),
      this.#credentialAuthorization(authorization),
    );
  }
  getWorkplaceSettings(authorization: CredentialAuthorization) {
    return this.#request(
      "v1/workplace",
      (value) => workplaceSettingsSchema.parse(value),
      this.#credentialAuthorization(authorization),
    );
  }
  updateWorkplaceSettings(
    authorization: CredentialAuthorization,
    input: WorkplaceSettingsUpdate,
  ) {
    return this.#request(
      "v1/workplace",
      (value) => workplaceSettingsSchema.parse(value),
      {
        ...this.#credentialAuthorization(authorization),
        method: "PATCH",
        body: JSON.stringify(input),
      },
    );
  }

  listParticipants(authorization: CredentialAuthorization) {
    return this.#request(
      "v1/accounts",
      (value) => participantListSchema.parse(value),
      this.#credentialAuthorization(authorization),
    );
  }
  removeParticipant(authorization: CredentialAuthorization, accountId: string) {
    return this.#request(
      `v1/accounts/${encodeURIComponent(accountId)}`,
      (value) => participantRemovedSchema.parse(value),
      { ...this.#credentialAuthorization(authorization), method: "DELETE" },
    );
  }
  listAgentKeys(authorization: CredentialAuthorization, accountId: string) {
    return this.#request(
      `v1/accounts/${encodeURIComponent(accountId)}/keys`,
      (value) => agentKeyListSchema.parse(value),
      this.#credentialAuthorization(authorization),
    );
  }
  createAgentKey(
    authorization: CredentialAuthorization,
    accountId: string,
    name: string,
  ) {
    return this.#request(
      `v1/accounts/${encodeURIComponent(accountId)}/keys`,
      (value) => agentCredentialSchema.parse(value),
      {
        ...this.#credentialAuthorization(authorization),
        method: "POST",
        body: JSON.stringify({ name }),
      },
    );
  }
  renameAgentKey(
    authorization: CredentialAuthorization,
    accountId: string,
    keyId: string,
    name: string,
  ) {
    return this.#request(
      `v1/accounts/${encodeURIComponent(accountId)}/keys/${encodeURIComponent(keyId)}`,
      (value) => agentKeyRenamedSchema.parse(value),
      {
        ...this.#credentialAuthorization(authorization),
        method: "PATCH",
        body: JSON.stringify({ name }),
      },
    );
  }
  revokeAgentKey(
    authorization: CredentialAuthorization,
    accountId: string,
    keyId: string,
  ) {
    return this.#request(
      `v1/accounts/${encodeURIComponent(accountId)}/keys/${encodeURIComponent(keyId)}`,
      (value) => agentKeyRevokedSchema.parse(value),
      { ...this.#credentialAuthorization(authorization), method: "DELETE" },
    );
  }
  recoverAgentKeys(
    authorization: CredentialAuthorization,
    accountId: string,
    name: string,
  ) {
    return this.#request(
      `v1/accounts/${encodeURIComponent(accountId)}/keys/recover`,
      (value) => agentCredentialSchema.parse(value),
      {
        ...this.#credentialAuthorization(authorization),
        method: "POST",
        body: JSON.stringify({ name }),
      },
    );
  }
  beginKeyRotation(apiKey: string, operationId: string, name: string) {
    return this.#request(
      "v1/access/keys/rotate",
      (value) => keyRotationResponseSchema.parse(value),
      { apiKey, method: "POST", body: JSON.stringify({ operationId, name }) },
    );
  }
  completeKeyRotation(apiKey: string, operationId: string) {
    return this.#request(
      "v1/access/keys/rotate/complete",
      (value) => keyRotationCompletedSchema.parse(value),
      { apiKey, method: "POST", body: JSON.stringify({ operationId }) },
    );
  }
  #credentialAuthorization(authorization: CredentialAuthorization) {
    return "apiKey" in authorization
      ? { apiKey: authorization.apiKey }
      : { credentials: "include" as const };
  }

  async #request<T>(
    path: string,
    parse: ResponseParser<T>,
    options: {
      method?: string;
      body?: string;
      apiKey?: string;
      allowInsecureHttp?: boolean;
      credentials?: "include" | "omit";
    } = {},
  ): Promise<T> {
    if (!options.allowInsecureHttp && !secureTransport(this.#baseUrl))
      throw new TypeError(
        "Signup and authenticated operations require HTTPS or loopback HTTP",
      );
    const requestId = globalThis.crypto.randomUUID();
    const fetchRequest = this.#fetch;
    const response = await fetchRequest(
      new globalThis.URL(path, this.#baseUrl),
      {
        method: options.method ?? "GET",
        redirect: "error",
        ...(options.credentials ? { credentials: options.credentials } : {}),
        ...(options.body === undefined ? {} : { body: options.body }),
        headers: {
          Accept: "application/json",
          ...(options.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
          ...(options.apiKey === undefined
            ? {}
            : { Authorization: `Bearer ${options.apiKey}` }),
          [requestIdHeader]: requestId,
        },
      },
    );
    const returnedRequestId = responseRequestId(response);

    let body: unknown;

    try {
      body = await response.json();
    } catch (cause) {
      if (!response.ok) {
        throw new AgentWorkplaceError(
          `Request failed with status ${response.status}`,
          { status: response.status, requestId: returnedRequestId },
        );
      }

      throw new AgentWorkplaceError(
        "The Agent Workplace API returned invalid JSON",
        { status: response.status, cause, requestId: returnedRequestId },
      );
    }

    if (!response.ok) {
      const apiError = apiErrorResponseSchema.safeParse(body);

      if (apiError.success) {
        throw new AgentWorkplaceError(apiError.data.error.message, {
          status: response.status,
          code: apiError.data.error.code,
          choiceRevision: apiError.data.error.choiceRevision,
          requestId: returnedRequestId,
        });
      }

      throw new AgentWorkplaceError(
        `Request failed with status ${response.status}`,
        { status: response.status, requestId: returnedRequestId },
      );
    }

    try {
      return parse(body);
    } catch (cause) {
      throw new AgentWorkplaceError(
        "The Agent Workplace API returned an invalid response",
        { status: response.status, cause, requestId: returnedRequestId },
      );
    }
  }
}
