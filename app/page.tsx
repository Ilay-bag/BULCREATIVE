import CreativeMachine from "@/components/CreativeMachine";

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-black tracking-tight">
          BUL<span className="text-fuchsia-400">CREATIVE</span>
        </h1>
        <p className="mt-2 text-lg text-zinc-400">
          מכונת קריאייטיבים — מעלים קריאייטיב אחד, מקבלים עשרות וריאציות.
          <br />
          <span className="text-zinc-500 text-sm">
            אותו טקסט. אותו פונט. זווית שיווקית חדשה בכל וריאציה.
          </span>
        </p>
      </header>
      <CreativeMachine />
    </main>
  );
}
