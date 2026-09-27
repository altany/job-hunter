/**
 * Prompt-generating tools.
 *
 * These are pure functions: they assemble an instruction prompt for the model
 * to act on (web research, writing, scoring). All candidate-specific facts —
 * location, salary targets, interview strengths/weaknesses, work-style
 * priorities — come from the (gitignored) config: `preferences`, the injected
 * candidate notes, and the `context/*.md` files. Nothing personal is hardcoded
 * here, so this source is safe to publish.
 */

import { CV_TYPE } from "../cvSchema.js";

const STYLE_NOTE = "If the candidate's context includes writing-style rules, they override any style guidance here.";

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

**Glassdoor / employee reviews:**
- Search: "${args.company_name} Glassdoor reviews 2025 2026"
- Find: overall rating, % recommend, business outlook, and any work-life balance signal
- IMPORTANT: Overall scores can be misleading. Also search: "${args.company_name} software engineer reviews" and "${args.company_name} engineering reviews"
- Prioritize engineering-specific signals over company-wide averages
- Note any recurring cons, red flags, or warnings in recent (2024-2025) reviews
- If engineering reviews mention burnout, long hours, chaos, frequent priority changes, support burden, or unclear expectations, reduce the Remote/WLB score by at least 2 points

**Salary:**
- First use the salary listed in the job ad, if present
- If salary is not provided, search in this order:
  1. official company careers page / salary calculator
  2. reliable role-specific salary sources for this exact company and role
  3. reputable employee-reported sources if role-specific and recent
- Search: "${args.company_name} ${args.role_title} salary"
- Search: "${args.company_name} compensation remote Europe"
- Search: "${args.company_name} salary calculator"
- If the candidate's location (see preferences/notes above) is one companies commonly geo-adjust for, flag whether that is likely here
- Compare findings against the candidate's current minimum and target from Candidate Preferences
- If no reliable salary data is found for the specific company and role, mark Salary Match as "Unknown" rather than estimating from generic market averages
- Do NOT infer salary from unrelated companies or broad market averages

**Interview process:**
- Search: "${args.company_name} interview process engineer" or check the company's careers page
- Flag: does it include live coding? Take-home? How many stages? Timeline?
- Weigh this against the candidate's interview strengths and weaknesses from their preferences/notes above

**Engineering culture:**
- Search: "${args.company_name} engineering blog"
- Search: "${args.company_name} engineering culture"
- Search: "${args.company_name} remote culture"
- How big is the eng team? Async or sync? Any on-call, support rotation, or incident response expectations?
- Any recent layoffs, reorgs, or leadership changes?
- Pay close attention to whether the role expects senior engineers to act as team scalers, org multipliers, or unofficial tech leads

**Recent news:**
- Search: "${args.company_name} news 2025 2026"
- Funding status, growth trajectory, layoffs, restructuring, or other concerns

---

### Step 2: Dealbreaker check
Before scoring, explicitly check each of these against the candidate's stated dealbreakers and red flags in the preferences above. Flag any that are a concern:

