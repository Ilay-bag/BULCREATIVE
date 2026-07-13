"use client";

import { useCallback, useRef, useState } from "react";
import JSZip from "jszip";

/* ---------- types ---------- */

interface TextBlock {
  id: string;
  text: string;
  role: string;
  language?: string;
  font: { likelyFamily: string };
  color?: string;
  bbox: { x: number; y: number; w: number; h: number };
}

interface Analysis {
  textBlocks: TextBlock[];
  product: string;
  category: string;
  marketingAngle: string;
  aspectRatio?: string;
  [k: string]: unknown;
}

type VarStatus = "planned" | "submitted" | "generating" | "done" | "failed";

interface Variation {
  id: string;
  marketingAngle: string;
  angleRationale: string;
  visualChanges: string[];
  prompt: string;
  taskId?: string;
  status: VarStatus;
  error?: string;
  blob?: Blob;
  blobUrl?: string;
  retries: number;
  imgFails: number;
}

type Phase = "idle" | "analyzing" | "review" | "planning" | "generating" | "done" | "failed";

/* ---------- constants ---------- */

const PLAN_CHUNK = 10;
const CREATE_GAP_MS = 700; // < 20 req / 10s
const POLL_INTERVAL_MS = 5000;
const MAX_RETRIES = 2;

const ROLE_LABELS: Record<string, string> = {
  headline: "כותרת",
  subheadline: "כותרת משנה",
  cta: "כפתור פעולה",
  badge: "תג",
  price: "מחיר",
  legal: "טקסט משפטי",
  "logo-wordmark": "לוגו",
  other: "אחר",
};

const STEPS: { key: Phase; label: string }[] = [
  { key: "analyzing", label: "סורק" },
  { key: "review", label: "אישור טקסט" },
  { key: "planning", label: "מתכנן" },
  { key: "generating", label: "מייצר" },
];
const STEP_ORDER: Record<string, number> = {
  analyzing: 0, review: 1, planning: 2, generating: 3, done: 4, failed: 4,
};

const HEBREW_RE = /[֐-׿]/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ================================================================= */

