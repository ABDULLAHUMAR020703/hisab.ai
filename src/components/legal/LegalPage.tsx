import Link from 'next/link'
import { TrendingUp } from 'lucide-react'
import { legalConfig } from '@/lib/legal-config'

export interface LegalSection {
  id: string
  title: string
  children: React.ReactNode
}

function LegalFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between lg:px-8">
        <Link href="/" className="flex items-center gap-2 font-semibold text-slate-800">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
            <TrendingUp size={16} />
          </span>
          {legalConfig.productName}
        </Link>
        <nav aria-label="Legal navigation" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/terms" className="transition-colors hover:text-indigo-600">Terms of Service</Link>
          <Link href="/privacy" className="transition-colors hover:text-indigo-600">Privacy Policy</Link>
        </nav>
      </div>
    </footer>
  )
}

export function LegalPage({
  eyebrow,
  title,
  description,
  sections,
}: {
  eyebrow: string
  title: string
  description: string
  sections: LegalSection[]
}) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-700">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 lg:px-8">
          <Link href="/" className="flex items-center gap-3" aria-label="Return to hisab.ai">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-200">
              <TrendingUp size={20} />
            </span>
            <span className="text-xl font-bold text-slate-900">{legalConfig.productName}</span>
          </Link>
          <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-semibold text-indigo-600 transition-colors hover:bg-indigo-50">
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-10 px-5 py-12 lg:grid-cols-[220px_minmax(0,760px)] lg:px-8 lg:py-16">
        <aside className="self-start lg:sticky lg:top-6">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">{eyebrow}</p>
          <nav aria-label="Table of contents" className="mt-4 border-l border-slate-200 pl-4">
            <ol className="space-y-2 text-sm">
              {sections.map((section, index) => (
                <li key={section.id}>
                  <a href={`#${section.id}`} className="text-slate-500 transition-colors hover:text-indigo-600">
                    {index + 1}. {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        <article className="min-w-0 rounded-2xl border border-slate-200 bg-white px-6 py-8 shadow-sm sm:px-10 sm:py-12">
          <div className="border-b border-slate-200 pb-8">
            <p className="text-sm font-semibold text-indigo-600">{eyebrow}</p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{title}</h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">{description}</p>
            <p className="mt-5 text-sm text-slate-500"><span className="font-semibold text-slate-700">Last updated:</span> {legalConfig.effectiveDate}</p>
          </div>
          <div className="legal-document mt-8 space-y-9">
            {sections.map((section, index) => (
              <section key={section.id} id={section.id} className="scroll-mt-6">
                <h2 className="text-xl font-bold text-slate-900">{index + 1}. {section.title}</h2>
                <div className="mt-3 space-y-3 text-[15px] leading-7 text-slate-600">{section.children}</div>
              </section>
            ))}
          </div>
        </article>
      </main>
      <LegalFooter />
    </div>
  )
}

export function LegalList({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5">{children}</ul>
}

export function LegalCallout({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-indigo-950">{children}</div>
}
