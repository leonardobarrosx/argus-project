import { useState } from 'react'
import { UserPlus, Search, UserRound, ClipboardPlus, ChevronRight, Users } from 'lucide-react'
import type { Patient, Prescription, ServiceOrder, Sale } from '../types'
import { parseDMY, daysBetween, TODAY_D } from '../utils/helpers'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'

export function PatientsPage({ patients, prescriptions, orders, sales, onSelectPatient, onNewPatient, onNewRx }: {
  patients: Patient[]; prescriptions: Prescription[]; orders: ServiceOrder[]; sales: Sale[];
  onSelectPatient: (id: number) => void; onNewPatient?: () => void; onNewRx?: (pid: number) => void
}) {
  const [filter, setFilter] = useState('')
  const mainClients = patients.filter(p => !p.parentId)
  const filtered = filter ? mainClients.filter(p => p.name.toLowerCase().includes(filter.toLowerCase()) || (p.cpf && p.cpf.includes(filter)) || (p.phone && p.phone.replace(/\D/g, '').includes(filter.replace(/\D/g, '') || '§'))) : mainClients
  const getDeps = (id: number) => patients.filter(p => p.parentId === id)

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Clientes & Pacientes</h1>
          <p className="mt-0.5 text-[13px] text-slate-400">{mainClients.length} clientes · {patients.length - mainClients.length} dependentes · {prescriptions.length} receitas</p>
        </div>
        {onNewPatient && (
          <button onClick={onNewPatient} className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 active:scale-[0.98]">
            <UserPlus className="h-4 w-4" /> Novo cliente
          </button>
        )}
      </div>

      <Card>
        <div className="mb-4">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filtrar por nome, CPF ou telefone…"
              className="h-10 w-full rounded-xl border border-slate-200/80 bg-slate-50/80 pl-10 pr-4 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100" />
          </div>
        </div>
        <div className="max-h-[520px] space-y-1 overflow-y-auto pr-1">
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">Nenhum cliente encontrado</p>
          ) : filtered.map(p => {
            const deps = getDeps(p.id)
            const rxCount = prescriptions.filter(r => r.patientId === p.id).length
            const orderCount = orders.filter(o => o.patientId === p.id).length
            const saleCount = sales.filter(s => s.patientId === p.id).length
            const latestRx = prescriptions.filter(r => r.patientId === p.id).slice(-1)[0]
            const daysToExpiry = latestRx ? (() => { const exp = parseDMY(latestRx.expiresAt); return exp ? daysBetween(TODAY_D, exp) : 999 })() : 999

            return (
              <div key={p.id}>
                <div className="flex items-center justify-between rounded-xl px-3 py-3 transition hover:bg-slate-50">
                  <button onClick={() => onSelectPatient(p.id)} className="flex items-center gap-3 text-left">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-brand-500"><UserRound className="h-4 w-4" /></div>
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{p.name}</p>
                      <p className="text-xs text-slate-400">{p.cpf || p.phone || 'Sem documento'} · {rxCount} rx · {orderCount} OS · {saleCount} compra(s){deps.length > 0 ? ` · ${deps.length} dep.` : ''}</p>
                    </div>
                  </button>
                  <div className="flex items-center gap-2">
                    {daysToExpiry <= 30 && daysToExpiry > 0 && <Badge color="amber">Rx vence em {daysToExpiry}d</Badge>}
                    {daysToExpiry <= 0 && <Badge color="rose">Rx vencida</Badge>}
                    {onNewRx && (
                      <button onClick={() => onNewRx(p.id)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-600 transition hover:border-brand-300 hover:text-brand-600">
                        <ClipboardPlus className="mr-1 inline h-3 w-3" /> Rx
                      </button>
                    )}
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                  </div>
                </div>
                {/* Dependents */}
                {deps.length > 0 && (
                  <div className="ml-10 space-y-0.5 mb-1">
                    {deps.map(d => {
                      const dRxCount = prescriptions.filter(r => r.patientId === d.id).length
                      return (
                        <div key={d.id} className="flex items-center justify-between rounded-lg px-3 py-2 transition hover:bg-slate-50">
                          <button onClick={() => onSelectPatient(d.id)} className="flex items-center gap-2 text-left">
                            <Users className="h-3.5 w-3.5 text-slate-300" />
                            <div>
                              <p className="text-xs font-medium text-slate-600">{d.name} <span className="text-slate-300">(dependente)</span></p>
                              <p className="text-[11px] text-slate-400">{dRxCount} rx</p>
                            </div>
                          </button>
                          {onNewRx && (
                            <button onClick={() => onNewRx(d.id)} className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[10px] font-medium text-slate-500 transition hover:border-brand-300 hover:text-brand-600">
                              <ClipboardPlus className="mr-0.5 inline h-2.5 w-2.5" /> Rx
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><p className="text-[13px] text-slate-400">Receitas ativas</p><p className="mt-1 text-2xl font-bold text-slate-900">{prescriptions.filter(r => { const e = parseDMY(r.expiresAt); return e ? daysBetween(TODAY_D, e) > 0 : false }).length}</p></Card>
        <Card><p className="text-[13px] text-slate-400">Expirando em 30 dias</p><p className="mt-1 text-2xl font-bold text-amber-600">{prescriptions.filter(r => { const e = parseDMY(r.expiresAt); if (!e) return false; const d = daysBetween(TODAY_D, e); return d > 0 && d <= 30 }).length}</p></Card>
        <Card><p className="text-[13px] text-slate-400">Total vendas</p><p className="mt-1 text-2xl font-bold text-slate-900">R$ {sales.reduce((s, x) => s + x.total, 0).toFixed(2)}</p></Card>
      </div>
    </>
  )
}
