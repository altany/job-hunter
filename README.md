# 🎯 job-hunter

A personal MCP (Model Context Protocol) server that turns Claude or ChatGPT into a job search assistant — rate job postings, tailor CVs, write cover letters, track applications, prep for interviews, and keep notes on each company.

Once set up, you interact with it through natural language in Claude or ChatGPT. Say things like:
- *"Rate this job ad for me"* → paste a job posting, get a scored breakdown
- *"Add that to my tracker as Applied"* → logs it to Google Sheets
- *"Show me everything I'm interviewing for"* → your full pipeline
- *"Show me my Stripe notes"* → opens a Google Doc for that application
- *"Prep me for my Linear interview — it's a behavioural round"* → full prep pack

> 📖 The story behind this, on my blog: [Part 1 - building it](https://tany4.com/blog/posts/building-a-job-hunting-mcp-server) · [Part 2 - going remote](https://tany4.com/blog/posts/taking-my-job-hunting-mcp-server-remote) · [Part 3 - teaching the agent what it can do](https://tany4.com/blog/posts/teaching-my-job-hunting-mcp-server-what-it-can-do)

---

## What it does

| Tool | What you say |
|------|-------------|
| `rate_job` | "Rate this job ad" — researches the company, checks salary, scores against your CV and preferences |
| `tailor_cv` | "Tailor my CV for this role" — writes a tailored copy of your CV into the application doc for you to review |
| `save_tailored_cv` | Used by `tailor_cv`: saves the tailored CV JSON into the application doc |
| `generate_cv_pdf` | "The Linear CV is approved, make the PDF" — builds the PDF from the approved CV in the doc (saved locally, or a temporary Drive copy on the hosted server) |
| `generate_cover_letter` | "Write me a cover letter for Stripe" / "Answer these application questions" — drafts in your voice, saved to the application doc once you're happy |
| `add_application` | "Add this to my tracker as Saved" |
| `update_application` | "Mark Stripe as Interview" |
| `get_applications` | "Show me my full pipeline" / "What am I currently interviewing for?" |
| `create_application_doc` | "Create a doc for my Stripe application" — creates a Google Doc (owned by you), links it, writes optional starter content |
| `get_application_doc` | "Show me my Stripe notes" — reads the linked Google Doc for that application |
| `update_application_doc` | "Add to my Stripe doc: 4 interview stages, take-home first" — appends a section (auto-creates the doc if none is linked) |
| `replace_doc_section` | "Rewrite the Round 1 reflection in my Stripe doc" — replaces one section; shows a preview first and only writes once you confirm |
| `format_doc` | "Format my Stripe doc" — applies Docs styling to the markup in a doc you edited by hand; styling only, the words are untouched |
| `prep_interview` | "Prep me for my Stripe final round interview" |
| `add_interview_note` | "Log that I passed the Stripe phone screen" |
| `delete_application` | "Delete the duplicate Grafana entry" — removes a row from the tracker (e.g. a duplicate or mistake) |

---

## Architecture

The MCP server exposes tools that Claude or ChatGPT can call during a conversation.

The architecture is simple:
User → Claude / ChatGPT → MCP Server → Google APIs

- Claude / ChatGPT: natural language interface
- MCP Server: exposes tools and prompts (runs locally over **stdio**, or remotely over **HTTP** — see "Running it as a remote server")
- Google Sheets: application tracker
- Google Docs: interview notes

The AI never accesses Google services directly — all access goes through the MCP server.

Code layout:
- [`src/index.js`](src/index.js) — entrypoint; picks stdio or HTTP transport
- [`src/createServer.js`](src/createServer.js) — builds the MCP server from the tool registry
- [`src/tools/`](src/tools) — one entry per tool (`{ name, definition, handler }`); **add a tool by dropping in an object here**
- [`src/sheets.js`](src/sheets.js), [`src/cv.js`](src/cv.js), [`src/config.js`](src/config.js) — Google access, CV loading, config/secret resolution

---

## Compatibility

This MCP server now works with:
- Claude — locally (Claude Desktop, via stdio) **or** remotely as a custom connector (Claude web & mobile, via HTTP)
- ChatGPT — via its MCP connector (HTTP)

Both clients consume the same MCP tool definitions, allowing the same workflow to run across different AI assistants.

**Two ways to run it:**
- **Local (stdio)** — simplest; runs on your machine for Claude Desktop. Follow the setup steps below.
- **Remote (HTTP)** — a public, token-protected URL you can add to the Claude web and mobile apps. See [Running it as a remote server](#running-it-as-a-remote-server-claude-web--mobile).

---

## Setup Overview

There are 5 things to set up:
1. Install Node.js
2. Set up Google Sheets (for your tracker)
3. Set up a Google Service Account (so the tool can read/write to your Sheet and create Docs)
4. Configure the tool
5. Connect it to Claude Desktop or ChatGPT

Take it step by step — it looks longer than it is.

---

## Step 1: Install Node.js

Go to [nodejs.org](https://nodejs.org) and download the **LTS** version. Install it like any other app.

To check it worked, open Terminal (Mac) or Command Prompt (Windows) and type:
```
node --version
```
You should see something like `v20.11.0`. Any version 18+ is fine.

---

## Step 2: Download and install the tool

```bash
git clone https://github.com/altany/job-hunter.git
cd job-hunter
npm install
```

If you don't have git, you can download the repo as a ZIP from GitHub and unzip it anywhere you like (e.g. `~/Dev/job-hunter`).

---

## Step 3: Set up Google Sheets

### 3a. Create your tracker spreadsheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank spreadsheet
2. Name it something like "Job Hunt 2025"
3. **Copy the spreadsheet ID** from the URL — it's the long string of letters and numbers between `/d/` and `/edit`:
   ```
   https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/edit
                                          ↑ this is the ID ↑
   ```
   Save this — you'll need it in Step 4.

The tool will automatically create the right columns (Applications, Interviews tabs with all headers) when you first use it.

---

## Step 4: Create a Google Service Account

A service account is like a "robot user" that the tool uses to read and write to your Google Sheet and create Docs. You need to create one in Google Cloud Console.

### 4a. Create a project in Google Cloud

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Sign in with your Google account
3. At the top, click the project dropdown (it might say "Select a project") → click **New Project**
4. Give it a name like "job-hunter" → click **Create**
5. Make sure your new project is selected in the top dropdown before continuing

### 4b. Enable the required APIs

You need to enable three APIs. Do this for each one:

1. In the left sidebar, go to **APIs & Services → Library**
2. Search for the API name → click on it → click **Enable**

Enable all three:
- **Google Sheets API**
- **Google Docs API**
- **Google Drive API**

### 4c. Create the service account

1. In the left sidebar, go to **APIs & Services → Credentials**
2. Click **+ Create Credentials** at the top → choose **Service Account**
3. Fill in a name like `job-hunter` (the ID will auto-fill) → click **Create and Continue**
4. Skip the optional "Grant this service account access" and "Grant users access" steps — just click **Done**

### 4d. Download the JSON key

1. You should now see your service account listed under "Service Accounts"
2. Click on it to open it
3. Go to the **Keys** tab
4. Click **Add Key → Create new key → JSON** → click **Create**
5. A JSON file will download automatically — this is your key file
6. **Save it somewhere safe and permanent**, e.g. `~/.config/job-hunter/service-account.json`
   - On Mac, `~` means your home folder (e.g. `/Users/yourname`)
   - On Windows, put it somewhere like `C:\Users\yourname\.config\job-hunter\service-account.json`
   - Don't put it inside the job-hunter folder (it'll be gitignored, but it's cleaner to keep credentials separate)

### 4e. Note your service account email

Open the JSON file you just downloaded and find the `client_email` field. It looks like:
```
"client_email": "job-hunter@your-project-name.iam.gserviceaccount.com"
```
Copy this email address — you'll need it in the next step.

---

## Step 5: Share your Google Sheet with the service account

The service account needs permission to edit your spreadsheet.

1. Open your Google Sheet
2. Click the **Share** button (top right)
3. In the "Add people and groups" box, paste the service account email (from Step 4e)
4. Make sure the permission is set to **Editor**
5. Uncheck "Notify people" (it's a robot, it doesn't need an email)
6. Click **Share**

---

## Step 6: Application Docs (optional)

Each application can have one Google Doc for long-form notes (interview stages, study notes, reflections, company research). Two ways to get one:

**Auto-create (recommended).** With OAuth set up (Step 6b), just say *"create a doc for my Stripe application"* or *"add to my Stripe doc: …"* — the server creates it in your Drive (owned by you), links it to the tracker, and writes your notes. One doc per application; it won't create duplicates.

**Manual.** You can always create a Doc yourself in Google Drive, share it with the service-account email as Editor, and link it: *"Link this doc to my Stripe application: [paste URL]"*.

Once linked (either way):
- *"Show me my Stripe notes"* — returns the full doc content
- *"Add to my Stripe doc: their process is 4 rounds, starting with a take-home"* — appends a new section
- *"Rewrite the Round 1 reflection in my Stripe doc: …"* — replaces that one section

**Formatting.** The assistant writes plain markdown (`## Sub-heading`, `- bullets`, `**bold**`, tables, code blocks) and the server turns it into real Docs styling after every write. For a doc you edited by hand, ask for it: *"format my Stripe doc"* runs the same formatter through `format_doc`. You can also run it from the command line: `node scripts/format-doc-headings.js <docId>`. It formats what is written, so a heading typed as `### Title` becomes Heading 3 — to change a heading's level, change the markup first.

**Correcting a section.** Each section heading appears once per doc: adding a section whose heading already exists is refused, and you're pointed to `replace_doc_section` instead. That tool:
- replaces one section only (its heading plus everything up to the next heading of the same or higher level); if the heading matches no section or more than one, it changes nothing and lists the headings it found
- does a dry run by default, showing what would be removed and what would replace it; it writes only when called again with `confirm: true`
- before writing, saves the removed text, the character counts and the doc's revision id in a **Doc edits** tab of your tracker spreadsheet, so anything replaced can be pasted back
- refuses to write if the doc changed since the preview

There is deliberately no tool that deletes a doc or clears all of it.

### Step 6b: Enable auto-creating Docs (OAuth) — optional

A service account can't create Docs (it has no Drive storage quota), so auto-create acts as *you* via OAuth. Docs end up in your own Drive, owned by you.

1. [Google Cloud Console](https://console.cloud.google.com) → **APIs & Services → Credentials → + Create Credentials → OAuth client ID** → application type **Desktop app** → Create. Copy the **client ID** and **client secret**.
   Download the client's JSON and save it in the repo root (it's named `client_secret_….json` and is gitignored).
2. **Google Auth Platform → Branding:** fill in app name, support email, the home page / privacy policy / terms links and developer contact email, then Save. Then **Audience** (user type External) → **Publish app**. Publishing stops the refresh token expiring after 7 days; the Publish button stays disabled until Branding is complete. You'll get an "unverified app" warning when you authorise — expected for a personal app; proceed.
3. Run the one-time flow:
   ```bash
   npm run auth
   ```
   Open the URL it prints and authorise with your Google account. It saves `client_id`, `client_secret` and `refresh_token` under `google_oauth` in your `config.json` (gitignored).
4. For the remote server, re-run `npm run pack-config | pbcopy` and update `JOB_HUNTER_CONFIG_JSON` on your host (it now includes `google_oauth`). Alternatively set `GOOGLE_OAUTH_JSON` separately.
5. Optional: set `google_sheets.docs_folder_id` to a Drive folder for new docs (otherwise they go to a folder named "Job Hunter MCP" if it exists, else your Drive root).

Without this, everything else still works — you just link docs manually as above.

### Step 6c: Tailored CVs and PDFs — optional

Everything written for an application (research, tailored CV, cover letter, application answers, interview prep) goes into that application's doc, not into separate files. The tool descriptions say so, so a new chat follows it without being told.

**Your writing style.** Put how you want things written in a context file, e.g. `context/writing_style.md` (plain vs. formal, words to avoid, etc.). Every writing tool includes it and it overrides the tools' generic advice.

If your CV is structured (a `.ts` or `.json` file, see `cv_file_path`), tailoring works like this:

1. *"Tailor my CV for the Linear role"* — the assistant writes a tailored copy with exactly the same structure as your CV and saves it as JSON in the application doc, under **Tailored CV**, with a few notes on what it changed. Your base CV file is never changed.
2. You review and edit the JSON in the doc. **The doc's version is the approved one**, so edit it there, not in your CV file.
3. *"The Linear CV is approved, make the PDF"* — `generate_cv_pdf` reads the JSON from the doc, checks its structure, and runs your CV repo's PDF script with it. On the local server the PDF is saved to `~/Downloads` (or `cv_pdf.output_dir`) and nothing goes to Drive. The hosted server can't reach your computer, so it puts the PDF in your Drive as a temporary copy: download it for the application; copies older than a day are deleted the next time a PDF is made. The JSON in the doc stays the record. Your name, email and website always come from your base CV.

The PDF is made by your own script (`scripts/generate-cv-pdf.tsx` accepting `--json <file> --out <file>`), so local and hosted servers produce the same PDF:
- **Local:** it runs from your repo on disk, found from `cv_file_path` when that points to `<repo>/src/cv/cv.ts`, or set `cv_pdf.repo_path`.
- **Hosted:** set `cv_pdf.github_repo` (e.g. `"you/your-site"`, must be public). The server downloads that repo at its latest commit and runs the script with its own copy of `@react-pdf/renderer`, `react` and `tsx`. Re-run `npm run pack-config` and update `JOB_HUNTER_CONFIG_JSON` so the host gets `cv_json` and `cv_pdf`.

---

## Step 7: Configure the tool

```bash
cp config.example.json config.json
```

Now open `config.json` in any text editor and fill in your details:

```json
{
  "cv_file_path": "/Users/yourname/Documents/cv.pdf",

  "cv_constants": {
    "name": "Your Name",
    "CONTACT_EMAIL": "you@example.com"
  },

  "google_sheets": {
    "spreadsheet_id": "PASTE_YOUR_SPREADSHEET_ID_HERE",
    "service_account_key_file": "/Users/yourname/.config/job-hunter/service-account.json"
  },

  "preferences": {
    "work_style": {
      "preferred": ["Remote", "Hybrid"],
      "dealbreaker": ["Onsite-only if >2 days/week"]
    },
    "salary": {
      "minimum": 60000,
      "target": 80000,
      "currency": "GBP",
      "notes": "Open to equity in early-stage startups"
    },
    "industries": {
      "preferred": ["Industry A", "Industry B"],
      "open_to": ["Industry C"],
      "avoid": ["Industry D", "Industry E"]
    },
    "tech_stack": {
      "strong": ["Language/framework you know well"],
      "familiar": ["Language/framework you know a bit"],
      "avoid": ["Tech you don't want to work with"]
    },
    "environment": {
      "values": [
        "What matters to you in a workplace",
        "e.g. Autonomous work, minimal micromanagement",
        "e.g. Work-life balance respected"
      ],
      "red_flags": [
        "Things that would put you off a role",
        "e.g. On-call culture without compensation",
        "e.g. High turnover signals"
      ]
    },
    "role_level": "e.g. Senior / Lead / Principal",
    "open_to_management": false,
    "notice_period_weeks": 4,
    "right_to_work": "e.g. UK, EU, US — no sponsorship needed"
  }
}
```

**Important:** Use the full absolute path for both `cv_file_path` and `service_account_key_file` — not `~/Documents/...`, but `/Users/yourname/Documents/...`. On Windows, use `C:\\Users\\yourname\\...` (double backslashes).

**Supported CV formats:** `.pdf`, `.docx`, `.md`, `.txt`, `.ts`, `.json`

---

## Step 8: Add your context files

Create a `context/` folder inside the project and add `.md` files with information about yourself. This is what makes the tool give you personalised results — the more you put here, the better it works.

```
job-hunter/
└── context/
    └── candidate_knowledge_base.md   ← your main file
```

Suggested things to include in `candidate_knowledge_base.md`:
- A summary of your background and positioning
- What you're looking for in your next role
- STAR stories for common interview questions
- Things to avoid mentioning / frame carefully

(Your live pipeline lives in the tracker Sheet, so there's no need to duplicate it here.)

The `context/` folder is gitignored — it stays on your machine only.

---

## Step 9: Connect to your assistant

### Claude Desktop

Claude Desktop is the desktop app for Claude.

#### a. Find the config file

Claude Desktop stores MCP server config in a file called `claude_desktop_config.json`:

- **Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

If the file doesn't exist yet, create it.

#### b. Add the server config

Open the file and add (or merge into) this JSON — replace the path with the actual absolute path to `src/index.js` on your machine:

```json
{
  "mcpServers": {
    "job-hunter": {
      "command": "node",
      "args": ["/Users/yourname/Dev/job-hunter/src/index.js"]
    }
  }
}
```

**Mac example:**
```json
{
  "mcpServers": {
    "job-hunter": {
      "command": "node",
      "args": ["/Users/yourname/Dev/job-hunter/src/index.js"]
    }
  }
}
```

**Windows example:**
```json
{
  "mcpServers": {
    "job-hunter": {
      "command": "node",
      "args": ["C:\\Users\\yourname\\Dev\\job-hunter\\src\\index.js"]
    }
  }
}
```

#### c. Restart Claude Desktop

Fully quit Claude Desktop (don't just close the window — quit it from the menu bar or taskbar) and reopen it.

You should now see the job-hunter tools available in your Claude session — there'll usually be a small indicator showing MCP tools are active.


---

## Running it as a remote server (Claude web & mobile)

The same server can also run over **HTTP** behind a public HTTPS URL, so you can
add it as a **custom connector** in the Claude web app and the Claude mobile
apps — no desktop config file required.

The transport is chosen with the `MCP_TRANSPORT` environment variable:

| `MCP_TRANSPORT` | Transport | Use |
|-----------------|-----------|-----|
| `stdio` (default) | stdin/stdout | Local desktop apps (the setup above) |
| `http` | Streamable HTTP | Remote, public server |

Both share the exact same tool logic in [`src/createServer.js`](src/createServer.js).

The HTTP transport is stateless: every request is handled on its own, with no session to lose. Restarts (deploys, a free host waking from sleep) are invisible to connected clients.

### Environment variables (HTTP mode)

| Variable | Required | Purpose |
|----------|----------|---------|
| `MCP_TRANSPORT=http` | ✅ | Selects the HTTP transport |
| `MCP_AUTH_TOKEN` | ✅ | Shared secret clients must present (≥16 chars). Generate: `openssl rand -hex 32` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | ✅ | The service-account key **JSON contents** (not a path) |
| `JOB_HUNTER_CONFIG_JSON` | ✅ | Your full config as a JSON string — preferences, `google_sheets.spreadsheet_id`, plus inlined `cv_text` and `context_text`. Generate it with `npm run pack-config` (don't build it by hand). |
| `PORT` | – | Port to listen on (the host usually injects this) |

See [`.env.example`](.env.example) for the shape. **No secret is ever read from
source** — only from these env vars (hosted) or a gitignored `config.json` (local).

### Generate the config blob (`npm run pack-config`)

Don't assemble `JOB_HUNTER_CONFIG_JSON` by hand. Run:

```bash
npm run pack-config | pbcopy      # macOS: copies the blob to your clipboard
# or: npm run pack-config > my-config.blob.json
```

It reads your local `config.json`, CV file, and `context/*.md`, inlines the CV
(`cv_text`) and context (`context_text`), strips the local key-file path, and
prints the single JSON value to set as `JOB_HUNTER_CONFIG_JSON`. Re-run it and
update the env var whenever your config or context changes. The service-account
key (`GOOGLE_SERVICE_ACCOUNT_JSON`) and token (`MCP_AUTH_TOKEN`) are set separately.

### Test it locally over HTTP

```bash
cp .env.example .env          # fill in MCP_AUTH_TOKEN etc.
npm run start:http            # listens on http://localhost:3001/mcp
```

Smoke test (should return your tools):

```bash
curl -s localhost:3001/health        # → {"status":"ok"}

curl -s -X POST localhost:3001/mcp \
  -H "Authorization: Bearer $MCP_AUTH_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"c","version":"1"}}}'
```

A request with no / wrong token returns `401 Unauthorized`.

### Authentication

A single shared **bearer token** (`MCP_AUTH_TOKEN`). The same secret is accepted
two ways so it works with whatever your client supports:

1. `Authorization: Bearer <token>` header, or
2. a token in the URL path: `https://<host>/mcp/<token>`

This is deliberately simple (single user) — no OAuth. The server refuses to
start in HTTP mode without a strong token, so it can never come up unauthenticated.

---

## Deploy your own

Any host that runs a Node web service works. Two free options:

### Option A — Render (no credit card)

[Render](https://render.com)'s free tier needs no card. Trade-off: the service
sleeps after ~15 min idle, so the first request after a nap takes ~50s to wake
(see "Keeping it awake" below).

1. Push your fork to GitHub, then on Render: **New → Web Service** and connect the repo.
2. **Build command:** `npm ci` · **Start command:** `npm run start:http` (or let Render use the included `Dockerfile`).
3. **Instance type:** Free · **Health Check Path:** `/health`.
4. Add environment variables:
   - `MCP_TRANSPORT` = `http`
   - `MCP_AUTH_TOKEN` = a strong secret (`openssl rand -hex 32`)
   - `GOOGLE_SERVICE_ACCOUNT_JSON` = the full contents of your service-account key file
   - `JOB_HUNTER_CONFIG_JSON` = the output of `npm run pack-config`
5. Create the service. Your MCP endpoint is the Render URL + `/mcp`.

### Option B — Google Cloud Run

Free at personal volume and scales to zero, but **requires a billing account on
file (a card)** even for free-tier usage, and secrets live next to it in Secret
Manager. A `Dockerfile` is included; `--source .` builds it for you.

> Prerequisites: a Google Cloud project (the same one your service account is in)
> and the [`gcloud` CLI](https://cloud.google.com/sdk/docs/install) installed and
> logged in (`gcloud auth login`).

```bash
# 0. Pick your project and region
gcloud config set project YOUR_PROJECT_ID
gcloud config set run/region europe-west1

# 1. Enable the services
gcloud services enable run.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com

# 2. Store the three secrets (paste/​pipe the real values)
gcloud secrets create mcp-auth-token --data-file=- <<< "$(openssl rand -hex 32)"
gcloud secrets create google-sa-json --data-file=/path/to/service-account.json
gcloud secrets create job-hunter-config --data-file=/path/to/your-config.json
```

`job-hunter-config` is the output of `npm run pack-config` (your config + CV + context, inlined, with the local key-file path stripped). The key itself comes from its own secret.

```bash
# 3. Deploy (builds the container from source, wires secrets to env vars)
gcloud run deploy job-hunter \
  --source . \
  --allow-unauthenticated \
  --set-env-vars MCP_TRANSPORT=http \
  --set-secrets MCP_AUTH_TOKEN=mcp-auth-token:latest \
  --set-secrets GOOGLE_SERVICE_ACCOUNT_JSON=google-sa-json:latest \
  --set-secrets JOB_HUNTER_CONFIG_JSON=job-hunter-config:latest
```

`--allow-unauthenticated` means *Cloud Run* won't add its own IAM layer — your
own `MCP_AUTH_TOKEN` is what protects the endpoint. The command prints a
**Service URL** like `https://job-hunter-xxxxx-ew.a.run.app`; your MCP endpoint
is that URL + `/mcp`.

To read the token back later: `gcloud secrets versions access latest --secret=mcp-auth-token`.

To update after code changes: re-run the `gcloud run deploy` command.

### Keeping it awake (free tiers that sleep)

Free hosts spin down when idle, so the first request after a gap is slow. To avoid that, set up a free scheduled ping (e.g. [cron-job.org](https://cron-job.org) or [UptimeRobot](https://uptimerobot.com)) that hits `https://<your-host>/health` every few minutes.

---

## Connect from Claude (custom connector)

Once deployed you have two values:

- **Remote MCP server URL:** your host's URL + `/mcp` (e.g. `https://<your-host>/mcp`)
- **Auth token:** the `MCP_AUTH_TOKEN` value

### Claude web / desktop

1. **Settings → Connectors → Add custom connector**.
2. **Name:** `job-hunter`.
3. **Remote MCP server URL:** your `…/mcp` URL.
4. **Authentication:** if there's an OAuth/token field, paste the token there.
   If there's no token field, use the **token-in-URL** form instead and leave
   auth as none: `https://<your-host>/mcp/<your-token>`.
5. Save, then **enable** the connector. The job-hunter tools appear in chat.

### Claude mobile (iOS / Android)

Same connector syncs to mobile once added on web. If adding directly on mobile:
**Settings → Connectors → Add custom connector**, paste the same URL (or the
token-in-URL form), save, enable.

> Heads up: the token-in-URL form is convenient but the token can appear in
> server/proxy logs. Prefer the `Authorization: Bearer` header field if your
> client exposes one; rotate the token (redeploy `mcp-auth-token`) if it leaks.

### ChatGPT

The same HTTP server works with ChatGPT's MCP/Developer-mode connector — add the
same URL. (It previously used a Cloudflare tunnel; a deployed remote URL works
the same way and is authenticated.)

---

## Testing it works

Try these in Claude Desktop after restarting:

**Test 1 — Sheets connection:**
```
"Show me my job applications"
```
→ Should return "No applications tracked yet." If you get a permissions or config error, check your `spreadsheet_id` and that the sheet is shared with the service account.

**Test 2 — CV loading:**
```
"Tailor my CV for a senior frontend role at a SaaS company"
```
→ Should produce a tailored CV using your actual experience. If it can't find your CV, check `cv_file_path` in `config.json`.

**Test 3 — Full flow:**
```
"Rate this job: [paste any job ad]"
```
→ Should research the company and give you a scored breakdown against your preferences.

---

## Troubleshooting

**"Config file not found"** — Make sure you've copied `config.example.json` to `config.json`. The file must be named exactly `config.json`.

**"CV file not found"** — Use the full absolute path. On Mac: `/Users/yourname/...`, not `~/...`.

**Google Sheets permission error** — The most common cause: you haven't shared the spreadsheet with your service account email. Go to your Sheet → Share → add the `client_email` from your JSON key file → Editor access.

**Google Docs/Drive error** — Make sure you've enabled all three APIs (Sheets, Docs, Drive) in Google Cloud Console, not just Sheets. Also make sure you've shared the Drive folder with the service account if you're using one.

**Claude can't find the tools** — Check that the path in `claude_desktop_config.json` is correct and absolute. Test by running `node /path/to/src/index.js` directly in Terminal — if it hangs (waits for input), it's working. If it throws an error, check your config.json.

**Changes not taking effect** — Always fully quit and restart Claude Desktop after changing `claude_desktop_config.json` or `config.json`. For the hosted server, changes to `config.json`, your CV or `context/*.md` only reach it after you re-run `npm run pack-config` and update `JOB_HUNTER_CONFIG_JSON`.

**The assistant doesn't see a new or changed tool** — Clients cache the tool list for a chat. After updating the server, disconnect and reconnect the connector, or start a new chat.

---

## Utility Scripts

These scripts live in `scripts/` and are run manually from the command line. They use the same service account credentials as the main tool.

---

### `format-doc-headings.js` — Format a Google Doc by hand

The server formats a doc automatically after every write, and the `format_doc` tool does the same from a chat. This script is the command-line version, useful for formatting several docs in one go. It turns the markup below into real Google Docs styling, so the outline and navigation work.

**Run it:**
```bash
node scripts/format-doc-headings.js <docId>
```

**Example:**
```bash
node scripts/format-doc-headings.js 1HCpkACzu-kTVnRwf_GddXzxGyu12345678910E2PSXw
```

The doc ID is the string between `/d/` and `/edit` in the Google Doc URL.

**To run it on all your docs at once:**
```bash
for id in <docId1> <docId2> <docId3>; do node scripts/format-doc-headings.js $id; done
```

**What it converts:**

| Markup in doc | Becomes |
|---------------|---------|
| Long `━━━` line / TEXT / long `━━━` line (section headings the server adds) | Heading 2 |
| Short `━━━` line / TEXT / short `━━━` line, or `## TEXT` | Heading 3 |
| `### TEXT` or `--- TEXT ---` | Heading 4 |
| `-- TEXT --` | Heading 5 |
| `- item` | Bullet list |
| `\| a \| b \|` rows | Table |
| ```` ``` ```` fenced block | Code block (contents left exactly as written) |
| a line with just `---` | Horizontal rule |
| `**bold**`, `_italic_`, `` `code` ``, `~~strike~~` | Inline styles |

Re-running it only touches markup that hasn't been formatted yet. **Nothing to change** — the script reads credentials from `config.json` automatically.

---

### `format-sheet-status.js` — Style and sort the tracker spreadsheet

Applies visual formatting to your Applications sheet and sorts rows by status priority. Run this after adding new applications or whenever you want to re-sort.

**Run it:**
```bash
node scripts/format-sheet-status.js
```

**What it does:**
- Colours each row by status (pale green = Interview, pale blue = Applied, etc.)
- Strikethrough + grey text on Rejected and Withdrawn rows
- Paler font on Saved rows
- Colour scale on the Rating column (red → yellow → green)
- Dropdown validation on the Status column
- Sorts rows by status priority: **Offer → Interview → Applied → Phone Screen → Saved → Rejected → Withdrawn**
- Secondary sort: Rating descending within each group

**Config before running for the first time:**

The script reads your spreadsheet from `config.json` (or the `JOB_HUNTER_CONFIG_JSON` / `SPREADSHEET_ID` env vars) — nothing is hardcoded. Make sure these are set:

| Config field | What to set |
|---|---|
| `google_sheets.spreadsheet_id` | Your spreadsheet ID (from the URL) |
| `google_sheets.applications_sheet_gid` | The numeric ID of your Applications tab — in the URL after `gid=` when that tab is open (defaults to `0`) |

Column positions for the Status/Rating styling are constants at the top of the script (`STATUS_COL_INDEX`, `RATING_COL_INDEX`).

> **Column index reference:** A=0, B=1, C=2, D=3, E=4, F=5, G=6, H=7, I=8, J=9 ...

**To customise the status sort order**, edit the `STATUS_ORDER` array near the top of the script:
```js
const STATUS_ORDER = ["Offer", "Interview", "Applied", "Phone Screen", "Saved", "Rejected", "Withdrawn"];
```

**To customise the status colours**, edit the `STATUS_COLOURS` object. Colours are RGB values between 0 and 1:
```js
const STATUS_COLOURS = {
  Interview: { red: 0.85, green: 0.94, blue: 0.85 },  // pale green
  Applied:   { red: 0.85, green: 0.90, blue: 0.98 },  // pale blue
  // ...
};
```


---

## File structure

```
job-hunter/
├── src/
│   ├── index.js          # Entrypoint — selects stdio or HTTP transport
│   ├── createServer.js   # Builds the MCP server from the tool registry
│   ├── http.js           # Remote Streamable HTTP transport (+ auth, /health)
│   ├── auth.js           # Bearer-token middleware (HTTP mode)
│   ├── config.js         # Config + secret resolution (env or config.json)
│   ├── sheets.js         # Google Sheets + Docs read/write
│   ├── cv.js             # CV loading (PDF, DOCX, MD, TXT, TS, JSON)
│   ├── cvSchema.js       # Structured CV shape + validation for tailored CVs
│   ├── cvRenderer.js     # Finds the CV repo (local or GitHub) and runs its PDF script
│   ├── docFormatter.js   # Turns doc markup into Docs styling (runs after every write)
│   ├── docSections.js    # Doc sections, markup rules, doc → markdown
│   └── tools/
│       ├── index.js      # Tool registry — add new tools here
│       ├── prompts.js    # rate_job, tailor_cv, generate_cover_letter, prep_interview
│       ├── tracker.js    # add/update/get applications + docs + notes
│       └── cvTools.js    # save_tailored_cv, generate_cv_pdf
├── scripts/
│   ├── format-doc-headings.js    # Format a doc by hand (the server does it after every write)
│   ├── format-sheet-status.js    # Style and sort the Applications sheet
│   ├── pack-config.js            # Bundle config + CV + context for the host (npm run pack-config)
│   └── oauth-setup.js            # One-time OAuth flow for auto-creating Docs (npm run auth)
├── context/              # Your personal context files (gitignored)
│   └── candidate_knowledge_base.md
├── Dockerfile            # For Cloud Run / any container host
├── .env.example          # Env vars for HTTP mode
├── config.json           # Your config + local secrets (gitignored)
├── config.example.json   # Template
├── package.json
└── README.md
```

### Adding your own tool

Tools live in [`src/tools/`](src/tools). Add one by appending an object to an
existing file (or a new file imported from `src/tools/index.js`):

```js
{
  name: "my_tool",
  definition: { name: "my_tool", description: "...", inputSchema: { /* ... */ } },
  handler: async (args, { config, sheets, cvText, preferences, contextFiles }) => ({
    content: [{ type: "text", text: "result" }],
  }),
}
```

Rules and extra context are loaded automatically from your `preferences` (in
config) and the `context/*.md` files, so you can grow the guidance without
touching any tool code.

---

## What to commit vs what to keep local

| File | Committed | Notes |
|------|-----------|-------|
| `src/` | ✅ | The tool code |
| `config.example.json` | ✅ | Template — no real values |
| `README.md` | ✅ | |
| `package.json` | ✅ | |
| `Dockerfile` / `.env.example` | ✅ | Deploy config — no real values |
| `config.json` | ❌ | Your credentials and preferences |
| `.env` | ❌ | Your local env vars / token |
| `context/` | ❌ | Your personal data |
| `*-service-account*.json` / `*-key.json` | ❌ | Google credentials |
| `client_secret_*.json` | ❌ | OAuth client (for auto-creating Docs) |

> The included [`.gitignore`](.gitignore) already excludes all of the ❌ rows.
> Before making the repo public, double-check with `git status` that no
> `config.json`, `.env`, or service-account JSON is staged.

---

## Privacy

Running locally, your CV, preferences and context stay on your machine. Running remotely, they live in your host's environment variables (e.g. Render), not in the repo. The services involved are:
- **Google Sheets / Docs / Drive API** — reads and writes *your own* spreadsheet and documents
- **Claude or ChatGPT** — the assistant that calls the tools and generates ratings, cover letters, prep materials etc.
- **Your host** (remote only) — runs the server and stores its secrets

Nothing else is sent anywhere.