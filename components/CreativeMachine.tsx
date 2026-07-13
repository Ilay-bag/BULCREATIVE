"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ---------- types mirrored from serializeJob ---------- */

interface VariationView {
  id: string;
  marketingAngle: string;
  angleRationale: string;
  visualChanges: string[];
  status: "planned" | "prompted" | "submitted" | "generating" | "done" | "failed";
  error?: string;
  imageReady: boolean;
  imageUrl?: string;
}

interface JobView {
  id: string;
  step: "analyzing" | "planning" | "prompting" | "generating" | "done" | "failed";
  error?: string;
  requestedCount: number;
  doneCount: number;
  analysis?: {
    product: string;
    category: string;
    marketingAngle: string;
    textBlocks: { text: string; role: string; font: string }[];
  };
  variations: VariationView[];
}

const STEPS: { key: JobView["step"]; label: string }[] = [
  { key: "analyzing", label: "סורק את הקריאייטיב" },
  { key: "planning", label: "מתכנן זוויות שיווקיות" },
  { key: "prompting", label: "כותב הנחיות ייצור" },
  { key: "generating", label: "מייצר וריאציות" },
];

const STEP_ORDER: Record<string, number> = {
  analyzing: 0,
  planning: 1,
  prompting: 2,
  generating: 3,
  done: 4,
  failed: 4,
};

