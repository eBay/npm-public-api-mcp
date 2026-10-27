/**
 * GraphQL service for registering tools with MCP server
 */
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios from "axios";
import {
  USER_ENVIRONMENT,
  GRAPHQL_ENDPOINTS,
  GRAPHQL_SEARCH_URL,
  GRAPHQL_VALIDATION_URL,
  SUPPORTED_GRAPHQL_OPERATIONS,
} from "../constant/constants.js";
import { getAccessToken } from "../helper/token-manager.js";
import { logger } from "../helper/logger.js";
import { makeRequestWithTokenRefresh } from "../helper/http-helper.js";

const QUERY_GRAPHQL_TOOL_DESCRIPTION = `eBay GraphQL Schema Search Tool

Searches eBay GraphQL schema and returns SDL.

Use for GraphQL queries, mutations, types, and fields.

Routing:
- GraphQL specified: use this tool.
- REST/OpenAPI specified: use the REST tool instead.
- API type unspecified: call this tool and the query_ebay_api tool in parallel, then compare.

IMPORTANT: Detect non-specific requests
Only proceed with tool call when user provides specific intent.
If user asks for broad, non-specific information, ask them to be more specific:
DO NOT call this tool for:
  - "Show me all root queries"
Instead, ask user:
  - "What specific operation/type/field are you looking for? The schema is large"

Prompt format:
Rule 1: If user wants to perform an operation (get, fetch, list, update, create, etc.) → Operation format
  - Build natural language description including: action, ROOT entity, parameters
  - Format: "GraphQL {Query|Mutation} can be used to {action with qualifiers}"
  - Preserve semantic qualifiers (e.g., "by id", "by ids", "by status")
  - If user also needs specific fields → append \`| field1 field2\`
  

Rule 2: If user wants to EXPLORE a type/field (not do an operation) → Plain natural language
  - Examples: "Order type", "what fields in User", "CartItem structure"

EXAMPLES
- Query with specific fields:
    User: "Get autoDeclineThresholdAmount in bestOfferTerms for listing 1001"
    You:  "GraphQL Query to get listing by id | bestOfferTerms autoDeclineThresholdAmount"

- Simple Query:
    User: "Get my shopping cart"
    You:  "GraphQL Query to get shopping cart"

- Mutation with action qualifier:
    User: "Update product inventory quantity"
    You:  "GraphQL Mutation to update product inventory | inventory quantity"

- Type exploration:
    User: "What fields are in the Order type?"
    You:  "GraphQL Object Type named Order"`;

const CALL_GRAPHQL_TOOL_DESCRIPTION = `eBay GraphQL API Execution Tool

Executes GraphQL queries/mutations with automatic validation.

Prerequisites:
- MUST call query_ebay_graphql first to get schema

Input parameters:
- query: GraphQL query/mutation string (use EXACT field names from schema)
- variables: Query variables as JSON object 
  * Must provide values for all required variables (marked with !)
- operationName: Optional (rarely needed)

VALIDATION:
- This tool automatically validates your query before execution
- Validation passes → query executes normally
- Validation fails → you receive error with specific incorrect fields
- When validation fails: fix based on error message, then retry

FIXING VALIDATION ERRORS:
1. Check previously retrieved schema for the needed type/field
   → Found: Use existing schema directly (no new query_ebay_graphql call needed)
   → Not found: Call query_ebay_graphql to search for it

CRITICAL RULES:
- NEVER guess field names
- ONLY use exact names from schema (query_ebay_graphql)`;

/**
 * Register GraphQL tools with MCP server
 */
export async function registerGraphQLTools(server: McpServer): Promise<void> {
  registerQueryGraphQLTool(server);
  registerCallGraphQLTool(server);
  registerGraphQLPrompts(server);
}

/**
 * Register a tool for querying GraphQL schema based on natural language prompts
 */
