# eBay API MCP Server

A Model Context Protocol (MCP) server that provides seamless integration with eBay's APIs through AI assistants and development tools.

## Overview

This MCP server enables AI assistants (Claude Desktop, Cursor, Cline, VS Code extensions, etc.) to interact with eBay's comprehensive API ecosystem. It provides tools for API document retrieval, endpoint discovery, and direct API invocation, making it easy to integrate eBay marketplace functionality into AI-powered workflows.

### Key Features

- **API Discovery**: Automatically discover and explore eBay API endpoints
- **Dynamic Tool Generation**: Generate tools based on OpenAPI specifications
- **Multi-Environment Support**: Works with both sandbox and production environments
- **Comprehensive API Coverage**: Supports eBay's full API ecosystem
- **Type-Safe Operations**: Built with TypeScript for robust API interactions
- **MCP Integration**: Compatible with popular MCP hosts and AI assistants

## Prerequisites

- **Node.js**: Version 22 or higher
- **eBay Developer Account**: Required for API access tokens
- **MCP Host**: Claude Desktop, Cursor, Cline, or other MCP-compatible application

## Installation

### 1. Clone and Setup

```bash
git clone <repository-url>
cd ebay-api-mcp-server-node-local
npm install
```

### 2. Build the Project

```bash
npm run build
# or
yarn build
```

### 3. Environment Configuration

Set the following environment variables:

- `EBAY_CLIENT_TOKEN`: Your eBay API access token (required)
- `EBAY_API_ENV`: API environment - "sandbox" or "production" (default: "production")

## Authentication

### Obtaining an eBay API Token

#### Method 1: Using cURL

```bash
curl -v https://api.ebay.com/identity/v1/oauth2/token \
  -H "Accept: application/json" \
  -H "Accept-Language: en_US" \
  -u "CLIENT_ID:CLIENT_SECRET" \
  -d "grant_type=client_credentials"
```

For sandbox testing, use `https://api.sandbox.ebay.com/identity/v1/oauth2/token`

#### Method 2: Using Postman

1. Create a POST request to `https://api.ebay.com/identity/v1/oauth2/token`
2. Set Authorization to Basic Auth with your Client ID and Client Secret
3. Add form data: `grant_type=client_credentials`
4. Send the request

Response format:
```json
{
    "access_token": "your_access_token_here",
    "expires_in": 7200,
    "token_type": "Application Access Token"
}
```

## Usage

### Running the Server

#### With Environment Variables Set

```bash
npm start
# or
yarn start
```

#### With Inline Environment Variables

```bash
EBAY_CLIENT_TOKEN='your_token_here' EBAY_API_ENV='production' npm start
```

#### Using npx

You can also run the server using `npx` in several ways:

**Option 1: Run the built server directly**
```bash
# First build the project
npm run build

# Then run with npx
npx node dist/index.js
```

**Option 2: Run with environment variables**
```bash
# Build first
npm run build

# Run with environment variables
EBAY_CLIENT_TOKEN='your_token_here' EBAY_API_ENV='production' npx node dist/index.js
```

**Option 3: Use npx to run npm scripts**
```bash
npx npm run build
npx npm start
```

**Option 4: Run TypeScript directly (if you have ts-node)**
```bash
npx ts-node src/index.ts
```

## MCP Integration

### Configuration for Popular MCP Hosts

#### VS Code with MCP Extension

1. Create a `.vscode` folder in your project root
2. Create `mcp.json` with the following configuration:

```json
{
    "servers": {
        "ebay-api-mcp-server": {
            "type": "stdio",
            "command": "node",
            "args": ["./dist/index.js"],
            "env": {
                "EBAY_API_ENV": "production",
                "EBAY_CLIENT_TOKEN": "YOUR_ACCESS_TOKEN"
            }
        }
    }
}
```

#### Claude Desktop

Add to your Claude Desktop MCP configuration:

```json
{
    "mcpServers": {
        "ebay-api": {
            "command": "node",
            "args": ["/path/to/ebay-api-mcp-server/dist/index.js"],
            "env": {
                "EBAY_CLIENT_TOKEN": "YOUR_ACCESS_TOKEN",
                "EBAY_API_ENV": "production"
            }
        }
    }
}
```

#### Cursor

Configure in your Cursor MCP settings with similar JSON structure as above.

### Example Usage

Once configured, you can ask your AI assistant to:

- "Find an API for marketplace account deletion notifications"
- "Search for product listing APIs"
- "Get documentation for the Trading API"
- "Invoke the getBuyerRequirements endpoint"

## Troubleshooting

### Common Issues

**Authentication Errors**
- Verify your `EBAY_CLIENT_TOKEN` is valid and not expired
- Ensure you're using the correct environment (sandbox vs production)
- Check that your eBay developer account has the necessary permissions

**MCP Connection Issues**
- Verify the path to `dist/index.js` in your MCP configuration
- Ensure Node.js is in your system PATH
- Check that the server builds successfully with `npm run build`

**API Errors**
- Review eBay API documentation for endpoint-specific requirements
- Verify your token has the necessary scopes for the APIs you're trying to access
- Check rate limiting and usage quotas


## Support

For issues related to:
- **eBay API**: Consult the [eBay Developer Documentation](https://developer.ebay.com/)
- **MCP Protocol**: Visit the [Model Context Protocol documentation](https://modelcontextprotocol.io/)
- **This Server**: Open an issue in this repository
