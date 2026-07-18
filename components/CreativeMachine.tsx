"use client";

import { useCallback, useRef, useState } from "react";
import JSZip from "jszip";

/* ---------- types ---------- */
interface TextBlock {
  id: string; text: string; role: string; language?: string;
  font: { likelyFamily: string }; color?: string;
  bbox: { x: number; y: number; w: number; h: number };
}
interface Analysis {
  textBlocks: TextBlock[]; product: string; category: string;
  marketingAngle: string; aspectRatio?: string; colors?: string[];
  toneOfVoice?: string; [k: string]: unknown;
}
interface Score {
  hook: number; hierarchy: number; cta: number; legibility: number;
  total: number; verdict?: string;
}
type VarStatus = "planned" | "submitted" | "generating" | "done" | "failed";
interface Variation {
  id: string; angleCategory?: string; marketingAngle: string; angleRationale: string;
  visualChanges: string[];
  prompt: string; taskId?: string; status: VarStatus; error?: string;
  blob?: Blob; blobUrl?: string; retries: number; imgFails: number;
  score?: Score; scoring?: boolean;
}
type Mode = "home" | "variations" | "new";
type Phase = "input" | "busy" | "review" | "generating" | "done" | "failed";
type Platform = "meta-feed" | "story" | "tiktok" | "linkedin" | "free";
interface ChatMsg { role: "user" | "assistant"; content: string }

const PLAN_CHUNK = 10, CREATE_GAP_MS = 700, POLL_INTERVAL_MS = 5000, MAX_RETRIES = 2;
const HEBREW_RE = /[֐-׿]/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ROLE_LABELS: Record<string, string> = {
  headline: "כותרת", subheadline: "כותרת משנה", cta: "כפתור פעולה", badge: "תג",
  price: "מחיר", legal: "משפטי", "logo-wordmark": "לוגו", other: "אחר",
};

const PLATFORMS: { key: Platform; label: string; ratio: string }[] = [
  { key: "meta-feed", label: "Meta פיד", ratio: "1:1" },
  { key: "story", label: "סטורי", ratio: "9:16" },
  { key: "tiktok", label: "TikTok", ratio: "9:16" },
  { key: "linkedin", label: "LinkedIn", ratio: "2:1" },
  { key: "free", label: "חופשי", ratio: "1:1" },
];

/** Bundled font families the overlay engine can render (must match lib/fonts.ts). */
const FONT_OPTIONS = [
  "Heebo", "Rubik", "Assistant", "Secular One", "Frank Ruhl Libre", "Alef",
  "Varela Round", "Montserrat", "Inter", "Playfair Display",
];

const ANGLE_LABELS: Record<string, string> = {
  pain: "כאב", outcome: "תוצאה", "social-proof": "הוכחה חברתית", curiosity: "סקרנות",
  comparison: "השוואה", urgency: "דחיפות", identity: "זהות", contrarian: "קונטרריאני",
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });

