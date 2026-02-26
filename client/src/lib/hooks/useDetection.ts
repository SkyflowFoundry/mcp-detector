import { useState, useCallback, useRef, useEffect } from "react";
import { getMCPProxyAddress, getMCPProxyAuthToken } from "@/utils/configUtils";
import type { InspectorConfig } from "@/lib/configurationTypes";

// --- Types mirrored from server/src/types.ts ---

export type DetectionMode = "log" | "warn" | "error" | "tokenize";

export interface SkyflowConfig {
  clusterId: string;
  bearerToken: string;
  vaultId: string;
}

export interface SkyflowEntityLocation {
  start_index: number;
  end_index: number;
  start_index_processed: number;
  end_index_processed: number;
}

export interface SkyflowEntity {
  token: string;
  value: string;
  location: SkyflowEntityLocation;
  entity_type: string;
  entity_scores: Record<string, number>;
}

export interface DetectionResult {
  entities: SkyflowEntity[];
  originalText: string;
  processedText: string;
  hasPii: boolean;
  entityCount: number;
}

export type DetectionDirection = "client-to-server" | "server-to-client";

export interface DetectionEvent {
  id: string;
  sessionId: string;
  timestamp: string;
  direction: DetectionDirection;
  result: DetectionResult;
  blocked: boolean;
  severity: "info" | "warn" | "error";
  mode: DetectionMode;
  tokenized?: boolean;
  method?: string;
}

export const SCAN_METHODS_LIST = [
  "tools/call",
  "sampling/createMessage",
  "prompts/get",
  "resources/read",
  "completion/complete",
  "elicitation/create",
  "notifications/message",
] as const;

export const SCAN_METHOD_LABELS: Record<string, string> = {
  "tools/call": "Tool Call",
  "sampling/createMessage": "Sampling",
  "prompts/get": "Prompt",
  "resources/read": "Resource Read",
  "completion/complete": "Completion",
  "elicitation/create": "Elicitation",
  "notifications/message": "Notification",
};

export interface AggregateStats {
  totalScanned: number;
  totalDetected: number;
  totalBlocked: number;
  totalTokenized: number;
  totalClean: number;
  byType: Record<string, number>;
  byDirection: {
    clientToServer: number;
    serverToClient: number;
  };
}

const EMPTY_STATS: AggregateStats = {
  totalScanned: 0,
  totalDetected: 0,
  totalBlocked: 0,
  totalTokenized: 0,
  totalClean: 0,
  byType: {},
  byDirection: { clientToServer: 0, serverToClient: 0 },
};

const SKYFLOW_SESSION_KEY = "skyflowConfig";
const SCAN_METHODS_SESSION_KEY = "scanMethods";

