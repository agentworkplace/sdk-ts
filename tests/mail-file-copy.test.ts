import { expect, it, vi } from "vitest";
import {
  AgentWorkplace,
  prepareFileUpload,
  parseMailAttachmentFileCopyIntent,
} from "../src/index.js";
const workplaceId = "11111111-1111-4111-8111-111111111111";
const messageId = "22222222-2222-4222-8222-222222222222";
const attachmentId = "33333333-3333-4333-8333-333333333333";
const base = {
  workplaceId,
  operationId: "44444444-4444-4444-8444-444444444444",
  target: { name: "chosen.txt" },
  expiresAt: "2030-01-01T00:00:00Z",
};
const source = { messageId, attachmentId };
const bytes = new TextEncoder().encode("abc");
const request = prepareFileUpload(
  { ...base, contentType: "text/plain" },
  bytes,
);
const intent = { version: 1 as const, source, request };
const pending = {
  state: "pending" as const,
  transferState: "open" as const,
  uploadId: attachmentId,
  fileId: messageId,
  revisionId: attachmentId,
  version: null,
};
const published = {
  ...pending,
  state: "published" as const,
  version: attachmentId,
};
const auth = { apiKey: "private-key" };
function fixture() {
  const client = new AgentWorkplace({
    baseUrl: "https://api.test",
    fetch: async () => {
      throw new Error("Unexpected HTTP request");
    },
  });
  const download = vi
    .spyOn(client, "downloadMailAttachment")
    .mockResolvedValue({
      messageId,
      attachment: {
        attachmentId,
        ordinal: 0,
        filename: "../../untrusted",
        contentType: "text/plain",
        disposition: null,
        contentId: null,
        state: "retained",
        bytes: 3,
        sha256: request.sha256,
      },
      bytes,
    });
  const begin = vi.spyOn(client, "beginFileUpload").mockResolvedValue(pending);
  const finalize = vi
    .spyOn(client, "finalizeFileUpload")
    .mockResolvedValue(published);
  const upload = vi
    .spyOn(client, "uploadFileFromSource")
    .mockImplementation(async (_auth, actual, reader) => {
      expect(actual).toEqual(request);
      expect(await reader.read(0, 3)).toEqual(bytes);
      return published;
    });
  return { client, download, begin, finalize, upload };
}
it("persists independent frozen intent before admission and ignores inbound filename", async () => {
  const f = fixture();
  const order: string[] = [];
  f.begin.mockImplementation(async () => {
    order.push("begin");
    return pending;
  });
  const result = await f.client.copyMailAttachmentToFile(
    auth,
    { ...base, source },
    async (saved) => {
      expect(saved).toEqual(intent);
      expect(JSON.stringify(saved)).not.toContain("private-key");
      order.push("persist");
      saved.request.target = { name: "mutated" };
      saved.source.messageId = workplaceId;
    },
  );
  expect(order).toEqual(["persist", "begin"]);
  expect(result).toEqual(published);
  expect(f.finalize).not.toHaveBeenCalled();
  expect(f.upload).toHaveBeenCalledOnce();
});
it("does not admit destination when durable persistence fails", async () => {
  const f = fixture();
  await expect(
    f.client.copyMailAttachmentToFile(auth, { ...base, source }, async () => {
      throw new Error("disk unavailable");
    }),
  ).rejects.toThrow("disk unavailable");
  expect(f.begin).not.toHaveBeenCalled();
});
it.each(["published", "conflict", "expired", "cancelled"] as const)(
  "recovers %s destination without reading deleted or revoked Mail",
  async (state) => {
    const f = fixture();
    f.download.mockRejectedValue(new Error("source unavailable"));
    f.begin.mockResolvedValue({ ...published, state });
    expect(
      (
        await f.client.resumeMailAttachmentFileCopy(
          auth,
          JSON.parse(JSON.stringify(intent)),
        )
      ).state,
    ).toBe(state);
    expect(f.download).not.toHaveBeenCalled();
    expect(f.finalize).not.toHaveBeenCalled();
  },
);
it.each(["open", "completing", "closed"] as const)(
  "finalizes uploaded %s destination before reading Mail",
  async (transferState) => {
    const f = fixture();
    f.begin.mockResolvedValue({ ...pending, transferState });
    f.download.mockRejectedValue(new Error("source purged"));
    expect(await f.client.resumeMailAttachmentFileCopy(auth, intent)).toEqual(
      published,
    );
    expect(f.download).not.toHaveBeenCalled();
    expect(f.upload).not.toHaveBeenCalled();
  },
);
it("resumes missing bytes under the same immutable operation only after status replay", async () => {
  const f = fixture();
  const order: string[] = [];
  f.begin.mockImplementation(async (_auth, saved) => {
    expect(saved).toEqual(request);
    order.push("begin");
    return pending;
  });
  f.finalize.mockImplementation(async () => {
    order.push("finalize");
    return pending;
  });
  f.download.mockImplementation(async () => {
    order.push("download");
    return {
      messageId,
      attachment: {
        attachmentId,
        ordinal: 0,
        filename: null,
        contentType: null,
        disposition: null,
        contentId: null,
        state: "retained",
        bytes: 3,
        sha256: request.sha256,
      },
      bytes,
    };
  });
  expect(await f.client.resumeMailAttachmentFileCopy(auth, intent)).toEqual(
    published,
  );
  expect(order).toEqual(["begin", "finalize", "download"]);
});
it("leaves incomplete operation recoverable when source is unavailable", async () => {
  const f = fixture();
  f.finalize.mockResolvedValue(pending);
  f.download.mockRejectedValue(new Error("source unavailable"));
  await expect(
    f.client.resumeMailAttachmentFileCopy(auth, intent),
  ).rejects.toThrow("source unavailable");
  expect(f.begin).toHaveBeenCalledExactlyOnceWith(auth, request);
  expect(f.upload).not.toHaveBeenCalled();
});
it("rejects changed source bytes before uploading to saved destination", async () => {
  const f = fixture();
  f.finalize.mockResolvedValue(pending);
  const original = await f.download(auth, source);
  f.download.mockResolvedValue({
    ...original,
    bytes: new TextEncoder().encode("abd"),
  });
  await expect(
    f.client.resumeMailAttachmentFileCopy(auth, intent),
  ).rejects.toThrow("saved copy intent");
  expect(f.upload).not.toHaveBeenCalled();
});
it.each(["planned", "creating"] as const)(
  "returns %s status without claiming successful copy or rereading source",
  async (transferState) => {
    const f = fixture();
    f.begin.mockResolvedValue({ ...pending, transferState });
    expect(await f.client.resumeMailAttachmentFileCopy(auth, intent)).toEqual({
      ...pending,
      transferState,
    });
    expect(f.download).not.toHaveBeenCalled();
  },
);
it("rejects invalid explicit destination before fetching Mail", async () => {
  const f = fixture();
  await expect(
    f.client.copyMailAttachmentToFile(
      auth,
      { ...base, target: { name: "../unsafe" }, source },
      async () => {},
    ),
  ).rejects.toThrow();
  expect(f.download).not.toHaveBeenCalled();
});
it("rejects extra intent fields rather than retaining grants or payloads", () => {
  expect(() =>
    parseMailAttachmentFileCopyIntent({ ...intent, url: "private-grant" }),
  ).toThrow("Invalid Mail attachment copy intent");
});