export default function CreativeMachine() {
  const [mode, setMode] = useState<Mode>("home");
  const [phase, setPhase] = useState<Phase>("input");

  // variations input
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // new-creative input
  const [brief, setBrief] = useState("");
  const [productFile, setProductFile] = useState<File | null>(null);
  const [productPreview, setProductPreview] = useState<string | null>(null);
  const [productUrl, setProductUrl] = useState("");
  const [extraNotes, setExtraNotes] = useState("");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [platform, setPlatform] = useState<Platform>("free");
  // shared
  const [count, setCount] = useState(6);
  const [textMode, setTextMode] = useState<"auto" | "overlay" | "gpt">("auto");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | undefined>(undefined);
  const [platePrompt, setPlatePrompt] = useState<string | undefined>(undefined);
  const [renderMode, setRenderMode] = useState<"gpt" | "overlay">("gpt");
  const [hasHebrew, setHasHebrew] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [fontEdits, setFontEdits] = useState<Record<string, string>>({});
  const [colorEdits, setColorEdits] = useState<Record<string, string>>({});
  const [variations, setVariations] = useState<Variation[]>([]);
  const [uiError, setUiError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [improving, setImproving] = useState(false);
  const varsRef = useRef<Variation[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const prodRef = useRef<HTMLInputElement>(null);

  // chat
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: "assistant", content: "היי! אני הבקר של BULCREATIVE. אפשר לומר לי למשל: \"תעצב מודעה לקרם לחות עם 30% הנחה\", או \"תעשה 8 וריאציות\". על מה נעבוד?" },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);

  const syncVars = (v: Variation[]) => { varsRef.current = v; setVariations([...v]); };
  const doneCount = variations.filter((v) => v.status === "done").length;

  /* ---------- file inputs ---------- */
  const acceptImage = useCallback((f: File | undefined | null, kind: "creative" | "product") => {
    if (!f) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(f.type)) {
      setUiError("פורמט לא נתמך — PNG / JPEG / WebP"); return;
    }
    setUiError(null);
    if (kind === "creative") { setFile(f); setPreviewUrl(URL.createObjectURL(f)); }
    else { setProductFile(f); setProductPreview(URL.createObjectURL(f)); }
  }, []);

  /* ---------- start: variations (analyze) ---------- */
  const startVariations = async () => {
    if (!file) return;
    setBusy(true); setUiError(null); setPhase("busy");
    try {
      const form = new FormData();
      form.append("file", file); form.append("textMode", textMode);
      const res = await fetch("/api/analyze", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "שגיאה בסריקה");
      applySpec(data);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  /* ---------- start: new creative (design) ---------- */
  const startNew = async (briefText?: string, ratio?: string) => {
    const b = (briefText ?? brief).trim();
    if (b.length < 3) { setUiError("כתוב בריף קצר על המוצר/המבצע"); return; }
    setMode("new"); setBusy(true); setUiError(null); setPhase("busy");
    try {
      const form = new FormData();
      form.append("brief", b);
      form.append("aspectRatio", ratio ?? aspectRatio);
      form.append("platform", platform);
      form.append("textMode", textMode);
      if (extraNotes.trim()) form.append("extraNotes", extraNotes.trim());
      if (productFile) form.append("productImage", productFile);
      else if (productUrl.trim()) form.append("productUrl", productUrl.trim());
      const res = await fetch("/api/design-new", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "שגיאה בעיצוב");
      applySpec(data);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const applySpec = (data: any) => {
    setAnalysis(data.analysis);
    setSourceUrl(data.sourceUrl);
    setPlatePrompt(data.platePrompt);
    setRenderMode(data.renderMode);
    setHasHebrew(data.hasHebrew);
    setEdits(Object.fromEntries(data.analysis.textBlocks.map((b: TextBlock) => [b.id, b.text])));
    setPhase("review");
  };
  const fail = (e: unknown) => { setUiError(e instanceof Error ? e.message : String(e)); setPhase("failed"); };

  /* ---------- improve copy (rewrite / de-AI) ---------- */
  const improveCopy = async (instruction?: string) => {
    if (!analysis) return;
    setImproving(true); setUiError(null);
    try {
      const blocks = analysis.textBlocks.map((b) => ({ id: b.id, role: b.role, text: edits[b.id] ?? b.text }));
      const res = await fetch("/api/rewrite", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks, instruction }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "שגיאה בשכתוב");
      setEdits((p) => ({ ...p, ...data.edits }));
    } catch (e) { setUiError(e instanceof Error ? e.message : String(e)); }
    finally { setImproving(false); }
  };

  /* ---------- confirm → plan → generate ---------- */
  const confirmAndGenerate = async () => {
    if (!analysis) return;
    setBusy(true); setUiError(null);
    // merge text + font + color overrides into the analysis the pipeline will use
    const blocks = analysis.textBlocks.map((b) => ({
      ...b,
      text: edits[b.id] ?? b.text,
      color: colorEdits[b.id] ?? b.color,
      font: fontEdits[b.id] ? { ...b.font, likelyFamily: fontEdits[b.id] } : b.font,
    }));
    const a: Analysis = { ...analysis, textBlocks: blocks };
    const heb = blocks.some((b) => HEBREW_RE.test(b.text));
    const m = textMode === "auto" ? (heb ? "overlay" : "gpt") : textMode;
    setAnalysis(a); setHasHebrew(heb); setRenderMode(m);
    try {
      setPhase("generating");
      const planned = await buildPlan(a, m);
      syncVars(planned.map((p) => ({ ...p, status: "planned" as VarStatus, retries: 0, imgFails: 0 })));
      await runGeneration(a, m);
      setPhase(varsRef.current.some((v) => v.status === "done") ? "done" : "failed");
      if (!varsRef.current.some((v) => v.status === "done")) setUiError("כל הווריאציות נכשלו");
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  type Planned = Omit<Variation, "status" | "retries" | "imgFails">;
  const buildPlan = async (a: Analysis, m: "gpt" | "overlay"): Promise<Planned[]> => {
    const all: Planned[] = [];
    // in "new" mode honor the exact designed concept as the first creative
    if (mode === "new" && platePrompt) {
      all.push({ id: "v1", angleCategory: "outcome", marketingAngle: a.marketingAngle, angleRationale: "העיצוב המקורי שלך", visualChanges: [], prompt: platePrompt });
    }
    const maxRounds = Math.ceil(count / PLAN_CHUNK) + 3;
    for (let r = 0; all.length < count && r < maxRounds; r++) {
      const need = Math.min(PLAN_CHUNK, count - all.length);
      const res = await fetch("/api/plan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysis: a, imageUrl: sourceUrl ?? "scratch", renderMode: m, need, startIndex: all.length + 1, usedAngles: all.map((v) => v.marketingAngle), platform }),
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
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: v.prompt, sourceUrl, aspectRatio: a.aspectRatio }),
      });
      if (res.status === 429 && attempt < 3) { await sleep(2000 * 2 ** attempt); continue; }
      const data = await res.json();
      if (!res.ok) {
        v.status = "failed"; v.error = data.error ?? "שגיאה בשליחה";
        if (data.code === "credits") setUiError(data.error);
        return;
      }
      v.taskId = data.taskId; v.status = "submitted"; return;
    }
  };

  const runGeneration = async (a: Analysis, m: "gpt" | "overlay") => {
    const vars = varsRef.current;
    for (const v of vars) { await submitOne(v, a); syncVars(vars); await sleep(CREATE_GAP_MS); }
    const deadline = Date.now() + 30 * 60 * 1000;
    while (Date.now() < deadline) {
      const pending = vars.filter((v) => v.status === "submitted" || v.status === "generating");
      if (pending.length === 0) break;
      for (const v of pending) {
        try {
          const res = await fetch(`/api/kie-status?taskId=${encodeURIComponent(v.taskId!)}`);
          if (res.status === 429) { await sleep(10000); break; }
          const info = await res.json();
          if (info.state === "success" && info.resultUrl) {
            const imgRes = await fetch("/api/image", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ resultUrl: info.resultUrl, mode: m, analysis: m === "overlay" ? a : undefined }),
            });
            if (imgRes.ok) {
              const blob = await imgRes.blob();
              v.blob = blob; v.blobUrl = URL.createObjectURL(blob); v.status = "done";
              void scoreOne(v, a); // fire-and-forget pre-spend scoring
            } else { v.imgFails += 1; if (v.imgFails >= 3) { v.status = "failed"; v.error = "התמונה נוצרה אך ההורדה נכשלה"; } }
          } else if (info.state === "fail") {
            if (v.retries < MAX_RETRIES) { v.retries += 1; await sleep(4000); await submitOne(v, a); }
            else { v.status = "failed"; v.error = info.failMsg ?? "הייצור נכשל"; }
          } else if (info.state === "generating") v.status = "generating";
        } catch { /* transient */ }
        syncVars(vars); await sleep(250);
      }
      await sleep(POLL_INTERVAL_MS);
    }
    for (const v of vars) if (v.status === "submitted" || v.status === "generating") { v.status = "failed"; v.error = "חריגה מזמן ההמתנה"; }
    syncVars(vars);
  };

  /* ---------- pre-spend scorecard ---------- */
  const scoreOne = async (v: Variation, a: Analysis) => {
    if (!v.blob) return;
    v.scoring = true; syncVars(varsRef.current);
    try {
      // downscale isn't needed — the API handles data URLs; send as-is
      const imageDataUrl = await blobToDataUrl(v.blob);
      const res = await fetch("/api/score", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl, analysis: a, platform }),
      });
      if (res.ok) {
        const data = await res.json();
        v.score = data.score;
      }
    } catch { /* scoring is best-effort */ }
    v.scoring = false; syncVars(varsRef.current);
  };

  /** Regenerate a single weak variation: resubmit its prompt and poll it alone. */
  const regenerateOne = async (id: string) => {
    const a = analysis; if (!a) return;
    const v = varsRef.current.find((x) => x.id === id); if (!v) return;
    if (v.blobUrl) URL.revokeObjectURL(v.blobUrl);
    v.blob = undefined; v.blobUrl = undefined; v.score = undefined; v.error = undefined;
    v.status = "planned"; syncVars(varsRef.current);
    await submitOne(v, a); syncVars(varsRef.current);
    const m = renderMode;
    const deadline = Date.now() + 10 * 60 * 1000;
    // read via a helper: submitOne/poll mutate v.status in ways TS can't track
    const live = () => v.status === "submitted" || v.status === "generating";
    while (Date.now() < deadline && live()) {
      await sleep(POLL_INTERVAL_MS);
      try {
        const res = await fetch(`/api/kie-status?taskId=${encodeURIComponent(v.taskId!)}`);
        if (res.status === 429) continue;
        const info = await res.json();
        if (info.state === "success" && info.resultUrl) {
          const imgRes = await fetch("/api/image", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resultUrl: info.resultUrl, mode: m, analysis: m === "overlay" ? a : undefined }),
          });
          if (imgRes.ok) {
            const blob = await imgRes.blob();
            v.blob = blob; v.blobUrl = URL.createObjectURL(blob); v.status = "done";
            void scoreOne(v, a);
          } else { v.status = "failed"; v.error = "הורדת התמונה נכשלה"; }
        } else if (info.state === "fail") { v.status = "failed"; v.error = info.failMsg ?? "הייצור נכשל"; }
        else if (info.state === "generating") v.status = "generating";
      } catch { /* transient */ }
      syncVars(varsRef.current);
    }
    if (live()) { v.status = "failed"; v.error = "חריגה מזמן ההמתנה"; }
    syncVars(varsRef.current);
  };

  /* ---------- chat controller ---------- */
  const sendChat = async () => {
    const text = chatInput.trim();
    if (!text || chatBusy) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next); setChatInput(""); setChatBusy(true);
    try {
      const state = {
        mode, phase, hasCreative: !!analysis, count, textMode, platform,
        product: analysis?.product,
        textBlocks: analysis?.textBlocks.map((b) => ({ id: b.id, role: b.role, text: edits[b.id] ?? b.text })),
      };
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.map((m) => ({ role: m.role, content: m.content })), state }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "שגיאה בצ'אט");
      setMessages((p) => [...p, { role: "assistant", content: data.reply || "..." }]);
      if (data.action) await executeAction(data.action);
    } catch (e) {
      setMessages((p) => [...p, { role: "assistant", content: "אופס — " + (e instanceof Error ? e.message : String(e)) }]);
    } finally { setChatBusy(false); }
  };

  const executeAction = async (action: { type: string; params?: any }) => {
    const p = action.params ?? {};
    switch (action.type) {
      case "new_creative":
        if (p.brief) { setBrief(p.brief); await startNew(p.brief, p.aspectRatio); }
        break;
      case "make_variations":
      case "set_count":
        if (typeof p.count === "number") setCount(Math.min(Math.max(p.count, 1), 40));
        if (action.type === "make_variations" && phase === "review") await confirmAndGenerate();
        break;
      case "set_platform": {
        const pl = PLATFORMS.find((x) => x.key === p.platform);
        if (pl) { setPlatform(pl.key); setAspectRatio(pl.ratio); }
        break;
      }
      case "set_text_mode":
        if (["auto", "overlay", "gpt"].includes(p.textMode)) setTextMode(p.textMode);
        break;
      case "rewrite_copy":
        if (phase === "review") await improveCopy(p.instruction);
        break;
      case "edit_text":
        if (p.edits && typeof p.edits === "object") setEdits((prev) => ({ ...prev, ...p.edits }));
        break;
      case "regenerate":
        if (phase === "review") await confirmAndGenerate();
        break;
      case "reset": reset(); break;
      default: break;
    }
  };

  /* ---------- downloads / reset ---------- */
  const downloadOne = (v: Variation) => {
    if (!v.blobUrl) return;
    const a = document.createElement("a"); a.href = v.blobUrl; a.download = `bulcreative-${v.id}.png`; a.click();
  };
  const downloadZip = async () => {
    setZipping(true);
    try {
      const zip = new JSZip();
      for (const v of variations) if (v.blob) {
        const safe = v.marketingAngle.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 50).trim();
        zip.file(`${v.id} - ${safe || "variation"}.png`, v.blob);
      }
      const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "bulcreative.zip"; a.click();
      URL.revokeObjectURL(url);
    } finally { setZipping(false); }
  };
  const reset = () => {
    variations.forEach((v) => v.blobUrl && URL.revokeObjectURL(v.blobUrl));
    setMode("home"); setPhase("input"); setFile(null); setPreviewUrl(null);
    setBrief(""); setProductFile(null); setProductPreview(null);
    setProductUrl(""); setExtraNotes("");
    setAnalysis(null); setSourceUrl(undefined); setPlatePrompt(undefined);
    setEdits({}); setFontEdits({}); setColorEdits({}); syncVars([]); setUiError(null);
  };

  /* ================== render ================== */
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
      <div className="min-w-0">{renderWorkspace()}</div>
      <ChatPanel messages={messages} input={chatInput} setInput={setChatInput} onSend={sendChat} busy={chatBusy} />
    </div>
  );

  function renderWorkspace() {
    if (mode === "home") return <Home onVariations={() => setMode("variations")} onNew={() => setMode("new")} />;
    if (phase === "review" && analysis) return renderReview();
    if (phase === "generating" || phase === "done" || phase === "failed") return renderGallery();
    return mode === "variations" ? renderVariationsInput() : renderNewInput();
  }

  /* ----- variations input ----- */
  function renderVariationsInput() {
    return (
      <div className="mx-auto max-w-2xl">
        <BackBar onBack={reset} title="וריאציות מקריאייטיב קיים" />
        <div onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); acceptImage(e.dataTransfer.files?.[0], "creative"); }}
          className="cursor-pointer rounded-2xl border-2 border-dashed border-zinc-700 bg-zinc-900/60 p-10 text-center hover:border-zinc-500">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => acceptImage(e.target.files?.[0], "creative")} />
          {previewUrl ? <img src={previewUrl} alt="" className="mx-auto max-h-72 rounded-lg" />
            : <><div className="text-5xl">🎨</div><p className="mt-4 text-lg font-semibold">גרור קריאייטיב או לחץ לבחירה</p><p className="mt-1 text-sm text-zinc-500">PNG / JPEG / WebP · עד 9MB</p></>}
        </div>
        {platformSelector()}
        {sharedControls()}
        {uiError && <ErrBox msg={uiError} />}
        <button onClick={startVariations} disabled={!file || busy} className={btnPrimary}>{busy ? "סורק..." : "🚀 סרוק והתחל"}</button>
      </div>
    );
  }

  /* ----- new creative input ----- */
  function renderNewInput() {
    return (
      <div className="mx-auto max-w-2xl">
        <BackBar onBack={reset} title="יצירת קריאייטיב חדש" />
        <label className="mb-2 block font-semibold">תאר את המוצר / המבצע</label>
        <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={4} dir="rtl"
          placeholder="לדוגמה: קרם לחות טבעי עם אלוורה למותג 'נטורל', מבצע 30% הנחה, טון רענן ונקי"
          className="w-full rounded-xl bg-zinc-950 p-3 text-lg text-zinc-100 outline-none ring-1 ring-zinc-800 focus:ring-2 focus:ring-fuchsia-500" />
        <div className="mt-4 flex items-center gap-3">
          <button onClick={() => prodRef.current?.click()} className="rounded-xl bg-zinc-800 px-4 py-2 text-sm font-bold hover:bg-zinc-700">
            {productPreview ? "החלף תמונת מוצר" : "➕ תמונת מוצר (אופציונלי)"}
          </button>
          <input ref={prodRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => acceptImage(e.target.files?.[0], "product")} />
          {productPreview && <img src={productPreview} alt="" className="h-12 w-12 rounded-lg object-cover ring-1 ring-zinc-700" />}
        </div>
        {!productFile && (
          <input
            value={productUrl}
            onChange={(e) => setProductUrl(e.target.value)}
            dir="ltr"
            placeholder="או הדבק קישור ישיר לתמונת המוצר (https://...)"
            className="mt-3 w-full rounded-xl bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none ring-1 ring-zinc-800 focus:ring-2 focus:ring-fuchsia-500"
          />
        )}
        <div className="mt-3">
          <label className="mb-1 block text-sm font-semibold text-zinc-400">הנחיות נוספות (אופציונלי)</label>
          <textarea
            value={extraNotes}
            onChange={(e) => setExtraNotes(e.target.value)}
            rows={2}
            dir="rtl"
            placeholder="למשל: לשמור על טקסטורת הבד המדויקת, רקע בהיר, בלי אנשים בפריים"
            className="w-full rounded-xl bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none ring-1 ring-zinc-800 focus:ring-2 focus:ring-fuchsia-500"
          />
        </div>
        {platformSelector()}
        {sharedControls()}
        {uiError && <ErrBox msg={uiError} />}
        <button onClick={() => startNew()} disabled={busy || brief.trim().length < 3} className={btnPrimary}>{busy ? "מעצב..." : "✨ עצב מודעה"}</button>
      </div>
    );
  }

  function platformSelector() {
    return (
      <div className="mt-4">
        <label className="mb-2 block text-sm font-semibold text-zinc-400">פלטפורמת יעד</label>
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map((p) => (
            <button
              key={p.key}
              onClick={() => { setPlatform(p.key); setAspectRatio(p.ratio); }}
              className={`flex-1 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-bold ${platform === p.key ? "bg-fuchsia-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
            >
              {p.label} <span className="text-[10px] opacity-70">{p.ratio}</span>
            </button>
          ))}
        </div>
        {(platform === "story" || platform === "tiktok") && (
          <p className="mt-2 text-xs text-zinc-500">אזורים בטוחים נאכפים אוטומטית: 15% עליונים ו-20% תחתונים נשארים נקיים.</p>
        )}
      </div>
    );
  }

  function sharedControls() {
    return (
      <div className="mt-6 rounded-2xl bg-zinc-900/60 p-5">
        <div className="flex items-center justify-between">
          <label className="font-semibold">כמות וריאציות</label>
          <span className="rounded-lg bg-fuchsia-500/20 px-3 py-1 text-xl font-black text-fuchsia-300">{count}</span>
        </div>
        <input type="range" min={1} max={40} value={count} onChange={(e) => setCount(Number(e.target.value))} className="mt-3 w-full accent-fuchsia-500" />
        <div className="mt-4 flex gap-2">
          {([["auto", "אוטומטי"], ["overlay", "טקסט מדויק"], ["gpt", "גנרטיבי"]] as const).map(([v, l]) => (
            <button key={v} onClick={() => setTextMode(v)} className={`flex-1 rounded-xl px-3 py-2 text-xs font-bold ${textMode === v ? "bg-fuchsia-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}>{l}</button>
          ))}
        </div>
      </div>
    );
  }

  /* ----- review ----- */
  function renderReview() {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 text-center">
          <span className="rounded-full bg-fuchsia-500/20 px-4 py-1.5 text-sm font-bold text-fuchsia-300">אישור טקסט</span>
          <h2 className="mt-3 text-2xl font-black text-zinc-100">בדוק ושכלל את הטקסט</h2>
          <p className="mt-1 text-sm text-zinc-400">הטקסט הזה יוטבע מדויק בכל {count} הווריאציות.{hasHebrew && " שים לב לאותיות דומות (ר/ד, ך/ן)."}</p>
        </div>
        <div className="mb-4 flex justify-center">
          <button onClick={() => improveCopy()} disabled={improving} className="rounded-xl bg-emerald-600/90 px-5 py-2 text-sm font-black hover:bg-emerald-500 disabled:opacity-60">
            {improving ? "משכלל..." : "✨ שכלל קופי + הסר טביעות AI"}
          </button>
        </div>

        {/* Brand Kit — extracted identity, reused across every generation */}
        {((analysis!.colors?.length ?? 0) > 0 || analysis!.toneOfVoice) && (
          <div className="mb-5 rounded-xl bg-zinc-900/70 p-4 ring-1 ring-zinc-800">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-black text-zinc-300">🎨 Brand Kit שזוהה</span>
              <span className="text-[10px] text-zinc-600">מוזרק לכל הווריאציות</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {(analysis!.colors ?? []).slice(0, 6).map((c, i) => (
                <span key={i} className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                  <span className="inline-block h-5 w-5 rounded-md ring-1 ring-zinc-700" style={{ backgroundColor: c }} />
                  <span className="mono" dir="ltr">{c}</span>
                </span>
              ))}
              {analysis!.toneOfVoice && (
                <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-300">
                  טון: {analysis!.toneOfVoice}
                </span>
              )}
            </div>
          </div>
        )}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-[220px_1fr]">
          {(previewUrl || productPreview) && (
            <div className="sm:sticky sm:top-4 sm:self-start">
              <img src={(previewUrl ?? productPreview)!} alt="" className="w-full rounded-xl ring-1 ring-zinc-800" />
              <p className="mt-2 text-center text-xs text-zinc-500">{mode === "new" ? "תמונת המוצר" : "הקריאייטיב המקורי"}</p>
            </div>
          )}
          <div className="space-y-3">
            {analysis!.textBlocks.map((b) => {
              const val = edits[b.id] ?? b.text;
              const isHe = (b.language ?? "").startsWith("he") || HEBREW_RE.test(val);
              return (
                <div key={b.id} className="rounded-xl bg-zinc-900/70 p-3 ring-1 ring-zinc-800">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-400">{ROLE_LABELS[b.role] ?? b.role}</span>
                    <span className="flex items-center gap-2">
                      <select
                        value={fontEdits[b.id] ?? (FONT_OPTIONS.includes(b.font.likelyFamily) ? b.font.likelyFamily : "")}
                        onChange={(e) => setFontEdits((p) => ({ ...p, [b.id]: e.target.value }))}
                        className="rounded-md bg-zinc-950 px-1.5 py-0.5 text-[11px] text-zinc-300 ring-1 ring-zinc-800"
                      >
                        <option value="" disabled>פונט…</option>
                        {FONT_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                      <input
                        type="color"
                        value={colorEdits[b.id] ?? (/^#[0-9a-fA-F]{6}$/.test(b.color ?? "") ? b.color! : "#111111")}
                        onChange={(e) => setColorEdits((p) => ({ ...p, [b.id]: e.target.value }))}
                        title="צבע הטקסט"
                        className="h-6 w-8 cursor-pointer rounded-md bg-zinc-950 ring-1 ring-zinc-800"
                      />
                    </span>
                  </div>
                  <textarea value={val} onChange={(e) => setEdits((p) => ({ ...p, [b.id]: e.target.value }))}
                    dir={isHe ? "rtl" : "ltr"} rows={val.includes("\n") ? 2 : 1}
                    style={{ fontFamily: `"${fontEdits[b.id] ?? b.font.likelyFamily}", sans-serif`, color: colorEdits[b.id] ?? undefined }}
                    className="w-full resize-y rounded-lg bg-zinc-950 px-3 py-2 text-lg text-zinc-100 outline-none ring-1 ring-zinc-800 focus:ring-2 focus:ring-fuchsia-500" />
                </div>
              );
            })}
          </div>
        </div>
        {uiError && <ErrBox msg={uiError} />}
        <div className="mt-6 flex flex-wrap gap-3">
          <button onClick={confirmAndGenerate} disabled={busy} className="flex-1 rounded-2xl bg-fuchsia-600 py-4 text-lg font-black hover:bg-fuchsia-500 disabled:bg-zinc-800 disabled:text-zinc-600">
            {busy ? "מתחיל..." : `✓ אשר וצור ${count} וריאציות`}
          </button>
          <button onClick={reset} className="rounded-2xl bg-zinc-800 px-6 py-4 font-black hover:bg-zinc-700">ביטול</button>
        </div>
      </div>
    );
  }

  /** When the run is complete, rank by scorecard total (unscored last, failed at the end). */
  function sortedVariations(): Variation[] {
    if (phase !== "done") return variations;
    return [...variations].sort((a, b) => {
      if ((a.status === "failed") !== (b.status === "failed")) return a.status === "failed" ? 1 : -1;
      return (b.score?.total ?? -1) - (a.score?.total ?? -1);
    });
  }

  /* ----- gallery ----- */
  function renderGallery() {
    const steps = ["מתכנן", "מייצר"];
    const active = phase === "generating";
    return (
      <div>
        <div className="mb-6 flex items-center justify-center gap-3">
          {steps.map((s, i) => (
            <div key={s} className={`rounded-full px-4 py-2 text-sm font-semibold ${active && i === 1 ? "bg-fuchsia-500/20 text-fuchsia-300 animate-pulse-soft" : "bg-emerald-500/15 text-emerald-300"}`}>
              {s} {i === 1 && <span className="font-black">{doneCount}/{count}</span>}
            </div>
          ))}
        </div>
        {phase === "failed" && <div className="mb-6 rounded-xl bg-red-500/10 p-4 text-center text-red-400">{uiError ?? "נעצר"} <button onClick={reset} className="mr-3 underline">התחל מחדש</button></div>}
        {phase === "done" && variations.some((v) => v.score) && (
          <p className="mb-4 text-center text-xs text-zinc-500">📊 ממוין לפי ציון ה-Scorecard — הכי חזק ראשון</p>
        )}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3">
          {sortedVariations().map((v) => (
            <VarCard key={v.id} v={v} onDownload={() => downloadOne(v)} onRegenerate={() => regenerateOne(v.id)} />
          ))}
          {variations.length === 0 && Array.from({ length: Math.min(count, 6) }).map((_, i) => <div key={i} className="aspect-square animate-pulse-soft rounded-2xl bg-zinc-900/80" />)}
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          {doneCount > 0 && <button onClick={downloadZip} disabled={zipping} className="rounded-2xl bg-emerald-600 px-8 py-3 font-black hover:bg-emerald-500 disabled:opacity-60">{zipping ? "אורז..." : `⬇ הורד הכל (${doneCount})`}</button>}
          {(phase === "done" || phase === "failed") && <button onClick={reset} className="rounded-2xl bg-zinc-800 px-8 py-3 font-black hover:bg-zinc-700">🎨 קריאייטיב חדש</button>}
        </div>
      </div>
    );
  }
}

/* ---------- presentational ---------- */
const btnPrimary = "mt-6 w-full rounded-2xl bg-fuchsia-600 py-4 text-xl font-black transition hover:bg-fuchsia-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600";

function Home({ onVariations, onNew }: { onVariations: () => void; onNew: () => void }) {
  return (
    <div className="mx-auto max-w-2xl">
      <p className="mb-6 text-center text-zinc-400">במה נתחיל?</p>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <button onClick={onVariations} className="rounded-2xl bg-zinc-900/70 p-8 text-center ring-1 ring-zinc-800 transition hover:ring-fuchsia-500">
          <div className="text-5xl">🖼️</div>
          <h3 className="mt-4 text-lg font-black text-zinc-100">וריאציות מקריאייטיב קיים</h3>
          <p className="mt-2 text-sm text-zinc-400">מעלים מודעה — מקבלים עשרות וריאציות עם אותו טקסט ופונט.</p>
        </button>
        <button onClick={onNew} className="rounded-2xl bg-zinc-900/70 p-8 text-center ring-1 ring-zinc-800 transition hover:ring-fuchsia-500">
          <div className="text-5xl">✨</div>
          <h3 className="mt-4 text-lg font-black text-zinc-100">יצירת קריאייטיב חדש</h3>
          <p className="mt-2 text-sm text-zinc-400">מתארים מוצר/מבצע — ה-AI מעצב מודעה חדשה מאפס, כולל קופי.</p>
        </button>
      </div>
      <p className="mt-6 text-center text-xs text-zinc-600">אפשר גם פשוט לומר לצ'אט מה לעשות ←</p>
    </div>
  );
}

function BackBar({ onBack, title }: { onBack: () => void; title: string }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <button onClick={onBack} className="rounded-lg bg-zinc-800 px-3 py-1 text-sm hover:bg-zinc-700">→ חזרה</button>
      <h2 className="font-black text-zinc-200">{title}</h2>
    </div>
  );
}

function ErrBox({ msg }: { msg: string }) {
  return <p className="mt-4 rounded-lg bg-red-500/10 p-3 text-center text-red-400">{msg}</p>;
}

function ScoreBadge({ score }: { score: Score }) {
  const t = score.total;
  const color = t >= 7 ? "bg-emerald-500/90 text-black" : t >= 5.5 ? "bg-amber-400/90 text-black" : "bg-red-500/90 text-white";
  return (
    <span
      className={`absolute top-2 right-2 rounded-full px-2 py-0.5 text-[12px] font-black ${color}`}
      title={`Hook ${score.hook} · היררכיה ${score.hierarchy} · CTA ${score.cta} · קריאות ${score.legibility}`}
    >
      📊 {t.toFixed(1)}
    </span>
  );
}

function VarCard({ v, onDownload, onRegenerate }: { v: Variation; onDownload: () => void; onRegenerate: () => void }) {
  const labels: Record<VarStatus, string> = { planned: "בתור", submitted: "נשלח", generating: "מייצר...", done: "מוכן", failed: "נכשל" };
  const weak = v.status === "done" && v.score && v.score.total < 6;
  return (
    <div className="overflow-hidden rounded-2xl bg-zinc-900/80 ring-1 ring-zinc-800">
      <div className="relative aspect-square bg-zinc-950">
        {v.blobUrl ? <img src={v.blobUrl} alt={v.marketingAngle} className="h-full w-full object-contain" />
          : <div className="flex h-full items-center justify-center">{v.status === "failed" ? <span className="px-4 text-center text-sm text-red-400">✗ {v.error}</span> : <span className="animate-pulse-soft text-4xl">✨</span>}</div>}
        <span className={`absolute top-2 left-2 rounded-full px-2 py-0.5 text-[11px] font-bold ${v.status === "done" ? "bg-emerald-500/90 text-black" : v.status === "failed" ? "bg-red-500/90 text-white" : "bg-zinc-700/90 text-zinc-200"}`}>{labels[v.status]}</span>
        {v.score && <ScoreBadge score={v.score} />}
        {v.scoring && <span className="absolute top-2 right-2 rounded-full bg-zinc-700/90 px-2 py-0.5 text-[11px] text-zinc-300 animate-pulse-soft">מנקד...</span>}
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-black text-fuchsia-300">
            {v.id} · {v.marketingAngle}
            {v.angleCategory && ANGLE_LABELS[v.angleCategory] && (
              <span className="mr-2 rounded-md bg-zinc-800 px-1.5 py-0.5 text-[10px] font-bold text-zinc-400">
                {ANGLE_LABELS[v.angleCategory]}
              </span>
            )}
          </h3>
          {v.blobUrl && <button onClick={onDownload} className="shrink-0 rounded-lg bg-zinc-800 px-2 py-1 text-xs font-bold hover:bg-zinc-700">⬇</button>}
        </div>
        {v.score?.verdict && <p className="mt-1 text-xs text-zinc-400">💬 {v.score.verdict}</p>}
        {!v.score?.verdict && v.angleRationale && <p className="mt-1 text-xs text-zinc-500">{v.angleRationale}</p>}
        {weak && (
          <button onClick={onRegenerate} className="mt-2 w-full rounded-lg bg-amber-500/15 px-2 py-1.5 text-xs font-bold text-amber-300 ring-1 ring-amber-500/40 hover:bg-amber-500/25">
            🔄 ציון נמוך — ייצר מחדש
          </button>
        )}
      </div>
    </div>
  );
}

function ChatPanel({ messages, input, setInput, onSend, busy }: {
  messages: ChatMsg[]; input: string; setInput: (s: string) => void; onSend: () => void; busy: boolean;
}) {
  return (
    <aside className="flex h-[calc(100vh-140px)] min-h-[420px] flex-col rounded-2xl bg-zinc-900/70 ring-1 ring-zinc-800 lg:sticky lg:top-6">
      <div className="border-b border-zinc-800 px-4 py-3 font-black text-zinc-200">💬 בקר הצ'אט</div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m, i) => (
          <div key={i} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${m.role === "user" ? "mr-auto bg-fuchsia-600 text-white" : "ml-auto bg-zinc-800 text-zinc-200"}`}>
            {m.content}
          </div>
        ))}
        {busy && <div className="ml-auto max-w-[85%] rounded-2xl bg-zinc-800 px-3 py-2 text-sm text-zinc-400 animate-pulse-soft">חושב...</div>}
      </div>
      <div className="border-t border-zinc-800 p-3">
        <div className="flex gap-2">
          <input value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onSend(); }} dir="rtl"
            placeholder="מה נעשה? למשל: תעצב מודעה ל..." disabled={busy}
            className="flex-1 rounded-xl bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none ring-1 ring-zinc-800 focus:ring-2 focus:ring-fuchsia-500" />
          <button onClick={onSend} disabled={busy || !input.trim()} className="rounded-xl bg-fuchsia-600 px-4 font-black hover:bg-fuchsia-500 disabled:bg-zinc-800 disabled:text-zinc-600">↑</button>
        </div>
      </div>
    </aside>
  );
}
