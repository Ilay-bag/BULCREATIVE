import { NextRequest, NextResponse } from "next/server";
import { uploadImageBase64 } from "@/lib/kie";
import { designNew, detectHebrew, resolveRenderMode } from "@/lib/pipeline";
import type { TextMode } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_UPLOAD_BYTES = 9 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Design a brand-new creative from a brief (+ optional product photo). */
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const brief = String(form.get("brief") ?? "").trim();
  const aspectRatio = String(form.get("aspectRatio") ?? "1:1");
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
    let productDataUrl: string | undefined;

    if (productFile instanceof File && productFile.size > 0) {
      if (!ALLOWED.has(productFile.type)) {
        return NextResponse.json({ error: "תמונת מוצר: PNG / JPEG / WebP בלבד" }, { status: 400 });
      }
      if (productFile.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: "תמונת המוצר גדולה מדי (מקסימום 9MB)" }, { status: 400 });
      }
      const buf = Buffer.from(await productFile.arrayBuffer());
      productDataUrl = `data:${productFile.type};base64,${buf.toString("base64")}`;
      // upload so generation can build the scene around the real product (i2i)
      sourceUrl = await uploadImageBase64(buf, productFile.type, `product-${Date.now()}.png`);
      productImageUrl = productDataUrl; // vision input for the designer
    }

    const spec = await designNew({ brief, productImageUrl, aspectRatio });
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
