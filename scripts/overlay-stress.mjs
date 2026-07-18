/**
 * Overlay engine stress test: feeds a deliberately broken layout
 * (overlapping boxes, off-margin positions, low-contrast colors) and renders
 * the result so the sanitizer + contrast guard can be inspected visually.
 *   node scripts/overlay-stress.mjs [out.png]
 */
import { createCanvas } from "@napi-rs/canvas";
import { writeFileSync } from "node:fs";

// build a mid-gray busy plate (worst case for contrast)
const W = 1024, H = 1024;
const c = createCanvas(W, H);
const ctx = c.getContext("2d");
const grad = ctx.createLinearGradient(0, 0, W, H);
grad.addColorStop(0, "#8a8a8a");
grad.addColorStop(0.5, "#6f6f6f");
grad.addColorStop(1, "#9a9a9a");
ctx.fillStyle = grad;
ctx.fillRect(0, 0, W, H);
for (let i = 0; i < 300; i++) {
  ctx.fillStyle = `rgba(${100 + Math.random() * 80},${100 + Math.random() * 80},${100 + Math.random() * 80},0.35)`;
  ctx.beginPath();
  ctx.arc(Math.random() * W, Math.random() * H, 8 + Math.random() * 30, 0, 7);
  ctx.fill();
}
const plate = await c.encode("png");

// bundle path is produced by: npx esbuild lib/overlay.ts --bundle --platform=node
//   --format=esm --external:@napi-rs/canvas --outfile=scripts/.overlay-bundle.mjs
const { overlayTexts } = await import("./.overlay-bundle.mjs");

const analysis = {
  textBlocks: [
    // gray text on gray plate → contrast guard must flip it
    { id: "t1", text: "לחות טבעית לעור שלך", role: "headline", language: "he",
      font: { likelyFamily: "Heebo", category: "sans-serif", weight: "black", case: "mixed", letterSpacing: "normal", italic: false },
      color: "#7a7a7a", bbox: { x: 0.1, y: 0.08, w: 0.8, h: 0.12 } },
    // overlaps the headline → sanitizer must push it down
    { id: "t2", text: "קרם אלוורה אורגני", role: "subheadline", language: "he",
      font: { likelyFamily: "Assistant", category: "sans-serif", weight: "regular", case: "mixed", letterSpacing: "normal", italic: false },
      color: "#ffffff", bbox: { x: 0.15, y: 0.12, w: 0.7, h: 0.07 } },
    // off-canvas x → clamped inside margins
    { id: "t3", text: "30% הנחה", role: "badge", language: "he",
      font: { likelyFamily: "Secular One", category: "display", weight: "bold", case: "mixed", letterSpacing: "normal", italic: false },
      color: "#ffee00", bbox: { x: -0.05, y: 0.4, w: 0.3, h: 0.08 } },
    // hangs off the bottom edge → clamped
    { id: "t4", text: "קני עכשיו", role: "cta", language: "he",
      font: { likelyFamily: "Rubik", category: "sans-serif", weight: "bold", case: "mixed", letterSpacing: "wide", italic: false },
      color: "#111111", bbox: { x: 0.3, y: 0.97, w: 0.4, h: 0.08 } },
  ],
  product: "קרם", category: "טיפוח", brand: {}, colors: [], toneOfVoice: "",
  visualStyle: "-", marketingAngle: "-", aspectRatio: "1:1",
};

const out = await overlayTexts(plate, analysis);
const dest = process.argv[2] ?? "scripts/overlay-stress.png";
writeFileSync(dest, out);
console.log("rendered", dest);
