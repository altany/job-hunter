#!/usr/bin/env node
/**
 * One-time OAuth setup for auto-creating Google Docs owned by YOU.
 *
 * A service account has no Drive storage quota, so it can't create Docs. This
 * flow gets a refresh token for your own Google account, which the server uses
 * ONLY to create Docs (everything else still runs as the service account).
 *
 * Prereqs: an OAuth client (type "Desktop app") in your Google Cloud project.
 * Either drop its downloaded client_secret_*.json in the repo root (gitignored),
 * or put client_id / client_secret in config.json under `google_oauth`.
 *
 * Usage:  npm run auth
 * It saves client_id, client_secret and refresh_token into config.json
 * (gitignored). For a hosted deploy, re-run `npm run pack-config` and update
 * JOB_HUNTER_CONFIG_JSON (or set GOOGLE_OAUTH_JSON).
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive",
];
const PORT = 5599;
const REDIRECT = `http://localhost:${PORT}/oauth2callback`;

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = process.env.JOB_HUNTER_CONFIG || path.join(root, "config.json");

function readClientFile() {
  const file = fs.readdirSync(root).find((f) => /^client_secret.*\.json$/.test(f));
  if (!file) return null;
  const data = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  const c = data.installed || data.web;
  return c ? { client_id: c.client_id, client_secret: c.client_secret, source: file } : null;
}

const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : null;
if (!config) {
  console.error(`No config.json found at ${configPath}. Copy config.example.json to config.json first.`);
  process.exit(1);
}

const fromFile = readClientFile();
const clientId =
  process.env.GOOGLE_OAUTH_CLIENT_ID || fromFile?.client_id || config.google_oauth?.client_id;
const clientSecret =
  process.env.GOOGLE_OAUTH_CLIENT_SECRET || fromFile?.client_secret || config.google_oauth?.client_secret;

if (!clientId || !clientSecret) {
  console.error(
    "Missing OAuth client credentials.\n" +
      "Create an OAuth client (type: Desktop app) in Google Cloud and either drop the\n" +
      "downloaded client_secret_*.json in the repo root, or add client_id/client_secret\n" +
      "to config.json under `google_oauth`. Then run again."
  );
  process.exit(1);
}
if (fromFile) console.log(`Using OAuth client from ${fromFile.source}`);

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
    if (!tokens.refresh_token) {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("No refresh token returned. See the terminal.");
      console.log(
        "\n⚠️ No refresh_token returned. Revoke this app at\n" +
          "https://myaccount.google.com/permissions and run `npm run auth` again."
      );
      server.close();
      process.exit(1);
    }

    config.google_oauth = {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
    };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Done. Close this tab and return to the terminal.");
    console.log(
      "\n✅ Saved google_oauth (client_id, client_secret, refresh_token) to config.json.\n" +
        "Local (stdio) is ready. For the hosted server: `npm run pack-config | pbcopy`\n" +
        "and update JOB_HUNTER_CONFIG_JSON on your host."
    );
    server.close();
    process.exit(0);
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
