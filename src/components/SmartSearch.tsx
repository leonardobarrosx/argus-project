import { useState, useEffect, useRef } from 'react'
import { Search, UserRound, FileText } from 'lucide-react'
import type { Patient, ServiceOrder } from '../types'
import { useClickOutside } from '../hooks/useClickOutside'

export function SmartSearch({ patients, orders, onSelectPatient, onSelectOrder }: {
  patients: Patient[]; orders: ServiceOrder[]; onSelectPatient: (p: Patient) => void; onSelectOrder: (o: ServiceOrder) => void
}) {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useClickOutside(ref, () => setFocused(false))

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); inputRef.current?.focus() } }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const q = query.toLowerCase()
  const fPatients = query.length >= 2 ? patients.filter(p => p.name.toLowerCase().includes(q) || p.cpf.includes(query)).slice(0, 4) : []
  const fOrders = query.length >= 2 ? orders.filter(o => o.id.toLowerCase().includes(q)).slice(0, 3) : []

  return (
    <div ref={ref} className="relative flex-1 sm:max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
      <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} onFocus={() => setFocused(true)}
        placeholder="Buscar paciente, CPF ou OS…"
        className="h-10 w-full rounded-xl border border-slate-200/80 bg-slate-50/80 pl-10 pr-4 sm:pr-16 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100" />
      <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md sm:block border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">Ctrl K</kbd>
      {focused && (fPatients.length > 0 || fOrders.length > 0) && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-full animate-fadeIn rounded-xl bg-white py-1 shadow-dropdown">
          {fPatients.length > 0 && <p className="px-4 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-300">Pacientes</p>}
          {fPatients.map(p => (
            <button key={p.id} onClick={() => { onSelectPatient(p); setQuery(''); setFocused(false) }}
              className="flex w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-slate-50">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><UserRound className="h-4 w-4" /></div>
              <div><p className="text-sm font-medium text-slate-800">{p.name}</p><p className="text-xs text-slate-400">{p.cpf}</p></div>
            </button>
          ))}
          {fOrders.length > 0 && <p className="px-4 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-300">Ordens de serviço</p>}
          {fOrders.map(o => (
            <button key={o.id} onClick={() => { onSelectOrder(o); setQuery(''); setFocused(false) }}
              className="flex w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-slate-50">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><FileText className="h-4 w-4" /></div>
              <div><p className="text-sm font-medium text-slate-800">{o.id}</p><p className="text-xs text-slate-400">Status: {o.status}</p></div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
