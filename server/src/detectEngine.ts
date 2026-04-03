/**
 * Detection engine that wraps MCP proxy message handlers with
 * Skyflow Detect API integration. Supports four modes:
 *
 * - log:      Forward immediately, detect async, emit results
 * - warn:     Same as log but with severity: "warn"
 * - error:    Detect first, block if PII found, forward only if clean
 * - tokenize: Detect first, replace PII with Skyflow tokens, then forward
 */

import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { deidentifyText, SkyflowClientError } from "./skyflowClient.js";
import { randomUUID } from "node:crypto";
import type {
  DetectionMode,
  DetectionDirection,
  DetectionEvent,
  DetectionResult,
  SkyflowCredentials,
  SkyflowEntity,
} from "./types.js";

export type DetectionEventEmitter = (event: DetectionEvent) => void;

interface DetectionOptions {
  sessionId: string;
  mode: DetectionMode;
  credentials: SkyflowCredentials;
  emitEvent: DetectionEventEmitter;
  allowedMethods?: Set<string>;
  entityTypes?: string[];
  tokenType?: string;
}

/**
 * Recursively collects all string values from an object tree.
 */
function collectStrings(obj: unknown, parts: string[]): void {
  if (typeof obj === "string") {
    parts.push(obj);
  } else if (Array.isArray(obj)) {
    for (const item of obj) {
      collectStrings(item, parts);
    }
  } else if (obj !== null && typeof obj === "object") {
    for (const value of Object.values(obj)) {
      collectStrings(value, parts);
    }
  }
}

/**
 * MCP methods whose payloads may contain user PII, and the specific
 * sub-fields within params/result to extract for scanning.
 * Messages NOT in this map are forwarded without detection.
 */
const SCAN_METHODS: Record<string, { params?: string[]; result?: string[] }> = {
  "tools/call": {
    params: ["arguments"],
    result: ["content", "structuredContent"],
  },
  "sampling/createMessage": {
    params: ["messages", "systemPrompt"],
    result: ["content", "structuredContent"],
  },
  "prompts/get": {
    params: ["arguments"],
    result: ["messages"],
  },
  "resources/read": {
    result: ["contents"],
  },
  "completion/complete": {
    params: ["argument"],
    result: ["completion"],
  },
  "elicitation/create": {
    params: ["message"],
    result: ["content"],
  },
  "notifications/message": {
    params: ["data"],
  },
};

/**
 * Extracts scannable text from a JSON-RPC message using the opt-in SCAN_METHODS map.
 * Only walks sub-fields listed in the scan config for the given method.
 * Returns "" for methods not in the map (they are forwarded without detection).
 */
function extractTextForMethod(
  message: JSONRPCMessage,
  method: string | null,
  allowedMethods?: Set<string> | null,
): string {
  if (!method) return "";
  if (allowedMethods && !allowedMethods.has(method)) return "";
  const scanConfig = SCAN_METHODS[method];
  if (!scanConfig) return "";

  const parts: string[] = [];
  const msg = message as Record<string, unknown>;

  if (scanConfig.params && msg.params) {
    const params = msg.params as Record<string, unknown>;
    for (const field of scanConfig.params) {
      if (params[field] !== undefined) {
        collectStrings(params[field], parts);
      }
    }
  }

  if (scanConfig.result && msg.result) {
    const result = msg.result as Record<string, unknown>;
    for (const field of scanConfig.result) {
      if (result[field] !== undefined) {
        collectStrings(result[field], parts);
      }
    }
  }

  return parts.join("\n");
}

/**
 * Runs PII detection on the given text and returns a DetectionResult.
 */
async function detectPii(
  text: string,
  credentials: SkyflowCredentials,
  entityTypes?: string[],
  tokenType?: string,
): Promise<DetectionResult> {
  if (!text.trim()) {
    return {
      entities: [],
      originalText: text,
      processedText: text,
      hasPii: false,
      entityCount: 0,
    };
  }

  const response = await deidentifyText(
    text,
    credentials,
    undefined,
    entityTypes,
    tokenType,
  );
  return {
    entities: response.entities,
    originalText: text,
    processedText: response.processed_text,
    hasPii: response.entities.length > 0,
    entityCount: response.entities.length,
  };
}

