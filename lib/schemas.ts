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
  visualStyle: z.string(),
  marketingAngle: z.string(),
  aspectRatio: z.string().optional().default("1:1"),
});

export type CreativeAnalysis = z.infer<typeof CreativeAnalysisSchema>;

/* ---------- Skill 02 output: VariationBrief[] ---------- */

export const VariationBriefSchema = z.object({
  id: z.string(),
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
