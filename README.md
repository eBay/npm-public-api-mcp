# eBay API MCP Server

Seamlessly integrate eBay's APIs into your AI assistant workflow. This MCP server enables Claude Desktop, Cursor, Cline, and other AI tools to discover and call eBay marketplace APIs directly.

## What Does This Do?

This MCP server gives your AI assistant superpowers to:
- 🔍 **Search for eBay APIs** - Find the right endpoint for any marketplace need
- 📋 **Browse API documentation** - Get detailed specs, parameters, and examples
- 🚀 **Make real API calls** - Execute live requests to eBay's production or sandbox APIs
- 💬 **Natural language interface** - Just describe what you want, no need to memorize endpoints

## Quick Start

### 1. Get Your eBay API Token

You'll need an eBay developer account and API token. Get one by running:

```bash
curl -v https://api.ebay.com/identity/v1/oauth2/token \
  -H "Accept: application/json" \
  -H "Accept-Language: en_US" \
  -u "YOUR_CLIENT_ID:YOUR_CLIENT_SECRET" \
  -d "grant_type=client_credentials&scope=scopes"
```
scopes must be URL encoded value of space seperated scope values 

For sandbox testing, use `https://api.sandbox.ebay.com/identity/v1/oauth2/token`

### 2. Install and Run

The easiest way to use this server is via npx:

```bash
EBAY_CLIENT_TOKEN='your_token_here' EBAY_API_ENV='production' npx @ebay/npm-public-api-mcp@latest
```

That's it! The server is now running and ready to be connected to your AI assistant.

## Configuration for AI Assistants

### Claude Desktop

Add to your Claude Desktop configuration:

```json
{
    "mcpServers": {
        "ebay-api": {
            "command": "npx",
            "args": [
                "-y",
                "@ebay/npm-public-api-mcp@latest"
            ],
            "env": {
                "EBAY_CLIENT_TOKEN": "YOUR_ACCESS_TOKEN",
                "EBAY_API_ENV": "production"
            }
        }
    }
}
```

### VS Code with MCP Extension

Create `.vscode/mcp.json` in your project:

```json
{
    "servers": {
        "ebay-api": {
            "type": "stdio",
            "command": "npx",
            "args": [
                "-y",
                "@ebay/npm-public-api-mcp@latest"
            ],
            "env": {
                "EBAY_API_ENV": "production",
                "EBAY_CLIENT_TOKEN": "YOUR_ACCESS_TOKEN"
            }
        }
    }
}
```

### Cursor

Configure in Cursor's MCP settings using the same JSON structure as Claude Desktop.

## Usage Examples

Once connected, ask your AI assistant things like:

- **"Find eBay APIs for listing products"**
  - Discovers endpoints for creating and managing listings

- **"Search for order management APIs"**
  - Returns APIs for processing orders, shipping, and fulfillment

- **"Get details about the findItemsByKeywords endpoint"**
  - Shows parameters, response format, and usage examples

- **"Call the getItem API for item ID 123456789"**
  - Makes a real API call and returns the item details

- **"What APIs can I use for inventory management?"**
  - Finds all relevant inventory APIs with documentation

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `EBAY_CLIENT_TOKEN` | Your eBay API access token (required) | - |
| `EBAY_API_ENV` | API environment: "sandbox" or "production" | "production" |

## API Coverage

This server provides access to eBay's complete API ecosystem:

- **Selling APIs**: Listings, inventory, orders, fulfillment
- **Buying APIs**: Shopping, checkout, bidding
- **Commerce APIs**: Catalog, taxonomy, translation
- **Marketing APIs**: Promotions, campaigns, analytics
- **Developer APIs**: Analytics, metadata, notifications

## Troubleshooting

### "Authentication Failed" Error
- Verify your token hasn't expired (tokens typically last 2 hours)
- Ensure you're using the correct environment (sandbox vs production)
- Check that your app has the necessary scopes

### "API Not Found" Error
- Some APIs may be restricted based on your eBay developer account type
- Verify the API name and try searching with different keywords

### Connection Issues
- Make sure npx is installed and working: `npx --version`
- Check that Node.js version 22+ is installed: `node --version`
- Verify environment variables are set correctly

## Getting Help

- **eBay API Documentation**: [developer.ebay.com](https://developer.ebay.com/)
- **MCP Protocol**: [modelcontextprotocol.io](https://modelcontextprotocol.io/)
- **Issues**: Open an issue in this repository

## License

Apache 2.0 - See [LICENSE][license-url] for more information.

[license-url]:https://github.corp.ebay.com/globalcommerce/npm-public-api-mcp/blob/main/LICENSE 
