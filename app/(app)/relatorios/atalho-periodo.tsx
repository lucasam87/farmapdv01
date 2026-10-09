'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

export default function AtalhoPeriodo({
  href,
  testId,
  children,
}: {
  href: string
  testId: string
  children: ReactNode
}) {
  return (
    <Link
      href={href}
      onClick={() => document.querySelector<HTMLFormElement>('#filtro-periodo')?.reset()}
      data-testid={testId}
      className="rounded-lg border border-slate-300 px-4 py-2 text-base font-medium text-slate-700 hover:bg-slate-100"
    >
      {children}
    </Link>
  )
}