/**
 * Creates a DetectionEvent from a detection result.
 */
function createEvent(
  sessionId: string,
  direction: DetectionDirection,
  result: DetectionResult,
  blocked: boolean,
  mode: DetectionMode,
  tokenized?: boolean,
  method?: string | null,
): DetectionEvent {
  return {
    id: randomUUID(),
    sessionId,
    timestamp: new Date().toISOString(),
    direction,
    result,
    blocked,
    severity:
      mode === "error"
        ? "error"
        : mode === "warn" || mode === "tokenize"
          ? "warn"
          : "info",
    mode,
    ...(tokenized !== undefined ? { tokenized } : {}),
    ...(method ? { method } : {}),
  };
}

/**
 * Creates a JSON-RPC error response for blocked messages (error mode).
 */
function createPiiBlockedError(
  messageId: string | number,
  entityCount: number,
): JSONRPCMessage {
  return {
    jsonrpc: "2.0",
    id: messageId,
    error: {
      code: -32001,
      message: `Message blocked: ${entityCount} PII entit${entityCount === 1 ? "y" : "ies"} detected`,
      data: { reason: "pii_detected", entityCount },
    },
  } as unknown as JSONRPCMessage;
}

/**
 * Creates a JSON-RPC error response when Skyflow API is unavailable (fail-closed in error mode).
 */
function createServiceUnavailableError(
  messageId: string | number,
  errorMessage: string,
): JSONRPCMessage {
  return {
    jsonrpc: "2.0",
    id: messageId,
    error: {
      code: -32002,
      message: `PII detection service unavailable: ${errorMessage}`,
      data: { reason: "detection_service_unavailable" },
    },
  } as unknown as JSONRPCMessage;
}

/**
 * Extracts the MCP method name from a JSON-RPC message.
 * Requests and notifications have a `method` field directly.
 * Returns null for responses (which lack `method`).
 */
function getMethod(message: JSONRPCMessage): string | null {
  const msg = message as Record<string, unknown>;
  return typeof msg.method === "string" ? msg.method : null;
}

/**
 * Wraps MCP proxy transports with detection logic based on the configured mode.
 *
 * Uses an opt-in approach: only MCP methods listed in SCAN_METHODS are scanned.
 * Messages for unlisted methods (protocol handshakes, tools/list, resources/list, etc.)
 * are forwarded immediately without any Skyflow API calls.
 *
 * For log/warn mode: Messages are forwarded immediately; detection runs async.
 * For error mode: Messages are held until detection completes; blocked if PII found.
 * For tokenize mode: Messages are held until detection completes; PII replaced with tokens before forwarding.
 */
