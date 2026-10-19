import { useState } from 'react'
import { Search, Plus, ChevronRight, Printer, Wallet, XCircle } from 'lucide-react'
import type { Patient, Prescription, ServiceOrder, StockItem } from '../types'
import { parseDMY, daysBetween, TODAY_D } from '../utils/helpers'
import { brl } from '../utils/format'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { SectionTitle } from '../components/ui/SectionTitle'

export function LabPage({ orders, patients, prescriptions, stock, onAdvanceOrder, onNewOS, onViewOrder, onPayOrder, onCancelOrder, onPrintOrder }: {
  orders: ServiceOrder[]; patients: Patient[]; prescriptions: Prescription[]; stock: StockItem[]
  onAdvanceOrder: (id: string) => void; onNewOS?: (rxId: number) => void; onViewOrder: (id: string) => void
  onPayOrder?: (id: string) => void; onCancelOrder?: (id: string) => void; onPrintOrder: (id: string) => void
}) {
  const [labSearch, setLabSearch] = useState('')
  const [showCancelled, setShowCancelled] = useState(false)

  // Valid prescriptions without an active OS
  const rxWithoutOS = prescriptions.filter(rx => {
    const exp = parseDMY(rx.expiresAt)
    if (!exp || daysBetween(TODAY_D, exp) <= 0) return false
    return !orders.some(o => o.prescriptionId === rx.id && o.status !== 'cancelled')
  })
  const productName = (id: number | null) => (id ? stock.find(s => s.id === id)?.name : undefined) ?? '—'
  const matches = (o: ServiceOrder) => {
    if (!labSearch) return true
    const pat = patients.find(p => p.id === o.patientId)
    const q = labSearch.toLowerCase()
    return pat?.name.toLowerCase().includes(q) || o.id.toLowerCase().includes(q)
  }
  const active = orders.filter(o => o.status !== 'cancelled')
  const cancelled = orders.filter(o => o.status === 'cancelled').filter(matches)

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Laboratório</h1>
          <p className="mt-0.5 text-[13px] text-slate-400">
            {active.length} OS · {active.filter(o => o.status === 'production').length} em produção · {active.filter(o => !o.paid && o.total > 0).length} a receber
          </p>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
        <input value={labSearch} onChange={e => setLabSearch(e.target.value)} placeholder="Buscar por paciente ou OS…"
          className="h-10 w-full rounded-xl border border-slate-200/80 bg-slate-50/80 pl-10 pr-4 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100" />
      </div>

      {onNewOS && rxWithoutOS.length > 0 && (
        <Card>
          <SectionTitle title="Receitas válidas sem OS" sub="Crie uma ordem de serviço para iniciar produção" />
          <div className="max-h-[280px] space-y-2 overflow-y-auto pr-1">
            {rxWithoutOS.map(rx => {
              const pat = patients.find(p => p.id === rx.patientId)
              return (
                <div key={rx.id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2.5">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{pat?.name ?? '—'}</p>
                    <p className="text-xs text-slate-400">{rx.lensType} · Exame: {rx.examDate} · Validade: {rx.expiresAt}</p>
                  </div>
                  <button onClick={() => onNewOS(rx.id)}
                    className="inline-flex items-center gap-1 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-600">
                    <Plus className="h-3 w-3" /> Criar OS
                  </button>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* Kanban */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(['production', 'ready', 'delivered'] as const).map(status => {
          const colOrders = orders.filter(o => o.status === status).filter(matches).slice().reverse()
          const title = status === 'production' ? 'Em produção' : status === 'ready' ? 'Pronto' : 'Entregue'
          return (
            <Card key={status}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900">{title}</h2>
                <Badge>{colOrders.length}</Badge>
              </div>
              <div className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
                {colOrders.length === 0 && <p className="py-4 text-center text-sm text-slate-300">Nenhuma ordem</p>}
                {colOrders.map(o => {
                  const pat = patients.find(p => p.id === o.patientId)
                  const rx = prescriptions.find(r => r.id === o.prescriptionId)
                  const unpaid = !o.paid && o.total > 0
                  const due = o.dueDate ? parseDMY(o.dueDate) : null
                  const late = status === 'production' && due && daysBetween(TODAY_D, due) < 0
                  return (
                    <div key={o.id} className={`rounded-xl border p-3 ${late ? 'border-rose-200 bg-rose-50/40' : 'border-slate-100 bg-slate-50/50'}`}>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-slate-800">{pat?.name}</p>
                        <button onClick={() => onViewOrder(o.id)} className="shrink-0 rounded-md bg-white px-1.5 py-0.5 text-[10px] font-medium text-brand-500 transition hover:bg-brand-50">{o.id}</button>
                      </div>
                      <p className="text-xs text-slate-400">{rx?.lensType ?? 'Sem receita'} · {o.lensDescription || productName(o.lensItemId)} · {productName(o.frameItemId)}</p>
                      <p className="text-xs text-slate-400">
                        Criada: {o.createdAt}{o.dueDate && status === 'production' ? ` · Previsão: ${o.dueDate}` : ''}{o.readyAt ? ` · Pronto: ${o.readyAt}` : ''}{o.deliveredAt ? ` · Entregue: ${o.deliveredAt}` : ''}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-semibold text-slate-700">{brl(o.total)}</span>
                        {unpaid ? <Badge color="amber">A receber</Badge> : o.total > 0 && <Badge color="emerald">Pago</Badge>}
                        {late && <Badge color="rose">Atrasada</Badge>}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        {status !== 'delivered' && (
                          <button onClick={() => onAdvanceOrder(o.id)}
                            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-500 transition hover:text-brand-700">
                            <ChevronRight className="h-3 w-3" />{status === 'production' ? 'Marcar pronto' : unpaid ? 'Receber e entregar' : 'Marcar entregue'}
                          </button>
                        )}
                        {unpaid && onPayOrder && status !== 'ready' && (
                          <button onClick={() => onPayOrder(o.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 hover:text-emerald-700">
                            <Wallet className="h-3 w-3" /> Receber
                          </button>
                        )}
                        <button onClick={() => onPrintOrder(o.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-slate-600" title="Imprimir OS">
                          <Printer className="h-3 w-3" /> Imprimir
                        </button>
                        {onCancelOrder && !o.paid && status !== 'delivered' && (
                          <button onClick={() => onCancelOrder(o.id)} className="inline-flex items-center gap-1 text-xs font-semibold text-rose-400 hover:text-rose-600">
                            <XCircle className="h-3 w-3" /> Cancelar
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          )
        })}
      </div>

      {cancelled.length > 0 && (
        <Card>
          <SectionTitle title="OS canceladas" sub={`${cancelled.length} registro(s)`}
            action={<button onClick={() => setShowCancelled(s => !s)} className="text-xs font-semibold text-brand-600">{showCancelled ? 'Ocultar' : 'Mostrar'}</button>} />
          {showCancelled && (
            <div className="space-y-1.5">
              {cancelled.slice().reverse().map(o => (
                <button key={o.id} onClick={() => onViewOrder(o.id)} className="flex w-full items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-left">
                  <span className="text-sm text-slate-600">{o.id} · {patients.find(p => p.id === o.patientId)?.name}</span>
                  <span className="truncate pl-3 text-xs text-slate-400">{o.notes}</span>
                </button>
              ))}
            </div>
          )}
        </Card>
      )}
    </>
  )
}
