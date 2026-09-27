/**
 * Finds the CV repo whose `scripts/generate-cv-pdf.tsx` renders tailored CVs,
 * so local and hosted servers produce the same PDF from the same code:
 *
 *   - local:  the repo on disk (cv_pdf.repo_path, or <repo> when cv_file_path
 *             is <repo>/src/cv/cv.ts), using its own node_modules
 *   - hosted: a public GitHub repo (cv_pdf.github_repo, e.g. "you/site"),
 *             downloaded at its latest commit and cached per commit; it runs
 *             with this server's own @react-pdf/renderer, react and tsx
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";

const run = promisify(execFile);
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(APP_ROOT, ".cv-renderer");
const SCRIPT = path.join("scripts", "generate-cv-pdf.tsx");

// An older script ignores --json and would overwrite the site's own CV PDF.
const supportsJson = (dir) => {
  const file = path.join(dir, SCRIPT);
  return fs.existsSync(file) && fs.readFileSync(file, "utf8").includes('arg("json")');
};

function localRepoPath(config) {
  if (config.cv_pdf?.repo_path) return config.cv_pdf.repo_path;
  const m = String(config.cv_file_path || "").match(/^(.*)\/src\/cv\/cv\.(ts|js|json)$/);
  return m ? m[1] : null;
}

async function fetchGithubRepo(repo, branch) {
  const shaRes = await fetch(`https://api.github.com/repos/${repo}/commits/${branch}`, {
    headers: { Accept: "application/vnd.github.sha", "User-Agent": "job-hunter-mcp" },
  });
  if (!shaRes.ok) throw new Error(`couldn't look up ${repo}@${branch} on GitHub (${shaRes.status})`);
  const sha = (await shaRes.text()).trim();

  const dir = path.join(CACHE, sha);
  if (fs.existsSync(path.join(dir, SCRIPT))) return dir;

  const tar = await fetch(`https://codeload.github.com/${repo}/tar.gz/${sha}`);
  if (!tar.ok) throw new Error(`couldn't download ${repo} from GitHub (${tar.status})`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cv-repo-"));
  const file = path.join(tmp, "repo.tgz");
  fs.writeFileSync(file, Buffer.from(await tar.arrayBuffer()));

  // Only one commit is kept; older ones are dropped.
  fs.rmSync(CACHE, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  try {
    await run("tar", ["-xzf", file, "--strip-components=1", "-C", dir]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return dir;
}

/** Returns { dir, tsx, source } or throws with a message for the user. */
export async function resolveCvRenderer(config) {
  const local = localRepoPath(config);
  let dir = null;
  let source = null;

  if (local && fs.existsSync(path.join(local, SCRIPT))) {
    if (!supportsJson(local)) {
      throw new Error(`the CV script in ${local} doesn't support --json yet. Pull the latest version of that repo, then try again`);
    }
    dir = local;
    source = "local";
  } else if (config.cv_pdf?.github_repo) {
    dir = await fetchGithubRepo(config.cv_pdf.github_repo, config.cv_pdf.github_branch || "main");
    if (!supportsJson(dir)) throw new Error(`the CV script in ${config.cv_pdf.github_repo} doesn't support --json`);
    source = "github";
  } else {
    throw new Error(
      "no CV repo is configured. Set cv_pdf.repo_path (local) or cv_pdf.github_repo (a public GitHub repo, for the hosted server) in config.json"
    );
  }

  const tsx = [path.join(dir, "node_modules"), path.join(APP_ROOT, "node_modules")]
    .map((nm) => path.join(nm, "tsx", "dist", "cli.mjs"))
    .find((p) => fs.existsSync(p));
  if (!tsx) throw new Error("tsx isn't installed, so the CV script can't run");

  return { dir, tsx, source };
}

/** Render `cv` (already validated) to `outPath` with the repo's own script. */
export async function renderCvPdf(renderer, cv, outPath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tailored-cv-"));
  const jsonPath = path.join(tmp, "cv.json");
  fs.writeFileSync(jsonPath, JSON.stringify(cv));
  try {
    await run(process.execPath, [renderer.tsx, SCRIPT, "--json", jsonPath, "--out", outPath], {
      cwd: renderer.dir,
      timeout: 120000,
    });
  } catch (e) {
    const detail = (e.stderr || e.message || "").split("\n").filter((l) => /error/i.test(l)).slice(0, 3).join(" ");
    throw new Error(`the CV PDF script failed: ${detail || e.message}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (!fs.existsSync(outPath)) throw new Error("the CV PDF script ran but didn't produce a file");
}
