/**
 * Text overlay engine — composites the EXACT original texts onto a generated
 * background plate, with real fonts. This is what makes Hebrew (and any) text
 * pixel-perfect: the image model never draws letters, we do.
 */
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { ensureFontsRegistered, resolveFont, HEBREW_RE } from "./fonts";
import type { CreativeAnalysis } from "./schemas";

interface PlacedBlock {
  lines: string[];
  x: number; // block center x (px)
  y: number; // block top y (px)
  w: number;
  h: number;
  fontFamily: string;
  fontWeight: number;
  color: string;
  isHebrew: boolean;
  letterSpacing: string;
}

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
// chunks Skia needs to render; everything else (C2PA/JUMBF provenance, text
// metadata, etc.) is dropped so the decoder doesn't choke on non-standard chunks
const KEEP_CHUNKS = new Set([
  "IHDR", "PLTE", "tRNS", "IDAT", "IEND", "gAMA", "cHRM", "sRGB", "pHYs", "bKGD",
]);

/**
 * Strip non-essential PNG chunks. GPT-Image outputs embed C2PA "Content
 * Credentials" (caBX/jumb/c2pa chunks) that @napi-rs/canvas fails to parse
 * ("Invalid SVG image"); browsers render them fine but our decoder does not.
 */
function sanitizePng(buf: Buffer): Buffer {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) return buf; // not a PNG
  const out: Buffer[] = [PNG_SIG];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString("latin1");
    const end = off + 12 + len;
    if (end > buf.length) break;
    if (KEEP_CHUNKS.has(type)) out.push(buf.subarray(off, end));
    off = end;
    if (type === "IEND") break;
  }
  return Buffer.concat(out);
}

const LETTER_SPACING_PX: Record<string, (size: number) => number> = {
  tight: (s) => -0.02 * s,
  normal: () => 0,
  wide: (s) => 0.08 * s,
};

function fitFontSize(
  ctx: SKRSContext2D,
  lines: string[],
  family: string,
  weight: number,
  maxW: number,
  maxH: number,
  spacing: string,
): number {
  // start from the height budget, shrink until the widest line fits
  let size = Math.floor((maxH / lines.length) * 0.92);
  size = Math.max(size, 8);
  for (; size >= 8; size = Math.floor(size * 0.94)) {
    const sp = (LETTER_SPACING_PX[spacing] ?? LETTER_SPACING_PX.normal)(size);
    ctx.letterSpacing = `${sp}px`;
    ctx.font = `${weight} ${size}px "${family}"`;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (widest <= maxW && size * lines.length * 1.15 <= maxH * 1.25) return size;
  }
  return 8;
}

/* ---------- layout sanitation ---------- */

export interface RelBox { x: number; y: number; w: number; h: number }

const MARGIN = 0.03; // min distance from any edge
const GAP = 0.015; // min vertical gap between blocks

/**
 * Model-produced bboxes can drift: off-canvas, touching edges, or overlapping.
 * Clamp everything into the safe frame and resolve vertical overlaps between
 * horizontally-intersecting blocks by stacking them downward.
 */
function sanitizeLayout(boxes: RelBox[]): RelBox[] {
  const out = boxes.map((b) => {
    const w = Math.min(Math.max(b.w, 0.05), 1 - 2 * MARGIN);
    const h = Math.min(Math.max(b.h, 0.02), 1 - 2 * MARGIN);
    return {
      w, h,
      x: Math.min(Math.max(b.x, MARGIN), 1 - MARGIN - w),
      y: Math.min(Math.max(b.y, MARGIN), 1 - MARGIN - h),
    };
  });

  // resolve overlaps in reading order (top to bottom)
  const order = out.map((_, i) => i).sort((a, z) => out[a].y - out[z].y);
  for (let i = 1; i < order.length; i++) {
    const cur = out[order[i]];
    for (let j = 0; j < i; j++) {
      const prev = out[order[j]];
      const hOverlap = cur.x < prev.x + prev.w && prev.x < cur.x + cur.w;
      const vOverlap = cur.y < prev.y + prev.h + GAP;
      if (hOverlap && vOverlap && cur.y + cur.h > prev.y) {
        cur.y = Math.min(prev.y + prev.h + GAP, 1 - MARGIN - cur.h);
      }
    }
  }
  return out;
}

/* ---------- contrast guard ---------- */

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relLuminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(l1: number, l2: number): number {
  const [a, b] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (a + 0.05) / (b + 0.05);
}

/** Average luminance of the plate region behind a block. */
function regionLuminance(ctx: SKRSContext2D, x: number, y: number, w: number, h: number): number {
  const px = Math.max(0, Math.floor(x));
  const py = Math.max(0, Math.floor(y));
  const pw = Math.max(1, Math.floor(w));
  const ph = Math.max(1, Math.floor(h));
  const data = ctx.getImageData(px, py, pw, ph).data;
  let sum = 0;
  const step = Math.max(4, Math.floor(data.length / 4 / 400) * 4); // sample ≤ ~400 px
  let n = 0;
  for (let i = 0; i + 2 < data.length; i += step) {
    sum += relLuminance([data[i], data[i + 1], data[i + 2]]);
    n++;
  }
  return n ? sum / n : 0.5;
}

