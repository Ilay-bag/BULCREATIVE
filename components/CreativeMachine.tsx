"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import JSZip from "jszip";

/* ---------- types ---------- */
interface TextBlock {
  id: string; text: string; role: string; language?: string;
  font: { likelyFamily: string; weight?: string; category?: string };
  color?: string;
  bbox: { x: number; y: number; w: number; h: number };
}
interface BBox { x: number; y: number; w: number; h: number }
interface MarketingIdea { title: string; idea: string }
interface SellingPoint { point: string; why?: string }
interface Analysis {
  textBlocks: TextBlock[]; product: string; category: string;
  marketingAngle: string; aspectRatio?: string; colors?: string[];
  toneOfVoice?: string;
  offerType?: string;
  marketingIdeas?: MarketingIdea[];
  sellingPoints?: SellingPoint[];
  brand?: { name?: string | null; logoDescription?: string | null; logoBbox?: { x: number; y: number; w: number; h: number } | null };
  [k: string]: unknown;
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
/** Families with Hebrew glyph coverage — shown first (and badged) for Hebrew blocks. */
const HEBREW_FONTS = new Set([
  "Heebo", "Rubik", "Assistant", "Secular One", "Frank Ruhl Libre", "Alef", "Varela Round",
]);
/** analysis weight name → CSS font-weight for the live preview. */
const WEIGHT_CSS: Record<string, number> = { light: 400, regular: 400, medium: 700, bold: 700, black: 900 };
const WEIGHT_CHOICES: { key: string; label: string; css: number }[] = [
  { key: "regular", label: "רגיל", css: 400 },
  { key: "bold", label: "מודגש", css: 700 },
  { key: "black", label: "שחור", css: 900 },
];

const ANGLE_LABELS: Record<string, string> = {
  pain: "כאב", outcome: "תוצאה", "social-proof": "הוכחה חברתית", curiosity: "סקרנות",
  comparison: "השוואה", urgency: "דחיפות", identity: "זהות", contrarian: "קונטרריאני",
};

const OFFER_LABELS: Record<string, string> = {
  product: "מוצר בודד", collection: "קולקציה", "flash-sale": "פלאש סייל",
  sale: "מבצע", launch: "השקה", brand: "מותג",
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(blob);
  });

