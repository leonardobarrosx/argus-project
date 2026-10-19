import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Download, Plus, RefreshCw, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import type { FinanceSummary, Payable, Patient, ServiceOrder, Supplier } from '../types'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { SectionTitle } from '../components/ui/SectionTitle'
import { Modal } from '../components/ui/Modal'
import { FormField } from '../components/ui/FormField'
import { SelectField } from '../components/ui/SelectField'
import { Button } from '../components/ui/Button'
import { PAYABLE_CATEGORIES, addDaysISO, brl, parseMoney, todayISO } from '../utils/format'
import { isoToDMY } from '../api/mappers'
import { exportCSV } from '../utils/csv'
import type { PayableInput } from '../api'

type Period = 'month' | 'last30' | 'lastMonth' | 'year' | 'custom'
type PayableFilter = 'open' | 'overdue' | 'paid' | 'cancelled' | 'all'

function periodRange(p: Period, from: string, to: string): [string, string] {
  const now = new Date()
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  switch (p) {
    case 'month': return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), todayISO()]
    case 'last30': return [addDaysISO(todayISO(), -29), todayISO()]
    case 'lastMonth': return [iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), iso(new Date(now.getFullYear(), now.getMonth(), 0))]
    case 'year': return [iso(new Date(now.getFullYear(), 0, 1)), todayISO()]
    default: return [from || todayISO(), to || todayISO()]
  }
}

