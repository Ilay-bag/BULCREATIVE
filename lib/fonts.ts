/**
 * Bundled font registry + trait→font resolver for the text overlay engine.
 * All fonts are OFL-licensed Google Fonts, stored in /public/fonts so the
 * same files serve both the server-side overlay engine and the browser UI
 * (@font-face in globals.css) for WYSIWYG font preview.
 */
import path from "node:path";
import { GlobalFonts } from "@napi-rs/canvas";

const FONTS_DIR = path.join(process.cwd(), "public", "fonts");

/** family name → list of {weight, file}. Family names are what canvas font strings use. */
const REGISTRY: Record<string, { weight: number; file: string }[]> = {
  Heebo: [
    { weight: 400, file: "Heebo-400.ttf" },
    { weight: 700, file: "Heebo-700.ttf" },
    { weight: 900, file: "Heebo-900.ttf" },
  ],
  Rubik: [
    { weight: 400, file: "Rubik-400.ttf" },
    { weight: 700, file: "Rubik-700.ttf" },
  ],
  Assistant: [
    { weight: 400, file: "Assistant-400.ttf" },
    { weight: 700, file: "Assistant-700.ttf" },
  ],
  "Secular One": [{ weight: 400, file: "SecularOne-400.ttf" }],
  "Frank Ruhl Libre": [
    { weight: 400, file: "FrankRuhlLibre-400.ttf" },
    { weight: 700, file: "FrankRuhlLibre-700.ttf" },
  ],
  Alef: [
    { weight: 400, file: "Alef-400.ttf" },
    { weight: 700, file: "Alef-700.ttf" },
  ],
  "Varela Round": [{ weight: 400, file: "VarelaRound-400.ttf" }],
  Montserrat: [
    { weight: 400, file: "Montserrat-400.ttf" },
    { weight: 700, file: "Montserrat-700.ttf" },
    { weight: 900, file: "Montserrat-900.ttf" },
  ],
  Inter: [
    { weight: 400, file: "Inter-400.ttf" },
    { weight: 700, file: "Inter-700.ttf" },
  ],
  "Playfair Display": [
    { weight: 400, file: "PlayfairDisplay-400.ttf" },
    { weight: 700, file: "PlayfairDisplay-700.ttf" },
  ],
};

let registered = false;

/** Register all bundled fonts with the canvas engine (idempotent). */
export function ensureFontsRegistered(): void {
  if (registered) return;
  for (const [family, faces] of Object.entries(REGISTRY)) {
    for (const face of faces) {
      GlobalFonts.registerFromPath(path.join(FONTS_DIR, face.file), family);
    }
  }
  registered = true;
}

export interface ResolvedFont {
  family: string;
  weight: number;
}

const WEIGHT_MAP: Record<string, number> = {
  light: 400, // we don't bundle 300; closest sensible
  regular: 400,
  medium: 700,
  bold: 700,
  black: 900,
};

function nearestWeight(family: string, wanted: number): number {
  const faces = REGISTRY[family] ?? [];
  if (faces.length === 0) return 400;
  return faces.reduce((best, f) =>
    Math.abs(f.weight - wanted) < Math.abs(best - wanted) ? f.weight : best,
  faces[0].weight);
}

/**
 * Map analyzed font traits to a bundled family.
 * Hebrew text gets a Hebrew-capable family; Latin gets the classic ad faces.
 */
export function resolveFont(params: {
  isHebrew: boolean;
  category: string; // serif | sans-serif | slab | script | display | mono
  weight: string; // light | regular | medium | bold | black
  likelyFamily?: string;
}): ResolvedFont {
  const wantedWeight = WEIGHT_MAP[params.weight] ?? 400;

  // If the analysis already names one of our bundled families, honor it.
  const named = Object.keys(REGISTRY).find(
    (f) => params.likelyFamily?.toLowerCase().includes(f.toLowerCase()),
  );
  if (named) return { family: named, weight: nearestWeight(named, wantedWeight) };

  const cat = params.category.toLowerCase();
  let family: string;
  if (params.isHebrew) {
    if (cat.includes("serif") && !cat.includes("sans")) family = "Frank Ruhl Libre";
    else if (cat.includes("display")) family = "Secular One";
    else if (cat.includes("script")) family = "Varela Round"; // soft round ≈ closest Hebrew match
    else family = "Heebo";
  } else {
    if (cat.includes("serif") && !cat.includes("sans")) family = "Playfair Display";
    else if (cat.includes("display")) family = "Montserrat";
    else family = "Montserrat";
  }
  return { family, weight: nearestWeight(family, wantedWeight) };
}

export const HEBREW_RE = /[֐-׿]/;
