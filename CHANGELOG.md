# Changelog

## [0.20.0] - 2026-04-03

### Fork & Rebrand

- Forked from [MCP Inspector](https://github.com/modelcontextprotocol/inspector) and rebranded as **MCP Detector** (`@skyflowfoundry/mcp-detector`)
- Removed the CLI package (`cli/`) — the tool is now browser-only
- Removed STDIO and SSE transports; only **Streamable HTTP** is supported

### Added

- **Skyflow Detect API integration** — scans MCP messages for PII, PHI, and financial data in real time
- **Detection engine** (`server/src/detectEngine.ts`) with three operating modes:
  - **Log** — forward immediately, detect async, emit results via SSE
  - **Warn** — same as Log with elevated severity
  - **Error** — detect first, block messages containing PII (fail-closed)
- **Skyflow HTTP client** (`server/src/skyflowClient.ts`) with retry logic for calling the Detect API
- **Per-field detection** — each in-scope field is scanned individually rather than concatenated, preserving field-level attribution
- **Opt-in method scanning** — only configured JSON-RPC methods (e.g. `tools/call`, `sampling/createMessage`) are scanned; all others pass through
- **Configurable entity types** — UI allows selecting which PII entity types to detect
- **Detect tab** (`client/src/components/DetectTab.tsx`) — real-time dashboard with:
  - Aggregate stats panel with proportion bar (clean vs. sensitive)
  - Per-entity-type breakdown with counts
  - Expandable sensitive message list with inline detail
- **Skyflow config panel** (`client/src/components/SkyflowConfig.tsx`) — credential input for Cluster ID, Vault ID, and Bearer Token (stored in `sessionStorage`)
- **Mode selector** (`client/src/components/ModeSelector.tsx`) — Log / Warn / Error toggle
- **Scan methods config** (`client/src/components/ScanMethodsConfig.tsx`) — opt-in method selector
- **Detection hook** (`client/src/lib/hooks/useDetection.ts`) — SSE-based state management for detection events and aggregate stats
- **SSE endpoint** (`/detect-events/{sessionId}`) for streaming detection results to the browser
- **Shared types** (`server/src/types.ts`) — detection types, header extraction helpers, credential interfaces

### Deployment

- Added **Vercel** support (`vercel.json`, `api/[...path].ts` catch-all serverless entry point)
- Proxy auth via `MCP_PROXY_AUTH_TOKEN` env var (or auto-generated); skippable with `DANGEROUSLY_OMIT_AUTH=true` for hosted deployments
