# פריסה ל-Vercel — צעד אחר צעד

האפליקציה חסרת-מצב (stateless) ו-Vercel-ready. הפריסה מ-GitHub (ענף `main`, מעודכן).

## שלב 1 — ייבוא הפרויקט
1. היכנס ל-https://vercel.com והתחבר עם חשבון ה-GitHub שלך.
2. **Add New… → Project**.
3. בחר את הריפו **`Ilay-bag/BULCREATIVE`** ולחץ **Import**.
   (Framework: Next.js — יזוהה אוטומטית. Build/Output — השאר ברירת מחדל.)

## שלב 2 — משתני סביבה (Environment Variables)
לפני ה-Deploy, תחת **Environment Variables**, הוסף את שני אלה (Production + Preview):

| Name | Value |
|---|---|
| `OPENROUTER_API_KEY` | המפתח שלך מ-OpenRouter (מתחיל ב-`sk-or-v1-…`) |
| `KIE_API_KEY` | המפתח שלך מ-KIE.AI |

> אל תדביק מפתחות בקוד או ב-README — רק כאן, בהגדרות של Vercel.

## שלב 3 — Deploy
לחץ **Deploy**. Vercel יבנה ויפרוס. בסיום תקבל כתובת `https://<project>.vercel.app`.

---

## חשוב — מגבלת זמן של פונקציות (Function Duration)
קריאות ה"חשיבה" של המודל (סריקה / עיצוב מודעה / תכנון) יכולות לקחת 60–120 שניות.
- ה-routes הכבדים מוגדרים ל-`maxDuration = 300` (התקרה של **Vercel Pro**).
- ב-**Vercel Hobby (חינם)** התקרה היא 60 שניות — קריאות איטיות עלולות להיקטע.
  אם אתה על Hobby ורואה timeouts בסריקה/עיצוב, שדרג ל-Pro.

## הערות
- ייצור התמונות דורש **יתרת קרדיטים ב-KIE.AI** — ודא שיש יתרה ב-kie.ai.
- אחרי הפריסה מומלץ **לסובב את מפתחות ה-API** (הם נחשפו בצ'אט) ולעדכן את הערכים ב-Vercel.
- כל push חדש ל-`main` יפרוס אוטומטית מחדש.