export default function CreativeMachine() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [count, setCount] = useState(8);
  const [textMode, setTextMode] = useState<"auto" | "overlay" | "gpt">("auto");

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string>("");
  const [renderMode, setRenderMode] = useState<"gpt" | "overlay">("gpt");
  const [hasHebrew, setHasHebrew] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});

  const [variations, setVariations] = useState<Variation[]>([]);
  const [uiError, setUiError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [zipping, setZipping] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const varsRef = useRef<Variation[]>([]);

  const syncVars = (vars: Variation[]) => {
    varsRef.current = vars;
    setVariations([...vars]);
  };

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

  /* ---------- step 1: analyze ---------- */
  const start = async () => {
    if (!file) return;
    setBusy(true);
    setUiError(null);
    setPhase("analyzing");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("textMode", textMode);
      const res = await fetch("/api/analyze", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "שגיאה בסריקה");
      setAnalysis(data.analysis);
      setSourceUrl(data.sourceUrl);
      setRenderMode(data.renderMode);
      setHasHebrew(data.hasHebrew);
      setEdits(Object.fromEntries(data.analysis.textBlocks.map((b: TextBlock) => [b.id, b.text])));
      setPhase("review");
    } catch (err) {
      setUiError(err instanceof Error ? err.message : String(err));
      setPhase("idle");
    } finally {
      setBusy(false);
    }
  };

  /* ---------- step 2: confirm text → plan → generate ---------- */
  const confirmText = async () => {
    if (!analysis) return;
    setBusy(true);
    setUiError(null);

    // apply edits to a working copy of the analysis
    const editedBlocks = analysis.textBlocks.map((b) => ({ ...b, text: edits[b.id] ?? b.text }));
    const editedAnalysis: Analysis = { ...analysis, textBlocks: editedBlocks };
    const heb = editedBlocks.some((b) => HEBREW_RE.test(b.text));
    const mode = textMode === "auto" ? (heb ? "overlay" : "gpt") : textMode;
    setAnalysis(editedAnalysis);
    setHasHebrew(heb);
    setRenderMode(mode);

    try {
      setPhase("planning");
      const planned = await planAll(editedAnalysis, mode);
      const vars: Variation[] = planned.map((p) => ({ ...p, status: "planned", retries: 0, imgFails: 0 }));
      syncVars(vars);
      setPhase("generating");
      await generateAll(editedAnalysis, mode);
      const anyDone = varsRef.current.some((v) => v.status === "done");
      setPhase(anyDone ? "done" : "failed");
      if (!anyDone) setUiError("כל הווריאציות נכשלו בייצור");
    } catch (err) {
      setUiError(err instanceof Error ? err.message : String(err));
      setPhase("failed");
    } finally {
      setBusy(false);
    }
  };

  const planAll = async (a: Analysis, mode: "gpt" | "overlay") => {
    const all: Omit<Variation, "status" | "retries">[] = [];
    const maxRounds = Math.ceil(count / PLAN_CHUNK) + 3;
    for (let round = 0; all.length < count && round < maxRounds; round++) {
      const need = Math.min(PLAN_CHUNK, count - all.length);
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analysis: a,
          imageUrl: sourceUrl,
          renderMode: mode,
          need,
          startIndex: all.length + 1,
          usedAngles: all.map((v) => v.marketingAngle),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "שגיאה בתכנון");
      for (const v of data.variations.slice(0, need)) all.push(v);
    }
    return all.slice(0, count);
  };

  const submitOne = async (v: Variation, a: Analysis) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: v.prompt, sourceUrl, aspectRatio: a.aspectRatio }),
      });
      if (res.status === 429 && attempt < 3) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      const data = await res.json();
      if (!res.ok) {
        v.status = "failed";
        v.error = data.error ?? "שגיאה בשליחה";
        if (data.code === "credits") setUiError(data.error); // surface prominently
        return;
      }
      v.taskId = data.taskId;
      v.status = "submitted";
      return;
    }
  };

  const generateAll = async (a: Analysis, mode: "gpt" | "overlay") => {
    const vars = varsRef.current;
    // submit, spaced for rate limits
    for (const v of vars) {
      await submitOne(v, a);
      syncVars(vars);
      await sleep(CREATE_GAP_MS);
    }
    // poll until terminal
    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
      const pending = vars.filter((v) => v.status === "submitted" || v.status === "generating");
      if (pending.length === 0) break;
      for (const v of pending) {
        try {
          const res = await fetch(`/api/kie-status?taskId=${encodeURIComponent(v.taskId!)}`);
          if (res.status === 429) {
            await sleep(10000);
            break;
          }
          const info = await res.json();
          if (info.state === "success" && info.resultUrl) {
            const imgRes = await fetch("/api/image", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                resultUrl: info.resultUrl,
                mode,
                analysis: mode === "overlay" ? a : undefined,
              }),
            });
            if (imgRes.ok) {
              const blob = await imgRes.blob();
              v.blob = blob;
              v.blobUrl = URL.createObjectURL(blob);
              v.status = "done";
            } else {
              // KIE succeeded but fetching/compositing the image failed — bounded retry
              v.imgFails += 1;
              if (v.imgFails >= 3) {
                v.status = "failed";
                v.error = "התמונה נוצרה אך ההורדה נכשלה";
              }
            }
          } else if (info.state === "fail") {
            if (v.retries < MAX_RETRIES) {
              v.retries += 1;
              await sleep(4000);
              await submitOne(v, a);
            } else {
              v.status = "failed";
              v.error = info.failMsg ?? "הייצור נכשל";
            }
          } else if (info.state === "generating") {
            v.status = "generating";
          }
        } catch {
          /* transient — retry next cycle */
        }
        syncVars(vars);
        await sleep(250);
      }
      await sleep(POLL_INTERVAL_MS);
    }
    for (const v of vars) {
      if (v.status === "submitted" || v.status === "generating") {
        v.status = "failed";
        v.error = "חריגה מזמן ההמתנה";
      }
    }
    syncVars(vars);
  };

  /* ---------- downloads ---------- */
  const downloadOne = (v: Variation) => {
    if (!v.blobUrl) return;
    const a = document.createElement("a");
    a.href = v.blobUrl;
    a.download = `bulcreative-${v.id}.png`;
    a.click();
  };

  const downloadZip = async () => {
    setZipping(true);
    try {
      const zip = new JSZip();
      for (const v of variations) {
        if (!v.blob) continue;
        const safe = v.marketingAngle.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 50).trim();
        zip.file(`${v.id} - ${safe || "variation"}.png`, v.blob);
      }
      const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "bulcreative.zip";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setZipping(false);
    }
  };

  const reset = () => {
    variations.forEach((v) => v.blobUrl && URL.revokeObjectURL(v.blobUrl));
    setPhase("idle");
    setFile(null);
    setPreviewUrl(null);
    setAnalysis(null);
    setSourceUrl("");
    setEdits({});
    syncVars([]);
    setUiError(null);
  };

  const doneCount = variations.filter((v) => v.status === "done").length;

  /* ================= idle: upload ================= */
  if (phase === "idle") {
    return (
      <div className="mx-auto max-w-2xl">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); acceptFile(e.dataTransfer.files?.[0]); }}
          onClick={() => fileInputRef.current?.click()}
          className={`cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition
            ${dragOver ? "border-fuchsia-400 bg-fuchsia-400/10" : "border-zinc-700 bg-zinc-900/60 hover:border-zinc-500"}`}
        >
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp"
            className="hidden" onChange={(e) => acceptFile(e.target.files?.[0])} />
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="הקריאייטיב שהועלה" className="mx-auto max-h-72 rounded-lg shadow-lg" />
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
            <span className="rounded-lg bg-fuchsia-500/20 px-3 py-1 text-xl font-black text-fuchsia-300">{count}</span>
          </div>
          <input type="range" min={1} max={40} value={count}
            onChange={(e) => setCount(Number(e.target.value))} className="mt-4 w-full accent-fuchsia-500" />
          <div className="mt-1 flex justify-between text-xs text-zinc-500"><span>1</span><span>40</span></div>

          <div className="mt-6 border-t border-zinc-800 pt-5">
            <label className="font-semibold">מצב טקסט</label>
            <div className="mt-3 flex gap-2">
              {([
                ["auto", "אוטומטי"],
                ["overlay", "טקסט מדויק"],
                ["gpt", "גנרטיבי"],
              ] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setTextMode(value)}
                  className={`flex-1 rounded-xl px-3 py-2 text-sm font-bold transition
                    ${textMode === value ? "bg-fuchsia-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}>
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-zinc-500">
              לעברית מומלץ "אוטומטי" — הטקסט מוטבע בפונט אמיתי כדי להבטיח אותיות מושלמות.
            </p>
          </div>
        </div>

        {uiError && <p className="mt-4 rounded-lg bg-red-500/10 p-3 text-center text-red-400">{uiError}</p>}

        <button onClick={start} disabled={!file || busy}
          className="mt-8 w-full rounded-2xl bg-fuchsia-600 py-4 text-xl font-black transition
            hover:bg-fuchsia-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600">
          {busy ? "סורק את הקריאייטיב..." : "🚀 סרוק והתחל"}
        </button>
      </div>
    );
  }

  /* ================= review ================= */
  if (phase === "review" && analysis) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 text-center">
          <span className="rounded-full bg-fuchsia-500/20 px-4 py-1.5 text-sm font-bold text-fuchsia-300">
            שלב 2 מתוך 3 · אישור טקסט
          </span>
          <h2 className="mt-4 text-2xl font-black text-zinc-100">בדוק שהטקסט נקרא נכון</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-zinc-400">
            תקן כאן כל טעות קריאה — הטקסט יוטבע <b className="text-zinc-200">מדויק</b> בכל {count} הווריאציות.
            {hasHebrew && " שים לב לאותיות דומות (ר/ד, ך/ן, ן/ת)."}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-[240px_1fr]">
          {previewUrl && (
            <div className="sm:sticky sm:top-4 sm:self-start">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="הקריאייטיב המקורי" className="w-full rounded-xl ring-1 ring-zinc-800" />
              <p className="mt-2 text-center text-xs text-zinc-500">הקריאייטיב המקורי</p>
            </div>
          )}
          <div className="space-y-3">
            {analysis.textBlocks.map((b) => {
              const isHe = (b.language ?? "").startsWith("he") || HEBREW_RE.test(edits[b.id] ?? b.text);
              return (
                <div key={b.id} className="rounded-xl bg-zinc-900/70 p-3 ring-1 ring-zinc-800">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-400">{ROLE_LABELS[b.role] ?? b.role}</span>
                    <span className="text-[11px] text-zinc-600">{b.font.likelyFamily}</span>
                  </div>
                  <textarea value={edits[b.id] ?? b.text}
                    onChange={(e) => setEdits((p) => ({ ...p, [b.id]: e.target.value }))}
                    dir={isHe ? "rtl" : "ltr"} rows={(edits[b.id] ?? b.text).includes("\n") ? 2 : 1}
                    className="w-full resize-y rounded-lg bg-zinc-950 px-3 py-2 text-lg text-zinc-100
                      outline-none ring-1 ring-zinc-800 focus:ring-2 focus:ring-fuchsia-500" />
                </div>
              );
            })}
          </div>
        </div>

        {uiError && <p className="mt-4 rounded-lg bg-red-500/10 p-3 text-center text-red-400">{uiError}</p>}

        <div className="mt-8 flex flex-wrap gap-3">
          <button onClick={confirmText} disabled={busy}
            className="flex-1 rounded-2xl bg-fuchsia-600 py-4 text-lg font-black transition
              hover:bg-fuchsia-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600">
            {busy ? "מתחיל ייצור..." : `✓ אשר וצור ${count} וריאציות`}
          </button>
          <button onClick={reset} className="rounded-2xl bg-zinc-800 px-6 py-4 font-black transition hover:bg-zinc-700">ביטול</button>
        </div>
      </div>
    );
  }

  /* ================= planning / generating / done ================= */
  const stepIdx = STEP_ORDER[phase] ?? 0;
  return (
    <div>
      <div className="mb-8 flex flex-wrap items-center justify-center gap-3">
        {STEPS.map((s, i) => {
          const state = i < stepIdx ? "done" : i === stepIdx ? "active" : "pending";
          return (
            <div key={s.key} className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold
              ${state === "done" ? "bg-emerald-500/15 text-emerald-300" : ""}
              ${state === "active" ? "bg-fuchsia-500/20 text-fuchsia-300 animate-pulse-soft" : ""}
              ${state === "pending" ? "bg-zinc-800/80 text-zinc-500" : ""}`}>
              {state === "done" ? "✓" : state === "active" ? "●" : "○"} {s.label}
              {s.key === "generating" && stepIdx >= 3 && <span className="font-black">{doneCount}/{count}</span>}
            </div>
          );
        })}
      </div>

      {phase === "failed" && (
        <div className="mb-8 rounded-xl bg-red-500/10 p-4 text-center text-red-400">
          {uiError ?? "המכונה נעצרה"}
          <button onClick={reset} className="mr-4 underline">התחל מחדש</button>
        </div>
      )}

      {analysis && (
        <div className="mb-8 rounded-2xl bg-zinc-900/60 p-5">
          <h2 className="mb-3 flex flex-wrap items-center gap-3 font-black text-zinc-300">
            🔍 מה המכונה זיהתה
            <span className="rounded-full bg-sky-500/15 px-3 py-0.5 text-xs font-bold text-sky-300">
              {renderMode === "overlay" ? "✒ טקסט מדויק (פונט אמיתי)" : "🖌 טקסט גנרטיבי"}{hasHebrew ? " · עברית" : ""}
            </span>
          </h2>
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <span><b className="text-zinc-400">מוצר:</b> {analysis.product}</span>
            <span><b className="text-zinc-400">קטגוריה:</b> {analysis.category}</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {variations.map((v) => <VariationCard key={v.id} v={v} onDownload={() => downloadOne(v)} />)}
        {variations.length === 0 &&
          Array.from({ length: Math.min(count, 12) }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse-soft rounded-2xl bg-zinc-900/80" />
          ))}
      </div>

      <div className="mt-10 flex flex-wrap justify-center gap-4">
        {doneCount > 0 && (
          <button onClick={downloadZip} disabled={zipping}
            className="rounded-2xl bg-emerald-600 px-8 py-3 font-black transition hover:bg-emerald-500 disabled:opacity-60">
            {zipping ? "אורז..." : `⬇ הורד הכל כ-ZIP (${doneCount})`}
          </button>
        )}
        {(phase === "done" || phase === "failed") && (
          <button onClick={reset} className="rounded-2xl bg-zinc-800 px-8 py-3 font-black transition hover:bg-zinc-700">
            🎨 קריאייטיב חדש
          </button>
        )}
      </div>
    </div>
  );
}

