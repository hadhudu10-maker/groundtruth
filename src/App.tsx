import { Radio } from 'lucide-react'

export default function App() {
  return (
    <main className="min-h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
      <Radio className="size-10 text-emerald-400" />
      <h1 className="text-3xl font-semibold">Groundtruth</h1>
      <p className="text-slate-400 max-w-sm">
        Signed notes, passed hand to hand, kept in a notebook nobody can erase.
      </p>
      <p className="text-xs text-slate-500">Shell build. Works offline after first load.</p>
    </main>
  )
}