export function wrapWithDetection(
  transportToClient: Transport,
  transportToServer: Transport,
  options: DetectionOptions,
): {
  wrappedClientHandler: (message: JSONRPCMessage) => void;
  wrappedServerHandler: (message: JSONRPCMessage) => void;
} {
  const {
    sessionId,
    mode,
    credentials,
    emitEvent,
    allowedMethods,
    entityTypes,
    tokenType,
  } = options;

  // Track request IDs → method names so we can look up the method for responses.
  // Responses don't have a `method` field, so we correlate by request ID.
  const pendingRequestMethods = new Map<string | number, string>();

  const wrappedClientHandler = (message: JSONRPCMessage) => {
    const direction: DetectionDirection = "client-to-server";
    const method = getMethod(message);

    // Track request ID → method for response correlation
    const msgId = (message as Record<string, unknown>).id;
    if (method && msgId !== undefined) {
      pendingRequestMethods.set(msgId as string | number, method);
    }

    const text = extractTextForMethod(message, method, allowedMethods);

    console.log(
      `[Detect] Client request received (method=${method}, id=${msgId}, hasText=${!!text.trim()})`,
    );

    // Not an opt-in method or no scannable content → forward immediately
    if (!text.trim()) {
      transportToServer.send(message).catch((error) => {
        console.error("Error forwarding to server:", error);
      });

      return;
    }

    if (mode === "error") {
      handleErrorMode(
        message,
        text,
        direction,
        transportToServer,
        transportToClient,
        sessionId,
        credentials,
        emitEvent,
        method,
        entityTypes,
        tokenType,
      );
    } else if (mode === "tokenize") {
      handleTokenizeMode(
        message,
        text,
        direction,
        transportToServer,
        transportToClient,
        sessionId,
        credentials,
        emitEvent,
        method,
        entityTypes,
        tokenType,
      );
    } else {
      // Log/Warn mode: forward immediately, detect async
      transportToServer.send(message).catch((error) => {
        console.error("Error forwarding to server:", error);
      });

      detectAndEmit(
        text,
        direction,
        sessionId,
        mode,
        credentials,
        emitEvent,
        method,
        entityTypes,
        tokenType,
      );
    }
  };

  const wrappedServerHandler = (message: JSONRPCMessage) => {
    const direction: DetectionDirection = "server-to-client";
    const msg = message as Record<string, unknown>;

    // For responses, look up the method from the original request
    let method = getMethod(message);
    if (!method && msg.id !== undefined) {
      method = pendingRequestMethods.get(msg.id as string | number) ?? null;
      pendingRequestMethods.delete(msg.id as string | number);
    }

    const text = extractTextForMethod(message, method, allowedMethods);

    console.log(
      `[Detect] Server response received (method=${method}, id=${msg.id}, hasText=${!!text.trim()})`,
    );

    // Not an opt-in method or no scannable content → forward immediately
    if (!text.trim()) {
      transportToClient.send(message).catch((error) => {
        console.error("Error forwarding to client:", error);
      });

      return;
    }

    if (mode === "error") {
      handleErrorMode(
        message,
        text,
        direction,
        transportToClient,
        null, // no error response target for server→client
        sessionId,
        credentials,
        emitEvent,
        method,
        entityTypes,
        tokenType,
      );
    } else if (mode === "tokenize") {
      handleTokenizeMode(
        message,
        text,
        direction,
        transportToClient,
        null, // no error response target for server→client
        sessionId,
        credentials,
        emitEvent,
        method,
        entityTypes,
        tokenType,
      );
    } else {
      // Log/Warn mode: forward immediately, detect async
      transportToClient.send(message).catch((error) => {
        console.error("Error forwarding to client:", error);
      });

      detectAndEmit(
        text,
        direction,
        sessionId,
        mode,
        credentials,
        emitEvent,
        method,
        entityTypes,
        tokenType,
      );
    }
  };

  return { wrappedClientHandler, wrappedServerHandler };
}

/**
 * Async fire-and-forget detection for log/warn modes.
 */
function detectAndEmit(
  text: string,
  direction: DetectionDirection,
  sessionId: string,
  mode: DetectionMode,
  credentials: SkyflowCredentials,
  emitEvent: DetectionEventEmitter,
  method?: string | null,
  entityTypes?: string[],
  tokenType?: string,
): void {
  detectPii(text, credentials, entityTypes, tokenType)
    .then((result) => {
      // Emit for all scanned messages so the Detect tab can track
      // total scanned, clean, and detected counts
      emitEvent(
        createEvent(
          sessionId,
          direction,
          result,
          false,
          mode,
          undefined,
          method,
        ),
      );
    })
    .catch((error) => {
      console.error(`Detection error (${mode} mode, non-blocking):`, error);
    });
}

/**
 * Accumulator for aggregating results across multiple deidentify calls.
 */
interface DeidentifyAccumulator {
  entities: SkyflowEntity[];
  originals: string[];
  processed: string[];
}

/**
 * Recursively walks a value and deidentifies every string leaf in place.
 * Each string gets its own Skyflow API call; the response's processed_text
 * replaces the original string directly — no manual find/replace needed.
 */
