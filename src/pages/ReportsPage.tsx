import { useState, useMemo } from 'react'
import { Filter, Download, CalendarDays } from 'lucide-react'
import type { Patient, Prescription, ServiceOrder, Sale, StockItem } from '../types'
import { parseDMY, daysBetween, TODAY_D } from '../utils/helpers'
import { Card } from '../components/ui/Card'
import { SectionTitle } from '../components/ui/SectionTitle'
import { SelectField } from '../components/ui/SelectField'

export function ReportsPage({ patients, prescriptions, orders, sales, stock }: {
  patients: Patient[]; prescriptions: Prescription[]; orders: ServiceOrder[]; sales: Sale[]; stock: StockItem[]
}) {
  const [period, setPeriod] = useState<'7d' | '30d' | '90d' | 'custom' | 'all'>('30d')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [filterPatientId, setFilterPatientId] = useState<string>('')
  const [filterPayment, setFilterPayment] = useState<string>('')
  const [filterCategory, setFilterCategory] = useState<string>('')
  const [showFilters, setShowFilters] = useState(false)

  const parseISO = (s: string): Date | null => {
    if (!s) return null
    const [y, m, d] = s.split('-').map(Number)
    if (!y || !m || !d) return null
    return new Date(y, m - 1, d)
  }

  const paymentMethods = useMemo(() => [...new Set(sales.map(s => s.paymentMethod))], [sales])
  const productCategories = useMemo(() => [...new Set(stock.map(s => s.category))], [stock])

  const exportCSV = (filename: string, headers: string[], rows: string[][]) => {
    const bom = '\uFEFF'
    const csv = bom + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const filteredSales = useMemo(() => {
    return sales.filter(s => {
      const d = parseDMY(s.date)
      if (!d) return false
      if (period === 'custom') {
        if (dateFrom) { const from = parseISO(dateFrom); if (from && d < from) return false }
        if (dateTo) { const to = parseISO(dateTo); if (to && d > to) return false }
      } else if (period !== 'all') {
        const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
        const diff = daysBetween(d, TODAY_D)
        if (diff > days || diff < 0) return false
      }
      if (filterPatientId && s.patientId !== parseInt(filterPatientId)) return false
      if (filterPayment && s.paymentMethod !== filterPayment) return false
      return true
    })
  }, [sales, period, dateFrom, dateTo, filterPatientId, filterPayment])

  const totalRevenue = filteredSales.reduce((sum, s) => sum + s.total, 0)
  const avgTicket = filteredSales.length > 0 ? totalRevenue / filteredSales.length : 0

  const paymentBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>()
    for (const s of filteredSales) {
      const entry = map.get(s.paymentMethod) || { count: 0, total: 0 }
      entry.count++
      entry.total += s.total
      map.set(s.paymentMethod, entry)
    }
    return Array.from(map.entries()).sort((a, b) => b[1].total - a[1].total)
  }, [filteredSales])

  const topProducts = useMemo(() => {
    const map = new Map<string, { qty: number; revenue: number }>()
    for (const s of filteredSales) {
      for (const item of s.items) {
        if (filterCategory) {
          const stockItem = stock.find(si => si.name === item.name)
          if (stockItem && stockItem.category !== filterCategory) continue
        }
        const entry = map.get(item.name) || { qty: 0, revenue: 0 }
        entry.qty += item.qty
        entry.revenue += item.price * item.qty
        map.set(item.name, entry)
      }
    }
    return Array.from(map.entries()).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 10)
  }, [filteredSales, filterCategory, stock])

  const osProduction = orders.filter(o => o.status === 'production').length
  const osReady = orders.filter(o => o.status === 'ready').length
  const osDelivered = orders.filter(o => o.status === 'delivered').length

  const stockFiltered = filterCategory ? stock.filter(s => s.category === filterCategory) : stock
  const stockCritical = stockFiltered.filter(s => s.qty <= Math.ceil(s.min * 0.5)).length
  const stockLow = stockFiltered.filter(s => s.qty <= s.min && s.qty > Math.ceil(s.min * 0.5)).length
  const stockOk = stockFiltered.filter(s => s.qty > s.min).length
  const stockValue = stockFiltered.reduce((sum, s) => sum + s.qty * s.price, 0)

  const rxActive = prescriptions.filter(r => { const e = parseDMY(r.expiresAt); return e ? daysBetween(TODAY_D, e) > 0 : false }).length
  const rxExpiringSoon = prescriptions.filter(r => { const e = parseDMY(r.expiresAt); if (!e) return false; const d = daysBetween(TODAY_D, e); return d > 0 && d <= 30 }).length
  const rxExpired = prescriptions.filter(r => { const e = parseDMY(r.expiresAt); return e ? daysBetween(TODAY_D, e) <= 0 : false }).length

  const periodLabel = period === '7d' ? 'últimos 7 dias' : period === '30d' ? 'últimos 30 dias' : period === '90d' ? 'últimos 90 dias' : period === 'custom' ? 'período personalizado' : 'todo o período'
  const activeFilterCount = [filterPatientId, filterPayment, filterCategory].filter(Boolean).length

  const exportSales = () => {
    const headers = ['Data', 'Paciente', 'OS', 'Pagamento', 'Itens', 'Valor']
    const rows = filteredSales.slice().reverse().map(s => {
      const pat = s.patientId ? patients.find(p => p.id === s.patientId) : null
      return [s.date, pat?.name ?? '—', s.orderId ?? '—', s.paymentMethod, s.items.map(i => `${i.qty}x ${i.name}`).join(' | '), s.total.toFixed(2).replace('.', ',')]
    })
    exportCSV('vendas.csv', headers, rows)
  }

  const exportStock = () => {
    const headers = ['Produto', 'Categoria', 'Quantidade', 'Mínimo', 'Preço Unit.', 'Valor Total', 'Status']
    const rows = stockFiltered.map(s => [
      s.name, s.category, String(s.qty), String(s.min), s.price.toFixed(2).replace('.', ','),
      (s.qty * s.price).toFixed(2).replace('.', ','),
      s.qty <= Math.ceil(s.min * 0.5) ? 'CRÍTICO' : s.qty <= s.min ? 'BAIXO' : 'OK',
    ])
    exportCSV('estoque.csv', headers, rows)
  }

  const exportOrders = () => {
    const headers = ['OS', 'Paciente', 'Status', 'Criada', 'Pronto em', 'Entregue em']
    const rows = orders.map(o => {
      const pat = patients.find(p => p.id === o.patientId)
      return [o.id, pat?.name ?? '—', o.status, o.createdAt, o.readyAt ?? '—', o.deliveredAt ?? '—']
    })
    exportCSV('ordens_servico.csv', headers, rows)
  }

  const exportPatients = () => {
    const headers = ['Nome', 'CPF', 'Telefone', 'Nascimento', 'Cadastro', 'Receitas', 'OS', 'Compras']
    const rows = patients.map(p => [
      p.name, p.cpf, p.phone, p.birthDate, p.createdAt,
      String(prescriptions.filter(r => r.patientId === p.id).length),
      String(orders.filter(o => o.patientId === p.id).length),
      String(sales.filter(s => s.patientId === p.id).length),
    ])
    exportCSV('pacientes.csv', headers, rows)
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Relatórios</h1>
          <p className="mt-0.5 text-[13px] text-slate-400">Resumo gerencial — {periodLabel}{activeFilterCount > 0 ? ` · ${activeFilterCount} filtro(s) ativo(s)` : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowFilters(f => !f)}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${showFilters || activeFilterCount > 0 ? 'border-brand-300 bg-brand-50 text-brand-600' : 'border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:text-brand-600'}`}>
            <Filter className="h-3.5 w-3.5" /> Filtros{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
        </div>
      </div>

      {showFilters && (
        <Card>
          <SectionTitle title="Filtros do relatório" sub="Personalize a visualização dos dados" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Período</label>
              <div className="flex flex-wrap gap-1.5">
                {(['7d', '30d', '90d', 'custom', 'all'] as const).map(p => (
                  <button key={p} onClick={() => setPeriod(p)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${period === p ? 'bg-brand-500 text-white shadow-sm shadow-brand-500/20' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>
                    {p === '7d' ? '7d' : p === '30d' ? '30d' : p === '90d' ? '90d' : p === 'custom' ? 'Custom' : 'Tudo'}
                  </button>
                ))}
              </div>
            </div>
            {period === 'custom' && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">De</label>
                  <div className="relative">
                    <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50/80 py-2.5 pl-10 pr-3 text-sm text-slate-800 outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100" />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">Até</label>
                  <div className="relative">
                    <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} min={dateFrom || undefined}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50/80 py-2.5 pl-10 pr-3 text-sm text-slate-800 outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100" />
                  </div>
                </div>
              </>
            )}
            <SelectField label="Paciente" value={filterPatientId} onChange={setFilterPatientId}
              options={[{ value: '', label: 'Todos' }, ...patients.map(p => ({ value: String(p.id), label: p.name }))]} />
            <SelectField label="Forma de pagamento" value={filterPayment} onChange={setFilterPayment}
              options={[{ value: '', label: 'Todas' }, ...paymentMethods.map(m => ({ value: m, label: m }))]} />
            <SelectField label="Categoria de produto" value={filterCategory} onChange={setFilterCategory}
              options={[{ value: '', label: 'Todas' }, ...productCategories.map(c => ({ value: c, label: c }))]} />
          </div>
          {activeFilterCount > 0 && (
            <button onClick={() => { setFilterPatientId(''); setFilterPayment(''); setFilterCategory(''); setPeriod('30d'); setDateFrom(''); setDateTo('') }}
              className="mt-3 text-xs font-semibold text-rose-500 transition hover:text-rose-700">Limpar todos os filtros</button>
          )}
        </Card>
      )}

      {/* Export buttons */}
      <div className="flex flex-wrap gap-2">
        <button onClick={exportSales} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-brand-300 hover:text-brand-600">
          <Download className="h-3.5 w-3.5" /> Exportar vendas
        </button>
        <button onClick={exportStock} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-brand-300 hover:text-brand-600">
          <Download className="h-3.5 w-3.5" /> Exportar estoque
        </button>
        <button onClick={exportOrders} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-brand-300 hover:text-brand-600">
          <Download className="h-3.5 w-3.5" /> Exportar OS
        </button>
        <button onClick={exportPatients} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-brand-300 hover:text-brand-600">
          <Download className="h-3.5 w-3.5" /> Exportar pacientes
        </button>
      </div>

      {/* Revenue metrics */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <p className="text-[13px] text-slate-400">Faturamento</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">R$ {totalRevenue.toFixed(2).replace('.', ',')}</p>
          <p className="mt-1 text-xs text-slate-400">{filteredSales.length} venda(s)</p>
        </Card>
        <Card>
          <p className="text-[13px] text-slate-400">Ticket médio</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">R$ {avgTicket.toFixed(2).replace('.', ',')}</p>
          <p className="mt-1 text-xs text-slate-400">por venda</p>
        </Card>
        <Card>
          <p className="text-[13px] text-slate-400">Pacientes</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{patients.length}</p>
          <p className="mt-1 text-xs text-slate-400">cadastrados</p>
        </Card>
        <Card>
          <p className="text-[13px] text-slate-400">Valor em estoque</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">R$ {stockValue.toFixed(2).replace('.', ',')}</p>
          <p className="mt-1 text-xs text-slate-400">{stockFiltered.reduce((s, i) => s + i.qty, 0)} unidades{filterCategory ? ` (${filterCategory})` : ''}</p>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <SectionTitle title="Formas de pagamento" sub={periodLabel} />
          {paymentBreakdown.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">Nenhuma venda no período</p>
          ) : (
            <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
              {paymentBreakdown.map(([method, data]) => {
                const pct = totalRevenue > 0 ? (data.total / totalRevenue) * 100 : 0
                return (
                  <div key={method} className="rounded-xl bg-slate-50/70 p-3">
                    <div className="mb-1.5 flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-800">{method}</p>
                      <p className="text-sm font-bold text-slate-900">R$ {data.total.toFixed(2)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-slate-200">
                        <div className="h-1.5 rounded-full bg-brand-400 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11px] font-semibold text-slate-400">{pct.toFixed(0)}% · {data.count}x</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle title="Produtos mais vendidos" sub={`${periodLabel}${filterCategory ? ` · ${filterCategory}` : ''}`} />
          {topProducts.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">Nenhuma venda no período</p>
          ) : (
            <div className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
              {topProducts.map(([name, data], i) => (
                <div key={name} className="flex items-center justify-between rounded-xl px-3 py-2.5 hover:bg-slate-50">
                  <div className="flex items-center gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-xs font-bold text-brand-600">{i + 1}</span>
                    <div>
                      <p className="text-sm font-medium text-slate-800">{name}</p>
                      <p className="text-xs text-slate-400">{data.qty} un vendidas</p>
                    </div>
                  </div>
                  <p className="text-sm font-bold text-slate-900">R$ {data.revenue.toFixed(2)}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card>
          <SectionTitle title="Ordens de serviço" sub="Status atual" action={
            <button onClick={exportOrders} className="text-xs font-medium text-brand-500 transition hover:text-brand-700"><Download className="mr-1 inline h-3 w-3" />CSV</button>
          } />
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-xl bg-amber-50/60 px-3 py-2.5">
              <span className="text-sm text-slate-700">Em produção</span>
              <span className="text-sm font-bold text-amber-700">{osProduction}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-emerald-50/60 px-3 py-2.5">
              <span className="text-sm text-slate-700">Prontos</span>
              <span className="text-sm font-bold text-emerald-700">{osReady}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-brand-50/60 px-3 py-2.5">
              <span className="text-sm text-slate-700">Entregues</span>
              <span className="text-sm font-bold text-brand-700">{osDelivered}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5">
              <span className="text-sm font-semibold text-slate-700">Total</span>
              <span className="text-sm font-bold text-slate-900">{orders.length}</span>
            </div>
          </div>
        </Card>

        <Card>
          <SectionTitle title="Saúde do estoque" sub={`${stockFiltered.length} produtos${filterCategory ? ` (${filterCategory})` : ''}`} action={
            <button onClick={exportStock} className="text-xs font-medium text-brand-500 transition hover:text-brand-700"><Download className="mr-1 inline h-3 w-3" />CSV</button>
          } />
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-xl bg-rose-50/60 px-3 py-2.5">
              <span className="text-sm text-slate-700">Crítico (≤50% mín)</span>
              <span className="text-sm font-bold text-rose-700">{stockCritical}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-amber-50/60 px-3 py-2.5">
              <span className="text-sm text-slate-700">Abaixo do mínimo</span>
              <span className="text-sm font-bold text-amber-700">{stockLow}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-emerald-50/60 px-3 py-2.5">
              <span className="text-sm text-slate-700">Adequado</span>
              <span className="text-sm font-bold text-emerald-700">{stockOk}</span>
            </div>
          </div>
        </Card>

        <Card>
          <SectionTitle title="Receitas" sub={`${prescriptions.length} emitidas`} />
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-xl bg-emerald-50/60 px-3 py-2.5">
              <span className="text-sm text-slate-700">Ativas</span>
              <span className="text-sm font-bold text-emerald-700">{rxActive}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-amber-50/60 px-3 py-2.5">
              <span className="text-sm text-slate-700">Expirando (30 dias)</span>
              <span className="text-sm font-bold text-amber-700">{rxExpiringSoon}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-rose-50/60 px-3 py-2.5">
              <span className="text-sm text-slate-700">Vencidas</span>
              <span className="text-sm font-bold text-rose-700">{rxExpired}</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Recent sales detail */}
      <Card>
        <SectionTitle title="Histórico de vendas" sub={periodLabel}
          action={<button onClick={exportSales} className="text-xs font-medium text-brand-500 transition hover:text-brand-700"><Download className="mr-1 inline h-3 w-3" />CSV</button>} />
        {filteredSales.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">Nenhuma venda no período selecionado</p>
        ) : (
          <div className="max-h-[400px] overflow-y-auto pr-1">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-100 text-left">
                  <th className="pb-2 pr-4 font-semibold text-slate-500">Data</th>
                  <th className="pb-2 pr-4 font-semibold text-slate-500">Paciente</th>
                  <th className="pb-2 pr-4 font-semibold text-slate-500">OS</th>
                  <th className="pb-2 pr-4 font-semibold text-slate-500">Pagamento</th>
                  <th className="pb-2 text-right font-semibold text-slate-500">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredSales.slice().reverse().map(s => {
                  const pat = s.patientId ? patients.find(p => p.id === s.patientId) : null
                  return (
                    <tr key={s.id} className="transition hover:bg-slate-50">
                      <td className="py-2.5 pr-4 text-slate-600">{s.date}</td>
                      <td className="py-2.5 pr-4 font-medium text-slate-800">{pat?.name ?? '—'}</td>
                      <td className="py-2.5 pr-4 text-slate-500">{s.orderId ?? '—'}</td>
                      <td className="py-2.5 pr-4 text-slate-500">{s.paymentMethod}</td>
                      <td className="py-2.5 text-right font-semibold text-slate-900">R$ {s.total.toFixed(2)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
