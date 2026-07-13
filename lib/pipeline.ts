/**
 * Stateless pipeline steps — pure functions with no server-side job store.
 * Reused by short serverless-safe API routes; the CLIENT orchestrates the flow
 * and holds all state, so this works identically on a long-running server and
 * on Vercel serverless functions.
 */
import {
  BriefsResponseSchema,
  CreativeAnalysisSchema,
  PromptsResponseSchema,
  type CreativeAnalysis,
  type RenderMode,
  type TextMode,
} from "./schemas";
import { callMiniMaxJson } from "./minimax";
import { systemPromptFor } from "./skills";
import { HEBREW_RE } from "./fonts";

/** Aspect ratios KIE's gpt-image-2 accepts. "auto" does NOT preserve source ratio. */
const KIE_ASPECT_RATIOS = new Set([
  "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5",
  "16:9", "9:16", "2:1", "1:2", "3:1", "1:3", "21:9", "9:21",
]);

export function toKieAspectRatio(analyzed: string | undefined): string {
  const norm = (analyzed ?? "").trim();
  return KIE_ASPECT_RATIOS.has(norm) ? norm : "auto";
}

export function detectHebrew(analysis: CreativeAnalysis): boolean {
  return analysis.textBlocks.some((t) => HEBREW_RE.test(t.text));
}

/** auto → overlay when Hebrew present (image models garble Hebrew), else gpt. */
export function resolveRenderMode(textMode: TextMode, hasHebrew: boolean): RenderMode {
  if (textMode === "auto") return hasHebrew ? "overlay" : "gpt";
  return textMode;
}

/** Step 1: scan a creative (data URL or public image URL) into structured JSON. */
export async function analyzeCreative(imageUrl: string): Promise<CreativeAnalysis> {
  return callMiniMaxJson<CreativeAnalysis>(
    {
      system: systemPromptFor("01-analyze-creative"),
      text: "Analyze this marketing creative. Output only the JSON.",
      imageUrl,
      thinking: true,
    },
    CreativeAnalysisSchema,
  );
}

export interface PlannedVariation {
  id: string;
  marketingAngle: string;
  angleRationale: string;
  visualChanges: string[];
  prompt: string;
}

/**
 * Step 2 (one chunk): produce up to `need` variation briefs AND their generation
 * prompts, so the client can call this repeatedly to reach large bulk counts
 * while each request stays short enough for a serverless time limit.
 */
export async function planChunk(params: {
  analysis: CreativeAnalysis;
  imageUrl: string;
  need: number;
  startIndex: number;
  usedAngles: string[];
  renderMode: RenderMode;
}): Promise<PlannedVariation[]> {
  const { analysis, imageUrl, need, startIndex, usedAngles, renderMode } = params;

  // 2a. briefs
  const briefsRes = await callMiniMaxJson(
    {
      system: systemPromptFor("02-variation-strategy"),
      text: [
        `Creative analysis JSON:\n${JSON.stringify(analysis)}`,
        `Produce exactly ${need} variation briefs, with ids v${startIndex}..v${startIndex + need - 1}.`,
        usedAngles.length
          ? `Marketing angles already used (do NOT repeat any of them): ${usedAngles.join(" | ")}`
          : "This is the first batch.",
        "Output only the JSON.",
      ].join("\n\n"),
      imageUrl,
      thinking: true,
    },
    BriefsResponseSchema,
  );
  const briefs = briefsRes.briefs.slice(0, need).map((b, i) => ({
    ...b,
    id: `v${startIndex + i}`,
  }));

  // 2b. prompts for those briefs
  const mode = renderMode === "overlay" ? "background-plate" : "full";
  const promptsRes = await callMiniMaxJson(
    {
      system: systemPromptFor("03-image-prompt-authoring"),
      text: [
        `MODE: ${mode}`,
        `Creative analysis JSON:\n${JSON.stringify(analysis)}`,
        `Variation briefs JSON:\n${JSON.stringify({ briefs })}`,
        `Write one generation prompt per brief (${briefs.length} total), following MODE "${mode}". Output only the JSON.`,
      ].join("\n\n"),
      thinking: false,
      maxTokens: 24000,
    },
    PromptsResponseSchema,
  );
  const byId = new Map(promptsRes.prompts.map((p) => [p.variationId, p.prompt]));

  return briefs.map((b, i) => ({
    id: b.id,
    marketingAngle: b.marketingAngle,
    angleRationale: b.angleRationale,
    visualChanges: b.visualChanges,
    // tolerate id drift: fall back to positional matching
    prompt: byId.get(b.id) ?? promptsRes.prompts[i]?.prompt ?? "",
  }));
}
