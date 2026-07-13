import fs from "node:fs";
import path from "node:path";

const SKILLS_DIR = path.join(process.cwd(), "skills");

const cache = new Map<string, string>();

/**
 * Load a skill markdown file. Name is relative to /skills, without extension.
 * Cached in production; in dev it always reads from disk so editing a skill
 * takes effect on the very next request.
 */
export function loadSkill(name: string): string {
  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    const cached = cache.get(name);
    if (cached) return cached;
  }
  const filePath = path.join(SKILLS_DIR, `${name}.md`);
  const content = fs.readFileSync(filePath, "utf-8");
  if (isProd) cache.set(name, content);
  return content;
}

/** Compose a system prompt: shared guardrails + the step's skill. */
export function systemPromptFor(skillName: string): string {
  return [loadSkill("_shared/style-guardrails"), loadSkill(skillName)].join("\n\n---\n\n");
}
