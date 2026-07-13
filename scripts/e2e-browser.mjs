// Browser E2E: drives the real client UI (the Vercel flow) end to end.
import { chromium } from "playwright-core";
import fs from "node:fs";

const EXE = fs.readFileSync("/tmp/chpath.txt", "utf-8").trim();
const BASE = "http://localhost:3457";
const SAMPLE = process.argv[2];
const OUT = process.argv[3];
const EDIT_HEADLINE = process.argv[4]; // optional: correct the headline to prove edits flow
const COUNT = process.argv[5] || "1";

const browser = await chromium.launch({
  executablePath: EXE,
  args: ["--no-sandbox", "--disable-gpu", "--proxy-server=direct://", "--proxy-bypass-list=*"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
page.on("request", (req) => {
  if (req.url().includes("/api/image")) {
    const pd = req.postData() || "";
    console.log("  [REQ image] len", pd.length, "→", pd.slice(0, 180));
  }
});
page.on("response", async (r) => {
  if (r.url().includes("/api/") && !r.ok()) {
    let body = "";
    try { body = (await r.text()).slice(0, 300); } catch {}
    console.log(`  [${r.status()}] ${r.url().split("/api/")[1]} → ${body}`);
  }
});

try {
  await page.goto(BASE, { waitUntil: "networkidle" });

  await page.$eval(
    'input[type="range"]',
    (el, count) => {
      const s = el;
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(s, count);
      s.dispatchEvent(new Event("input", { bubbles: true }));
    },
    COUNT,
  );

  // upload
  await page.setInputFiles('input[type="file"]', SAMPLE);
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: /סרוק והתחל/ }).click();

  // wait for review screen
  await page.getByRole("button", { name: /אשר וצור/ }).waitFor({ timeout: 120000 });
  console.log("REACHED REVIEW");
  const fields = await page.$$eval("textarea", (els) => els.map((e) => e.value));
  console.log("extracted:", JSON.stringify(fields));

  if (EDIT_HEADLINE) {
    // edit the longest field (headline) to prove corrections flow through
    const areas = await page.$$("textarea");
    let idx = 0, max = 0;
    for (let i = 0; i < fields.length; i++) if (fields[i].length > max) { max = fields[i].length; idx = i; }
    await areas[idx].fill(EDIT_HEADLINE);
    console.log("edited field", idx, "->", EDIT_HEADLINE);
  }

  await page.getByRole("button", { name: /אשר וצור/ }).click();
  console.log("CONFIRMED — generating...");

  // wait until a variation image appears (done) or failure, up to 6 min
  await page.waitForFunction(
    () => {
      const imgs = document.querySelectorAll(".grid img");
      if (imgs.length > 0) return true;
      const failed = document.querySelector(".bg-red-500\\/10");
      return !!failed;
    },
    undefined,
    { timeout: 360000, polling: 3000 },
  );

  const gotImg = await page.$$eval(".grid img", (els) => els.length);
  console.log("gallery images:", gotImg);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT, fullPage: true });
  console.log("SCREENSHOT ->", OUT);

  // also grab the generated image blob to a file for inspection
  const dataUrl = await page.$eval(".grid img", (el) =>
    fetch(el.src).then((r) => r.blob()).then((b) => new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.readAsDataURL(b);
    })),
  );
  const b64 = dataUrl.split(",")[1];
  fs.writeFileSync(OUT.replace(/\.png$/, "-variation.png"), Buffer.from(b64, "base64"));
  console.log("VARIATION SAVED");
  console.log("E2E_OK");
} catch (e) {
  console.log("E2E_FAIL:", e.message);
  await page.screenshot({ path: OUT.replace(/\.png$/, "-fail.png"), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
