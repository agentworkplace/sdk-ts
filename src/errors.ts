interface AgentWorkplaceErrorOptions {
  status: number;
  retryAfterSeconds?: number;
  choiceRevision?: number;
  code?: string;
  cause?: unknown;
  requestId?: string;
}

export class AgentWorkplaceError extends Error {
  readonly status: number;
  readonly retryAfterSeconds?: number;
  readonly choiceRevision?: number;
  readonly code?: string;
  readonly requestId?: string;

  constructor(message: string, options: AgentWorkplaceErrorOptions) {
    super(message, { cause: options.cause });

    this.name = "AgentWorkplaceError";
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.choiceRevision = options.choiceRevision;
    this.code = options.code;
    this.requestId = options.requestId;
  }
}
