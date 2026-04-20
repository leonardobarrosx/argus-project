import { TrendingUp, TrendingDown, Microscope, AlertTriangle, Send, Gift, CheckCircle2, Package, Sparkles, History, ChevronRight } from 'lucide-react'
import type { Patient, Prescription, ServiceOrder, StockItem, Sale, Suggestion, PageKey } from '../types'
import { parseDMY, daysBetween, TODAY, TODAY_D } from '../utils/helpers'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { SectionTitle } from '../components/ui/SectionTitle'
import { ActionRowCRM } from '../components/ActionRowCRM'

export function OverviewPage({ patients, prescriptions, orders, stock, sales, suggestions, onAdvanceOrder, onOpenCampaign, onGoToPage }: {
  patients: Patient[]; prescriptions: Prescription[]; orders: ServiceOrder[]; stock: StockItem[]; sales: Sale[];
  suggestions: Suggestion[]; onAdvanceOrder: (id: string) => void;
  onOpenCampaign: () => void; onGoToPage: (p: PageKey) => void
}) {
  const inProd = orders.filter(o => o.status === 'production').length
  const ready = orders.filter(o => o.status === 'ready').length
  const lowStock = stock.filter(s => s.qty <= s.min).length
  const totalRevenue = sales.reduce((s, x) => s + x.total, 0)

  // Birthdays today
  const birthdaysToday = patients.filter(p => {
    const bd = parseDMY(p.birthDate)
    return bd && bd.getDate() === TODAY_D.getDate() && bd.getMonth() === TODAY_D.getMonth()
  })

  // Prescriptions expiring soon
  const expiringRxs = prescriptions.filter(r => {
    const exp = parseDMY(r.expiresAt)
    if (!exp) return false
    const days = daysBetween(TODAY_D, exp)
    return days > 0 && days <= 30
  })
  const producedToday = orders.filter((o) => o.readyAt === TODAY).length
  const deliveredToday = orders.filter((o) => o.deliveredAt === TODAY).length
  const salesToday = sales.filter((s) => s.date === TODAY).length

  const metrics = [
    { label: 'Faturamento', value: `R$ ${totalRevenue.toFixed(2).replace('.', ',')}`, trend: `${sales.length} venda(s)`, dir: 'up' as const, icon: TrendingUp, spark: 'M0 18 C10 10,20 14,30 8 C40 3,50 11,60 2' },
    { label: 'Produção / Prontos', value: `${inProd} / ${ready}`, trend: `${orders.length} OS total`, dir: 'neutral' as const, icon: Microscope, spark: 'M0 10 C10 4,20 9,30 16 C40 18,50 13,60 9' },
    { label: 'Alertas de estoque', value: String(lowStock), trend: `${stock.length} produtos`, dir: lowStock > 0 ? 'down' as const : 'neutral' as const, icon: AlertTriangle, spark: 'M0 14 C8 13,16 12,24 12 C34 12,44 8,60 8' },
  ]

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] text-slate-400">{TODAY} · {patients.length} pacientes · {prescriptions.length} receitas</p>
          <h1 className="mt-1 text-xl font-semibold text-slate-900 sm:text-2xl">Bem-vinda, Dra. Eliza</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={onOpenCampaign} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-brand-300 hover:text-brand-600">
            <Send className="h-3.5 w-3.5" /> Campanhas
          </button>
          <Badge>Visão geral</Badge>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map(m => {
          const Icon = m.icon
          return (
            <Card key={m.label}>
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <p className="text-[13px] text-slate-400">{m.label}</p>
                  <p className="mt-1.5 text-2xl font-bold text-slate-900">{m.value}</p>
                </div>
                <div className="rounded-xl bg-brand-50 p-2.5 text-brand-500"><Icon className="h-5 w-5" /></div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <Badge color={m.dir === 'up' ? 'emerald' : m.dir === 'down' ? 'rose' : 'slate'}>
                  {m.dir === 'up' && <TrendingUp className="h-3 w-3" />}{m.dir === 'down' && <TrendingDown className="h-3 w-3" />}{m.trend}
                </Badge>
                <svg viewBox="0 0 60 20" className="h-6 w-16 text-brand-400"><path d={m.spark} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              </div>
            </Card>
          )
        })}
      </div>

      {/* ERP process guide */}
      <Card>
        <SectionTitle title="Fluxo do ERP" sub="Sequência recomendada: Receita → Laboratório → Entrega → Venda/CRM" />
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">1. Receita</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{prescriptions.length} registradas</p>
            <button onClick={() => onGoToPage('patients')} className="mt-2 text-xs font-semibold text-brand-600 hover:text-brand-700">Ir para pacientes</button>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">2. Produção</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{inProd} em produção · {producedToday} prontas hoje</p>
            <button onClick={() => onGoToPage('lab')} className="mt-2 text-xs font-semibold text-brand-600 hover:text-brand-700">Ir para laboratório</button>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">3. Entrega</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{ready} aguardando retirada · {deliveredToday} entregues hoje</p>
            <button onClick={onOpenCampaign} className="mt-2 text-xs font-semibold text-brand-600 hover:text-brand-700">Notificar clientes</button>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">4. Venda/CRM</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{salesToday} venda(s) hoje · campanhas ativas</p>
            <button onClick={() => onGoToPage('pdv')} className="mt-2 text-xs font-semibold text-brand-600 hover:text-brand-700">Ir para PDV</button>
          </div>
        </div>
      </Card>

      {/* CRM actions — real data */}
      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <SectionTitle title="Alertas e ações" sub="Baseado nos dados reais do sistema" />
          <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
            {birthdaysToday.length > 0 && (
              <ActionRowCRM icon={Gift} title={`${birthdaysToday.length} aniversariante(s) hoje`}
                sub={birthdaysToday.map(p => p.name).join(', ')} tone="blue"
                onAction={onOpenCampaign} />
            )}
            {expiringRxs.length > 0 && (
              <ActionRowCRM icon={AlertTriangle} title={`${expiringRxs.length} receita(s) expirando em breve`}
                sub="Contatar para renovação" tone="amber" onAction={onOpenCampaign} />
            )}
            {ready > 0 && (
              <ActionRowCRM icon={CheckCircle2} title={`${ready} óculos pronto(s) para retirada`}
                sub="Avisar clientes para buscar" tone="emerald" onAction={onOpenCampaign} />
            )}
            {lowStock > 0 && (
              <ActionRowCRM icon={Package} title={`${lowStock} produto(s) abaixo do mínimo`}
                sub="Verificar estoque e repor" tone="amber" onAction={() => {}} />
            )}
            {birthdaysToday.length === 0 && expiringRxs.length === 0 && ready === 0 && lowStock === 0 && (
              <p className="py-4 text-center text-sm text-slate-400">✅ Nenhum alerta no momento</p>
            )}
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <SectionTitle title="Sugestões inteligentes" sub="Análise real do estoque"
            action={<Badge color="slate"><Sparkles className="h-3 w-3" /> Auto</Badge>} />
          {suggestions.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">Estoque equilibrado</p>
          ) : (
            <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
              {suggestions.slice(0, 4).map((s, i) => (
                <div key={i} className={`rounded-xl p-3 ${s.severity === 'critical' ? 'border border-rose-200 bg-rose-50/60' : s.severity === 'warning' ? 'border border-amber-200 bg-amber-50/40' : 'border border-slate-100 bg-slate-50/50'}`}>
                  <p className={`text-sm font-semibold ${s.severity === 'critical' ? 'text-rose-700' : s.severity === 'warning' ? 'text-amber-700' : 'text-slate-800'}`}>{s.title}</p>
                  <p className="text-xs text-slate-400">{s.sub}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Kanban + recent activity */}
      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <SectionTitle title="Laboratório" sub="Ordens de serviço" />
          <div className="grid gap-3 sm:grid-cols-3">
            {(['production', 'ready', 'delivered'] as const).map(status => {
              const colOrders = orders.filter(o => o.status === status)
              const colTitle = status === 'production' ? 'Em produção' : status === 'ready' ? 'Pronto' : 'Entregue'
              return (
                <div key={status} className="rounded-xl bg-slate-50 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-700">{colTitle}</h3>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500">{colOrders.length}</span>
                  </div>
                  <div className="max-h-[280px] space-y-2 overflow-y-auto pr-1">
                    {colOrders.length === 0 && <p className="py-3 text-center text-xs text-slate-300">Vazio</p>}
                    {colOrders.map(o => {
                      const pat = patients.find(p => p.id === o.patientId)
                      return (
                        <div key={o.id} className="rounded-xl border border-slate-100 bg-white p-2.5">
                          <div className="mb-1 flex items-center justify-between">
                            <p className="text-sm font-semibold text-slate-800">{pat?.name}</p>
                            <span className="rounded-md bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">{o.id}</span>
                          </div>
                          <p className="text-xs text-slate-400">Criada: {o.createdAt}</p>
                          {status !== 'delivered' && (
                            <button onClick={() => onAdvanceOrder(o.id)}
                              disabled={status === 'ready' && !sales.some(s => s.orderId === o.id)}
                              className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-brand-500 transition hover:text-brand-700 disabled:opacity-40 disabled:pointer-events-none">
                              <ChevronRight className="h-3 w-3" />{status === 'production' ? 'Marcar pronto' : 'Marcar entregue'}
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <SectionTitle title="Últimas vendas" />
          {sales.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">Nenhuma venda ainda</p>
          ) : (
            <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
              {sales.slice(-5).reverse().map(s => {
                const pat = s.patientId ? patients.find(p => p.id === s.patientId) : null
                return (
                  <div key={s.id} className="flex items-start gap-3 rounded-xl bg-slate-50 p-3">
                    <History className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
                    <div>
                      <p className="text-sm font-medium text-slate-800">R$ {s.total.toFixed(2)} · {s.paymentMethod}</p>
                      <p className="text-xs text-slate-400">{pat?.name ?? 'Sem paciente'} · {s.date}{s.orderId ? ` · ${s.orderId}` : ''}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>
    </>
  )
}
