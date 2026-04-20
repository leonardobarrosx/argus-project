import { useState } from 'react'
import { Search, UserPlus, UserRound, X, Plus, Glasses, Trash2, ShoppingCart, Check, CreditCard, Users } from 'lucide-react'
import type { StockItem, Patient, CartItem, CartGlassesItem } from '../types'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { SectionTitle } from '../components/ui/SectionTitle'
import { SelectField } from '../components/ui/SelectField'

export function PdvPage({ stock, patients, cart, glassesCart, cartTotal,
  onAddToCart, onRemoveFromCart, onRemoveGlasses, onClearCart, onFinalizeSale,
  pdvClientId, onSelectClient, onOpenNewClient, onOpenNewDependent, onOpenAddGlasses,
  getDependents, generateOs, onToggleOs, osPaid, onToggleOsPaid }: {
  stock: StockItem[]; patients: Patient[];
  cart: CartItem[]; glassesCart: CartGlassesItem[]; cartTotal: number;
  onAddToCart: (name: string, price: number, stockItemId: number) => void; onRemoveFromCart: (id: number) => void;
  onRemoveGlasses: (id: number) => void; onClearCart: () => void;
  onFinalizeSale: (pm: string) => boolean;
  pdvClientId: number | null; onSelectClient: (id: number | null) => void;
  onOpenNewClient: () => void; onOpenNewDependent: () => void; onOpenAddGlasses: () => void;
  getDependents: (id: number) => Patient[];
  generateOs: boolean; onToggleOs: (v: boolean) => void;
  osPaid: boolean; onToggleOsPaid: (v: boolean) => void;
}) {
  const [saleCompleted, setSaleCompleted] = useState(false)
  const [saleError, setSaleError] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('Cartão crédito')
  const [catalogSearch, setCatalogSearch] = useState('')
  const [clientSearch, setClientSearch] = useState('')

  const hasItems = cart.length > 0 || glassesCart.length > 0

  const handleFinalize = () => {
    if (!hasItems) return
    if (!pdvClientId) {
      setSaleError('Selecione um cliente para finalizar a venda.')
      return
    }
    const ok = onFinalizeSale(paymentMethod)
    if (!ok) {
      setSaleError('Verifique estoque e cliente antes de finalizar.')
      return
    }
    setSaleError('')
    setSaleCompleted(true)
    setTimeout(() => setSaleCompleted(false), 2500)
  }

  // Catalog: accessories only (frames are in glasses flow)
  const catalog = stock.filter(s => s.qty > 0 && (s.category === 'Acessórios' || s.category === 'Tratamentos'))
  const catalogFiltered = catalogSearch ? catalog.filter(s => s.name.toLowerCase().includes(catalogSearch.toLowerCase())) : catalog

  // Client search list (only "responsáveis", not dependents at top level)
  const mainClients = patients.filter(p => !p.parentId)
  const clientsFiltered = clientSearch
    ? mainClients.filter(p => p.name.toLowerCase().includes(clientSearch.toLowerCase()) || p.cpf.includes(clientSearch))
    : mainClients

  const selectedClient = pdvClientId ? patients.find(p => p.id === pdvClientId) : null
  const dependents = pdvClientId ? getDependents(pdvClientId) : []

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Ponto de venda</h1>
          <p className="mt-0.5 text-[13px] text-slate-400">Selecione o cliente, monte os óculos e finalize a venda</p>
        </div>
        <Badge color="emerald">PDV ativo</Badge>
      </div>

      {/* ── 1. Client selection ── */}
      <Card>
        <SectionTitle title="1. Cliente (responsável financeiro)" sub="Selecione ou cadastre o cliente que realizará a compra" />
        {!selectedClient ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
                <input value={clientSearch} onChange={e => setClientSearch(e.target.value)} placeholder="Buscar cliente por nome ou CPF…"
                  className="h-10 w-full rounded-xl border border-slate-200/80 bg-slate-50/80 pl-10 pr-4 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100" />
              </div>
              <button onClick={onOpenNewClient}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600">
                <UserPlus className="h-4 w-4" /> Novo cliente
              </button>
            </div>
            <div className="max-h-[200px] space-y-1 overflow-y-auto pr-1">
              {clientsFiltered.length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-400">Nenhum cliente encontrado. Cadastre um novo.</p>
              ) : clientsFiltered.map(p => (
                <button key={p.id} onClick={() => onSelectClient(p.id)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-brand-50/60">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-brand-500"><UserRound className="h-4 w-4" /></div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{p.name}</p>
                    <p className="text-xs text-slate-400">{p.cpf} · {p.phone}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50/40 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-brand-600"><UserRound className="h-5 w-5" /></div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{selectedClient.name}</p>
                  <p className="text-xs text-slate-400">{selectedClient.cpf} · {selectedClient.phone}</p>
                </div>
              </div>
              <button onClick={() => onSelectClient(null)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white hover:text-rose-500">
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* Dependents */}
            <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <Users className="mr-1 inline h-3 w-3" /> Dependentes / Familiares ({dependents.length})
                </p>
                <button onClick={onOpenNewDependent}
                  className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-brand-600 transition hover:bg-brand-50">
                  <Plus className="h-3 w-3" /> Adicionar
                </button>
              </div>
              {dependents.length === 0 ? (
                <p className="text-xs text-slate-400">Nenhum dependente cadastrado</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {dependents.map(d => (
                    <span key={d.id} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200">
                      <UserRound className="h-3 w-3 text-slate-400" /> {d.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* ── 2. Build order ── */}
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3 space-y-4">
          {/* Add glasses */}
          <Card>
            <SectionTitle title="2. Montar óculos" sub="Adicione óculos completos (armação + lente + prescrição)" />
            <button onClick={onOpenAddGlasses} disabled={!pdvClientId}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-40">
              <Glasses className="h-4 w-4" /> Montar óculos
            </button>
            {!pdvClientId && <p className="mt-2 text-xs text-slate-400">Selecione um cliente primeiro</p>}
          </Card>

          {/* Accessories catalog */}
          <Card>
            <SectionTitle title="Produtos avulsos" sub={`${catalog.length} acessórios e tratamentos disponíveis`} />
            <div className="relative mb-3 max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
              <input value={catalogSearch} onChange={e => setCatalogSearch(e.target.value)} placeholder="Buscar produto…"
                className="h-9 w-full rounded-xl border border-slate-200/80 bg-slate-50/80 pl-10 pr-4 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100" />
            </div>
            <div className="max-h-[300px] grid gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {catalogFiltered.map(item => (
                <button key={item.id} onClick={() => onAddToCart(item.name, item.price, item.id)}
                  className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 p-3 text-left transition hover:border-brand-200 hover:bg-brand-50/30 active:scale-[0.99]">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{item.name}</p>
                    <p className="text-xs text-slate-400">R$ {item.price.toFixed(2)} · {item.qty} em estoque</p>
                  </div>
                  <Plus className="h-4 w-4 text-brand-400" />
                </button>
              ))}
            </div>
          </Card>
        </div>

        {/* ── 3. Cart ── */}
        <Card className="xl:col-span-2">
          <SectionTitle title="Carrinho"
            sub={!hasItems ? 'Vazio' : `${glassesCart.length} óculos · ${cart.length} produto(s)`}
            action={hasItems ? <button onClick={onClearCart} className="text-xs font-medium text-rose-500 hover:text-rose-700 transition">Limpar</button> : undefined} />

          {!hasItems ? (
            <div className="flex flex-col items-center py-8 text-slate-300"><ShoppingCart className="mb-2 h-10 w-10" /><p className="text-sm">Monte óculos ou adicione produtos</p></div>
          ) : (
            <div className="max-h-[400px] space-y-2 overflow-y-auto pr-1">
              {/* Glasses items */}
              {glassesCart.map(g => (
                <div key={g.id} className="rounded-xl border border-brand-200 bg-brand-50/30 p-3">
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Glasses className="h-4 w-4 text-brand-500" />
                      <p className="text-sm font-semibold text-slate-900">{g.beneficiaryName}</p>
                    </div>
                    <button onClick={() => onRemoveGlasses(g.id)} className="rounded-lg p-1 text-slate-400 hover:bg-white hover:text-rose-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="text-xs text-slate-600">Armação: {g.frameName} · R$ {g.framePrice.toFixed(2)}</p>
                  <p className="text-xs text-slate-600">Lente: {g.lensName} · R$ {g.lensPrice.toFixed(2)}</p>
                  {g.isReadyMade && <Badge color="slate">Óculos pronto</Badge>}
                  <p className="mt-1 text-xs font-semibold text-brand-600">Subtotal: R$ {(g.framePrice + g.lensPrice).toFixed(2)}</p>
                </div>
              ))}
              {/* Accessory items */}
              {cart.map(c => (
                <div key={c.id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{c.name}</p>
                    <p className="text-xs text-slate-400">{c.qty}× R$ {c.price.toFixed(2)}</p>
                  </div>
                  <button onClick={() => onRemoveFromCart(c.id)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-500"><X className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          )}

          {hasItems && (
            <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
              {/* OS options */}
              {glassesCart.length > 0 && (
                <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Ordem de serviço</p>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={generateOs} onChange={e => onToggleOs(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-400" />
                    <span className="text-sm text-slate-700">Gerar OS para os óculos</span>
                  </label>
                  {generateOs && (
                    <label className="flex items-center gap-2 cursor-pointer ml-6">
                      <input type="checkbox" checked={osPaid} onChange={e => onToggleOsPaid(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-400" />
                      <span className="text-sm text-slate-700">OS já paga (pagamento antecipado)</span>
                    </label>
                  )}
                  {generateOs && !osPaid && (
                    <p className="text-xs text-amber-600 ml-6">OS será gerada como "não paga" — cobrar na entrega</p>
                  )}
                </div>
              )}

              <SelectField label="Forma de pagamento" value={paymentMethod} onChange={setPaymentMethod}
                options={[{ value: 'Cartão crédito', label: 'Cartão crédito' }, { value: 'Cartão débito', label: 'Cartão débito' }, { value: 'PIX', label: 'PIX' }, { value: 'Dinheiro', label: 'Dinheiro' }, { value: 'Boleto', label: 'Boleto' }]} />
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Total</span>
                <span className="text-lg font-bold text-slate-900">R$ {cartTotal.toFixed(2)}</span>
              </div>
              <button onClick={handleFinalize} disabled={saleCompleted || !pdvClientId}
                className="w-full rounded-xl bg-brand-500 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600 active:scale-[0.99] disabled:opacity-60">
                {saleCompleted ? <><Check className="mr-2 inline h-4 w-4" /> Venda registrada!</> : <><CreditCard className="mr-2 inline h-4 w-4" /> Finalizar venda</>}
              </button>
              {saleError && <p className="text-xs font-medium text-rose-600">{saleError}</p>}
            </div>
          )}
        </Card>
      </div>
    </>
  )
}
