import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type {
  FileDownloadGrant,
  FileMetadata,
  FileRef,
} from "./contracts/files.js";
import { AgentWorkplaceError } from "./errors.js";

/** The caller owns sink lifetime. Writes must finish before resolving and must
 * not mutate bytes. A checkpoint must sync bytes before persisting its offset;
 * it describes durable progress, not verified content until the method succeeds. */
export interface FileDownloadSink {
  write(bytes: Uint8Array, offset: number): Promise<void>;
  read?(offset: number, length: number): Promise<Uint8Array>;
  checkpoint?(offset: number): Promise<void>;
}
export interface FileDownloadOptions {
  signal?: AbortSignal;
  resume?: {
    revisionId: string;
    byteLength: number;
    sha256: string;
    offset: number;
  };
}
const rangeBytes = 8 * 1024 * 1024;
const interrupted = () =>
  new AgentWorkplaceError("File download integrity or transport check failed", {
    status: 0,
    code: "transfer_interrupted",
  });

/** Feature-owned transport; the client supplies authenticated API operations and
 * its isolated transfer transport. No provider credentials or persistence. */
export async function downloadToSink(
  ref: FileRef,
  sink: FileDownloadSink,
  options: FileDownloadOptions,
  dependencies: {
    metadata(): Promise<FileMetadata>;
    grant(ref: FileRef): Promise<FileDownloadGrant>;
    transfer(url: string, init: RequestInit): Promise<Response>;
  },
) {
  const resume = options.resume ? { ...options.resume } : undefined;
  if (
    resume &&
    (ref.revisionId !== resume.revisionId ||
      !Number.isSafeInteger(resume.offset) ||
      resume.offset < 0 ||
      !Number.isSafeInteger(resume.byteLength) ||
      resume.byteLength < resume.offset ||
      (resume.offset > 0 && !sink.read))
  )
    throw new TypeError(
      "Resume requires the saved revision, length, hash and readable prefix",
    );
  if (options.signal?.aborted) throw interrupted();
  const file = await dependencies.metadata();
  if (
    file.workplaceId !== ref.workplaceId ||
    file.fileId !== ref.fileId ||
    (ref.revisionId && file.revisionId !== ref.revisionId) ||
    file.byteLength > 2_000_000_000 ||
    (resume &&
      (file.revisionId !== resume.revisionId ||
        file.byteLength !== resume.byteLength ||
        file.sha256 !== resume.sha256))
  )
    throw interrupted();
  const pinned = {
    workplaceId: file.workplaceId,
    fileId: file.fileId,
    revisionId: file.revisionId,
  };
  const hash = sha256.create();
  let offset = resume?.offset ?? 0;
  try {
    for (let start = 0; start < offset; start += rangeBytes) {
      if (options.signal?.aborted) throw interrupted();
      const length = Math.min(rangeBytes, offset - start);
      const bytes = await sink.read!(start, length);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== length)
        throw interrupted();
      hash.update(bytes);
    }
  } catch {
    throw interrupted();
  }

  // Empty files still require an authorized byte read; a full resumed prefix is
  // rehashed and checked without trusting a stored digest or a prior process.
  let emptyRead = file.byteLength === 0;
  while (offset < file.byteLength || emptyRead) {
    if (options.signal?.aborted) throw interrupted();
    const grant = await dependencies.grant(pinned);
    if (
      grant.file.workplaceId !== file.workplaceId ||
      grant.file.fileId !== file.fileId ||
      grant.file.revisionId !== file.revisionId ||
      grant.file.byteLength !== file.byteLength ||
      grant.file.sha256 !== file.sha256
    )
      throw interrupted();
    const length = Math.min(rangeBytes, file.byteLength - offset),
      end = offset + length - 1;
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(60000)])
      : AbortSignal.timeout(60000);
    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      response = await dependencies.transfer(grant.url, {
        headers: length ? { Range: `bytes=${offset}-${end}` } : {},
        redirect: "error",
        credentials: "omit",
        signal,
      });
      if (
        !response.body ||
        response.status !== (length ? 206 : 200) ||
        (length &&
          response.headers.get("content-range") !==
            `bytes ${offset}-${end}/${file.byteLength}`) ||
        (!length && response.headers.has("content-range")) ||
        (response.headers.has("content-length") &&
          response.headers.get("content-length") !== String(length)) ||
        (response.headers.has("content-encoding") &&
          response.headers.get("content-encoding") !== "identity")
      )
        throw interrupted();
      reader = response.body.getReader();
      let received = 0;
      for (;;) {
        signal.throwIfAborted();
        const chunk = await reader.read();
        if (chunk.done) break;
        if (
          !(chunk.value instanceof Uint8Array) ||
          chunk.value.length > length - received
        )
          throw interrupted();
        hash.update(chunk.value);
        await sink.write(chunk.value, offset + received);
        received += chunk.value.length;
      }
      signal.throwIfAborted();
      if (received !== length) throw interrupted();
      offset += received;
      emptyRead = false;
      if (offset < file.byteLength) await sink.checkpoint?.(offset);
    } catch {
      throw interrupted();
    } finally {
      if (reader) {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      } else await response?.body?.cancel().catch(() => {});
    }
  }
  if (bytesToHex(hash.digest()) !== file.sha256) throw interrupted();
  try {
    if (options.signal?.aborted) throw interrupted();
    await sink.checkpoint?.(offset);
  } catch {
    throw interrupted();
  }
  return { file };
}
