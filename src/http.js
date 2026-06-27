import express from "express";
import cors from "cors";
import crypto from "crypto";
import { createServer } from "./createServer.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requireAuth, assertAuthConfigured } from "./auth.js";

/**
 * Remote MCP transport over Streamable HTTP.
 *
 * Same tool logic as the stdio entrypoint (shared createServer()), wrapped in
 * an authenticated Express app suitable for a public HTTPS host (Cloud Run).
 */
export async function startHttpServer() {
  assertAuthConfigured();

  const app = express();
  const port = process.env.PORT || 3001;

  app.use(cors({ exposedHeaders: ["mcp-session-id"] }));
  app.use(express.json({ limit: "5mb" }));

  // Unauthenticated liveness probe for the platform health check.
  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  const transports = {};

  async function handleMcpPost(req, res) {
    try {
      const sessionId = req.headers["mcp-session-id"];
      let transport = sessionId ? transports[sessionId] : undefined;

      if (!transport) {
        if (req.body?.method !== "initialize") {
          return res.status(400).json({
            jsonrpc: "2.0",
            error: { code: -32000, message: "Bad Request: No valid session ID provided" },
            id: null,
          });
        }

        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (newSessionId) => {
            transports[newSessionId] = transport;
          },
        });

        transport.onclose = async () => {
          if (transport.sessionId) delete transports[transport.sessionId];
        };

        const server = createServer();
        await server.connect(transport);
      }

      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("POST /mcp error:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: String(err?.message || err) },
          id: null,
        });
      }
    }
  }

  async function handleSessionRequest(req, res) {
    try {
      const sessionId = req.headers["mcp-session-id"];
      const transport = sessionId ? transports[sessionId] : undefined;
      if (!transport) return res.status(400).send("Invalid or missing session ID");
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error(`${req.method} /mcp error:`, err);
      if (!res.headersSent) res.status(500).send("Internal server error");
    }
  }

  // Two equivalent mount points, both authenticated:
  //   /mcp            — auth via Authorization: Bearer header
  //   /mcp/:token     — auth via token in the URL (fallback for clients that
  //                     can't set custom headers)
  app.post("/mcp", requireAuth, handleMcpPost);
  app.get("/mcp", requireAuth, handleSessionRequest);
  app.delete("/mcp", requireAuth, handleSessionRequest);

  app.post("/mcp/:token", requireAuth, handleMcpPost);
  app.get("/mcp/:token", requireAuth, handleSessionRequest);
  app.delete("/mcp/:token", requireAuth, handleSessionRequest);

  app.listen(port, () => {
    console.log(`Job-hunter MCP (HTTP) listening on :${port}/mcp`);
  });
}
