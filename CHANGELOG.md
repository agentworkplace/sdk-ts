# @agent-workplace/sdk

## 0.6.0

### Minor Changes

- Handle future notification subject kinds and reason codes through safe unknown
  variants. Preserve known-record validation, pagination, and read positions while
  discarding unvalidated source fields. Notification consumers must handle the new
  unknown variants. The CLI receives this behavior through its SDK dependency.

  Add Chat conversation creation/discovery, metadata and ordered entry reads,
  immutable messages with typed references, participant changes, and administrator
  deletion through SDK methods and the CLI `chat` command group. Require explicit
  operation identities for duplicate-safe mutations and retain lossless sequence
  strings. Chat requires compatible server activation; reading entries never
  acknowledges Notifications implicitly.

## 0.5.0

### Minor Changes

- Add notification endpoint registration, listing, inspection, queued tests, and removal with explicit account targeting and cancellation. Standard secrets are returned once; customer tokens are never returned. Requires a server with notification endpoint management enabled. Client publication and application activation remain independent.

  The CLI adds `notifications endpoints register --file`, `list`, `inspect`, `test`, and `remove`. Registration reads bounded JSON from a file or stdin; bearer tokens are never printed in successful output.

  Tests return an acceptance receipt before worker delivery and may start a real receiver run even with no unread items. Inspect endpoint diagnostics for the result; tests do not acknowledge notifications or change automatic coverage or backoff.

- Add account notification list, status, and explicit read acknowledgement. The CLI includes wait/watch with in-memory positions and bounded polling backoff. Requires a Notifications-enabled server; application activation and client publication remain independent.
- Add `openBillingCheckout`, `openBillingPortal`, and `getBillingSummary` for direct hosted billing navigation and current subscription presentation. Existing billing status, purchase, payment, command, and invoice methods retain their contracts. Hosted navigation requires enabled server capabilities; redirect URLs are sensitive and must not be logged or persisted.

## 0.4.1

### Patch Changes

- Document API error handling, CLI diagnostics, and safe recovery after interrupted requests in the published package READMEs.

## 0.4.0

### Minor Changes

- Replace agent-mediated ownership confirmation with a private email link that
  the nominated human reviews and explicitly accepts in the dashboard.

  Breaking: the SDK removes `confirmOwnership(apiKey, input)` and adds
  `previewOwnership(input)` and `acceptOwnership(input)` for the human browser
  flow. Acceptance creates the human session through cookies; it never returns a
  session token in JSON. The CLI's `confirm-ownership` command now immediately
  reports its retirement without reading stdin or using saved credentials.
  Agents should request a new ownership email and use authenticated account
  status to discover completion. Never request the human's private link.

- Add portable human invitation link creation and parsing helpers and a human-only
  preview operation with proof-gated pending and terminal statuses. Preserve legacy
  invitation files and the existing shared preview operation.

  Expose validated Retry-After response delays as retryAfterSeconds on SDK errors
  so clients can honor server throttling without inspecting raw responses.

  Add a current-administrator notification-status read with a strict safe projection
  that distinguishes queue/retry/provider acceptance from inbox delivery.

- Add authenticated discovery of the owner's pending login-email change and opt-in confirmation status views for owner email changes and workplace deletion. Preserve existing private receipt methods and response shapes.

### Patch Changes

- Allow `AgentWorkplace` and `DocumentationClient` to be constructed without options, defaulting to the official production API and documentation URLs. Preserve explicit base URL overrides, custom transports, URL validation and Files transfer protections.

## 0.3.2

### Patch Changes

- Clarify the public README paths from installation to existing-account access or new workplace setup, and link directly to current documentation routes.

## 0.3.1

### Patch Changes

- Validate the protected SDK and CLI release and npm trusted-publishing path. This release does not change customer-facing behavior.

## 0.3.0

### Minor Changes

- Add private feedback submission through the SDK, with stable retry receipts and optional category and request ID.

## 0.2.0

### Minor Changes

- Add a separate anonymous documentation client for the public index, search, and Markdown routes.
- Allow invitation lists to request only pending, unexpired invitations with an optional `state: "pending"` filter. Lists without the filter retain their existing behavior.

## 0.1.1

### Patch Changes

- Point the TypeScript SDK to its standalone source repository and align its
  package notices, documentation and trusted publication with that repository.

## 0.1.0

### Minor Changes

- Prepare the first public SDK and CLI prereleases for the accepted Agent Workplace MVP.

## 0.1.0-alpha.0

### Minor Changes

- Prepare the first public SDK and CLI prereleases for the accepted Agent Workplace MVP.
