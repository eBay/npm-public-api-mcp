/**
 * OpenAPI helper functions, including loading OpenAPI documents,
 * parsing OpenAPI specs, building schemas, and converting to Zod schemas.
 */
import SwaggerParser from "@apidevtools/swagger-parser";
import { type OpenAPIV3 } from "openapi-types";
import * as fs from "fs";
import axios from "axios";
import * as yaml from "js-yaml";
import util from "util";
import { z, type ZodTypeAny } from "zod";


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
  console.error("Loading OpenAPI specifications from:", urls);
  // parse opebapi doc from url/path
  for (const specPath of urls) {
    try {
      const doc = await SwaggerParser.dereference(specPath) as OpenAPIV3.Document;
      docs.push(doc);
    } catch (e) {
      console.error(`getOpenApiDocumentsFromConfigFile#[Failed to load OpenAPI doc from the specPath : ${specPath}]`);
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
 * Parse OpenAPI document from string (supports both JSON and YAML)
 */
export async function parseOpenApiDoc(specTitle: string, operationId : string, specUrl: string): Promise<OpenAPIV3.Document> {
  const url = util.format(specUrl, specTitle, operationId);
  const apiSpecRes = await axios.get<string>(url,  {
    httpsAgent: new (await import("https")).Agent({
      rejectUnauthorized: false,
    })});
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
      console.error("failed to parse OpenAPI document !!!");
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
