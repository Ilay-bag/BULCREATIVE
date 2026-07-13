/**
 * MiniMax M3 via OpenRouter — the "thinking brain" of the pipeline.
 * Supports native vision (image input) and toggleable thinking mode.
 */
import { z } from "zod";
import { outboundFetch } from "./fetch";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "minimax/minimax-m3";

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
}

class MiniMaxError extends Error {}

async function rawCall(opts: MiniMaxCallOptions, includeReasoningParam: boolean): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new MiniMaxError("OPENROUTER_API_KEY is not set");

  const userContent: ContentPart[] = [];
  if (opts.imageUrl) userContent.push({ type: "image_url", image_url: { url: opts.imageUrl } });
  userContent.push({ type: "text", text: opts.text });

  const body: Record<string, unknown> = {
    model: MODEL,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: userContent },
    ],
    max_tokens: opts.maxTokens ?? 16000,
    temperature: opts.thinking ? 0.7 : 0.3,
  };
  if (includeReasoningParam) {
    // OpenRouter unified reasoning control; MiniMax M3 supports toggleable thinking.
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
      return rawCall(opts, false);
    }
    throw new MiniMaxError(`OpenRouter ${res.status}: ${textBody.slice(0, 500)}`);
  }

  let json: any;
  try {
    json = JSON.parse(textBody);
  } catch {
    throw new MiniMaxError(`OpenRouter returned non-JSON body: ${textBody.slice(0, 300)}`);
  }
  const content: string | undefined = json?.choices?.[0]?.message?.content;
  if (!content) {
    throw new MiniMaxError(`OpenRouter response missing content: ${textBody.slice(0, 500)}`);
  }
  return content;
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
