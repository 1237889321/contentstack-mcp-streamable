# Contentstack MCP Streamable HTTP Server

A Streamable HTTP transport wrapper for the [@contentstack/mcp](https://www.npmjs.com/package/@contentstack/mcp) package. This server exposes all Contentstack MCP tools over HTTP instead of stdio, enabling remote access, horizontal scaling, and integration with browser-based and networked MCP clients.

## How It Works

This server acts as a transparent proxy:

1. Spawns `@contentstack/mcp` as a child process communicating via stdio
2. Discovers all available tools from the child process
3. Exposes them over Streamable HTTP transport at a single `/mcp` endpoint
4. Forwards tool calls from HTTP clients to the underlying Contentstack MCP server

All tools from `@contentstack/mcp` are available — CMA, CDA, Analytics, BrandKit, Launch, DeveloperHub, Lytics, and Personalize.

## Prerequisites

- Node.js 18+
- A Contentstack account with appropriate credentials
- OAuth authentication completed (for CMA, Analytics, BrandKit, Launch, DeveloperHub, Personalize)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the example env file and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env` with your Contentstack credentials:

```env
CONTENTSTACK_API_KEY=your_stack_api_key
GROUPS=cma
```

See [Environment Variables](#environment-variables) for the full list.

### 3. Authenticate with OAuth

Before using CMA, Analytics, BrandKit, Launch, DeveloperHub, or Personalize tools, run the OAuth flow:

```bash
npm run auth
```

This stores your OAuth tokens locally for the child process to use.

### 4. Build and run

```bash
npm run build
npm start
```

For development with auto-reload:

```bash
npm run dev
```

The server starts on port 3000 by default.

## Connecting a Client

Configure your MCP client to connect via Streamable HTTP. Example `mcp-config.json`:

```json
{
  "mcpServers": {
    "contentstack": {
      "type": "streamable-http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

### Cursor IDE

Add to your Cursor MCP settings (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "contentstack": {
      "type": "streamable-http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port (default: `3000`) |
| `CONTENTSTACK_API_KEY` | Yes | Your Stack API Key |
| `CONTENTSTACK_DELIVERY_TOKEN` | CDA only | Delivery token for Content Delivery API |
| `CONTENTSTACK_BRAND_KIT_ID` | BrandKit only | Brand Kit ID |
| `CONTENTSTACK_LAUNCH_PROJECT_ID` | Launch only | Launch Project ID |
| `CONTENTSTACK_PERSONALIZE_PROJECT_ID` | Personalize only | Personalize Project ID |
| `LYTICS_ACCESS_TOKEN` | Lytics only | Lytics access token |
| `GROUPS` | No | Comma-separated API groups to enable (default: `cma`). Options: `cma`, `cda`, `analytics`, `brandkit`, `launch`, `developerhub`, `lytics`, `personalize`, `all` |

## API Groups

| Group | Authentication | Required Configuration |
|---|---|---|
| **CMA** | OAuth | Stack API Key |
| **CDA** | Token-based | Stack API Key + Delivery Token |
| **Analytics** | OAuth | Stack API Key |
| **BrandKit** | OAuth | Stack API Key + Brand Kit ID |
| **Launch** | OAuth | Stack API Key + Launch Project ID |
| **DeveloperHub** | OAuth | Stack API Key |
| **Lytics** | Token-based | Lytics Access Token |
| **Personalize** | OAuth | Stack API Key + Personalize Project ID |

## Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/mcp` | MCP JSON-RPC requests (initialize, tool calls) |
| `GET` | `/mcp` | SSE stream for server-to-client notifications |
| `DELETE` | `/mcp` | Session termination |
| `GET` | `/health` | Health check with tool count and active sessions |

## License

MIT
