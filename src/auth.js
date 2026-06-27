import crypto from "crypto";

/**
 * Simple single-user bearer-token auth for the remote HTTP transport.
 *
 * The token is read from MCP_AUTH_TOKEN. The same secret is accepted in two
 * forms so it works with whatever the MCP client supports:
 *
 *   1. Authorization: Bearer <token>   (standard header)
 *   2. a token segment in the path:    POST /mcp/<token>
 *
 * If MCP_AUTH_TOKEN is unset the server refuses to start (fail closed) — we
 * never expose an unauthenticated public endpoint by accident.
 */

const TOKEN = process.env.MCP_AUTH_TOKEN;

export function assertAuthConfigured() {
  if (!TOKEN || TOKEN.length < 16) {
    throw new Error(
      "MCP_AUTH_TOKEN must be set to a strong secret (>=16 chars) before the " +
        "HTTP transport will start. Generate one with: openssl rand -hex 32"
    );
  }
}

/** Constant-time string comparison that tolerates length differences. */
function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) {
    // Still do a compare to keep timing roughly constant, then fail.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

/** Extract the presented token from the Authorization header or the URL path. */
function presentedToken(req) {
  const header = req.headers["authorization"] || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (match) return match[1].trim();
  if (req.params && req.params.token) return req.params.token;
  return null;
}

/** Express middleware enforcing the bearer token. */
export function requireAuth(req, res, next) {
  const presented = presentedToken(req);
  if (presented && safeEqual(presented, TOKEN)) {
    return next();
  }
  return res.status(401).json({
    jsonrpc: "2.0",
    error: { code: -32001, message: "Unauthorized" },
    id: null,
  });
}