async function deidentifyStringsInPlace(
  obj: unknown,
  parent: Record<string, unknown> | unknown[],
  key: string | number,
  credentials: SkyflowCredentials,
  entityTypes: string[] | undefined,
  tokenType: string | undefined,
  acc: DeidentifyAccumulator,
): Promise<void> {
  if (typeof obj === "string") {
    if (!obj.trim()) return;
    const response = await deidentifyText(
      obj,
      credentials,
      undefined,
      entityTypes,
      tokenType,
    );
    (parent as Record<string | number, unknown>)[key] = response.processed_text;
    acc.entities.push(...response.entities);
    acc.originals.push(obj);
    acc.processed.push(response.processed_text);
  } else if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      await deidentifyStringsInPlace(
        obj[i],
        obj,
        i,
        credentials,
        entityTypes,
        tokenType,
        acc,
      );
    }
  } else if (obj !== null && typeof obj === "object") {
    for (const k of Object.keys(obj as Record<string, unknown>)) {
      await deidentifyStringsInPlace(
        (obj as Record<string, unknown>)[k],
        obj as Record<string, unknown>,
        k,
        credentials,
        entityTypes,
        tokenType,
        acc,
      );
    }
  }
}

/**
 * Deidentifies all string fields in a JSON-RPC message's scannable subtrees.
 * Makes one Skyflow API call per string leaf and uses processed_text directly.
 * Returns the modified message + aggregated DetectionResult, or null if the
 * method is not scannable.
 */
async function deidentifyMessageFields(
  message: JSONRPCMessage,
  method: string,
  credentials: SkyflowCredentials,
  allowedMethods?: Set<string> | null,
  entityTypes?: string[],
  tokenType?: string,
): Promise<{ message: JSONRPCMessage; result: DetectionResult } | null> {
  if (allowedMethods && !allowedMethods.has(method)) return null;
  const scanConfig = SCAN_METHODS[method];
  if (!scanConfig) return null;

  // Deep-clone so we can mutate safely
  const msg = JSON.parse(JSON.stringify(message)) as Record<string, unknown>;
  const acc: DeidentifyAccumulator = {
    entities: [],
    originals: [],
    processed: [],
  };

  if (scanConfig.params && msg.params) {
    const params = msg.params as Record<string, unknown>;
    for (const field of scanConfig.params) {
      if (params[field] !== undefined) {
        await deidentifyStringsInPlace(
          params[field],
          params,
          field,
          credentials,
          entityTypes,
          tokenType,
          acc,
        );
      }
    }
  }

  if (scanConfig.result && msg.result) {
    const result = msg.result as Record<string, unknown>;
    for (const field of scanConfig.result) {
      if (result[field] !== undefined) {
        await deidentifyStringsInPlace(
          result[field],
          result,
          field,
          credentials,
          entityTypes,
          tokenType,
          acc,
        );
      }
    }
  }

  return {
    message: msg as unknown as JSONRPCMessage,
    result: {
      entities: acc.entities,
      originalText: acc.originals.join("\n"),
      processedText: acc.processed.join("\n"),
      hasPii: acc.entities.length > 0,
      entityCount: acc.entities.length,
    },
  };
}

/**
 * Tokenize mode: deidentify each string field via Skyflow, replace with processed_text, then forward.
 * Fail-closed: if detection service is unavailable, message is blocked.
 */
