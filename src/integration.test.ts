import {afterAll, beforeAll, describe, expect, it} from "vitest";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import * as path from "path";
import * as fs from "fs";

// Define interfaces for type safety
interface ContentPart {
  type: string;
  text: string;
}

interface CallToolResponse {
  content: ContentPart[];
  isError?: boolean;
}

describe("MCP Server Integration Tests", () => {
  let client: Client;
  let transport: StdioClientTransport;

  // Only setup the test environment if we're not skipping tests
  beforeAll(async () => {
    try {
      console.log("Setting up test client...");

      // Use the correct path to your server script
      // Make sure we're using node with the compiled JS file instead of ts-node
      const serverScriptPath = path.join(process.cwd(), "src", "index.ts");

      // Check if the file exists
      if (!fs.existsSync(serverScriptPath)) {
        throw new Error(`Server script not found at: ${serverScriptPath}`);
      }

      console.log(`Server script found at: ${serverScriptPath}`);

      // Create the transport with the correct path to the server
      transport = new StdioClientTransport({
        command: "node",
        args: [
          "--loader", "ts-node/esm",
          "--experimental-specifier-resolution=node",
          serverScriptPath,
        ],
      });

      // Initialize the client
      client = new Client({
        name: "test-client",
        version: "1.0.0",
      });

      console.log("Connecting to MCP server...");

      // Add a timeout to the connection attempt
      const connectionPromise = client.connect(transport);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Connection timed out after 15 seconds")), 15000);
      });

      await Promise.race([connectionPromise, timeoutPromise]);
      console.log("✅ Client connected successfully");

    } catch (error) {
      console.error("❌ Error during test setup:", error);
      // Explicitly failing the test setup
      throw error;
    }
  });

  afterAll(async () => {
    try {
      if (client) {
        console.log("Closing client connection...");
        await client.close();
        console.log("✅ Client closed successfully");
      }
    } catch (error) {
      console.error("❌ Error during test cleanup:", error);
    }
  });


  it("test list tools", async () => {
    const result = await client.listTools();
    console.log("Available tools:", result.tools.map(tool => tool.name));
    expect(result.tools.length).toBeGreaterThan(1);
  });

  it("test query api", async () => {
    const response = await client.callTool({
      name: "queryAPI",
      arguments: {
        prompt : "i wanna order api",
      },
    }) as CallToolResponse;

    expect(response).toBeDefined();
    expect(response.content).toBeDefined();
    expect(response.content.length).toBeGreaterThan(0);
  });

  it("test invoke api", async () => {
    const response = await client.callTool({
      name: "invokeAPI",
      arguments: {
        url: "https://api.sandbox.ebay.com/commerce/notification/v1/topic/MARKETPLACE_ACCOUNT_DELETION",
        method: "GET",
        headers: {},
        urlVariables: {},
        requestBody: {},
        token : process.env.EBAY_CLIENT_TOKEN
      },
    }) as CallToolResponse;

    expect(response).toBeDefined();
    expect(response.content).toBeDefined();
    expect(response.content.length).toBeGreaterThan(0);
  });

  it("test invoke api with pathVals", async () => {
    const response = await client.callTool({
      name: "invokeAPI",
      arguments: {
        url: "https://api.sandbox.ebay.com/commerce/notification/v1/subscription/{subscription_id}/test",
        method: "POST",
        headers: {},
        urlVariables: {"subscription_id":"1000"},
        requestBody: {},
        token: process.env.EBAY_CLIENT_TOKEN
      },
    }) as CallToolResponse;

    expect(response).toBeDefined();
    expect(response.content).toBeDefined();
    expect(response.content.length).toBeGreaterThan(0);
  });

});
