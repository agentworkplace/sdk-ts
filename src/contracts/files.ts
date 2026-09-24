import { z } from "zod";

const digest = z.string().regex(/^[A-Za-z0-9+/]{22}==$/);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
export const fileNameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      value.trim().length > 0 &&
      !/[/\\\0]/.test(value) &&
      Array.from(value).reduce((bytes, character) => {
        const point = character.codePointAt(0)!;
        return (
          bytes +
          (point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4)
        );
      }, 0) <= 255,
  );
export const fileTargetSchema = z.union([
  z
    .object({ name: fileNameSchema, parentId: z.uuid().nullable().optional() })
    .strict(),
  z.object({ fileId: z.uuid(), version: z.uuid() }).strict(),
]);
export const beginFileUploadRequestSchema = z
  .object({
    workplaceId: z.uuid(),
    operationId: z.uuid(),
    target: fileTargetSchema,
    byteLength: z.number().int().min(0).max(2_000_000_000),
    contentType: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[\x20-\x7e]+$/),
    sha256,
    contentMd5: digest,
    expiresAt: z.iso.datetime(),
    multipartParts: z
      .array(
        z
          .object({
            partNumber: z.number().int().min(1).max(239),
            byteLength: z
              .number()
              .int()
              .min(0)
              .max(8 * 1024 * 1024),
            contentMd5: digest,
          })
          .strict(),
      )
      .min(1)
      .max(239),
  })
  .strict();
export type BeginFileUploadRequest = z.infer<
  typeof beginFileUploadRequestSchema
>;

export const fileUploadRefSchema = z
  .object({ workplaceId: z.uuid(), uploadId: z.uuid() })
  .strict();
export type FileUploadRef = z.infer<typeof fileUploadRefSchema>;
export const fileUploadStatusSchema = z.union([
  z.object({ state: z.literal("evidence_expired"), uploadId: z.uuid() }),
  z.object({
    state: z.enum([
      "pending",
      "published",
      "limited",
      "conflict",
      "cancelled",
      "expired",
      "invalid",
      "revoked",
    ]),
    transferState: z
      .enum(["planned", "creating", "open", "sealing", "completing", "closed"])
      .optional(),
    uploadId: z.uuid(),
    fileId: z.uuid(),
    revisionId: z.uuid().nullable(),
    version: z.uuid().nullable(),
  }),
]);
export type FileUploadStatus = z.infer<typeof fileUploadStatusSchema>;
/** Presence is not content verification; finalization still checks the immutable object. */
export const fileUploadPartsSchema = z
  .object({
    upload: fileUploadStatusSchema,
    presentPartNumbers: z
      .array(z.number().int().min(1).max(239))
      .max(239)
      .refine((parts) => new Set(parts).size === parts.length)
      .nullable(),
  })
  .strict()
  .refine(
    (value) =>
      (value.upload.state === "pending" &&
        value.upload.transferState === "open") ===
      (value.presentPartNumbers !== null),
  );
export type FileUploadParts = z.infer<typeof fileUploadPartsSchema>;
export const filePartGrantSchema = z.object({
  url: z.url(),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.iso.datetime(),
});
export type FilePartGrant = z.infer<typeof filePartGrantSchema>;
export const fileRefSchema = z
  .object({
    workplaceId: z.uuid(),
    fileId: z.uuid(),
    revisionId: z.uuid().optional(),
  })
  .strict();
export type FileRef = z.infer<typeof fileRefSchema>;
export const fileMetadataSchema = z.object({
  workplaceId: z.uuid(),
  fileId: z.uuid(),
  name: fileNameSchema,
  version: z.uuid(),
  revisionId: z.uuid(),
  reference: z.string(),
  revisionReference: z.string(),
  byteLength: z.number().int().nonnegative(),
  contentType: z.string(),
  sha256,
  actorId: z.uuid(),
  createdAt: z.iso.datetime(),
});
export type FileMetadata = z.infer<typeof fileMetadataSchema>;
export const fileListRequestSchema = z
  .object({
    workplaceId: z.uuid(),
    after: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export const fileListSchema = z.object({
  files: z.array(fileMetadataSchema),
  nextCursor: z.uuid().nullable(),
});
export type FileList = z.infer<typeof fileListSchema>;
export const fileDownloadGrantSchema = z.object({
  file: fileMetadataSchema,
  url: z.url(),
  expiresAt: z.iso.datetime(),
});
export type FileDownloadGrant = z.infer<typeof fileDownloadGrantSchema>;

export const fileHistoryRequestSchema = fileListRequestSchema.extend({
  fileId: z.uuid(),
});
export const fileRevisionSchema = fileMetadataSchema.extend({
  isCurrent: z.boolean(),
  expiresAt: z.iso.datetime().nullable(),
  restoredFromRevisionId: z.uuid().nullable(),
});
export const fileHistorySchema = z.object({
  revisions: z.array(fileRevisionSchema),
  nextCursor: z.uuid().nullable(),
});
export type FileHistory = z.infer<typeof fileHistorySchema>;
export const restoreFileRevisionRequestSchema = z
  .object({
    workplaceId: z.uuid(),
    fileId: z.uuid(),
    revisionId: z.uuid(),
    expectedVersion: z.uuid(),
    operationId: z.uuid(),
  })
  .strict();
export type RestoreFileRevisionRequest = z.infer<
  typeof restoreFileRevisionRequestSchema
>;
export const fileRestorationRefSchema = z
  .object({
    workplaceId: z.uuid(),
    operationId: z.uuid(),
  })
  .strict();
export type FileRestorationRef = z.infer<typeof fileRestorationRefSchema>;
export const fileRestorationResultSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("restored"),
    operationId: z.uuid(),
    fileId: z.uuid(),
    restoredFromRevisionId: z.uuid(),
    revisionId: z.uuid(),
    version: z.uuid(),
    occurredAt: z.iso.datetime(),
  }),
  z.object({
    state: z.enum(["limited", "conflict", "evidence_expired"]),
    operationId: z.uuid(),
  }),
]);
export type FileRestorationResult = z.infer<typeof fileRestorationResultSchema>;

