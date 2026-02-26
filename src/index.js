#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { GoogleSheetsClient } from "./sheets.js";
import { loadCV, loadPreferences } from "./cv.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "../config.json");

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Config file not found at ${CONFIG_PATH}. Please copy config.example.json to config.json and fill in your details.`);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function loadContextFiles() {
  const contextDir = path.join(__dirname, "../context");
  if (!fs.existsSync(contextDir)) return "";

  const files = fs.readdirSync(contextDir)
    .filter(f => f.endsWith(".md"))
    .sort();

  if (files.length === 0) return "";

  const sections = files.map(file => {
    const title = file.replace(/\.md$/, "").replace(/[-_]/g, " ");
    const content = fs.readFileSync(path.join(contextDir, file), "utf8").trim();
    return `### ${title}\n${content}`;
  });

  return `## Additional Context\n${sections.join("\n\n")}`;
}

const server = new Server(
  { name: "job-hunter", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "rate_job",
      description: "Rate a job posting against your CV and preferences. Paste the full job ad text to get a detailed score and recommendation. IMPORTANT: Before scoring, this tool will automatically research the company on Glassdoor, check salary data including your region geo-adjustment, investigate the interview process, and check for dealbreakers. You will receive a full picture — research summary, dealbreaker check, scored breakdown, interview process notes, and specific talking points — so you can decide whether to apply without any additional back-and-forth.",
      inputSchema: {
        type: "object",
        properties: {
          job_ad: { type: "string", description: "Full text of the job advertisement" },
          company_name: { type: "string", description: "Company name" },
          role_title: { type: "string", description: "Job title" },
          job_url: { type: "string", description: "URL of the job posting (optional)" },
          salary: { type: "string", description: "Salary range if visible (optional)" },
        },
        required: ["job_ad", "company_name", "role_title"],
      },
    },
    {
      name: "tailor_cv",
      description: "Generate a tailored CV for a specific job application, highlighting the most relevant experience and skills.",
      inputSchema: {
        type: "object",
        properties: {
          company_name: { type: "string" },
          role_title: { type: "string" },
          job_ad: { type: "string", description: "Full job ad text" },
          output_format: {
            type: "string",
            enum: ["markdown", "text"],
            description: "Format for the tailored CV (default: markdown)",
          },
        },
        required: ["company_name", "role_title", "job_ad"],
      },
    },
    {
      name: "generate_cover_letter",
      description: "Generate a tailored cover letter for a job application.",
      inputSchema: {
        type: "object",
        properties: {
          company_name: { type: "string" },
          role_title: { type: "string" },
          job_ad: { type: "string" },
          tone: {
            type: "string",
            enum: ["formal", "conversational", "enthusiastic"],
            description: "Tone of the cover letter (default: conversational)",
          },
          specific_notes: {
            type: "string",
            description: "Any specific points you want to make sure are included",
          },
        },
        required: ["company_name", "role_title", "job_ad"],
      },
    },
    {
      name: "add_application",
      description: "Log a new job application to your Google Sheets tracker.",
      inputSchema: {
        type: "object",
        properties: {
          company_name: { type: "string" },
          role_title: { type: "string" },
          job_url: { type: "string" },
          salary: { type: "string" },
          rating: { type: "number", description: "Your rating score (1-10)" },
          status: {
            type: "string",
            enum: ["Saved", "Applied", "Phone Screen", "Interview", "Offer", "Rejected", "Withdrawn"],
          },
          notes: { type: "string" },
          work_type: { type: "string", enum: ["Remote", "Hybrid", "Onsite"] },
          location: { type: "string" },
          doc_url: { type: "string", description: "Google Doc URL for interview notes (optional)" },
        },
        required: ["company_name", "role_title"],
      },
    },
    {
      name: "update_application",
      description: "Update an existing application's status, add interview notes, or record outcomes.",
      inputSchema: {
        type: "object",
        properties: {
          company_name: { type: "string" },
          role_title: { type: "string" },
          status: {
            type: "string",
            enum: ["Saved", "Applied", "Phone Screen", "Interview", "Offer", "Rejected", "Withdrawn"],
          },
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
    {
      name: "get_applications",
      description: "View your job application pipeline — all applications and their current status.",
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
    {
      name: "get_application_doc",
      description: "Get the Google Doc for a specific application. If no doc exists yet, creates one automatically and links it to the tracker. Returns the doc URL and full current content.",
      inputSchema: {
        type: "object",
        properties: {
          company_name: { type: "string" },
          role_title: { type: "string" },
        },
        required: ["company_name", "role_title"],
      },
    },
    {
      name: "update_application_doc",
      description: "Add a new section to the Google Doc for a specific application. Use this to document interview stages, study notes, post-interview reflections, company research, or any other notes. The doc is created automatically if it doesn't exist yet.",
      inputSchema: {
        type: "object",
        properties: {
          company_name: { type: "string" },
          role_title: { type: "string" },
          heading: {
            type: "string",
            description: "Section heading, e.g. 'Round 1 Reflection', 'Study Notes', 'Interview Process', 'Company Research'",
          },
          content: {
            type: "string",
            description: "The content to add under this heading",
          },
        },
        required: ["company_name", "role_title", "heading", "content"],
      },
    },
    {
      name: "prep_interview",
      description: "Generate comprehensive interview preparation materials for a company and role, including likely questions, research points, and talking points from your CV. Automatically includes any existing notes from the application doc.",
      inputSchema: {
        type: "object",
        properties: {
          company_name: { type: "string" },
          role_title: { type: "string" },
          interview_type: {
            type: "string",
            enum: ["phone_screen", "technical", "behavioural", "final", "general"],
          },
          job_ad: { type: "string", description: "Job ad text if available" },
          extra_context: {
            type: "string",
            description: "Any extra context (e.g. who you're meeting, what you know about the role)",
          },
        },
        required: ["company_name", "role_title", "interview_type"],
      },
    },
    {
      name: "add_interview_note",
      description: "Log interview notes, feedback, or outcomes for an application.",
      inputSchema: {
        type: "object",
        properties: {
          company_name: { type: "string" },
          role_title: { type: "string" },
          interview_round: { type: "string", description: "e.g. 'Phone Screen', 'Round 1', 'Final'" },
          interview_date: { type: "string", description: "Date of interview (YYYY-MM-DD)" },
          interviewers: { type: "string", description: "Who you met with" },
          notes: { type: "string", description: "Your notes and impressions" },
          outcome: {
            type: "string",
            enum: ["Pending", "Passed", "Failed", "Withdrew"],
          },
        },
        required: ["company_name", "role_title", "interview_round"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const config = loadConfig();
  const sheets = new GoogleSheetsClient(config);
  const { cvText } = await loadCV(config);
  const preferences = loadPreferences(config);
  const contextFiles = loadContextFiles();

  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "rate_job": {
        const rating = rateJob(args, cvText, preferences, contextFiles);
        return { content: [{ type: "text", text: rating }] };
      }

      case "tailor_cv": {
        const tailored = tailorCV(args, cvText, preferences, contextFiles);
        return { content: [{ type: "text", text: tailored }] };
      }

      case "generate_cover_letter": {
        const letter = generateCoverLetter(args, cvText, preferences, contextFiles);
        return { content: [{ type: "text", text: letter }] };
      }

      case "add_application": {
        await sheets.addApplication(args);
        return {
          content: [{ type: "text", text: `✅ Added "${args.role_title}" at ${args.company_name} to your tracker.` }],
        };
      }

      case "update_application": {
        const result = await sheets.updateApplication(args);
        return { content: [{ type: "text", text: result }] };
      }

      case "get_applications": {
        const apps = await sheets.getApplications(args.status_filter);
        return { content: [{ type: "text", text: apps }] };
      }

      case "get_application_doc": {
        let docUrl, created = false;

        try { docUrl = await sheets.getDocUrl(args.company_name, args.role_title); }
        catch(e) { throw new Error(`getDocUrl failed: ${e.message}`); }

        if (!docUrl) {
          let newUrl;
          try { ({ docUrl: newUrl } = await sheets.createApplicationDoc(args.company_name, args.role_title)); }
          catch(e) { throw new Error(`createApplicationDoc failed: ${e.message}`); }
          docUrl = newUrl;
          try {
            await sheets.updateApplication({
              company_name: args.company_name,
              role_title: args.role_title,
              doc_url: docUrl,
            });
          } catch(e) { throw new Error(`updateApplication failed: ${e.message}`); }
          created = true;
        }

        let docContent = "";
        try { docContent = await sheets.readDoc(docUrl); }
        catch(e) { docContent = "(could not read doc content: " + e.message + ")"; }

        const header = created
          ? `📄 Created new interview doc for ${args.company_name}:\n${docUrl}`
          : `📄 Interview doc for ${args.company_name}:\n${docUrl}`;

        return { content: [{ type: "text", text: `${header}\n\n---\n${docContent}` }] };
      }

      case "update_application_doc": {
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
      }

      case "prep_interview": {
        // Pull in doc content automatically if available
        let docContext = "";
        try {
          const docUrl = await sheets.getDocUrl(args.company_name, args.role_title);
          if (docUrl) {
            const docContent = await sheets.readDoc(docUrl);
            if (docContent) {
              docContext = `\n\n## Application Notes (from Interview Doc)\n${docContent}`;
            }
          }
        } catch (e) {
          // Don't fail prep if doc read fails
        }

        const prep = prepInterview(args, cvText, preferences, contextFiles, docContext);
        return { content: [{ type: "text", text: prep }] };
      }

      case "add_interview_note": {
        await sheets.addInterviewNote(args);
        return {
          content: [{ type: "text", text: `✅ Interview note added for ${args.interview_round} at ${args.company_name}.` }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return {
      content: [{ type: "text", text: `❌ Error: ${err.message}` }],
      isError: true,
    };
  }
});

// ─── Tool helpers ────────────────────────────────────────────────────────────

function rateJob(args, cvText, preferences, contextFiles) {
  return `
You are a career coach helping evaluate a job opportunity for a candidate who is actively interviewing.

## Candidate CV
${cvText}

## Candidate Preferences
${JSON.stringify(preferences, null, 2)}

${contextFiles}

## Job Details
Company: ${args.company_name}
Role: ${args.role_title}
Salary: ${args.salary || "Not specified"}
URL: ${args.job_url || "N/A"}

## Job Ad
${args.job_ad}

## Your Task

### Step 1: Research BEFORE scoring (mandatory)
Use web_search to find the following. Do not skip this step.

**Glassdoor:**
- Search: "${args.company_name} Glassdoor reviews 2025 2026"
- Find: overall rating, % recommend, business outlook, WLB rating
- IMPORTANT: Also find engineering-specific scores if possible — overall Glassdoor scores can be misleading. Search: "${args.company_name} Glassdoor software engineer reviews"
- Note any recurring cons, red flags, or warnings in recent (2024-2025) reviews

**Salary:**
- If salary not provided, search: "${args.company_name} ${args.role_title} salary UK" and "${args.company_name} ${args.role_title} salary your region remote"
- The candidate is based in your region — many companies geo-adjust. Flag if this is likely.
- Compare findings against candidate's minimum (£70k) and target (£90k)
- NOTE: candidate will accept below target for exceptional WLB — salary is secondary to work-life balance

**Interview process:**
- Search: "${args.company_name} interview process engineer" or check their careers page
- Flag: does it include live coding? Take-home? How many stages? Timeline?
- Note: candidate is mindful of their interview-style preferences (noted in config) — this is relevant

**Engineering culture:**
- Search: "${args.company_name} engineering blog" or "${args.company_name} engineering culture"
- How big is the eng team? Async or sync? Any on-call requirements?
- Any recent layoffs, reorgs, or leadership changes?

**Recent news:**
- Search: "${args.company_name} news 2025 2026"
- Funding status, growth trajectory, any concerns

---

### Step 2: Dealbreaker check
Before scoring, explicitly check each of these. Flag any that are a concern:
- ❌ Onsite or hybrid required (dealbreaker)
- ❌ On-call rotation of ANY kind (dealbreaker) — search JD text explicitly for: "on-call", "rotation", "pager", "incident response", "out of hours". Also check engineering blog and Glassdoor for mentions.
- ❌ Salary likely below £70k after geo-adjustment (dealbreaker)
- ❌ People management expected (dealbreaker)
- ❌ Defence / gambling / crypto industry (dealbreaker)
- ❌ "Remote-friendly" but not truly async/remote-first — check if team is co-located with remote as exception
- ⚠️ Live coding interviews (concern given candidate's preference)
- ⚠️ High-pressure / fast-paced / always-on culture (WLB is candidate's top priority right now)

If any ❌ dealbreakers are present, state this clearly at the top and recommend skipping.

---

### Step 3: Rating

#### Research Summary
2-3 sentences covering: Glassdoor signal, salary situation, interview process, any red flags found.

#### Dealbreaker Check: PASS / FAIL
List each dealbreaker with status.

#### Overall Score: X/10

#### Breakdown
| Dimension | Score | Notes |
|-----------|-------|-------|
| Skills Match | /10 | Specific gaps or strengths |
| Salary Match | /10 | Based on researched data. Note: candidate accepts lower salary for great WLB |
| Remote/WLB | /10 | **Top priority** — sustainable pace, no on-call, async culture, chill environment. Weight this heavily. |
| Industry/Product Fit | /10 | Is this the kind of product complexity the candidate wants? |
| Environment & Culture | /10 | Eng-specific Glassdoor signals, async culture, team size |
| Pipeline Comparison | /10 | How does this compare to active applications? |

#### ✅ Strong Points
Specific reasons this is a good fit, referencing the candidate's actual experience.

#### ⚠️ Watch Points
Concerns or gaps — be specific, not generic.

#### 🚩 Red Flags
Anything discovered in research that wasn't visible from the job ad alone.

#### 💬 Recommendation
Clear verdict: Apply now / Save for later / Skip. 2-3 sentences max. Be direct.

#### 📋 Interview Process
What to expect based on research: stages, format, timeline, live coding risk.

#### 📝 If You Apply — What to Lead With
3-4 specific talking points from the candidate's CV that directly address this role's needs. Be specific — reference actual projects and metrics, not generic strengths.
`.trim();
}

function tailorCV(args, cvText, preferences, contextFiles) {
  return `
You are an expert CV writer. Tailor the candidate's CV for the specific role below.

## Original CV
${cvText}

## Candidate Preferences & Context
${JSON.stringify(preferences, null, 2)}

${contextFiles}

## Target Role
Company: ${args.company_name}
Role: ${args.role_title}

## Job Ad
${args.job_ad}

## Instructions
- Reorder and reframe experience to best match the job requirements
- Adjust bullet points to use language from the job ad where authentic
- Highlight the most relevant skills and achievements
- Keep all facts truthful — do not invent experience
- Maintain the same overall structure but optimise emphasis
- Output in ${args.output_format || "markdown"} format
- Add a brief note at the top explaining the key tailoring decisions you made

Output the full tailored CV.
`.trim();
}

function generateCoverLetter(args, cvText, preferences, contextFiles) {
  return `
You are an expert career coach writing a cover letter.

## Candidate CV
${cvText}

## Candidate Preferences & Context
${JSON.stringify(preferences, null, 2)}

${contextFiles}

## Target Role
Company: ${args.company_name}
Role: ${args.role_title}
Tone: ${args.tone || "conversational"}

## Job Ad
${args.job_ad}

## Specific Points to Include
${args.specific_notes || "None specified"}

## Instructions
Write a compelling, ${args.tone || "conversational"} cover letter that:
- Opens with a strong hook (not "I am writing to apply for...")
- Connects the candidate's specific experience to the role's key needs
- Shows genuine interest in this company specifically
- Is 3-4 paragraphs, under 400 words
- Ends with a confident, clear call to action

Output the cover letter ready to send (no placeholders).
`.trim();
}

function prepInterview(args, cvText, preferences, contextFiles, docContext = "") {
  const typeGuides = {
    phone_screen: "Focus on: elevator pitch, motivation for the role, salary expectations, logistics",
    technical: "Focus on: technical skills assessment, problem-solving, portfolio/past work deep dives",
    behavioural: "Focus on: STAR-format stories, leadership, conflict, failure, collaboration",
    final: "Focus on: cultural fit, vision alignment, negotiation readiness, senior stakeholder questions",
    general: "Cover all bases: motivation, skills, experience, culture fit",
  };

  return `
You are an expert interview coach preparing a candidate for an interview.

## Candidate CV
${cvText}

## Candidate Preferences & Context
${JSON.stringify(preferences, null, 2)}

${contextFiles}
${docContext}

## Interview Details
Company: ${args.company_name}
Role: ${args.role_title}
Interview Type: ${args.interview_type}
Focus: ${typeGuides[args.interview_type] || typeGuides.general}

## Job Ad
${args.job_ad || "Not provided"}

## Extra Context
${args.extra_context || "None"}

## Your Task
Generate comprehensive interview prep materials:

### 🏢 Company Research Points
Key things to know and mention about ${args.company_name} (products, culture, recent news, values).

### 🎯 Why This Role / Why You
3-4 strong talking points connecting the candidate's background to this specific role.

### ❓ Likely Questions & Strong Answers
List 8-10 likely questions for a ${args.interview_type} interview, with guidance on how to answer each using the candidate's actual experience.

### 📖 STAR Stories to Prepare
3-4 specific stories from the CV that should be fleshed out and ready to use.

### 🔍 Smart Questions to Ask Them
5 thoughtful questions the candidate should ask the interviewer.

### ⚡ Quick Tips
3-5 tactical tips specific to this interview type and company.
`.trim();
}

// ─── Start server ────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);