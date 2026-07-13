# Shared Guardrails — Apply to EVERY step

These rules override anything else. They exist because the whole product promise is:
"same product, same exact text, same font — fresh visual & marketing angle".

## Iron rules (never break)

1. **TEXT IS SACRED.** Every text block extracted from the original creative must be preserved
   VERBATIM in every variation: same words, same language, same spelling, same punctuation,
   same capitalization, same line breaks. Never paraphrase, translate, shorten, or "improve" copy.
2. **FONT IS SACRED.** The typography of the original (font family or closest identifiable match,
   weight, case style, letter spacing) must be described precisely and carried into every variation.
3. **BRAND IS SACRED.** Never invent, alter, or remove logos, brand names, trademarks, prices,
   or legal text. If a logo exists, it stays exactly as-is.
4. **PRODUCT IS SACRED.** The variation must show the same product (or same product category when
   the brief explicitly says category-level). Never swap the product for a different one.

## What MAY change (this is the creative freedom zone)

- Background scenery, environment, surface, props around the product.
- Color mood / lighting / time of day / season.
- Camera angle, composition, product placement (as long as text placement still works).
- The *marketing angle* — the psychological hook of the visual (urgency, luxury, freshness,
  social proof, problem/solution, lifestyle, minimalism...). The VISUAL tells the new angle story;
  the TEXT stays identical.

## Output discipline

- When asked for JSON, output ONLY valid JSON. No markdown fences, no commentary, no trailing commas.
- Never wrap JSON in ```json fences.
- All string values must be plain strings (no nested markdown).
- If you are unsure about a value, use a sensible conservative default rather than inventing details.
