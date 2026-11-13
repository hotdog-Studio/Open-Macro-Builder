import type { ReactNode } from 'react'
import { OverlayPreview } from './OverlayPreview'

/** Shared classes, from the approved prototype. */
export const STYLE = {
  heading: 'mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-zinc-500',
  input:
    'w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-zinc-100 outline-none focus:border-sky-500 disabled:opacity-50',
  label: 'mb-1 mt-3 block text-[11px] text-zinc-400',
  button: 'rounded-md border border-zinc-700 px-2.5 py-1 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50',
  note: 'mt-2 text-[11px] text-zinc-500',
}

/** The three columns of every tab: options on the left, the pad in the middle, details on the right. */
export function LeftPanel({ children }: Readonly<{ children?: ReactNode }>) {
  return <aside className="w-60 shrink-0 overflow-y-auto border-r border-zinc-800 bg-zinc-900 p-3">{children}</aside>
}

export function CentrePanel({ children }: Readonly<{ children?: ReactNode }>) {
  // Centred only while it fits ("safe"): plain centring pushes the left edge of a pad wider than the
  // panel out where no scrolling reaches it.
  return <main className="flex min-w-0 flex-1 flex-col items-center-safe gap-3 overflow-auto p-5">{children}</main>
}

/** `preview` adds the overlay preview under the details (the Commands tab has none). */
export function RightPanel({ children, preview = true }: Readonly<{ children?: ReactNode; preview?: boolean }>) {
  return (
    <aside className="w-72 shrink-0 overflow-y-auto border-l border-zinc-800 bg-zinc-900 p-3">
      {children}
      {preview && <OverlayPreview />}
    </aside>
  )
}
