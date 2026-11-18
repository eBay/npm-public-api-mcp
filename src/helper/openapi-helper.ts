/**
 * OpenAPI helper functions, including loading OpenAPI documents,
 * parsing OpenAPI specs, building schemas, and converting to Zod schemas.
 */
import SwaggerParser from "@apidevtools/swagger-parser";
import { type OpenAPIV3 } from "openapi-types";
import * as fs from "fs";
import axios, { type AxiosResponse } from "axios";
import * as yaml from "js-yaml";
import util from "util";
import { z, type ZodTypeAny } from "zod";
import { buildHeadersFromInput, makeRequestWithTokenRefresh } from "../helper/http-helper.js";
import { logger } from "../helper/logger.js";
import { RECALL_SPEC_BY_PROMPT_URL } from "../constant/constants.js";



const SCHEMA_REQUEST_BODY = "requestBody";

/**
 * Get OpenAPI docs from user config file, which contains urls or paths of OpenAPI specs.
 */
export async function getOpenApiDocumentsFromConfigFile(): Promise<OpenAPIV3.Document[]> {
  const docs: OpenAPIV3.Document[] = [];
  const urlFile = process.env.EBAY_API_DOC_URL_FILE;
  let urls: string[] = [];
  if (urlFile && fs.existsSync(urlFile)) {
    // url or path each line in the file
    urls = fs.readFileSync(urlFile, "utf-8").split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith("#"));
  }
  logger.info(`Loading OpenAPI specifications from: ${urls.join(", ")}`);
  // parse opebapi doc from url/path
  for (const specPath of urls) {
    try {
      const doc = await SwaggerParser.dereference(specPath) as OpenAPIV3.Document;
      docs.push(doc);
    } catch (e) {
      logger.error(`getOpenApiDocumentsFromConfigFile#[Failed to load OpenAPI doc from the specPath : ${specPath}]`);
    }
  }
  return docs;
}

// Helper: remove ignored keys recursively
export function readSchema2Map(obj: unknown): unknown {
  const SCHEMA_IGNORE_KEYS = ["style", "explode", "exampleSetFlag", "types", "in", "required"];
  if (Array.isArray(obj)) {
    return obj.map(readSchema2Map);
  } else if (obj && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (!SCHEMA_IGNORE_KEYS.includes(k)) {
        out[k] = readSchema2Map(v);
      }
    }
    return out;
  }
  return obj;
}

/**
 * Query api spec and parse to OpenAPI document (supports both JSON and YAML)
 */
function parseDocString(docString: string): OpenAPIV3.Document | null {
  try {
    return JSON.parse(docString) as OpenAPIV3.Document;
  } catch (jsonError) {
    try {
      return yaml.load(docString) as OpenAPIV3.Document;
    } catch (yamlError) {
      return null;
    }
  }
}

function docContainsOperation(doc: OpenAPIV3.Document, operationId: string): boolean {
  if (!doc || !doc.paths) {
    return false;
  }
  for (const pathItem of Object.values(doc.paths)) {
    for (const method of ["get", "post", "put", "delete", "patch", "options", "head", "trace"] as const) {
      const operation = pathItem && (pathItem as Record<string, { operationId?: string }>)[method];
      if (operation && operation.operationId === operationId) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Fallback: resolve the OpenAPI document via the prompt-based spec search endpoint
 * (RECALL_SPEC_BY_PROMPT_URL) when the field-based spec lookup endpoint
 * (RECALL_SPEC_WITH_FIELD_URL) is unavailable (e.g. returns 404 for all inputs).
 */
async function queryAndParseOpenApiDocViaPromptSearch(specTitle: string, operationId: string): Promise<OpenAPIV3.Document | null> {
  const url = util.format(RECALL_SPEC_BY_PROMPT_URL, encodeURIComponent(`${specTitle} ${operationId}`));
  const headers = await buildHeadersFromInput(undefined, false);
  const apiSpecRes = await makeRequestWithTokenRefresh({
    method: 'GET',
    url,
    headers,
  });
  let items = apiSpecRes.data;
  if (typeof items === "string") {
    try {
      items = JSON.parse(items);
    } catch (jsonError) {
      items = [items];
    }
  }
  if (!Array.isArray(items)) {
    items = [items];
  }
  let firstMatchingDoc: OpenAPIV3.Document | null = null;
  for (const item of items) {
    const doc = parseDocString(item as string);
    if (!doc || !doc.paths || !docContainsOperation(doc, operationId)) {
      continue;
    }
    if (firstMatchingDoc === null) {
      firstMatchingDoc = doc;
    }
    if (doc.info && doc.info.title && specTitle &&
        doc.info.title.toLowerCase() === specTitle.toLowerCase()) {
      return doc;
    }
  }
  return firstMatchingDoc;
}

export async function queryAndParseOpenApiDoc(specTitle: string, operationId : string, specUrl: string): Promise<OpenAPIV3.Document> {
  const url = util.format(specUrl, specTitle, operationId);
  const headers = await buildHeadersFromInput(undefined, false);
  let apiSpecRes: AxiosResponse;
  try {
    apiSpecRes = await makeRequestWithTokenRefresh({
      method: 'GET',
      url,
      headers,
    });
  } catch (specError) {
    logger.error(`spec lookup failed for specTitle=[${specTitle}] operationId=[${operationId}], trying prompt search fallback`);
    const doc = await queryAndParseOpenApiDocViaPromptSearch(specTitle, operationId);
    if (doc) {
      return doc;
    }
    throw specError;
  }
  const docString = apiSpecRes.data;
  try {
    // Try parsing as JSON first
    return JSON.parse(docString) as OpenAPIV3.Document;
  } catch (jsonError) {
    try {
      // If JSON fails, try parsing as YAML
      return yaml.load(docString) as OpenAPIV3.Document;
    } catch (yamlError) {
      const _jsonMsg = jsonError instanceof Error ? jsonError.message : String(jsonError);
      const _yamlMsg = yamlError instanceof Error ? yamlError.message : String(yamlError);
      logger.error("failed to parse OpenAPI document !!!");
      return {} as OpenAPIV3.Document;
    }
  }
}

/**
 * Build schema for an operation's input parameters
 */
export function buildOperationSchema(operation: OpenAPIV3.OperationObject): { properties: Record<string, unknown> } {
  const properties: Record<string, unknown> = {};
  // handle request param
  (operation.parameters || []).forEach(param => {
    if ("$ref" in param) {return;}
    const paramSchema = readSchema2Map(param);
    properties[param.name] = paramSchema;
  });
  // handle request body
  if (operation.requestBody && "content" in operation.requestBody &&
      operation.requestBody.content?.["application/json"]?.schema) {
    const requestBodySchema = readSchema2Map(operation.requestBody.content["application/json"].schema);
    properties[SCHEMA_REQUEST_BODY] = requestBodySchema;
  }
  return { properties };
}

/**
 * Build Zod validation schema
 */
export function buildZodSchema(properties: Record<string, unknown>): Record<string, ZodTypeAny> {
  const zodProperties: Record<string, ZodTypeAny> = {};

  Object.keys(properties).forEach(key => {
    zodProperties[key] = z.any();
  });

  return zodProperties;
}
