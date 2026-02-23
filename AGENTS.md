# MCP Detector Development Guide

MCP Detector is a PII-aware MCP traffic inspection tool, forked from MCP Inspector. It adds Skyflow Detect API integration to scan MCP messages for sensitive data (PII/PHI/financial) with three operating modes.

## Build Commands

- Build all: `npm run build`
- Build client: `npm run build-client`
- Build server: `npm run build-server`
- Development mode: `npm run dev` (use `npm run dev:windows` on Windows)
- Format code: `npm run prettier-fix`
- Client lint: `cd client && npm run lint`

## Architecture

### Monorepo Structure

- `client/`: React frontend with Vite, TypeScript and Tailwind
- `server/`: Express backend with TypeScript
- `api/`: Vercel serverless entry point (`[...path].ts` catch-all that re-exports the Express app)

### Transport

Only **Streamable HTTP** transport is supported (STDIO and SSE were removed). The server acts as a proxy: browser ↔ Express proxy ↔ remote MCP server.

### Detection Pipeline

```
Browser → POST /mcp (with X-Skyflow-* headers) → Express proxy
  → mcpProxy wraps transports with detectEngine
  → Messages forwarded to/from remote MCP server
  → Each message scanned via Skyflow Detect API
  → Detection events emitted via SSE to /detect-events/{sessionId}
  → Client EventSource receives events → Detect tab updates
```

Key server files:

- `server/src/index.ts` — Express app, routes, session management, SSE endpoint
- `server/src/mcpProxy.ts` — Proxy between client and server transports, optional detection wrapping
- `server/src/detectEngine.ts` — Three-mode detection orchestrator (log/warn/error)
- `server/src/skyflowClient.ts` — HTTP client for Skyflow Detect API with retry logic
- `server/src/types.ts` — Shared types, header extraction helpers

Key client files:

- `client/src/App.tsx` — Main app, hooks wiring, tab layout
- `client/src/lib/hooks/useDetection.ts` — Detection state management, SSE connection, aggregate stats
- `client/src/lib/hooks/useConnection.ts` — MCP connection lifecycle, proxy header merging
- `client/src/components/DetectTab.tsx` — Detection dashboard (stats panel with proportion bar, entity breakdown, sensitive messages list with inline detail expand)
- `client/src/components/SkyflowConfig.tsx` — Credential input panel
- `client/src/components/ModeSelector.tsx` — Log/Warn/Error mode selector

## Detection Modes

| Mode      | Behavior                                                                                                              | Blocking? |
| --------- | --------------------------------------------------------------------------------------------------------------------- | --------- |
| **Log**   | Forward message immediately, detect PII async, emit results via SSE                                                   | No        |
| **Warn**  | Same as Log but events have severity: "warn"                                                                          | No        |
| **Error** | Detect PII first, block if found (JSON-RPC error -32001), forward only if clean. Fail-closed on API failure (-32002). | Yes       |

## Authentication

### Proxy Auth (browser ↔ proxy)

- Token generated at startup or set via `MCP_PROXY_AUTH_TOKEN` env var
- Sent as `X-MCP-Proxy-Auth: Bearer <token>` header on all requests
- SSE endpoints (`/detect-events/{sessionId}`) use `?token=<token>` query param since EventSource can't set custom headers
- Disabled entirely with `DANGEROUSLY_OMIT_AUTH=true`

### Skyflow Credentials (entered in UI, per-request relay)

- Cluster ID, Vault ID, Bearer Token — entered in sidebar, stored in `sessionStorage`
- Sent as `X-Skyflow-Cluster-Id`, `X-Skyflow-Bearer-Token`, `X-Skyflow-Vault-Id` headers
- Stripped by the proxy before forwarding to the remote MCP server (see `getHttpHeaders()`)
- Detection mode sent as `X-Detection-Mode` header
- **Must be configured before clicking Connect** (headers are baked into the connection)

### MCP Server Auth (proxy ↔ remote server)

- OAuth2/PKCE supported via custom headers and `x-custom-auth-headers`
- Forwarded headers: `mcp-*`, `authorization`, `last-event-id`

## Environment Variables

| Variable                | Default                          | Purpose                           |
| ----------------------- | -------------------------------- | --------------------------------- |
| `MCP_PROXY_AUTH_TOKEN`  | Random 32-byte hex               | Auth token for proxy              |
| `DANGEROUSLY_OMIT_AUTH` | `false`                          | Skip auth (for Vercel or testing) |
| `SERVER_PORT`           | `6277`                           | Server listen port                |
| `CLIENT_PORT`           | `6274`                           | Vite dev server port              |
| `ALLOWED_ORIGINS`       | `http://localhost:{CLIENT_PORT}` | Comma-separated allowed origins   |

## Vercel Deployment

Configured via `vercel.json`:

- Build: `npm run build`, output: `client/dist`
- API functions: 300s max duration (requires Pro plan)
- Rewrites: `/api/*` → serverless functions, `/*` → SPA fallback
- Auto-allows `*.vercel.app` origins
- Set `DANGEROUSLY_OMIT_AUTH=true` on Vercel (no console for token)

## Code Style Guidelines

- Use TypeScript with proper type annotations
- Follow React functional component patterns with hooks
- Use ES modules (import/export) not CommonJS
- Use Prettier for formatting (auto-formatted on commit)
- Follow existing naming conventions:
  - camelCase for variables and functions
  - PascalCase for component names and types
  - kebab-case for file names
- Use async/await for asynchronous operations
- Implement proper error handling with try/catch blocks
- Use Tailwind CSS for styling in the client
- Keep components small and focused on a single responsibility

## Known Patterns / Gotchas

- **Header merging in proxy mode**: The custom fetch in `useConnection.ts` must merge SDK headers with proxy headers (not replace). The SDK sets `accept` and `content-type` which are required by the MCP spec.
- **Deferred session ID**: Detection options use a getter (`get sessionId()`) because the session ID isn't known until `onsessioninitialized` fires.
- **EventSource auth**: Browser's `EventSource` API can't set custom headers. The `/detect-events` SSE endpoint accepts auth via `?token=` query param instead.
- **Detection header lifecycle**: Skyflow headers are captured once at connection time from `getDetectionHeaders()`. Changing creds mid-session requires reconnecting.
