import type { ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'

// Placeholder shown until the first version of this app is built: replace this whole file with the app's home page.
export const Route = createFileRoute('/')({
  head: () => ({ meta: [{ title: 'Your app is on its way' }] }),
  component: Placeholder,
})

const STYLES = `
@keyframes bc-rise { 0%, 6% { opacity: 0; transform: translateY(8px) } 16%, 78% { opacity: 1; transform: none } 90%, 100% { opacity: 0; transform: translateY(-4px) } }
@keyframes bc-glow { 0%, 100% { opacity: 0.45; transform: scale(0.92) } 50% { opacity: 0.9; transform: scale(1.06) } }
@keyframes bc-sheen { from { background-position: 200% 0 } to { background-position: -200% 0 } }
@keyframes bc-slide { from { transform: translateX(-100%) } to { transform: translateX(300%) } }
.bc-rise { animation: bc-rise 5.6s cubic-bezier(0.2, 0.7, 0.2, 1) infinite both }
.bc-glow { background: radial-gradient(closest-side, rgba(240, 120, 40, 0.28), transparent); animation: bc-glow 4s ease-in-out infinite }
.bc-sheen { background-image: linear-gradient(90deg, #27272a 0%, #3f3f46 50%, #27272a 100%); background-size: 200% 100%; animation: bc-sheen 2.4s linear infinite }
.bc-ember { background-image: linear-gradient(135deg, #ffb972, #e55b00) }
.bc-slide { animation: bc-slide 1.6s ease-in-out infinite }
@media (prefers-reduced-motion: reduce) { .bc-rise, .bc-glow, .bc-sheen, .bc-slide { animation: none } }
`

/** The pieces of a page, appearing one after another as if the app were putting itself together. */
function Piece({ delay, className, children }: { delay: number; className: string; children?: React.ReactNode }) {
  return (
    <div className={`bc-rise ${className}`} style={{ animationDelay: `${delay}s` }}>
      {children}
    </div>
  )
}

function Placeholder() {
  return (
    // data-monstarx-starter tells the workspace this is still the placeholder and not the app, so a
    // preview left showing it after the home page was written is reloaded instead of sat on.
    <main
      data-monstarx-starter=""
      className="fixed inset-0 flex flex-col items-center justify-center gap-10 overflow-hidden bg-neutral-950 p-6 text-center text-neutral-100"
    >
      <style>{STYLES}</style>
      <div className="relative w-72 max-w-full">
        <div className="bc-glow absolute -inset-16 rounded-full" />
        <div className="relative overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 text-left shadow-2xl">
          <div className="flex items-center gap-1.5 border-b border-neutral-800 px-3 py-2.5">
            <span className="size-2 rounded-full bg-neutral-700" />
            <span className="size-2 rounded-full bg-neutral-700" />
            <span className="size-2 rounded-full bg-neutral-700" />
            <span className="bc-sheen ml-3 h-2 flex-1 rounded-full" />
          </div>
          <div className="flex flex-col gap-4 p-4">
            <Piece delay={0} className="flex items-center justify-between">
              <span className="bc-ember h-2.5 w-14 rounded-full" />
              <span className="flex gap-2">
                <span className="h-2 w-6 rounded-full bg-neutral-700" />
                <span className="h-2 w-6 rounded-full bg-neutral-700" />
                <span className="h-2 w-6 rounded-full bg-neutral-700" />
              </span>
            </Piece>
            <Piece delay={0.3} className="flex flex-col gap-2 pt-2">
              <span className="bc-sheen h-3.5 w-4/5 rounded-full" />
              <span className="bc-sheen h-3.5 w-3/5 rounded-full" />
            </Piece>
            <Piece delay={0.6} className="flex flex-col gap-1.5">
              <span className="h-2 w-full rounded-full bg-neutral-800" />
              <span className="h-2 w-5/6 rounded-full bg-neutral-800" />
            </Piece>
            <Piece delay={0.9} className="flex gap-2">
              <span className="bc-ember h-6 w-20 rounded-md" />
              <span className="h-6 w-16 rounded-md border border-neutral-700" />
            </Piece>
            <div className="grid grid-cols-3 gap-2 pt-1">
              <Piece delay={1.2} className="h-14 rounded-lg border border-neutral-800 bg-neutral-800/60" />
              <Piece delay={1.4} className="h-14 rounded-lg border border-neutral-800 bg-neutral-800/60" />
              <Piece delay={1.6} className="h-14 rounded-lg border border-neutral-800 bg-neutral-800/60" />
            </div>
          </div>
        </div>
      </div>
      <div className="flex max-w-sm flex-col items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Your app is on its way</h1>
        <p className="text-sm leading-relaxed text-neutral-400">It will appear here as soon as the first version is built.</p>
        <div className="mt-1 h-1 w-40 overflow-hidden rounded-full bg-neutral-800">
          <div className="bc-slide bc-ember h-full w-1/3 rounded-full" />
        </div>
      </div>
    </main>
  )
}
