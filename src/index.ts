export { AgentWorkplace } from "./client.js";
export type {
  AgentWorkplaceOptions,
  CredentialAuthorization,
} from "./client.js";
export { AgentWorkplaceError } from "./errors.js";
export { DocumentationClient, DocumentationError } from "./documentation.js";
export type {
  DocumentationClientOptions,
  DocumentationErrorCode,
  DocumentationPage,
  DocumentationSearchResult,
  DocumentationReadResult,
} from "./documentation.js";

export type { HealthResponse } from "./contracts/health.js";

export type {
  OwnerEmailOperation,
  OwnerEmailBegin,
  OwnerEmailCode,
  OwnerEmailResend,
  OwnerEmailOperationReference,
  SignupRequest,
  DeletionStatus,
  OwnershipConfirmationRequest,
  OwnershipConfirmationResponse,
  SignupResponse,
  AcknowledgementResponse,
  AccessStatus,
  AccountAccessStatus,
  HumanAccessStatus,
  NominationSendResponse,
  CurrentNomination,
  NominationAuthorizationRequest,
  NominationCorrectionRequest,
  NominationCorrectionResponse,
  NominationCancellationRequest,
  NominationCancellationResponse,
} from "./contracts/access.js";

export type {
  ParticipantList,
  AgentKeyList,
  AgentCredential,
  KeyRotationResponse,
} from "./contracts/credentials.js";

export type {
  MailCheckpoint,
  MailCheckpointRequest,
  MailChanges,
  MailChangesRequest,
  MailOperationList,
  MailOperationListRequest,
  MailContentAction,
  MailContentAcknowledgement,
  MailMessage,
  MailAttachmentDownloadGrant,
  MailAttachmentDownloadRequest,
  MailPreparationList,
  MailPreparationListRequest,
  MailAttachmentList,
  MailAttachmentListRequest,
  MailThread,
  MailThreadReadRequest,
  MailMessageSummary,
  MailMessageList,
  MailSenderBlockRequest,
  MailSenderBlockState,
  MailSenderBlockListRequest,
  MailSenderBlockList,
  MailBodyRepresentation,
  MailOmissionList,
  Mailbox,
  MailboxList,
  MailboxAddressChoice,
  SendMailRequest,
  MailOutgoingAttachmentSource,
  ComposeMailRequest,
  MailCorrespondence,
  MailOperation,
  MailRecipients,
} from "./contracts/mail.js";

export type {
  Invitation,
  CreateAgentInvitationRequest,
  IssuedAgentInvitation,
  CreateHumanInvitationRequest,
  IssuedHumanInvitation,
  HumanInvitationCodeRequest,
  HumanInvitationAcceptRequest,
  HumanInvitationAdmission,
  HumanInvitationFile,
  InvitationList,
  InvitationPreviewRequest,
  InvitationPreview,
  InvitationHandoffRequest,
  InvitationRecoveryRequest,
  InvitationRedemptionRequest,
  InvitationAdmission,
} from "./contracts/invitations.js";
export { parseHumanInvitationFile } from "./human-invitation-file.js";

export type { AccountProfile, ProfileUpdate } from "./contracts/accounts.js";
export type {
  WorkplaceSettings,
  WorkplaceSettingsUpdate,
} from "./contracts/workplace.js";

export type {
  ParticipantRole,
  ParticipantRoleUpdate,
} from "./contracts/accounts.js";

export type {
  BeginFileUploadRequest,
  FileUploadRef,
  FileUploadStatus,
  FileUploadParts,
  FilePartGrant,
  FileRef,
  FileMetadata,
  FileList,
  FileDownloadGrant,
} from "./contracts/files.js";

export {
  prepareFileUpload,
  parseFileReference,
  parseFileUploadRequest,
} from "./files.js";

export type {
  FilesEntry,
  FilesTree,
  FilesOrganizationRequest,
  FilesOrganizationResult,
} from "./contracts/files.js";
export { parseFilesOrganizationRequest } from "./files.js";

export type {
  FileHistory,
  FileRestorationRef,
  FileRestorationResult,
  RestoreFileRevisionRequest,
} from "./contracts/files.js";

export { parseRestoreFileRevisionRequest } from "./files.js";

export { parseFileTrashRequest } from "./files.js";
export type {
  FileTrashRequest,
  FileTrashOperationRef,
  FileTrashResult,
  FileTrashList,
} from "./contracts/files.js";

export { parseFileDeletionRequest } from "./files.js";
export type {
  FileDeletionRequest,
  FileDeletionOperationRef,
  FileDeletionResult,
} from "./contracts/files.js";

export type {
  FilesCheckpoint,
  FilesChanges,
  FilesBaseline,
} from "./contracts/files.js";

export { prepareFileUploadFromSource } from "./files.js";
export type { FileUploadSource } from "./files.js";

export type {
  FileDownloadSink,
  FileDownloadOptions,
} from "./files-download.js";
export type {
  FilesTreeItem,
  RetainedFilesItem,
  FilesTreeVisitStore,
} from "./files-tree.js";

export {
  parseMailSendRequest,
  parseMailComposeRequest,
  parseMailAttachmentSelection,
} from "./mail.js";

export { parseMailAttachmentFileCopyIntent } from "./mail-file-copy.js";
export type {
  MailAttachmentFileCopyRequest,
  MailAttachmentFileCopyIntent,
} from "./mail-file-copy.js";

export type {
  MailExportScope,
  MailExportRequest,
  MailExportVisitStore,
  MailExportItem,
} from "./mail-export.js";

export type {
  BillingInvoiceList,
  BillingInvoiceListRequest,
  BillingInvoiceSummary,
  BillingStatus,
  BillingCommand,
  BillingCommandRequest,
  BillingPurchase,
  BillingPurchaseRequest,
  BillingPaymentAction,
  BillingPaymentRequest,
} from "./contracts/billing.js";