function loadSkyflowConfig(): SkyflowConfig {
  try {
    const saved = sessionStorage.getItem(SKYFLOW_SESSION_KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    // ignore parse errors
  }
  return { clusterId: "", bearerToken: "", vaultId: "" };
}

function saveSkyflowConfig(config: SkyflowConfig): void {
  sessionStorage.setItem(SKYFLOW_SESSION_KEY, JSON.stringify(config));
}

function loadScanMethods(): Set<string> {
  try {
    const saved = sessionStorage.getItem(SCAN_METHODS_SESSION_KEY);
    if (saved) return new Set(JSON.parse(saved));
  } catch {
    // ignore parse errors
  }
  return new Set(SCAN_METHODS_LIST);
}

function saveScanMethods(methods: Set<string>): void {
  sessionStorage.setItem(
    SCAN_METHODS_SESSION_KEY,
    JSON.stringify([...methods]),
  );
}

export function useDetection(inspectorConfig: InspectorConfig) {
  const [detectionMode, setDetectionMode] = useState<DetectionMode>("log");
  const [scanMethods, setScanMethodsState] =
    useState<Set<string>>(loadScanMethods);
  const [skyflowConfig, setSkyflowConfigState] =
    useState<SkyflowConfig>(loadSkyflowConfig);
  const [validationStatus, setValidationStatus] = useState<
    "unconfigured" | "validating" | "valid" | "invalid"
  >("unconfigured");
  const [validationError, setValidationError] = useState<string>("");
  const [detectionEvents, setDetectionEvents] = useState<DetectionEvent[]>([]);
  const [aggregateStats, setAggregateStats] =
    useState<AggregateStats>(EMPTY_STATS);

  const eventSourceRef = useRef<EventSource | null>(null);

  const setScanMethods = useCallback((methods: Set<string>) => {
    setScanMethodsState(methods);
    saveScanMethods(methods);
  }, []);

  const setSkyflowConfig = useCallback((config: SkyflowConfig) => {
    setSkyflowConfigState(config);
    saveSkyflowConfig(config);

    // Reset validation when config changes
    if (config.clusterId && config.bearerToken && config.vaultId) {
      setValidationStatus("unconfigured");
    } else {
      setValidationStatus("unconfigured");
      setValidationError("");
    }
  }, []);

  const isConfigured = !!(
    skyflowConfig.clusterId &&
    skyflowConfig.bearerToken &&
    skyflowConfig.vaultId
  );

  /**
   * Validates Skyflow credentials by calling the server's validate endpoint.
   */
  const validateCredentials = useCallback(async () => {
    if (!isConfigured) return;

    setValidationStatus("validating");
    setValidationError("");

    try {
      const headers: HeadersInit = {
        "Content-Type": "application/json",
      };
      const { token: proxyAuthToken, header: proxyAuthTokenHeader } =
        getMCPProxyAuthToken(inspectorConfig);
      if (proxyAuthToken) {
        headers[proxyAuthTokenHeader] = `Bearer ${proxyAuthToken}`;
      }

      const response = await fetch(
        `${getMCPProxyAddress(inspectorConfig)}/detect-validate`,
        {
          method: "POST",
          headers,
          body: JSON.stringify(skyflowConfig),
        },
      );

      const result = await response.json();
      if (result.valid) {
        setValidationStatus("valid");
        setValidationError("");
      } else {
        setValidationStatus("invalid");
        setValidationError(result.error || "Validation failed");
      }
    } catch (error) {
      setValidationStatus("invalid");
      setValidationError(
        error instanceof Error ? error.message : "Connection failed",
      );
    }
  }, [isConfigured, skyflowConfig, inspectorConfig]);

  /**
   * Connects to the detection events SSE stream for the given session.
   */
  const connectEventStream = useCallback(
    (sessionId: string) => {
      // Close existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      if (!isConfigured || !sessionId) return;

      const proxyAddress = getMCPProxyAddress(inspectorConfig);
      const { token: proxyAuthToken } = getMCPProxyAuthToken(inspectorConfig);
      const sseUrl = new URL(`${proxyAddress}/detect-events/${sessionId}`);
      if (proxyAuthToken) {
        sseUrl.searchParams.set("token", proxyAuthToken);
      }

      const eventSource = new EventSource(sseUrl.toString());
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "connected") return; // Initial connection event

          const detectionEvent = data as DetectionEvent;
          setDetectionEvents((prev) => [detectionEvent, ...prev]);

          // Update aggregate stats
          setAggregateStats((prev) => {
            const updated = { ...prev };
            updated.totalScanned++;
            if (detectionEvent.result.hasPii) {
              updated.totalDetected++;
            } else {
              updated.totalClean++;
            }
            if (detectionEvent.blocked) {
              updated.totalBlocked++;
            }
            if (detectionEvent.tokenized) {
              updated.totalTokenized++;
            }

            // By entity type
            const byType = { ...updated.byType };
            for (const entity of detectionEvent.result.entities) {
              byType[entity.entity_type] =
                (byType[entity.entity_type] || 0) + 1;
            }
            updated.byType = byType;

            // By direction
            const byDirection = { ...updated.byDirection };
            if (detectionEvent.direction === "client-to-server") {
              byDirection.clientToServer++;
            } else {
              byDirection.serverToClient++;
            }
            updated.byDirection = byDirection;

            return updated;
          });
        } catch {
          // Ignore parse errors for heartbeats etc.
        }
      };

      eventSource.onerror = () => {
        // EventSource auto-reconnects
      };
    },
    [isConfigured, inspectorConfig],
  );

  /**
   * Disconnects from the detection events SSE stream.
   */
  const disconnectEventStream = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  /**
   * Resets detection state (events, stats).
   */
  const resetDetection = useCallback(() => {
    setDetectionEvents([]);
    setAggregateStats(EMPTY_STATS);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  /**
   * Returns headers to attach to proxy requests for detection.
   */
  const getDetectionHeaders = useCallback((): Record<string, string> => {
    if (!isConfigured) return {};

    const headers: Record<string, string> = {
      "X-Skyflow-Cluster-Id": skyflowConfig.clusterId,
      "X-Skyflow-Bearer-Token": skyflowConfig.bearerToken,
      "X-Skyflow-Vault-Id": skyflowConfig.vaultId,
      "X-Detection-Mode": detectionMode,
    };

    // Only send header when not all methods are selected (backward compat)
    if (scanMethods.size < SCAN_METHODS_LIST.length && scanMethods.size > 0) {
      headers["X-Scan-Methods"] = [...scanMethods].join(",");
    }

    return headers;
  }, [isConfigured, skyflowConfig, detectionMode, scanMethods]);

  return {
    // Skyflow config
    skyflowConfig,
    setSkyflowConfig,
    isConfigured,

    // Validation
    validationStatus,
    validationError,
    validateCredentials,

    // Detection mode
    detectionMode,
    setDetectionMode,

    // Scan methods
    scanMethods,
    setScanMethods,

    // Events
    detectionEvents,
    aggregateStats,
    connectEventStream,
    disconnectEventStream,
    resetDetection,

    // Headers for proxy
    getDetectionHeaders,
  };
}
