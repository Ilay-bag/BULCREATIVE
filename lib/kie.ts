/**
 * KIE.AI wrapper — GPT Image 2 (image-to-image, 2K) + file upload + task polling.
 * Docs: https://docs.kie.ai
 */
import { outboundFetch } from "./fetch";

const CREATE_TASK_URL = "https://api.kie.ai/api/v1/jobs/createTask";
const RECORD_INFO_URL = "https://api.kie.ai/api/v1/jobs/recordInfo";
const FILE_UPLOAD_BASE64_URL = "https://kieai.redpandaai.co/api/file-base64-upload";

const IMAGE_MODEL = "gpt-image-2-image-to-image";

function apiKey(): string {
  const key = process.env.KIE_API_KEY;
  if (!key) throw new Error("KIE_API_KEY is not set");
  return key;
}

export class KieRateLimitError extends Error {}
export class KieCreditsError extends Error {}

/** Upload the original creative to KIE temp storage (24h) to get a public URL. */
export async function uploadImageBase64(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<string> {
  const res = await outboundFetch(FILE_UPLOAD_BASE64_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      base64Data: `data:${mimeType};base64,${buffer.toString("base64")}`,
      uploadPath: "bulcreative",
      fileName,
    }),
  });
  const body: any = await res.json().catch(() => ({}));
  const url: string | undefined = body?.data?.downloadUrl || body?.data?.fileUrl;
  if (!res.ok || !url) {
    throw new Error(`KIE file upload failed (${res.status}): ${JSON.stringify(body).slice(0, 400)}`);
  }
  return url;
}

/** Create a GPT Image 2 image-to-image task. Returns the KIE taskId. */
export async function createImageTask(params: {
  prompt: string;
  sourceUrl: string;
  aspectRatio?: string;
}): Promise<string> {
  const res = await outboundFetch(CREATE_TASK_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      input: {
        prompt: params.prompt,
        input_urls: [params.sourceUrl],
        aspect_ratio: params.aspectRatio ?? "auto",
        resolution: "2K",
      },
    }),
  });
  if (res.status === 429) throw new KieRateLimitError("KIE rate limit (429)");
  const body: any = await res.json().catch(() => ({}));
  if (body?.code === 402) {
    throw new KieCreditsError("אין מספיק קרדיטים בחשבון KIE — יש להטעין יתרה ב-kie.ai");
  }
  const taskId: string | undefined = body?.data?.taskId;
  if (!res.ok || body?.code !== 200 || !taskId) {
    throw new Error(`KIE createTask failed (${res.status}): ${JSON.stringify(body).slice(0, 400)}`);
  }
  return taskId;
}

export interface KieTaskInfo {
  state: "waiting" | "queuing" | "generating" | "success" | "fail";
  resultUrls: string[];
  failMsg?: string;
}

/** Poll a task's state. */
export async function getTaskInfo(taskId: string): Promise<KieTaskInfo> {
  const res = await outboundFetch(`${RECORD_INFO_URL}?taskId=${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  if (res.status === 429) throw new KieRateLimitError("KIE rate limit (429)");
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || body?.code !== 200) {
    throw new Error(`KIE recordInfo failed (${res.status}): ${JSON.stringify(body).slice(0, 400)}`);
  }
  const data = body.data ?? {};
  let resultUrls: string[] = [];
  if (data.resultJson) {
    try {
      const parsed = JSON.parse(data.resultJson);
      if (Array.isArray(parsed?.resultUrls)) resultUrls = parsed.resultUrls;
    } catch {
      /* tolerate malformed resultJson; treated as no results yet */
    }
  }
  return { state: data.state, resultUrls, failMsg: data.failMsg || data.failCode || undefined };
}

/** PNG / JPEG / WebP magic numbers — guards against downloading an error page. */
function looksLikeImage(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  const hex4 = buf.subarray(0, 4).toString("hex");
  if (hex4 === "89504e47") return true; // PNG
  if (hex4.startsWith("ffd8")) return true; // JPEG
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP")
    return true; // WebP
  return false;
}

/**
 * Download a generated image (KIE URLs expire in ~20 minutes — call promptly).
 * Retries transient failures and validates the bytes are a real image, so a
 * momentary bad response can't poison the overlay/compositing step.
 */
export async function downloadImage(url: string): Promise<Buffer> {
  const backoffs = [1000, 2000, 4000, 6000]; // ~13s of transient tolerance across 5 tries
  let lastErr = "";
  for (let attempt = 0; attempt <= backoffs.length; attempt++) {
    try {
      const res = await outboundFetch(url);
      if (!res.ok) {
        lastErr = `HTTP ${res.status}`;
      } else {
        const buf = Buffer.from(await res.arrayBuffer());
        if (looksLikeImage(buf)) return buf;
        lastErr = `unexpected content (${buf.length}B, magic ${buf.subarray(0, 4).toString("hex")})`;
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    if (attempt < backoffs.length) await new Promise((r) => setTimeout(r, backoffs[attempt]));
  }
  throw new Error(`Image download failed (${lastErr}) from ${url.slice(0, 120)}`);
}
