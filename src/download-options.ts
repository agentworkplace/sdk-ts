import { AgentWorkplaceError } from "./errors.js";

/** Optional caller ceiling for whole-buffer Files and Mail downloads. */
export interface DownloadOptions {
  /** Nonnegative safe integer. Does not raise the resource's existing limit. */
  maxBytes?: number;
}

export function validateDownloadLimit(options: DownloadOptions) {
  const limit = options.maxBytes;
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0))
    throw new TypeError("maxBytes must be a nonnegative safe integer");
  return limit;
}

export function checkDownloadLimit(length: number, limit: number | undefined) {
  if (limit !== undefined && length > limit)
    throw new AgentWorkplaceError("Download exceeds the caller's byte limit", {
      status: 0,
      code: "download_too_large",
    });
}
