import { describe, expect, it } from "vitest";
import {
  agentInvitationFileSchema,
  agentInvitationPreviewSchema,
  createAgentInvitationLink,
  createHumanInvitationLink,
  parseAgentInvitationLink,
  parseHumanInvitationLink,
  type AgentInvitationFile,
} from "./invitations.js";

const record: AgentInvitationFile = {
  version: 1,
  kind: "invitation",
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
const invalid = new TypeError("Invalid agent invitation link");

describe("agent invitation link wire format", () => {
  it("round trips the version-1 agent file with proof only in the fragment", () => {
    const link = createAgentInvitationLink(record, options);
    expect(parseAgentInvitationLink(link, options)).toEqual(record);
    const url = new URL(link);
    expect(url.pathname).toBe("/invitations/agent");
    expect(url.search).toBe("");
    expect(link.slice(0, link.indexOf("#"))).not.toContain(record.code);
    expect([...new URLSearchParams(url.hash.slice(1)).keys()].sort()).toEqual([
      "accountId",
      "code",
      "invitationId",
      "origin",
      "v",
      "workplaceId",
    ]);
    expect(agentInvitationFileSchema.parse(record)).toEqual(record);
  });

  it.each([
    (url: URL) => {
      url.hostname = "lookalike.example.test";
    },
    (url: URL) => {
      url.password = "secret";
    },
    (url: URL) => {
      url.pathname = "/invitations/accept";
    },
    (url: URL) => {
      url.search = "?next=/";
    },
    (url: URL) => {
      url.hash += "&code=duplicate";
    },
    (url: URL) => {
      url.hash += "&kind=human-invitation";
    },
    (url: URL) => {
      url.hash = url.hash.replace("v=1", "v=2");
    },
    (url: URL) => {
      url.hash = url.hash.replace(
        encodeURIComponent(record.origin),
        encodeURIComponent("https://lookalike.example.test"),
      );
    },
    (url: URL) => {
      url.hash = url.hash.replace(record.code, "B".repeat(43));
    },
    (url: URL) => {
      url.hash = url.hash.replace(record.code, "%E0%A4%A");
    },
    (url: URL) => {
      url.hash = url.hash.replace(record.invitationId, "not-a-uuid");
    },
    (url: URL) => {
      url.hash = "v=1&" + "x".repeat(4096);
    },
    (url: URL) => {
      url.hash = "";
    },
  ])("rejects hostile or ambiguous input without echoing it (%#)", (mutate) => {
    const url = new URL(createAgentInvitationLink(record, options));
    mutate(url);
    let message = "";
    try {
      parseAgentInvitationLink(url.href, options);
    } catch (error) {
      expect(error).toEqual(invalid);
      message = String(error);
    }
    expect(message).not.toBe("");
    expect(message).not.toContain(record.code);
  });

  it("keeps agent and human links separate", () => {
    const agent = createAgentInvitationLink(record, options);
    const human = createHumanInvitationLink(
      { ...record, kind: "human-invitation" },
      options,
    );
    expect(() => parseHumanInvitationLink(agent, options)).toThrow();
    expect(() => parseAgentInvitationLink(human, options)).toThrow(invalid);
  });

  it("binds both origins to trusted configuration", () => {
    const link = createAgentInvitationLink(record, options);
    expect(() =>
      parseAgentInvitationLink(link, {
        ...options,
        apiOrigin: "https://other.example.test",
      }),
    ).toThrow(invalid);
    expect(() =>
      parseAgentInvitationLink(link, {
        ...options,
        dashboardOrigin: "https://other.example.test",
      }),
    ).toThrow(invalid);
    for (const dashboardOrigin of [
      "http://app.example.test",
      "https://app.example.test/",
      "https://u:p@app.example.test",
    ])
      expect(() =>
        createAgentInvitationLink(record, { dashboardOrigin }),
      ).toThrow(invalid);
    expect(() =>
      createAgentInvitationLink(
        { ...record, code: "not-a-proof" },
        { dashboardOrigin: options.dashboardOrigin },
      ),
    ).toThrow(invalid);
    expect(() => parseAgentInvitationLink("not a url", options)).toThrow(
      invalid,
    );
  });
});

describe("agent invitation preview projection", () => {
  it("permits terminal status only without identifying details", () => {
    for (const status of ["expired", "revoked", "used", "unavailable"]) {
      expect(agentInvitationPreviewSchema.safeParse({ status }).success).toBe(
        true,
      );
      expect(
        agentInvitationPreviewSchema.safeParse({ status, name: "Agent" })
          .success,
      ).toBe(false);
    }
  });
});