export default function CreativeMachine() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [count, setCount] = useState(8);
  const [job, setJob] = useState<JobView | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const acceptFile = useCallback((f: File | undefined | null) => {
    if (!f) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(f.type)) {
      setUiError("פורמט לא נתמך — העלה PNG / JPEG / WebP");
      return;
    }
    setUiError(null);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  }, []);

  /* ---------- polling ---------- */
  useEffect(() => {
    if (!job || job.step === "done" || job.step === "failed") return;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${job.id}`);
        if (res.ok) setJob(await res.json());
      } catch {
        /* transient poll errors are fine */
      }
    }, 2000);
    return () => clearInterval(t);
  }, [job?.id, job?.step]);

  const start = async () => {
    if (!file) return;
    setSubmitting(true);
    setUiError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("count", String(count));
      const res = await fetch("/api/jobs", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "שגיאה בהפעלת המכונה");
      setJob(data);
    } catch (err) {
      setUiError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setJob(null);
    setFile(null);
    setPreviewUrl(null);
  };

  /* ================= idle: upload screen ================= */
  if (!job) {
    return (
      <div className="mx-auto max-w-2xl">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            acceptFile(e.dataTransfer.files?.[0]);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition
            ${dragOver ? "border-fuchsia-400 bg-fuchsia-400/10" : "border-zinc-700 bg-zinc-900/60 hover:border-zinc-500"}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => acceptFile(e.target.files?.[0])}
          />
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="הקריאייטיב שהועלה"
              className="mx-auto max-h-72 rounded-lg shadow-lg"
            />
          ) : (
            <>
              <div className="text-5xl">🎨</div>
              <p className="mt-4 text-lg font-semibold">גרור לכאן קריאייטיב או לחץ לבחירה</p>
              <p className="mt-1 text-sm text-zinc-500">PNG / JPEG / WebP · עד 9MB</p>
            </>
          )}
        </div>

        <div className="mt-8 rounded-2xl bg-zinc-900/60 p-6">
          <div className="flex items-center justify-between">
            <label className="font-semibold">כמות וריאציות</label>
            <span className="rounded-lg bg-fuchsia-500/20 px-3 py-1 text-xl font-black text-fuchsia-300">
              {count}
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={40}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="mt-4 w-full accent-fuchsia-500"
          />
          <div className="mt-1 flex justify-between text-xs text-zinc-500">
            <span>1</span>
            <span>40</span>
          </div>
        </div>

        {uiError && (
          <p className="mt-4 rounded-lg bg-red-500/10 p-3 text-center text-red-400">{uiError}</p>
        )}

        <button
          onClick={start}
          disabled={!file || submitting}
          className="mt-8 w-full rounded-2xl bg-fuchsia-600 py-4 text-xl font-black transition
            hover:bg-fuchsia-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
        >
          {submitting ? "מפעיל את המכונה..." : `🚀 צור ${count} וריאציות`}
        </button>
      </div>
    );
  }

  /* ================= running / done ================= */
  const stepIdx = STEP_ORDER[job.step] ?? 0;

  return (
    <div>
      {/* step progress */}
      <div className="mb-8 flex flex-wrap items-center justify-center gap-3">
        {STEPS.map((s, i) => {
          const state = i < stepIdx ? "done" : i === stepIdx ? "active" : "pending";
          return (
            <div
              key={s.key}
              className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold
                ${state === "done" ? "bg-emerald-500/15 text-emerald-300" : ""}
                ${state === "active" ? "bg-fuchsia-500/20 text-fuchsia-300 animate-pulse-soft" : ""}
                ${state === "pending" ? "bg-zinc-800/80 text-zinc-500" : ""}`}
            >
              {state === "done" ? "✓" : state === "active" ? "●" : "○"} {s.label}
              {s.key === "generating" && stepIdx >= 3 && (
                <span className="font-black">
                  {job.doneCount}/{job.requestedCount}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {job.step === "failed" && (
        <div className="mb-8 rounded-xl bg-red-500/10 p-4 text-center text-red-400">
          המכונה נעצרה: {job.error ?? "שגיאה לא ידועה"}
          <button onClick={reset} className="mr-4 underline">
            התחל מחדש
          </button>
        </div>
      )}

      {/* analysis summary */}
      {job.analysis && (
        <div className="mb-8 rounded-2xl bg-zinc-900/60 p-5">
          <h2 className="mb-3 font-black text-zinc-300">🔍 מה המכונה זיהתה</h2>
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <span>
              <b className="text-zinc-400">מוצר:</b> {job.analysis.product}
            </span>
            <span>
              <b className="text-zinc-400">קטגוריה:</b> {job.analysis.category}
            </span>
            <span>
              <b className="text-zinc-400">זווית נוכחית:</b> {job.analysis.marketingAngle}
            </span>
          </div>
          {job.analysis.textBlocks.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {job.analysis.textBlocks.map((t, i) => (
                <span
                  key={i}
                  dir="auto"
                  className="rounded-lg bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
                  title={`${t.role} · פונט: ${t.font}`}
                >
                  ״{t.text.length > 40 ? t.text.slice(0, 40) + "…" : t.text}״
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* gallery */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {job.variations.map((v) => (
          <VariationCard key={v.id} v={v} />
        ))}
        {job.variations.length === 0 &&
          Array.from({ length: Math.min(job.requestedCount, 12) }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse-soft rounded-2xl bg-zinc-900/80" />
          ))}
      </div>

      {/* footer actions */}
      <div className="mt-10 flex flex-wrap justify-center gap-4">
        {job.doneCount > 0 && (
          <a
            href={`/api/jobs/${job.id}/zip`}
            className="rounded-2xl bg-emerald-600 px-8 py-3 font-black transition hover:bg-emerald-500"
          >
            ⬇ הורד הכל כ-ZIP ({job.doneCount})
          </a>
        )}
        {(job.step === "done" || job.step === "failed") && (
          <button
            onClick={reset}
            className="rounded-2xl bg-zinc-800 px-8 py-3 font-black transition hover:bg-zinc-700"
          >
            🎨 קריאייטיב חדש
          </button>
        )}
      </div>
    </div>
  );
}

function VariationCard({ v }: { v: VariationView }) {
  const statusLabel: Record<VariationView["status"], string> = {
    planned: "ממתין בתור",
    prompted: "הנחיה מוכנה",
    submitted: "נשלח לייצור",
    generating: "מייצר...",
    done: "מוכן",
    failed: "נכשל",
  };

  return (
    <div className="overflow-hidden rounded-2xl bg-zinc-900/80 ring-1 ring-zinc-800">
      <div className="relative aspect-square bg-zinc-950">
        {v.imageReady && v.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.imageUrl} alt={v.marketingAngle} className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center">
            {v.status === "failed" ? (
              <span className="px-4 text-center text-sm text-red-400">✗ {v.error ?? "נכשל"}</span>
            ) : (
              <span className="animate-pulse-soft text-4xl">✨</span>
            )}
          </div>
        )}
        <span
          className={`absolute top-2 left-2 rounded-full px-2 py-0.5 text-[11px] font-bold
            ${v.status === "done" ? "bg-emerald-500/90 text-black" : ""}
            ${v.status === "failed" ? "bg-red-500/90 text-white" : ""}
            ${!["done", "failed"].includes(v.status) ? "bg-zinc-700/90 text-zinc-200" : ""}`}
        >
          {statusLabel[v.status]}
        </span>
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-black text-fuchsia-300">
            {v.id} · {v.marketingAngle}
          </h3>
          {v.imageReady && v.imageUrl && (
            <a
              href={v.imageUrl}
              download={`bulcreative-${v.id}.png`}
              className="shrink-0 rounded-lg bg-zinc-800 px-2 py-1 text-xs font-bold hover:bg-zinc-700"
            >
              ⬇ הורדה
            </a>
          )}
        </div>
        {v.angleRationale && <p className="mt-1 text-xs text-zinc-500">{v.angleRationale}</p>}
        {v.visualChanges.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-zinc-400">
            {v.visualChanges.slice(0, 3).map((c, i) => (
              <li key={i}>• {c}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
