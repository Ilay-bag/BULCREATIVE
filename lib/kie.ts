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

/** Download a generated image (KIE URLs expire in ~20 minutes — call promptly). */
export async function downloadImage(url: string): Promise<Buffer> {
  const res = await outboundFetch(url);
  if (!res.ok) throw new Error(`Image download failed (${res.status}) from ${url.slice(0, 120)}`);
  return Buffer.from(await res.arrayBuffer());
}
