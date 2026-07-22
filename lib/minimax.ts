/**
 * The pipeline's "thinking brain" via OpenRouter — Google Gemini 3 Flash by
 * default (native vision, 1M context, toggleable reasoning). Override with the
 * OPENROUTER_MODEL env var (any vision-capable OpenRouter slug).
 */
import { z } from "zod";
import { outboundFetch } from "./fetch";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.OPENROUTER_MODEL || "google/gemini-3-flash-preview";

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface MiniMaxCallOptions {
  system: string;
  /** user turn: plain text and/or an image as a data URL / https URL */
  text: string;
  imageUrl?: string;
  /** thinking mode: on for analysis/strategy, off for formatting steps */
  thinking: boolean;
  maxTokens?: number;
  /** override the model for this call (OpenRouter slug); defaults to Gemini 3 Flash */
  model?: string;
}

class MiniMaxError extends Error {}
/** A transient upstream/provider failure worth retrying (re-routes the request). */
class TransientProviderError extends MiniMaxError {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function singleCall(opts: MiniMaxCallOptions, includeReasoningParam: boolean): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new MiniMaxError("OPENROUTER_API_KEY is not set");

  const userContent: ContentPart[] = [];
  if (opts.imageUrl) userContent.push({ type: "image_url", image_url: { url: opts.imageUrl } });
  userContent.push({ type: "text", text: opts.text });

  const body: Record<string, unknown> = {
    model: opts.model ?? MODEL,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: userContent },
    ],
    max_tokens: opts.maxTokens ?? 16000,
    temperature: opts.thinking ? 0.7 : 0.3,
    // prefer the fastest available provider, but allow fallbacks when it fails
    provider: { sort: "throughput", allow_fallbacks: true },
  };
  if (includeReasoningParam) {
    // OpenRouter unified reasoning control; Gemini 3 Flash supports toggleable thinking.
    body.reasoning = opts.thinking ? { enabled: true } : { enabled: false, exclude: true };
  }

  const res = await outboundFetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/ilay-bag/bulcreative",
      "X-Title": "BULCREATIVE",
    },
    body: JSON.stringify(body),
  });

  const textBody = await res.text();
  if (!res.ok) {
    // Some providers reject the reasoning param — retry once without it.
    if (includeReasoningParam && res.status === 400 && /reason/i.test(textBody)) {
      return singleCall(opts, false);
    }
    // rate limits and 5xx are transient → let the retry wrapper re-route
    if (res.status === 429 || res.status >= 500) {
      throw new TransientProviderError(`OpenRouter ${res.status}: ${textBody.slice(0, 300)}`);
    }
    throw new MiniMaxError(`OpenRouter ${res.status}: ${textBody.slice(0, 500)}`);
  }

  let json: any;
  try {
    json = JSON.parse(textBody);
  } catch {
    throw new MiniMaxError(`OpenRouter returned non-JSON body: ${textBody.slice(0, 300)}`);
  }

  // A provider can fail *inside* a 200 response: choices[0].finish_reason === "error",
  // a per-choice error object, or a top-level error — all with content: null.
  const choice: any = json?.choices?.[0];
  const providerErr = choice?.error ?? json?.error;
  if (providerErr || choice?.finish_reason === "error") {
    const msg = providerErr?.message ?? "upstream provider error";
    throw new TransientProviderError(`OpenRouter provider error: ${String(msg).slice(0, 300)}`);
  }

  const content: string | undefined = choice?.message?.content;
  if (!content) {
    // empty content from a provider hiccup — retry rather than fail the whole pipeline
    throw new TransientProviderError(`OpenRouter response missing content: ${textBody.slice(0, 300)}`);
  }
  return content;
}

/** Call with automatic retry+re-route on transient provider failures. */
async function rawCall(opts: MiniMaxCallOptions, includeReasoningParam: boolean): Promise<string> {
  const delays = [800, 2000, 4500, 9000];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await singleCall(opts, includeReasoningParam);
    } catch (err) {
      lastErr = err;
      if (!(err instanceof TransientProviderError) || attempt === delays.length) throw err;
      await sleep(delays[attempt]);
    }
  }
  throw lastErr;
}

/** Strip inline <think> blocks and markdown fences, then extract the first JSON object/array. */
export function extractJson(raw: string): string {
  let s = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = s.search(/[{[]/);
  if (start === -1) throw new MiniMaxError(`No JSON found in model output: ${s.slice(0, 200)}`);
  // Walk to the matching close bracket (string-aware).
  const open = s[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  throw new MiniMaxError(`Unbalanced JSON in model output: ${s.slice(0, 200)}`);
}

/**
 * Call MiniMax M3 and parse+validate its JSON output against a Zod schema.
 * On validation failure, retries once with the validation error as feedback.
 */
export async function callMiniMaxJson<T>(
  opts: MiniMaxCallOptions,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: z.ZodType<T, any, any>,
): Promise<T> {
  const attempt = async (extra: string): Promise<T> => {
    const raw = await rawCall({ ...opts, text: opts.text + extra }, true);
    const jsonText = extractJson(raw);
    const parsed = JSON.parse(jsonText);
    return schema.parse(parsed);
  };

  try {
    return await attempt("");
  } catch (firstErr) {
    const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
    return attempt(
      `\n\nIMPORTANT: Your previous answer failed validation with this error:\n${msg.slice(0, 800)}\nAnswer again with ONLY a valid JSON object matching the required schema exactly.`,
    );
  }
}
