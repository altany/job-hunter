import { google } from "googleapis";

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
    } else if (service_account_key_file) {
      authOptions.keyFile = service_account_key_file;
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
    const rowIndex = rows.findIndex(
      (r) =>
        r[COL.COMPANY]?.toLowerCase().includes(company.toLowerCase()) &&
        r[COL.ROLE]?.toLowerCase().includes(role.toLowerCase())
    );
    return { rows, rowIndex };
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

  // Find a Drive folder by name, returns its ID or null
  async _findFolder(name) {
    const res = await this.drive.files.list({
      q: `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: "files(id, name)",
      spaces: "drive",
    });
    return res.data.files?.[0]?.id || null;
  }

  // Create a new doc for an application with a structured template
  async createApplicationDoc(company, role) {
    const title = `${company} — ${role} | Interview Notes`;

    const createRes = await this.docs.documents.create({
      requestBody: { title },
    });

    const docId = createRes.data.documentId;
    const docUrl = `https://docs.google.com/document/d/${docId}/edit`;

    // Move into the Jobs folder if it exists
    const jobsFolderId = await this._findFolder("Jobs");
    if (jobsFolderId) {
      const fileRes = await this.drive.files.get({ fileId: docId, fields: "parents" });
      const previousParents = fileRes.data.parents?.join(",") || "";
      await this.drive.files.update({
        fileId: docId,
        addParents: jobsFolderId,
        removeParents: previousParents,
        fields: "id, parents",
      });
    }

    // Share as writer so you can edit from any device/account
    await this.drive.permissions.create({
      fileId: docId,
      requestBody: { role: "writer", type: "anyone" },
    });

    const initialContent = [
      `${company} — ${role}`,
      "Interview Process & Notes",
      "",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "ROLE OVERVIEW",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "Paste job ad summary, key requirements, and your initial take here.",
      "",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "INTERVIEW STAGES",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "Document each stage: what to expect, who you'll meet, what they assess.",
      "",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "STUDY NOTES & PREP",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "Topics to brush up on, links to resources, practice questions.",
      "",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "INTERVIEW REFLECTIONS",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "Post-interview notes: what went well, what to improve, questions they asked.",
      "",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "COMPANY RESEARCH",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "Key facts, recent news, product notes, people you've spoken to.",
      "",
    ].join("\n");

    await this.docs.documents.batchUpdate({
      documentId: docId,
      requestBody: {
        requests: [{ insertText: { location: { index: 1 }, text: initialContent } }],
      },
    });

    return { docId, docUrl, title };
  }

  // Read the full plain text content of a Google Doc
  async readDoc(docUrl) {
    const docId = extractDocId(docUrl);
    if (!docId) throw new Error(`Could not extract document ID from URL: ${docUrl}`);

    const res = await this.docs.documents.get({ documentId: docId });
    const content = res.data.body.content;

    let text = "";
    for (const element of content) {
      if (element.paragraph) {
        for (const pe of element.paragraph.elements) {
          if (pe.textRun) text += pe.textRun.content;
        }
      }
    }
    return text.trim();
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

  // Get the doc URL stored for an application
  async getDocUrl(company, role) {
    const { rows, rowIndex } = await this._findRow(company, role);
    if (rowIndex === -1) return null;
    return rows[rowIndex][COL.DOC_URL] || null;
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