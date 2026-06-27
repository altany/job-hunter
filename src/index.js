#!/usr/bin/env node

/**
 * Entrypoint. Selects the transport via MCP_TRANSPORT:
 *
 *   stdio (default) — local transport for the Claude/ChatGPT desktop apps.
 *                     Behaves exactly as before; no env needed.
 *   http            — remote Streamable HTTP transport for a public host.
 *
 * Both share the same tool logic (src/createServer.js).
 */

const transport = (process.env.MCP_TRANSPORT || "stdio").toLowerCase();

if (transport === "http") {
  const { startHttpServer } = await import("./http.js");
  await startHttpServer();
} else {
  const { StdioServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/stdio.js"
  );
  const { createServer } = await import("./createServer.js");
  const stdio = new StdioServerTransport();
  await createServer().connect(stdio);
}
