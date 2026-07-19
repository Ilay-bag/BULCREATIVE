import CreativeMachine from "@/components/CreativeMachine";

export default function Home() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-8 text-center">
        <h1 className="text-5xl font-black tracking-tight">
          BUL<span className="text-gradient">CREATIVE</span>
        </h1>
        <p className="mt-3 text-lg text-zinc-400">
          מכונת קריאייטיבים — מעלים קריאייטיב אחד, מקבלים עשרות וריאציות.
        </p>
        <p className="mt-1 text-sm text-zinc-500">
          אותו טקסט · אותו פונט · זווית שיווקית חדשה בכל וריאציה
        </p>
      </header>
      <CreativeMachine />
    </main>
  );
}
