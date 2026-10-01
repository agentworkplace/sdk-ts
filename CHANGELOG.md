# @agent-workplace/sdk

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
