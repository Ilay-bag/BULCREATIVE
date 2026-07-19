import { NextRequest, NextResponse } from "next/server";
import { CreativeAnalysisSchema } from "@/lib/schemas";
import { planChunk } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

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
  // imageUrl is optional: present → the reference image guides strategy;
  // absent (or the "scratch" sentinel) → from-scratch text-to-image creative
  const rawImg = typeof body?.imageUrl === "string" ? body.imageUrl : "";
  const imageUrl = rawImg && rawImg !== "scratch" ? rawImg : undefined;
  const renderMode = body?.renderMode === "overlay" ? "overlay" : "gpt";
  const platform = typeof body?.platform === "string" ? body.platform : undefined;
  const hasLogo = body?.hasLogo === true;
  const need = Math.min(Math.max(Number(body?.need) || 1, 1), 10);
  const startIndex = Math.max(Number(body?.startIndex) || 1, 1);
  const usedAngles: string[] = Array.isArray(body?.usedAngles)
    ? body.usedAngles.filter((a: unknown) => typeof a === "string")
    : [];
  const strArray = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === "string").slice(0, 12) : [];
  const selectedIdeas = strArray(body?.selectedIdeas);
  const selectedSellingPoints = strArray(body?.selectedSellingPoints);

  try {
    const variations = await planChunk({
      analysis: parsed.data,
      imageUrl,
      need,
      startIndex,
      usedAngles,
      renderMode,
      platform,
      hasLogo,
      selectedIdeas,
      selectedSellingPoints,
    });
    return NextResponse.json({ variations });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "שגיאה בתכנון הווריאציות" },
      { status: 502 },
    );
  }
}
