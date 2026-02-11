/**
 * Detection engine that wraps MCP proxy message handlers with
 * Skyflow Detect API integration. Supports three modes:
 *
 * - log:   Forward immediately, detect async, emit results
 * - warn:  Same as log but with severity: "warn"
 * - error: Detect first, block if PII found, forward only if clean
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
} from "./types.js";

export type DetectionEventEmitter = (event: DetectionEvent) => void;

interface DetectionOptions {
  sessionId: string;
  mode: DetectionMode;
  credentials: SkyflowCredentials;
  emitEvent: DetectionEventEmitter;
}

/**
 * Extracts scannable text from a JSON-RPC message.
 * Concatenates all string values found in params/result for scanning.
 */
function extractTextFromMessage(message: JSONRPCMessage): string {
  const parts: string[] = [];

  function walk(obj: unknown): void {
    if (typeof obj === "string") {
      parts.push(obj);
    } else if (Array.isArray(obj)) {
      for (const item of obj) {
        walk(item);
      }
    } else if (obj !== null && typeof obj === "object") {
      for (const value of Object.values(obj)) {
        walk(value);
      }
    }
  }

  walk(message);
  return parts.join("\n");
}

/**
 * Runs PII detection on the given text and returns a DetectionResult.
 */
async function detectPii(
  text: string,
  credentials: SkyflowCredentials,
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

  const response = await deidentifyText(text, credentials);
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
): DetectionEvent {
  return {
    id: randomUUID(),
    sessionId,
    timestamp: new Date().toISOString(),
    direction,
    result,
    blocked,
    severity: mode === "error" ? "error" : mode === "warn" ? "warn" : "info",
    mode,
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
 * Wraps MCP proxy transports with detection logic based on the configured mode.
 *
 * For log/warn mode: Messages are forwarded immediately; detection runs async.
 * For error mode: Messages are held until detection completes; blocked if PII found.
 */
export function wrapWithDetection(
  transportToClient: Transport,
  transportToServer: Transport,
  options: DetectionOptions,
): {
  wrappedClientHandler: (message: JSONRPCMessage) => void;
  wrappedServerHandler: (message: JSONRPCMessage) => void;
} {
  const { sessionId, mode, credentials, emitEvent } = options;

  const wrappedClientHandler = (message: JSONRPCMessage) => {
    const text = extractTextFromMessage(message);
    const direction: DetectionDirection = "client-to-server";

    if (mode === "error") {
      // Error mode: detect synchronously before forwarding
      handleErrorMode(
        message,
        text,
        direction,
        transportToServer,
        transportToClient,
        sessionId,
        credentials,
        emitEvent,
      );
    } else {
      // Log/Warn mode: forward immediately, detect async
      transportToServer.send(message).catch((error) => {
        console.error("Error forwarding to server:", error);
      });

      if (text.trim()) {
        detectAndEmit(text, direction, sessionId, mode, credentials, emitEvent);
      }
    }
  };

  const wrappedServerHandler = (message: JSONRPCMessage) => {
    const text = extractTextFromMessage(message);
    const direction: DetectionDirection = "server-to-client";

    if (mode === "error") {
      // Error mode: detect synchronously before forwarding
      handleErrorMode(
        message,
        text,
        direction,
        transportToClient,
        null, // no error response target for server→client
        sessionId,
        credentials,
        emitEvent,
      );
    } else {
      // Log/Warn mode: forward immediately, detect async
      transportToClient.send(message).catch((error) => {
        console.error("Error forwarding to client:", error);
      });

      if (text.trim()) {
        detectAndEmit(text, direction, sessionId, mode, credentials, emitEvent);
      }
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
): void {
  detectPii(text, credentials)
    .then((result) => {
      if (result.hasPii) {
        emitEvent(createEvent(sessionId, direction, result, false, mode));
      }
    })
    .catch((error) => {
      console.error(`Detection error (${mode} mode, non-blocking):`, error);
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
): void {
  if (!text.trim()) {
    // No text to scan, forward immediately
    forwardTo.send(message).catch((error) => {
      console.error("Error forwarding message:", error);
    });
    return;
  }

  const messageId = (message as any).id;

  detectPii(text, credentials)
    .then((result) => {
      if (result.hasPii) {
        // Block the message
        emitEvent(createEvent(sessionId, direction, result, true, "error"));

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
        forwardTo.send(message).catch((error) => {
          console.error("Error forwarding clean message:", error);
        });
      }
    })
    .catch((error) => {
      // Fail-closed: block message if detection service is unavailable
      console.error("Detection service error (fail-closed):", error);

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
