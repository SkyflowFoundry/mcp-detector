# Detection Modes

MCP Detector intercepts MCP traffic between a client and a remote MCP server, scanning each JSON-RPC message for sensitive data (PII, PHI, financial identifiers) via the [Skyflow Detect API](https://docs.skyflow.com). The **detection mode** controls whether scanning happens in the background or on the critical path, and what happens when PII is found.

## Overview

| Mode         | Blocking? | Severity | What happens when PII is found                                                                                                                                                                                                        |
| ------------ | --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Log**      | No        | `info`   | Message is forwarded immediately. Detection runs async. Results are streamed to the UI.                                                                                                                                               |
| **Warn**     | No        | `warn`   | Identical to Log, but events carry `severity: "warn"` so they can be visually distinguished.                                                                                                                                          |
| **Error**    | **Yes**   | `error`  | Message is **held** until detection completes. If PII is found, the message is **blocked** and a JSON-RPC error is returned. If the Skyflow API is unreachable, the message is also blocked (fail-closed).                            |
| **Tokenize** | **Yes**   | `warn`   | Message is **held** until detection completes. If PII is found, each PII value is **replaced with its Skyflow token** and the modified message is forwarded. If the Skyflow API is unreachable, the message is blocked (fail-closed). |

All four modes scan **both directions**: client-to-server and server-to-client messages.

---

## How the mode is selected

1. The user picks a mode in the **ModeSelector** UI component (sidebar). The selection is stored in React state (`detectionMode`).
2. When the user clicks **Connect**, the mode is sent as the `X-Detection-Mode` HTTP header on the initial `POST /mcp` request that creates the session.
3. The Express server extracts the mode via `extractDetectionMode()` from request headers (`server/src/types.ts`). If the header is missing or invalid, it defaults to `"log"`.
4. The mode is **locked for the lifetime of the MCP session**. Changing the mode requires disconnecting and reconnecting.

> **Important**: Detection headers (including the mode) are captured once at connection time from `getDetectionHeaders()` and baked into the proxy's custom `fetch` function. They cannot be changed mid-session.

### Mode change while connected

If the user selects a different mode while a session is active, a **confirmation dialog** appears explaining that the mode change requires reconnection. If confirmed, the UI:

1. Updates the `detectionMode` state to the new value.
2. Disconnects the current session.
3. Automatically reconnects once the disconnect completes (via a `useEffect` that watches for `reconnecting && connectionStatus === "disconnected"`).

If the user cancels the dialog, nothing changes. When no session is active (disconnected), mode changes apply immediately without a dialog.

---

## Detailed mode behavior

### Log mode

```
Client ──msg──▶ Proxy ──msg──▶ MCP Server
                  │
                  └──async──▶ Skyflow Detect API
                                    │
                                    ▼
                              DetectionEvent (severity: "info")
                                    │
                                    ▼ (SSE)
                               Browser UI
```

**Proxy behavior:**

- The message is forwarded to the destination transport **immediately** via `transportToServer.send()` / `transportToClient.send()`.
- If the message contains any text content, `detectAndEmit()` fires a **fire-and-forget** call to the Skyflow Detect API.
- On success, a `DetectionEvent` is emitted (with `blocked: false`, `severity: "info"`) to all SSE listeners for the session.
- On API failure, the error is logged to the server console. The message was already forwarded, so there is **no impact on MCP traffic**.

**Skyflow API calls:** One `POST /v1/detect/deidentify/string` call per message that contains non-empty text. The call happens in the background and does not delay message delivery.

**Events emitted:** One `DetectionEvent` per scanned message, regardless of whether PII was found. This allows the Detect tab to track total scanned, clean, and detected counts.

**Use case:** Passive monitoring and auditing. Good for initial exploration or when you want visibility without any risk of disrupting the MCP connection.

---

### Warn mode

Warn mode is **functionally identical to Log mode** in terms of proxy behavior and Skyflow API interaction. The only difference is the `severity` field on emitted events:

|                    | Log             | Warn            |
| ------------------ | --------------- | --------------- |
| Message forwarding | Immediate       | Immediate       |
| Detection timing   | Async           | Async           |
| Blocks messages?   | No              | No              |
| Event severity     | `"info"`        | `"warn"`        |
| Fail behavior      | Silent (logged) | Silent (logged) |

**Use case:** Same as Log, but provides a stronger visual signal in the Detect tab. Useful when you want to flag potential issues more prominently without blocking traffic.

---

### Error mode

```
Client ──msg──▶ Proxy ──hold──▶ Skyflow Detect API
                  │                     │
                  │              ┌──────┴──────┐
                  │              │             │
                  │          PII found    No PII found
                  │              │             │
                  │              ▼             ▼
                  │         BLOCKED       FORWARDED
                  │         (JSON-RPC      to MCP
                  │          error)        Server
                  │              │
                  ▼              ▼
              DetectionEvent  DetectionEvent
            (blocked: true)  (blocked: false)
                  │
                  ▼ (SSE)
             Browser UI
```

**Proxy behavior:**

- The message is **not forwarded** until the Skyflow Detect API responds.
- The extracted text is sent to `detectPii()`, which calls the Skyflow API synchronously (from the proxy's perspective).
- **If PII is detected** (`result.hasPii === true`):
  - The message is **blocked** — it is never forwarded to the destination.
  - A `DetectionEvent` with `blocked: true` and `severity: "error"` is emitted via SSE.
  - If the message was a JSON-RPC **request** (has an `id` field) traveling client-to-server, a JSON-RPC error response is sent back to the client:
    ```json
    {
      "jsonrpc": "2.0",
      "id": "<original-request-id>",
      "error": {
        "code": -32001,
        "message": "Message blocked: 3 PII entities detected",
        "data": { "reason": "pii_detected", "entityCount": 3 }
      }
    }
    ```
  - For server-to-client messages, the message is silently dropped (no error response is sent back to the MCP server).
- **If no PII is detected** (`result.hasPii === false`):
  - The message is forwarded normally.
  - A clean `DetectionEvent` is emitted (not blocked).
- **If the Skyflow API call fails** (network error, timeout, 5xx):
  - **Fail-closed**: the message is **blocked**, even though no PII was confirmed.
  - A `DetectionEvent` with `blocked: true` is emitted.
  - If the message was a client-to-server request with an `id`, a different JSON-RPC error is returned:
    ```json
    {
      "jsonrpc": "2.0",
      "id": "<original-request-id>",
      "error": {
        "code": -32002,
        "message": "PII detection service unavailable: <error-detail>",
        "data": { "reason": "detection_service_unavailable" }
      }
    }
    ```
- **If the message has no text content** (empty or whitespace-only after extraction):
  - The message is forwarded immediately with no API call.

**Skyflow API calls:** One synchronous `POST /v1/detect/deidentify/string` call per message with text content. The call is **on the critical path** — message delivery is delayed by the API round-trip time (typically 100-500ms, up to the 10s timeout).

**Events emitted:** One `DetectionEvent` per scanned message. Blocked events have `blocked: true`.

**Use case:** Enforcement mode for production or compliance-sensitive environments. Prevents any PII from leaking through the MCP connection. Be aware this adds latency to every message.

---

### Tokenize mode

```
Client ──msg──▶ Proxy ──hold──▶ Skyflow Detect API
                  │                     │
                  │              ┌──────┴──────┐
                  │              │             │
                  │          PII found    No PII found
                  │              │             │
                  │              ▼             ▼
                  │         TOKENIZED      FORWARDED
                  │         (PII values    unchanged
                  │          replaced       to MCP
                  │          with tokens)   Server
                  │              │
                  │              ▼
                  │         FORWARDED
                  │         (modified msg)
                  │              │
                  ▼              ▼
              DetectionEvent  DetectionEvent
           (tokenized: true) (tokenized: false)
                  │
                  ▼ (SSE)
             Browser UI
```

**Proxy behavior:**

- The message is **not forwarded** until the Skyflow Detect API responds (synchronous, same as Error mode).
- The extracted text is sent to `detectPii()`, which calls the Skyflow API.
- **If PII is detected** (`result.hasPii === true`):
  - The message is **tokenized**: each PII value is replaced with its corresponding Skyflow token in the JSON-RPC message.
  - The modified message is **forwarded** to the destination (unlike Error mode, which blocks).
  - A `DetectionEvent` with `tokenized: true` and `severity: "warn"` is emitted via SSE.
  - Tokenization strategy: the JSON-RPC message is serialized to a string, entities are sorted longest-value-first (to prevent partial matches), each value is replaced with its token using `split().join()`, and the result is parsed back to JSON. Values are JSON-escaped for safe replacement in the serialized context.
  - If the tokenized string fails to parse back to valid JSON, the **original message is forwarded unchanged** (fail-open on parse error only).
- **If no PII is detected** (`result.hasPii === false`):
  - The message is forwarded unchanged.
  - A clean `DetectionEvent` is emitted (`tokenized: false`).
- **If the Skyflow API call fails** (network error, timeout, 5xx):
  - **Fail-closed**: the message is **blocked**, same as Error mode.
  - A `DetectionEvent` with `blocked: true` is emitted.
  - If the message was a client-to-server request with an `id`, a JSON-RPC error is returned:
    ```json
    {
      "jsonrpc": "2.0",
      "id": "<original-request-id>",
      "error": {
        "code": -32002,
        "message": "PII detection service unavailable: <error-detail>",
        "data": { "reason": "detection_service_unavailable" }
      }
    }
    ```
  - For server-to-client messages, the message is silently dropped.
- **If the message has no text content** (empty or whitespace-only after extraction):
  - The message is forwarded immediately with no API call.

**Skyflow API calls:** One synchronous `POST /v1/detect/deidentify/string` call per message with text content. The call is **on the critical path** — same latency characteristics as Error mode.

**Events emitted:** One `DetectionEvent` per scanned message. Tokenized events have `tokenized: true`.

**Use case:** Data protection without disruption. PII is neutralized by replacing it with opaque tokens before it reaches the MCP server, but the message structure and flow are preserved. Ideal when you need PII protection but can't afford to block messages entirely.

---

## How text is extracted from messages

The `extractTextFromMessage()` function in `server/src/detectEngine.ts` recursively walks the entire JSON-RPC message object and collects all string values. These strings are concatenated with newline separators and sent as a single text blob to the Skyflow Detect API.

This means **all** string content in the message is scanned — including method names, parameter keys, tool names, resource URIs, etc. — not just user-facing content.

---

## Skyflow Detect API integration

Each detection call goes to:

```
POST https://{clusterId}.vault.skyflowapis.com/v1/detect/deidentify/string
```

**Request body:**

```json
{
  "text": "<concatenated message text>",
  "vault_id": "<vault-id>",
  "token_type": {
    "default": "entity_unq_counter"
  }
}
```

**Retry logic** (`server/src/skyflowClient.ts`):

- Up to 2 retries (3 total attempts) with exponential backoff (200ms, 400ms).
- **Retryable**: 5xx server errors, timeouts, network errors.
- **Non-retryable**: 4xx client errors (bad credentials, invalid vault, etc.) — these fail immediately.
- Timeout: 10 seconds per attempt.

**Response** (`SkyflowDeidentifyResponse`):

- `processed_text`: The deidentified version with tokens replacing sensitive values.
- `entities[]`: Each detected entity with type, value, location offsets, and confidence scores.

---

## SSE event delivery

Detection events are streamed from server to client via Server-Sent Events:

1. When a session is created, the client opens an `EventSource` to `GET /detect-events/{sessionId}`.
2. Authentication uses a `?token=` query parameter (since `EventSource` cannot set custom headers).
3. The server registers the response object in `detectEventListeners` and keeps the connection alive with 30-second heartbeats.
4. When `detectEngine` calls `emitEvent()`, the event is serialized to JSON and written to all registered SSE listeners for that session.
5. The client's `useDetection` hook parses incoming events and updates `detectionEvents[]` and `aggregateStats`.

---

## Client-side state management

The `useDetection` hook (`client/src/lib/hooks/useDetection.ts`) maintains:

| State              | Description                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `detectionMode`    | Current mode selection (`"log"`, `"warn"`, `"error"`, `"tokenize"`)                           |
| `skyflowConfig`    | Cluster ID, Bearer Token, Vault ID (stored in `sessionStorage`)                               |
| `validationStatus` | Credential validation state (`unconfigured` / `validating` / `valid` / `invalid`)             |
| `detectionEvents`  | Array of all received `DetectionEvent` objects (newest first)                                 |
| `aggregateStats`   | Running totals: scanned, detected, blocked, tokenized, clean, by-type breakdown, by-direction |

The `getDetectionHeaders()` function returns the headers that get merged into the proxy connection:

```
X-Skyflow-Cluster-Id: <cluster-id>
X-Skyflow-Bearer-Token: <bearer-token>
X-Skyflow-Vault-Id: <vault-id>
X-Detection-Mode: <log|warn|error|tokenize>
```

These headers are passed as `extraProxyHeaders` to `useConnection`, where they are merged into every HTTP request the MCP SDK makes to the proxy.

---

## Header lifecycle

```
┌─────────────────┐
│   UI: User sets  │
│   Skyflow creds  │  ──▶  sessionStorage
│   + picks mode   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ getDetection-    │
│ Headers()        │  ──▶  { X-Skyflow-*, X-Detection-Mode }
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ useConnection    │
│ extraProxyHeaders│  ──▶  Baked into custom fetch at connect time
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  POST /mcp       │  ──▶  Express extracts creds + mode
│  (initial)       │       Passes to mcpProxy → detectEngine
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Proxy strips     │
│ X-Skyflow-* and  │  ──▶  NOT forwarded to remote MCP server
│ X-Detection-Mode │
└─────────────────┘
```

The Skyflow credentials and detection mode headers are **consumed by the proxy** and explicitly stripped in `getHttpHeaders()` before any headers are forwarded to the remote MCP server.

---

## JSON-RPC error codes

| Code     | Meaning                       | When                                                          |
| -------- | ----------------------------- | ------------------------------------------------------------- |
| `-32001` | PII detected, message blocked | Error mode, PII found in message                              |
| `-32002` | Detection service unavailable | Error or Tokenize mode, Skyflow API unreachable (fail-closed) |

These error codes are only produced in **Error** and **Tokenize** modes. Log and Warn modes never generate JSON-RPC errors. Note that `-32001` is exclusive to Error mode (Tokenize mode forwards tokenized messages rather than blocking), while `-32002` applies to both Error and Tokenize modes (both are fail-closed on API failure).

---

## Summary: choosing a mode

| Consideration               | Log                        | Warn                       | Error                            | Tokenize                           |
| --------------------------- | -------------------------- | -------------------------- | -------------------------------- | ---------------------------------- |
| **Latency impact**          | None                       | None                       | +100-500ms per message           | +100-500ms per message             |
| **Traffic disruption risk** | None                       | None                       | Messages may be blocked          | PII values replaced with tokens    |
| **API failure impact**      | None (fire-and-forget)     | None (fire-and-forget)     | Blocks all traffic (fail-closed) | Blocks all traffic (fail-closed)   |
| **Visibility**              | Full (all events streamed) | Full (all events streamed) | Full (all events streamed)       | Full (all events streamed)         |
| **PII prevention**          | No                         | No                         | Yes (blocks)                     | Yes (tokenizes)                    |
| **Message flow preserved**  | Yes                        | Yes                        | No (blocked on PII)              | Yes (modified on PII)              |
| **Best for**                | Development, auditing      | Awareness, flagging        | Compliance, enforcement          | Data protection without disruption |
