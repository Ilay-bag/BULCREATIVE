import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { writeFileSync } from "node:fs";
import path from "node:path";

const FONTS = new URL("../assets/fonts", import.meta.url).pathname;
for (const [file, family] of [
  ["Heebo-900.ttf", "Heebo"],
  ["Heebo-400.ttf", "Heebo"],
  ["SecularOne-400.ttf", "Secular One"],
  ["FrankRuhlLibre-700.ttf", "Frank Ruhl Libre"],
  ["Rubik-700.ttf", "Rubik"],
]) {
  const ok = GlobalFonts.registerFromPath(path.join(FONTS, file), family);
  console.log("register", file, ok);
}

const c = createCanvas(1000, 700);
const ctx = c.getContext("2d");
ctx.fillStyle = "#f5ede2";
ctx.fillRect(0, 0, 1000, 700);
ctx.textAlign = "center";
ctx.textBaseline = "middle";
ctx.direction = "rtl";
ctx.fillStyle = "#3a2417";

const rows = [
  ["Heebo", 900, 64, "זוהר טבעי לעור שלך"],        // headline w/ final ך
  ["Heebo", 400, 36, "סרום ויטמין C בריכוז גבוה"],  // mixed Hebrew+Latin
  ["Secular One", 400, 48, "30% הנחה לזמן מוגבל!"],  // mixed digits+Hebrew, final ם
  ["Frank Ruhl Libre", 700, 44, "יופי שמתחיל מבפנים"],
  ["Rubik", 700, 40, "קני עכשיו · משלוח חינם"],      // final ם
  ["Heebo", 400, 24, "המבצע עד גמר המלאי. ט.ל.ח"],
];
rows.forEach(([fam, w, size, text], i) => {
  ctx.font = `${w} ${size}px "${fam}"`;
  const m = ctx.measureText(text);
  console.log(`row${i} [${fam} ${w}] width=${Math.round(m.width)} : ${text}`);
  ctx.fillText(text, 500, 70 + i * 110);
});

writeFileSync("scripts/hebrew-render.png", c.encode("png").constructor === Promise ? await c.encode("png") : c.encode("png"));
console.log("saved hebrew-render.png");
