import { useEffect, useState } from 'react'
import { ArrowDownCircle, ArrowUpCircle, Lock, LockOpen, Wallet, History } from 'lucide-react'
import type { CashSession, Sale, Patient } from '../types'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { SectionTitle } from '../components/ui/SectionTitle'
import { Modal } from '../components/ui/Modal'
import { FormField } from '../components/ui/FormField'
import { Button } from '../components/ui/Button'
import { brl, parseMoney } from '../utils/format'
import { tsToDMY, tsToHM } from '../api/mappers'

type Dialog = null | 'open' | 'close' | 'withdrawal' | 'deposit'

export function CashPage({ session, sales, patients, canManage, onOpen, onClose, onMovement, loadHistory }: {
  session: CashSession | null
  sales: Sale[]
  patients: Patient[]
  canManage: boolean
  onOpen: (amount: number, notes: string) => Promise<boolean>
  onClose: (amount: number, notes: string) => Promise<CashSession | null>
  onMovement: (type: 'withdrawal' | 'deposit', amount: number, reason: string) => Promise<boolean>
  loadHistory: () => Promise<CashSession[]>
}) {
  const [dialog, setDialog] = useState<Dialog>(null)
  const [amount, setAmount] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastClosed, setLastClosed] = useState<CashSession | null>(null)
  const [history, setHistory] = useState<CashSession[] | null>(null)

  useEffect(() => {
    if (canManage) loadHistory().then(setHistory).catch(() => setHistory([]))
  }, [canManage, loadHistory, session?.id])

  const openDialog = (d: Dialog) => {
    setAmount(d === 'close' && session?.summary ? session.summary.expectedCash.toFixed(2).replace('.', ',') : '')
    setText('')
    setDialog(d)
  }

  const value = parseMoney(amount)
  const valid = Number.isFinite(value) && value >= 0 && (dialog === 'open' || dialog === 'close' || value > 0)
  const needsText = dialog === 'withdrawal' || dialog === 'deposit'

  const submit = async () => {
    if (!valid || (needsText && text.trim().length < 3)) return
    setBusy(true)
    try {
      if (dialog === 'open') {
        if (await onOpen(value, text)) setDialog(null)
      } else if (dialog === 'close') {
        const closed = await onClose(value, text)
        if (closed) { setLastClosed(closed); setDialog(null) }
      } else if (dialog === 'withdrawal' || dialog === 'deposit') {
        if (await onMovement(dialog, value, text)) setDialog(null)
      }
    } finally {
      setBusy(false)
    }
  }

  const sum = session?.summary
  const sessionSales = session ? sales.filter(s => s.sessionId === session.id).slice().reverse() : []
  const patientName = (id: number | null) => (id ? patients.find(p => p.id === id)?.name : null) ?? 'Consumidor'
  const diff = (s: CashSession) => (s.closingAmount ?? 0) - (s.expectedAmount ?? 0)

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Caixa</h1>
          <p className="mt-0.5 text-[13px] text-slate-400">
            {session ? `Aberto por ${session.openedByName} em ${tsToDMY(session.openedAt)} às ${tsToHM(session.openedAt)}` : 'Caixa fechado'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {session ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => openDialog('deposit')}><ArrowDownCircle className="h-3.5 w-3.5" /> Suprimento</Button>
              <Button variant="secondary" size="sm" onClick={() => openDialog('withdrawal')}><ArrowUpCircle className="h-3.5 w-3.5" /> Sangria</Button>
              <Button variant="danger" size="sm" onClick={() => openDialog('close')}><Lock className="h-3.5 w-3.5" /> Fechar caixa</Button>
            </>
          ) : (
            <Button size="sm" onClick={() => openDialog('open')}><LockOpen className="h-3.5 w-3.5" /> Abrir caixa</Button>
          )}
        </div>
      </div>

      {lastClosed && (
        <Card className="border border-emerald-200">
          <SectionTitle title="Caixa fechado" sub={`Fechado por ${lastClosed.closedByName} às ${tsToHM(lastClosed.closedAt)}`}
            action={<button onClick={() => setLastClosed(null)} className="text-xs font-semibold text-slate-400 hover:text-slate-600">Ocultar</button>} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Esperado em dinheiro" value={brl(lastClosed.expectedAmount ?? 0)} />
            <Stat label="Contado" value={brl(lastClosed.closingAmount ?? 0)} />
            <Stat label="Diferença" value={brl(diff(lastClosed))} tone={Math.abs(diff(lastClosed)) < 0.01 ? 'emerald' : 'rose'} />
          </div>
        </Card>
      )}

      {!session ? (
        <Card>
          <div className="flex flex-col items-center py-10 text-center">
            <div className="mb-3 rounded-2xl bg-slate-100 p-4 text-slate-400"><Wallet className="h-8 w-8" /></div>
            <p className="text-sm font-semibold text-slate-700">Nenhum caixa aberto</p>
            <p className="mt-1 max-w-sm text-xs text-slate-400">Abra o caixa informando o troco inicial para registrar vendas e recebimentos de OS.</p>
            <div className="mt-4"><Button onClick={() => openDialog('open')}><LockOpen className="h-4 w-4" /> Abrir caixa</Button></div>
          </div>
        </Card>
      ) : sum && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card><Stat label="Vendas no caixa" value={brl(sum.salesTotal)} sub={`${sum.salesCount} venda(s)`} /></Card>
            <Card><Stat label="Troco inicial" value={brl(session.openingAmount)} /></Card>
            <Card><Stat label="Suprimentos / Sangrias" value={`${brl(sum.deposits)} / ${brl(sum.withdrawals)}`} /></Card>
            <Card><Stat label="Dinheiro esperado na gaveta" value={brl(sum.expectedCash)} tone="brand" /></Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-5">
            <Card className="xl:col-span-2">
              <SectionTitle title="Por forma de pagamento" />
              {sum.byMethod.length === 0 ? <p className="py-4 text-center text-sm text-slate-400">Nenhuma venda neste caixa</p> : (
                <div className="space-y-2">
                  {sum.byMethod.map(m => (
                    <div key={m.method} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5">
                      <span className="text-sm font-medium text-slate-700">{m.method} <span className="text-xs text-slate-400">({m.count})</span></span>
                      <span className="text-sm font-bold text-slate-900">{brl(m.total)}</span>
                    </div>
                  ))}
                </div>
              )}
              {sum.movements.length > 0 && (
                <>
                  <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wider text-slate-400">Movimentações</p>
                  <div className="space-y-1.5">
                    {sum.movements.map(m => (
                      <div key={m.id} className="flex items-center justify-between rounded-xl border border-slate-100 px-3 py-2">
                        <div>
                          <p className="text-sm text-slate-700">{m.type === 'deposit' ? 'Suprimento' : 'Sangria'} · {m.reason}</p>
                          <p className="text-[11px] text-slate-400">{tsToHM(m.createdAt)} · {m.userName}</p>
                        </div>
                        <span className={`text-sm font-semibold ${m.type === 'deposit' ? 'text-emerald-600' : 'text-rose-600'}`}>{m.type === 'deposit' ? '+' : '−'}{brl(m.amount)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>

            <Card className="xl:col-span-3">
              <SectionTitle title="Vendas deste caixa" sub={`${sessionSales.length} registro(s)`} />
              <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
                {sessionSales.length === 0 && <p className="py-6 text-center text-sm text-slate-400">Nenhuma venda registrada ainda</p>}
                {sessionSales.map(s => (
                  <div key={s.id} className={`flex items-center justify-between rounded-xl px-3 py-2.5 ${s.status === 'cancelled' ? 'bg-rose-50/50 opacity-70' : 'bg-slate-50'}`}>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{patientName(s.patientId)}{s.orderId ? ` · ${s.orderId}` : ''}</p>
                      <p className="text-[11px] text-slate-400">#{s.id} · {s.time} · {s.paymentMethod} · {s.sellerName}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-bold ${s.status === 'cancelled' ? 'text-rose-500 line-through' : 'text-slate-900'}`}>{brl(s.total)}</p>
                      {s.status === 'cancelled' && <Badge color="rose">Cancelada</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}

      {canManage && history && history.filter(h => h.closedAt).length > 0 && (
        <Card>
          <SectionTitle title="Histórico de caixas" sub="Últimos fechamentos" action={<History className="h-4 w-4 text-slate-300" />} />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="py-2 pr-3">Abertura</th><th className="py-2 pr-3">Fechamento</th><th className="py-2 pr-3">Responsável</th>
                  <th className="py-2 pr-3 text-right">Vendas</th><th className="py-2 pr-3 text-right">Esperado</th><th className="py-2 pr-3 text-right">Contado</th><th className="py-2 text-right">Diferença</th>
                </tr>
              </thead>
              <tbody>
                {history.filter(h => h.closedAt).map(h => (
                  <tr key={h.id} className="border-b border-slate-50">
                    <td className="py-2 pr-3 text-slate-600">{tsToDMY(h.openedAt)} {tsToHM(h.openedAt)}</td>
                    <td className="py-2 pr-3 text-slate-600">{tsToDMY(h.closedAt)} {tsToHM(h.closedAt)}</td>
                    <td className="py-2 pr-3 text-slate-600">{h.closedByName || h.openedByName}</td>
                    <td className="py-2 pr-3 text-right text-slate-700">{brl(h.summary?.salesTotal ?? 0)}</td>
                    <td className="py-2 pr-3 text-right text-slate-700">{brl(h.expectedAmount ?? 0)}</td>
                    <td className="py-2 pr-3 text-right text-slate-700">{brl(h.closingAmount ?? 0)}</td>
                    <td className={`py-2 text-right font-semibold ${Math.abs(diff(h)) < 0.01 ? 'text-emerald-600' : 'text-rose-600'}`}>{brl(diff(h))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal open={dialog !== null} onClose={() => setDialog(null)}
        title={dialog === 'open' ? 'Abrir caixa' : dialog === 'close' ? 'Fechar caixa' : dialog === 'withdrawal' ? 'Sangria' : 'Suprimento'}>
        <div className="space-y-3">
          {dialog === 'close' && sum && (
            <div className="rounded-xl border border-brand-200 bg-brand-50/60 px-4 py-3 text-sm text-brand-800">
              Dinheiro esperado na gaveta: <strong>{brl(sum.expectedCash)}</strong>
              <p className="text-[11px] text-brand-600">Troco {brl(session!.openingAmount)} + vendas em dinheiro {brl(sum.cashSales)} + suprimentos {brl(sum.deposits)} − sangrias {brl(sum.withdrawals)}</p>
            </div>
          )}
          <FormField label={dialog === 'open' ? 'Troco inicial (R$)' : dialog === 'close' ? 'Valor contado na gaveta (R$)' : 'Valor (R$)'}
            value={amount} onChange={setAmount} placeholder="0,00" />
          {dialog === 'close' && sum && Number.isFinite(value) && Math.abs(value - sum.expectedCash) >= 0.01 && (
            <p className={`text-xs font-semibold ${value > sum.expectedCash ? 'text-emerald-600' : 'text-rose-600'}`}>
              {value > sum.expectedCash ? 'Sobra' : 'Falta'} de {brl(Math.abs(value - sum.expectedCash))}
            </p>
          )}
          <FormField label={needsText ? 'Motivo (obrigatório)' : 'Observações (opcional)'} value={text} onChange={setText}
            placeholder={dialog === 'withdrawal' ? 'Ex: Depósito bancário' : dialog === 'deposit' ? 'Ex: Reforço de troco' : ''} />
          <Button full loading={busy} onClick={submit} disabled={!valid || (needsText && text.trim().length < 3)}
            variant={dialog === 'close' ? 'danger' : 'primary'}>
            {dialog === 'open' ? 'Abrir caixa' : dialog === 'close' ? 'Confirmar fechamento' : 'Registrar'}
          </Button>
        </div>
      </Modal>
    </>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'emerald' | 'rose' | 'brand' }) {
  const color = tone === 'emerald' ? 'text-emerald-600' : tone === 'rose' ? 'text-rose-600' : tone === 'brand' ? 'text-brand-600' : 'text-slate-900'
  return (
    <div>
      <p className="text-[13px] text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  )
}
