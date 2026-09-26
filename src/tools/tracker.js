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
        "Get the Google Doc linked to an application and return its full contents. If the user gives a doc link, pass it as doc_url to link and read it. If none is linked, use create_application_doc to make one, or ask the user for a doc URL.",
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
            text: `No Google Doc is linked to "${args.role_title}" at ${args.company_name} yet. I can create one with create_application_doc, or you can paste an existing doc's link (doc_url).`,
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
        "Append a section (heading + content) to the Google Doc linked to an application — interview stages, study notes, reflections, company research, etc. If no doc is linked yet, one is created automatically (owned by you) and linked, then the section is appended. You can also pass an existing doc's URL as doc_url to link it first.",
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

      // Auto-create a doc if none is linked (dedup-safe: we checked getDocUrl above).
      let created = false;
      if (!docUrl) {
        if (!(await sheets.applicationExists(args.company_name, args.role_title))) {
          return {
            content: [{
              type: "text",
              text: `I can't find "${args.role_title}" at ${args.company_name} in your tracker. Add it first with add_application, then I'll create its doc and add your notes.`,
            }],
          };
        }
        try {
          const { docUrl: newUrl } = await sheets.createApplicationDoc(args.company_name, args.role_title);
          docUrl = newUrl;
          await sheets.updateApplication({
            company_name: args.company_name,
            role_title: args.role_title,
            doc_url: docUrl,
          });
          created = true;
        } catch (e) {
          return {
            content: [{ type: "text", text: `No doc is linked and I couldn't create one: ${e.message}` }],
            isError: true,
          };
        }
      }

      try {
        const result = await sheets.appendToDoc(docUrl, args.heading, args.content);
        const prefix = created ? `📄 Created a new doc for ${args.company_name} and linked it.\n` : "";
        return { content: [{ type: "text", text: `${prefix}${result}\n📄 ${docUrl}` }] };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Couldn't write to the doc (${e.message}). Make sure it's shared with the service account as Editor.` }],
          isError: true,
        };
      }
    },
  },
  {
    name: "create_application_doc",
    definition: {
      name: "create_application_doc",
      annotations: { title: "Create application doc", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description:
        "Create a new Google Doc for an application (titled after the company + role), write any initial content into it, link it to the tracker row, and return the URL. The doc is created in your own Google Drive (owned by you) and shared with the service account. If a doc is already linked to this application, it returns that one instead of creating a duplicate.",
      securitySchemes: [{ type: "noauth" }],
      _meta: noauth,
      inputSchema: {
        type: "object",
        properties: {
          company_name: { type: "string" },
          role_title: { type: "string" },
          initial_content: {
            type: "string",
            description: "Optional starter content for the doc. If omitted, a structured interview-notes template is used.",
          },
        },
        required: ["company_name", "role_title"],
      },
    },
    handler: async (args, { sheets }) => {
      // Dedup: never create a second doc if one is already linked.
      const existing = await sheets.getDocUrl(args.company_name, args.role_title);
      if (existing) {
        return {
          content: [{ type: "text", text: `📄 A doc is already linked for ${args.company_name} — using it, not creating a duplicate:\n${existing}` }],
        };
      }
      if (!(await sheets.applicationExists(args.company_name, args.role_title))) {
        return {
          content: [{ type: "text", text: `I can't find "${args.role_title}" at ${args.company_name} in your tracker. Add it first with add_application, then I'll create and link its doc.` }],
        };
      }
      try {
        const { docUrl } = await sheets.createApplicationDoc(
          args.company_name,
          args.role_title,
          args.initial_content
        );
        await sheets.updateApplication({
          company_name: args.company_name,
          role_title: args.role_title,
          doc_url: docUrl,
        });
        return {
          content: [{ type: "text", text: `📄 Created a new doc for ${args.company_name} and linked it to your tracker:\n${docUrl}` }],
        };
      } catch (e) {
        return {
          content: [{ type: "text", text: `Couldn't create the doc: ${e.message}` }],
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
