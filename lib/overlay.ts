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

/**
 * Composite text blocks (from the creative analysis) onto a background plate.
 * bboxes are relative (0..1) to the ORIGINAL creative; the plate keeps the same
 * layout logic, so relative positioning transfers.
 */
export async function overlayTexts(
  plate: Buffer,
  analysis: CreativeAnalysis,
): Promise<Buffer> {
  ensureFontsRegistered();
  const img = await loadImage(plate);
  const W = img.width;
  const H = img.height;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, W, H);

  const blocks: PlacedBlock[] = analysis.textBlocks.map((t) => {
    const isHebrew = HEBREW_RE.test(t.text);
    const font = resolveFont({
      isHebrew,
      category: t.font.category,
      weight: t.font.weight,
      likelyFamily: t.font.likelyFamily,
    });
    return {
      lines: t.text.split("\n").map((l) => l.trim()).filter(Boolean),
      x: (t.bbox.x + t.bbox.w / 2) * W,
      y: t.bbox.y * H,
      w: t.bbox.w * W,
      h: t.bbox.h * H,
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
    ctx.fillStyle = b.color;

    const lineHeight = size * 1.15;
    const totalH = lineHeight * b.lines.length;
    const startY = b.y + Math.max(0, (b.h - totalH) / 2) + lineHeight / 2;
    b.lines.forEach((line, i) => {
      ctx.fillText(line, b.x, startY + i * lineHeight);
    });
  }

  return canvas.encode("png");
}