function VariationCard({ v, onDownload }: { v: Variation; onDownload: () => void }) {
  const statusLabel: Record<VarStatus, string> = {
    planned: "ממתין בתור", submitted: "נשלח לייצור", generating: "מייצר...", done: "מוכן", failed: "נכשל",
  };
  return (
    <div className="overflow-hidden rounded-2xl bg-zinc-900/80 ring-1 ring-zinc-800">
      <div className="relative aspect-square bg-zinc-950">
        {v.blobUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={v.blobUrl} alt={v.marketingAngle} className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center">
            {v.status === "failed"
              ? <span className="px-4 text-center text-sm text-red-400">✗ {v.error ?? "נכשל"}</span>
              : <span className="animate-pulse-soft text-4xl">✨</span>}
          </div>
        )}
        <span className={`absolute top-2 left-2 rounded-full px-2 py-0.5 text-[11px] font-bold
          ${v.status === "done" ? "bg-emerald-500/90 text-black" : ""}
          ${v.status === "failed" ? "bg-red-500/90 text-white" : ""}
          ${!["done", "failed"].includes(v.status) ? "bg-zinc-700/90 text-zinc-200" : ""}`}>
          {statusLabel[v.status]}
        </span>
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-black text-fuchsia-300">{v.id} · {v.marketingAngle}</h3>
          {v.blobUrl && (
            <button onClick={onDownload}
              className="shrink-0 rounded-lg bg-zinc-800 px-2 py-1 text-xs font-bold hover:bg-zinc-700">⬇ הורדה</button>
          )}
        </div>
        {v.angleRationale && <p className="mt-1 text-xs text-zinc-500">{v.angleRationale}</p>}
        {v.visualChanges.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-zinc-400">
            {v.visualChanges.slice(0, 3).map((c, i) => <li key={i}>• {c}</li>)}
          </ul>
        )}
      </div>
    </div>
  );
}
