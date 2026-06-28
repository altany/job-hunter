import fs from "fs";
import path from "path";

export async function loadCV(config) {
  // Hosted deploys can supply the CV inline (config.cv_text) so no file is
  // needed on disk. Local stdio use keeps reading from cv_file_path.
  if (config.cv_text && config.cv_text.trim()) {
    return { cvText: config.cv_text };
  }

  const cvPath = config.cv_file_path;

  if (!cvPath || !fs.existsSync(cvPath)) {
    throw new Error(`CV file not found at: ${cvPath}. Please set cv_file_path in config.json.`);
  }

  const ext = path.extname(cvPath).toLowerCase();
  let cvText = "";

  if (ext === ".pdf") {
    const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js");
    const buffer = fs.readFileSync(cvPath);
    const data = await pdfParse(buffer);
    cvText = data.text;
  } else if (ext === ".docx") {
    const { default: mammoth } = await import("mammoth");
    const result = await mammoth.extractRawText({ path: cvPath });
    cvText = result.value;
  } else if ([".txt", ".md", ".markdown"].includes(ext)) {
    cvText = fs.readFileSync(cvPath, "utf8");
  } else if (ext === ".json") {
    const raw = JSON.parse(fs.readFileSync(cvPath, "utf8"));
    cvText = formatStructuredCV(raw, config);
  } else if (ext === ".ts" || ext === ".js") {
    const raw = fs.readFileSync(cvPath, "utf8");
    const cv = parseTypeScriptCV(raw);
    cvText = formatStructuredCV(cv, config);
  } else {
    throw new Error(`Unsupported CV format: ${ext}. Supported: .pdf, .docx, .txt, .md, .json, .ts`);
  }

  return { cvText };
}

export function loadPreferences(config) {
  return config.preferences || {};
}

/**
 * Parse a TypeScript CV file by extracting the object literal.
 * Handles the `export const cv: Cv = { ... }` pattern, including
 * imported constants like NAME and CONTACT_EMAIL used as values.
 */
function parseTypeScriptCV(source) {
  let cleaned = source.replace(/^import\s+.+$/gm, "");

  // Strip TypeScript type annotations `: TypeName` only when followed by
  // whitespace/comma/equals/brace — avoids eating object key colons
  cleaned = cleaned.replace(/:\s*[A-Z][A-Za-z<>\[\]| ]+(?=\s*[,\n=;{])/g, "");

  // Remove `export const cv =`
  cleaned = cleaned.replace(/export\s+const\s+\w+\s*=\s*/, "");

  // Remove trailing semicolon
  cleaned = cleaned.replace(/;\s*$/, "").trim();

  // Shorthand property names (e.g. `name,` from destructured import) → `name: "{{name}}",`
  cleaned = cleaned.replace(/^(\s*)([a-zA-Z_]+),\s*$/gm, '$1$2: "{{$2}}",');

  // ALL_CAPS constant values after colons → placeholder strings
  cleaned = cleaned.replace(/(?<=:\s*)([A-Z][A-Z_]+)\b/g, '"{{$1}}"');

  try {
    const fn = new Function(`return ${cleaned}`);
    return fn();
  } catch (e) {
    console.error("Could not parse TS CV object, falling back to raw text:", e.message);
    return { _raw: source };
  }
}

/**
 * Replace {{PLACEHOLDER}} tokens with real values from config.cv_constants.
 * e.g. config.cv_constants = { "name": "Jane Smith", "CONTACT_EMAIL": "jane@example.com" }
 */
function resolvePlaceholders(str, constants) {
  if (!str || typeof str !== "string") return str;
  return str.replace(/\{\{([^}]+)\}\}/g, (_, key) => constants[key] ?? `[${key}]`);
}

function resolveInObject(obj, constants) {
  if (!obj || !constants || Object.keys(constants).length === 0) return obj;
  if (typeof obj === "string") return resolvePlaceholders(obj, constants);
  if (Array.isArray(obj)) return obj.map(item => resolveInObject(item, constants));
  if (typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, resolveInObject(v, constants)])
    );
  }
  return obj;
}

/**
 * Convert a structured CV object into well-formatted text for Claude.
 */
function formatStructuredCV(cv, config = {}) {
  if (cv._raw) return cv._raw;

  // Resolve any {{PLACEHOLDER}} tokens using config.cv_constants
  const constants = config.cv_constants || {};
  cv = resolveInObject(cv, constants);

  const lines = [];

  if (cv.header) {
    const h = cv.header;
    lines.push(`# ${h.name || "CV"}`);
    if (h.title) lines.push(h.title);
    if (h.email) lines.push(`Email: ${h.email}`);
    if (h.location) lines.push(`Location: ${h.location}`);
    if (h.website) lines.push(`Website: ${h.website}`);
    lines.push("");
  }

  if (cv.personalStatement) {
    lines.push(`## Personal Statement`);
    lines.push(cv.personalStatement);
    lines.push("");
  }

  if (cv.summary) {
    lines.push(`## Summary`);
    lines.push(cv.summary);
    lines.push("");
  }

  if (cv.strengths?.length) {
    lines.push(`## Core Strengths`);
    for (const s of cv.strengths) {
      lines.push(`**${s.title}**: ${s.description}`);
    }
    lines.push("");
  }

  if (cv.sidebar?.length) {
    for (const section of cv.sidebar) {
      lines.push(`## ${section.title}`);
      if (section.bullets?.length) {
        for (const b of section.bullets) lines.push(`- ${b}`);
      }
      if (section.paragraphs?.length) {
        for (const p of section.paragraphs) lines.push(p);
      }
      lines.push("");
    }
  }

  if (cv.experience?.length) {
    lines.push(`## Experience`);
    for (const job of cv.experience) {
      lines.push(`### ${job.title} — ${job.company} (${job.start} – ${job.end || "Present"})`);
      if (job.summary) lines.push(job.summary);
      if (job.bullets?.length) {
        for (const b of job.bullets) lines.push(`- ${b}`);
      }
      lines.push("");
    }
  }

  if (cv.education?.length) {
    lines.push(`## Education`);
    for (const e of cv.education) {
      lines.push(`- **${e.degree}** — ${e.institution} (${e.date})`);
    }
    lines.push("");
  }

  if (cv.languages?.length) {
    lines.push(`## Languages`);
    for (const l of cv.languages) {
      lines.push(`- ${l.name}: ${l.levelLabel}${l.levelCode ? ` (${l.levelCode})` : ""}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
