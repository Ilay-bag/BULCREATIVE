/**
 * BULK CREATIVE machine — job store + pipeline orchestrator.
 *
 * Pipeline: ANALYZE (vision, thinking) -> STRATEGY (briefs, thinking)
 *        -> PROMPT (per-variation prompts) -> GENERATE (KIE, batched)
 *        -> immediate download of every result (KIE URLs expire in ~20min).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  BriefsResponseSchema,
  CreativeAnalysisSchema,
  PromptsResponseSchema,
  type CreativeAnalysis,
  type JobState,
  type TextMode,
  type VariationBrief,
  type VariationState,
} from "./schemas";
import { overlayTexts } from "./overlay";
import { HEBREW_RE } from "./fonts";
import { callMiniMaxJson } from "./minimax";
import { systemPromptFor } from "./skills";
import {
  createImageTask,
  downloadImage,
  getTaskInfo,
  KieRateLimitError,
  uploadImageBase64,
} from "./kie";

const DATA_DIR = path.join(process.cwd(), ".data", "jobs");

/** How many briefs/prompts to request from the model per call (JSON reliability). */
const BRIEF_CHUNK = 10;
/** Gap between KIE createTask calls — stays well under 20 req / 10s. */
const CREATE_GAP_MS = 700;
/** Poll cycle for pending KIE tasks. */
const POLL_INTERVAL_MS = 5000;
/** Max automatic regenerations for a failed variation. */
const MAX_RETRIES = 2;
/** Pause before resubmitting a failed variation (KIE "Internal Error" is often transient). */
const RETRY_DELAY_MS = 4000;

/* ---------- store (in-memory cache backed by on-disk state.json) ---------- */

const g = globalThis as unknown as { __bulcreativeJobs?: Map<string, JobState> };
const jobs: Map<string, JobState> = (g.__bulcreativeJobs ??= new Map());

export function jobDir(id: string): string {
  return path.join(DATA_DIR, id);
}

export function resultPath(jobId: string, variationId: string): string {
  return path.join(jobDir(jobId), "results", `${variationId}.png`);
}

function stateFile(id: string): string {
  return path.join(jobDir(id), "state.json");
}

/** JobState is fully JSON-serializable — persist it so restarts don't lose jobs. */
export function saveJob(job: JobState): void {
  try {
    fs.writeFileSync(stateFile(job.id), JSON.stringify(job));
  } catch {
    /* best-effort: an unwritable disk must not crash the pipeline */
  }
}

const RUNNING_STEPS = new Set(["analyzing", "planning", "prompting", "generating"]);

function loadJobFromDisk(id: string): JobState | undefined {
  let job: JobState;
  try {
    job = JSON.parse(fs.readFileSync(stateFile(id), "utf-8")) as JobState;
  } catch {
    return undefined;
  }
  // The in-memory pipeline cannot survive a process restart. If a persisted job
  // was still mid-flight, it can never resume in this process — surface that
  // honestly instead of letting the UI spin forever, while keeping any images
  // that already finished and were written to disk.
  if (RUNNING_STEPS.has(job.step)) {
    for (const v of job.variations) {
      if (v.status !== "done" && v.status !== "failed") {
        v.status = "failed";
        v.error = "השרת הופעל מחדש באמצע הריצה — צור מחדש";
      }
    }
    const anyDone = job.variations.some((v) => v.status === "done");
    job.step = anyDone ? "done" : "failed";
    if (!job.error) job.error = "השרת הופעל מחדש באמצע הריצה";
  }
  return job;
}

