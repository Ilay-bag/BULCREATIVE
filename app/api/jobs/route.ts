import { NextRequest, NextResponse } from "next/server";
import { createJob, serializeJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_UPLOAD_BYTES = 9 * 1024 * 1024; // KIE base64 upload limit is ~10MB
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  const count = Number(form.get("count") ?? 4);

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "חסר קובץ קריאייטיב" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "פורמט לא נתמך — העלה PNG / JPEG / WebP" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "הקובץ גדול מדי (מקסימום 9MB)" }, { status: 400 });
  }
  if (!Number.isFinite(count) || count < 1 || count > 40) {
    return NextResponse.json({ error: "כמות וריאציות חייבת להיות בין 1 ל-40" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const job = createJob({
    originalFileName: file.name,
    buffer,
    mimeType: file.type,
    count,
  });

  return NextResponse.json(serializeJob(job), { status: 201 });
}
