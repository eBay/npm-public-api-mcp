#!/usr/bin/env node
// Load environment variables from .env file
import * as dotenv from "dotenv";
dotenv.config();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerOpenApiTools } from "./service/openapi-service.js";
import { registerGraphQLTools } from "./service/graphql-service.js";
import { initializeTokenManager } from "./helper/token-manager.js";
import { logger } from "./helper/logger.js";


/**
 * Main function to initialize and run the eBay API MCP Server
 * This server exposes eBay API endpoints as MCP tools for access via AI models
 */
async function main(): Promise<void> {
  logger.info("Starting eBay API MCP Server...");
  logger.info(`Log file location: ${logger.getLogFilePath()}`);

  // Initialize token manager (validates configuration)
  initializeTokenManager();
  const server = initServer();

  try {
    // Register the OpenAPI tools with the server
    await registerOpenApiTools(server);
    logger.info("Successfully registered OpenAPI tools");

    // Register the GraphQL tools with the server
    await registerGraphQLTools(server);
    logger.info("Successfully registered GraphQL tools");

    // Create and connect server transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info("eBay API MCP Server running on stdio transport");

  } catch (error) {
    logger.error("Error starting MCP server", error);
    process.exit(1);
  }
}

// Run the server
main().catch((error) => {
  logger.error("Fatal error", error);
  process.exit(1);
});

// Cleanup on exit
process.on("exit", () => {
  logger.info("eBay API MCP Server shutting down...");
  logger.close();
});

process.on("SIGINT", () => {
  logger.info("Received SIGINT, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  logger.info("Received SIGTERM, shutting down gracefully...");
  process.exit(0);
});


// Create MCP server instance
function initServer(): McpServer {
  return new McpServer({
    name: "ebay-api-mcp-server",
    version: "1.2.0",
  });
}
