import { useState } from 'react'
import { Search, Plus, ChevronRight } from 'lucide-react'
import type { Patient, Prescription, ServiceOrder, StockItem, Sale } from '../types'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { SectionTitle } from '../components/ui/SectionTitle'

export function LabPage({ orders, patients, prescriptions, stock, sales, onAdvanceOrder, onNewOS, onViewOrder }: {
  orders: ServiceOrder[]; patients: Patient[]; prescriptions: Prescription[]; stock: StockItem[]; sales: Sale[];
  onAdvanceOrder: (id: string) => void; onNewOS: (rxId: number) => void; onViewOrder: (id: string) => void
}) {
  const [labSearch, setLabSearch] = useState('')

  // Prescriptions without active OS
  const rxWithoutOS = prescriptions.filter(rx => !orders.some(o => o.prescriptionId === rx.id))

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Laboratório</h1>
          <p className="mt-0.5 text-[13px] text-slate-400">{orders.length} OS · {orders.filter(o => o.status === 'production').length} em produção</p>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
        <input value={labSearch} onChange={e => setLabSearch(e.target.value)} placeholder="Buscar por paciente ou OS…"
          className="h-10 w-full rounded-xl border border-slate-200/80 bg-slate-50/80 pl-10 pr-4 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100" />
      </div>

      {/* Prescriptions awaiting OS */}
      {rxWithoutOS.length > 0 && (
        <Card>
          <SectionTitle title="Receitas sem OS ativa" sub="Crie uma ordem de serviço para iniciar produção" />
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
          const colOrders = orders.filter(o => o.status === status).filter(o => {
            if (!labSearch) return true
            const pat = patients.find(p => p.id === o.patientId)
            const q = labSearch.toLowerCase()
            return pat?.name.toLowerCase().includes(q) || o.id.toLowerCase().includes(q)
          })
          const title = status === 'production' ? 'Em produção' : status === 'ready' ? 'Pronto' : 'Entregue'
          return (
            <Card key={status}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900">{title}</h2>
                <Badge>{colOrders.length}</Badge>
              </div>
              <div className="max-h-[400px] space-y-2 overflow-y-auto pr-1">
                {colOrders.length === 0 && <p className="py-4 text-center text-sm text-slate-300">Nenhuma ordem</p>}
                {colOrders.map(o => {
                  const pat = patients.find(p => p.id === o.patientId)
                  const rx = prescriptions.find(r => r.id === o.prescriptionId)
                  const lensItem = o.lensItemId ? stock.find(s => s.id === o.lensItemId) : null
                  return (
                    <div key={o.id} className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                      <div className="mb-1 flex items-center justify-between">
                        <p className="text-sm font-semibold text-slate-800">{pat?.name}</p>
                        <button onClick={() => onViewOrder(o.id)} className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-medium text-brand-500 transition hover:bg-brand-50">{o.id}</button>
                      </div>
                      <p className="text-xs text-slate-400">{rx?.lensType ?? '—'} · {lensItem?.name ?? '—'} · {(() => { const fr = o.frameItemId ? stock.find(s => s.id === o.frameItemId) : null; return fr?.name ?? '—' })()}</p>
                      <p className="text-xs text-slate-400">Criada: {o.createdAt}{o.readyAt ? ` · Pronto: ${o.readyAt}` : ''}{o.deliveredAt ? ` · Entregue: ${o.deliveredAt}` : ''}</p>
                      {status !== 'delivered' && (
                        <button onClick={() => onAdvanceOrder(o.id)}
                          disabled={status === 'ready' && !sales.some(s => s.orderId === o.id)}
                          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-500 transition hover:text-brand-700 disabled:opacity-40 disabled:pointer-events-none">
                          <ChevronRight className="h-3 w-3" />{status === 'production' ? 'Marcar pronto' : 'Marcar entregue'}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </Card>
          )
        })}
      </div>
    </>
  )
}
