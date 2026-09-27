/**
 * Google Sheets / Docs backed tools — the application tracker and per-application
 * docs. Handlers receive a shared context `{ sheets, ... }` and contain the same
 * logic as before; only the wrapping (registry instead of a switch) changed.
 */

import {
  normalizeContent,
  normalizeHeading,
  parseSections,
  docToMarkdown,
  contentHeadingLevels,
  CONTENT_MARKUP_HELP,
} from "../docSections.js";

const noauth = { securitySchemes: [{ type: "noauth" }] };

export const textResult = (text) => ({ content: [{ type: "text", text }] });
export const errorResult = (text) => ({ content: [{ type: "text", text }], isError: true });
export const formatNote = (f) => (f && !f.ok ? `\n⚠️ Written, but formatting hit a problem: ${f.errors.join("; ")}` : "");

/**
 * Replace the body of exactly one section, with the safeguards every doc edit
 * shares: single match or nothing, dry run unless confirm, the old text logged
 * to "Doc edits" before the write, the write pinned to the revision read, and
 * formatting afterwards. Used by replace_doc_section and save_tailored_cv.
 */
export async function replaceSection(sheets, { company, role, docUrl, heading, newContent, confirm, toolName }) {
  // Read the doc and find exactly one matching section.
  const locate = async () => {
    const doc = await sheets.getDoc(docUrl);
    const sections = parseSections(doc.content);
    const wanted = normalizeHeading(heading);
    const matches = sections.filter((sec) => sec.normalized === wanted);
    return { doc, sections, matches };
  };

  let found;
  try { found = await locate(); }
  catch (e) { return errorResult(`Couldn't read the doc (${e.message}). Nothing was changed.`); }

  const listHeadings = (sections) =>
    sections.length
      ? sections.map((sec) => `${"  ".repeat(Math.max(0, sec.level - 2))}- ${sec.text}`).join("\n")
      : "(no headings found)";

  if (found.matches.length !== 1) {
    const why = found.matches.length === 0
      ? `No section in the doc matches "${heading}".`
      : `"${heading}" matches ${found.matches.length} sections, so I can't tell which one to replace.`;
    return errorResult(`${why} Nothing was changed.\n\nHeadings in the doc:\n${listHeadings(found.sections)}`);
  }

  const section = found.matches[0];
  // A top-level (Heading 1) heading usually spans the whole doc, which this
  // tool must never replace.
  if (section.level < 2) {
    return errorResult(`"${section.text}" is a top-level heading that covers the whole doc, and this tool only replaces single sections. Nothing was changed.`);
  }
  const tooBig = contentHeadingLevels(newContent).filter((lvl) => lvl <= section.level);
  if (tooBig.length) {
    return errorResult(
      `new_content contains a heading as big as (or bigger than) the section's own heading "${section.text}", ` +
        "which would split the doc into extra sections. Use smaller sub-headings (e.g. ### or '-- Heading --'). Nothing was changed."
    );
  }

  // Kept as markdown (fences, bullets, tables intact) so it can be pasted back.
  const removedText = docToMarkdown(
    found.doc.content.filter((el) => el.startIndex >= section.bodyStart && el.endIndex <= section.bodyEnd + 1)
  );
  const charsBefore = removedText.length;
  const charsAfter = newContent.length;

  if (!confirm) {
    return textResult(
      `DRY RUN — nothing has been changed.\n\n` +
        `Section: "${section.text}"\n` +
        `Would remove (${charsBefore} chars):\n----------\n${removedText || "(empty)"}\n----------\n\n` +
        `Would replace it with (${charsAfter} chars):\n----------\n${newContent}\n----------\n\n` +
        `To apply this, call ${toolName} again with the same arguments and confirm: true.`
    );
  }

  // Log the old content first, so it's recoverable whatever happens next.
  let logRow;
  try {
    logRow = await sheets.logDocEdit({
      company: company,
      role: role,
      docUrl,
      heading: section.text,
      charsBefore,
      charsAfter,
      revisionBefore: found.doc.revisionId,
      removedText,
    });
  } catch (e) {
    return errorResult(`Couldn't write the edit log (${e.message}), so I didn't touch the doc. Nothing was changed.`);
  }

  try {
    // Pinned to the revision we just read: if the doc changed since, Docs rejects it.
    await sheets.replaceSectionBody(found.doc.docId, {
      bodyStart: section.bodyStart,
      bodyEnd: section.bodyEnd,
      content: newContent,
      revisionId: found.doc.revisionId,
    });
  } catch (e) {
    await sheets.setDocEditResult(logRow, `failed: ${e.message}`).catch(() => {});
    return errorResult(`Couldn't replace the section (${e.message}). Nothing was changed — if the doc was edited in the meantime, run the dry run again.`);
  }

  await sheets.setDocEditResult(logRow, "applied").catch(() => {});
  const formatting = await sheets.formatDoc(docUrl);
  return textResult(
    `✅ Replaced the "${section.text}" section (${charsBefore} → ${charsAfter} chars). ` +
      `The old text is saved in the tracker's "Doc edits" tab.${formatNote(formatting)}\n📄 ${docUrl}`
  );
}

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
        "Get the Google Doc linked to an application and return its full contents as markdown (sections, bullets, tables, code blocks). Read it before adding to or changing a doc so you don't duplicate a section; to change one, edit what you read and pass it to replace_doc_section. If the user gives a doc link, pass it as doc_url to link and read it. If none is linked, use create_application_doc to make one, or ask the user for a doc URL.",
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
        "Append a section (heading + content) to the Google Doc linked to an application. The doc is the home for everything written about an application: company research, cover letter, application answers, interview prep, stages, reflections, study notes. Never save those as separate files. If no doc is linked yet, one is created automatically (owned by you) and linked, then the section is appended. You can also pass an existing doc's URL as doc_url to link it first. A section heading can only appear once per doc: to change an existing section, use replace_doc_section instead.",
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
          content: { type: "string", description: `The content to add under this heading. ${CONTENT_MARKUP_HELP}` },
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

      // One section per heading: appending a second copy is how docs got messy.
      try {
        const { content } = await sheets.getDoc(docUrl);
        const wanted = normalizeHeading(args.heading);
        const existing = parseSections(content).find((sec) => sec.level <= 2 && sec.normalized === wanted);
        if (existing) {
          return errorResult(
            `This doc already has a "${existing.text}" section, so I didn't add another one. ` +
              `To change it, use replace_doc_section with heading "${args.heading}". Nothing was changed.`
          );
        }
      } catch (e) {
        return errorResult(`Couldn't read the doc to check its sections (${e.message}). Nothing was changed.`);
      }

      try {
        const result = await sheets.appendToDoc(docUrl, args.heading, normalizeContent(args.content));
        const formatting = await sheets.formatDoc(docUrl);
        const prefix = created ? `📄 Created a new doc for ${args.company_name} and linked it.\n` : "";
        return textResult(`${prefix}${result}${formatNote(formatting)}\n📄 ${docUrl}`);
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
            description: `Optional starter content for the doc. If omitted, a structured interview-notes template is used. ${CONTENT_MARKUP_HELP}`,
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
        const { docUrl, formatting } = await sheets.createApplicationDoc(
          args.company_name,
          args.role_title,
          args.initial_content ? normalizeContent(args.initial_content) : undefined
        );
        await sheets.updateApplication({
          company_name: args.company_name,
          role_title: args.role_title,
          doc_url: docUrl,
        });
        return {
          content: [{ type: "text", text: `📄 Created a new doc for ${args.company_name} and linked it to your tracker:\n${docUrl}${formatNote(formatting)}` }],
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
    name: "replace_doc_section",
    definition: {
      name: "replace_doc_section",
      annotations: { title: "Replace doc section", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      description:
        "Replace the content of ONE section in an application's Google Doc — use it to correct or rewrite a section instead of appending a second copy. " +
        "A section is a heading plus everything under it up to the next heading of the same or higher level; the heading itself is kept, only what's under it is replaced. " +
        "The heading must match exactly one section (case, markup and the trailing date are ignored, so 'Round 1 reflection' matches 'ROUND 1 REFLECTION — 26 Sept 2026'); if it matches none or several, nothing is changed and the available headings are listed. " +
        "By default this is a DRY RUN: it shows what would be removed and what would replace it, and changes nothing. Show that preview to the user, and only call again with confirm: true once they agree. " +
        "Every replace is logged (with the removed text) in the tracker's 'Doc edits' tab. This tool can't delete a doc or clear all of it.",
      securitySchemes: [{ type: "noauth" }],
      _meta: noauth,
      inputSchema: {
        type: "object",
        properties: {
          company_name: { type: "string" },
          role_title: { type: "string" },
          heading: {
            type: "string",
            description: "The heading of the section to replace, as it appears in the doc (the date after '—' can be left out).",
          },
          new_content: {
            type: "string",
            description: `The new content for the section (without the section heading itself — that stays). Sub-headings in it must be smaller than the section's own heading. ${CONTENT_MARKUP_HELP}`,
          },
          confirm: {
            type: "boolean",
            description: "false (default) = dry run, only preview. true = actually replace. Only set true after the user has seen the preview and agreed.",
          },
        },
        required: ["company_name", "role_title", "heading", "new_content"],
      },
    },
    handler: async (args, { sheets }) => {
      const docUrl = await sheets.getDocUrl(args.company_name, args.role_title);
      if (!docUrl) {
        return errorResult(`No doc is linked for "${args.role_title}" at ${args.company_name}. Nothing was changed.`);
      }

      const newContent = normalizeContent(args.new_content);
      if (!newContent) {
        return errorResult("new_content is empty. This tool replaces a section's content; it doesn't clear sections. Nothing was changed.");
      }

      return replaceSection(sheets, {
        company: args.company_name,
        role: args.role_title,
        docUrl,
        heading: args.heading,
        newContent,
        confirm: args.confirm,
        toolName: "replace_doc_section",
      });
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
