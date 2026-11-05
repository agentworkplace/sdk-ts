interface AgentWorkplaceErrorOptions {
  status: number;
  retryAfterSeconds?: number;
  choiceRevision?: number;
  code?: string;
  /** With `insufficient_scope`: the agent grant scopes the operation needs. */
  scopes?: string[];
  cause?: unknown;
  requestId?: string;
}

export class AgentWorkplaceError extends Error {
  readonly status: number;
  readonly retryAfterSeconds?: number;
  readonly choiceRevision?: number;
  readonly code?: string;
  readonly scopes?: string[];
  readonly requestId?: string;

  constructor(message: string, options: AgentWorkplaceErrorOptions) {
    super(message, { cause: options.cause });

    this.name = "AgentWorkplaceError";
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.choiceRevision = options.choiceRevision;
    this.code = options.code;
    if (options.scopes) this.scopes = options.scopes;
    this.requestId = options.requestId;
  }
}

/**
 * Invalid caller input detected before any request, such as a malformed ID,
 * file reference or limit. It extends `TypeError`, so existing checks keep
 * working; the message is a fixed, safe description of the rejected input.
 */
export class AgentWorkplaceInputError extends TypeError {
  readonly code = "invalid_input" as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AgentWorkplaceInputError";
  }
}

/**
 * The request got no response, so it may or may not have reached the API. It
 * extends `TypeError`, as `fetch` failures do, so existing checks keep working.
 */
export class AgentWorkplaceNetworkError extends TypeError {
  readonly code = "network_error" as const;

  constructor(options?: { cause?: unknown }) {
    super("Unable to reach Agent Workplace", options);
    this.name = "AgentWorkplaceNetworkError";
  }
}
