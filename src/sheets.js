import { google } from "googleapis";
import fs from "fs";
import { createFormatter } from "./docFormatter.js";
import { docToMarkdown } from "./docSections.js";

// Column index map (0-based) for Applications sheet
// A=0  B=1       C=2     D=3    E=4       F=5         G=6        H=7      I=8      J=9           K=10        L=11    M=12          N=13
// Date Company   Role    URL    Salary    Work Type   Location   Rating   Status   Applied Date  Next Step   Notes   Last Updated  Doc URL

const COL = {
  DATE_ADDED:   0,
  COMPANY:      1,
  ROLE:         2,
  URL:          3,
  SALARY:       4,
  WORK_TYPE:    5,
  LOCATION:     6,
  RATING:       7,
  STATUS:       8,
  APPLIED_DATE: 9,
  NEXT_STEP:    10,
  NOTES:        11,
  LAST_UPDATED: 12,
  DOC_URL:      13,
};

function colLetter(idx) {
  return String.fromCharCode(65 + idx);
}

function extractDocId(url) {
  const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

// Structured starter content for a new application doc.
function DEFAULT_DOC_TEMPLATE(company, role) {
  const bar = "━".repeat(38);
  return [
    `${company} — ${role}`,
    "Interview Process & Notes",
    "",
    bar, "ROLE OVERVIEW", bar,
    "Paste job ad summary, key requirements, and your initial take here.",
    "",
    bar, "INTERVIEW STAGES", bar,
    "Document each stage: what to expect, who you'll meet, what they assess.",
    "",
    bar, "STUDY NOTES & PREP", bar,
    "Topics to brush up on, links to resources, practice questions.",
    "",
    bar, "INTERVIEW REFLECTIONS", bar,
    "Post-interview notes: what went well, what to improve, questions they asked.",
    "",
    bar, "COMPANY RESEARCH", bar,
    "Key facts, recent news, product notes, people you've spoken to.",
    "",
  ].join("\n");
}

export class GoogleSheetsClient {
  constructor(config) {
    this.spreadsheetId = config.google_sheets.spreadsheet_id;

    // Credentials come from either an inline service-account object (hosted —
    // injected via GOOGLE_SERVICE_ACCOUNT_JSON) or a key file path (local).
    // Never hardcoded; never read from source.
    const { service_account_json, service_account_key_file } = config.google_sheets;
    const authOptions = {
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/documents",
        "https://www.googleapis.com/auth/drive",
      ],
    };
    if (service_account_json) {
      authOptions.credentials = service_account_json;
      this.serviceAccountEmail = service_account_json.client_email || null;
    } else if (service_account_key_file) {
      authOptions.keyFile = service_account_key_file;
      try {
        this.serviceAccountEmail =
          JSON.parse(fs.readFileSync(service_account_key_file, "utf8")).client_email || null;
      } catch {
        this.serviceAccountEmail = null;
      }
    } else {
      throw new Error(
        "No Google credentials configured. Set GOOGLE_SERVICE_ACCOUNT_JSON " +
          "(hosted) or google_sheets.service_account_key_file in config.json (local)."
      );
    }
    const auth = new google.auth.GoogleAuth(authOptions);
    this.sheets = google.sheets({ version: "v4", auth });
    this.docs = google.docs({ version: "v1", auth });
    this.drive = google.drive({ version: "v3", auth });

    // Optional OAuth user credentials — used ONLY to create Docs (owned by the
    // user), which the service account cannot do: a service account has no Drive
    // storage quota, so it can't own a file. Everything else (Sheets, reading and
    // appending docs) still runs as the service account.
    this.docsFolderId = config.google_sheets?.docs_folder_id || null;
    this.docsFolderName = config.google_sheets?.docs_folder_name || "Job Hunter MCP";
    const oauth = config.google_oauth;
    if (oauth?.client_id && oauth?.client_secret && oauth?.refresh_token) {
      const oauth2 = new google.auth.OAuth2(oauth.client_id, oauth.client_secret);
      oauth2.setCredentials({ refresh_token: oauth.refresh_token });
      this.oauthDocs = google.docs({ version: "v1", auth: oauth2 });
      this.oauthDrive = google.drive({ version: "v3", auth: oauth2 });
    } else {
      this.oauthDocs = null;
      this.oauthDrive = null;
    }
  }

  async ensureSheets() {
    const res = await this.sheets.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
    const existing = res.data.sheets.map((s) => s.properties.title);

    const needed = [
      {
        title: "Applications",
        headers: [
          "Date Added", "Company", "Role", "URL", "Salary", "Work Type",
          "Location", "Rating", "Status", "Applied Date", "Next Step", "Notes", "Last Updated", "Doc URL",
        ],
      },
      {
        title: "Interviews",
        headers: [
          "Date", "Company", "Role", "Round", "Interviewers",
          "Interview Date", "Notes", "Outcome",
        ],
      },
      {
        title: "Doc edits",
        headers: [
          "Timestamp", "Company", "Role", "Doc URL", "Heading",
          "Chars before", "Chars after", "Revision before", "Removed text", "Result",
        ],
      },
    ];

    const sheetsToCreate = needed.filter((s) => !existing.includes(s.title));

    if (sheetsToCreate.length > 0) {
      await this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        requestBody: {
          requests: sheetsToCreate.map((s) => ({
            addSheet: { properties: { title: s.title } },
          })),
        },
      });

      for (const sheet of sheetsToCreate) {
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `${sheet.title}!A1`,
          valueInputOption: "RAW",
          requestBody: { values: [sheet.headers] },
        });
      }
    }
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  async _findRow(company, role) {
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: "Applications!A:N",
    });
    const rows = res.data.values || [];

    const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
    const nc = norm(company);
    const nr = norm(role);
    if (!nc) return { rows, rowIndex: -1 };
    const overlaps = (a, b) => a && b && (a.includes(b) || b.includes(a));

    // 1. Company + role both overlap (tolerates minor wording differences).
    let rowIndex = rows.findIndex(
      (r, i) => i > 0 && overlaps(norm(r[COL.COMPANY]), nc) && overlaps(norm(r[COL.ROLE]), nr)
    );
    if (rowIndex !== -1) return { rows, rowIndex };

    // 2. Fall back to company alone when it's unambiguous — the role is often
    //    worded differently by the caller. Only if exactly one row matches.
    const companyRows = [];
    rows.forEach((r, i) => {
      if (i > 0 && overlaps(norm(r[COL.COMPANY]), nc)) companyRows.push(i);
    });
    if (companyRows.length === 1) return { rows, rowIndex: companyRows[0] };

    return { rows, rowIndex: -1 };
  }

  // ─── Applications ──────────────────────────────────────────────────────────

  async addApplication(args) {
    await this.ensureSheets();
    const now = new Date().toISOString().split("T")[0];
    const row = [
      now,
      args.company_name,
      args.role_title,
      args.job_url || "",
      args.salary || "",
      args.work_type || "",
      args.location || "",
      args.rating != null ? String(args.rating) : "",
      args.status || "Saved",
      args.status === "Applied" ? now : "",
      args.next_step || "",
      args.notes || "",
      now,
      args.doc_url || "",
    ];

    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: "Applications!A:N",
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    });
  }

  async updateApplication(args) {
    await this.ensureSheets();
    const { rows, rowIndex } = await this._findRow(args.company_name, args.role_title);

    if (rowIndex === -1) {
      return `❌ Could not find application for "${args.role_title}" at ${args.company_name}. Check the spelling or use get_applications to see existing entries.`;
    }

    const sheetRow = rowIndex + 1;
    const existing = rows[rowIndex];
    const now = new Date().toISOString().split("T")[0];

    const updates = [];

    if (args.rating != null) {
      updates.push({ col: colLetter(COL.RATING), value: String(args.rating) });
    }

    if (args.status) {
      updates.push({ col: colLetter(COL.STATUS), value: args.status });
      if (args.status === "Applied" && !existing[COL.APPLIED_DATE]) {
        updates.push({ col: colLetter(COL.APPLIED_DATE), value: now });
      }
    }

    if (args.next_step) {
      updates.push({ col: colLetter(COL.NEXT_STEP), value: args.next_step });
    }

    if (args.notes) {
      const isRatingOnly = /^Rating:\s*[\d.]+\/10$/.test(args.notes.trim());
      if (!isRatingOnly) {
        const existingNotes = existing[COL.NOTES] || "";
        const newNotes = existingNotes
          ? `${existingNotes}\n[${now}] ${args.notes}`
          : `[${now}] ${args.notes}`;
        updates.push({ col: colLetter(COL.NOTES), value: newNotes });
      }
    }

    if (args.salary_offered) {
      updates.push({ col: colLetter(COL.SALARY), value: args.salary_offered });
    }

    if (args.job_url) {
      updates.push({ col: colLetter(COL.URL), value: args.job_url });
    }

    if (args.salary || args.salary_offered) {
      updates.push({ col: colLetter(COL.SALARY), value: args.salary_offered || args.salary });
    }

    if (args.work_type) {
      updates.push({ col: colLetter(COL.WORK_TYPE), value: args.work_type });
    }

    if (args.location) {
      updates.push({ col: colLetter(COL.LOCATION), value: args.location });
    }

    if (args.doc_url) {
      updates.push({ col: colLetter(COL.DOC_URL), value: args.doc_url });
    }

    updates.push({ col: colLetter(COL.LAST_UPDATED), value: now });

    for (const { col, value } of updates) {
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `Applications!${col}${sheetRow}`,
        valueInputOption: "RAW",
        requestBody: { values: [[value]] },
      });
    }

    return `✅ Updated "${args.role_title}" at ${args.company_name}${args.status ? ` → ${args.status}` : ""}${args.rating != null ? ` | ⭐ ${args.rating}/10` : ""}${args.job_url ? ` | 🔗 URL updated` : ""}${args.doc_url ? ` | 📄 Doc linked` : ""}.`;
  }

  async deleteApplication(company, role) {
    await this.ensureSheets();
    const { rows, rowIndex } = await this._findRow(company, role);

    if (rowIndex === -1) {
      return `❌ Could not find application for "${role}" at ${company}. Use get_applications to see existing entries.`;
    }

    // deleteDimension needs the tab's numeric sheetId; look it up by title.
    const meta = await this.sheets.spreadsheets.get({ spreadsheetId: this.spreadsheetId });
    const appsSheet = meta.data.sheets.find((s) => s.properties.title === "Applications");
    const sheetId = appsSheet?.properties.sheetId ?? 0;

    const deletedCompany = rows[rowIndex][COL.COMPANY];
    const deletedRole = rows[rowIndex][COL.ROLE];

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: { sheetId, dimension: "ROWS", startIndex: rowIndex, endIndex: rowIndex + 1 },
            },
          },
        ],
      },
    });

    return `🗑️ Deleted "${deletedRole}" at ${deletedCompany}.`;
  }

  async getApplications(statusFilter) {
    await this.ensureSheets();
    const res = await this.sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: "Applications!A:N",
    });

    const rows = res.data.values || [];
    if (rows.length <= 1) return "📭 No applications tracked yet. Use add_application to get started!";

    const data = rows.slice(1).filter((r) => r[COL.COMPANY]);

    const filtered = statusFilter
      ? data.filter((r) => r[COL.STATUS]?.toLowerCase().includes(statusFilter.toLowerCase()))
      : data;

    if (filtered.length === 0) return `No applications found with status "${statusFilter}".`;

    const grouped = {};
    for (const row of filtered) {
      const status = row[COL.STATUS] || "Unknown";
      if (!grouped[status]) grouped[status] = [];
      grouped[status].push(row);
    }

    const statusOrder = ["Offer", "Interview", "Phone Screen", "Applied", "Saved", "Rejected", "Withdrawn"];
    let output = `## 📋 Job Application Tracker\n\n`;
    output += `**Total: ${filtered.length} application${filtered.length !== 1 ? "s" : ""}**\n\n`;

    for (const status of statusOrder) {
      if (!grouped[status]) continue;
      output += `### ${status} (${grouped[status].length})\n`;
      for (const row of grouped[status]) {
        output += `- **${row[COL.COMPANY]}** — ${row[COL.ROLE]}`;
        if (row[COL.SALARY]) output += ` | 💰 ${row[COL.SALARY]}`;
        if (row[COL.WORK_TYPE]) output += ` | 🏠 ${row[COL.WORK_TYPE]}`;
        if (row[COL.RATING]) output += ` | ⭐ ${row[COL.RATING]}/10`;
        if (row[COL.DOC_URL]) output += ` | 📄 [Doc](${row[COL.DOC_URL]})`;
        if (row[COL.NEXT_STEP]) output += `\n  → Next: ${row[COL.NEXT_STEP]}`;
        output += "\n";
      }
      output += "\n";
    }

    return output.trim();
  }

  // ─── Google Docs ───────────────────────────────────────────────────────────

  // Create a new Doc for an application, OWNED BY THE USER (via OAuth), then
  // share it with the service account so the normal read/append path still works.
  // A service account can't create Docs itself (no Drive storage quota).
  async createApplicationDoc(company, role, initialContent) {
    if (!this.oauthDocs) {
      throw new Error(
        "Creating Docs needs OAuth — a service account can't create files (it has no Drive quota). " +
          "Run `npm run auth`, then set google_oauth (client_id, client_secret, refresh_token). " +
          "Or create the Doc yourself in Google Drive, share it with the service account, and paste the link."
      );
    }

    const title = `${company} — ${role} | Interview Notes`;

    // 1. Create the Doc as the user (owned by them, on their Drive quota).
    const createRes = await this.oauthDocs.documents.create({ requestBody: { title } });
    const docId = createRes.data.documentId;
    const docUrl = `https://docs.google.com/document/d/${docId}/edit`;

    // 2. Move it into the applications folder (configured id, else found by name).
    let folderId = this.docsFolderId;
    if (!folderId && this.docsFolderName) {
      const res = await this.oauthDrive.files.list({
        q: `name='${this.docsFolderName.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: "files(id)",
        spaces: "drive",
      });
      folderId = res.data.files?.[0]?.id || null;
    }
    if (folderId) {
      const fileRes = await this.oauthDrive.files.get({ fileId: docId, fields: "parents" });
      const previousParents = fileRes.data.parents?.join(",") || "";
      await this.oauthDrive.files.update({
        fileId: docId,
        addParents: folderId,
        removeParents: previousParents,
        fields: "id, parents",
      });
    }

    // 3. Share with the service account so it can read/append afterwards.
    if (this.serviceAccountEmail) {
      await this.oauthDrive.permissions.create({
        fileId: docId,
        sendNotificationEmail: false,
        requestBody: { role: "writer", type: "user", emailAddress: this.serviceAccountEmail },
      });
    }

    // 4. Write starter content (custom, or the structured template).
    const content =
      initialContent && initialContent.trim() ? initialContent : DEFAULT_DOC_TEMPLATE(company, role);
    await this.oauthDocs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests: [{ insertText: { location: { index: 1 }, text: content } }] },
    });

    // 5. Style the markup (the service account has access now).
    const formatting = await this.formatDoc(docUrl);

    return { docId, docUrl, title, formatting };
  }

  // Read a Google Doc as text. Sub-headings, bullets, bold and tables come back
  // in the same markdown the write tools accept, so a section can be read,
  // edited and written back with replace_doc_section without losing structure.
  async readDoc(docUrl) {
    const docId = extractDocId(docUrl);
    if (!docId) throw new Error(`Could not extract document ID from URL: ${docUrl}`);

    const res = await this.docs.documents.get({ documentId: docId });
    return docToMarkdown(res.data.body.content);
  }

  // Append a new labelled section to the doc
  async appendToDoc(docUrl, heading, content) {
    const docId = extractDocId(docUrl);
    if (!docId) throw new Error(`Could not extract document ID from URL: ${docUrl}`);

    const now = new Date().toLocaleDateString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
    });

    const textToAppend = `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${heading.toUpperCase()} — ${now}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${content}\n`;

    // Find the end of the document body
    const docRes = await this.docs.documents.get({ documentId: docId });
    const endIndex = docRes.data.body.content.at(-1).endIndex - 1;

    await this.docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [{ insertText: { location: { index: endIndex }, text: textToAppend } }],
      },
    });

    return `✅ Added "${heading}" section to the doc (${now}).`;
  }

  // Fetch a doc's body and current revision id.
  async getDoc(docUrl) {
    const docId = extractDocId(docUrl);
    if (!docId) throw new Error(`Could not extract document ID from URL: ${docUrl}`);
    const res = await this.docs.documents.get({ documentId: docId });
    return { docId, content: res.data.body.content, revisionId: res.data.revisionId };
  }

  // Apply Docs styling to the markup in a doc. Never throws: a formatting
  // failure must not undo or hide a successful write.
  async formatDoc(docUrl) {
    try {
      const docId = extractDocId(docUrl) || docUrl;
      const { errors } = await createFormatter(this.docs)(docId);
      return { ok: errors.length === 0, errors };
    } catch (e) {
      return { ok: false, errors: [e.message] };
    }
  }

  // Replace the body of one section (heading kept). The write is pinned to the
  // revision we read, so if the doc changed in the meantime Docs rejects it.
  async replaceSectionBody(docId, { bodyStart, bodyEnd, content, revisionId }) {
    const text = content + "\n";
    const requests = [];
    if (bodyEnd > bodyStart) {
      requests.push({ deleteContentRange: { range: { startIndex: bodyStart, endIndex: bodyEnd } } });
    }
    const range = { startIndex: bodyStart, endIndex: bodyStart + text.length };
    requests.push(
      { insertText: { location: { index: bodyStart }, text } },
      // Inserted text inherits the style of the paragraph it lands in (often the
      // next heading), so reset it to plain body text before formatting.
      { updateParagraphStyle: { range, paragraphStyle: { namedStyleType: "NORMAL_TEXT" }, fields: "namedStyleType" } },
      { deleteParagraphBullets: { range } },
      {
        updateTextStyle: {
          range,
          textStyle: {},
          fields: "bold,italic,underline,strikethrough,weightedFontFamily,backgroundColor,foregroundColor,fontSize,link",
        },
      }
    );
    await this.docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests, writeControl: { requiredRevisionId: revisionId } },
    });
  }

  // Append a row to the "Doc edits" tab. Written BEFORE the doc is changed so
  // the removed text is on record even if the write half-fails; the Result
  // column is filled in afterwards via setDocEditResult. Returns the row's range.
  async logDocEdit(entry) {
    await this.ensureSheets();
    const MAX = 45000; // Sheets cells hold 50,000 chars
    const removed = entry.removedText.length > MAX
      ? entry.removedText.slice(0, MAX) + "\n…[truncated]"
      : entry.removedText;
    const res = await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: "Doc edits!A:J",
      valueInputOption: "RAW",
      requestBody: {
        values: [[
          new Date().toISOString(), entry.company, entry.role, entry.docUrl, entry.heading,
          entry.charsBefore, entry.charsAfter, entry.revisionBefore || "", removed, "pending",
        ]],
      },
    });
    return res.data.updates?.updatedRange || null;
  }

  // Fill in the Result cell of a row written by logDocEdit.
  async setDocEditResult(rowRange, result) {
    const row = rowRange?.match(/![A-Z]+(\d+)/)?.[1];
    if (!row) return;
    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: `Doc edits!J${row}`,
      valueInputOption: "RAW",
      requestBody: { values: [[result]] },
    });
  }

  // Get the doc URL stored for an application
  async getDocUrl(company, role) {
    const { rows, rowIndex } = await this._findRow(company, role);
    if (rowIndex === -1) return null;
    return rows[rowIndex][COL.DOC_URL] || null;
  }

  // Whether an application row exists — checked before creating a doc so we
  // never create an orphan doc for a company that isn't in the tracker.
  async applicationExists(company, role) {
    const { rowIndex } = await this._findRow(company, role);
    return rowIndex !== -1;
  }

  // ─── Interviews ────────────────────────────────────────────────────────────

  async addInterviewNote(args) {
    await this.ensureSheets();
    const now = new Date().toISOString().split("T")[0];
    const row = [
      now,
      args.company_name,
      args.role_title,
      args.interview_round,
      args.interviewers || "",
      args.interview_date || "",
      args.notes || "",
      args.outcome || "Pending",
    ];

    await this.sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: "Interviews!A:H",
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    });
  }
}