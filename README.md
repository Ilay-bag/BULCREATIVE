# BULCREATIVE 🎨⚡

**מכונת BULK CREATIVE** — מעלים קריאייטיב שיווקי אחד, מקבלים עד 40 וריאציות:
אותו מוצר, **אותו טקסט (מילה במילה), אותו פונט** — עם ויז'ואל רענן וזווית שיווקית חדשה בכל וריאציה.

## איך זה עובד

```
קריאייטיב אחד
   → (1) ANALYZE   — MiniMax M3 (ראייה + חשיבה) סורק: טקסטים מדויקים, פונטים, מוצר, זווית
   → (2) STRATEGY  — מתכנן N בריפים: זווית שיווקית שונה + שינויים ויזואליים קטנים לכל וריאציה
   → (3) PROMPT    — כותב הנחיית ייצור מדויקת לכל וריאציה
   → (4) GENERATE  — KIE.AI (GPT Image 2, image-to-image, 2K) מייצר עם המקור כ-reference
   → גלריה חיה + הורדה בודדת + ZIP של הכל
```

- **מוח:** [MiniMax M3](https://openrouter.ai/minimax/minimax-m3) דרך OpenRouter — מולטימודלי נייטיב,
  1M קונטקסט, מצב חשיבה מופעל בשלבי הניתוח והאסטרטגיה.
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
| `OPENROUTER_API_KEY` | מפתח OpenRouter (מוח החשיבה — MiniMax M3) |
| `KIE_API_KEY` | מפתח KIE.AI (ייצור תמונות + אחסון זמני של המקור) |

פתח `http://localhost:3000`, גרור קריאייטיב (PNG/JPEG/WebP עד 9MB), בחר כמות וריאציות (1–40) ולחץ צור.

## ארכיטקטורה

```
app/
  page.tsx                          # מסך יחיד: העלאה → התקדמות → גלריה (עברית, RTL)
  api/jobs/route.ts                 # POST — יצירת משימת bulk והפעלת הצינור
  api/jobs/[id]/route.ts            # GET — סטטוס חי (ה-UI עושה polling כל 2 שניות)
  api/jobs/[id]/images/[vid]/route.ts  # GET — הגשת תמונה מוכנה מהדיסק המקומי
  api/jobs/[id]/zip/route.ts        # GET — הורדת כל התוצאות כ-ZIP
lib/
  jobs.ts        # ה-orchestrator: store + צינור מלא + ניהול תור מול rate limits
  minimax.ts     # עטיפת OpenRouter: ראייה, thinking on/off, JSON + ולידציית Zod עם retry
  kie.ts         # עטיפת KIE: העלאת קובץ, createTask, polling, הורדה מיידית
  skills.ts      # טעינת מסמכי Skills והרכבת system prompts
  schemas.ts     # סכמות Zod לכל פלט מודל + טיפוסי מצב המשימה
  fetch.ts       # fetch יוצא שמכבד HTTPS_PROXY כשקיים
skills/
  01-analyze-creative.md       # איך לסרוק קריאייטיב (טקסט verbatim, פורנזיקת פונטים)
  02-variation-strategy.md     # איך לבנות בריפים עם זוויות שיווקיות מגוונות
  03-image-prompt-authoring.md # איך לכתוב prompt מנצח ל-GPT Image 2
  _shared/style-guardrails.md  # כללי הברזל: טקסט/פונט/מותג/מוצר קדושים
```

### נקודות עיצוב חשובות

- **URL תוצאה של KIE פג אחרי ~20 דקות** — לכן כל תמונה מורדת לדיסק (`.data/`) ברגע שהיא מוכנה,
  וה-UI מגיש אותה מקומית.
- **Rate limit של KIE (~20 בקשות/10 שניות)** — שליחת המשימות מרווחת (700ms בין משימות)
  עם backoff אקספוננציאלי על 429.
- **אמינות JSON בכמויות גדולות** — בריפים ופרומפטים נוצרים במנות של 10, עם ולידציית Zod
  ו-retry אוטומטי שמזין למודל את שגיאת הוולידציה.
- **וריאציה שנכשלת** מקבלת ניסיון ייצור נוסף אוטומטית לפני שהיא מסומנת ככשלון.

## מפת דרכים (שלב 2)

- שכבת טקסט היברידית: GPT Image מייצר רקע בלבד, הטקסט מוטבע ב-Canvas עם פונט תואם — פיקסל-פרפקט.
- זיהוי/התאמת פונט אוטומטיים (Google Fonts).
- משתמשים + היסטוריה (Postgres/Prisma).
- Callback webhook מ-KIE במקום polling (בפריסה ציבורית).
