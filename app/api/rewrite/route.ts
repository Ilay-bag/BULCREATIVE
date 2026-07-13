import { NextRequest, NextResponse } from "next/server";
import { rewriteCopy } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Rewrite/scrub copy blocks: natural marketing Hebrew, AI tells removed. */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "גוף בקשה לא תקין" }, { status: 400 });
  }

  const blocks = Array.isArray(body?.blocks)
    ? body.blocks.filter(
        (b: any) => b && typeof b.id === "string" && typeof b.text === "string",
      ).map((b: any) => ({ id: b.id, role: String(b.role ?? "other"), text: b.text }))
    : [];
  if (blocks.length === 0) {
    return NextResponse.json({ error: "אין טקסטים לשכתוב" }, { status: 400 });
  }
  const instruction = typeof body?.instruction === "string" ? body.instruction : undefined;

  try {
    const edits = await rewriteCopy({ blocks, instruction });
    return NextResponse.json({ edits });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "שגיאה בשכתוב" },
      { status: 502 },
    );
  }
}
