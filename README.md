# 🎯 job-hunter

A personal MCP (Model Context Protocol) server that turns Claude or ChatGPT into a job search assistant — rate job postings, tailor CVs, write cover letters, track applications, prep for interviews, and keep notes on each company.

Once set up, you interact with it through natural language in Claude or ChatGPT. Say things like:
- *"Rate this job ad for me"* → paste a job posting, get a scored breakdown
- *"Add that to my tracker as Applied"* → logs it to Google Sheets
- *"Show me everything I'm interviewing for"* → your full pipeline
- *"Show me my Stripe notes"* → opens a Google Doc for that application
- *"Prep me for my Linear interview — it's a behavioural round"* → full prep pack

---

## What it does

| Tool | What you say |
|------|-------------|
| `rate_job` | "Rate this job ad" — researches the company, checks salary, scores against your CV and preferences |
| `tailor_cv` | "Tailor my CV for this role" |
| `generate_cover_letter` | "Write me a cover letter for Stripe" |
| `add_application` | "Add this to my tracker as Saved" |
| `update_application` | "Mark Stripe as Interview" |
| `get_applications` | "Show me my full pipeline" / "What am I currently interviewing for?" |
| `get_application_doc` | "Show me my Stripe notes" — reads the linked Google Doc for that application |
| `update_application_doc` | "Add to my Stripe doc: 4 interview stages, take-home first" |
| `prep_interview` | "Prep me for my Stripe final round interview" |
| `add_interview_note` | "Log that I passed the Stripe phone screen" |

---

## Architecture

The MCP server exposes tools that Claude or ChatGPT can call during a conversation.

The architecture is simple:
User → Claude / ChatGPT → MCP Server → Google APIs

- Claude / ChatGPT: natural language interface
- MCP Server: exposes tools and prompts
- Google Sheets: application tracker
- Google Docs: interview notes

The AI never accesses Google services directly — all access goes through the MCP server.

---

## Compatibility

This MCP server now works with:
- Claude
- ChatGPT

Both clients consume the same MCP tool definitions, allowing the same workflow to run across different AI assistants.

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
git clone https://github.com/YOUR_USERNAME/job-hunter.git
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

## Step 6: Create Google Docs for your applications

For each job you want to track in detail, create a Google Doc manually and link it to your tracker.

