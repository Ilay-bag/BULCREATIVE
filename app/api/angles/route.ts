import { NextRequest, NextResponse } from "next/server";
import { CreativeAnalysisSchema } from "@/lib/schemas";
import { proposeAngles } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Given an analyzed creative, propose 3 fresh marketing angles (2 new + 1
 * reworded). Each angle carries new copy, a visual direction and a text-free
 * plate prompt, so the client can turn a chosen angle into a full creative.
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
  const rawImg = typeof body?.imageUrl === "string" ? body.imageUrl : "";
  const imageUrl = rawImg && rawImg !== "scratch" ? rawImg : undefined;
  const platform = typeof body?.platform === "string" ? body.platform : undefined;

  try {
    const angles = await proposeAngles({ analysis: parsed.data, imageUrl, platform });
    return NextResponse.json({ angles });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "שגיאה בהצעת הזוויות" },
      { status: 502 },
    );
  }
}
