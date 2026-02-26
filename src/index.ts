import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import cors from "cors";
import "dotenv/config";
import express from "express";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from "@modelcontextprotocol/sdk/types.js";

const PORT = parseInt(process.env.PORT || "3000", 10);

const _require = createRequire(import.meta.url);

let mcpServerPath: string;
try {
  mcpServerPath = _require.resolve("@contentstack/mcp/dist/index.js");
} catch {
  mcpServerPath = _require.resolve("@contentstack/mcp");
}

const HEADER_TO_ENV: Record<string, string> = {
  "x-contentstack-api-key": "CONTENTSTACK_API_KEY",
  "x-contentstack-delivery-token": "CONTENTSTACK_DELIVERY_TOKEN",
  "x-contentstack-brand-kit-id": "CONTENTSTACK_BRAND_KIT_ID",
  "x-contentstack-launch-project-id": "CONTENTSTACK_LAUNCH_PROJECT_ID",
  "x-contentstack-personalize-project-id": "CONTENTSTACK_PERSONALIZE_PROJECT_ID",
  "x-lytics-access-token": "LYTICS_ACCESS_TOKEN",
  "x-contentstack-groups": "GROUPS",
};

interface Session {
  transport: StreamableHTTPServerTransport;
  client: Client;
  mcpServer: McpServer;
}

const sessions: Record<string, Session> = {};

function extractInputs(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [header, envVar] of Object.entries(HEADER_TO_ENV)) {
    const value = headers[header];
    if (typeof value === "string" && value.length > 0) {
      env[envVar] = value;
    }
  }
  return env;
}

async function spawnContentstackClient(
  inputEnv: Record<string, string>,
): Promise<Client> {
  const transport = new StdioClientTransport({
    command: "node",
    args: [mcpServerPath],
    env: { ...process.env, ...inputEnv } as Record<string, string>,
    stderr: "inherit",
  });

  const client = new Client({
    name: "contentstack-mcp-http-proxy",
    version: "1.0.0",
  });

  await client.connect(transport);
  return client;
}

function createProxyServer(client: Client): McpServer {
  const mcpServer = new McpServer(
    { name: "contentstack-mcp-streamable", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  mcpServer.server.setRequestHandler(
    ListToolsRequestSchema,
    async (request) => {
      return await client.listTools(request.params);
    },
  );

  mcpServer.server.setRequestHandler(
    CallToolRequestSchema,
    async (request) => {
      return await client.callTool(
        request.params as {
          name: string;
          arguments?: Record<string, unknown>;
        },
      );
    },
  );

  return mcpServer;
}

async function cleanupSession(sessionId: string) {
  const session = sessions[sessionId];
  if (!session) return;

  try {
    await session.client.close();
  } catch (error) {
    console.error(`Error closing client for session ${sessionId}:`, error);
  }
  delete sessions[sessionId];
  console.log(`Session cleaned up: ${sessionId}`);
}

async function main() {
  console.log("Starting Contentstack MCP Streamable HTTP Server...");
  console.log(`Resolved @contentstack/mcp at: ${mcpServerPath}`);

  const app = express();
  app.use(express.json());
  app.use(
    cors({
      exposedHeaders: [
        "Mcp-Session-Id",
        "Last-Event-Id",
        "Mcp-Protocol-Version",
      ],
    }),
  );

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      activeSessions: Object.keys(sessions).length,
    });
  });

  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    try {
      if (sessionId && sessions[sessionId]) {
        await sessions[sessionId].transport.handleRequest(req, res, req.body);
        return;
      }

      if (!sessionId && isInitializeRequest(req.body)) {
        const inputEnv = extractInputs(req.headers);
        const inputKeys = Object.keys(inputEnv);
        console.log(
          `New session with inputs: ${inputKeys.length > 0 ? inputKeys.join(", ") : "(none, using server env)"}`,
        );

        const client = await spawnContentstackClient(inputEnv);

        const { tools } = await client.listTools();
        console.log(`Session has ${tools.length} tools available`);

        const mcpServer = createProxyServer(client);

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (sid) => {
            console.log(`Session initialized: ${sid}`);
            sessions[sid] = { transport, client, mcpServer };
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid) {
            cleanupSession(sid);
          }
        };

        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, req.body);
        return;
      }

      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided",
        },
        id: null,
      });
    } catch (error) {
      console.error("Error handling POST /mcp:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message:
              error instanceof Error ? error.message : "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !sessions[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    try {
      await sessions[sessionId].transport.handleRequest(req, res);
    } catch (error) {
      console.error("Error handling GET /mcp:", error);
      if (!res.headersSent) {
        res.status(500).send("Internal server error");
      }
    }
  });

  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !sessions[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    try {
      await sessions[sessionId].transport.handleRequest(req, res);
    } catch (error) {
      console.error("Error handling DELETE /mcp:", error);
      if (!res.headersSent) {
        res.status(500).send("Error processing session termination");
      }
    }
  });

  const server = app.listen(PORT, () => {
    console.log(
      `Contentstack MCP Streamable HTTP Server listening on port ${PORT}`,
    );
    console.log(`  MCP endpoint: http://localhost:${PORT}/mcp`);
    console.log(`  Health check: http://localhost:${PORT}/health`);
  });

  const shutdown = async () => {
    console.log("\nShutting down...");
    await Promise.all(
      Object.keys(sessions).map((sid) => cleanupSession(sid)),
    );
    server.close();
    console.log("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Failed to start server:", err.message || err);
  process.exit(1);
});
