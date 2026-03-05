import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isJSONRPCRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  wrapWithDetection,
  type DetectionEventEmitter,
} from "./detectEngine.js";
import type { DetectionMode, SkyflowCredentials } from "./types.js";

function onClientError(error: Error) {
  console.error("Error from inspector client:", error);
}

function onServerError(error: Error) {
  if (error?.cause && JSON.stringify(error.cause).includes("ECONNREFUSED")) {
    console.error("Connection refused. Is the MCP server running?");
  } else if (error.message && error.message.includes("404")) {
    console.error("Error accessing endpoint (HTTP 404)");
  } else {
    console.error("Error from MCP server:", error);
  }
}

export interface McpProxyDetectionOptions {
  sessionId: string;
  mode: DetectionMode;
  credentials: SkyflowCredentials;
  emitEvent: DetectionEventEmitter;
  allowedMethods?: Set<string>;
  entityTypes?: string[];
  tokenType?: string;
}

export default function mcpProxy({
  transportToClient,
  transportToServer,
  detection,
}: {
  transportToClient: Transport;
  transportToServer: Transport;
  detection?: McpProxyDetectionOptions;
}) {
  let transportToClientClosed = false;
  let transportToServerClosed = false;

  let reportedServerSession = false;

  if (detection) {
    // Detection enabled: wrap message handlers with PII scanning
    const { wrappedClientHandler, wrappedServerHandler } = wrapWithDetection(
      transportToClient,
      transportToServer,
      detection,
    );

    transportToClient.onmessage = (message) => {
      wrappedClientHandler(message);
    };

    transportToServer.onmessage = (message) => {
      if (!reportedServerSession) {
        if (transportToServer.sessionId) {
          console.error(
            "Proxy  <-> Server sessionId: " + transportToServer.sessionId,
          );
        }
        reportedServerSession = true;
      }
      wrappedServerHandler(message);
    };
  } else {
    // No detection: standard pass-through (original behavior)
    transportToClient.onmessage = (message) => {
      transportToServer.send(message).catch((error) => {
        if (isJSONRPCRequest(message) && !transportToClientClosed) {
          const errorResponse = {
            jsonrpc: "2.0" as const,
            id: message.id,
            error: {
              code: -32001,
              message: error.cause
                ? `${error.message} (cause: ${error.cause})`
                : error.message,
              data: error,
            },
          };
          transportToClient.send(errorResponse).catch(onClientError);
        }
      });
    };

    transportToServer.onmessage = (message) => {
      if (!reportedServerSession) {
        if (transportToServer.sessionId) {
          console.error(
            "Proxy  <-> Server sessionId: " + transportToServer.sessionId,
          );
        }
        reportedServerSession = true;
      }
      transportToClient.send(message).catch(onClientError);
    };
  }

  transportToClient.onclose = () => {
    if (transportToServerClosed) {
      return;
    }

    transportToClientClosed = true;
    transportToServer.close().catch(onServerError);
  };

  transportToServer.onclose = () => {
    if (transportToClientClosed) {
      return;
    }
    transportToServerClosed = true;
    transportToClient.close().catch(onClientError);
  };

  transportToClient.onerror = onClientError;
  transportToServer.onerror = onServerError;
}
