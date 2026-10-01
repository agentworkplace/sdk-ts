import { describe, expect, it } from "vitest";
import {
  createHumanInvitationLink,
  parseHumanInvitationLink,
  humanInvitationPreviewSchema,
  type HumanInvitationFile,
} from "./invitations.js";

const record: HumanInvitationFile = {
  version: 1,
  kind: "human-invitation",
  origin: "https://api.example.test",
  invitationId: "00000000-0000-4000-8000-000000000001",
  workplaceId: "00000000-0000-4000-8000-000000000002",
  accountId: "00000000-0000-4000-8000-000000000003",
  code: "A".repeat(43),
};
const options = {
  dashboardOrigin: "https://app.example.test",
  apiOrigin: record.origin,
};

describe("human invitation link wire format", () => {
  it("round trips a legacy handoff with proof only in the fragment", () => {
    const link = createHumanInvitationLink(record, options);
    expect(parseHumanInvitationLink(link, options)).toEqual(record);
    const url = new URL(link);
    expect(url.pathname).toBe("/invitations/accept");
    expect(url.search).toBe("");
    expect(link.slice(0, link.indexOf("#"))).not.toContain(record.code);
    url.hash = [...new URLSearchParams(url.hash.slice(1))]
      .reverse()
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join("&");
    expect(parseHumanInvitationLink(url.href, options)).toEqual(record);
  });

  it.each([
    (url: URL) => {
      url.hostname = "foreign.example.test";
    },
    (url: URL) => {
      url.username = "user";
    },
    (url: URL) => {
      url.pathname = "/other";
    },
    (url: URL) => {
      url.search = "?returnTo=https://foreign.example.test";
    },
    (url: URL) => {
      url.hash += "&code=duplicate";
    },
    (url: URL) => {
      url.hash += "&extra=true";
    },
    (url: URL) => {
      url.hash = url.hash.replace("v=1", "v=2");
    },
    (url: URL) => {
      url.hash = url.hash.replace("code=", "missing=");
    },
    (url: URL) => {
      url.hash = url.hash.replace(record.code, "B".repeat(43));
    },
    (url: URL) => {
      url.hash = url.hash.replace(record.code, "%ZZ");
    },
    (url: URL) => {
      url.hash = url.hash.replace(record.code, "%FF");
    },
    (url: URL) => {
      url.hash = "x".repeat(4097);
    },
    (url: URL) => {
      url.hash = "";
    },
  ])("rejects hostile or ambiguous input without echoing it (%#)", (mutate) => {
    const url = new URL(createHumanInvitationLink(record, options));
    mutate(url);
    expect(() => parseHumanInvitationLink(url.href, options)).toThrow(
      new TypeError("Invalid human invitation link"),
    );
  });

  it("binds the API to trusted configuration and restricts configured origins", () => {
    const link = createHumanInvitationLink(record, options);
    expect(() =>
      parseHumanInvitationLink(link, {
        ...options,
        apiOrigin: "https://other.example.test",
      }),
    ).toThrow();
    for (const dashboardOrigin of [
      "http://app.example.test",
      "https://app.example.test/",
      "https://app.example.test?x=1",
      "https://u:p@app.example.test",
    ]) {
      expect(() =>
        createHumanInvitationLink(record, { dashboardOrigin }),
      ).toThrow();
    }
    const local = { ...record, origin: "http://127.0.0.1:4000" };
    const localOptions = {
      dashboardOrigin: "http://localhost:3000",
      apiOrigin: local.origin,
    };
    expect(
      parseHumanInvitationLink(
        createHumanInvitationLink(local, localOptions),
        localOptions,
      ),
    ).toEqual(local);
  });
});

describe("human invitation preview projection", () => {
  it("permits terminal status only without identifying details", () => {
    for (const status of ["expired", "revoked", "used", "unavailable"]) {
      expect(humanInvitationPreviewSchema.safeParse({ status }).success).toBe(
        true,
      );
      expect(
        humanInvitationPreviewSchema.safeParse({
          status,
          email: "private@example.test",
        }).success,
      ).toBe(false);
    }
    expect(
      humanInvitationPreviewSchema.safeParse({ status: "pending" }).success,
    ).toBe(false);
  });
});
