import fs from "node:fs";
import path from "node:path";

const SKILLS_DIR = path.join(process.cwd(), "skills");

const cache = new Map<string, string>();

/** Load a skill markdown file (cached). Name is relative to /skills, without extension. */
export function loadSkill(name: string): string {
  const cached = cache.get(name);
  if (cached) return cached;
  const filePath = path.join(SKILLS_DIR, `${name}.md`);
  const content = fs.readFileSync(filePath, "utf-8");
  cache.set(name, content);
  return content;
}

/** Compose a system prompt: shared guardrails + the step's skill. */
export function systemPromptFor(skillName: string): string {
  return [loadSkill("_shared/style-guardrails"), loadSkill(skillName)].join("\n\n---\n\n");
}
