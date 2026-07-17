import { NextRequest, NextResponse } from "next/server";
import { CreativeAnalysisSchema } from "@/lib/schemas";
import { scoreCreative } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Pre-spend scorecard: vision-score one finished creative (data URL image). */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "גוף בקשה לא תקין" }, { status: 400 });
  }

  const imageDataUrl = typeof body?.imageDataUrl === "string" ? body.imageDataUrl : "";
  if (!imageDataUrl.startsWith("data:image/")) {
    return NextResponse.json({ error: "חסרה תמונה לניקוד" }, { status: 400 });
  }
  const analysisParse = CreativeAnalysisSchema.safeParse(body?.analysis);
  const platform = typeof body?.platform === "string" ? body.platform : undefined;

  try {
    const score = await scoreCreative({
      imageDataUrl,
      analysis: analysisParse.success ? analysisParse.data : undefined,
      platform,
    });
    return NextResponse.json({ score });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "שגיאה בניקוד" },
      { status: 502 },
    );
  }
}
