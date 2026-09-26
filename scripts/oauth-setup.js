#!/usr/bin/env node
/**
 * One-time OAuth setup for auto-creating Google Docs owned by YOU.
 *
 * A service account has no Drive storage quota, so it can't create Docs. This
 * flow gets a refresh token for your own Google account, which the server uses
 * ONLY to create Docs (everything else still runs as the service account).
 *
 * Prereqs: an OAuth client (type "Desktop app") in your Google Cloud project.
 * Put its client_id / client_secret in config.json under `google_oauth`
 * (or set GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET).
 *
 * Usage:  npm run auth
 * Then paste the printed refresh_token into config.json (google_oauth.refresh_token)
 * for local use, and into GOOGLE_OAUTH_JSON on your host (e.g. Render) for remote.
 */
import http from "http";
import { google } from "googleapis";
import { loadConfig } from "../src/config.js";

const SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive",
];
const PORT = 5599;
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;

const cfg = loadConfig();
const oauth = cfg.google_oauth || {};
const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || oauth.client_id;
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || oauth.client_secret;

if (!clientId || !clientSecret) {
  console.error(
    "Missing OAuth client_id/client_secret.\n" +
      "Create an OAuth client (type: Desktop app) in Google Cloud, then add its\n" +
      "client_id and client_secret to config.json under `google_oauth`\n" +
      "(or set GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET), and run again."
  );
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT);
const authUrl = oauth2.generateAuthUrl({
  access_type: "offline",
  prompt: "consent", // force a refresh_token even if you've authorised before
  scope: SCOPES,
});

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith("/oauth2callback")) {
    res.writeHead(404);
    res.end();
    return;
  }
  const code = new URL(req.url, REDIRECT).searchParams.get("code");
  if (!code) {
    res.writeHead(400);
    res.end("No authorisation code received.");
    return;
  }
  try {
    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Done. Close this tab and return to the terminal.");
    if (tokens.refresh_token) {
      console.log("\n✅ Success. Your refresh token:\n");
      console.log(tokens.refresh_token);
      console.log(
        "\nPut it in config.json under google_oauth.refresh_token (local),\n" +
          "and inside GOOGLE_OAUTH_JSON on your host (e.g. Render) for remote."
      );
    } else {
      console.log(
        "\n⚠️ No refresh_token returned. Revoke this app at\n" +
          "https://myaccount.google.com/permissions and run `npm run auth` again."
      );
    }
    server.close();
    process.exit(tokens.refresh_token ? 0 : 1);
  } catch (e) {
    res.writeHead(500);
    res.end("Token exchange failed: " + e.message);
    console.error("Token exchange failed:", e.message);
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log("Open this URL in your browser, authorise, then come back here:\n");
  console.log(authUrl + "\n");
});
