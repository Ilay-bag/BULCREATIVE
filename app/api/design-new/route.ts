import { NextRequest, NextResponse } from "next/server";
import { uploadImageBase64 } from "@/lib/kie";
import { designNew, detectHebrew, resolveRenderMode, rewriteCopy } from "@/lib/pipeline";
import type { TextMode } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_UPLOAD_BYTES = 9 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Basic guard for a user-supplied product image URL. */
function safeHttpUrl(raw: string): string | undefined {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}

/** Design a brand-new creative from a brief (+ optional product photo / URL). */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const brief = String(form.get("brief") ?? "").trim();
  const aspectRatio = String(form.get("aspectRatio") ?? "1:1");
  const platform = String(form.get("platform") ?? "free");
  const extraNotes = String(form.get("extraNotes") ?? "");
  const productUrlRaw = String(form.get("productUrl") ?? "");
  const textModeRaw = String(form.get("textMode") ?? "auto");
  const textMode: TextMode = (["auto", "overlay", "gpt"] as const).includes(textModeRaw as never)
    ? (textModeRaw as TextMode)
    : "auto";
  const productFile = form.get("productImage");

  if (brief.length < 3) {
    return NextResponse.json({ error: "כתוב בריף קצר על המוצר/המבצע" }, { status: 400 });
  }

  try {
    let productImageUrl: string | undefined;
    let sourceUrl: string | undefined;

    if (productFile instanceof File && productFile.size > 0) {
      if (!ALLOWED.has(productFile.type)) {
        return NextResponse.json({ error: "תמונת מוצר: PNG / JPEG / WebP בלבד" }, { status: 400 });
      }
      if (productFile.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: "תמונת המוצר גדולה מדי (מקסימום 9MB)" }, { status: 400 });
      }
      const buf = Buffer.from(await productFile.arrayBuffer());
      // vision input for the designer + public URL for generation reference (i2i)
      productImageUrl = `data:${productFile.type};base64,${buf.toString("base64")}`;
      sourceUrl = await uploadImageBase64(buf, productFile.type, `product-${Date.now()}.png`);
    } else if (productUrlRaw) {
      // a direct product-image URL: usable as-is by both the vision model and KIE
      const url = safeHttpUrl(productUrlRaw);
      if (!url) return NextResponse.json({ error: "קישור תמונת המוצר לא תקין" }, { status: 400 });
      productImageUrl = url;
      sourceUrl = url;
    }

    const spec = await designNew({ brief, productImageUrl, aspectRatio, platform, extraNotes });

    // auto-polish: run the copy through the strong copywriting model before review
    try {
      const polished = await rewriteCopy({
        blocks: spec.textBlocks.map((b) => ({ id: b.id, role: b.role, text: b.text })),
        productContext: `${spec.product} — ${brief}`,
      });
      for (const b of spec.textBlocks) {
        if (polished[b.id]) b.text = polished[b.id];
      }
    } catch {
      /* polish is best-effort; the draft copy still reaches review for manual edit */
    }

    const hasHebrew = detectHebrew(spec);
    const renderMode = resolveRenderMode(textMode, hasHebrew);

    return NextResponse.json({ analysis: spec, platePrompt: spec.platePrompt, sourceUrl, hasHebrew, renderMode });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "שגיאה בעיצוב הקריאייטיב" },
      { status: 502 },
    );
  }
}
