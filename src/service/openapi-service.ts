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
import { buildHeadersFromInput, buildFinalUrl, replaceDomainNameByEnvironment, formatAxiosError, buildBaseUrlFromOpenApi, prepareRequestData } from "../helper/http-helper.js";

const QUERY_API_TOOL_DISCRIPTION = `eBay Public API Search Tool

Purpose: Searches eBay's public APIs to find relevant endpoints, documentation, and implementation details for eBay marketplace integration.

When to use:
- When you need to find specific eBay API endpoints or methods
- When looking for API documentation, parameters, or response formats
- When researching eBay integration capabilities and limitations
- When comparing different eBay API options for a use case

Capabilities: This tool searches across eBay's public API ecosystem including:
- Selling APIs: Create/manage listings, inventory management, order fulfillment, shipping
- Buying APIs: Product discovery, shopping cart, checkout processes, bidding functionality
- Search APIs: Marketplace search, filtering, categorization, product lookup
- Affiliate APIs: Referral tracking, commission tools, traffic attribution
- Customer Service APIs: Feedback systems, messaging, dispute resolution
- Marketing APIs: Promoted listings, coupon creation, promotional campaigns

Input required: 
- Search query describing the desired API functionality or endpoint

Output format:
- List of OpenAPI specifications for related eBay APIs
- Each spec includes endpoint definitions, request/response schemas, and authentication requirements`;
const INVOKE_API_TOOL_DISCRIPTION = `eBay Public API Invocation Tool

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
    "query_ebay_api",
    QUERY_API_TOOL_DISCRIPTION,
    { prompt: z.string() },
    async (input) => {
      try {
        const url = util.format(RECALL_SPEC_BY_PROMPT_URL, encodeURIComponent(input.prompt));
        const resp = await axios.get(url, {
          headers: buildHeadersFromInput(undefined, false),
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
    "call_ebay_api",
    INVOKE_API_TOOL_DISCRIPTION,
    getInvokeApiSchema(),
    async (input, _extra: RequestHandlerExtra<ServerRequest, ServerNotification>) => {
      try {
        // Build headers
        const headers = buildHeadersFromInput(input.headers, true);
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


//-----------------------------------------prompt--------------------------------------------
/**
 * Register MCP prompts to guide LLM in using eBay API tools effectively
 */
function registerPrompts(server: McpServer): void {
  server.prompt(
    "interpret_user_request",
    "Convert abstract user requests into specific eBay API tool calls",
    {
      user_input: z.string().describe("The user's original request"),
    },
    async (args, _extra) => {
      const { user_input } = args;
      
      // analyze the user input to determine intent and suggest API calls
      const suggestions = analyzeUserIntent(user_input);
      
      return {
        messages: [
          {
            role: "assistant",
            content: {
              type: "text",
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