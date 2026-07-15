/**
 * Constants used throughout the application
 */

/**
 * Environment options for the eBay API
 */
export enum ApiEnvironment {
  SANDBOX = "sandbox",
  PRODUCTION = "production"
}
/**
 * Utility to find ApiEnvironment by string value
 * Returns PRODUCTION if no match is found
 */
function findApiEnvironmentByValue(value: string): ApiEnvironment {
  const lowercaseValue = value?.toLowerCase();
  const matchedEnv = Object.entries(ApiEnvironment)
    .find(([_key, val]) => typeof val === "string" && val.toLowerCase() === lowercaseValue);
  return matchedEnv ? matchedEnv[1] as ApiEnvironment : ApiEnvironment.PRODUCTION;
}

export const USER_ENVIRONMENT = findApiEnvironmentByValue(process.env.EBAY_API_ENV || "");


/**
 * Recall apiDoc url by prompt
 */
export const RECALL_SPEC_BY_PROMPT_URL = "https://api.ebay.com/developer/mcp/v1/search?query=%s";
/**
 * url for query apiSpec with fields such as specTitle、operationId
 */
export const RECALL_SPEC_WITH_FIELD_URL = "https://api.ebay.com/developer/mcp/v1/search/%s?operationId=%s";

/**
 * API domain name, differentiated by api environment
 */
export const DOMAIN_NAME = {
  [ApiEnvironment.SANDBOX]: "api.sandbox.ebay.com",
  [ApiEnvironment.PRODUCTION]: "api.ebay.com",
};

/**
 * List of supported calling methods, differentiated by api environment
 */
export const SUPPORTED_CALLING_METHODS = {
  [ApiEnvironment.SANDBOX]: ["get", "put", "post", "delete", "options", "head", "patch", "trace"],
  [ApiEnvironment.PRODUCTION]: ["get"],
};

/**
 * eBay OAuth token endpoints by environment
 */
export const TOKEN_ENDPOINTS = {
  [ApiEnvironment.SANDBOX]: "https://api.sandbox.ebay.com/identity/v1/oauth2/token",
  [ApiEnvironment.PRODUCTION]: "https://api.ebay.com/identity/v1/oauth2/token",
};
