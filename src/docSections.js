/**
 * Section model for application docs.
 *
 * A section is a heading plus everything after it up to the next heading of the
 * same or higher level. Headings are recognised both when already styled
 * (HEADING_1..6) and in their raw markup form, so docs that haven't been
 * formatted yet are handled the same way:
 *
 *   ━━━ / TEXT / ━━━ (35+ char rules) → level 2     ## TEXT → level 3
 *   ━━━ / TEXT / ━━━ (shorter rules)  → level 3     ### TEXT, --- TEXT --- → level 4
 *                                                   -- TEXT -- → level 5
 */

const RULE = /^━{10,}$/;
const H2_HASH = /^## (?!#)\S/;
const H3_HASH = /^### (?!#)\S/;
const TRIPLE_DASH = (t) => /^[-—]{3} \S/.test(t) && / [-—]{3}$/.test(t);
const DOUBLE_DASH = (t) => /^[-—]{2} \S/.test(t) && / [-—]{2}$/.test(t) && !/^[-—]{3}/.test(t);

export function paraText(el) {
  if (!el?.paragraph?.elements) return "";
  return el.paragraph.elements
    .map((e) => e.textRun?.content || "")
    .join("")
    .replace(/\n$/, "");
}

// "ROUND 1 REFLECTION — 26 Sept 2026" and "Round 1 reflection" compare equal.
export function normalizeHeading(text) {
  return String(text || "")
    .replace(/^#+\s*/, "")
    .replace(/^[-—]{2,3}\s+/, "")
    .replace(/\s+[-—]{2,3}$/, "")
    .replace(/\s+[—–-]\s+\d{1,2}\s+[A-Za-z]{3,5}\.?\s+\d{4}$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function styledLevel(el) {
  const m = el.paragraph?.paragraphStyle?.namedStyleType?.match(/^HEADING_(\d)$/);
  return m ? Number(m[1]) : null;
}

/** Parse a Docs body into a flat list of sections with their index ranges. */
export function parseSections(content) {
  const headings = [];
  for (let i = 0; i < content.length; i++) {
    const el = content[i];
    if (!el.paragraph) continue;
    const text = paraText(el).trim();

    const level = styledLevel(el);
    if (level && text) {
      headings.push({ text, level, start: el.startIndex, headingEnd: el.endIndex });
      continue;
    }

    if (RULE.test(text) && i + 2 < content.length) {
      const mid = content[i + 1];
      const after = content[i + 2];
      const midText = paraText(mid).trim();
      if (mid?.paragraph && after?.paragraph && midText && RULE.test(paraText(after).trim())) {
        headings.push({
          text: midText,
          level: text.length >= 35 ? 2 : 3,
          start: el.startIndex,
          headingEnd: after.endIndex,
        });
        i += 2;
        continue;
      }
    }

    let rawLevel = null;
    if (H2_HASH.test(text)) rawLevel = 3;
    else if (H3_HASH.test(text) || TRIPLE_DASH(text)) rawLevel = 4;
    else if (DOUBLE_DASH(text)) rawLevel = 5;
    if (rawLevel) headings.push({ text, level: rawLevel, start: el.startIndex, headingEnd: el.endIndex });
  }

  const docEnd = content[content.length - 1].endIndex - 1; // final newline can't be deleted
  return headings.map((h, idx) => {
    const next = headings.slice(idx + 1).find((n) => n.level <= h.level);
    return {
      text: h.text,
      normalized: normalizeHeading(h.text),
      level: h.level,
      start: h.start,
      bodyStart: h.headingEnd,
      bodyEnd: next ? next.start : docEnd,
    };
  });
}

/**
 * Make model-written content safe to drop into a section: top-level markup
 * (━━━ blocks, # H1, #### and deeper) is mapped to levels the section can hold,
 * so content never splits the doc into unexpected sections.
 */
export function normalizeContent(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (RULE.test(t) && i + 2 < lines.length && lines[i + 1].trim() && RULE.test(lines[i + 2].trim())) {
      out.push(`## ${lines[i + 1].trim()}`);
      i += 2;
    } else if (RULE.test(t)) {
      out.push("---");
    } else if (/^# (?!#)\S/.test(t)) {
      out.push(t.replace(/^# /, "## "));
    } else if (/^#{4,} \S/.test(t)) {
      out.push(`-- ${t.replace(/^#{4,} /, "")} --`);
    } else {
      out.push(lines[i]);
    }
  }
  return out.join("\n").trim();
}

/** Heading levels that would be created by (normalised) content. */
export function contentHeadingLevels(text) {
  const levels = [];
  for (const line of String(text || "").split("\n")) {
    const t = line.trim();
    if (H2_HASH.test(t)) levels.push(3);
    else if (H3_HASH.test(t) || TRIPLE_DASH(t)) levels.push(4);
    else if (DOUBLE_DASH(t)) levels.push(5);
  }
  return levels;
}

export const CONTENT_MARKUP_HELP =
  "Write plain markdown and it is styled automatically: `## Sub-heading` and `### Smaller heading` " +
  "(don't use `#` or ━━━ dividers — the section heading is added for you), `- item` for bullets, " +
  "`**bold**`, `_italic_`, `` `code` `` for inline code, ``` fences for code blocks, " +
  "`| a | b |` rows for tables, and a line with just `---` for a divider.";

function runsToMarkdown(elements) {
  return (elements || [])
    .map((e) => {
      const t = e.textRun?.content || "";
      if (!e.textRun?.textStyle?.bold || !t.trim()) return t;
      const [, lead, body, trail] = t.match(/^(\s*)(.*?)(\s*)$/s);
      return `${lead}**${body}**${trail}`;
    })
    .join("")
    .replace(/\n$/, "");
}

// Code blocks are styled Courier New by the formatter (fences removed).
export function isCodeParagraph(el) {
  const runs = (el.paragraph?.elements || []).filter((e) => e.textRun?.content?.trim());
  return runs.length > 0 && runs.every((e) => e.textRun.textStyle?.weightedFontFamily?.fontFamily === "Courier New");
}

/** Render a Docs body as the markdown the write tools accept. */
export function docToMarkdown(content) {
  const out = [];
  let inCode = false;
  for (const el of content) {
    const code = !!el.paragraph && isCodeParagraph(el);
    if (code !== inCode) {
      out.push("```");
      inCode = code;
    }
    if (code) {
      out.push(paraText(el));
      continue;
    }
    if (el.table) {
      (el.table.tableRows || []).forEach((row, i) => {
        const cells = (row.tableCells || []).map((c) =>
          (c.content || []).map((p) => paraText(p)).join(" ").trim().replace(/\|/g, "\\|")
        );
        out.push(`| ${cells.join(" | ")} |`);
        if (i === 0) out.push(`|${cells.map(() => "---").join("|")}|`);
      });
      continue;
    }
    if (!el.paragraph) continue;
    const level = styledLevel(el);
    const text = level ? paraText(el).trim() : runsToMarkdown(el.paragraph.elements);
    if (level && text) {
      if (level <= 2) out.push("", text);
      else if (level === 3) out.push(`## ${text}`);
      else if (level === 4) out.push(`### ${text}`);
      else out.push(`-- ${text} --`);
    } else if (el.paragraph.bullet && text.trim()) {
      const depth = el.paragraph.bullet.nestingLevel || 0;
      out.push(`${"  ".repeat(depth)}- ${text.trim()}`);
    } else {
      out.push(text);
    }
  }
  if (inCode) out.push("```");
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