function registerQueryGraphQLTool(server: McpServer): void {
  const inputSchema = {
    prompt: z.string().describe("Natural language description of what GraphQL operation you need"),
    operationType: z.enum(["Query", "Mutation", "Both", "Schema"]).optional().describe(
          `ANALYZE user intent carefully BEFORE setting this field:
                        - "Query" - User wants to READ/FETCH data (e.g., "get products")
                        - "Mutation" - User wants to WRITE/MODIFY data (e.g., "create listing")
                        - "Both" - User wants BOTH read and write operations
                        - "Schema" - User wants to EXPLORE types/fields WITHOUT doing actual operations (e.g., "What fields are in Order type?")`
    )
  };

  server.registerTool(
    "query_ebay_graphql",
    {
      description: QUERY_GRAPHQL_TOOL_DESCRIPTION,
      inputSchema: inputSchema as any
    },
    async (input: any) => {
      try {
        const token = await getAccessToken();

        // Build request parameters
        const params: Record<string, string> = {
          prompt: input.prompt
        };

        // Add operationType if provided
        if (input.operationType) {
          params.operationType = input.operationType;
        }

        // Log request details for debugging
        logger.debug("=== GraphQL Schema Search Request info start===");
        logger.debug("Prompt:", input.prompt);
        logger.debug("Operation Type:", input.operationType ?? "Not specified (schema exploration)");
        logger.debug("=====GraphQL Schema Search Request info end===");

        // Make request with automatic token refresh on 401
        const resp = await makeRequestWithTokenRefresh({
          method: 'GET',
          url: GRAPHQL_SEARCH_URL,
          params,
          headers: {
            Authorization: `Bearer ${token}`,
          }
        });

        // Format response with guidance
        const responseData = resp.data
          ? typeof resp.data === "string"
            ? resp.data
            : JSON.stringify(resp.data, null, 2)
          : "No response body";

        const guidanceText = `
                  GraphQL Schema (SDL):
                  
                  ${responseData}
                  
                  PLEASE NOTICE:
                  BEFORE responding to the user, you MUST re-evaluate the relevance of the returned
                  operations/types against the user's original question:
                   - Does the returned schema actually answer what the user asked for?
                   - Are the operations/types relevant to the user's intent?
                   - If the results don't match the user's question well, explain the mismatch clearly
                  DO NOT blindly present results - verify they are truly relevant first.`;
        return {
          content: [
            {
              type: "text" as const,
              text: guidanceText,
            },
          ],
        };
      } catch (error) {
        // Log detailed error information
        logger.debug("=== GraphQL Schema Search Error Debug Info ===");
        if (axios.isAxiosError(error)) {
          logger.debug(`Status Code: ${error.response?.status ?? "No status"}`);
          logger.debug(`Status Text: ${error.response?.statusText ?? "No status text"}`);
          logger.debug(`Request Params: ${error.config?.params ? JSON.stringify(error.config.params) : "No params"}`);
          logger.debug(`Response Headers: ${error.response?.headers ? JSON.stringify(error.response.headers, null, 2) : "No headers"}`);
          logger.debug(`Response Data: ${error.response?.data ? (typeof error.response.data === "string" ? error.response.data : JSON.stringify(error.response.data, null, 2)) : "No data"}`);
        } else {
          logger.debug(`Error: ${error instanceof Error ? error.message : String(error)}`);
          logger.debug(`Stack: ${error instanceof Error ? (error.stack ?? "N/A") : "N/A"}`);
        }
        return {
          content: [
            {
              type: "text" as const,
              text: axios.isAxiosError(error)
                ? `Error querying GraphQL schema (HTTP ${error.response?.status}): ${error.message}\nURL: ${error.config?.url}\nResponse: ${typeof error.response?.data === "string" ? error.response?.data : JSON.stringify(error.response?.data, null, 2)}`
                : `Error querying GraphQL schema: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Register a tool for executing GraphQL queries/mutations
 */
function registerCallGraphQLTool(server: McpServer): void {
  const inputSchema = {
    query: z.string().describe("The GraphQL query or mutation string"),
    variables: z.record(z.string(), z.any()).optional().describe("Variables for the GraphQL operation"),
    operationName: z.string().optional().describe("Name of the operation to execute (if query contains multiple operations)"),
  };

  server.registerTool(
    "call_ebay_graphql",
    {
      description: CALL_GRAPHQL_TOOL_DESCRIPTION,
      inputSchema: inputSchema as any
    },
    async (input: any) => {
      try {
        const query = input.query.trim();

        // Validate operation type based on environment
        const operationType = detectOperationType(query);
        if (!isOperationAllowed(operationType)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: ${operationType} operations are not allowed in ${USER_ENVIRONMENT} environment. Allowed operations: ${SUPPORTED_GRAPHQL_OPERATIONS[USER_ENVIRONMENT].join(", ")}`,
              },
            ],
            isError: true,
          };
        }

        // Get access token for both validation and execution
        const token = await getAccessToken();

        // Step 1: Validate the query before executing
        logger.debug("=== GraphQL Query Validation ===");
        logger.debug("Query to validate:", query);

        const validationResp = await makeRequestWithTokenRefresh({
          method: 'POST',
          url: GRAPHQL_VALIDATION_URL,
          data: {
            query: query.replace(/\n/g, " ").replace(/\s+/g, " ").trim()
          },
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        });

        logger.debug("Validation response:", JSON.stringify(validationResp.data, null, 2));

        // Check validation result
        if (!validationResp.data.valid) {
          const errors = validationResp.data.errors || [];
          const errorMessages = errors.map((err: { field?: string; message?: string; suggestion?: string }) => {
            return `Field: ${err.field || "unknown"}\nMessage: ${err.message || "unknown error"}\nSuggestion: ${err.suggestion || "Check the schema"}`;
          }).join("\n\n");

          return {
            content: [
              {
                type: "text" as const,
                text: `GraphQL Query Validation Failed\n\nThe query contains invalid fields or syntax errors. Please review the following errors and adjust the query:\n\n${errorMessages}\n\n🔧 What to do next:\n\n1. FIRST: Check if previously retrieved schema contains the needed type/field info\n   → If YES: Use that existing schema info directly to fix the query\n   → If NO: Call query_ebay_graphql to search for the missing type/field\n\n2. Verify the exact field names from the schema (never guess field names)\n\n3. Rebuild the query using only the verified field names\n\n4. Try calling call_ebay_graphql again with the corrected query\n\nOriginal Query:\n${query}`,
              },
            ],
            isError: true,
          };
        }

        logger.debug("✅ Query validation passed");

        // Step 2: Execute the validated query
        // Get the appropriate endpoint for current environment
        const endpoint = GRAPHQL_ENDPOINTS[USER_ENVIRONMENT];
        // Log request details
        logger.debug("=== GraphQL Request Debug Info ===");
        logger.debug("Query:", query);
        logger.debug("Variables:", JSON.stringify(input.variables));
        logger.debug("==================================");

        // Execute GraphQL request with automatic token refresh on 401
        const resp = await makeRequestWithTokenRefresh({
          method: 'POST',
          url: endpoint,
          data: {
            query: query,
            variables: input.variables || {},
            operationName: input.operationName,
          },
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          }
        });

        // Log complete response information
        logger.debug("=== GraphQL Response Debug Info ===");
        logger.debug("Status Code:", resp.status);
        logger.debug("Status Text:", resp.statusText);
        logger.debug("Response Headers:", JSON.stringify(resp.headers, null, 2));
        logger.debug("Response Data:", typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data, null, 2));
        logger.debug("Has Errors:", resp.data?.errors ? "Yes" : "No");
        if (resp.data?.errors) {
          logger.debug("Error Count:", resp.data.errors.length);
          logger.debug("Errors Detail:", JSON.stringify(resp.data.errors, null, 2));
        }
        logger.debug("Has Data:", resp.data?.data ? "Yes" : "No");
        if (resp.data?.data) {
          logger.debug("Data Detail:", JSON.stringify(resp.data.data, null, 2));
        }
        logger.debug("===================================");

        // Check for GraphQL errors in response
        if (resp.data?.errors && resp.data.errors.length > 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `GraphQL Errors:\n${JSON.stringify(resp.data.errors, null, 2)}\n\nPartial Data:\n${JSON.stringify(resp.data.data, null, 2)}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: resp.data
                ? typeof resp.data === "string"
                  ? resp.data
                  : JSON.stringify(resp.data, null, 2)
                : "No response body",
            },
          ],
        };
      } catch (error) {
        if (axios.isAxiosError(error)) {
          const status = error.response?.status;
          const statusText = error.response?.statusText;
          const data = error.response?.data;
          const headers = error.response?.headers;
          const requestData = error.config?.data;

          logger.debug("=== GraphQL Error Debug Info ===");
          logger.debug(`Status Code: ${status ?? "No status"}`);
          logger.debug(`Status Text: ${statusText ?? "No status text"}`);
          logger.debug(`Request Body: ${requestData ?? "No request body"}`);
          logger.debug(`Response Headers: ${headers ? JSON.stringify(headers, null, 2) : "No headers"}`);
          logger.debug(`Response Data Type: ${data ? typeof data : "undefined"}`);
          logger.debug(`Response Data: ${data ? (typeof data === "string" ? data : JSON.stringify(data, null, 2)) : "No data"}`);
          logger.debug(`Error Message: ${error.message}`);
          logger.debug(`Error Code: ${error.code ?? "No error code"}`);
          logger.debug("================================");

          return {
            content: [
              {
                type: "text" as const,
                text: `GraphQL API Error (HTTP ${status ?? "unknown"}):\n${typeof data === "string" ? data : JSON.stringify(data, null, 2)}`,
              },
            ],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Error calling GraphQL API: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

/**
 * Detect the operation type from a GraphQL query string
 */
function detectOperationType(query: string): "query" | "mutation" | "unknown" {
  const trimmedQuery = query.trim().toLowerCase();

  if (trimmedQuery.startsWith("mutation")) {
    return "mutation";
  }

  if (trimmedQuery.startsWith("query") || trimmedQuery.startsWith("{")) {
    return "query";
  }

  return "unknown";
}

/**
 * Check if an operation type is allowed in the current environment
 */
function isOperationAllowed(operationType: string): boolean {
  const allowedOps = SUPPORTED_GRAPHQL_OPERATIONS[USER_ENVIRONMENT];
  return allowedOps.includes(operationType.toLowerCase());
}

//-----------------------------------------prompt--------------------------------------------
/**
 * Register MCP prompts to guide LLM in using eBay GraphQL API tools effectively
 */
function registerGraphQLPrompts(server: McpServer): void {
  const argsSchema = {
    user_input: z.string().describe("The user's original request"),
  };

  logger.info("Registering GraphQL prompt: interpret_graphql_request");

  server.registerPrompt(
    "interpret_graphql_request",
    {
      description: "Convert abstract user requests into specific eBay GraphQL API tool calls",
      argsSchema: argsSchema as any
    },
    async (args: any) => {
      const { user_input } = args;

      // analyze the user input to determine intent and suggest GraphQL API calls
      const suggestions = analyzeGraphQLUserIntent(user_input);

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

  logger.info("GraphQL prompt 'interpret_graphql_request' registered successfully");
}

function analyzeGraphQLUserIntent(userInput: string): string {
  return `Request: "${userInput}"

Available tools:
• query_ebay_graphql - Search schema using natural language
• call_ebay_graphql - Execute queries/mutations with auto-validation

Workflow:
1. Schema exploration → query_ebay_graphql only
2. Execute operations → query_ebay_graphql + call_ebay_graphql

Remember: Use exact field names from schema. Never guess.`;
}