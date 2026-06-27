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
      description: "Log a new job application to your Google Sheets tracker.",
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
      description: "Update an existing application's status, add interview notes, or record outcomes.",
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
      annotations: { title: "Get/create application doc", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description:
        "Get the Google Doc for a specific application. If no doc exists yet, creates one automatically and links it to the tracker. Returns the doc URL and full current content.",
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
      let docUrl, created = false;

      try { docUrl = await sheets.getDocUrl(args.company_name, args.role_title); }
      catch (e) { throw new Error(`getDocUrl failed: ${e.message}`); }

      if (!docUrl) {
        let newUrl;
        try { ({ docUrl: newUrl } = await sheets.createApplicationDoc(args.company_name, args.role_title)); }
        catch (e) { throw new Error(`createApplicationDoc failed: ${e.message}`); }
        docUrl = newUrl;
        try {
          await sheets.updateApplication({
            company_name: args.company_name,
            role_title: args.role_title,
            doc_url: docUrl,
          });
        } catch (e) { throw new Error(`updateApplication failed: ${e.message}`); }
        created = true;
      }

      let docContent = "";
      try { docContent = await sheets.readDoc(docUrl); }
      catch (e) { docContent = "(could not read doc content: " + e.message + ")"; }

      const header = created
        ? `📄 Created new interview doc for ${args.company_name}:\n${docUrl}`
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
        "Add a new section to the Google Doc for a specific application. Use this to document interview stages, study notes, post-interview reflections, company research, or any other notes. The doc is created automatically if it doesn't exist yet.",
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
        },
        required: ["company_name", "role_title", "heading", "content"],
      },
    },
    handler: async (args, { sheets }) => {
      let docUrl = await sheets.getDocUrl(args.company_name, args.role_title);

      if (!docUrl) {
        const { docUrl: newUrl } = await sheets.createApplicationDoc(args.company_name, args.role_title);
        docUrl = newUrl;
        await sheets.updateApplication({
          company_name: args.company_name,
          role_title: args.role_title,
          doc_url: docUrl,
        });
      }

      const result = await sheets.appendToDoc(docUrl, args.heading, args.content);
      return { content: [{ type: "text", text: `${result}\n📄 ${docUrl}` }] };
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
];
