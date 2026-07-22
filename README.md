# BULCREATIVE 🎨⚡

**מכונת BULK CREATIVE** — מעלים קריאייטיב שיווקי אחד, מקבלים עד 40 וריאציות:
אותו מוצר, **אותו טקסט (מילה במילה), אותו פונט** — עם ויז'ואל רענן וזווית שיווקית חדשה בכל וריאציה.

## איך זה עובד

```
קריאייטיב אחד
   → (1) ANALYZE   — Gemini 3 Flash (ראייה + חשיבה) סורק: טקסטים מדויקים, פונטים, מוצר, זווית
   → (2) REVIEW    — עוצר להצגת הטקסט שזוהה; המשתמש מאשר/מתקן (מבטיח עברית מושלמת)
   → (3) STRATEGY  — מתכנן N בריפים: זווית שיווקית שונה + שינויים ויזואליים קטנים לכל וריאציה
   → (4) PROMPT    — כותב הנחיית ייצור מדויקת לכל וריאציה
   → (5) GENERATE  — KIE.AI (GPT Image 2, image-to-image, 2K) מייצר עם המקור כ-reference
   → (6) OVERLAY   — [במצב עברית/מדויק] הטבעת הטקסט המאושר בפונט אמיתי — פיקסל-פרפקט
   → גלריה חיה + הורדה בודדת + ZIP של הכל
```