export function FinancePage({ payables, suppliers, orders, patients, loadSummary, onCreatePayable, onPayPayable, onCancelPayable, onReceiveOrder }: {
  payables: Payable[]; suppliers: Supplier[]; orders: ServiceOrder[]; patients: Patient[]
  loadSummary: (from: string, to: string) => Promise<FinanceSummary | null>
  onCreatePayable: (input: PayableInput) => Promise<boolean>
  onPayPayable: (id: number, paidAt: string, amount?: number) => Promise<boolean>
  onCancelPayable: (id: number, reason: string) => Promise<boolean>
  onReceiveOrder: (orderId: string) => void
}) {
  const [period, setPeriod] = useState<Period>('month')
  const [customFrom, setCustomFrom] = useState(addDaysISO(todayISO(), -30))
  const [customTo, setCustomTo] = useState(todayISO())
  const [summary, setSummary] = useState<FinanceSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<PayableFilter>('open')

  const [from, to] = periodRange(period, customFrom, customTo)

  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    let cancelled = false
    loadSummary(from, to).then(s => {
      if (cancelled) return
      if (s) setSummary(s)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [from, to, loadSummary, payables, reloadKey])
  const refresh = () => { setLoading(true); setReloadKey(k => k + 1) }

  // ── Payable dialogs ──
  const [newOpen, setNewOpen] = useState(false)
  const [form, setForm] = useState({ description: '', category: 'Outros', amount: '', dueDate: todayISO(), supplierId: '', invoiceNumber: '' })
  const [payTarget, setPayTarget] = useState<Payable | null>(null)
  const [payDate, setPayDate] = useState(todayISO())
  const [payAmount, setPayAmount] = useState('')
  const [cancelTarget, setCancelTarget] = useState<Payable | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [busy, setBusy] = useState(false)

  const today = todayISO()
  const filtered = useMemo(() => payables.filter(p => {
    if (filter === 'all') return true
    if (filter === 'open') return p.status === 'pending'
    if (filter === 'overdue') return p.status === 'pending' && p.dueDateISO < today
    return p.status === filter
  }), [payables, filter, today])

  const receivables = orders.filter(o => !o.paid && o.status !== 'cancelled' && o.total > 0)
  const patientName = (id: number) => patients.find(p => p.id === id)?.name ?? '—'

  const createPayable = async () => {
    const amount = parseMoney(form.amount)
    if (!form.description.trim() || !(amount > 0) || !form.dueDate) return
    setBusy(true)
    const ok = await onCreatePayable({
      description: form.description.trim(), category: form.category, amount, dueDate: form.dueDate,
      supplierId: form.supplierId ? Number(form.supplierId) : null, invoiceNumber: form.invoiceNumber.trim(),
    })
    setBusy(false)
    if (ok) {
      setNewOpen(false)
      setForm({ description: '', category: 'Outros', amount: '', dueDate: todayISO(), supplierId: '', invoiceNumber: '' })
    }
  }

  const confirmPay = async () => {
    if (!payTarget) return
    const amount = payAmount ? parseMoney(payAmount) : undefined
    if (amount !== undefined && !(amount > 0)) return
    setBusy(true)
    const ok = await onPayPayable(payTarget.id, payDate, amount)
    setBusy(false)
    if (ok) setPayTarget(null)
  }

  const confirmCancel = async () => {
    if (!cancelTarget || cancelReason.trim().length < 3) return
    setBusy(true)
    const ok = await onCancelPayable(cancelTarget.id, cancelReason.trim())
    setBusy(false)
    if (ok) setCancelTarget(null)
  }

  const exportPayables = () => exportCSV(`contas-a-pagar-${today}.csv`,
    ['Vencimento', 'Descrição', 'Categoria', 'Fornecedor', 'NF', 'Valor', 'Status', 'Pago em', 'Valor pago'],
    filtered.map(p => [p.dueDate, p.description, p.category, p.supplierName, p.invoiceNumber, p.amount.toFixed(2).replace('.', ','),
      p.status === 'pending' ? 'Pendente' : p.status === 'paid' ? 'Pago' : 'Cancelado', p.paidAt, p.paidAmount?.toFixed(2).replace('.', ',') ?? '']))

  const maxDaily = summary ? Math.max(1, ...summary.daily.map(d => Math.max(d.inflow, d.outflow))) : 1

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Financeiro</h1>
          <p className="mt-0.5 text-[13px] text-slate-400">Resultado de {isoToDMY(from)} a {isoToDMY(to)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={period} onChange={e => setPeriod(e.target.value as Period)} aria-label="Período"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 outline-none focus:border-brand-300">
            <option value="month">Este mês</option><option value="last30">Últimos 30 dias</option>
            <option value="lastMonth">Mês passado</option><option value="year">Este ano</option><option value="custom">Personalizado</option>
          </select>
          {period === 'custom' && (
            <>
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} aria-label="De" className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs" />
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} aria-label="Até" className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs" />
            </>
          )}
          <Button variant="secondary" size="sm" onClick={refresh} loading={loading}><RefreshCw className="h-3.5 w-3.5" /> Atualizar</Button>
          <Button size="sm" onClick={() => setNewOpen(true)}><Plus className="h-3.5 w-3.5" /> Nova conta a pagar</Button>
        </div>
      </div>

      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Receita" value={brl(summary.revenue)} sub={`${summary.salesCount} venda(s) · ticket ${brl(summary.avgTicket)}`} icon={TrendingUp} tone="emerald" />
          <Kpi label="Lucro bruto" value={brl(summary.grossProfit)} sub={`Margem ${summary.grossMarginPct.toFixed(1)}% · CMV ${brl(summary.cogs)}`} icon={Wallet} tone="brand" />
          <Kpi label="Despesas pagas" value={brl(summary.operatingExpenses)} sub={`+ ${brl(summary.merchandisePurchases)} em mercadorias`} icon={TrendingDown} tone="rose" />
          <Kpi label="Resultado operacional" value={brl(summary.netResult)} sub="Lucro bruto − despesas" icon={summary.netResult >= 0 ? TrendingUp : TrendingDown} tone={summary.netResult >= 0 ? 'emerald' : 'rose'} />
        </div>
      )}

      {summary && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <p className="text-[13px] text-slate-400">A receber (OS)</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{brl(summary.receivables)}</p>
            <p className="text-xs text-slate-400">{summary.receivablesCount} OS não paga(s)</p>
          </Card>
          <Card>
            <p className="text-[13px] text-slate-400">A pagar (pendente)</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{brl(summary.payablesPending)}</p>
          </Card>
          <Card className={summary.payablesOverdueCount > 0 ? 'border border-rose-200' : ''}>
            <p className="text-[13px] text-slate-400">Vencidas</p>
            <p className={`mt-1 text-xl font-bold ${summary.payablesOverdueCount > 0 ? 'text-rose-600' : 'text-slate-900'}`}>{brl(summary.payablesOverdue)}</p>
            <p className="text-xs text-slate-400">{summary.payablesOverdueCount} conta(s)</p>
          </Card>
        </div>
      )}

      <Card>
        <SectionTitle title="Contas a pagar" sub={`${filtered.length} registro(s)`}
          action={<Button variant="secondary" size="sm" onClick={exportPayables}><Download className="h-3.5 w-3.5" /> CSV</Button>} />
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {([['open', 'Pendentes'], ['overdue', 'Vencidas'], ['paid', 'Pagas'], ['cancelled', 'Canceladas'], ['all', 'Todas']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${filter === k ? 'bg-brand-500 text-white' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>{l}</button>
          ))}
        </div>
        <div className="max-h-[460px] space-y-1.5 overflow-y-auto pr-1">
          {filtered.length === 0 && <p className="py-6 text-center text-sm text-slate-400">Nenhuma conta neste filtro</p>}
          {filtered.map(p => {
            const overdue = p.status === 'pending' && p.dueDateISO < today
            return (
              <div key={p.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2.5 ${overdue ? 'bg-rose-50/60' : 'bg-slate-50/70'}`}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">{p.description}</p>
                  <p className="text-[11px] text-slate-400">
                    Vence {p.dueDate} · {p.category}{p.supplierName ? ` · ${p.supplierName}` : ''}{p.invoiceNumber ? ` · NF ${p.invoiceNumber}` : ''}
                    {p.status === 'paid' && ` · pago em ${p.paidAt}`}{p.status === 'cancelled' && ` · ${p.cancelReason}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {overdue && <Badge color="rose"><AlertTriangle className="h-3 w-3" /> Vencida</Badge>}
                  {p.status === 'paid' && <Badge color="emerald">Paga</Badge>}
                  {p.status === 'cancelled' && <Badge color="slate">Cancelada</Badge>}
                  <span className="text-sm font-bold text-slate-900">{brl(p.status === 'paid' ? p.paidAmount ?? p.amount : p.amount)}</span>
                  {p.status === 'pending' && (
                    <>
                      <Button size="sm" onClick={() => { setPayTarget(p); setPayDate(todayISO()); setPayAmount('') }}>Pagar</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setCancelTarget(p); setCancelReason('') }}>Cancelar</Button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <SectionTitle title="Contas a receber" sub="Ordens de serviço ainda não pagas" />
          <div className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
            {receivables.length === 0 && <p className="py-6 text-center text-sm text-slate-400">Nada a receber</p>}
            {receivables.map(o => (
              <div key={o.id} className="flex items-center justify-between rounded-xl bg-slate-50/70 px-3 py-2.5">
                <div>
                  <p className="text-sm font-semibold text-slate-800">{patientName(o.patientId)} · {o.id}</p>
                  <p className="text-[11px] text-slate-400">Aberta {o.createdAt} · {o.status === 'ready' ? 'Pronta para retirada' : o.status === 'delivered' ? 'Entregue' : 'Em produção'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-900">{brl(o.total)}</span>
                  <Button size="sm" variant="secondary" onClick={() => onReceiveOrder(o.id)}>Receber</Button>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {summary && (
          <Card>
            <SectionTitle title="DRE simplificado" sub="Regime de competência das vendas" />
            <table className="w-full text-sm">
              <tbody>
                <DreRow label="(+) Receita bruta" value={summary.revenue + summary.discounts} />
                <DreRow label="(−) Descontos" value={-summary.discounts} />
                <DreRow label="(=) Receita líquida" value={summary.revenue} bold />
                <DreRow label="(−) Custo das mercadorias vendidas" value={-summary.cogs} />
                <DreRow label="(=) Lucro bruto" value={summary.grossProfit} bold />
                {summary.expensesByCategory.filter(c => c.category !== 'Mercadorias').map(c => (
                  <DreRow key={c.category} label={`(−) ${c.category}`} value={-c.total} muted />
                ))}
                <DreRow label="(=) Resultado operacional" value={summary.netResult} bold highlight />
              </tbody>
            </table>
          </Card>
        )}
      </div>

      {summary && (
        <div className="grid gap-4 xl:grid-cols-5">
          <Card className="xl:col-span-3">
            <SectionTitle title="Fluxo de caixa diário" sub="Entradas (vendas) × saídas (contas pagas)" />
            <div className="flex h-40 items-end gap-[2px] overflow-x-auto">
              {summary.daily.map(d => (
                <div key={d.date} className="group relative flex h-full min-w-[6px] flex-1 items-end gap-[1px]" title={`${isoToDMY(d.date)} · entradas ${brl(d.inflow)} · saídas ${brl(d.outflow)}`}>
                  <div className="w-1/2 rounded-t bg-emerald-400" style={{ height: `${(d.inflow / maxDaily) * 100}%` }} />
                  <div className="w-1/2 rounded-t bg-rose-300" style={{ height: `${(d.outflow / maxDaily) * 100}%` }} />
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-4 text-[11px] text-slate-500">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-400" /> Entradas</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-rose-300" /> Saídas</span>
              <span className="ml-auto">Saldo do período: <strong className={(summary.daily.at(-1)?.balance ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{brl(summary.daily.at(-1)?.balance ?? 0)}</strong></span>
            </div>
          </Card>
          <Card className="xl:col-span-2">
            <SectionTitle title="Formas de pagamento" />
            {summary.byMethod.length === 0 ? <p className="py-4 text-center text-sm text-slate-400">Sem vendas no período</p> : (
              <div className="space-y-2">
                {summary.byMethod.map(m => (
                  <div key={m.method}>
                    <div className="mb-1 flex justify-between text-xs"><span className="font-medium text-slate-600">{m.method} ({m.count})</span><span className="font-semibold text-slate-800">{brl(m.total)}</span></div>
                    <div className="h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${(m.total / Math.max(summary.revenue, 1)) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {summary && summary.commissions.length > 0 && (
        <Card>
          <SectionTitle title="Comissões do período" sub="Total vendido × % de comissão do colaborador" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead><tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <th className="py-2">Vendedor</th><th className="py-2 text-right">Vendas</th><th className="py-2 text-right">Total vendido</th><th className="py-2 text-right">%</th><th className="py-2 text-right">Comissão</th>
              </tr></thead>
              <tbody>
                {summary.commissions.map(c => (
                  <tr key={c.sellerId} className="border-b border-slate-50">
                    <td className="py-2 font-medium text-slate-700">{c.sellerName}</td>
                    <td className="py-2 text-right text-slate-600">{c.salesCount}</td>
                    <td className="py-2 text-right text-slate-600">{brl(c.salesTotal)}</td>
                    <td className="py-2 text-right text-slate-600">{c.commissionPct}%</td>
                    <td className="py-2 text-right font-semibold text-emerald-600">{brl(c.commission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Nova conta a pagar">
        <div className="space-y-3">
          <FormField label="Descrição" value={form.description} onChange={v => setForm(p => ({ ...p, description: v }))} placeholder="Ex: Aluguel de outubro" />
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label="Categoria" value={form.category} onChange={v => setForm(p => ({ ...p, category: v }))} options={PAYABLE_CATEGORIES.map(c => ({ value: c, label: c }))} />
            <FormField label="Valor (R$)" value={form.amount} onChange={v => setForm(p => ({ ...p, amount: v }))} placeholder="0,00" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Vencimento" type="date" value={form.dueDate} onChange={v => setForm(p => ({ ...p, dueDate: v }))} placeholder="" />
            <FormField label="Nº documento / NF" value={form.invoiceNumber} onChange={v => setForm(p => ({ ...p, invoiceNumber: v }))} placeholder="Opcional" />
          </div>
          <SelectField label="Fornecedor (opcional)" value={form.supplierId} onChange={v => setForm(p => ({ ...p, supplierId: v }))}
            options={[{ value: '', label: 'Nenhum' }, ...suppliers.filter(s => s.active).map(s => ({ value: String(s.id), label: s.name }))]} />
          <Button full loading={busy} onClick={createPayable} disabled={!form.description.trim() || !(parseMoney(form.amount) > 0) || !form.dueDate}>Cadastrar conta</Button>
        </div>
      </Modal>

      <Modal open={payTarget !== null} onClose={() => setPayTarget(null)} title="Registrar pagamento">
        {payTarget && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">{payTarget.description} — <strong>{brl(payTarget.amount)}</strong></p>
            <FormField label="Data do pagamento" type="date" value={payDate} onChange={setPayDate} placeholder="" />
            <FormField label="Valor pago (deixe vazio para o valor integral)" value={payAmount} onChange={setPayAmount} placeholder={payTarget.amount.toFixed(2).replace('.', ',')} />
            <Button full loading={busy} onClick={confirmPay}>Confirmar pagamento</Button>
          </div>
        )}
      </Modal>

      <Modal open={cancelTarget !== null} onClose={() => setCancelTarget(null)} title="Cancelar conta">
        {cancelTarget && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">{cancelTarget.description} — {brl(cancelTarget.amount)}</p>
            <SelectField label="Motivo" value={cancelReason} onChange={setCancelReason}
              options={[{ value: '', label: 'Selecione…' }, ...['Erro de lançamento', 'Cobrança duplicada', 'Negociação com fornecedor', 'Compra cancelada', 'Outros'].map(r => ({ value: r, label: r }))]} />
            <Button full variant="danger" loading={busy} onClick={confirmCancel} disabled={cancelReason.trim().length < 3}>Cancelar conta</Button>
          </div>
        )}
      </Modal>
    </>
  )
}

function Kpi({ label, value, sub, icon: Icon, tone }: { label: string; value: string; sub: string; icon: typeof TrendingUp; tone: 'emerald' | 'rose' | 'brand' }) {
  const bg = tone === 'emerald' ? 'bg-emerald-50 text-emerald-600' : tone === 'rose' ? 'bg-rose-50 text-rose-600' : 'bg-brand-50 text-brand-600'
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[13px] text-slate-400">{label}</p>
          <p className="mt-1.5 text-2xl font-bold text-slate-900">{value}</p>
          <p className="mt-0.5 text-xs text-slate-400">{sub}</p>
        </div>
        <div className={`rounded-xl p-2.5 ${bg}`}><Icon className="h-5 w-5" /></div>
      </div>
    </Card>
  )
}

function DreRow({ label, value, bold, muted, highlight }: { label: string; value: number; bold?: boolean; muted?: boolean; highlight?: boolean }) {
  return (
    <tr className={`border-b border-slate-50 ${highlight ? 'bg-slate-50' : ''}`}>
      <td className={`py-2 pl-1 ${bold ? 'font-semibold text-slate-800' : muted ? 'pl-4 text-slate-400' : 'text-slate-600'}`}>{label}</td>
      <td className={`py-2 pr-1 text-right ${bold ? 'font-bold' : ''} ${value < 0 ? 'text-rose-600' : 'text-slate-800'}`}>{brl(value)}</td>
    </tr>
  )
}