- ❌ Work arrangement conflicts with the candidate's stated work-style dealbreakers
- ❌ On-call rotation of ANY kind, if listed as a red flag — search JD text explicitly for: "on-call", "rotation", "pager", "incident response", "out of hours", "support rotation", "support hero". Also check engineering blog and reviews for mentions
- ❌ Salary likely below the candidate's minimum after any geo-adjustment
- ❌ People management expected, if the candidate is not open to management
- ❌ Industry explicitly in the candidate's "avoid" list
- ❌ "Remote-friendly" but not truly async/remote-first — check if the team is office-centric with remote as an exception
- ⚠️ Live coding interviews (flag if the candidate's notes indicate this is a concern)
- ⚠️ High-pressure / fast-paced / always-on culture
- ⚠️ Hyper-growth VC startup expecting senior engineers to act as tech leads or org multipliers
- ⚠️ "Senior" title appears to actually mean staff / tech lead / team-scaling role

If any ❌ dealbreakers are present, state this clearly at the top and recommend skipping.

---

### Step 3: Rating

#### Scoring Rules
- Treat the candidate's highest-priority constraints from their preferences above as the primary signal (for many candidates this is Remote / work-life balance)
- If Remote/WLB < 7, the Overall Score should not exceed 6/10
- If Remote/WLB < 6, the default recommendation should be Skip unless the role has exceptional compensating signals and no dealbreakers
- If Role Level Calibration < 6 because the role is effectively staff/tech-lead level, the Overall Score should be reduced materially even if the tech stack matches
- A calm, sustainable, mature product company should score higher than an exciting but high-pressure startup

#### Research Summary
2-3 sentences covering: engineering review signal, salary situation, interview process, and the most important red flags found.

#### Dealbreaker Check: PASS / FAIL
List each dealbreaker with status.

#### Overall Score: X/10

#### Breakdown
| Dimension | Score | Notes |
|-----------|-------|-------|
| Skills Match | /10 | Specific strengths and gaps relative to the role |
| Salary Match | /10 | Based on reliable company-specific evidence. Use "Unknown" if evidence is insufficient |
| Remote/WLB | /10 | **PRIMARY SIGNAL** — sustainable pace, no on-call, async culture, calm environment |
| Product Fit for Candidate | /10 | Fit for this candidate specifically. A calmer mature product company may score higher than an exciting fast-growing startup |
| Environment & Culture | /10 | Engineering-specific review signals, async culture, team size, support burden, layoffs/reorgs |
| Pipeline Comparison | /10 | How does this compare to the candidate's active/saved opportunities and stated preferences? |
| Role Level Calibration | /10 | Does "Senior" actually mean staff/tech lead internally? Flag if expectations include team scaling, org leadership, or ownership beyond a senior IC role |

#### ✅ Strong Points
Specific reasons this is a good fit, referencing the candidate's actual experience.

#### ⚠️ Watch Points
Concerns or gaps — be specific, not generic.

#### 🚩 Red Flags
Anything discovered in research that wasn't visible from the job ad alone.

#### 💬 Recommendation
Clear verdict: Apply now / Save for later / Skip. 2-3 sentences max. Be direct.
If the job is likely to create pressure, unclear expectations, or a working-style mismatch with the candidate's stated preferences, recommend skipping even if the tech stack matches well.

#### 📋 Interview Process
What to expect based on research: stages, format, timeline, live coding risk, and whether the process appears especially demanding.

#### 📝 If You Apply — What to Lead With
3-4 specific talking points from the candidate's CV that directly address this role's needs. Be specific — reference actual projects and metrics, not generic strengths.
`.trim();
}

function tailorCV(args, cvText, preferences, contextFiles, cvJson) {
  // No structured CV (e.g. a PDF CV): tailor as text, still saved in the doc.
  if (!cvJson) {
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
- Keep all facts truthful — do not invent experience
- Maintain the same overall structure but optimise emphasis
- Save the result in the application's Google Doc with update_application_doc (heading "Tailored CV"), or replace_doc_section if that section already exists. Don't create separate files.
- Then tell the user in 2-3 lines what you changed and that the full CV is in the doc.
`.trim();
  }

  return `
Tailor the candidate's CV for the role below. The CV is structured data that the candidate's own script turns into a PDF, so the result must keep exactly the same JSON shape.

## Base CV (JSON)
${JSON.stringify(cvJson, null, 2)}

## Required shape (TypeScript)
${CV_TYPE}

## Candidate Preferences & Context
${JSON.stringify(preferences, null, 2)}

${contextFiles}

## Target Role
Company: ${args.company_name}
Role: ${args.role_title}

## Job Ad
${args.job_ad}

## Rules
- Every fact stays true. You can reword, reorder, shorten and change emphasis. Never invent experience, employers, dates, numbers or skills.
- Same shape: same keys, no new fields, no missing required fields. header.name, header.email and header.website stay exactly as they are; header.title can be adjusted to the role.
- Keep every role in "experience", in the same date order. Within a role you can rewrite the summary and reorder, rewrite or drop bullets.
- Keep the length about the same (similar number of bullets and strengths) so it still fits the PDF layout.
- Write plainly, in the candidate's own voice. No buzzwords or clever phrasing. ${STYLE_NOTE}
- Values are plain text: no markdown (**, _, backticks) and no leading dashes, because the PDF shows them literally.

## What to do
1. Produce the tailored CV as JSON.
2. Save it with save_tailored_cv: cv_json = the JSON object, notes = 3-6 short bullets on what you changed and why. It goes into the application's Google Doc under "Tailored CV". Don't create files and don't paste the full JSON in chat.
3. Tell the user in 2-3 lines what you changed, and that they can review and edit the JSON in the doc. The doc version is the one that becomes the PDF.
4. Only when the user says the CV is approved, call generate_cv_pdf.
`.trim();
}

