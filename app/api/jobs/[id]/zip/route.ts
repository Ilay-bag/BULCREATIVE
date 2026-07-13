import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import JSZip from "jszip";
import { getJob, resultPath } from "@/lib/jobs";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });

  const ready = job.variations.filter((v) => v.imageReady);
  if (ready.length === 0) {
    return NextResponse.json({ error: "אין עדיין תמונות מוכנות" }, { status: 400 });
  }

  const zip = new JSZip();
  for (const v of ready) {
    const filePath = resultPath(id, v.id);
    if (!fs.existsSync(filePath)) continue;
    const safeAngle = v.marketingAngle.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 60).trim();
    zip.file(`${v.id} - ${safeAngle || "variation"}.png`, fs.readFileSync(filePath));
  }

  const blob = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
  return new NextResponse(new Uint8Array(blob), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="bulcreative-${id}.zip"`,
    },
  });
}
