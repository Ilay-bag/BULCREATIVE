import { NextRequest, NextResponse } from "next/server";
import { uploadImageBase64 } from "@/lib/kie";
import { analyzeCreative, detectHebrew, resolveRenderMode } from "@/lib/pipeline";
import type { TextMode } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_UPLOAD_BYTES = 9 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  const textModeRaw = String(form.get("textMode") ?? "auto");
  const textMode: TextMode = (["auto", "overlay", "gpt"] as const).includes(textModeRaw as never)
    ? (textModeRaw as TextMode)
    : "auto";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "חסר קובץ קריאייטיב" }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: "פורמט לא נתמך — העלה PNG / JPEG / WebP" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "הקובץ גדול מדי (מקסימום 9MB)" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const dataUrl = `data:${file.type};base64,${buffer.toString("base64")}`;

  try {
    // upload to KIE (public 24h URL, reused as the image ref for generation) +
    // analyze the creative — in parallel
    const [sourceUrl, analysis] = await Promise.all([
      uploadImageBase64(buffer, file.type, `source-${Date.now()}.png`),
      analyzeCreative(dataUrl),
    ]);
    const hasHebrew = detectHebrew(analysis);
    const renderMode = resolveRenderMode(textMode, hasHebrew);

    return NextResponse.json({ analysis, sourceUrl, hasHebrew, renderMode });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "שגיאה בסריקת הקריאייטיב" },
      { status: 502 },
    );
  }
}
