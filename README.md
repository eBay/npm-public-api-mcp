# eBay API MCP Server

Seamlessly integrate eBay's APIs into your AI assistant workflow. This MCP server enables Claude Desktop, Cursor, Cline, and other AI tools to discover and call eBay marketplace APIs directly.

## Features

- 🔍 **REST & GraphQL API Access** – Search, browse, and call both REST APIs (via OpenAPI specs) and GraphQL APIs (via schema discovery) using plain language
- 💬 **Natural language interface** – Just describe what you want; no need to memorize endpoints
- 🔑 **Simplified setup with automatic token management** – Just provide Client ID and Client Secret; the server handles OAuth token generation and refresh every ~2 hours
- 🗝️ **Dual token mode** – Application tokens for public data, User tokens for private data
- ⚡ **MCP Prompt support** – Enhanced AI assistant integration for both REST and GraphQL APIs

## Prerequisites

- **Node.js 22 or higher** - Verify: `node --version`
- **eBay Developer Account** - Sign up at [developer.ebay.com](https://developer.ebay.com/)

## ⚠️ Important Limitations

**Sandbox Environment Not Supported**

This release does not officially support the eBay sandbox environment. While the `EBAY_API_ENV` configuration exists, we don't support sandbox for now.

**Production Environment Restrictions**

- **REST APIs**: Only GET requests are supported (read operations only)
- **GraphQL API**: Only Query operations are supported (no Mutation operations)

This MCP server is designed for safe, read-only access to production eBay data. Sandbox support and write operations may be added in future releases.

## Quick Start

Choose the setup option that works best for you:

- **Option A (Recommended):** Use the published npm package — no build step required
- **Option B:** Clone and build from source — useful if you want to modify or contribute to the server

---

### Option A: Use Published npm Package (Recommended)

Skip straight to getting credentials — no build step needed.

#### Step 1: Get eBay Credentials

**Client ID & Client Secret:**
- Get from: [developer.ebay.com/my/keys](https://developer.ebay.com/my/keys)

**Required Scopes:**
- Depends on which APIs you need to access
- Reference: [OAuth Scopes Documentation](https://developer.ebay.com/api-docs/static/oauth-scopes.html)

**Refresh Token (optional, only for User Token mode):**
- Reference: [OAuth Authorization Code Grant](https://developer.ebay.com/api-docs/static/oauth-auth-code-grant-request.html)

#### Step 2: Configure Your MCP Client

Add this configuration to your MCP client's config file. The server runs via `npx` — no installation or build step needed.

**User Token Mode (for accessing private user data):**
```json
{
  "mcpServers": {
    "ebay-api": {
      "command": "npx",
      "args": ["-y", "@ebay/npm-public-api-mcp"],
      "env": {
        "EBAY_CLIENT_ID": "your_client_id",
        "EBAY_CLIENT_SECRET": "your_client_secret",
        "EBAY_TOKEN_TYPE": "user",
        "EBAY_REFRESH_TOKEN": "your_refresh_token",
        "EBAY_API_ENV": "production"
      }
    }
  }
}
```
**Note:** In User Token Mode, scopes are inherited from your refresh token. You don't need to configure `EBAY_REQUIRED_SCOPES`.

**Application Token Mode (for accessing public data):**
```json
{
  "mcpServers": {
    "ebay-api": {
      "command": "npx",
      "args": ["-y", "@ebay/npm-public-api-mcp"],
      "env": {
        "EBAY_CLIENT_ID": "your_client_id",
        "EBAY_CLIENT_SECRET": "your_client_secret",
        "EBAY_REQUIRED_SCOPES": "your_required_scopes",
        "EBAY_TOKEN_TYPE": "application",
        "EBAY_API_ENV": "production"
      }
    }
  }
}
```
**Note:** `EBAY_REQUIRED_SCOPES` is optional; omit it to default to `https://api.ebay.com/oauth/api_scope`.

**Claude Code:**

Use `claude mcp add` to register the server. Use `--scope user` for all projects or `--scope project` for the current project only.

User Token Mode:
```bash
claude mcp add --scope user ebay-api \
  -e EBAY_CLIENT_ID=your_client_id \
  -e EBAY_CLIENT_SECRET=your_client_secret \
  -e EBAY_TOKEN_TYPE=user \
  -e EBAY_REFRESH_TOKEN=your_refresh_token \
  -e EBAY_API_ENV=production \
  -- npx -y @ebay/npm-public-api-mcp
```

Application Token Mode:
```bash
claude mcp add --scope user ebay-api \
  -e EBAY_CLIENT_ID=your_client_id \
  -e EBAY_CLIENT_SECRET=your_client_secret \
  -e EBAY_TOKEN_TYPE=application \
  -e EBAY_REQUIRED_SCOPES=your_required_scopes \
  -e EBAY_API_ENV=production \
  -- npx -y @ebay/npm-public-api-mcp
```

#### Step 3: Restart Your MCP Client

Restart your MCP client to load the server.

---

### Option B: Build from Source

Use this option if you want to modify the server or contribute to the project.

#### Step 1: Clone and Build

```bash
git clone https://github.com/eBay/npm-public-api-mcp.git
cd npm-public-api-mcp

# Install dependencies and build
npm install
npm run build
```

**Requirements:** Node.js 22+

#### Step 2: Get eBay Credentials

Same as Option A — see [Step 1](#step-1-get-ebay-credentials) above.

#### Step 3: Configure Your MCP Client

Same as Option A, but replace `command` and `args` with your local build path:

```json
"command": "node",
"args": ["/absolute/path/to/npm-public-api-mcp/dist/index.js"]
```

For Claude Code, replace `-- npx -y @ebay/npm-public-api-mcp` with `-- node /absolute/path/to/npm-public-api-mcp/dist/index.js`. All environment variables remain the same.

#### Step 4: Restart Your MCP Client

Restart your MCP client to load the server.

## Configuration Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `EBAY_CLIENT_ID` | ✅ Yes | eBay application Client ID |
| `EBAY_CLIENT_SECRET` | ✅ Yes | eBay application Client Secret |
| `EBAY_TOKEN_TYPE` | No | `"application"` (default) or `"user"` |
| `EBAY_REFRESH_TOKEN` | Conditional | Required when `EBAY_TOKEN_TYPE="user"` |
| `EBAY_REQUIRED_SCOPES` | No | OAuth scopes (Application Token mode only). For multiple scopes, separate them with spaces, e.g., `"https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.inventory"` |
| `EBAY_API_ENV` | No | `"production"` (sandbox not supported) |

## Tools and Prompts

This server exposes four primary tools and two MCP prompts to your AI assistant.

### `query_ebay_api` — REST API Discovery

Searches eBay's OpenAPI specifications using a natural language prompt. Use this to explore available APIs, look up endpoint parameters, or find the right API for a task.

```
Find eBay APIs related to product listings
What parameters does the Browse API's getItem endpoint require?
Which API should I use to search for items by keyword?
```

### `call_ebay_api` — REST API Invocation

Executes actual calls to eBay's APIs and returns live marketplace data. Typically used after `query_ebay_api` has identified the right endpoint.

```
Search for iPhone 15 listings on eBay and show me the top 5 results
Get details for eBay item ID 123456789
Show me eBay's taxonomy categories for electronics
```

### `query_ebay_graphql` — GraphQL Schema Discovery

Searches eBay's GraphQL schema using a natural language prompt. Use this to explore available queries, mutations, types, and fields, or find the right operation for a task.

```
What fields are available on the Order type?
Which query should I use to get item details by ID?
What mutations are available for managing listings?
```

### `call_ebay_graphql` — GraphQL Query Execution

Executes actual GraphQL queries against eBay's API and returns live marketplace data. Typically used after `query_ebay_graphql` has identified the right operation and its required fields.

```
Get the title, price, and seller info for listing ID 123456789
Search for iPhone 15 items and return the top 5 with prices
Fetch my active orders and their current status
```

You can ask in natural language — the AI selects and sequences the tools automatically.

## MCP Prompts

This server registers two MCP prompts to help the client turn broad user requests into the right tool calls — one for REST APIs and one for GraphQL.

### `interpret_user_request` — REST API Request Interpretation

Accepts the user's original request as `user_input` and returns guidance that helps the MCP client decide when to use `query_ebay_api`, when to use `call_ebay_api`, and how to phrase discovery queries.

Typical use cases:

- Convert abstract requests into concrete eBay REST API actions
- Decide whether to search API specifications first or invoke a known endpoint directly
- Improve the natural-language prompt sent to `query_ebay_api`

### `interpret_graphql_request` — GraphQL Request Interpretation

Accepts the user's original request as `user_input` and returns guidance that helps the MCP client decide when to use `query_ebay_graphql`, when to use `call_ebay_graphql`, and how to approach schema discovery.

Typical use cases:

- Convert abstract requests into specific eBay GraphQL operations
- Decide whether to explore the schema first or execute a known query directly
- Improve the natural-language prompt sent to `query_ebay_graphql`

### How to Use These Prompts

| Prompt | Claude Code | GitHub Copilot |
|--------|-------------|----------------|
| REST | `/ebay-api:interpret_user_request` | `/mcp.ebay-api.interpret_user_request` |
| GraphQL | `/ebay-api:interpret_graphql_request` | `/mcp.ebay-api.interpret_graphql_request` |

Prompt support depends on the MCP client integration. If prompts are not exposed, use the tools directly.

## Usage Examples

Once connected, ask your AI assistant in natural language:

**Note**: You don't need to specify whether you want REST or GraphQL — the MCP explores both and automatically picks the most appropriate API.

- **"Find eBay APIs for listing products"** — searches both REST and GraphQL APIs
- **"What scope permissions do I need to access my watch list?"** — looks up required OAuth scopes
- **"What information can I query using userSavedSearches?"** — explores the GraphQL schema
- **"Retrieve order details for IDs ORD-001 and ORD-002"** — executes a real API call

## OAuth Authentication Modes

| Mode | Use case | Requirements |
|------|----------|--------------|
| **User Token** | Private user data (inventory, orders, account info) | Client ID, Client Secret, Refresh Token — scopes inherited from the refresh token |
| **Application Token** | Public marketplace data | Client ID, Client Secret, optional `EBAY_REQUIRED_SCOPES` |

Both modes handle token refresh automatically. For the OAuth flows behind each mode, see [Authorization Code Grant](https://developer.ebay.com/api-docs/static/oauth-auth-code-grant-request.html) and [Client Credentials Grant](https://developer.ebay.com/api-docs/static/oauth-client-credentials-grant.html).

## 🔒 Security Best Practices

### Protect Your Credentials
- ✅ Never commit credentials to version control
- ✅ Use environment variables or secure vaults for production
- ✅ Rotate Client Secrets periodically

### Token Security
- Refresh tokens are long-lived — store them securely
- Application tokens auto-expire after ~2 hours (the server handles refresh)
- Never share tokens publicly or in screenshots

## 🔍 Troubleshooting

**MCP Server Not Appearing:**
- If using Option A (npx): verify your Node.js version is 22+ and that `npx` is available
- If using Option B (source build): verify `dist/index.js` exists (run `npm run build`) and check the absolute path in your config
- Restart your MCP client

**Authentication Failed (401):**
- Verify credentials are correct
- For application token mode, check `EBAY_REQUIRED_SCOPES` includes necessary permissions
- For user token mode, ensure refresh token is valid

**Token Retrieval Failed (IDE launched from GUI):**
- IDEs launched from the GUI (e.g., VS Code, Cursor) may not inherit shell environment variables, causing credentials to be unresolved and token requests to fail.
- **Fix (quickest):** Hardcode the credential values directly in the config file — just do not commit them to version control.
- **Fix (alternative):** Launch your IDE from the terminal so it inherits the shell environment. VS Code and Cursor support this natively after a one-time CLI install from the Command Palette.

**API Call Failed:**
- Verify that you are using the production environment
- Use only REST GET requests or GraphQL Query operations; write operations are not supported
- Check your eBay account has the required API access

## Release Notes (v1.2.0)

If you previously used an earlier version of this MCP server, here is what has been added in this release:

- **GraphQL API Support** – Adds schema discovery and query execution alongside existing REST API support
- **GraphQL MCP Prompt** – Adds `interpret_graphql_request` alongside the existing REST API prompt

## Resources

- 🔐 **[Get eBay Credentials](https://developer.ebay.com/my/keys)** - Client ID & Secret
- 📚 **[eBay API Documentation](https://developer.ebay.com/)** - Complete API reference
- 🔧 **[MCP Protocol](https://modelcontextprotocol.io/)** - Learn about MCP

**Happy testing! 🎉**

## License

Apache 2.0 - See [LICENSE][license-url] for more information.

[license-url]:https://github.com/eBay/npm-public-api-mcp/blob/main/LICENSE.txt
