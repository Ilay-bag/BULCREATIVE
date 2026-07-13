import { NextRequest, NextResponse } from "next/server";
import { getTaskInfo, KieRateLimitError } from "@/lib/kie";

export const runtime = "nodejs";
export const maxDuration = 20;

/** Poll a KIE task. Returns state and, on success, the (short-lived) result URL. */
export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get("taskId");
  if (!taskId) {
    return NextResponse.json({ error: "חסר taskId" }, { status: 400 });
  }
  try {
    const info = await getTaskInfo(taskId);
    return NextResponse.json({
      state: info.state,
      resultUrl: info.resultUrls[0],
      failMsg: info.failMsg,
    });
  } catch (err) {
    if (err instanceof KieRateLimitError) {
      return NextResponse.json({ error: "rate_limit" }, { status: 429 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "שגיאה בבדיקת הסטטוס" },
      { status: 502 },
    );
  }
}
