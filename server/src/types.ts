/**
 * Shared types for MCP Detector's PII detection system.
 */

// --- Detection Modes ---

export type DetectionMode = "log" | "warn" | "error" | "tokenize";

// --- Skyflow Credentials (relayed per-request via headers) ---

export interface SkyflowCredentials {
  /** Vault URL identifier, used to construct API base URL */
  clusterId: string;
  /** Bearer token for Skyflow API authentication */
  bearerToken: string;
  /** Vault ID required in API request body */
  vaultId: string;
}

// --- Skyflow Detect API types ---

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

export interface SkyflowDeidentifyResponse {
  processed_text: string;
  entities: SkyflowEntity[];
  word_count: number;
  character_count: number;
}

// --- Detection Results ---

export interface DetectionResult {
  /** Detected entities with metadata */
  entities: SkyflowEntity[];
  /** The original text that was scanned */
  originalText: string;
  /** The deidentified version of the text */
  processedText: string;
  /** Whether any PII was found */
  hasPii: boolean;
  /** Total count of entities detected */
  entityCount: number;
}

// --- Detection Events (streamed to client via SSE) ---

export type DetectionDirection = "client-to-server" | "server-to-client";
export type DetectionSeverity = "info" | "warn" | "error";

export interface DetectionEvent {
  /** Unique event ID */
  id: string;
  /** Session ID this event belongs to */
  sessionId: string;
  /** ISO timestamp */
  timestamp: string;
  /** Which direction the message was traveling */
  direction: DetectionDirection;
  /** Detection result details */
  result: DetectionResult;
  /** Whether the message was blocked (error mode only) */
  blocked: boolean;
  /** Severity based on detection mode */
  severity: DetectionSeverity;
  /** The detection mode that was active */
  mode: DetectionMode;
  /** Whether the message was tokenized (tokenize mode only) */
  tokenized?: boolean;
  /** The MCP method name that was scanned (e.g. "tools/call") */
  method?: string;
}

// --- Helper to extract credentials from request headers ---

export function extractSkyflowCredentials(
  headers: Record<string, string | string[] | undefined>,
): SkyflowCredentials | null {
  const clusterId = getHeaderValue(headers, "x-skyflow-cluster-id");
  const bearerToken = getHeaderValue(headers, "x-skyflow-bearer-token");
  const vaultId = getHeaderValue(headers, "x-skyflow-vault-id");

  if (!clusterId || !bearerToken || !vaultId) {
    return null;
  }

  return { clusterId, bearerToken, vaultId };
}

export function extractDetectionMode(
  headers: Record<string, string | string[] | undefined>,
): DetectionMode {
  const mode = getHeaderValue(headers, "x-detection-mode");
  if (
    mode === "log" ||
    mode === "warn" ||
    mode === "error" ||
    mode === "tokenize"
  ) {
    return mode;
  }
  return "log"; // default
}

export function extractScanMethods(
  headers: Record<string, string | string[] | undefined>,
): Set<string> | null {
  const raw = getHeaderValue(headers, "x-scan-methods");
  if (!raw) return null; // null = scan all methods in SCAN_METHODS
  const methods = raw
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return methods.length > 0 ? new Set(methods) : null;
}

export function extractEntityTypes(
  headers: Record<string, string | string[] | undefined>,
): string[] | null {
  const raw = getHeaderValue(headers, "x-entity-types");
  if (!raw) return null; // null = detect all entity types (API default)
  const types = raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return types.length > 0 ? types : null;
}

export function extractTokenType(
  headers: Record<string, string | string[] | undefined>,
): string {
  const raw = getHeaderValue(headers, "x-token-type");
  if (raw === "vault_token") return "vault_token";
  return "entity_unq_counter"; // default
}

function getHeaderValue(
  headers: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const value = headers[key];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}
