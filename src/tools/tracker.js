/**
 * Google Sheets / Docs backed tools — the application tracker and per-application
 * docs. Handlers receive a shared context `{ sheets, ... }` and contain the same
 * logic as before; only the wrapping (registry instead of a switch) changed.
 */

const noauth = { securitySchemes: [{ type: "noauth" }] };

const STATUS_ENUM = [
  "Saved", "Applied", "Phone Screen", "Interview", "Offer", "Rejected", "Withdrawn",
];

export const trackerTools = [
  {
    name: "add_application",
    definition: {
      name: "add_application",
      annotations: { title: "Add application", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      description: "Log a NEW job application (a company + role not already in the tracker) to Google Sheets. If the application already exists, use update_application instead — calling this again creates a duplicate row.",
      securitySchemes: [{ type: "noauth" }],
      _meta: noauth,
      inputSchema: {
        type: "object",
        properties: {
          company_name: { type: "string" },
          role_title: { type: "string" },
          job_url: { type: "string" },
          salary: { type: "string" },
          rating: { type: "number", description: "Your rating score (1-10)" },
          status: { type: "string", enum: STATUS_ENUM },
          notes: { type: "string" },
          work_type: { type: "string", enum: ["Remote", "Hybrid", "Onsite"] },
          location: { type: "string" },
          doc_url: { type: "string", description: "Google Doc URL for interview notes (optional)" },
        },
        required: ["company_name", "role_title"],
      },
    },
    handler: async (args, { sheets }) => {
      await sheets.addApplication(args);
      return {
        content: [
          { type: "text", text: `✅ Added "${args.role_title}" at ${args.company_name} to your tracker.` },
        ],
      };
    },
  },
  {
    name: "update_application",
    definition: {
      name: "update_application",
      annotations: { title: "Update application", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      description: "Update ANY field of an application that already exists in the tracker: status, rating, notes (appended), next step, salary, work type, location, or a linked doc URL. Use this — not add_application — to change something for a company that's already tracked (e.g. just the rating). Matched leniently by company + role.",
      securitySchemes: [{ type: "noauth" }],
      _meta: noauth,
      inputSchema: {
        type: "object",
        properties: {
          company_name: { type: "string" },
          role_title: { type: "string" },
          status: { type: "string", enum: STATUS_ENUM },
          notes: { type: "string", description: "Notes to append" },
          next_step: { type: "string", description: "Next action or date" },
          salary_offered: { type: "string" },
          rating: { type: "number", description: "Rating score (1-10)" },
          doc_url: { type: "string", description: "Google Doc URL to link or update" },
          job_url: { type: "string", description: "Job posting URL" },
          salary: { type: "string", description: "Salary range" },
          work_type: { type: "string", enum: ["Remote", "Hybrid", "Onsite"] },
          location: { type: "string" },
        },
        required: ["company_name", "role_title"],
      },
    },
    handler: async (args, { sheets }) => {
      const result = await sheets.updateApplication(args);
      return { content: [{ type: "text", text: result }] };
    },
  },
  {
    name: "get_applications",
    definition: {
      name: "get_applications",
      annotations: { title: "Get applications", readOnlyHint: true, openWorldHint: false },
      description: "View your job application pipeline — all applications and their current status.",
      securitySchemes: [{ type: "noauth" }],
      _meta: noauth,
      inputSchema: {
        type: "object",
        properties: {
          status_filter: {
            type: "string",
            description: "Filter by status (e.g. 'Interview', 'Applied'). Leave empty for all.",
          },
        },
      },
    },
    handler: async (args, { sheets }) => {
      const apps = await sheets.getApplications(args.status_filter);
      return { content: [{ type: "text", text: apps }] };
    },
  },
  {
    name: "get_application_doc",
    definition: {
      name: "get_application_doc",
      annotations: { title: "Get application doc", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description:
        "Get the Google Doc linked to an application and return its full contents. Docs are NOT created automatically — if the user gives a doc link, pass it as doc_url to link it and read it. If none is linked and no doc_url is given, ask the user for the Google Doc URL.",
      securitySchemes: [{ type: "noauth" }],
      _meta: noauth,
      inputSchema: {
        type: "object",
        properties: {
          company_name: { type: "string" },
          role_title: { type: "string" },
          doc_url: { type: "string", description: "Google Doc URL to link to this application and read (optional; the doc must be shared with the service account as Editor)." },
        },
        required: ["company_name", "role_title"],
      },
    },
    handler: async (args, { sheets }) => {
      let docUrl;
      if (args.doc_url) {
        docUrl = args.doc_url;
        try {
          await sheets.updateApplication({
            company_name: args.company_name,
            role_title: args.role_title,
            doc_url: docUrl,
          });
        } catch (e) { /* linking is best-effort; still try to read below */ }
      } else {
        try { docUrl = await sheets.getDocUrl(args.company_name, args.role_title); }
        catch (e) { throw new Error(`getDocUrl failed: ${e.message}`); }
      }

      if (!docUrl) {
        return {
          content: [{
            type: "text",
            text: `No Google Doc is linked to "${args.role_title}" at ${args.company_name} yet. Create one in Google Drive, share it with the service account as Editor, then give me the link and I'll link it (pass it as doc_url). Docs aren't created automatically.`,
          }],
        };
      }

      let docContent = "";
      try { docContent = await sheets.readDoc(docUrl); }
      catch (e) { docContent = `(couldn't read the doc — check it's shared with the service account as Editor: ${e.message})`; }

      const header = args.doc_url
        ? `📄 Linked and opened the interview doc for ${args.company_name}:\n${docUrl}`
        : `📄 Interview doc for ${args.company_name}:\n${docUrl}`;

      return { content: [{ type: "text", text: `${header}\n\n---\n${docContent}` }] };
    },
  },
  {
    name: "update_application_doc",
    definition: {
      name: "update_application_doc",
      annotations: { title: "Update application doc", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      description:
        "Append a section (heading + content) to the Google Doc linked to an application — interview stages, study notes, reflections, company research, etc. The doc must already exist (the user creates it in Google Drive and shares it with the service account); it is NOT created automatically. Pass the doc URL as doc_url to link it, or link it first with update_application.",
      securitySchemes: [{ type: "noauth" }],
      _meta: noauth,
      inputSchema: {
        type: "object",
        properties: {
          company_name: { type: "string" },
          role_title: { type: "string" },
          heading: {
            type: "string",
            description:
              "Section heading, e.g. 'Round 1 Reflection', 'Study Notes', 'Interview Process', 'Company Research'",
          },
          content: { type: "string", description: "The content to add under this heading" },
          doc_url: { type: "string", description: "Google Doc URL to link to this application before appending (optional; the doc must be shared with the service account as Editor)." },
        },
        required: ["company_name", "role_title", "heading", "content"],
      },
    },
    handler: async (args, { sheets }) => {
      let docUrl = args.doc_url || null;
      if (docUrl) {
        try {
          await sheets.updateApplication({
            company_name: args.company_name,
            role_title: args.role_title,
            doc_url: docUrl,
          });
        } catch (e) { /* linking is best-effort; still try to append below */ }
      } else {
        docUrl = await sheets.getDocUrl(args.company_name, args.role_title);
      }

      if (!docUrl) {
        return {
          content: [{
            type: "text",
            text: `No Google Doc is linked to "${args.role_title}" at ${args.company_name}. Create one in Google Drive, share it with the service account as Editor, then give me the link (pass it as doc_url) and I'll link it and add your notes. Docs aren't created automatically.`,
          }],
        };
      }

      try {
        const result = await sheets.appendToDoc(docUrl, args.heading, args.content);
        return { content: [{ type: "text", text: `${result}\n📄 ${docUrl}` }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Couldn't write to the doc (${e.message}). Make sure it's shared with the service account as Editor.` }],
          isError: true,
        };
      }
    },
  },
  {
    name: "add_interview_note",
    definition: {
      name: "add_interview_note",
      annotations: { title: "Add interview note", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      description: "Log interview notes, feedback, or outcomes for an application.",
      securitySchemes: [{ type: "noauth" }],
      _meta: noauth,
      inputSchema: {
        type: "object",
        properties: {
          company_name: { type: "string" },
          role_title: { type: "string" },
          interview_round: { type: "string", description: "e.g. 'Phone Screen', 'Round 1', 'Final'" },
          interview_date: { type: "string", description: "Date of interview (YYYY-MM-DD)" },
          interviewers: { type: "string", description: "Who you met with" },
          notes: { type: "string", description: "Your notes and impressions" },
          outcome: { type: "string", enum: ["Pending", "Passed", "Failed", "Withdrew"] },
        },
        required: ["company_name", "role_title", "interview_round"],
      },
    },
    handler: async (args, { sheets }) => {
      await sheets.addInterviewNote(args);
      return {
        content: [
          { type: "text", text: `✅ Interview note added for ${args.interview_round} at ${args.company_name}.` },
        ],
      };
    },
  },
  {
    name: "delete_application",
    definition: {
      name: "delete_application",
      annotations: { title: "Delete application", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      description:
        "Permanently delete a job application row from the tracker — use this to remove a duplicate or a wrong entry. Matches by company name + role title and deletes the first match. This cannot be undone, so confirm the company and role before calling.",
      securitySchemes: [{ type: "noauth" }],
      _meta: noauth,
      inputSchema: {
        type: "object",
        properties: {
          company_name: { type: "string" },
          role_title: { type: "string" },
        },
        required: ["company_name", "role_title"],
      },
    },
    handler: async (args, { sheets }) => {
      const result = await sheets.deleteApplication(args.company_name, args.role_title);
      return { content: [{ type: "text", text: result }] };
    },
  },
];
