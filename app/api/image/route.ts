import { NextRequest, NextResponse } from "next/server";
import { downloadImage } from "@/lib/kie";
import { overlayTexts } from "@/lib/overlay";
import { CreativeAnalysisSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Fetch a finished KIE result and return the FINAL image bytes to the client
 * (which stores them as a blob — KIE URLs expire in ~20 min). In overlay mode
 * the exact confirmed text is composited onto the generated plate here.
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

  try {
    let img = await downloadImage(resultUrl);

    if (body?.mode === "overlay") {
      const parsed = CreativeAnalysisSchema.safeParse(body?.analysis);
      if (!parsed.success) {
        return NextResponse.json({ error: "analysis לא תקין למצב overlay" }, { status: 400 });
      }
      img = await overlayTexts(img, parsed.data);
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