1. Open [drive.google.com](https://drive.google.com) and create a doc wherever you like (e.g. in a `Jobs` folder)
2. Name it something like `Stripe — Senior Engineer | Interview Notes`
3. Copy the doc URL from your browser
4. Tell Claude or ChatGPT: *"Link this doc to my Stripe application: [paste URL]"* — it will store it in your tracker

Once linked, you can say things like:
- *"Show me my Stripe notes"* — returns the full doc content
- *"Add to my Strip doc: their process is 4 rounds, starting with a take-home"* — appends a new section

> **Note:** Automatic doc creation via the tool is not currently supported due to Google Drive API permission limitations with service accounts on personal Drive.

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
- Your current pipeline and any active interview stages

The `context/` folder is gitignored — it stays on your machine only.

---

## Step 9: Connect to your assistant

### Claude Desktop

Claude Desktop is the desktop app for Claude. You need a Claude Pro account for MCP support.

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


### ChatGPT
This MCP server was originally built for **Claude**, but it can also be used with **ChatGPT's MCP integration**.

The same MCP tools work across both environments without modification.

---

## Exposing the MCP Server

ChatGPT requires the MCP server to be accessible via a **public HTTPS URL**.

A simple way to achieve this is by using a **Cloudflare Tunnel**.

### Install Cloudflare Tunnel

```bash
brew install cloudflared
```

Login to your Cloudflare account:
```bash
cloudflared tunnel login
```

Create a tunnel:
```bash
cloudflared tunnel create job-hunter
```

#### Create Tunnel Configuration

Create the file:
```
~/.cloudflared/config.yml
```

Example configuration:
```yaml
tunnel: job-hunter
credentials-file: ~/.cloudflared/job-hunter.json

ingress:
  - hostname: jobhunter.yourdomain.com
    service: http://localhost:3001
  - service: http_status:404
```

Create the DNS route:
```bash
cloudflared tunnel route dns job-hunter jobhunter.yourdomain.com
```

Start the tunnel:
```bash
cloudflared tunnel run job-hunter
```

#### Running the MCP Server

Start the MCP server locally:
```bash
node src/chatgpt.js
```

Or run both the server and the tunnel together:
```bash
npm run chatgpt
```
Example script in `package.json`:
```json
"chatgpt": "concurrently \"node src/chatgpt.js\" \"cloudflared tunnel run job-hunter\""
```

#### Connecting ChatGPT to the MCP Server

In ChatGPT:

1. Open Developer Mode
2. Add a new MCP Server
3. Enter the server URL: `https://jobhunter.yourdomain.com/mcp`
4. Authentication: `No authentication`

Once connected, ChatGPT will automatically discover all tools exposed by the MCP server.
Keep Developer mode enabled while using the tool.
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

**Changes not taking effect** — Always fully quit and restart Claude Desktop after changing `claude_desktop_config.json` or `config.json`.

---

## Utility Scripts

These scripts live in `scripts/` and are run manually from the command line. They use the same service account credentials as the main tool.

---

### `format-doc-headings.js` — Format Google Doc headings

Converts ASCII-style section dividers in an application doc into proper Google Doc heading styles (H2–H5), so the document outline and navigation work correctly.

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

| Format in doc | Becomes |
|---------------|---------|
| Long `━━━` line / TEXT / long `━━━` line | Heading 2 |
| Short `━━━` line / TEXT / short `━━━` line | Heading 3 |
| `--- TEXT ---` | Heading 4 |
| `-- TEXT --` | Heading 5 |

**Nothing to change** — the script reads credentials from `config.json` automatically.

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

**Things to check before running for the first time:**

| Constant | Location in script | What to set |
|---|---|---|
| `SPREADSHEET_ID` | Top of file | Your spreadsheet ID (from the URL) |
| `SHEET_ID` | Top of file | The numeric ID of your Applications tab — find it in the URL after `gid=` when you have that tab open |
| `STATUS_COL_INDEX` | Top of file | 0-based column index of your Status column (e.g. `8` = column I) |
| `RATING_COL_INDEX` | Top of file | 0-based column index of your Rating column (e.g. `7` = column H) |

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
│   ├── index.js          # MCP server + all tool definitions and prompts
│   ├── sheets.js         # Google Sheets + Docs read/write
│   └── cv.js             # CV loading (PDF, DOCX, MD, TXT, TS, JSON)
├── scripts/
│   ├── format-doc-headings.js    # Convert ASCII headings to Google Doc styles
│   └── format-sheet-status.js   # Style and sort the Applications sheet
├── context/              # Your personal context files (gitignored)
│   └── candidate_knowledge_base.md
├── config.json           # Your config (gitignored)
├── config.example.json   # Template
├── package.json
└── README.md
```

---

## What to commit vs what to keep local

| File | Committed | Notes |
|------|-----------|-------|
| `src/` | ✅ | The tool code |
| `config.example.json` | ✅ | Template — no real values |
| `README.md` | ✅ | |
| `package.json` | ✅ | |
| `config.json` | ❌ | Your credentials and preferences |
| `context/` | ❌ | Your personal data |
| `*-service-account*.json` | ❌ | Google credentials |

---

## Privacy

Your CV and preferences stay entirely on your machine. The only external services used are:
- **Google Sheets / Docs API** — reads and writes to *your own* spreadsheet and documents
- **Claude** — the AI that generates ratings, cover letters, prep materials etc.

Nothing is sent to any third-party service.