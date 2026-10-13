import { useState } from 'react'
import { Building2, Edit2, Mail, Phone, Plus, Search } from 'lucide-react'
import type { Payable, StockItem, Supplier } from '../types'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Modal } from '../components/ui/Modal'
import { FormField } from '../components/ui/FormField'
import { SelectField } from '../components/ui/SelectField'
import { Button } from '../components/ui/Button'
import { brl } from '../utils/format'
import type { SupplierInput } from '../api'

const EMPTY: SupplierInput = { name: '', cnpj: '', contact: '', phone: '', email: '', creditTerm: 30, notes: '' }

export function SuppliersPage({ suppliers, products, payables, onSave }: {
  suppliers: Supplier[]; products: StockItem[]; payables: Payable[]
  onSave: (id: number | null, input: SupplierInput) => Promise<boolean>
}) {
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [editing, setEditing] = useState<number | null | 'new'>(null)
  const [form, setForm] = useState<SupplierInput>(EMPTY)
  const [busy, setBusy] = useState(false)

  const list = suppliers.filter(s => (showInactive || s.active) && (!search || s.name.toLowerCase().includes(search.toLowerCase()) || s.cnpj.includes(search)))

  const open = (s?: Supplier) => {
    setForm(s ? { name: s.name, cnpj: s.cnpj, contact: s.contact, phone: s.phone, email: s.email, creditTerm: s.creditTerm, notes: s.notes } : EMPTY)
    setEditing(s ? s.id : 'new')
  }

  const save = async () => {
    if (form.name.trim().length < 2) return
    setBusy(true)
    const ok = await onSave(editing === 'new' ? null : editing, form)
    setBusy(false)
    if (ok) setEditing(null)
  }

  const toggle = async (s: Supplier) => {
    await onSave(s.id, { name: s.name, cnpj: s.cnpj, contact: s.contact, phone: s.phone, email: s.email, creditTerm: s.creditTerm, notes: s.notes, active: !s.active })
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Fornecedores</h1>
          <p className="mt-0.5 text-[13px] text-slate-400">{suppliers.filter(s => s.active).length} ativo(s)</p>
        </div>
        <Button size="sm" onClick={() => open()}><Plus className="h-3.5 w-3.5" /> Novo fornecedor</Button>
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nome ou CNPJ…"
              className="h-9 w-full rounded-xl border border-slate-200/80 bg-slate-50/80 pl-10 pr-4 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100" />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-500">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-500" />
            Mostrar inativos
          </label>
        </div>
        <div className="space-y-1.5">
          {list.length === 0 && <p className="py-8 text-center text-sm text-slate-400">Nenhum fornecedor cadastrado</p>}
          {list.map(s => {
            const prodCount = products.filter(p => p.supplierId === s.id).length
            const openAmount = payables.filter(p => p.supplierId === s.id && p.status === 'pending').reduce((t, p) => t + p.amount, 0)
            return (
              <div key={s.id} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-3 ${s.active ? 'hover:bg-slate-50' : 'bg-slate-50/40 opacity-60'}`}>
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Building2 className="h-4 w-4" /></div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-800">{s.name}</p>
                      {!s.active && <Badge color="slate">Inativo</Badge>}
                      <Badge color="blue">Prazo {s.creditTerm === 0 ? 'à vista' : `${s.creditTerm} dias`}</Badge>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                      {s.cnpj && <span>CNPJ {s.cnpj}</span>}
                      {s.contact && <span>{s.contact}</span>}
                      {s.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{s.phone}</span>}
                      {s.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{s.email}</span>}
                      <span>{prodCount} produto(s)</span>
                      {openAmount > 0 && <span className="font-semibold text-amber-600">{brl(openAmount)} a pagar</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => open(s)} className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-400 transition hover:border-brand-300 hover:text-brand-600" title="Editar"><Edit2 className="h-3.5 w-3.5" /></button>
                  <button onClick={() => toggle(s)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-500 transition hover:border-brand-300 hover:text-brand-600">{s.active ? 'Desativar' : 'Ativar'}</button>
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Novo fornecedor' : 'Editar fornecedor'}>
        <div className="space-y-3">
          <FormField label="Razão social / nome" value={form.name} onChange={v => setForm(p => ({ ...p, name: v }))} placeholder="Ex: Luxottica Brasil" />
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="CNPJ" value={form.cnpj} onChange={v => setForm(p => ({ ...p, cnpj: v }))} placeholder="00.000.000/0000-00" />
            <FormField label="Contato" value={form.contact} onChange={v => setForm(p => ({ ...p, contact: v }))} placeholder="Nome do representante" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Telefone" value={form.phone} onChange={v => setForm(p => ({ ...p, phone: v }))} placeholder="(00) 0000-0000" />
            <FormField label="E-mail" value={form.email} onChange={v => setForm(p => ({ ...p, email: v }))} placeholder="contato@fornecedor.com" />
          </div>
          <SelectField label="Prazo de pagamento" value={String(form.creditTerm)} onChange={v => setForm(p => ({ ...p, creditTerm: Number(v) }))}
            options={[0, 7, 15, 28, 30, 45, 60, 90].map(d => ({ value: String(d), label: d === 0 ? 'À vista' : `${d} dias` }))} />
          <FormField label="Observações" value={form.notes} onChange={v => setForm(p => ({ ...p, notes: v }))} placeholder="Opcional" />
          <Button full loading={busy} onClick={save} disabled={form.name.trim().length < 2}>Salvar</Button>
        </div>
      </Modal>
    </>
  )
}
