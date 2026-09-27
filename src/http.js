import express from "express";
import cors from "cors";
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

  app.use(cors());
  app.use(express.json({ limit: "5mb" }));

  // Unauthenticated liveness probe for the platform health check.
  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  // Stateless: every POST gets a fresh server + transport and no session id.
  // The server keeps nothing between requests, and in-memory sessions were
  // lost on every restart (deploys, free-tier sleep), leaving clients stuck on
  // "No valid session ID". Without sessions a restart is invisible to clients,
  // and a client still sending an old session id is simply served.
  async function handleMcpPost(req, res) {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      // Respond with plain application/json instead of an SSE stream.
      // Some hosts/clients (e.g. ChatGPT behind certain edge proxies) don't
      // consume the text/event-stream response cleanly and surface a 502;
      // JSON responses proxy reliably. Streaming isn't needed here.
      enableJsonResponse: true,
    });
    const server = createServer();
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
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

  // No sessions means no server-initiated stream (GET) or session to end (DELETE).
  function methodNotAllowed(_req, res) {
    res.status(405).set("Allow", "POST").json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    });
  }

  // Two equivalent mount points, both authenticated:
  //   /mcp            — auth via Authorization: Bearer header
  //   /mcp/:token     — auth via token in the URL (fallback for clients that
  //                     can't set custom headers)
  app.post("/mcp", requireAuth, handleMcpPost);
  app.get("/mcp", requireAuth, methodNotAllowed);
  app.delete("/mcp", requireAuth, methodNotAllowed);

  app.post("/mcp/:token", requireAuth, handleMcpPost);
  app.get("/mcp/:token", requireAuth, methodNotAllowed);
  app.delete("/mcp/:token", requireAuth, methodNotAllowed);

  app.listen(port, () => {
    console.log(`Job-hunter MCP (HTTP) listening on :${port}/mcp`);
  });
}
