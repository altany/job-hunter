#!/usr/bin/env node

import express from "express";
import cors from "cors";
import crypto from "crypto";
import { createServer } from "./createServer.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "5mb" }));

const transports = {};

app.post("/mcp", async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"];
    let transport = sessionId ? transports[sessionId] : undefined;

    if (!transport) {
      if (req.body?.method !== "initialize") {
        return res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: No valid session ID provided"
          },
          id: null
        });
      }

      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (newSessionId) => {
          transports[newSessionId] = transport;
        }
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
        id: null
      });
    }
  }
});

async function handleSessionRequest(req, res) {
  try {
    const sessionId = req.headers["mcp-session-id"];
    const transport = sessionId ? transports[sessionId] : undefined;

    if (!transport) {
      return res.status(400).send("Invalid or missing session ID");
    }

    await transport.handleRequest(req, res);
  } catch (err) {
    console.error(`${req.method} /mcp error:`, err);
    if (!res.headersSent) {
      res.status(500).send("Internal server error");
    }
  }
}

app.get("/mcp", handleSessionRequest);
app.delete("/mcp", handleSessionRequest);

app.listen(port, () => {
  console.log(`MCP server running on http://localhost:${port}/mcp`);
});