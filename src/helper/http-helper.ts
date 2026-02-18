/**
 * Helper functions for HTTP requests
 */
import axios from "axios";
import { type OpenAPIV3 } from "openapi-types";
import https from "https";
import { ApiEnvironment, DOMAIN_NAME, USER_ENVIRONMENT } from "../constant/constants.js";
const USER_TOKEN = process.env.EBAY_CLIENT_TOKEN || "";
const SCHEMA_REQUEST_BODY = "requestBody";


/**
 * Format axios error message for consistent error output
 */
export function formatAxiosError(error: unknown): string {
  let errorMessage = `Error in invokeAPI tool: ${error instanceof Error ? error.message : String(error)}`;
  if (axios.isAxiosError(error)) {
    if (error?.response?.data) {
      errorMessage = JSON.stringify(error.response.data, null, 2);
    }
  }
  return errorMessage;
}

/**
 * needSetHostByEnv indicates whether to set the Host header based on the environment : If false, it uses the default production domain
 * Build headers from input headers and fill with default headers
 */
export function buildHeadersFromInput(inputHeaders: Record<string, string[]> | undefined, needSetHostByEnv : boolean): Record<string, string> {
  const headers: Record<string, string> = {};
  if (inputHeaders) {
    for (const [key, value] of Object.entries(inputHeaders)) {
      headers[key] = Array.isArray(value) ? value[0] : value;
    }
  }
  // Add default headers
  fillDefaultHeaderInfo(headers, needSetHostByEnv);
  return headers;
}

export function fillDefaultHeaderInfo(headers: Record<string, string>, needSetHostByEnv : boolean): void {
  headers["Host"] = needSetHostByEnv ? DOMAIN_NAME[USER_ENVIRONMENT] : DOMAIN_NAME[ApiEnvironment.PRODUCTION] ;
  headers["User-Agent"] = "EBAY-API-MCP-Tool/1.0";
  headers["Authorization"] = `Bearer ${USER_TOKEN}`;
  headers["Content-Type"] = headers["Content-Type"] || "application/json";
}

/**
 * Build final URL by replacing path variables with their values
 */
export function buildFinalUrl(url: string, urlVariables: Record<string, unknown> | undefined): string {
  if (urlVariables) {
    for (const [key, value] of Object.entries(urlVariables)) {
      url = url.replace(new RegExp(`%7B${key}%7D`, "g"), encodeURIComponent(String(value)));
    }
  }
  return url;
}

/**
 * replace url domain name by environment
 */
export function replaceDomainNameByEnvironment(url: string): string {
  try {
    const urlObj = new URL(url);
    const currentHostname = urlObj.hostname;
    const expectedDomain = DOMAIN_NAME[USER_ENVIRONMENT];
    if (currentHostname !== expectedDomain) {
      urlObj.hostname = expectedDomain;
      return urlObj.toString();
    }
    return url;
  } catch (error) {
    // Fallback to string replacement if URL parsing fails
    const expectedDomain = DOMAIN_NAME[USER_ENVIRONMENT];
    for (const [env, domain] of Object.entries(DOMAIN_NAME)) {
      if (env !== USER_ENVIRONMENT && url.includes(domain)) {
        return url.replace(domain, expectedDomain);
      }
    }
    return url;
  }
}

/**
 * Build base URL from OpenAPI servers object
 */
export function buildBaseUrlFromOpenApi(openapi: OpenAPIV3.Document): string {
  const serverObj = openapi.servers?.[0] || { url: "" };
  let baseUrl = serverObj.url;
  if (serverObj.variables) {
    for (const [key, value] of Object.entries(serverObj.variables)) {
      baseUrl = baseUrl.replace(`{${key}}`, value.default);
    }
  }
  return replaceDomainNameByEnvironment(baseUrl);
}

/**
 * Resolve path variables in a URL pattern
 */
export function resolvePath(pathPattern: string, pathVariables?: Record<string, string | number>): string {
  if (!pathVariables) {
    return pathPattern;
  }

  return pathPattern.replace(/{([^}]+)}/g, (match, key) => {
    const value = pathVariables[key];
    if (value === undefined) {
      throw new Error(`Missing path variable: ${key}`);
    }
    return String(value);
  });
}

/**
 * Prepare request data
 */
export function prepareRequestData(
  input: Record<string, unknown>,
  operation: OpenAPIV3.OperationObject,
  path: string,
): { resolvedPath: string; headers: Record<string, string>; params: Record<string, unknown>; data: unknown; } {
  let resolvedPath = path;
  const headers: Record<string, string> = {};
  const params: Record<string, unknown> = {};
  let data: unknown = undefined;
  const pathParams: Record<string, string> = {};

  let prop = input.properties as Record<string, unknown> || {};
  Object.entries(prop).forEach(([key, value]) => {
    if (key === SCHEMA_REQUEST_BODY) {
      data = value;
    } else {
      const paramDef = operation.parameters?.find(p =>
        !("$ref" in p) && p.name === key) as OpenAPIV3.ParameterObject | undefined;
      if (paramDef) {
        if (paramDef.in === "header") {
          headers[key] = String(value);
        } else if (paramDef.in === "query") {
          params[key] = value;
        } else if (paramDef.in === "path") {
          pathParams[key] = String(value);
        }
      }
    }
  });
  fillDefaultHeaderInfo(headers, false);
  if (Object.keys(pathParams).length > 0) {
    resolvedPath = resolvePath(resolvedPath, pathParams);
  }
  return { resolvedPath, headers, params, data };
}
