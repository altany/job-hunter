import { promptTools } from "./prompts.js";
import { trackerTools } from "./tracker.js";

/**
 * The tool registry. To add a new tool, create `{ name, definition, handler }`
 * (in an existing file or a new one) and include it here. `definition` is the
 * MCP tool schema; `handler(args, ctx)` returns the MCP result, where `ctx` is
 * `{ config, sheets, cvText, preferences, contextFiles }`.
 *
 * Rules and extra context are loaded from `context/*.md` and the candidate
 * `preferences` — see createServer.js — so you can grow the prompt guidance
 * without touching any tool code.
 */
export const tools = [...promptTools, ...trackerTools];

export const toolsByName = Object.fromEntries(tools.map((t) => [t.name, t]));
