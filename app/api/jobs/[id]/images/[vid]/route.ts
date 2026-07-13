import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { getJob, resultPath } from "@/lib/jobs";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; vid: string }> },
) {
  const { id, vid } = await params;
  const job = getJob(id);
  const variation = job?.variations.find((v) => v.id === vid);
  if (!job || !variation?.imageReady) {
    return NextResponse.json({ error: "image not found" }, { status: 404 });
  }
  const filePath = resultPath(id, vid);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "image file missing" }, { status: 404 });
  }
  const buffer = fs.readFileSync(filePath);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `inline; filename="bulcreative-${id}-${vid}.png"`,
    },
  });
}
