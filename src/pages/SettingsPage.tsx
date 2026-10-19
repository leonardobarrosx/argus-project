import { useState } from 'react'
import { Building2, Glasses, KeyRound, Plus, UserRound } from 'lucide-react'
import type { Collaborator, LensCatalogItem, Tenant } from '../types'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { SectionTitle } from '../components/ui/SectionTitle'
import { Modal } from '../components/ui/Modal'
import { FormField } from '../components/ui/FormField'
import { Button } from '../components/ui/Button'
import { brl, parseMoney } from '../utils/format'
import { ROLE_LABELS } from '../lib/permissions'
import type { LensInput, TenantInput } from '../api'

type Tab = 'account' | 'store' | 'lenses'

export function SettingsPage({ tenant, user, lenses, canManage, onSaveTenant, onChangePassword, onSaveLens }: {
  tenant: Tenant; user: Collaborator; lenses: LensCatalogItem[]; canManage: boolean
  onSaveTenant: (input: TenantInput) => Promise<boolean>
  onChangePassword: (current: string, next: string) => Promise<boolean>
  onSaveLens: (id: number | null, input: LensInput) => Promise<boolean>
}) {
  const [tab, setTab] = useState<Tab>('account')
  const tabs: { key: Tab; label: string; icon: typeof UserRound }[] = [
    { key: 'account', label: 'Minha conta', icon: UserRound },
    ...(canManage ? [{ key: 'store' as const, label: 'Dados da ótica', icon: Building2 }, { key: 'lenses' as const, label: 'Catálogo de lentes', icon: Glasses }] : []),
  ]

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Configurações</h1>
        <p className="mt-0.5 text-[13px] text-slate-400">{tenant.name}</p>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map(t => {
          const Icon = t.icon
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${tab === t.key ? 'bg-brand-500 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
              <Icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          )
        })}
      </div>
      {tab === 'account' && <AccountTab user={user} tenant={tenant} onChangePassword={onChangePassword} />}
      {tab === 'store' && canManage && <StoreTab tenant={tenant} onSave={onSaveTenant} />}
      {tab === 'lenses' && canManage && <LensesTab lenses={lenses} onSave={onSaveLens} />}
    </>
  )
}

