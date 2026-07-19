"use client";

/**
 * Last-resort boundary (errors thrown in the root layout). Rendered without
 * the app's CSS pipeline, so styles are inline.
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="he" dir="rtl">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#0a0a0b", color: "#f4f4f5", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ textAlign: "center", padding: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>משהו השתבש</h2>
          <p style={{ fontSize: 14, color: "#9d9da6", marginTop: 8 }}>רענון העמוד אמור לפתור את זה.</p>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 20, background: "#d4f640", color: "#0c0e02", border: 0, borderRadius: 10, padding: "10px 24px", fontWeight: 600, cursor: "pointer" }}
          >
            רענן את העמוד
          </button>
          <button
            onClick={reset}
            style={{ marginTop: 20, marginRight: 10, background: "#1a1a1e", color: "#f4f4f5", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10, padding: "10px 20px", fontWeight: 600, cursor: "pointer" }}
          >
            נסה שוב
          </button>
        </div>
      </body>
    </html>
  );
}
