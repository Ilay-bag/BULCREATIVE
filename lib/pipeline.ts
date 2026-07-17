/**
 * Stateless pipeline steps — pure functions with no server-side job store.
 * Reused by short serverless-safe API routes; the CLIENT orchestrates the flow
 * and holds all state, so this works identically on a long-running server and
 * on Vercel serverless functions.
 */
import {
  BriefsResponseSchema,
  ChatActionSchema,
  CreativeAnalysisSchema,
  CreativeSpecSchema,
  PromptsResponseSchema,
  RewriteResponseSchema,
  ScoreSchema,
  type ChatAction,
  type CreativeAnalysis,
  type CreativeScore,
  type CreativeSpec,
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
  angleCategory: string;
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
  imageUrl?: string; // absent for from-scratch (text-to-image) creatives
  need: number;
  startIndex: number;
  usedAngles: string[];
  renderMode: RenderMode;
  platform?: string;
}): Promise<PlannedVariation[]> {
  const { analysis, imageUrl, need, startIndex, usedAngles, renderMode, platform } = params;
  const platformLine =
    platform && platform !== "free" ? `PLATFORM: ${platform} — apply its native look and safe zones.` : "";

  // 2a. briefs
  const briefsRes = await callMiniMaxJson(
    {
      system: systemPromptFor("02-variation-strategy", "platform-formats"),
      text: [
        platformLine,
        `Creative analysis JSON:\n${JSON.stringify(analysis)}`,
        `Produce exactly ${need} variation briefs, with ids v${startIndex}..v${startIndex + need - 1}.`,
        usedAngles.length
          ? `Marketing angles already used (do NOT repeat any of them): ${usedAngles.join(" | ")}`
          : "This is the first batch.",
        "Output only the JSON.",
      ].filter(Boolean).join("\n\n"),
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
      system: systemPromptFor("03-image-prompt-authoring", "platform-formats"),
      text: [
        `MODE: ${mode}`,
        platformLine,
        `Creative analysis JSON:\n${JSON.stringify(analysis)}`,
        `Variation briefs JSON:\n${JSON.stringify({ briefs })}`,
        `Write one generation prompt per brief (${briefs.length} total), following MODE "${mode}". Output only the JSON.`,
      ].filter(Boolean).join("\n\n"),
      thinking: false,
      maxTokens: 24000,
    },
    PromptsResponseSchema,
  );
  const byId = new Map(promptsRes.prompts.map((p) => [p.variationId, p.prompt]));

  return briefs.map((b, i) => ({
    id: b.id,
    angleCategory: b.angleCategory,
    marketingAngle: b.marketingAngle,
    angleRationale: b.angleRationale,
    visualChanges: b.visualChanges,
    // tolerate id drift: fall back to positional matching
    prompt: byId.get(b.id) ?? promptsRes.prompts[i]?.prompt ?? "",
  }));
}

/** Score a finished creative (image data URL) against the pre-spend scorecard. */
export async function scoreCreative(params: {
  imageDataUrl: string;
  analysis?: CreativeAnalysis;
  platform?: string;
}): Promise<CreativeScore> {
  return callMiniMaxJson<CreativeScore>(
    {
      system: systemPromptFor("creative-scorecard"),
      text: [
        params.platform && params.platform !== "free" ? `PLATFORM: ${params.platform}` : "",
        params.analysis
          ? `Context (the intended texts and concept):\n${JSON.stringify({
              product: params.analysis.product,
              texts: params.analysis.textBlocks.map((t) => t.text),
            })}`
          : "",
        "Score the attached creative. Output only the JSON.",
      ].filter(Boolean).join("\n\n"),
      imageUrl: params.imageDataUrl,
      thinking: false,
      maxTokens: 2000,
    },
    ScoreSchema,
  );
}

/**
 * Design a brand-new creative from a brief (optionally with a product photo).
 * Produces the copy (natural Hebrew, no AI tells), layout, palette and a
 * text-free background-plate prompt for generation.
 */
export async function designNew(params: {
  brief: string;
  productImageUrl?: string;
  aspectRatio?: string;
  platform?: string;
}): Promise<CreativeSpec> {
  const ratioHint = params.aspectRatio ? `Target aspect ratio: ${params.aspectRatio}.` : "";
  const platformHint =
    params.platform && params.platform !== "free"
      ? `PLATFORM: ${params.platform} — apply its native look, text budgets and safe zones.`
      : "";
  const productHint = params.productImageUrl
    ? "A product photo is attached — design the ad around this exact product as the hero."
    : "No product photo — design the product visual from scratch too.";
  return callMiniMaxJson<CreativeSpec>(
    {
      system: systemPromptFor("ad-design", "hebrew-copywriting", "platform-formats"),
      text: [
        platformHint,
        `Brief from the user:\n${params.brief}`,
        productHint,
        ratioHint,
        "Design the complete creative. Output only the JSON.",
      ].filter(Boolean).join("\n\n"),
      imageUrl: params.productImageUrl,
      thinking: true,
    },
    CreativeSpecSchema,
  );
}

/** Rewrite/scrub copy blocks: sharp marketing Hebrew with AI tells removed. */
export async function rewriteCopy(params: {
  blocks: { id: string; role: string; text: string }[];
  instruction?: string;
}): Promise<Record<string, string>> {
  const res = await callMiniMaxJson(
    {
      system: systemPromptFor("hebrew-copywriting"),
      text: [
        `Text blocks (keep ids):\n${JSON.stringify({ blocks: params.blocks })}`,
        params.instruction ? `User instruction: ${params.instruction}` : "",
        "Rewrite each block to be natural, human, sharp marketing copy with all AI tells removed. Output only the JSON.",
      ].filter(Boolean).join("\n\n"),
      thinking: false,
      maxTokens: 8000,
    },
    RewriteResponseSchema,
  );
  const map: Record<string, string> = {};
  for (const b of res.blocks) map[b.id] = b.text;
  return map;
}

/** The chat controller: a message + app state → a reply and one structured action. */
export async function chatControl(params: {
  messages: { role: "user" | "assistant"; content: string }[];
  state: unknown;
}): Promise<ChatAction> {
  const history = params.messages
    .map((m) => `${m.role === "user" ? "USER" : "ASSISTANT"}: ${m.content}`)
    .join("\n");
  return callMiniMaxJson<ChatAction>(
    {
      system: systemPromptFor("chat-controller"),
      text: [
        `Current app state:\n${JSON.stringify(params.state)}`,
        `Conversation so far:\n${history}`,
        "Reply to the latest USER message and choose one action. Output only the JSON.",
      ].join("\n\n"),
      thinking: false,
      maxTokens: 4000,
    },
    ChatActionSchema,
  );
}