function AccountTab({ user, tenant, onChangePassword }: { user: Collaborator; tenant: Tenant; onChangePassword: (c: string, n: string) => Promise<boolean> }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const mismatch = confirm.length > 0 && next !== confirm
  const submit = async () => {
    if (next.length < 8 || mismatch || !current) return
    setBusy(true)
    const ok = await onChangePassword(current, next)
    setBusy(false)
    if (ok) { setCurrent(''); setNext(''); setConfirm('') }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <SectionTitle title="Perfil" />
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-500 text-sm font-bold text-white">
            {user.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
          </div>
          <div>
            <p className="font-semibold text-slate-900">{user.name}</p>
            <p className="text-sm text-slate-400">{user.email}</p>
            <Badge>{ROLE_LABELS[user.role]}</Badge>
          </div>
        </div>
        {tenant.plan === 'trial' && tenant.trialEndsAt && (
          <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Período de teste até {new Date(tenant.trialEndsAt).toLocaleDateString('pt-BR')}.
          </p>
        )}
      </Card>
      <Card>
        <SectionTitle title="Alterar senha" sub="Outros dispositivos conectados serão desconectados" action={<KeyRound className="h-4 w-4 text-slate-300" />} />
        <div className="space-y-3">
          <FormField label="Senha atual" type="password" value={current} onChange={setCurrent} placeholder="••••••••" />
          <FormField label="Nova senha" type="password" value={next} onChange={setNext} placeholder="Mínimo 8 caracteres" />
          <FormField label="Confirmar nova senha" type="password" value={confirm} onChange={setConfirm} placeholder="Repita a nova senha" />
          {mismatch && <p className="text-xs font-medium text-rose-600">As senhas não conferem</p>}
          <Button full loading={busy} onClick={submit} disabled={!current || next.length < 8 || mismatch || !confirm}>Salvar nova senha</Button>
        </div>
      </Card>
    </div>
  )
}

function StoreTab({ tenant, onSave }: { tenant: Tenant; onSave: (i: TenantInput) => Promise<boolean> }) {
  const [form, setForm] = useState<TenantInput>({
    name: tenant.name, cnpj: tenant.cnpj, phone: tenant.phone, email: tenant.email, address: tenant.address,
    city: tenant.city, state: tenant.state, requireCashSession: tenant.requireCashSession,
    rxValidityMonths: tenant.rxValidityMonths, receiptFooter: tenant.receiptFooter,
  })
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof TenantInput>(k: K) => (v: TenantInput[K]) => setForm(p => ({ ...p, [k]: v }))
  const submit = async () => {
    if (form.name.trim().length < 2) return
    setBusy(true)
    await onSave(form)
    setBusy(false)
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <SectionTitle title="Dados da ótica" sub="Aparecem no recibo e na ordem de serviço impressa" />
        <div className="space-y-3">
          <FormField label="Nome fantasia" value={form.name} onChange={set('name')} placeholder="Ótica…" />
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="CNPJ" value={form.cnpj} onChange={set('cnpj')} placeholder="00.000.000/0000-00" />
            <FormField label="Telefone" value={form.phone} onChange={set('phone')} placeholder="(00) 0000-0000" />
          </div>
          <FormField label="E-mail" value={form.email} onChange={set('email')} placeholder="contato@otica.com.br" />
          <FormField label="Endereço" value={form.address} onChange={set('address')} placeholder="Rua, número — bairro" />
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2"><FormField label="Cidade" value={form.city} onChange={set('city')} placeholder="Cidade" /></div>
            <FormField label="UF" value={form.state} onChange={v => set('state')(v.toUpperCase().slice(0, 2))} placeholder="SP" />
          </div>
        </div>
      </Card>
      <Card>
        <SectionTitle title="Regras de operação" />
        <div className="space-y-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input type="checkbox" checked={form.requireCashSession} onChange={e => set('requireCashSession')(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-500" />
            <span>
              <span className="block text-sm font-medium text-slate-700">Exigir caixa aberto para vender</span>
              <span className="block text-xs text-slate-400">Vendas e recebimentos de OS só podem ser registrados com o caixa aberto.</span>
            </span>
          </label>
          <FormField label="Validade padrão da receita (meses)" type="number" value={String(form.rxValidityMonths)}
            onChange={v => set('rxValidityMonths')(Math.min(60, Math.max(1, parseInt(v, 10) || 12)))} placeholder="12" />
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-500">Rodapé do recibo / OS</label>
            <textarea value={form.receiptFooter} onChange={e => set('receiptFooter')(e.target.value)} rows={3} maxLength={300}
              placeholder="Ex: Garantia de 90 dias contra defeitos de fabricação."
              className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100" />
          </div>
          <Button full loading={busy} onClick={submit} disabled={form.name.trim().length < 2}>Salvar configurações</Button>
        </div>
      </Card>
    </div>
  )
}

const EMPTY_LENS = { name: '', description: '', lensType: 'Simples', index: '1.56', price: '', costPrice: '' }

function LensesTab({ lenses, onSave }: { lenses: LensCatalogItem[]; onSave: (id: number | null, i: LensInput) => Promise<boolean> }) {
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [form, setForm] = useState(EMPTY_LENS)
  const [busy, setBusy] = useState(false)
  const types = [...new Set(lenses.map(l => l.lensType))]

  const open = (l?: LensCatalogItem) => {
    setForm(l ? { name: l.name, description: l.description, lensType: l.lensType, index: l.index, price: String(l.price), costPrice: String(l.costPrice) } : EMPTY_LENS)
    setEditing(l ? l.id : 'new')
  }
  const toInput = (f: typeof form, active?: boolean): LensInput => ({
    name: f.name.trim(), description: f.description.trim(), lensType: f.lensType.trim(), index: f.index.trim(),
    price: parseMoney(f.price), costPrice: parseMoney(f.costPrice) || 0, ...(active !== undefined ? { active } : {}),
  })
  const save = async () => {
    const input = toInput(form)
    if (input.name.length < 2 || !(input.price >= 0) || !input.lensType) return
    setBusy(true)
    const ok = await onSave(editing === 'new' ? null : editing, input)
    setBusy(false)
    if (ok) setEditing(null)
  }
  const toggle = (l: LensCatalogItem) => onSave(l.id, {
    name: l.name, description: l.description, lensType: l.lensType, index: l.index, price: l.price, costPrice: l.costPrice, active: !l.active,
  })

  return (
    <Card>
      <SectionTitle title="Catálogo de lentes" sub="Lentes surfaçadas vendidas por par no PDV (sem controle de estoque)"
        action={<Button size="sm" onClick={() => open()}><Plus className="h-3.5 w-3.5" /> Nova lente</Button>} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <th className="py-2 pr-3">Lente</th><th className="py-2 pr-3">Tipo</th><th className="py-2 pr-3">Índice</th>
            <th className="py-2 pr-3 text-right">Custo</th><th className="py-2 pr-3 text-right">Venda</th><th className="py-2 pr-3 text-right">Margem</th><th className="py-2" />
          </tr></thead>
          <tbody>
            {lenses.map(l => (
              <tr key={l.id} className={`border-b border-slate-50 ${l.active ? '' : 'opacity-50'}`}>
                <td className="py-2 pr-3"><p className="font-medium text-slate-800">{l.name}</p><p className="text-[11px] text-slate-400">{l.description}</p></td>
                <td className="py-2 pr-3 text-slate-600">{l.lensType}</td>
                <td className="py-2 pr-3 text-slate-600">{l.index}</td>
                <td className="py-2 pr-3 text-right text-slate-600">{brl(l.costPrice)}</td>
                <td className="py-2 pr-3 text-right font-semibold text-slate-800">{brl(l.price)}</td>
                <td className="py-2 pr-3 text-right text-slate-600">{l.price > 0 ? `${(((l.price - l.costPrice) / l.price) * 100).toFixed(0)}%` : '—'}</td>
                <td className="py-2 text-right whitespace-nowrap">
                  <button onClick={() => open(l)} className="mr-2 text-xs font-semibold text-brand-600 hover:text-brand-700">Editar</button>
                  <button onClick={() => toggle(l)} className="text-xs font-semibold text-slate-400 hover:text-slate-600">{l.active ? 'Desativar' : 'Ativar'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Nova lente' : 'Editar lente'}>
        <div className="space-y-3">
          <FormField label="Nome" value={form.name} onChange={v => setForm(p => ({ ...p, name: v }))} placeholder="Ex: Blue Light 1.67" />
          <FormField label="Descrição" value={form.description} onChange={v => setForm(p => ({ ...p, description: v }))} placeholder="Opcional" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Tipo</label>
              <input list="lens-types" value={form.lensType} onChange={e => setForm(p => ({ ...p, lensType: e.target.value }))}
                className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100" />
              <datalist id="lens-types">{types.map(t => <option key={t} value={t} />)}</datalist>
            </div>
            <FormField label="Índice de refração" value={form.index} onChange={v => setForm(p => ({ ...p, index: v }))} placeholder="1.56" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Custo (R$)" value={form.costPrice} onChange={v => setForm(p => ({ ...p, costPrice: v }))} placeholder="0,00" />
            <FormField label="Venda (R$)" value={form.price} onChange={v => setForm(p => ({ ...p, price: v }))} placeholder="0,00" />
          </div>
          <Button full loading={busy} onClick={save} disabled={form.name.trim().length < 2 || !(parseMoney(form.price) >= 0)}>Salvar lente</Button>
        </div>
      </Modal>
      {types.length === 0 && <p className="py-4 text-center text-sm text-slate-400">Nenhuma lente cadastrada</p>}
    </Card>
  )
}
