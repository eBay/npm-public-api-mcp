/**
 * OpenAPI service for registering tools with MCP server
 */
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type OpenAPIV3 } from "openapi-types";
import { type RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { type ServerNotification, type ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { z, type ZodTypeAny } from "zod";
import axios from "axios";
import util from "util";
import { RECALL_SPEC_BY_PROMPT_URL, RECALL_SPEC_WITH_FIELD_URL, SUPPORTED_CALLING_METHODS, findApiEnvironmentByValue } from "../constant/constants.js";
import { getOpenApiDocumentsFromConfigFile, parseOpenApiDoc, buildOperationSchema, buildZodSchema } from "../helper/openapi-helper.js";
import { validateRequestParameters as validateRequestParametersFromHelper } from "../helper/validation-helper.js";
import { buildHeadersFromInput, buildFinalUrl, replaceDomainNameByEnvironment, formatAxiosError, buildBaseUrlFromOpenApi, prepareRequestData } from "../helper/http-helper.js";

const USER_ENVIRONMENT = findApiEnvironmentByValue(process.env.EBAY_API_ENV || "");
const QUERY_API_TOOL_DISCRIPTION = "Send user prompt to remote service and return recommended API spec info (GET, query param, path...). " +
                                            "Only output the tool response. Don't add any unnecessary text to it.";
const INVOKE_API_TOOL_DISCRIPTION = "this tool requires the prior invocation of tool queryAPI to ensure proper context, please ensure tool queryAPI has been successfully executed before using this tool." +
                                            "the output of tool queryAPI will be used to generate input parameter of this tool. please ensure each field type of input parameter complies with the specifications required by the api spec." +
                                            "after validation , this tool will invoke eBay OpenAPI and return the result." +
                                            "if the tool return error, please check the error info and give advice or fix it.";


/**
 * Register OpenAPI tools with MCP server
 */
export async function registerOpenApiTools(server: McpServer): Promise<void> {
  // Load OpenAPI document
  const openapis = await getOpenApiDocumentsFromConfigFile();
  for (const doc of openapis) {
    registerOpenApiDynamicTools(server, doc);
  }
  registerCustomTools(server);
}

/**
 * register OpenAPI tools dynamically based on the OpenAPI document
 */
function registerOpenApiDynamicTools(server: McpServer, openapi: OpenAPIV3.Document): void {
  const baseUrl = buildBaseUrlFromOpenApi(openapi);

  Object.entries(openapi.paths || {})
    .filter(([_, pathItem]) => pathItem !== undefined)
    .forEach(([path, pathItem]) => registerPathOperations(server, baseUrl, path, pathItem!));
}


/**
 * Register tools for operations in a specific path
 */
function registerPathOperations(
  server: McpServer,
  baseUrl: string,
  path: string,
  pathItem: OpenAPIV3.PathItemObject,
): void {
  const supportedMethods = Object.keys(pathItem)
    .filter(method => SUPPORTED_CALLING_METHODS[USER_ENVIRONMENT].includes(method));

  supportedMethods.forEach(method => {
    const operation = pathItem[method as keyof typeof pathItem] as OpenAPIV3.OperationObject;
    if (operation && operation.operationId) {
      registerOperation(server, baseUrl, path, method, operation);
    }
  });
}

/**
 * Register tool for a single API operation
 */
function registerOperation(
  server: McpServer,
  baseUrl: string,
  path: string,
  method: string,
  operation: OpenAPIV3.OperationObject,
): void {
  const properties = buildOperationSchema(operation);
  const zodProperties = buildZodSchema(properties);
  server.tool(
    operation.operationId || "unknownOperation",
    operation.description || "No description",
    zodProperties,
    async (input:Record<string, unknown>, _extra) => {
      try {
        const { resolvedPath, headers, params, data } = prepareRequestData(input, operation, path);
        const url = baseUrl + resolvedPath;
        const resp = await axios.request({
          url,
          method,
          headers,
          params,
          data,
          httpsAgent: new (await import("https")).Agent({
            rejectUnauthorized: false,
          })
        });
        return {
          content: [
            { type: "text" as const, text: typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data, null, 2) },
          ],
        };
      } catch (error) {
        return {
          content: [
            { type: "text" as const, text: `Error in invokeOpenAPI tool: ${formatAxiosError(error)}` },
          ],
          isError: true,
        };
      }
    },
  );
}

/**
 * Register custom API tools to enable interaction with eBay OpenAPI services
 * This function registers two primary tools:
 * 1. queryAPI - For discovering API specifications
 * 2. invokeAPI - For executing API calls with validation
 */
function registerCustomTools(server: McpServer): void {
  registerQueryApiTool(server);
  registerInvokeApiTool(server);
}

/**
 * Register a tool for querying API specifications based on natural language prompts
 * Only registered when no custom API doc URL file is provided
 */
function registerQueryApiTool(server: McpServer): void {
  const hasCustomDoc = process.env.EBAY_API_DOC_URL_FILE;
  if (hasCustomDoc) {return;}

  server.tool(
    "queryAPI",
    QUERY_API_TOOL_DISCRIPTION,
    { prompt: z.string() },
    async (input) => {
      try {
        const url = util.format(RECALL_SPEC_BY_PROMPT_URL, encodeURIComponent(input.prompt));
        const resp = await axios.get(url, {
          httpsAgent: new (await import("https")).Agent({
            rejectUnauthorized: false,
          }),
        });
        return {
          content: [
              { type: "text" as const, text: resp.data ? (typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data, null, 2)) : "No response body" }
          ],
        };
      } catch (error) {
        return {
          content: [
            { type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` },
          ],
          isError: true,
        };
      }
    },
  );
}

/**
 * Register a tool for executing API calls with proper validation and error handling
 */
function registerInvokeApiTool(server: McpServer): void {
  server.tool(
    "invokeAPI",
    INVOKE_API_TOOL_DISCRIPTION,
    getInvokeApiSchema(),
    async (input, _extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
      try {
        // Build headers
        const headers = buildHeadersFromInput(input.headers);
        // query and parse apiSpec by specTitle and operationId
        const openApiDoc = await parseOpenApiDoc(input.specTitle, input.operationId, RECALL_SPEC_WITH_FIELD_URL);
        const replacedDomainUrl = replaceDomainNameByEnvironment(input.url);

        // Validate req parameters against OpenAPI spec
        const reqParamValidation = validateRequestParametersFromHelper(replacedDomainUrl, openApiDoc, input.method, {
          urlVariables: input.urlVariables,
          urlQueryParams: input.urlQueryParams,
          headers,
          requestBody: input.requestBody,
        });
        if (!reqParamValidation.isValid) {
          return {
            content: [
              { type: "text" as const, text: "Request validation failed:" },
              { type: "text" as const, text: reqParamValidation.errors.join("\n") },
            ],
            isError: true,
          };
        }

        // Make the API request
        const resp = await axios.request({
          url : buildFinalUrl(replacedDomainUrl, input.urlVariables),
          method: input.method,
          headers,
          params: input.urlQueryParams,
          data : input.requestBody,
          httpsAgent: new (await import("https")).Agent({
            rejectUnauthorized: false,
          }),
        });

        return {
          content: [
            { type: "text" as const, text: resp.data ? (typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data, null, 2)) : "No response body" },
          ],
        };
      } catch (error) {
        return {
          content: [
            { type: "text" as const, text: `Error in invokeOpenAPI tool: ${formatAxiosError(error)}` },
          ],
          isError: true,
        };
      }
    },
  );
}

/**
 * Define the schema for invokeAPI tool parameters
 */
function getInvokeApiSchema(): Record<string, ZodTypeAny> {
  return {
    url: z.string().describe("The complete request API URL, url and basePath need to be put in together. don't replace path variables, maintain variables such as {item_id}, the variable will be replaced by urlVariables input in tool."),
    method: z.string().describe("The request API method (GET, POST, PUT, DELETE, ...)"),
    headers: z.record(z.string(), z.array(z.string())).optional().describe("The API header params"),
    urlVariables: z.record(z.string(), z.any()).optional().describe("The API path variables"),
    urlQueryParams: z.record(z.string(), z.string()).optional().describe("The API query parameters"),
    requestBody: z.record(z.string(), z.any()).optional().describe("The API request body"),
    specTitle: z.string().describe("The OpenAPI spec title from info.title"),
    operationId: z.string().describe("The OpenAPI operationId"),
  };
}



