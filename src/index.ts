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

const ENV_TO_ARG: Record<string, string> = {
  CONTENTSTACK_API_KEY: "--stack-api-key",
  CONTENTSTACK_DELIVERY_TOKEN: "--delivery-token",
  CONTENTSTACK_ORGANIZATION_UID: "--organization-uid",
  CONTENTSTACK_BRAND_KIT_ID: "--brand-kit-id",
  CONTENTSTACK_LAUNCH_PROJECT_ID: "--launch-project-id",
  CONTENTSTACK_PERSONALIZE_PROJECT_ID: "--personalize-project-id",
  LYTICS_ACCESS_TOKEN: "--lytics-access-token",
  GROUPS: "--groups",
};

function buildChildArgs(): string[] {
  const args: string[] = [mcpServerPath];
  for (const [envVar, cliFlag] of Object.entries(ENV_TO_ARG)) {
    const value = process.env[envVar];
    if (value) {
      args.push(cliFlag, value);
    }
  }
  return args;
}

let contentstackClient: Client;

async function startContentstackClient(): Promise<Client> {
  const args = buildChildArgs();
  console.log(`Spawning @contentstack/mcp from: ${mcpServerPath}`);
  console.log(`  args: ${args.slice(1).join(" ")}`);

  const transport = new StdioClientTransport({
    command: "node",
    args,
    stderr: "inherit",
  });

  const client = new Client({
    name: "contentstack-mcp-http-proxy",
    version: "1.0.0",
  });

  await client.connect(transport);
  return client;
}

function createProxyServer(): McpServer {
  const mcpServer = new McpServer(
    { name: "contentstack-mcp-streamable", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  mcpServer.server.setRequestHandler(
    ListToolsRequestSchema,
    async (request) => {
      return await contentstackClient.listTools(request.params);
    },
  );

  mcpServer.server.setRequestHandler(
    CallToolRequestSchema,
    async (request) => {
      return await contentstackClient.callTool(
        request.params as {
          name: string;
          arguments?: Record<string, unknown>;
        },
      );
    },
  );

  return mcpServer;
}

async function main() {
  console.log("Starting Contentstack MCP Streamable HTTP Server...");

  contentstackClient = await startContentstackClient();
  console.log("Connected to @contentstack/mcp via stdio");

  const { tools } = await contentstackClient.listTools();
  console.log(
    `Discovered ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`,
  );

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

  const transports: Record<string, StreamableHTTPServerTransport> = {};

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      toolCount: tools.length,
      activeSessions: Object.keys(transports).length,
    });
  });

  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    try {
      if (sessionId && transports[sessionId]) {
        await transports[sessionId].handleRequest(req, res, req.body);
        return;
      }

      if (!sessionId && isInitializeRequest(req.body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableJsonResponse: true,
          onsessioninitialized: (sid) => {
            console.log(`Session initialized: ${sid}`);
            transports[sid] = transport;
          },
        });

        transport.onclose = () => {
          const sid = transport.sessionId;
          if (sid && transports[sid]) {
            console.log(`Session closed: ${sid}`);
            delete transports[sid];
          }
        };

        const server = createProxyServer();
        await server.connect(transport);
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
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    try {
      await transports[sessionId].handleRequest(req, res);
    } catch (error) {
      console.error("Error handling GET /mcp:", error);
      if (!res.headersSent) {
        res.status(500).send("Internal server error");
      }
    }
  });

  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send("Invalid or missing session ID");
      return;
    }

    try {
      await transports[sessionId].handleRequest(req, res);
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
    for (const sid of Object.keys(transports)) {
      try {
        await transports[sid].close();
        delete transports[sid];
      } catch (error) {
        console.error(`Error closing session ${sid}:`, error);
      }
    }
    await contentstackClient.close();
    server.close();
    console.log("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Failed to start server:", err.message || err);
  console.error(
    "\nMake sure you have:\n" +
      "  1. Set CONTENTSTACK_API_KEY in your .env file\n" +
      "  2. Run `npm run auth` to complete OAuth setup\n" +
      "  3. Configured the required env vars for your GROUPS\n" +
      "\nSee README.md for details.",
  );
  process.exit(1);
});
