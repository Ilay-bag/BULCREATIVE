"use client";

import { useEffect } from "react";

/**
 * Route-level error boundary. A stale tab from before a redeploy references
 * content-hashed chunks that no longer exist (ChunkLoadError) — that case is
 * self-healing: reload once to pick up the fresh HTML. Anything else shows a
 * styled retry screen instead of Next's white "Application error" page.
 */
const RELOAD_FLAG = "bulcreative-chunk-reload";

function isStaleChunkError(error: Error): boolean {
  return (
    error.name === "ChunkLoadError" ||
    /loading chunk|css chunk|failed to fetch dynamically imported module/i.test(error.message)
  );
}

export default function ErrorBoundary({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    if (isStaleChunkError(error) && !sessionStorage.getItem(RELOAD_FLAG)) {
      sessionStorage.setItem(RELOAD_FLAG, "1");
      window.location.reload();
    } else {
      sessionStorage.removeItem(RELOAD_FLAG);
    }
  }, [error]);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-6" dir="rtl">
      <div className="surface max-w-md rounded-2xl p-8 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-[color:var(--surface-3)] text-[color:var(--warn)]">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" />
          </svg>
        </span>
        <h2 className="mt-4 text-lg font-bold text-[color:var(--text)]">משהו השתבש</h2>
        <p className="mt-2 text-sm leading-relaxed text-[color:var(--text-2)]">
          אם עודכנה גרסה חדשה ברקע, רענון יפתור את זה.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button onClick={() => window.location.reload()} className="btn btn-primary h-10 px-6 text-sm">
            רענן את העמוד
          </button>
          <button onClick={reset} className="btn btn-secondary h-10 px-5 text-sm">
            נסה שוב
          </button>
        </div>
      </div>
    </div>
  );
}
