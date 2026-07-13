import { NextRequest, NextResponse } from "next/server";
import { chatControl } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Chat controller: NL message + app state → reply + one structured action. */
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "גוף בקשה לא תקין" }, { status: 400 });
  }

  const messages = Array.isArray(body?.messages)
    ? body.messages
        .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .slice(-12) // keep the last few turns
    : [];
  if (messages.length === 0) {
    return NextResponse.json({ error: "אין הודעה" }, { status: 400 });
  }

  try {
    const result = await chatControl({ messages, state: body?.state ?? {} });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "שגיאה בצ'אט" },
      { status: 502 },
    );
  }
}