function generateCoverLetter(args, cvText, preferences, contextFiles) {
  const letter = args.skip_cover_letter
    ? ""
    : `
### Cover letter
Write a ${args.tone || "conversational"} cover letter that:
- Opens with why this role and company, not "I am writing to apply for..."
- Connects the candidate's specific experience to the role's key needs
- Shows genuine interest in this company specifically
- Is 3-4 paragraphs, under 400 words
- Ends with a clear next step
Ready to send, no placeholders.
`;
  const answers = args.application_questions
    ? `
### Application answers
Answer each question below in the candidate's voice, using their real experience. Respect any word or character limits. Keep each question as a sub-heading followed by the answer.

${args.application_questions}
`
    : "";

  return `
You are helping the candidate write their application.

## Candidate CV
${cvText}

## Candidate Preferences & Context
${JSON.stringify(preferences, null, 2)}

${contextFiles}

## Target Role
Company: ${args.company_name}
Role: ${args.role_title}

## Job Ad
${args.job_ad}

## Specific Points to Include
${args.specific_notes || "None specified"}

## What to write
${STYLE_NOTE}
${letter}${answers}
## Then
Show the drafts to the user. Once they're happy, save them in the application's Google Doc with update_application_doc, each as its own section ("Cover letter", "Application answers"), or replace_doc_section if that section already exists. Don't create separate files.
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
${STYLE_NOTE}
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

Show the prep to the user, then save it in the application's Google Doc with update_application_doc (a heading like "Interview prep — phone screen"). Don't create separate files.
`.trim();
}

const noauth = { securitySchemes: [{ type: "noauth" }] };

export const promptTools = [
  {
    name: "rate_job",
    definition: {
      name: "rate_job",
      annotations: { title: "Rate a job", readOnlyHint: true, openWorldHint: true },
      description:
        "Rate a job posting against your CV and preferences. Paste the full job ad text to get a detailed score and recommendation. IMPORTANT: Before scoring, this tool will automatically research the company on Glassdoor, check salary data (including any geo-adjustment for your location), investigate the interview process, and check for dealbreakers. You will receive a full picture — research summary, dealbreaker check, scored breakdown, interview process notes, and specific talking points — so you can decide whether to apply without any additional back-and-forth. If the user tracks the role, offer to save the research in the application's Google Doc (update_application_doc) rather than as a separate file.",
      securitySchemes: [{ type: "noauth" }],
      _meta: noauth,
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
    handler: async (args, { cvText, preferences, contextFiles }) => ({
      content: [{ type: "text", text: rateJob(args, cvText, preferences, contextFiles) }],
    }),
  },
  {
    name: "tailor_cv",
    definition: {
      name: "tailor_cv",
      annotations: { title: "Tailor CV", readOnlyHint: true, openWorldHint: false },
      description:
        "Tailor the CV for a specific job application. Returns instructions to produce a tailored CV in the same structure as the base CV and save it in the application's Google Doc (via save_tailored_cv) for the user to review; the PDF is made later with generate_cv_pdf once they approve it.",
      securitySchemes: [{ type: "noauth" }],
      _meta: noauth,
      inputSchema: {
        type: "object",
        properties: {
          company_name: { type: "string" },
          role_title: { type: "string" },
          job_ad: { type: "string", description: "Full job ad text" },
        },
        required: ["company_name", "role_title", "job_ad"],
      },
    },
    handler: async (args, { cvText, cvJson, preferences, contextFiles }) => ({
      content: [{ type: "text", text: tailorCV(args, cvText, preferences, contextFiles, cvJson) }],
    }),
  },
  {
    name: "generate_cover_letter",
    definition: {
      name: "generate_cover_letter",
      annotations: { title: "Generate cover letter", readOnlyHint: true, openWorldHint: false },
      description:
        "Draft a cover letter and/or answers to an application form's questions (pass them in application_questions), in the candidate's own voice. " +
        "Show the drafts to the user; once they're happy, save each in the application's Google Doc as its own section (update_application_doc, e.g. 'Cover letter', 'Application answers'), never as separate files.",
      securitySchemes: [{ type: "noauth" }],
      _meta: noauth,
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
          application_questions: {
            type: "string",
            description: "Questions from the application form to draft answers for, one per line (optional). Include any word or character limits.",
          },
          skip_cover_letter: {
            type: "boolean",
            description: "true = only answer application_questions, no cover letter.",
          },
        },
        required: ["company_name", "role_title", "job_ad"],
      },
    },
    handler: async (args, { cvText, preferences, contextFiles }) => ({
      content: [
        { type: "text", text: generateCoverLetter(args, cvText, preferences, contextFiles) },
      ],
    }),
  },
  {
    name: "prep_interview",
    definition: {
      name: "prep_interview",
      annotations: { title: "Prep interview", readOnlyHint: true, openWorldHint: true },
      description:
        "Generate comprehensive interview preparation materials for a company and role, including likely questions, research points, and talking points from your CV. Automatically includes any existing notes from the application doc. Show the prep to the user, then save it in the application's Google Doc (update_application_doc), never as a separate file.",
      securitySchemes: [{ type: "noauth" }],
      _meta: noauth,
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
    handler: async (args, { sheets, cvText, preferences, contextFiles }) => {
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
      return {
        content: [
          { type: "text", text: prepInterview(args, cvText, preferences, contextFiles, docContext) },
        ],
      };
    },
  },
];
