import { NextRequest, NextResponse } from "next/server";
import { confirmJob, serializeJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "גוף בקשה לא תקין" }, { status: 400 });
  }

  const texts = (body as { texts?: unknown })?.texts;
  if (!texts || typeof texts !== "object") {
    return NextResponse.json({ error: "חסר שדה texts" }, { status: 400 });
  }

  // keep only string values keyed by block id
  const editedTexts: Record<string, string> = {};
  for (const [k, v] of Object.entries(texts as Record<string, unknown>)) {
    if (typeof v === "string") editedTexts[k] = v;
  }

  const job = confirmJob(id, editedTexts);
  if (!job) {
    return NextResponse.json(
      { error: "המשימה לא נמצאה או אינה ממתינה לאישור" },
      { status: 409 },
    );
  }
  return NextResponse.json(serializeJob(job));
}
