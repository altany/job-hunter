/**
 * The structured CV shape used by tailored CVs. It mirrors the `Cv` type the
 * PDF renderer reads (tany4's src/cv/types.ts), so a tailored CV saved in an
 * application doc can be turned into a PDF by that repo's `cv:pdf` script.
 * If that type changes, update CV_TYPE and validateCv together.
 */

export const TAILORED_CV_HEADING = "Tailored CV";

export const CV_TYPE = `type Cv = {
  header: { name: string; title: string; email: string; location: string; website?: string };
  personalStatement: string;
  summary: string;
  strengths: { title: string; description: string }[];
  sidebar: { title: string; paragraphs?: string[]; bullets?: string[] }[];
  experience: { start: string; end: string; title: string; company: string; summary?: string; bullets: string[] }[];
  education: { date: string; institution: string; degree: string }[];
  languages: { name: string; levelLabel: string; levelCode?: string }[];
};`;

const SHAPE = {
  header: { name: "string", title: "string", email: "string", location: "string", website: "string?" },
  personalStatement: "string",
  summary: "string",
  strengths: [{ title: "string", description: "string" }],
  sidebar: [{ title: "string", paragraphs: "string[]?", bullets: "string[]?" }],
  experience: [{ start: "string", end: "string", title: "string", company: "string", summary: "string?", bullets: "string[]" }],
  education: [{ date: "string", institution: "string", degree: "string" }],
  languages: [{ name: "string", levelLabel: "string", levelCode: "string?" }],
};

function check(value, shape, path, errors) {
  if (typeof shape === "string") {
    const optional = shape.endsWith("?");
    const type = shape.replace("?", "");
    if (value === undefined) {
      if (!optional) errors.push(`${path} is missing`);
      return;
    }
    if (type === "string" && typeof value !== "string") errors.push(`${path} must be text`);
    if (type === "string[]" && (!Array.isArray(value) || value.some((v) => typeof v !== "string"))) {
      errors.push(`${path} must be a list of text items`);
    }
    return;
  }
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) { errors.push(`${path} must be a list`); return; }
    value.forEach((item, i) => check(item, shape[0], `${path}[${i}]`, errors));
    return;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path || "CV"} must be an object`);
    return;
  }
  for (const key of Object.keys(value)) {
    if (!(key in shape)) errors.push(`${path ? path + "." : ""}${key} isn't a CV field`);
  }
  for (const [key, sub] of Object.entries(shape)) {
    check(value[key], sub, path ? `${path}.${key}` : key, errors);
  }
}

/** Returns a list of problems; empty means the renderer can use it. */
export function validateCv(cv) {
  const errors = [];
  check(cv, SHAPE, "", errors);
  return errors;
}

/**
 * Pull the CV JSON out of a doc section (as returned by docToMarkdown). Google
 * Docs turns typed quotes into curly ones, so those are straightened first.
 */
export function extractCvJson(markdown) {
  const match = String(markdown || "").match(/```[\w-]*\n([\s\S]*?)\n```/);
  if (!match) throw new Error("no JSON code block found in the section");
  const text = match[1].replace(/[“”„‟]/g, '"');
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`the JSON in the doc isn't valid (${e.message}) — check for a missing comma or quote near there`);
  }
}

export function parseCvArg(value) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch (e) {
    throw new Error(`cv_json isn't valid JSON (${e.message})`);
  }
}
