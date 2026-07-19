import { NextRequest, NextResponse } from "next/server";
import { downloadImage } from "@/lib/kie";
import { overlayLogoOnly, overlayTexts, type RelBox } from "@/lib/overlay";
import { BBoxSchema, CreativeAnalysisSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Decode a "data:image/...;base64,...." string into raw bytes. */
function decodeDataUrl(dataUrl: string): Buffer | undefined {
  const m = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/.exec(dataUrl);
  return m ? Buffer.from(m[1], "base64") : undefined;
}

/**
 * Fetch a finished KIE result and return the FINAL image bytes to the client
 * (which stores them as a blob — KIE URLs expire in ~20 min). In overlay mode
 * the exact confirmed text is composited onto the generated plate here. If a
 * real logo was uploaded, it is composited pixel-perfect too — regardless of
 * render mode — instead of trusting the image model to redraw it.
 */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "גוף בקשה לא תקין" }, { status: 400 });
  }

  const resultUrl = typeof body?.resultUrl === "string" ? body.resultUrl : "";
  if (!resultUrl) {
    return NextResponse.json({ error: "חסר resultUrl" }, { status: 400 });
  }

  // optional logo: real asset composited on top, never drawn by the model
  let logo: { buffer: Buffer; bbox: RelBox } | undefined;
  if (typeof body?.logoDataUrl === "string" && body.logoDataUrl) {
    const buffer = decodeDataUrl(body.logoDataUrl);
    const bboxParse = BBoxSchema.safeParse(body?.logoBbox);
    if (buffer && bboxParse.success) {
      logo = { buffer, bbox: bboxParse.data };
    }
  }

  try {
    let img = await downloadImage(resultUrl);

    if (body?.mode === "overlay") {
      const parsed = CreativeAnalysisSchema.safeParse(body?.analysis);
      if (!parsed.success) {
        return NextResponse.json({ error: "analysis לא תקין למצב overlay" }, { status: 400 });
      }
      img = await overlayTexts(img, parsed.data, { logo });
    } else if (logo) {
      img = await overlayLogoOnly(img, logo.buffer, logo.bbox);
    }

    return new NextResponse(new Uint8Array(img), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "שגיאה בהבאת התמונה" },
      { status: 502 },
    );
  }
}
