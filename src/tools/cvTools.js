/**
 * Tailored CV tools. The flow:
 *   tailor_cv (prompt) → save_tailored_cv (JSON into the application doc) →
 *   the user reviews and edits the JSON in the doc → generate_cv_pdf.
 *
 * The base CV (cv_file_path, e.g. a site's cv.ts) is never changed per
 * application. The JSON in the application doc's "Tailored CV" section is the
 * approved version for that application, and it's what the PDF is built from.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { normalizeContent, normalizeHeading, parseSections, docToMarkdown } from "../docSections.js";
import { TAILORED_CV_HEADING, validateCv, extractCvJson, parseCvArg } from "../cvSchema.js";
import { replaceSection, textResult, errorResult, formatNote } from "./tracker.js";

const run = promisify(execFile);
const noauth = { securitySchemes: [{ type: "noauth" }] };

function findTailoredSection(content) {
  const wanted = normalizeHeading(TAILORED_CV_HEADING);
  return parseSections(content).filter((sec) => sec.normalized === wanted);
}

// Contact details are never tailored: keep them identical to the base CV.
function withBaseContact(cv, base) {
  if (!base?.header) return cv;
  const { name, email, website } = base.header;
  return { ...cv, header: { ...cv.header, name, email, ...(website ? { website } : {}) } };
}

// Where the CV repo lives: cv_pdf.repo_path, or derived from a cv_file_path
// of the form <repo>/src/cv/cv.ts.
function cvRepoPath(config) {
  if (config.cv_pdf?.repo_path) return config.cv_pdf.repo_path;
  const m = String(config.cv_file_path || "").match(/^(.*)\/src\/cv\/cv\.(ts|js|json)$/);
  return m ? m[1] : null;
}

const expandHome = (p) => (p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p);
const slug = (s) => String(s).replace(/[^A-Za-z0-9]+/g, "") || "Application";

export const cvTools = [
  {
    name: "save_tailored_cv",
    definition: {
      name: "save_tailored_cv",
      annotations: { title: "Save tailored CV", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      description:
        "Save a tailored CV (the JSON produced by following tailor_cv) into the application's Google Doc, under a 'Tailored CV' section, so the user can review and edit it there. " +
        "The JSON must have exactly the same shape as the base CV; it's checked before anything is written. Never save CVs as separate files. " +
        "If the doc already has a Tailored CV section, this replaces it: that's a DRY RUN by default (the user may have edited it in the doc), so show the preview and only call again with confirm: true once the user agrees.",
      securitySchemes: [{ type: "noauth" }],
      _meta: noauth,
      inputSchema: {
        type: "object",
        properties: {
          company_name: { type: "string" },
          role_title: { type: "string" },
          cv_json: {
            type: "object",
            description: "The full tailored CV, same shape as the base CV (header, personalStatement, summary, strengths, sidebar, experience, education, languages).",
          },
          notes: {
            type: "string",
            description: "3–6 short bullets ('- ...') on what was changed for this role and why. Shown above the JSON in the doc.",
          },
          confirm: {
            type: "boolean",
            description: "Only needed when replacing an existing Tailored CV section: false (default) = preview, true = replace.",
          },
        },
        required: ["company_name", "role_title", "cv_json"],
      },
    },
    handler: async (args, { sheets, cvJson }) => {
      let cv;
      try { cv = withBaseContact(parseCvArg(args.cv_json), cvJson); }
      catch (e) { return errorResult(`${e.message}. Nothing was saved.`); }
      const problems = validateCv(cv);
      if (problems.length) {
        return errorResult(`The CV doesn't match the base CV's shape, so the PDF script couldn't use it. Nothing was saved.\n- ${problems.join("\n- ")}`);
      }

      let docUrl = await sheets.getDocUrl(args.company_name, args.role_title);
      if (!docUrl) {
        if (!(await sheets.applicationExists(args.company_name, args.role_title))) {
          return errorResult(`I can't find "${args.role_title}" at ${args.company_name} in your tracker. Add it first with add_application.`);
        }
        try {
          ({ docUrl } = await sheets.createApplicationDoc(args.company_name, args.role_title));
          await sheets.updateApplication({ company_name: args.company_name, role_title: args.role_title, doc_url: docUrl });
        } catch (e) {
          return errorResult(`No doc is linked and I couldn't create one: ${e.message}`);
        }
      }

      const notes = args.notes ? normalizeContent(args.notes) + "\n\n" : "";
      const content = `${notes}\`\`\`json\n${JSON.stringify(cv, null, 2)}\n\`\`\``;

      let existing;
      try { existing = findTailoredSection((await sheets.getDoc(docUrl)).content); }
      catch (e) { return errorResult(`Couldn't read the doc (${e.message}). Nothing was saved.`); }

      if (existing.length) {
        return replaceSection(sheets, {
          company: args.company_name,
          role: args.role_title,
          docUrl,
          heading: TAILORED_CV_HEADING,
          newContent: content,
          confirm: args.confirm,
          toolName: "save_tailored_cv",
        });
      }

      try {
        await sheets.appendToDoc(docUrl, TAILORED_CV_HEADING, content);
      } catch (e) {
        return errorResult(`Couldn't write to the doc (${e.message}).`);
      }
      const formatting = await sheets.formatDoc(docUrl);
      return textResult(
        `✅ Saved the tailored CV in the doc under "${TAILORED_CV_HEADING}". ` +
          `Ask the user to review and edit the JSON there; that version is what generate_cv_pdf will use.${formatNote(formatting)}\n📄 ${docUrl}`
      );
    },
  },
  {
    name: "generate_cv_pdf",
    definition: {
      name: "generate_cv_pdf",
      annotations: { title: "Generate CV PDF", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description:
        "Build the PDF of an application's tailored CV from the JSON in its doc's 'Tailored CV' section (including any edits the user made there), using the user's own CV PDF script. " +
        "Only call this after the user has said the tailored CV in the doc is approved. Runs on the local server only (it needs the CV repo on the user's computer).",
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
    handler: async (args, { sheets, config, cvJson }) => {
      const repo = cvRepoPath(config);
      const script = repo && path.join(repo, "scripts", "generate-cv-pdf.tsx");
      if (!script || !fs.existsSync(script)) {
        return errorResult(
          "PDF generation only works on the local job-hunter server, on the computer that has the CV repo (set cv_pdf.repo_path in config.json). " +
            "The hosted server can't run it. The approved JSON is safe in the doc; generate the PDF from the local connector."
        );
      }

      // An older script ignores --json and would overwrite the site's own CV PDF.
      if (!fs.readFileSync(script, "utf8").includes('arg("json")')) {
        return errorResult(`The CV script in ${repo} doesn't support --json yet. Pull the latest version of that repo, then try again. No PDF was made.`);
      }

      const docUrl = await sheets.getDocUrl(args.company_name, args.role_title);
      if (!docUrl) return errorResult(`No doc is linked for "${args.role_title}" at ${args.company_name}.`);

      let cv;
      try {
        const { content } = await sheets.getDoc(docUrl);
        const sections = findTailoredSection(content);
        if (sections.length !== 1) {
          throw new Error(sections.length ? "the doc has more than one Tailored CV section" : "the doc has no Tailored CV section yet — use tailor_cv first");
        }
        const sec = sections[0];
        const body = content.filter((el) => el.startIndex >= sec.bodyStart && el.endIndex <= sec.bodyEnd + 1);
        cv = withBaseContact(extractCvJson(docToMarkdown(body)), cvJson);
      } catch (e) {
        return errorResult(`Couldn't read the tailored CV: ${e.message}. No PDF was made.`);
      }
      const problems = validateCv(cv);
      if (problems.length) {
        return errorResult(`The CV in the doc doesn't match the base CV's shape (maybe an edit removed or renamed something). No PDF was made.\n- ${problems.join("\n- ")}`);
      }

      const outDir = expandHome(config.cv_pdf?.output_dir || "~/Downloads");
      const name = slug(cv.header.name || "CV");
      const outPath = path.join(outDir, `${name}-CV-${slug(args.company_name)}.pdf`);
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailored-cv-"));
      const jsonPath = path.join(tmpDir, "cv.json");
      fs.writeFileSync(jsonPath, JSON.stringify(cv));

      const tsx = path.join(repo, "node_modules", "tsx", "dist", "cli.mjs");
      try {
        await run(
          fs.existsSync(tsx) ? process.execPath : "npx",
          [...(fs.existsSync(tsx) ? [tsx] : ["tsx"]), "scripts/generate-cv-pdf.tsx", "--json", jsonPath, "--out", outPath],
          { cwd: repo, timeout: 120000 }
        );
      } catch (e) {
        const detail = (e.stderr || e.message || "").split("\n").filter((l) => /error/i.test(l)).slice(0, 3).join(" ") || e.message;
        return errorResult(`The CV PDF script failed: ${detail}`);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }

      if (!fs.existsSync(outPath)) return errorResult("The CV PDF script ran but didn't produce a file.");
      return textResult(`✅ PDF ready: ${outPath}\nBuilt from the Tailored CV section of the doc: ${docUrl}`);
    },
  },
];
