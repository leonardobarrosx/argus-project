import { useState, useMemo } from 'react'
import { AlertTriangle, Plus, Boxes, Search, Package, FileText, Sparkles, Edit2 } from 'lucide-react'
import type { StockItem, StockMovement, Suggestion } from '../types'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { SectionTitle } from '../components/ui/SectionTitle'

export function StockPage({ stock: allStock, stockMovements, suggestions, canManage, onAdjustStock, onPhysicalCount, onNewProduct, onEditProduct, onToggleActive, onStockEntry, onViewLog }: {
  stock: StockItem[]; stockMovements: StockMovement[]; suggestions: Suggestion[]; canManage: boolean
  onAdjustStock: (id: number, qty: number) => void; onPhysicalCount: (id: number, qty: number) => void; onNewProduct: () => void
  onEditProduct: (p: StockItem) => void; onToggleActive: (p: StockItem) => void
  onStockEntry: (preSelectId?: number) => void; onViewLog: (id: number) => void
}) {
  const [catFilter, setCatFilter] = useState('all')
  const [stockSearch, setStockSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const stock = allStock.filter(s => s.active)
  const categories = ['all', ...new Set(stock.map(s => s.category))]
  const filtered = allStock.filter(s => {
    if (!showInactive && !s.active) return false
    if (catFilter !== 'all' && s.category !== catFilter) return false
    if (stockSearch && !s.name.toLowerCase().includes(stockSearch.toLowerCase()) && !s.sku.toLowerCase().includes(stockSearch.toLowerCase())) return false
    return true
  })

  const lastNFMap = useMemo(() => {
    const map = new Map<number, string>()
    for (const m of stockMovements) {
      if (m.invoiceNumber) map.set(m.stockItemId, m.invoiceNumber)
    }
    return map
  }, [stockMovements])

  const fiscalBalances = useMemo(() => {
    const map = new Map<number, number>()
    for (const m of stockMovements) {
      const prev = map.get(m.stockItemId) || 0
      if (m.type === 'in' && (m.invoiceNumber || m.reason === 'sale_cancel')) map.set(m.stockItemId, prev + m.qty)
      else if (m.type === 'out' && (m.reason === 'sale' || m.reason === 'service_order')) map.set(m.stockItemId, prev - m.qty)
    }
    return map
  }, [stockMovements])

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Estoque</h1>
          <p className="mt-0.5 text-[13px] text-slate-400">{stock.length} produtos · {stock.reduce((s, i) => s + i.qty, 0)} unidades total · {stockMovements.length} movimentação(ões)</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {stock.filter(s => s.qty <= s.min).length > 0 && (
            <Badge color="rose"><AlertTriangle className="h-3 w-3" />{stock.filter(s => s.qty <= s.min).length} abaixo do mínimo</Badge>
          )}
          {canManage && (
            <>
              <button onClick={onNewProduct}
                className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-brand-300 hover:text-brand-600">
                <Plus className="h-3.5 w-3.5" /> Novo produto
              </button>
              <button onClick={() => onStockEntry()}
                className="flex items-center gap-1.5 rounded-xl bg-brand-500 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-brand-500/20 transition hover:bg-brand-600">
                <Boxes className="h-3.5 w-3.5" /> Entrada NF
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {categories.map(cat => (
          <button key={cat} onClick={() => setCatFilter(cat)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${catFilter === cat ? 'bg-brand-500 text-white shadow-sm shadow-brand-500/20' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
            {cat === 'all' ? 'Todos' : cat}
          </button>
        ))}
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
            <input value={stockSearch} onChange={e => setStockSearch(e.target.value)} placeholder="Buscar por nome ou código…"
              className="h-9 w-full rounded-xl border border-slate-200/80 bg-slate-50/80 pl-10 pr-4 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100" />
          </div>
          {canManage && allStock.some(s => !s.active) && (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-500">
              <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-500" />
              Mostrar inativos
            </label>
          )}
        </div>
        <div className="max-h-[520px] space-y-1.5 overflow-y-auto pr-1">
          {filtered.map(s => {
            const critical = s.qty <= s.min
            const margin = s.costPrice > 0 ? ((s.price - s.costPrice) / s.price * 100) : 0
            const lastNF = lastNFMap.get(s.id)
            const fiscal = fiscalBalances.get(s.id) || 0
            const hasDivergence = fiscal !== s.qty && fiscal > 0
            return (
              <div key={s.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-3 transition ${!s.active ? 'opacity-50' : critical ? 'bg-rose-50/60' : hasDivergence ? 'bg-amber-50/40' : 'hover:bg-slate-50'}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${critical ? 'bg-rose-100 text-rose-500' : hasDivergence ? 'bg-amber-100 text-amber-500' : 'bg-brand-50 text-brand-500'}`}>
                    <Package className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{s.name}{s.sku ? <span className="ml-1.5 text-[11px] font-normal text-slate-400">#{s.sku}</span> : null}{!s.active && <span className="ml-1.5 text-[11px] font-semibold text-slate-400">(inativo)</span>}</p>
                    <p className="text-xs text-slate-400 truncate">{s.category} · Mín: {s.min} · Venda: R$ {s.price.toFixed(2)}{s.costPrice > 0 ? ` · Custo: R$ ${s.costPrice.toFixed(2)} · Margem: ${margin.toFixed(0)}%` : ''}</p>
                    <div className="flex items-center gap-2">
                      {(s.supplier || lastNF) && <p className="text-[11px] text-slate-300 truncate">{s.supplier ? `Fornecedor: ${s.supplier}` : ''}{lastNF ? `${s.supplier ? ' · ' : ''}Última NF: ${lastNF}` : ''}</p>}
                      {hasDivergence && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-600">
                          <AlertTriangle className="h-2.5 w-2.5" /> Fiscal: {fiscal}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="text-right mr-1">
                    <p className={`text-sm font-bold ${critical ? 'text-rose-600' : 'text-slate-800'}`}>{s.qty}</p>
                    <p className="text-[11px] text-slate-400">unidades</p>
                  </div>
                  <button onClick={() => onViewLog(s.id)} title="Histórico"
                    className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-400 transition hover:border-brand-300 hover:text-brand-600"><FileText className="h-3.5 w-3.5" /></button>
                  {canManage && (
                    <>
                      <button onClick={() => onEditProduct(s)} title="Editar produto"
                        className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-400 transition hover:border-brand-300 hover:text-brand-600"><Edit2 className="h-3.5 w-3.5" /></button>
                      {s.active ? (
                        <>
                          <button onClick={() => onStockEntry(s.id)}
                            className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs font-medium text-emerald-600 transition hover:bg-emerald-100">Entrada</button>
                          <button onClick={() => onPhysicalCount(s.id, s.qty)}
                            className="rounded-lg border border-sky-200 bg-sky-50 px-2 py-1.5 text-xs font-medium text-sky-600 transition hover:bg-sky-100">Contagem</button>
                          <button onClick={() => onAdjustStock(s.id, s.qty)}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-600 transition hover:border-brand-300 hover:text-brand-600">Ajustar</button>
                          {s.qty === 0 && (
                            <button onClick={() => onToggleActive(s)} className="rounded-lg px-2 py-1.5 text-xs font-medium text-slate-400 hover:text-rose-500">Desativar</button>
                          )}
                        </>
                      ) : (
                        <button onClick={() => onToggleActive(s)} className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs font-medium text-emerald-600">Reativar</button>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      {suggestions.length > 0 && (
        <Card>
          <SectionTitle title="Sugestões inteligentes" sub="Análise automática do estoque atual" action={<Badge color="slate"><Sparkles className="h-3 w-3" /> Auto</Badge>} />
          <div className="max-h-[320px] grid gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {suggestions.map((s, i) => (
              <div key={i} className={`rounded-xl p-3 ${s.severity === 'critical' ? 'border border-rose-200 bg-rose-50/60' : s.severity === 'warning' ? 'border border-amber-200 bg-amber-50/40' : 'border border-slate-100 bg-slate-50/50'}`}>
                <p className={`text-sm font-semibold ${s.severity === 'critical' ? 'text-rose-700' : s.severity === 'warning' ? 'text-amber-700' : 'text-slate-800'}`}>{s.title}</p>
                <p className="text-xs text-slate-400">{s.sub}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  )
}