- **מוח:** [Gemini 3 Flash](https://openrouter.ai/google/gemini-3-flash-preview) דרך OpenRouter — מולטימודלי נייטיב,
  1M קונטקסט, מצב חשיבה מופעל בשלבי הניתוח והאסטרטגיה. ניתן להחלפה דרך `OPENROUTER_MODEL`.
- **ייצור תמונות:** [KIE.AI](https://docs.kie.ai) — מודל `gpt-image-2-image-to-image` ברזולוציית 2K.
- **מערכת Skills:** כל שלב בצינור מקבל מסמך הנחיות ב-`/skills` שמוזרק ל-system prompt —
  משפרים איכות ועקביות ע"י עריכת Markdown בלבד, בלי לגעת בקוד.

## הפעלה

```bash
npm install
cp .env.example .env.local   # ומלא את המפתחות
npm run dev
```

`.env.local`:

| משתנה | מה זה |
|---|---|
| `OPENROUTER_API_KEY` | מפתח OpenRouter (מוח החשיבה — Gemini 3 Flash) |
| `KIE_API_KEY` | מפתח KIE.AI (ייצור תמונות + אחסון זמני של המקור) |

פתח `http://localhost:3000`, גרור קריאייטיב (PNG/JPEG/WebP עד 9MB), בחר כמות וריאציות (1–40) ולחץ צור.

## ארכיטקטורה (חסרת-מצב — רצה גם ב-Vercel)

הצינור מתוזמן ב**צד-לקוח**: הדפדפן קורא לשרשרת של routes קצרים וחסרי-מצב, והמצב + התמונות
חיים בדפדפן. אין job-store בשרת ואין כתיבה לדיסק — כך זה עובד גם על שרת רגיל וגם על Vercel serverless
(שם כל פונקציה קצרה ומבודדת). מפתחות ה-API נשארים בשרת בלבד ולא נחשפים ללקוח.

```
app/
  page.tsx                # מסך יחיד (עברית, RTL)
  api/analyze/route.ts    # POST file → העלאה ל-KIE (sourceUrl) + ניתוח Gemini → {analysis, sourceUrl, renderMode}
  api/plan/route.ts       # POST → מנת בריפים+פרומפטים (עד 10); הלקוח קורא שוב עד שמגיע ל-count
  api/generate/route.ts   # POST {prompt, sourceUrl} → {taskId} (יצירת משימת KIE)
  api/kie-status/route.ts # GET ?taskId → {state, resultUrl}
  api/image/route.ts      # POST {resultUrl, mode, analysis?} → בייטים סופיים (overlay מרכיב טקסט; אחרת proxy)
components/
  CreativeMachine.tsx     # מתזמן את כל הצינור בצד-לקוח + ZIP בדפדפן (JSZip)
lib/
  pipeline.ts   # פונקציות טהורות: analyzeCreative, planChunk, resolveRenderMode, toKieAspectRatio
  minimax.ts    # עטיפת OpenRouter: ראייה, thinking on/off, JSON + ולידציית Zod עם retry
  kie.ts        # עטיפת KIE: העלאת קובץ, createTask, polling, הורדה (retry + אימות פורמט)
  overlay.ts    # הרכבת טקסט על רקע (Skia) + ניקוי chunks של C2PA מ-PNG
  fonts.ts      # רישום פונטים מוטמעים + מיפוי traits→פונט (עברי/לטיני)
  skills.ts / schemas.ts / fetch.ts
skills/         # מסמכי ההנחיה לכל שלב (01-analyze / 02-strategy / 03-prompt / _shared)
```

### נקודות עיצוב חשובות

- **חסר-מצב**: כל בקשה קצרה; אין תלות בזיכרון/דיסק משותף. מתאים ל-Vercel serverless.
- **URL תוצאה של KIE פג אחרי ~20 דקות** — הלקוח מושך כל תמונה מיד דרך `/api/image` לבלוב בדפדפן.
- **Rate limit של KIE (~20/10ש)** — הלקוח מרווח שליחות (700ms) עם backoff על 429.
- **C2PA**: פלטי GPT-Image מכילים chunks של Content Credentials ש-Skia לא מפרסר; `overlay.ts` מנקה
  אותם לפני ההרכבה.
- **הורדת תמונה עמידה**: `downloadImage` מנסה 5 פעמים ומאמת magic-bytes של PNG/JPEG/WebP.

## פריסה ל-Vercel

1. חבר את הריפו ל-Vercel (Import Project). Framework = Next.js (מזוהה אוטומטית).
2. הוסף Environment Variables: `OPENROUTER_API_KEY`, `KIE_API_KEY` (ל-Production ו-Preview).
3. Deploy. הפונטים (`public/fonts`) וה-skills נכללים אוטומטית ב-functions דרך
   `outputFileTracingIncludes` ב-`next.config.ts`; ה-binary של `@napi-rs/canvas` נכלל דרך
   `serverExternalPackages`.
4. **הערת מסלול (plan):** ל-`/api/analyze` ו-`/api/plan` יש `maxDuration = 60`. חשיבת Gemini
   על תמונה עשויה להתקרב ל-60ש — אם תראה timeouts, פרוס ב-Vercel **Pro** (עד 300ש) או הקטן
   כמות במנה. שאר ה-routes קצרים.
5. אין צורך ב-DB/Blob — המצב והתמונות בדפדפן.

## היועץ השיווקי 🧠

בשלב הסריקה/העיצוב המוח לא רק מתאר את הקריאייטיב — הוא גם מייעץ:

- **זיהוי סוג ההצעה** — מוצר בודד / קולקציה / פלאש סייל / מבצע / השקה / מותג.
- **רעיונות שיווק מותאמים** — 4–6 כיווני עיצוב קונקרטיים לסוג ההצעה שזוהה
  (פלאש סייל → מנגנוני דחיפות; קולקציה → הצגת ליין; מוצר → העמדת תועלת).
- **נקודות מכירה חלופיות** — 4–6 USP-ים אחרים להוביל איתם (משלוח חינם, איכות, אחריות...).

במסך האישור בוחרים הצעות בקליק — הרעיונות ונקודות המכירה שנבחרו מוזרמים לסקיל
האסטרטגיה ומקבלים בריפים ייעודיים; ליד כל נקודת מכירה יש ✍️ שמשכתב את הקופי סביבה.

## דיוק טקסט ועברית — איך זה מובטח

- **שלב REVIEW** — אחרי הסריקה המכונה עוצרת ומציגה את הטקסט שזוהה בשדות ניתנים לעריכה.
  המשתמש מתקן כל טעות קריאה ואז מאשר. כך גם אם ה-OCR טעה במילה, הטקסט הסופי מדויק ב-100%.
- **מנוע Overlay** — לעברית (ומצב "טקסט מדויק") מודל התמונה מייצר רק את הרקע; הטקסט המאושר
  מוטבע בשרת בפונט אמיתי (`@napi-rs/canvas` + Skia) עם יישור RTL — פיקסל-פרפקט, אותיות סופיות שלמות.
- **מצב GPT** — לאנגלית, GPT Image 2 מרנדר את הטקסט בעצמו (מהיר; טוב מאוד ללטינית).

## הערה על קרדיטים

ייצור התמונות צורך קרדיטים בחשבון KIE.AI. אם היתרה נגמרת, ה-UI מציג הודעה ברורה
("אין מספיק קרדיטים בחשבון KIE") — יש להטעין יתרה ב-[kie.ai](https://kie.ai).

## מפת דרכים (שלב 2)

- שכבת טקסט היברידית: GPT Image מייצר רקע בלבד, הטקסט מוטבע ב-Canvas עם פונט תואם — פיקסל-פרפקט.
- זיהוי/התאמת פונט אוטומטיים (Google Fonts).
- משתמשים + היסטוריה (Postgres/Prisma).
- Callback webhook מ-KIE במקום polling (בפריסה ציבורית).