export function getJob(id: string): JobState | undefined {
  const inMem = jobs.get(id);
  if (inMem) return inMem;
  // cache miss (e.g. after a restart) — rehydrate from disk
  const fromDisk = loadJobFromDisk(id);
  if (fromDisk) {
    jobs.set(id, fromDisk);
    saveJob(fromDisk); // persist the restart-reconciled state
    return fromDisk;
  }
  return undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Aspect ratios KIE's gpt-image-2 accepts. "auto" does NOT reliably preserve the source ratio. */
const KIE_ASPECT_RATIOS = new Set([
  "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5",
  "16:9", "9:16", "2:1", "1:2", "3:1", "1:3", "21:9", "9:21",
]);

function toKieAspectRatio(analyzed: string | undefined): string {
  const norm = (analyzed ?? "").trim();
  return KIE_ASPECT_RATIOS.has(norm) ? norm : "auto";
}

/* ---------- job creation ---------- */

export function createJob(params: {
  originalFileName: string;
  buffer: Buffer;
  mimeType: string;
  count: number;
  textMode?: TextMode;
}): JobState {
  const id = crypto.randomBytes(8).toString("hex");
  const dir = jobDir(id);
  fs.mkdirSync(path.join(dir, "results"), { recursive: true });
  const originalPath = path.join(dir, "original");
  fs.writeFileSync(originalPath, params.buffer);
  fs.writeFileSync(path.join(dir, "mime.txt"), params.mimeType);

  const job: JobState = {
    id,
    createdAt: Date.now(),
    step: "analyzing",
    requestedCount: Math.min(Math.max(params.count, 1), 40),
    originalFileName: params.originalFileName,
    textMode: params.textMode ?? "auto",
    variations: [],
  };
  jobs.set(id, job);
  saveJob(job);

  // fire-and-forget; state is observed via polling GET /api/jobs/[id]
  runPipeline(job, params.buffer, params.mimeType).catch((err) => {
    job.step = "failed";
    job.error = err instanceof Error ? err.message : String(err);
    saveJob(job);
  });

  return job;
}

export function readOriginal(jobId: string): { buffer: Buffer; mimeType: string } | undefined {
  const dir = jobDir(jobId);
  try {
    return {
      buffer: fs.readFileSync(path.join(dir, "original")),
      mimeType: fs.readFileSync(path.join(dir, "mime.txt"), "utf-8").trim(),
    };
  } catch {
    return undefined;
  }
}

/* ---------- pipeline ---------- */

async function runPipeline(job: JobState, buffer: Buffer, mimeType: string): Promise<void> {
  const dataUrl = `data:${mimeType};base64,${buffer.toString("base64")}`;

  // 1. ANALYZE + upload source to KIE, in parallel
  job.step = "analyzing";
  const [analysis, kieSourceUrl] = await Promise.all([
    callMiniMaxJson<CreativeAnalysis>(
      {
        system: systemPromptFor("01-analyze-creative"),
        text: "Analyze this marketing creative. Output only the JSON.",
        imageUrl: dataUrl,
        thinking: true,
      },
      CreativeAnalysisSchema,
    ),
    uploadImageBase64(buffer, mimeType, `source-${job.id}.png`),
  ]);
  job.analysis = analysis;
  job.kieSourceUrl = kieSourceUrl;

  // Hebrew detection decides the render mode: image models garble Hebrew glyphs,
  // so Hebrew creatives always get the pixel-perfect overlay path in "auto".
  job.hasHebrew = analysis.textBlocks.some((t) => HEBREW_RE.test(t.text));
  job.renderMode =
    job.textMode === "auto" ? (job.hasHebrew ? "overlay" : "gpt") : job.textMode;
  saveJob(job);

  // 2. STRATEGY — briefs in chunks (JSON reliability at bulk sizes)
  job.step = "planning";
  const briefs = await generateBriefs(job, analysis, dataUrl);
  job.variations = briefs.map<VariationState>((b) => ({
    id: b.id,
    marketingAngle: b.marketingAngle,
    angleRationale: b.angleRationale,
    visualChanges: b.visualChanges,
    status: "planned",
    imageReady: false,
    retries: 0,
  }));
  saveJob(job);

  // 3. PROMPT — per-chunk prompt authoring (thinking off: fast, formatting task)
  job.step = "prompting";
  await authorPrompts(job, analysis, briefs);
  saveJob(job);

  // 4. GENERATE — batched submission + centralized polling + immediate download
  job.step = "generating";
  await generateAll(job, analysis);

  const anyDone = job.variations.some((v) => v.status === "done");
  job.step = anyDone ? "done" : "failed";
  if (!anyDone) job.error = "כל הווריאציות נכשלו בייצור — ראה שגיאות פרטניות";
  saveJob(job);
}

async function generateBriefs(
  job: JobState,
  analysis: CreativeAnalysis,
  imageDataUrl: string,
): Promise<VariationBrief[]> {
  const all: VariationBrief[] = [];
  const total = job.requestedCount;
  // cap iterations so a model that under-delivers can't loop forever
  const maxRounds = Math.ceil(total / BRIEF_CHUNK) + 3;
  for (let round = 0; all.length < total && round < maxRounds; round++) {
    const need = Math.min(BRIEF_CHUNK, total - all.length);
    const usedAngles = all.map((b) => b.marketingAngle);
    const startIndex = all.length + 1;
    const res = await callMiniMaxJson(
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
        imageUrl: imageDataUrl,
        thinking: true,
      },
      BriefsResponseSchema,
    );
    // normalize ids to the expected sequence regardless of what the model returned
    res.briefs.slice(0, need).forEach((b, i) => {
      all.push({ ...b, id: `v${startIndex + i}` });
    });
  }
  return all.slice(0, total);
}

