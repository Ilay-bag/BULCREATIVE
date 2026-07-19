import CreativeMachine from "@/components/CreativeMachine";

export default function Home() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-[color:var(--border)] bg-[color:var(--bg)]/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5">
          <div className="flex items-center gap-3">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-[color:var(--accent)] text-sm font-black text-[color:var(--accent-ink)]">
              B
            </span>
            <span className="text-base font-black tracking-tight" dir="ltr">
              BULCREATIVE<span className="text-[color:var(--accent)]">.</span>
            </span>
          </div>
          <span className="hidden text-xs text-[color:var(--text-3)] sm:block">
            סטודיו וריאציות קריאייטיב · טקסט מדויק בכל וריאציה
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8">
        <CreativeMachine />
      </main>
    </div>
  );
}
