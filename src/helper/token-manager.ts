/**
 * Token management module for handling eBay OAuth tokens
 * Supports both User Token (refresh_token) and Application Token (client_credentials) modes
 */
import axios from "axios";
import { TOKEN_ENDPOINTS, USER_ENVIRONMENT } from "../constant/constants.js";
import { logger } from "./logger.js";

/**
 * Token mode type
 */
type TokenMode = "user" | "application";

/**
 * In-memory storage for the current access token
 */
let currentAccessToken: string | null = null;

/**
 * Timestamp when the current token expires (milliseconds since epoch)
 */
let tokenExpiresAt: number | null = null;

/**
 * Current token mode (auto-detected based on configuration)
 */
let tokenMode: TokenMode;

/**
 * Flag to prevent concurrent refresh requests
 */
let isRefreshing = false;

/**
 * Queue of pending requests waiting for token refresh
 */
let refreshQueue: Array<{ resolve: (token: string) => void; reject: (error: Error) => void }> = [];

/**
 * Detect token mode based on environment configuration
 * Uses EBAY_TOKEN_TYPE to determine mode ("user" or "application")
 */
function detectTokenMode(): TokenMode {
  const tokenType = process.env.EBAY_TOKEN_TYPE;
  if (tokenType === "user" || tokenType === "application") {
    return tokenType;
  }
  // Default to application mode if not specified or invalid
  return "application";
}

/**
 * Validate token configuration based on mode
 * Throws error if required environment variables are missing
 */
function validateTokenConfiguration(mode: TokenMode): void {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  // Client ID and Secret are required for both modes
  if (!clientId || !clientSecret) {
    throw new Error(
      "Token configuration error: EBAY_CLIENT_ID and EBAY_CLIENT_SECRET are required for both user and application token modes"
    );
  }

  // For user token mode, refresh token is also required
  if (mode === "user") {
    const refreshToken = process.env.EBAY_REFRESH_TOKEN;
    if (!refreshToken) {
      throw new Error(
        "Token configuration error: EBAY_REFRESH_TOKEN is required when EBAY_TOKEN_TYPE='user'"
      );
    }
  }
}

/**
 * Initialize the token manager
 * Detects token mode and validates configuration
 */
export function initializeTokenManager(): void {
  tokenMode = detectTokenMode();

  // Validate configuration before proceeding
  validateTokenConfiguration(tokenMode);

  logger.info(`Token manager initialized in ${tokenMode} token mode`);
}

/**
 * Get the current valid access token
 * If no token in memory or token expires soon, fetch a new one based on token mode
 * @returns Promise<string> - The current valid access token
 */
export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  const REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // Refresh 5 minutes before expiry

  // If we have a token and it's not expiring soon, return it
  if (currentAccessToken && tokenExpiresAt && tokenExpiresAt - now > REFRESH_THRESHOLD_MS) {
    return currentAccessToken;
  }

  // No token in memory or token expiring soon, fetch a new one
  if (tokenExpiresAt && tokenExpiresAt - now <= REFRESH_THRESHOLD_MS) {
    logger.info("Access token expiring soon, proactively refreshing...");
  } else {
    logger.info("No access token in memory, fetching new token...");
  }
  return await refreshAccessToken();
}

/**
 * Refresh or fetch access token based on current token mode
 * @returns Promise<string> - The new access token
 */
export async function refreshAccessToken(): Promise<string> {
  // If already refreshing, wait for the current refresh to complete
  if (isRefreshing) {
    return new Promise((resolve, reject) => {
      refreshQueue.push({ resolve, reject });
    });
  }

  isRefreshing = true;

  try {
    let newAccessToken: string;
    let expiresIn: number;

    if (tokenMode === "user") {
      const result = await fetchUserToken();
      newAccessToken = result.token;
      expiresIn = result.expiresIn;
    } else {
      const result = await fetchApplicationToken();
      newAccessToken = result.token;
      expiresIn = result.expiresIn;
    }

    // Update the in-memory access token and expiration time
    currentAccessToken = newAccessToken;
    tokenExpiresAt = Date.now() + expiresIn * 1000;
    logger.info(`Access token obtained successfully, expires in ${expiresIn} seconds`);

    // Resolve all queued requests with the new token
    refreshQueue.forEach(({ resolve }) => resolve(newAccessToken));
    refreshQueue = [];

    return newAccessToken;
  } catch (error) {
    logger.error("Failed to obtain access token", error);

    if (axios.isAxiosError(error) && error.response) {
      logger.error("Token request error details: " + JSON.stringify({
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      }, null, 2));
    }

    // Reject all queued requests
    const err = new Error(`Token request failed: ${error instanceof Error ? error.message : String(error)}`);
    const queueCopy = [...refreshQueue];
    refreshQueue = [];
    queueCopy.forEach(({ reject }) => reject(err));

    throw err;
  } finally {
    // Reset the flag before draining remaining queue to avoid race condition
    // where new callers join between queue drain and flag reset
    isRefreshing = false;

    // Drain any requests that joined after error handling but before flag reset
    if (refreshQueue.length > 0) {
      const lateComers = [...refreshQueue];
      refreshQueue = [];
      const err = new Error("Token refresh failed");
      lateComers.forEach(({ reject }) => reject(err));
    }
  }
}