/** Fallback placement when the design didn't reserve brand.logoBbox: top-left. */
const DEFAULT_LOGO_BBOX = { x: 0.04, y: 0.04, w: 0.18, h: 0.08 };

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
  // shared: real logo (composited pixel-perfect, never drawn by the model)
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
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
  const [weightEdits, setWeightEdits] = useState<Record<string, string>>({});
  // marketing-consultant picks: which suggested ideas / selling points steer the plan
  const [pickedIdeas, setPickedIdeas] = useState<Record<string, boolean>>({});
  const [pickedPoints, setPickedPoints] = useState<Record<string, boolean>>({});
  // studio UX
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);
  const [showLivePreview, setShowLivePreview] = useState(true);
  const [bboxEdits, setBboxEdits] = useState<Record<string, BBox>>({});
  // gallery UX
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [galleryFilter, setGalleryFilter] = useState<"all" | "done" | "weak" | "failed">("all");
  const [compareOn, setCompareOn] = useState(false);
  const [variations, setVariations] = useState<Variation[]>([]);
  const [uiError, setUiError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [improving, setImproving] = useState(false);
  const varsRef = useRef<Variation[]>([]);
  const blockCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: string; mode: "move" | "resize"; sx: number; sy: number; start: BBox } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const prodRef = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);

  // chat
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: "assistant", content: "היי! אני הבקר של BULCREATIVE. אפשר לומר לי למשל: \"תעצב מודעה לקרם לחות עם 30% הנחה\", או \"תעשה 8 וריאציות\". על מה נעבוד?" },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);

  const syncVars = (v: Variation[]) => { varsRef.current = v; setVariations([...v]); };
  const doneCount = variations.filter((v) => v.status === "done").length;

  // lightbox keyboard: Esc closes, arrows navigate between openable variations
  useEffect(() => {
    if (!lightboxId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setLightboxId(null); return; }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const openable = varsRef.current.filter((v) => v.blobUrl);
      const idx = openable.findIndex((v) => v.id === lightboxId);
      if (idx < 0 || openable.length < 2) return;
      const d = e.key === "ArrowRight" ? 1 : -1; // RTL: right = previous visually, keep simple cycle
      setLightboxId(openable[(idx + d + openable.length) % openable.length].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxId]);

  /* ---------- file inputs ---------- */
  const acceptImage = useCallback((f: File | undefined | null, kind: "creative" | "product" | "logo") => {
    if (!f) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(f.type)) {
      setUiError("פורמט לא נתמך — PNG / JPEG / WebP"); return;
    }
    setUiError(null);
    if (kind === "creative") { setFile(f); setPreviewUrl(URL.createObjectURL(f)); }
    else if (kind === "product") { setProductFile(f); setProductPreview(URL.createObjectURL(f)); }
    else { blobToDataUrl(f).then(setLogoDataUrl); }
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
      form.append("hasLogo", String(!!logoDataUrl));
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
    setPickedIdeas({}); setPickedPoints({});
    setSelectedBlock(null); setShowLivePreview(true); setBboxEdits({});
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
      bbox: bboxEdits[b.id] ?? b.bbox,
      font: {
        ...b.font,
        ...(fontEdits[b.id] ? { likelyFamily: fontEdits[b.id] } : {}),
        ...(weightEdits[b.id] ? { weight: weightEdits[b.id] } : {}),
      },
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
        body: JSON.stringify({
          analysis: a, imageUrl: sourceUrl ?? "scratch", renderMode: m, need,
          startIndex: all.length + 1, usedAngles: all.map((v) => v.marketingAngle),
          platform, hasLogo: !!logoDataUrl,
          selectedIdeas: (a.marketingIdeas ?? []).filter((i) => pickedIdeas[i.title]).map((i) => `${i.title} — ${i.idea}`),
          selectedSellingPoints: (a.sellingPoints ?? []).filter((s) => pickedPoints[s.point]).map((s) => s.point),
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
              body: JSON.stringify({
                resultUrl: info.resultUrl, mode: m, analysis: m === "overlay" ? a : undefined,
                logoDataUrl: logoDataUrl ?? undefined,
                logoBbox: logoDataUrl ? (a.brand?.logoBbox ?? DEFAULT_LOGO_BBOX) : undefined,
              }),
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
            body: JSON.stringify({
              resultUrl: info.resultUrl, mode: m, analysis: m === "overlay" ? a : undefined,
              logoDataUrl: logoDataUrl ?? undefined,
              logoBbox: logoDataUrl ? (a.brand?.logoBbox ?? DEFAULT_LOGO_BBOX) : undefined,
            }),
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
    setProductUrl(""); setExtraNotes(""); setLogoDataUrl(null);
    setAnalysis(null); setSourceUrl(undefined); setPlatePrompt(undefined);
    setEdits({}); setFontEdits({}); setColorEdits({}); setWeightEdits({}); setBboxEdits({});
    setPickedIdeas({}); setPickedPoints({});
    setSelectedBlock(null); setLightboxId(null); setGalleryFilter("all"); setCompareOn(false);
    syncVars([]); setUiError(null);
  };

  /* ================== render ================== */
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
      <div className="min-w-0">{renderWorkspace()}</div>
      <ChatPanel messages={messages} input={chatInput} setInput={setChatInput} onSend={sendChat} busy={chatBusy} />
    </div>
  );

  function currentStep(): number {
    if (mode === "home") return 0;
    if (phase === "input" || phase === "busy") return 1;
    if (phase === "review") return 2;
    if (phase === "generating") return 3;
    return 4; // done / failed → gallery
  }

  function renderWorkspace() {
    const stepper = mode !== "home" && <Stepper current={currentStep()} />;
    if (mode === "home") return <Home onVariations={() => setMode("variations")} onNew={() => setMode("new")} />;
    if (phase === "review" && analysis) return <>{stepper}{renderReview()}</>;
    if (phase === "generating" || phase === "done" || phase === "failed") return <>{stepper}{renderGallery()}</>;
    return <>{stepper}{mode === "variations" ? renderVariationsInput() : renderNewInput()}</>;
  }

  /* ----- variations input ----- */
  function renderVariationsInput() {
    return (
      <div className="mx-auto max-w-2xl">
        <BackBar onBack={reset} title="וריאציות מקריאייטיב קיים" />
        <div onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); acceptImage(e.dataTransfer.files?.[0], "creative"); }}
          className="glass cursor-pointer rounded-3xl border-2 border-dashed border-zinc-700 p-10 text-center transition hover:border-fuchsia-500/60 hover:glow-accent">
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
      <div className="glass mt-6 rounded-2xl p-5">
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
        <div className="mt-4 border-t border-zinc-800 pt-4">
          <div className="flex items-center gap-3">
            <button onClick={() => logoRef.current?.click()} className="rounded-xl bg-zinc-800 px-4 py-2 text-sm font-bold hover:bg-zinc-700">
              {logoDataUrl ? "החלף לוגו" : "🏷️ העלה לוגו (אופציונלי)"}
            </button>
            <input ref={logoRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => acceptImage(e.target.files?.[0], "logo")} />
            {logoDataUrl && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoDataUrl} alt="לוגו" className="h-10 w-10 rounded-lg bg-white object-contain p-1 ring-1 ring-zinc-700" />
                <button onClick={() => setLogoDataUrl(null)} className="text-xs text-zinc-500 hover:text-red-400">הסר</button>
              </>
            )}
          </div>
          {logoDataUrl && <p className="mt-2 text-xs text-zinc-500">הלוגו יוטבע פיקסל-פרפקט על כל וריאציה — לא מצויר ע"י ה-AI.</p>}
        </div>
      </div>
    );
  }

  /* ----- studio (review) ----- */

  /** "4:5" → CSS aspect-ratio value; falls back to square. */
  function ratioToCss(r?: string): string {
    const m = /^(\d+):(\d+)$/.exec((r ?? "").trim());
    return m ? `${m[1]} / ${m[2]}` : "1 / 1";
  }

  /** The font family a block currently renders with (edit override → analysis). */
  function blockFamily(b: TextBlock): string {
    return fontEdits[b.id] ?? (FONT_OPTIONS.includes(b.font.likelyFamily) ? b.font.likelyFamily : "Heebo");
  }
  function blockWeight(b: TextBlock): number {
    const w = weightEdits[b.id] ?? b.font.weight ?? "regular";
    return WEIGHT_CSS[w] ?? 400;
  }
  function blockColor(b: TextBlock): string {
    return colorEdits[b.id] ?? (/^#[0-9a-fA-F]{6}$/.test(b.color ?? "") ? b.color! : "#111111");
  }

  /** The bbox a block currently renders at (drag/resize override → analysis). */
  function blockBbox(b: TextBlock): BBox {
    return bboxEdits[b.id] ?? b.bbox;
  }

  const startBlockDrag = (e: React.PointerEvent, b: TextBlock, dragMode: "move" | "resize") => {
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { id: b.id, mode: dragMode, sx: e.clientX, sy: e.clientY, start: blockBbox(b) };
    setSelectedBlock(b.id);
  };
  const moveBlockDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!d || !rect) return;
    const dx = (e.clientX - d.sx) / rect.width;
    const dy = (e.clientY - d.sy) / rect.height;
    const s = d.start;
    const next: BBox = d.mode === "move"
      ? {
          w: s.w, h: s.h,
          x: Math.min(Math.max(s.x + dx, 0.02), 0.98 - s.w),
          y: Math.min(Math.max(s.y + dy, 0.02), 0.98 - s.h),
        }
      : {
          x: s.x, y: s.y,
          w: Math.min(Math.max(s.w + dx, 0.06), 0.98 - s.x),
          h: Math.min(Math.max(s.h + dy, 0.025), 0.98 - s.y),
        };
    setBboxEdits((p) => ({ ...p, [d.id]: next }));
  };
  const endBlockDrag = () => { dragRef.current = null; };

  function renderStudioCanvas() {
    const a = analysis!;
    const bgImage = mode === "new" ? productPreview : previewUrl;
    const palette = a.colors ?? [];
    const gradient = `linear-gradient(135deg, ${palette[0] ?? "#27272a"} 0%, ${palette[1] ?? palette[0] ?? "#18181b"} 100%)`;
    const layoutDirty = Object.keys(bboxEdits).length > 0;
    return (
      <div className="lg:sticky lg:top-4 lg:self-start">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs font-black text-zinc-300">🖥️ תצוגה חיה</span>
          <span className="flex items-center gap-2">
            {layoutDirty && (
              <button onClick={() => setBboxEdits({})}
                className="rounded-full bg-zinc-800 px-3 py-1 text-[11px] font-bold text-amber-300 hover:bg-zinc-700">
                ↺ אפס פריסה
              </button>
            )}
            {previewUrl && (
              <button onClick={() => setShowLivePreview(!showLivePreview)}
                className="rounded-full bg-zinc-800 px-3 py-1 text-[11px] font-bold text-zinc-300 hover:bg-zinc-700">
                {showLivePreview ? "👁 הצג מקור" : "✏️ הצג עריכה חיה"}
              </button>
            )}
          </span>
        </div>
        <div
          ref={canvasRef}
          className="studio-canvas w-full rounded-2xl ring-1 ring-zinc-800"
          style={{
            aspectRatio: ratioToCss(a.aspectRatio),
            background: bgImage ? undefined : gradient,
            backgroundImage: bgImage ? `url(${bgImage})` : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          {showLivePreview && a.textBlocks.map((b) => {
            const val = edits[b.id] ?? b.text;
            const lines = Math.max(val.split("\n").filter(Boolean).length, 1);
            const isHe = HEBREW_RE.test(val);
            const box = blockBbox(b);
            const sizeCqh = Math.max((box.h * 100 / lines) * 0.72, 1.6);
            const active = selectedBlock === b.id;
            return (
              <div key={b.id}
                onClick={() => selectBlock(b.id)}
                className={`studio-block ${active ? "selected" : ""}`}
                title={ROLE_LABELS[b.role] ?? b.role}
                style={{
                  left: `${box.x * 100}%`,
                  top: `${box.y * 100}%`,
                  width: `${box.w * 100}%`,
                  height: `${box.h * 100}%`,
                  fontFamily: `"${blockFamily(b)}", sans-serif`,
                  fontWeight: blockWeight(b),
                  color: blockColor(b),
                  fontSize: `${sizeCqh}cqh`,
                  textShadow: "0 1px 8px rgba(0,0,0,0.25)",
                }}
              >
                <Editable
                  value={val}
                  dir={isHe ? "rtl" : "ltr"}
                  onChange={(t) => setEdits((p) => ({ ...p, [b.id]: t }))}
                  onFocus={() => setSelectedBlock(b.id)}
                />
                <span
                  className="studio-handle studio-handle-move"
                  title="גרור להזזה"
                  onPointerDown={(e) => startBlockDrag(e, b, "move")}
                  onPointerMove={moveBlockDrag}
                  onPointerUp={endBlockDrag}
                >✥</span>
                <span
                  className="studio-handle studio-handle-resize"
                  title="גרור לשינוי גודל"
                  onPointerDown={(e) => startBlockDrag(e, b, "resize")}
                  onPointerMove={moveBlockDrag}
                  onPointerUp={endBlockDrag}
                >◢</span>
              </div>
            );
          })}
          {logoDataUrl && showLivePreview && (
            (() => {
              const lb = a.brand?.logoBbox ?? DEFAULT_LOGO_BBOX;
              return (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={logoDataUrl} alt="לוגו"
                  className="pointer-events-none absolute object-contain"
                  style={{ left: `${lb.x * 100}%`, top: `${lb.y * 100}%`, width: `${lb.w * 100}%`, height: `${lb.h * 100}%` }} />
              );
            })()
          )}
        </div>
        <p className="mt-2 text-center text-[11px] text-zinc-600">
          {mode === "new" && !bgImage ? "הרקע ייווצר בייצור — זו פלטת המותג · " : ""}
          הקלד ישירות על הטקסט · ✥ מזיז · ◢ משנה גודל · בייצור הטקסט מוטבע פיקסל-פרפקט
        </p>
      </div>
    );
  }

  function selectBlock(id: string) {
    setSelectedBlock(id);
    blockCardRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function renderReview() {
    const a = analysis!;
    const palette = (a.colors ?? []).filter((c) => /^#[0-9a-fA-F]{6}$/.test(c));
    return (
      <div className="mx-auto max-w-5xl animate-fade-up">
        <div className="mb-5 text-center">
          <span className="rounded-full bg-fuchsia-500/20 px-4 py-1.5 text-sm font-bold text-fuchsia-300">🎛️ הסטודיו</span>
          <h2 className="mt-3 text-2xl font-black text-zinc-100">ערוך, עצב ואשר</h2>
          <p className="mt-1 text-sm text-zinc-400">מה שרואים כאן יוטבע מדויק בכל {count} הווריאציות.{hasHebrew && " שים לב לאותיות דומות (ר/ד, ך/ן)."}</p>
        </div>

        {/* Brand Kit — extracted identity, reused across every generation */}
        {(palette.length > 0 || a.toneOfVoice) && (
          <div className="glass mb-5 rounded-xl p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-black text-zinc-300">🎨 Brand Kit שזוהה</span>
              <span className="text-[10px] text-zinc-600">מוזרק לכל הווריאציות</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {palette.slice(0, 6).map((c, i) => (
                <span key={i} className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                  <span className="inline-block h-5 w-5 rounded-md ring-1 ring-zinc-700" style={{ backgroundColor: c }} />
                  <span className="mono" dir="ltr">{c}</span>
                </span>
              ))}
              {a.toneOfVoice && (
                <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-300">טון: {a.toneOfVoice}</span>
              )}
            </div>
          </div>
        )}
        {renderConsultant()}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
          {renderStudioCanvas()}

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-zinc-300">📝 בלוקים של טקסט</span>
              <button onClick={() => improveCopy()} disabled={improving}
                className="rounded-lg bg-emerald-600/90 px-3 py-1.5 text-xs font-black hover:bg-emerald-500 disabled:opacity-60">
                {improving ? "משכלל..." : "✨ שכלל קופי"}
              </button>
            </div>
            {a.textBlocks.map((b) => {
              const val = edits[b.id] ?? b.text;
              const isHe = (b.language ?? "").startsWith("he") || HEBREW_RE.test(val);
              const active = selectedBlock === b.id;
              const wKey = weightEdits[b.id] ?? b.font.weight ?? "regular";
              return (
                <div key={b.id}
                  ref={(el) => { blockCardRefs.current[b.id] = el; }}
                  onClick={() => setSelectedBlock(b.id)}
                  className={`glass rounded-xl p-3 transition ${active ? "ring-2 ring-fuchsia-500" : "ring-1 ring-transparent hover:ring-zinc-700"}`}>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-zinc-400">{ROLE_LABELS[b.role] ?? b.role}</span>
                    <span className="flex items-center gap-1.5">
                      {WEIGHT_CHOICES.map((w) => (
                        <button key={w.key}
                          onClick={(e) => { e.stopPropagation(); setWeightEdits((p) => ({ ...p, [b.id]: w.key })); }}
                          title={w.label}
                          style={{ fontWeight: w.css }}
                          className={`h-6 w-6 rounded-md text-[11px] ${wKey === w.key || (w.key === "bold" && wKey === "medium") ? "bg-fuchsia-600 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}>
                          א
                        </button>
                      ))}
                    </span>
                  </div>
                  <textarea value={val}
                    onChange={(e) => setEdits((p) => ({ ...p, [b.id]: e.target.value }))}
                    onFocus={() => setSelectedBlock(b.id)}
                    dir={isHe ? "rtl" : "ltr"} rows={val.includes("\n") ? 2 : 1}
                    style={{ fontFamily: `"${blockFamily(b)}", sans-serif`, fontWeight: blockWeight(b), color: blockColor(b) }}
                    className="w-full resize-y rounded-lg bg-zinc-950 px-3 py-2 text-lg outline-none ring-1 ring-zinc-800 focus:ring-2 focus:ring-fuchsia-500" />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <FontPicker
                      value={blockFamily(b)}
                      isHebrew={isHe}
                      onChange={(f) => setFontEdits((p) => ({ ...p, [b.id]: f }))}
                    />
                    <span className="flex items-center gap-1">
                      {palette.slice(0, 5).map((c) => (
                        <button key={c}
                          onClick={(e) => { e.stopPropagation(); setColorEdits((p) => ({ ...p, [b.id]: c })); }}
                          title={c}
                          className={`h-5 w-5 rounded-full ring-2 transition hover:scale-110 ${blockColor(b).toLowerCase() === c.toLowerCase() ? "ring-fuchsia-400" : "ring-zinc-700"}`}
                          style={{ backgroundColor: c }} />
                      ))}
                      {["#FFFFFF", "#111111"].map((c) => (
                        <button key={c}
                          onClick={(e) => { e.stopPropagation(); setColorEdits((p) => ({ ...p, [b.id]: c })); }}
                          title={c}
                          className={`h-5 w-5 rounded-full ring-2 transition hover:scale-110 ${blockColor(b).toLowerCase() === c.toLowerCase() ? "ring-fuchsia-400" : "ring-zinc-700"}`}
                          style={{ backgroundColor: c }} />
                      ))}
                      <input type="color" value={blockColor(b)}
                        onChange={(e) => setColorEdits((p) => ({ ...p, [b.id]: e.target.value }))}
                        title="צבע חופשי"
                        className="h-6 w-8 cursor-pointer rounded-md bg-zinc-950 ring-1 ring-zinc-800" />
                    </span>
                  </div>
                </div>
              );
            })}
            {logoDataUrl && (
              <p className="flex items-center gap-2 rounded-xl bg-zinc-900/60 px-3 py-2 text-xs font-bold text-zinc-400">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoDataUrl} alt="" className="h-5 w-5 rounded bg-white object-contain" />
                🏷️ הלוגו יוטבע במדויק על כל וריאציה
              </p>
            )}
          </div>
        </div>

        {uiError && <ErrBox msg={uiError} />}
        <div className="mt-6 flex flex-wrap gap-3">
          <button onClick={confirmAndGenerate} disabled={busy} className="flex-1 rounded-2xl bg-fuchsia-600 py-4 text-lg font-black shadow-lg shadow-fuchsia-600/25 transition hover:bg-fuchsia-500 disabled:bg-zinc-800 disabled:text-zinc-600">
            {busy ? "מתחיל..." : `✓ אשר וצור ${count} וריאציות`}
          </button>
          <button onClick={reset} className="rounded-2xl bg-zinc-800 px-6 py-4 font-black hover:bg-zinc-700">ביטול</button>
        </div>
      </div>
    );
  }

  /* ----- marketing consultant (offer type, ideas, alternative selling points) ----- */
  function renderConsultant() {
    const a = analysis!;
    const ideas = a.marketingIdeas ?? [];
    const points = a.sellingPoints ?? [];
    if (ideas.length === 0 && points.length === 0) return null;
    const pickedCount = ideas.filter((i) => pickedIdeas[i.title]).length
      + points.filter((s) => pickedPoints[s.point]).length;
    return (
      <div className="glass mb-5 rounded-xl p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-black text-zinc-300">
            🧠 היועץ השיווקי
            {a.offerType && OFFER_LABELS[a.offerType] && (
              <span className="mr-2 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-bold text-amber-300">
                זוהה: {OFFER_LABELS[a.offerType]}
              </span>
            )}
          </span>
          <span className="text-[10px] text-zinc-600">
            {pickedCount > 0 ? `${pickedCount} הצעות נבחרו — ישולבו בתכנון הווריאציות` : "בחר הצעות כדי לכוון את הווריאציות (אופציונלי)"}
          </span>
        </div>

        {ideas.length > 0 && (
          <div className="mb-3">
            <p className="mb-2 text-[11px] font-bold text-zinc-500">💡 רעיונות לשיווק ה{OFFER_LABELS[a.offerType ?? ""] ?? "מוצר"}:</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {ideas.map((i) => {
                const on = !!pickedIdeas[i.title];
                return (
                  <button key={i.title} onClick={() => setPickedIdeas((p) => ({ ...p, [i.title]: !on }))}
                    className={`rounded-lg p-2.5 text-right text-xs ring-1 transition ${on ? "bg-fuchsia-600/20 ring-fuchsia-500 text-zinc-100" : "bg-zinc-950 ring-zinc-800 text-zinc-400 hover:ring-zinc-600"}`}>
                    <span className="font-bold">{on ? "✓ " : ""}{i.title}</span>
                    <span className="mt-0.5 block leading-relaxed text-[11px] opacity-80">{i.idea}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {points.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] font-bold text-zinc-500">🎯 נקודות מכירה חלופיות (לחיצה = לשלב בווריאציות · ✍️ = לשכתב את הקופי סביבה):</p>
            <div className="flex flex-wrap gap-2">
              {points.map((s) => {
                const on = !!pickedPoints[s.point];
                return (
                  <span key={s.point} title={s.why || undefined}
                    className={`flex items-center gap-1 rounded-full py-1 pl-1.5 pr-3 text-xs ring-1 transition ${on ? "bg-emerald-600/20 ring-emerald-500 text-emerald-200" : "bg-zinc-950 ring-zinc-800 text-zinc-400"}`}>
                    <button onClick={() => setPickedPoints((p) => ({ ...p, [s.point]: !on }))} className="font-bold hover:opacity-80">
                      {on ? "✓ " : ""}{s.point}
                    </button>
                    <button onClick={() => improveCopy(`שלב את נקודת המכירה "${s.point}" בקופי בצורה טבעית וחדה`)}
                      disabled={improving} title="שכתב את הקופי סביב נקודת המכירה הזו"
                      className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-[10px] hover:bg-zinc-700 disabled:opacity-50">
                      ✍️
                    </button>
                  </span>
                );
              })}
            </div>
          </div>
        )}
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
  function filteredVariations(): Variation[] {
    const list = sortedVariations();
    switch (galleryFilter) {
      case "done": return list.filter((v) => v.status === "done");
      case "weak": return list.filter((v) => v.status === "done" && v.score && v.score.total < 6);
      case "failed": return list.filter((v) => v.status === "failed");
      default: return list;
    }
  }

  function renderGallery() {
    const active = phase === "generating";
    const failedCount = variations.filter((v) => v.status === "failed").length;
    const weakCount = variations.filter((v) => v.status === "done" && v.score && v.score.total < 6).length;
    const filters: { key: typeof galleryFilter; label: string; show: boolean }[] = [
      { key: "all", label: `הכל (${variations.length})`, show: true },
      { key: "done", label: `מוכנות (${doneCount})`, show: doneCount > 0 },
      { key: "weak", label: `חלשות (${weakCount})`, show: weakCount > 0 },
      { key: "failed", label: `נכשלו (${failedCount})`, show: failedCount > 0 },
    ];
    return (
      <div className="animate-fade-up">
        {active && (
          <div className="glass mx-auto mb-6 max-w-md rounded-2xl p-4 text-center">
            <p className="text-sm font-bold text-fuchsia-300 animate-pulse-soft">✨ מייצר וריאציות...</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full rounded-full bg-gradient-to-l from-fuchsia-500 to-cyan-400 transition-all duration-700"
                style={{ width: `${Math.max((doneCount / count) * 100, 4)}%` }} />
            </div>
            <p className="mt-2 text-xs text-zinc-400">{doneCount} מתוך {count} מוכנות</p>
          </div>
        )}
        {phase === "failed" && <div className="mb-6 rounded-xl bg-red-500/10 p-4 text-center text-red-400">{uiError ?? "נעצר"} <button onClick={reset} className="mr-3 underline">התחל מחדש</button></div>}
        {!active && variations.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center justify-center gap-2">
            {filters.filter((f) => f.show).map((f) => (
              <button key={f.key} onClick={() => setGalleryFilter(f.key)}
                className={`rounded-full px-4 py-1.5 text-xs font-bold transition ${galleryFilter === f.key ? "bg-fuchsia-600 text-white" : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800"}`}>
                {f.label}
              </button>
            ))}
            {phase === "done" && variations.some((v) => v.score) && (
              <span className="text-xs text-zinc-600">📊 ממוין לפי ציון — הכי חזק ראשון</span>
            )}
          </div>
        )}
        <div className="stagger grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filteredVariations().map((v) => (
            <VarCard key={v.id} v={v}
              onDownload={() => downloadOne(v)}
              onRegenerate={() => regenerateOne(v.id)}
              onOpen={() => v.blobUrl && setLightboxId(v.id)} />
          ))}
          {variations.length === 0 && Array.from({ length: Math.min(count, 6) }).map((_, i) => <div key={i} className="aspect-square animate-shimmer rounded-2xl" />)}
        </div>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          {doneCount > 0 && <button onClick={downloadZip} disabled={zipping} className="rounded-2xl bg-emerald-600 px-8 py-3 font-black shadow-lg shadow-emerald-600/20 hover:bg-emerald-500 disabled:opacity-60">{zipping ? "אורז..." : `⬇ הורד הכל (${doneCount})`}</button>}
          {(phase === "done" || phase === "failed") && <button onClick={reset} className="rounded-2xl bg-zinc-800 px-8 py-3 font-black hover:bg-zinc-700">🎨 קריאייטיב חדש</button>}
        </div>
        {renderLightbox()}
      </div>
    );
  }

  /* ----- lightbox ----- */
  function renderLightbox() {
    const openable = variations.filter((v) => v.blobUrl);
    const idx = openable.findIndex((v) => v.id === lightboxId);
    const v = idx >= 0 ? openable[idx] : null;
    if (!v) return null;
    const go = (d: number) => setLightboxId(openable[(idx + d + openable.length) % openable.length].id);
    const canCompare = mode === "variations" && !!previewUrl;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm animate-zoom-in"
        onClick={() => setLightboxId(null)}>
        <div className="flex max-h-full w-full max-w-5xl flex-col gap-4 lg:flex-row" onClick={(e) => e.stopPropagation()}>
          <div className="relative flex min-h-0 flex-1 items-center justify-center">
            {compareOn && canCompare ? (
              <div className="grid w-full grid-cols-2 gap-3">
                <figure className="min-w-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrl!} alt="המקור" className="max-h-[74vh] w-full rounded-2xl object-contain shadow-2xl" />
                  <figcaption className="mt-2 text-center text-xs font-bold text-zinc-400">המקור</figcaption>
                </figure>
                <figure className="min-w-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={v.blobUrl!} alt={v.marketingAngle} className="max-h-[74vh] w-full rounded-2xl object-contain shadow-2xl" />
                  <figcaption className="mt-2 text-center text-xs font-bold text-fuchsia-300">{v.id} · הווריאציה</figcaption>
                </figure>
              </div>
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={v.blobUrl!} alt={v.marketingAngle} className="max-h-[80vh] w-auto max-w-full rounded-2xl object-contain shadow-2xl" />
            )}
            {openable.length > 1 && !compareOn && (
              <>
                <button onClick={() => go(1)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 px-3 py-2 text-xl hover:bg-black/80">‹</button>
                <button onClick={() => go(-1)} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 px-3 py-2 text-xl hover:bg-black/80">›</button>
              </>
            )}
          </div>
          <div className="glass w-full shrink-0 self-center rounded-2xl p-5 lg:w-80 lg:self-auto">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-black text-fuchsia-300">{v.id} · {v.marketingAngle}</h3>
              <button onClick={() => setLightboxId(null)} className="rounded-lg bg-zinc-800 px-2 py-0.5 text-sm hover:bg-zinc-700">✕</button>
            </div>
            {canCompare && (
              <button onClick={() => setCompareOn(!compareOn)}
                className={`mt-2 w-full rounded-lg px-3 py-1.5 text-xs font-black transition ${compareOn ? "bg-fuchsia-600 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"}`}>
                {compareOn ? "✕ סגור השוואה" : "⇄ השווה למקור"}
              </button>
            )}
            {v.angleCategory && ANGLE_LABELS[v.angleCategory] && (
              <span className="mt-1 inline-block rounded-md bg-zinc-800 px-2 py-0.5 text-[11px] font-bold text-zinc-400">{ANGLE_LABELS[v.angleCategory]}</span>
            )}
            {v.angleRationale && <p className="mt-2 text-xs leading-relaxed text-zinc-400">{v.angleRationale}</p>}
            {v.visualChanges.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-zinc-500">
                {v.visualChanges.map((c, i) => <li key={i}>• {c}</li>)}
              </ul>
            )}
            {v.score && (
              <div className="mt-4 space-y-1.5">
                {([["Hook", v.score.hook], ["היררכיה", v.score.hierarchy], ["CTA", v.score.cta], ["קריאות", v.score.legibility]] as const).map(([label, val]) => (
                  <div key={label} className="flex items-center gap-2 text-[11px] text-zinc-400">
                    <span className="w-14 shrink-0">{label}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                      <span className={`block h-full rounded-full ${val >= 7 ? "bg-emerald-400" : val >= 5.5 ? "bg-amber-400" : "bg-red-400"}`} style={{ width: `${val * 10}%` }} />
                    </span>
                    <span className="w-6 text-left font-bold">{val}</span>
                  </div>
                ))}
                <p className="pt-1 text-center text-sm font-black text-zinc-200">ציון כולל: {v.score.total.toFixed(1)}</p>
                {v.score.verdict && <p className="text-center text-xs text-zinc-500">💬 {v.score.verdict}</p>}
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <button onClick={() => downloadOne(v)} className="flex-1 rounded-xl bg-emerald-600 py-2 text-sm font-black hover:bg-emerald-500">⬇ הורדה</button>
              <button onClick={() => { setLightboxId(null); regenerateOne(v.id); }} className="rounded-xl bg-zinc-800 px-4 py-2 text-sm font-black hover:bg-zinc-700">🔄</button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

/* ---------- presentational ---------- */
const btnPrimary = "mt-6 w-full rounded-2xl bg-fuchsia-600 py-4 text-xl font-black transition hover:bg-fuchsia-500 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600";

const STEP_NAMES = ["התחלה", "הגדרות", "סטודיו", "ייצור", "גלריה"];

function Stepper({ current }: { current: number }) {
  return (
    <div className="mb-6 flex items-center justify-center gap-1 sm:gap-2" dir="rtl">
      {STEP_NAMES.map((name, i) => {
        const state = i < current ? "done" : i === current ? "active" : "todo";
        return (
          <div key={name} className="flex items-center gap-1 sm:gap-2">
            {i > 0 && <span className={`h-px w-4 sm:w-8 ${i <= current ? "bg-fuchsia-500/60" : "bg-zinc-800"}`} />}
            <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold sm:px-3 sm:text-xs ${
              state === "active" ? "bg-fuchsia-600 text-white shadow-lg shadow-fuchsia-600/30"
              : state === "done" ? "bg-emerald-500/15 text-emerald-300"
              : "bg-zinc-900 text-zinc-600"}`}>
              {state === "done" ? "✓" : i + 1} <span className="hidden sm:inline">{name}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Home({ onVariations, onNew }: { onVariations: () => void; onNew: () => void }) {
  return (
    <div className="mx-auto max-w-2xl animate-fade-up">
      <p className="mb-6 text-center text-zinc-400">במה נתחיל?</p>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <button onClick={onVariations} className="glass group rounded-3xl p-8 text-center transition duration-300 hover:-translate-y-1 hover:glow-accent">
          <div className="text-6xl transition-transform duration-300 group-hover:scale-110">🖼️</div>
          <h3 className="mt-4 text-lg font-black text-zinc-100">וריאציות מקריאייטיב קיים</h3>
          <p className="mt-2 text-sm text-zinc-400">מעלים מודעה — מקבלים עשרות וריאציות עם אותו טקסט ופונט.</p>
          <span className="mt-4 inline-block rounded-full bg-fuchsia-500/15 px-4 py-1 text-xs font-bold text-fuchsia-300 opacity-0 transition group-hover:opacity-100">התחל ←</span>
        </button>
        <button onClick={onNew} className="glass group rounded-3xl p-8 text-center transition duration-300 hover:-translate-y-1 hover:glow-accent">
          <div className="text-6xl transition-transform duration-300 group-hover:scale-110">✨</div>
          <h3 className="mt-4 text-lg font-black text-zinc-100">יצירת קריאייטיב חדש</h3>
          <p className="mt-2 text-sm text-zinc-400">מתארים מוצר/מבצע — ה-AI מעצב מודעה חדשה מאפס, כולל קופי.</p>
          <span className="mt-4 inline-block rounded-full bg-fuchsia-500/15 px-4 py-1 text-xs font-bold text-fuchsia-300 opacity-0 transition group-hover:opacity-100">התחל ←</span>
        </button>
      </div>
      <p className="mt-6 text-center text-xs text-zinc-600">אפשר גם פשוט לומר לצ'אט מה לעשות ←</p>
    </div>
  );
}

/**
 * Uncontrolled contentEditable text that stays in sync with external state
 * without caret jumps: DOM text is only written when it differs from the
 * prop (i.e. the change came from the side editor, not from typing here).
 */
function Editable({ value, dir, onChange, onFocus }: {
  value: string; dir: "rtl" | "ltr"; onChange: (t: string) => void; onFocus?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerText.replace(/\n$/, "") !== value) el.innerText = value;
  }, [value]);
  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      dir={dir}
      spellCheck={false}
      onInput={() => onChange((ref.current?.innerText ?? "").replace(/\n$/, ""))}
      onFocus={onFocus}
      className="studio-editable"
    />
  );
}

/** WYSIWYG font picker — every family is rendered in itself, Hebrew-capable first. */
function FontPicker({ value, isHebrew, onChange }: {
  value: string; isHebrew: boolean; onChange: (family: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const list = isHebrew
    ? [...FONT_OPTIONS].sort((a, b) => Number(HEBREW_FONTS.has(b)) - Number(HEBREW_FONTS.has(a)))
    : FONT_OPTIONS;
  return (
    <div className="relative">
      <button onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        style={{ fontFamily: `"${value}", sans-serif` }}
        className="flex items-center gap-1.5 rounded-lg bg-zinc-950 px-2.5 py-1 text-sm text-zinc-200 ring-1 ring-zinc-800 hover:ring-zinc-600">
        {value} <span className="text-[9px] text-zinc-500">▼</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div className="glass absolute right-0 z-30 mt-1 max-h-72 w-64 overflow-y-auto rounded-xl p-1 shadow-2xl animate-zoom-in">
            {list.map((f) => (
              <button key={f}
                onClick={(e) => { e.stopPropagation(); onChange(f); setOpen(false); }}
                className={`block w-full rounded-lg px-3 py-2 text-right transition hover:bg-zinc-800 ${f === value ? "bg-fuchsia-500/15" : ""}`}>
                <span className="flex items-center justify-between text-[10px] text-zinc-500">
                  <span>{f === value ? "✓" : ""}</span>
                  <span dir="ltr">{f}{HEBREW_FONTS.has(f) ? " · עברית" : ""}</span>
                </span>
                <span style={{ fontFamily: `"${f}"` }} className="block truncate text-lg leading-snug text-zinc-100">
                  {isHebrew && HEBREW_FONTS.has(f) ? "מבצע ענק 50%" : "Big Sale 50%"}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
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

function VarCard({ v, onDownload, onRegenerate, onOpen }: {
  v: Variation; onDownload: () => void; onRegenerate: () => void; onOpen: () => void;
}) {
  const labels: Record<VarStatus, string> = { planned: "בתור", submitted: "נשלח", generating: "מייצר...", done: "מוכן", failed: "נכשל" };
  const weak = v.status === "done" && v.score && v.score.total < 6;
  return (
    <div className="glass group overflow-hidden rounded-2xl transition duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/40">
      <div className="relative aspect-square cursor-pointer bg-zinc-950" onClick={onOpen}>
        {v.blobUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={v.blobUrl} alt={v.marketingAngle} className="h-full w-full object-contain transition duration-300 group-hover:scale-[1.02]" />
            <div className="absolute inset-0 flex items-end justify-center gap-2 bg-gradient-to-t from-black/70 via-transparent to-transparent p-3 opacity-0 transition group-hover:opacity-100">
              <button onClick={(e) => { e.stopPropagation(); onOpen(); }} className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-black backdrop-blur hover:bg-white/25">⤢ הגדל</button>
              <button onClick={(e) => { e.stopPropagation(); onDownload(); }} className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-black backdrop-blur hover:bg-white/25">⬇ הורד</button>
              <button onClick={(e) => { e.stopPropagation(); onRegenerate(); }} className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-black backdrop-blur hover:bg-white/25">🔄</button>
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center">
            {v.status === "failed" ? <span className="px-4 text-center text-sm text-red-400">✗ {v.error}</span>
              : <div className="animate-shimmer absolute inset-0" />}
          </div>
        )}
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
    <aside className="glass flex h-[calc(100vh-140px)] min-h-[420px] flex-col rounded-2xl lg:sticky lg:top-6">
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
