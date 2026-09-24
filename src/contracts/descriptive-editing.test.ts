import { expect, it } from "vitest";
import {
  profileUpdateSchema,
  participantRoleUpdateSchema,
} from "./accounts.js";
import { workplaceSettingsUpdateSchema } from "./workplace.js";

it.each([profileUpdateSchema, workplaceSettingsUpdateSchema])(
  "requires an explicit revision and limits patches to descriptive fields",
  (schema) => {
    const expectedRevision = "9ea2537a-ea98-4322-8c1b-c43458937c47";
    expect(
      schema.parse({ expectedRevision, name: " New name ", description: null }),
    ).toEqual({ expectedRevision, name: "New name", description: null });
    for (const input of [
      { name: "No revision" },
      { expectedRevision },
      { expectedRevision, role: "admin" },
      { expectedRevision, loginEmail: "private@example.test" },
      { expectedRevision, accountId: expectedRevision, name: "Name" },
      { expectedRevision, name: " " },
      { expectedRevision, name: "a".repeat(101) },
      { expectedRevision, description: "a".repeat(501) },
    ])
      expect(schema.safeParse(input).success).toBe(false);
    expect(
      schema.safeParse({ expectedRevision, description: "" }).success,
    ).toBe(true);
  },
);

it("role input cannot assign ownership or bypass an observed role revision", () => {
  const expectedRevision = "9ea2537a-ea98-4322-8c1b-c43458937c47";
  expect(
    participantRoleUpdateSchema.parse({ expectedRevision, role: "admin" }),
  ).toEqual({ expectedRevision, role: "admin" });
  for (const input of [
    { role: "admin" },
    { expectedRevision, role: "owner" },
    { expectedRevision, role: "member", accountId: expectedRevision },
    { expectedRevision, role: "admin", name: "Authority" },
  ])
    expect(participantRoleUpdateSchema.safeParse(input).success).toBe(false);
});
