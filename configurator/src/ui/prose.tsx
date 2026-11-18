import type { ReactNode } from 'react'

// The two looks that running text shares: the guide and the start screen both use them.

/** A link in running text. */
export const LINK = 'text-sky-400 underline-offset-4 hover:underline'

/** The name of something on screen. */
export function Strong({ children }: Readonly<{ children: ReactNode }>) {
  return <strong className="font-semibold text-zinc-100">{children}</strong>
}