export const filesEntrySchema = z.object({
  workplaceId: z.uuid(),
  entryId: z.uuid(),
  kind: z.enum(["file", "folder"]),
  parentId: z.uuid().nullable(),
  name: fileNameSchema,
  version: z.uuid(),
  actorId: z.uuid(),
  changedAt: z.iso.datetime(),
  reference: z.string(),
});
export type FilesEntry = z.infer<typeof filesEntrySchema>;
export const filesTreeRequestSchema = z
  .object({
    workplaceId: z.uuid(),
    parentId: z.uuid().nullable().default(null),
    after: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export const filesTreeSchema = z.object({
  entries: z.array(filesEntrySchema),
  nextCursor: z.uuid().nullable(),
});
export type FilesTree = z.infer<typeof filesTreeSchema>;
const filesCursorSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
export const filesCheckpointRequestSchema = z
  .object({ workplaceId: z.uuid() })
  .strict();
export const filesCheckpointSchema = z.object({
  checkpoint: filesCursorSchema,
});
export const filesChangesRequestSchema = z
  .object({
    workplaceId: z.uuid(),
    cursor: filesCursorSchema,
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export const filesBaselineRequestSchema = z
  .object({
    workplaceId: z.uuid(),
    after: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export const filesBaselineSchema = z.object({
  entries: z.array(
    filesEntrySchema.extend({
      trashedAt: z.iso.datetime().nullable(),
      trashExpiresAt: z.iso.datetime().nullable(),
      clearingHistory: z.boolean(),
    }),
  ),
  nextCursor: z.uuid().nullable(),
});
export const filesChangesSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("gap"),
    reason: z.enum(["history_expired", "checkpoint_unavailable"]),
    baselineRequired: z.literal(true),
  }),
  z
    .object({
      state: z.literal("changes"),
      items: z
        .array(
          z.object({
            id: z.uuid(),
            fileId: z.uuid(),
            revisionId: z.uuid().nullable(),
            position: z
              .string()
              .regex(/^[1-9][0-9]{0,18}$/)
              .refine(
                (v) =>
                  /^[1-9][0-9]{0,18}$/.test(v) &&
                  BigInt(v) <= 9223372036854775807n,
              ),
            action: z.enum([
              "content",
              "folder_create",
              "organize",
              "folder_delete",
              "trash",
              "restore_trash",
              "trash_expired",
              "revision_expired",
              "purge",
              "clear_history",
              "purge_complete",
              "clear_history_complete",
            ]),
            actorId: z.uuid().nullable(),
            occurredAt: z.iso.datetime(),
          }),
        )
        .max(100),
      nextCursor: filesCursorSchema.nullable(),
      checkpoint: filesCursorSchema.nullable(),
    })
    .refine((v) => (v.nextCursor === null) !== (v.checkpoint === null)),
]);
export type FilesCheckpoint = z.infer<typeof filesCheckpointSchema>;
export type FilesChanges = z.infer<typeof filesChangesSchema>;
export type FilesBaseline = z.infer<typeof filesBaselineSchema>;
const organizationIdentity = { workplaceId: z.uuid(), operationId: z.uuid() };
export const filesOrganizationRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      ...organizationIdentity,
      action: z.literal("create_folder"),
      name: fileNameSchema,
      parentId: z.uuid().nullable().default(null),
    })
    .strict(),
  z
    .object({
      ...organizationIdentity,
      action: z.literal("organize"),
      entryId: z.uuid(),
      expectedVersion: z.uuid(),
      name: fileNameSchema.optional(),
      parentId: z.uuid().nullable().optional(),
    })
    .strict()
    .refine((v) => v.name !== undefined || v.parentId !== undefined),
  z
    .object({
      ...organizationIdentity,
      action: z.literal("delete_folder"),
      entryId: z.uuid(),
      expectedVersion: z.uuid(),
    })
    .strict(),
]);
export type FilesOrganizationRequest = z.infer<
  typeof filesOrganizationRequestSchema
