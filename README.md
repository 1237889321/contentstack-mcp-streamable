# Contentstack MCP Streamable HTTP Server

A Streamable HTTP transport wrapper for the [@contentstack/mcp](https://www.npmjs.com/package/@contentstack/mcp) package. This server exposes all Contentstack MCP tools over HTTP instead of stdio, enabling remote access, horizontal scaling, and integration with browser-based and networked MCP clients.

## How It Works

This server acts as a transparent proxy:

1. Accepts MCP client connections over Streamable HTTP
2. Reads credentials from **request headers** (inputs) provided by the client
3. Spawns a per-session `@contentstack/mcp` child process with those credentials
4. Discovers all available tools and forwards calls transparently

Each session gets its own isolated child process — different clients can use different Contentstack stacks and API groups simultaneously.

## Prerequisites

- Node.js 18+
- A Contentstack account with appropriate credentials
- OAuth authentication completed (for CMA, Analytics, BrandKit, Launch, DeveloperHub, Personalize)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Authenticate with OAuth (one-time)

Before using CMA, Analytics, BrandKit, Launch, DeveloperHub, or Personalize tools:

```bash
npm run auth
```

### 3. Build and run

```bash
npm run build
npm start
```

For development with auto-reload:

```bash
npm run dev
```

The server starts on port 3000 by default (`PORT` env var to change).

## Connecting a Client

Credentials are passed as HTTP headers (inputs) on each session. The server maps these headers to the corresponding `@contentstack/mcp` environment variables.

### Input Headers

| Header | Maps To | Required |
|---|---|---|
| `x-contentstack-api-key` | `CONTENTSTACK_API_KEY` | Yes (unless Lytics-only) |
| `x-contentstack-delivery-token` | `CONTENTSTACK_DELIVERY_TOKEN` | CDA only |
| `x-contentstack-brand-kit-id` | `CONTENTSTACK_BRAND_KIT_ID` | BrandKit only |
| `x-contentstack-launch-project-id` | `CONTENTSTACK_LAUNCH_PROJECT_ID` | Launch only |
| `x-contentstack-personalize-project-id` | `CONTENTSTACK_PERSONALIZE_PROJECT_ID` | Personalize only |
| `x-lytics-access-token` | `LYTICS_ACCESS_TOKEN` | Lytics only |
| `x-contentstack-groups` | `GROUPS` | No (default: `cma`) |

### Cursor IDE

Add to your `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "contentstack": {
      "type": "streamable-http",
      "url": "http://localhost:3000/mcp",
      "headers": {
        "x-contentstack-api-key": "${input:apiKey}",
        "x-contentstack-groups": "${input:groups}"
      },
      "inputs": [
        {
          "type": "promptString",
          "id": "apiKey",
          "description": "Contentstack Stack API Key",
          "password": true
        },
        {
          "type": "promptString",
          "id": "groups",
          "description": "API groups (cma, cda, analytics, brandkit, launch, developerhub, lytics, personalize, all)",
          "password": false
        }
      ]
    }
  }
}
```

Cursor will prompt for these values when the MCP server is first used. They are sent as headers on every request in the session.

### Additional inputs for other API groups

Add more headers and inputs as needed. For example, to also use CDA:

```json
{
  "headers": {
    "x-contentstack-api-key": "${input:apiKey}",
    "x-contentstack-delivery-token": "${input:deliveryToken}",
    "x-contentstack-groups": "cma,cda"
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "apiKey",
      "description": "Contentstack Stack API Key",
      "password": true
    },
    {
      "type": "promptString",
      "id": "deliveryToken",
      "description": "Contentstack Delivery Token",
      "password": true
    }
  ]
}
```

### Plain HTTP client

Any HTTP client can connect by including the credential headers directly:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "x-contentstack-api-key: YOUR_API_KEY" \
  -H "x-contentstack-groups: cma" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"capabilities":{}},"id":1}'
```

## Fallback to Server Environment

If a header is not provided by the client, the server falls back to its own environment variables (from `.env` or the shell). This lets you set defaults on the server while allowing clients to override per-session.

## API Groups

| Group | Authentication | Required Headers |
|---|---|---|
| **CMA** | OAuth | `x-contentstack-api-key` |
| **CDA** | Token-based | `x-contentstack-api-key` + `x-contentstack-delivery-token` |
| **Analytics** | OAuth | `x-contentstack-api-key` |
| **BrandKit** | OAuth | `x-contentstack-api-key` + `x-contentstack-brand-kit-id` |
| **Launch** | OAuth | `x-contentstack-api-key` + `x-contentstack-launch-project-id` |
| **DeveloperHub** | OAuth | `x-contentstack-api-key` |
| **Lytics** | Token-based | `x-lytics-access-token` |
| **Personalize** | OAuth | `x-contentstack-api-key` + `x-contentstack-personalize-project-id` |

## Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/mcp` | MCP JSON-RPC requests (initialize, tool calls) |
| `GET` | `/mcp` | SSE stream for server-to-client notifications |
| `DELETE` | `/mcp` | Session termination |
| `GET` | `/health` | Health check with active session count |

## License

MIT