/**
 * Composite ONLY a logo onto a plate — used in "gpt" render mode (Latin text
 * already drawn by the image model) where a real logo still needs to replace
 * whatever the model hallucinated in that area.
 */
export async function overlayLogoOnly(
  plate: Buffer,
  logoBuffer: Buffer,
  bbox: RelBox,
): Promise<Buffer> {
  const img = await loadImage(sanitizePng(plate));
  const W = img.width, H = img.height;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, W, H);
  await drawLogo(ctx, logoBuffer, bbox, W, H);
  return canvas.encode("png");
}

/**
 * Draw a real logo image (contain-fit, centered, aspect preserved) into a
 * relative bbox on the canvas. Used instead of asking the image model to
 * draw the logo — models hallucinate/distort logos just like they garble
 * Hebrew letters, so the real asset is composited pixel-perfect here.
 */
async function drawLogo(
  ctx: SKRSContext2D,
  logoBuffer: Buffer,
  bbox: RelBox,
  W: number,
  H: number,
): Promise<void> {
  const logoImg = await loadImage(sanitizePng(logoBuffer));
  const boxX = bbox.x * W, boxY = bbox.y * H, boxW = bbox.w * W, boxH = bbox.h * H;
  const scale = Math.min(boxW / logoImg.width, boxH / logoImg.height);
  const w = logoImg.width * scale;
  const h = logoImg.height * scale;
  const x = boxX + (boxW - w) / 2;
  const y = boxY + (boxH - h) / 2;
  ctx.drawImage(logoImg, x, y, w, h);
}

/**
 * Composite text blocks and/or a real logo onto a background plate. bboxes
 * are relative (0..1) to the ORIGINAL creative; the plate keeps the same
 * layout logic, so relative positioning transfers. Layout is sanitized
 * (no overlaps, safe margins) and every text block gets a contrast guard: if
 * the chosen color reads poorly against the actual plate pixels behind it,
 * the color flips to white/black and a soft shadow is added for legibility.
 */
export async function overlayTexts(
  plate: Buffer,
  analysis: CreativeAnalysis,
  opts?: { logo?: { buffer: Buffer; bbox: RelBox } },
): Promise<Buffer> {
  ensureFontsRegistered();
  const img = await loadImage(sanitizePng(plate));
  const W = img.width;
  const H = img.height;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, W, H);

  if (opts?.logo) {
    await drawLogo(ctx, opts.logo.buffer, opts.logo.bbox, W, H);
  }

  const rels = sanitizeLayout(analysis.textBlocks.map((t) => t.bbox));

  const blocks: PlacedBlock[] = analysis.textBlocks.map((t, i) => {
    const isHebrew = HEBREW_RE.test(t.text);
    const font = resolveFont({
      isHebrew,
      category: t.font.category,
      weight: t.font.weight,
      likelyFamily: t.font.likelyFamily,
    });
    const r = rels[i];
    return {
      lines: t.text.split("\n").map((l) => l.trim()).filter(Boolean),
      x: (r.x + r.w / 2) * W,
      y: r.y * H,
      w: r.w * W,
      h: r.h * H,
      fontFamily: font.family,
      fontWeight: font.weight,
      color: t.color || "#000000",
      isHebrew,
      letterSpacing: t.font.letterSpacing ?? "normal",
    };
  });

  for (const b of blocks) {
    if (b.lines.length === 0) continue;
    ctx.direction = b.isHebrew ? "rtl" : "ltr";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const size = fitFontSize(
      ctx, b.lines, b.fontFamily, b.fontWeight, b.w, b.h, b.letterSpacing,
    );
    const sp = (LETTER_SPACING_PX[b.letterSpacing] ?? LETTER_SPACING_PX.normal)(size);
    ctx.letterSpacing = `${sp}px`;
    ctx.font = `${b.fontWeight} ${size}px "${b.fontFamily}"`;

    // contrast guard against the real pixels behind this block
    const bg = regionLuminance(ctx, b.x - b.w / 2, b.y, b.w, b.h);
    let color = b.color;
    let ratio = contrastRatio(relLuminance(hexToRgb(color)), bg);
    if (ratio < 3) {
      color = bg > 0.45 ? "#111111" : "#FFFFFF";
      ratio = contrastRatio(relLuminance(hexToRgb(color)), bg);
    }
    ctx.fillStyle = color;
    if (ratio < 6) {
      // busy or mid-tone background — soft shadow separates the letters
      ctx.shadowColor = relLuminance(hexToRgb(color)) > 0.5 ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.55)";
      ctx.shadowBlur = Math.max(4, size * 0.08);
      ctx.shadowOffsetY = Math.max(1, size * 0.02);
    } else {
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    }

    const lineHeight = size * 1.15;
    const totalH = lineHeight * b.lines.length;
    const startY = b.y + Math.max(0, (b.h - totalH) / 2) + lineHeight / 2;
    b.lines.forEach((line, i) => {
      ctx.fillText(line, b.x, startY + i * lineHeight);
    });
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  }

  return canvas.encode("png");
}
