import { z } from "zod";

/* ---------- Skill 01 output: CreativeAnalysis ---------- */

export const BBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

export const FontSchema = z.object({
  likelyFamily: z.string(),
  category: z.string(),
  weight: z.string(),
  case: z.string().optional().default("mixed"),
  letterSpacing: z.string().optional().default("normal"),
  italic: z.boolean().optional().default(false),
});

export const TextBlockSchema = z.object({
  id: z.string(),
  text: z.string(),
  role: z.string(),
  language: z.string().optional().default("en"),
  font: FontSchema,
  color: z.string().optional().default("#000000"),
  bbox: BBoxSchema,
});

/** What the creative is promoting — drives which marketing ideas fit. */
export const OFFER_TYPES = [
  "product", "collection", "flash-sale", "sale", "launch", "brand",
] as const;
export type OfferType = (typeof OFFER_TYPES)[number];

/** A concrete, design-actionable idea for marketing the offer shown. */
export const MarketingIdeaSchema = z.object({
  title: z.string(),
  idea: z.string(),
});
export type MarketingIdea = z.infer<typeof MarketingIdeaSchema>;

/** An alternative selling point (USP) the creative could lead with instead. */
export const SellingPointSchema = z.object({
  point: z.string(),
  why: z.string().optional().default(""),
});
export type SellingPoint = z.infer<typeof SellingPointSchema>;

export const CreativeAnalysisSchema = z.object({
  textBlocks: z.array(TextBlockSchema),
  product: z.string(),
  category: z.string(),
  brand: z
    .object({
      name: z.string().nullable().optional(),
      logoDescription: z.string().nullable().optional(),
      logoBbox: BBoxSchema.nullable().optional(),
    })
    .optional()
    .default({}),
  colors: z.array(z.string()).default([]),
  toneOfVoice: z.string().optional().default(""),
  visualStyle: z.string(),
  marketingAngle: z.string(),
  aspectRatio: z.string().optional().default("1:1"),
  offerType: z.enum(OFFER_TYPES).catch("product").optional().default("product"),
  marketingIdeas: z.array(MarketingIdeaSchema).optional().default([]),
  sellingPoints: z.array(SellingPointSchema).optional().default([]),
});

export type CreativeAnalysis = z.infer<typeof CreativeAnalysisSchema>;

/* ---------- Skill 02 output: VariationBrief[] ---------- */

export const ANGLE_CATEGORIES = [
  "pain", "outcome", "social-proof", "curiosity",
  "comparison", "urgency", "identity", "contrarian",
] as const;

export const VariationBriefSchema = z.object({
  id: z.string(),
  angleCategory: z.enum(ANGLE_CATEGORIES).catch("outcome"),
  marketingAngle: z.string(),
  angleRationale: z.string().optional().default(""),
  visualChanges: z.array(z.string()).min(1),
  keepText: z.literal(true).catch(true),
  keepFonts: z.literal(true).catch(true),
});

export const BriefsResponseSchema = z.object({
  briefs: z.array(VariationBriefSchema).min(1),
});

export type VariationBrief = z.infer<typeof VariationBriefSchema>;

/* ---------- Skill 03 output: ImagePrompt[] ---------- */

export const ImagePromptSchema = z.object({
  variationId: z.string(),
  prompt: z.string().min(40),
});

export const PromptsResponseSchema = z.object({
  prompts: z.array(ImagePromptSchema).min(1),
});

export type ImagePrompt = z.infer<typeof ImagePromptSchema>;

/* ---------- ad-design skill output: a creative built from scratch ---------- */

export const CreativeSpecSchema = CreativeAnalysisSchema.extend({
  platePrompt: z.string().min(20),
});
export type CreativeSpec = z.infer<typeof CreativeSpecSchema>;

/* ---------- hebrew-copywriting skill output: rewritten blocks ---------- */

export const RewriteResponseSchema = z.object({
  blocks: z.array(z.object({ id: z.string(), text: z.string() })).min(1),
});

/* ---------- creative-scorecard skill output ---------- */

export const ScoreSchema = z.object({
  hook: z.number().min(0).max(10),
  hierarchy: z.number().min(0).max(10),
  cta: z.number().min(0).max(10),
  legibility: z.number().min(0).max(10),
  total: z.number().min(0).max(10),
  verdict: z.string().optional().default(""),
});
export type CreativeScore = z.infer<typeof ScoreSchema>;

/* ---------- platform presets ---------- */

export const PLATFORMS = ["meta-feed", "story", "tiktok", "linkedin", "free"] as const;
export type Platform = (typeof PLATFORMS)[number];

/* ---------- chat-controller skill output: reply + one action ---------- */

export const ChatActionSchema = z.object({
  reply: z.string(),
  action: z
    .object({
      type: z.enum([
        "new_creative",
        "make_variations",
        "set_count",
        "set_text_mode",
        "set_platform",
        "rewrite_copy",
        "edit_text",
        "regenerate",
        "reset",
        "none",
      ]),
      params: z.record(z.string(), z.any()).optional().default({}),
    })
    .optional()
    .default({ type: "none", params: {} }),
});
export type ChatAction = z.infer<typeof ChatActionSchema>;

/* ---------- Job state (server -> client) ---------- */

export type VariationStatus =
  | "planned"
  | "prompted"
  | "submitted"
  | "generating"
  | "done"
  | "failed";

/**
 * How final text gets onto the image:
 * - "gpt": GPT Image 2 renders the text itself (good for Latin scripts)
 * - "overlay": GPT Image 2 renders a text-free background plate and we composite
 *   the exact original text with real fonts (pixel-perfect; REQUIRED for Hebrew)
 * - "auto": overlay when Hebrew is detected, gpt otherwise
 */
export type TextMode = "auto" | "overlay" | "gpt";
export type RenderMode = "gpt" | "overlay";

export interface VariationState {
  id: string;
  marketingAngle: string;
  angleRationale: string;
  visualChanges: string[];
  prompt?: string;
  kieTaskId?: string;
  status: VariationStatus;
  error?: string;
  /** set when the image has been downloaded to local disk */
  imageReady: boolean;
  retries: number;
}

export type JobStep =
  | "uploading"
  | "analyzing"
  | "review"
  | "planning"
  | "prompting"
  | "generating"
  | "done"
  | "failed";

export interface JobState {
  id: string;
  createdAt: number;
  step: JobStep;
  error?: string;
  requestedCount: number;
  originalFileName: string;
  /** what the user asked for */
  textMode: TextMode;
  /** resolved after analysis (auto → overlay for Hebrew, gpt otherwise) */
  renderMode?: RenderMode;
  /** true when Hebrew was detected in the creative's text */
  hasHebrew?: boolean;
  /** public URL of the original creative on KIE storage (24h) */
  kieSourceUrl?: string;
  analysis?: CreativeAnalysis;
  variations: VariationState[];
}