>;
export const filesOrganizationResultSchema = z.union([
  z.object({
    state: z.literal("applied"),
    operationId: z.uuid(),
    entry: filesEntrySchema,
    deleted: z.boolean(),
  }),
  z.object({ state: z.literal("evidence_expired"), operationId: z.uuid() }),
]);
export type FilesOrganizationResult = z.infer<
  typeof filesOrganizationResultSchema
>;

export const fileTrashRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("trash"),
      workplaceId: z.uuid(),
      fileId: z.uuid(),
      expectedVersion: z.uuid(),
      operationId: z.uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("restore"),
      workplaceId: z.uuid(),
      fileId: z.uuid(),
      expectedVersion: z.uuid(),
      operationId: z.uuid(),
      destination: z
        .object({ parentId: z.uuid().nullable(), name: fileNameSchema })
        .strict()
        .optional(),
    })
    .strict(),
]);
export type FileTrashRequest = z.infer<typeof fileTrashRequestSchema>;
export const fileTrashOperationRefSchema = z
  .object({ workplaceId: z.uuid(), operationId: z.uuid() })
  .strict();
export type FileTrashOperationRef = z.infer<typeof fileTrashOperationRefSchema>;
const completedTrashResultSchema = z.object({
  operationId: z.uuid(),
  fileId: z.uuid(),
  version: z.uuid(),
  occurredAt: z.iso.datetime(),
});
export const fileTrashResultSchema = z.discriminatedUnion("state", [
  completedTrashResultSchema.extend({
    state: z.literal("trashed"),
    trashExpiresAt: z.iso.datetime(),
  }),
  completedTrashResultSchema.extend({
    state: z.literal("restored"),
    trashExpiresAt: z.null(),
  }),
  z.object({
    state: z.enum(["conflict", "evidence_expired"]),
    operationId: z.uuid(),
  }),
]);
export type FileTrashResult = z.infer<typeof fileTrashResultSchema>;
export const fileTrashEntrySchema = fileMetadataSchema.extend({
  parentId: z.uuid().nullable(),
  trashedAt: z.iso.datetime(),
  trashExpiresAt: z.iso.datetime(),
});
export const fileTrashListSchema = z.object({
  files: z.array(fileTrashEntrySchema),
  nextCursor: z.uuid().nullable(),
});
export type FileTrashList = z.infer<typeof fileTrashListSchema>;

export const fileDeletionRequestSchema = z
  .object({
    workplaceId: z.uuid(),
    operationId: z.uuid(),
    fileId: z.uuid(),
    expectedVersion: z.uuid(),
    action: z.enum(["purge", "clear_history"]),
  })
  .strict();
export type FileDeletionRequest = z.infer<typeof fileDeletionRequestSchema>;
export const fileDeletionOperationRefSchema = z
  .object({ workplaceId: z.uuid(), operationId: z.uuid() })
  .strict();
export type FileDeletionOperationRef = z.infer<
  typeof fileDeletionOperationRefSchema
>;
const fileDeletionProgressSchema = z.object({
  operationId: z.uuid(),
  fileId: z.uuid(),
  action: z.enum(["purge", "clear_history"]),
  version: z.uuid(),
  admittedAt: z.iso.datetime(),
  targetCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  processedCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
export const fileDeletionResultSchema = z
  .discriminatedUnion("state", [
    fileDeletionProgressSchema.extend({
      state: z.literal("pending"),
      phase: z.enum(["collecting", "deleting"]),
    }),
    fileDeletionProgressSchema.extend({
      state: z.literal("complete"),
      completedAt: z.iso.datetime(),
      logicalComplete: z.literal(true),
      physicalCleanup: z.literal("handed_off"),
    }),
    z.object({
      state: z.enum(["conflict", "evidence_expired"]),
      operationId: z.uuid(),
    }),
  ])
  .refine(
    (value) =>
      !("processedCount" in value) ||
      (value.processedCount <= value.targetCount &&
        (value.state !== "complete" ||
          value.processedCount === value.targetCount) &&
        (value.state !== "pending" ||
          value.phase !== "collecting" ||
          value.processedCount === 0)),
    "Inconsistent deletion progress",
  );
export type FileDeletionResult = z.infer<typeof fileDeletionResultSchema>;