it("copies a full decimal 10 MB through real SDK wire handling with isolated byte grants", async () => {
  const full = new Uint8Array(10_000_000).fill(173);
  const frozen = prepareFileUpload(
    { ...base, contentType: "application/octet-stream" },
    full,
  );
  const received: Uint8Array[] = [];
  let persisted = false;
  const client = new AgentWorkplace({
    baseUrl: "https://api.test",
    fetch: async (input, init) => {
      const req = new Request(input, init);
      const path = new URL(req.url).pathname;
      expect(req.headers.get("authorization")).toBe("Bearer private-key");
      if (path.endsWith("/download"))
        return Response.json({
          messageId,
          attachment: {
            attachmentId,
            ordinal: 0,
            filename: "../../unsafe",
            contentType: null,
            disposition: null,
            contentId: null,
            state: "retained",
            bytes: full.length,
            sha256: frozen.sha256,
          },
          url: "https://bytes.test/source",
          expiresAt: "2030-01-01T00:00:00Z",
        });
      expect(persisted).toBe(true);
      if (path.endsWith("/uploads")) {
        expect(await req.json()).toEqual(frozen);
        return Response.json(pending);
      }
      if (path.endsWith("/parts"))
        return Response.json({ upload: pending, presentPartNumbers: [] });
      if (path.endsWith("/finalize")) return Response.json(published);
      const part = path.match(/\/parts\/(\d+)$/)?.[1];
      expect(part).toBeDefined();
      return Response.json({
        url: `https://bytes.test/part/${part}`,
        headers: {},
        expiresAt: "2030-01-01T00:00:00Z",
      });
    },
    transferFetch: async (input, init) => {
      const req = new Request(input, init);
      expect(req.credentials).toBe("omit");
      expect(req.redirect).toBe("error");
      for (const header of ["authorization", "cookie", "x-request-id"])
        expect(req.headers.has(header)).toBe(false);
      if (new URL(req.url).pathname === "/source") return new Response(full);
      received.push(new Uint8Array(await req.arrayBuffer()));
      return new Response(null, { status: 200 });
    },
  });
  expect(
    (
      await client.copyMailAttachmentToFile(
        auth,
        { ...base, source },
        async (saved) => {
          expect(saved.request).toEqual(frozen);
          persisted = true;
        },
      )
    ).state,
  ).toBe("published");
  expect(received.map((part) => part.length)).toEqual([
    8 * 1024 * 1024,
    10_000_000 - 8 * 1024 * 1024,
  ]);
  const combined = new Uint8Array(full.length);
  let offset = 0;
  for (const part of received) {
    combined.set(part, offset);
    offset += part.length;
  }
  expect(
    prepareFileUpload(
      { ...base, contentType: "application/octet-stream" },
      combined,
    ).sha256,
  ).toBe(frozen.sha256);
}, 30_000);
