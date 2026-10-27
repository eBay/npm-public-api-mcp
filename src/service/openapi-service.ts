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
import { RECALL_SPEC_BY_PROMPT_URL, RECALL_SPEC_WITH_FIELD_URL, SUPPORTED_CALLING_METHODS, USER_ENVIRONMENT } from "../constant/constants.js";
import { getOpenApiDocumentsFromConfigFile, queryAndParseOpenApiDoc, buildOperationSchema, buildZodSchema } from "../helper/openapi-helper.js";
import { validateRequestParameters as validateRequestParametersFromHelper } from "../helper/validation-helper.js";
import { buildHeadersFromInput, buildFinalUrl, replaceDomainNameByEnvironment, formatAxiosError, buildBaseUrlFromOpenApi, prepareRequestData, makeRequestWithTokenRefresh } from "../helper/http-helper.js";

const QUERY_API_TOOL_DESCRIPTION = `eBay OpenAPI/REST API Search Tool

Searches eBay REST/OpenAPI APIs for endpoints, docs, parameters, schemas, and auth requirements.

Use for REST/OpenAPI requests or when you need details about an eBay REST endpoint.

Routing:
- REST/OpenAPI specified: use this tool only.
- GraphQL specified: use the GraphQL tool instead.
- API type unspecified: call this tool and query_ebay_graphql tool in parallel, then compare.

Input:
- Natural-language query.

Returns:
- Relevant eBay REST/OpenAPI specs and endpoint details.`;

const INVOKE_API_TOOL_DESCRIPTION = `eBay Public API Invocation Tool

Purpose: Executes actual calls to eBay's public APIs using known OpenAPI specifications to retrieve real data and fulfill user requests.

When to use:
- When you have a specific eBay API endpoint and its OpenAPI specification in the current context
- When you need to fetch actual data from eBay (not just API documentation)
- When fulfilling user requests that require live eBay marketplace data
- After using the search tool to identify the correct API endpoint

Prerequisites:
- The target API's OpenAPI specification must be available in the current context
- If the OpenAPI spec is unknown, use the eBay API search tool first

Input requirements:
- Request parameters that strictly comply with the OpenAPI specification data types
- Request body (if required) formatted according to the OpenAPI schema

Expected workflow:
1. Use search tool to find relevant eBay API if specification is unknown
2. Extract parameter requirements from the OpenAPI spec
3. Execute the API call with properly formatted data

Output format:
- JSON response data from the eBay API
- HTTP status codes and response headers
- Error details and troubleshooting guidance if the call fails

Error handling:
- If the tool returns authentication and authorization issues, stop the tool and ask user to use token with required auth scopes.
- If the tool returns an error, analyze the error message and adjust the request parameters according to the API specification, and retry. 
`;


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
  registerPrompts(server);
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
  const inputSchema = zodProperties;

  server.registerTool(
    operation.operationId || "unknownOperation",
    {
      description: operation.description || "No description",
      inputSchema: inputSchema as any
    },
    async (input: any, _extra: any) => {
      try {
        const { resolvedPath, headers, params, data } = await prepareRequestData(input, operation, path);
        const url = baseUrl + resolvedPath;
        const resp = await makeRequestWithTokenRefresh({
          url,
          method,
          headers,
          params,
          data
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

  const inputSchema = { prompt: z.string() };

  server.registerTool(
    "query_ebay_api",
    {
      description: QUERY_API_TOOL_DESCRIPTION,
      inputSchema: inputSchema as any
    },
    async (input: any) => {
      try {
        const url = util.format(RECALL_SPEC_BY_PROMPT_URL, encodeURIComponent(input.prompt));
        const headers = await buildHeadersFromInput(undefined, false);
        const resp = await makeRequestWithTokenRefresh({
          url,
          method: 'GET',
          headers
        });
        return {
          content: [
              { type: "text" as const, text: resp.data ? (typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data, null, 2)) : "No response body" }
          ],
        };
      } catch (error) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` },
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
  const inputSchema = getInvokeApiSchema();

  server.registerTool(
    "call_ebay_api",
    {
      description: INVOKE_API_TOOL_DESCRIPTION,
      inputSchema: inputSchema as any
    },
    async (input: any, _extra: any) => {
      try {
        // Build headers
        const headers = await buildHeadersFromInput(input.headers, true);
        // query and parse apiSpec by specTitle and operationId
        const openApiDoc = await queryAndParseOpenApiDoc(input.specTitle, input.operationId, RECALL_SPEC_WITH_FIELD_URL);
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

        // Make the API request with automatic token refresh on 401
        const resp = await makeRequestWithTokenRefresh({
          url : buildFinalUrl(replacedDomainUrl, input.urlVariables),
          method: input.method,
          headers,
          params: input.urlQueryParams,
          data : input.requestBody
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


//-----------------------------------------prompt--------------------------------------------
/**
 * Register MCP prompts to guide LLM in using eBay API tools effectively
 */
function registerPrompts(server: McpServer): void {
  const argsSchema = {
    user_input: z.string().describe("The user's original request"),
  };

  server.registerPrompt(
    "interpret_user_request",
    {
      description: "Convert abstract user requests into specific eBay API tool calls",
      argsSchema: argsSchema as any
    },
    async (args: any) => {
      const { user_input } = args;

      // analyze the user input to determine intent and suggest API calls
      const suggestions = analyzeUserIntent(user_input);

      return {
        messages: [
          {
            role: "assistant" as const,
            content: {
              type: "text" as const,
              text: suggestions
            }
          }
        ]
      };
    }
  );
}


function analyzeUserIntent(userInput: string): string {
  return `Request: "${userInput}"

       Available eBay API tools:
      - **query_ebay_api**: Search for API specifications using natural language descriptions
      - **call_ebay_api**: Execute actual API calls using discovered specifications

      Task: Analyze the user's intent and directly use the appropriate tool(s). 

      For query_ebay_api, use descriptive prompts that explain what functionality you're looking for (e.g., describe the type of operation, data, or capability the user needs).

      Proceed immediately with the most suitable approach.`;
}