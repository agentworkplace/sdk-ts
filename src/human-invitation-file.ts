import { humanInvitationFileSchema } from "./contracts/invitations.js";
import { AgentWorkplaceInputError } from "./errors.js";

/** Parse a local bearer file without exposing validation internals or contents. */
export function parseHumanInvitationFile(value: unknown) {
  const parsed = humanInvitationFileSchema.safeParse(value);
  if (!parsed.success)
    throw new AgentWorkplaceInputError("Invalid human invitation file");
  if (new URL(parsed.data.origin).origin !== parsed.data.origin)
    throw new AgentWorkplaceInputError("Invalid human invitation file");
  return parsed.data;
}