async function authorPrompts(
  job: JobState,
  analysis: CreativeAnalysis,
  briefs: VariationBrief[],
): Promise<void> {
  for (let i = 0; i < briefs.length; i += BRIEF_CHUNK) {
    const chunk = briefs.slice(i, i + BRIEF_CHUNK);
    const mode = job.renderMode === "overlay" ? "background-plate" : "full";
    const res = await callMiniMaxJson(
      {
        system: systemPromptFor("03-image-prompt-authoring"),
        text: [
          `MODE: ${mode}`,
          `Creative analysis JSON:\n${JSON.stringify(analysis)}`,
          `Variation briefs JSON:\n${JSON.stringify({ briefs: chunk })}`,
          `Write one generation prompt per brief (${chunk.length} total), following MODE "${mode}". Output only the JSON.`,
        ].join("\n\n"),
        thinking: false,
        maxTokens: 24000,
      },
      PromptsResponseSchema,
    );
    const byId = new Map(res.prompts.map((p) => [p.variationId, p.prompt]));
    for (const [j, brief] of chunk.entries()) {
      const v = job.variations.find((x) => x.id === brief.id)!;
      // tolerate id drift: fall back to positional matching
      v.prompt = byId.get(brief.id) ?? res.prompts[j]?.prompt;
      if (v.prompt) v.status = "prompted";
      else {
        v.status = "failed";
        v.error = "המודל לא החזיר prompt לווריאציה הזו";
      }
    }
  }
}

async function generateAll(job: JobState, analysis: CreativeAnalysis): Promise<void> {
  // submit all prompted variations, spaced to respect KIE rate limits
  for (const v of job.variations) {
    if (v.status !== "prompted") continue;
    await submitVariation(job, v);
    saveJob(job);
    await sleep(CREATE_GAP_MS);
  }

  // centralized polling until every variation reaches a terminal state
  const deadline = Date.now() + 30 * 60 * 1000; // 30 min safety cap
  while (Date.now() < deadline) {
    const pending = job.variations.filter(
      (v) => v.status === "submitted" || v.status === "generating",
    );
    if (pending.length === 0) break;

    for (const v of pending) {
      try {
        const info = await getTaskInfo(v.kieTaskId!);
        if (info.state === "success" && info.resultUrls[0]) {
          // download IMMEDIATELY — result URLs expire in ~20 minutes
          let img = await downloadImage(info.resultUrls[0]);
          if (job.renderMode === "overlay") {
            // composite the EXACT original texts with real fonts (pixel-perfect)
            img = await overlayTexts(img, analysis);
          }
          fs.writeFileSync(resultPath(job.id, v.id), img);
          v.imageReady = true;
          v.status = "done";
          saveJob(job); // persist as soon as an image lands, so a restart keeps it
        } else if (info.state === "fail") {
          if (v.retries < MAX_RETRIES) {
            v.retries += 1;
            await sleep(RETRY_DELAY_MS);
            await submitVariation(job, v);
          } else {
            v.status = "failed";
            v.error = info.failMsg ?? "הייצור נכשל ב-KIE";
            saveJob(job);
          }
        } else if (info.state === "generating") {
          v.status = "generating";
        }
      } catch (err) {
        if (err instanceof KieRateLimitError) {
          await sleep(10_000);
          break; // restart the poll cycle after backing off
        }
        // transient poll/download error — keep the variation pending for the next cycle
      }
      await sleep(200);
    }
    await sleep(POLL_INTERVAL_MS);
  }

  // anything still pending at the deadline is marked failed
  for (const v of job.variations) {
    if (v.status === "submitted" || v.status === "generating") {
      v.status = "failed";
      v.error = "חריגה מזמן ההמתנה המקסימלי לייצור";
    }
  }
  saveJob(job);
}

async function submitVariation(job: JobState, v: VariationState): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      v.kieTaskId = await createImageTask({
        prompt: v.prompt!,
        sourceUrl: job.kieSourceUrl!,
        // match the original creative's ratio (from analysis); fall back to auto
        aspectRatio: toKieAspectRatio(job.analysis?.aspectRatio),
      });
      v.status = "submitted";
      return;
    } catch (err) {
      if (err instanceof KieRateLimitError && attempt < 3) {
        await sleep(2000 * 2 ** attempt); // 2s, 4s, 8s
        continue;
      }
      v.status = "failed";
      v.error = err instanceof Error ? err.message : String(err);
      return;
    }
  }
}

/* ---------- client-facing serialization ---------- */

export function serializeJob(job: JobState) {
  const doneCount = job.variations.filter((v) => v.status === "done").length;
  return {
    id: job.id,
    step: job.step,
    error: job.error,
    requestedCount: job.requestedCount,
    doneCount,
    renderMode: job.renderMode,
    hasHebrew: job.hasHebrew,
    analysis: job.analysis
      ? {
          product: job.analysis.product,
          category: job.analysis.category,
          marketingAngle: job.analysis.marketingAngle,
          textBlocks: job.analysis.textBlocks.map((t) => ({
            text: t.text,
            role: t.role,
            font: t.font.likelyFamily,
          })),
        }
      : undefined,
    variations: job.variations.map((v) => ({
      id: v.id,
      marketingAngle: v.marketingAngle,
      angleRationale: v.angleRationale,
      visualChanges: v.visualChanges,
      status: v.status,
      error: v.error,
      imageReady: v.imageReady,
      imageUrl: v.imageReady ? `/api/jobs/${job.id}/images/${v.id}` : undefined,
    })),
  };
}
