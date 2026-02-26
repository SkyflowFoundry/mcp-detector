/**
 * HTTP client for the Skyflow Detect API.
 * Makes per-request calls using credentials relayed from the browser.
 */

import nodeFetch from "node-fetch";
import type { SkyflowCredentials, SkyflowDeidentifyResponse } from "./types.js";

const DETECT_API_PATH = "/v1/detect/deidentify/string";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
const INITIAL_BACKOFF_MS = 200;

export class SkyflowClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "SkyflowClientError";
  }
}

/**
 * Constructs the Skyflow Detect API base URL from a cluster ID.
 */
function getBaseUrl(clusterId: string): string {
  return `https://${clusterId}.vault.skyflowapis.com`; // TODO allow the user to directly specify the 'vault_url' instead of just the cluster ID
}

/**
 * Calls the Skyflow Detect deidentify string endpoint.
 * Includes retry logic with exponential backoff for transient errors.
 */
export async function deidentifyText(
  text: string,
  credentials: SkyflowCredentials,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<SkyflowDeidentifyResponse> {
  const url = `${getBaseUrl(credentials.clusterId)}${DETECT_API_PATH}`;

  const body = JSON.stringify({
    text,
    vault_id: credentials.vaultId,
    token_type: {
      // TODO make this configurable by the user
      default: "entity_unq_counter",
    },
  });

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const response = await nodeFetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${credentials.bearerToken}`,
        },
        body,
        signal: controller.signal as any,
      });

      clearTimeout(timeout);

      if (response.ok) {
        const data =
          (await response.json()) as unknown as SkyflowDeidentifyResponse;
        return data;
      }

      // Non-retryable client errors
      if (response.status >= 400 && response.status < 500) {
        const errorBody = await response.text().catch(() => "Unknown error");
        throw new SkyflowClientError(
          `Skyflow API error (${response.status}): ${errorBody}`,
          response.status,
          false,
        );
      }

      // Retryable server errors (5xx)
      lastError = new SkyflowClientError(
        `Skyflow API server error (${response.status})`,
        response.status,
        true,
      );
    } catch (error) {
      if (error instanceof SkyflowClientError && !error.retryable) {
        throw error;
      }

      // AbortError = timeout
      if (error instanceof Error && error.name === "AbortError") {
        lastError = new SkyflowClientError(
          `Skyflow API timeout after ${timeoutMs}ms`,
          undefined,
          true,
        );
      } else if (!(error instanceof SkyflowClientError)) {
        lastError = new SkyflowClientError(
          `Skyflow API network error: ${error instanceof Error ? error.message : String(error)}`,
          undefined,
          true,
        );
      } else {
        lastError = error;
      }
    }
  }

  throw lastError ?? new SkyflowClientError("Skyflow API request failed");
}

/**
 * Validates Skyflow credentials by making a minimal detect call.
 * Returns true if credentials are valid, false otherwise.
 */
export async function validateCredentials(
  credentials: SkyflowCredentials,
): Promise<{ valid: boolean; error?: string }> {
  try {
    await deidentifyText("test", credentials, 5000);
    return { valid: true };
  } catch (error) {
    if (error instanceof SkyflowClientError) {
      if (error.statusCode === 401) {
        return { valid: false, error: "Invalid bearer token" };
      }
      if (error.statusCode === 403) {
        return {
          valid: false,
          error: "Insufficient permissions for this vault",
        };
      }
      if (error.statusCode === 404) {
        return {
          valid: false,
          error: "Invalid cluster ID or vault ID",
        };
      }
      return { valid: false, error: error.message };
    }
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