function handleTokenizeMode(
  message: JSONRPCMessage,
  text: string,
  direction: DetectionDirection,
  forwardTo: Transport,
  errorResponseTo: Transport | null,
  sessionId: string,
  credentials: SkyflowCredentials,
  emitEvent: DetectionEventEmitter,
  method: string | null,
  entityTypes?: string[],
  tokenType?: string,
): void {
  if (!text.trim()) {
    forwardTo.send(message).catch((error) => {
      console.error("Error forwarding message:", error);
    });
    return;
  }

  const messageId = (message as any).id;

  console.log(
    `[Detect] Tokenize mode: scanning ${direction} message (method=${method}, id=${messageId})`,
  );

  deidentifyMessageFields(
    message,
    method!,
    credentials,
    null,
    entityTypes,
    tokenType,
  )
    .then((deidentified) => {
      if (!deidentified) {
        // Method not scannable (shouldn't happen — we checked text above)
        forwardTo.send(message).catch((error) => {
          console.error("Error forwarding message:", error);
        });
        return;
      }

      const { message: tokenizedMessage, result } = deidentified;

      emitEvent(
        createEvent(
          sessionId,
          direction,
          result,
          false,
          "tokenize",
          result.hasPii,
          method,
        ),
      );

      if (result.hasPii) {
        console.log(
          `[Detect] Forwarding tokenized message (direction=${direction}, method=${method}, id=${messageId}, entities=${result.entityCount})`,
        );
        forwardTo.send(tokenizedMessage).catch((error) => {
          console.error("Error forwarding tokenized message:", error);
        });
      } else {
        console.log(
          `[Detect] Forwarding clean message (direction=${direction}, method=${method}, id=${messageId})`,
        );
        forwardTo.send(message).catch((error) => {
          console.error("Error forwarding clean message:", error);
        });
      }
    })
    .catch((error) => {
      // Fail-closed: block message if detection service is unavailable
      console.error(
        "Detection service error (tokenize mode, fail-closed):",
        error,
      );
      console.log(
        `[Detect] Detection failed (tokenize, fail-closed): ${direction} message DROPPED (method=${method}, id=${messageId})`,
      );

      emitEvent(
        createEvent(
          sessionId,
          direction,
          {
            entities: [],
            originalText: text,
            processedText: "",
            hasPii: false,
            entityCount: 0,
          },
          true,
          "tokenize",
          false,
          method,
        ),
      );

      if (messageId !== undefined && errorResponseTo) {
        const errorMsg =
          error instanceof SkyflowClientError
            ? error.message
            : "Detection service unavailable";
        errorResponseTo
          .send(createServiceUnavailableError(messageId, errorMsg))
          .catch((err) =>
            console.error("Error sending service unavailable response:", err),
          );
      }
    });
}

/**
 * Synchronous detection for error mode. Blocks message if PII found.
 * Fail-closed: if detection service is unavailable, message is blocked.
 */
function handleErrorMode(
  message: JSONRPCMessage,
  text: string,
  direction: DetectionDirection,
  forwardTo: Transport,
  errorResponseTo: Transport | null,
  sessionId: string,
  credentials: SkyflowCredentials,
  emitEvent: DetectionEventEmitter,
  method: string | null,
  entityTypes?: string[],
  tokenType?: string,
): void {
  if (!text.trim()) {
    // No text to scan, forward immediately
    forwardTo.send(message).catch((error) => {
      console.error("Error forwarding message:", error);
    });
    return;
  }

  const messageId = (message as any).id;

  console.log(
    `[Detect] Error mode: scanning ${direction} message (method=${method}, id=${messageId})`,
  );

  detectPii(text, credentials, entityTypes, tokenType)
    .then((result) => {
      if (result.hasPii) {
        // Block the message
        emitEvent(
          createEvent(
            sessionId,
            direction,
            result,
            true,
            "error",
            undefined,
            method,
          ),
        );

        console.log(
          `[Detect] PII detected, BLOCKING ${direction} message (method=${method}, id=${messageId}, entities=${result.entityCount})`,
        );

        // Send error response back if this is a request with an ID and we have a target
        if (messageId !== undefined && errorResponseTo) {
          errorResponseTo
            .send(createPiiBlockedError(messageId, result.entityCount))
            .catch((err) =>
              console.error("Error sending PII blocked response:", err),
            );
        }
      } else {
        // Clean - forward the message
        console.log(
          `[Detect] Forwarding clean message (direction=${direction}, method=${method}, id=${messageId})`,
        );
        forwardTo.send(message).catch((error) => {
          console.error("Error forwarding clean message:", error);
        });
      }
    })
    .catch((error) => {
      // Fail-closed: block message if detection service is unavailable
      console.error("Detection service error (fail-closed):", error);
      console.log(
        `[Detect] Detection failed (error, fail-closed): ${direction} message DROPPED (method=${method}, id=${messageId})`,
      );

      emitEvent(
        createEvent(
          sessionId,
          direction,
          {
            entities: [],
            originalText: text,
            processedText: "",
            hasPii: false,
            entityCount: 0,
          },
          true,
          "error",
          undefined,
          method,
        ),
      );

      if (messageId !== undefined && errorResponseTo) {
        const errorMsg =
          error instanceof SkyflowClientError
            ? error.message
            : "Detection service unavailable";
        errorResponseTo
          .send(createServiceUnavailableError(messageId, errorMsg))
          .catch((err) =>
            console.error("Error sending service unavailable response:", err),
          );
      }
    });
}
