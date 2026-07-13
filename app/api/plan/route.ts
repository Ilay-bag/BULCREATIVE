import { NextRequest, NextResponse } from "next/server";
import { CreativeAnalysisSchema } from "@/lib/schemas";
import { planChunk } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Plan ONE chunk of variations (briefs + prompts). The client calls this
 * repeatedly with growing `usedAngles` until it has `count` variations, keeping
 * each request short enough for serverless limits.
 */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "גוף בקשה לא תקין" }, { status: 400 });
  }

  const parsed = CreativeAnalysisSchema.safeParse(body?.analysis);
  if (!parsed.success) {
    return NextResponse.json({ error: "analysis לא תקין" }, { status: 400 });
  }
  const imageUrl = typeof body?.imageUrl === "string" ? body.imageUrl : undefined;
  const renderMode = body?.renderMode === "overlay" ? "overlay" : "gpt";
  const need = Math.min(Math.max(Number(body?.need) || 1, 1), 10);
  const startIndex = Math.max(Number(body?.startIndex) || 1, 1);
  const usedAngles: string[] = Array.isArray(body?.usedAngles)
    ? body.usedAngles.filter((a: unknown) => typeof a === "string")
    : [];

  if (!imageUrl) {
    return NextResponse.json({ error: "חסר imageUrl" }, { status: 400 });
  }

  try {
    const variations = await planChunk({
      analysis: parsed.data,
      imageUrl,
      need,
      startIndex,
      usedAngles,
      renderMode,
    });
    return NextResponse.json({ variations });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "שגיאה בתכנון הווריאציות" },
      { status: 502 },
    );
  }
}