/**
 * Fetch User Token using refresh_token (grant_type=refresh_token)
 * @returns Promise<{token: string, expiresIn: number}> - The new user access token and expiration time
 */
async function fetchUserToken(): Promise<{ token: string; expiresIn: number }> {
  const refreshToken = process.env.EBAY_REFRESH_TOKEN;
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;

  // Configuration should already be validated in initializeTokenManager
  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error("Cannot fetch user token: Missing required configuration (this should have been caught during initialization)");
  }

  logger.info("Fetching user token using refresh_token...");

  // Prepare Basic auth credentials
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  // Prepare request body for refresh_token grant
  // Note: scope is intentionally omitted - refresh_token grants inherit scopes from the original token
  const params = new URLSearchParams();
  params.append("grant_type", "refresh_token");
  params.append("refresh_token", refreshToken);

  // Get the appropriate token endpoint for current environment
  const tokenEndpoint = TOKEN_ENDPOINTS[USER_ENVIRONMENT];

  // Log request details (without sensitive data)
  logger.debug("Token request details", {
    endpoint: tokenEndpoint,
    grantType: "refresh_token",
    refreshTokenLength: refreshToken.length,
    clientIdLength: clientId.length,
  });

  // Make the token request
  const response = await axios.post(
    tokenEndpoint,
    params.toString(),
    {
      timeout: 10000,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${credentials}`,
      },
    }
  );

  const accessToken = response.data.access_token;
  const expiresIn = response.data.expires_in;

  if (!accessToken) {
    throw new Error("Token response did not contain access_token");
  }

  if (!expiresIn || typeof expiresIn !== "number") {
    logger.warn("Token response missing expires_in, defaulting to 7200 seconds (2 hours)");
  }

  return {
    token: accessToken,
    expiresIn: expiresIn || 7200  // Default to 2 hours if not provided
  };
}

/**
 * Fetch Application Token using client_credentials (grant_type=client_credentials)
 * @returns Promise<{token: string, expiresIn: number}> - The new application access token and expiration time
 */
async function fetchApplicationToken(): Promise<{ token: string; expiresIn: number }> {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const userScopes = process.env.EBAY_REQUIRED_SCOPES;

  if (!clientId || !clientSecret) {
    throw new Error("Cannot fetch application token: Missing required configuration");
  }

  logger.info("Fetching application token using client_credentials...");

  // Use user-provided scopes if available, otherwise default to base public scope
  const applicationScope = userScopes || "https://api.ebay.com/oauth/api_scope";

  // Prepare Basic auth credentials
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  // Prepare request body for client_credentials grant
  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("scope", applicationScope);

  // Get the appropriate token endpoint for current environment
  const tokenEndpoint = TOKEN_ENDPOINTS[USER_ENVIRONMENT];

  // Log request details (without sensitive data)
  logger.debug("Token request details", {
    endpoint: tokenEndpoint,
    grantType: "client_credentials",
    scopes: applicationScope,
    clientIdLength: clientId.length,
  });

  // Make the token request
  const response = await axios.post(
    tokenEndpoint,
    params.toString(),
    {
      timeout: 10000,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${credentials}`,
      },
    }
  );

  const accessToken = response.data.access_token;
  const expiresIn = response.data.expires_in;

  if (!accessToken) {
    throw new Error("Token response did not contain access_token");
  }

  if (!expiresIn || typeof expiresIn !== "number") {
    logger.warn("Token response missing expires_in, defaulting to 7200 seconds (2 hours)");
  }

  return {
    token: accessToken,
    expiresIn: expiresIn || 7200  // Default to 2 hours if not provided
  };
}

/**
 * Handle 401 unauthorized error by refreshing the token
 * @returns Promise<string> - The new access token after refresh
 */
export async function handle401Error(): Promise<string> {
  logger.warn("Received 401 Unauthorized, attempting to refresh token...");

  // Clear current token state and fetch a new one
  currentAccessToken = null;
  tokenExpiresAt = null;
  return await refreshAccessToken();
}

/**
 * Clear the current access token (useful for testing or forcing refresh)
 */
export function clearAccessToken(): void {
  currentAccessToken = null;
  tokenExpiresAt = null;
}

/**
 * Get current token mode
 */
export function getTokenMode(): TokenMode {
  return tokenMode;
}
