import { NextRequest, NextResponse } from "next/server";
import { createImageTask, KieRateLimitError, KieCreditsError } from "@/lib/kie";
import { toKieAspectRatio } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Submit one KIE image-to-image task; returns its taskId. Client throttles calls. */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "גוף בקשה לא תקין" }, { status: 400 });
  }

  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  // sourceUrl optional: present → image-to-image, absent → text-to-image (from scratch)
  const sourceUrl = typeof body?.sourceUrl === "string" && body.sourceUrl ? body.sourceUrl : undefined;
  const aspectRatio = toKieAspectRatio(body?.aspectRatio);

  if (!prompt) {
    return NextResponse.json({ error: "חסר prompt" }, { status: 400 });
  }

  try {
    const taskId = await createImageTask({ prompt, sourceUrl, aspectRatio });
    return NextResponse.json({ taskId });
  } catch (err) {
    if (err instanceof KieRateLimitError) {
      return NextResponse.json({ error: "rate_limit" }, { status: 429 });
    }
    if (err instanceof KieCreditsError) {
      return NextResponse.json({ error: err.message, code: "credits" }, { status: 402 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "שגיאה בשליחת המשימה" },
      { status: 502 },
    );
  }
}
