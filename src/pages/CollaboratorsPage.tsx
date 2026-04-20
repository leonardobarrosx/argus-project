import { useState } from 'react'
import { UserPlus, Search, Phone, Mail, Edit2, Briefcase } from 'lucide-react'
import type { Collaborator } from '../types'
import { Card } from '../components/ui/Card'

const ROLE_LABELS: Record<Collaborator['role'], string> = {
  gerente: 'Gerente', optometrista: 'Optometrista', vendedor: 'Vendedor(a)', montador: 'Montador(a)', atendente: 'Atendente',
}
const ROLE_COLORS: Record<Collaborator['role'], string> = {
  gerente: 'bg-violet-100 text-violet-700', optometrista: 'bg-sky-100 text-sky-700', vendedor: 'bg-emerald-100 text-emerald-700',
  montador: 'bg-amber-100 text-amber-700', atendente: 'bg-rose-100 text-rose-700',
}

export function CollaboratorsPage({ collaborators, onNew, onEdit, onToggleActive }: {
  collaborators: Collaborator[]; onNew: () => void; onEdit: (c: Collaborator) => void; onToggleActive: (id: number) => void
}) {
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const roles = ['all', ...new Set(collaborators.map(c => c.role))]
  const filtered = collaborators.filter(c => {
    if (roleFilter !== 'all' && c.role !== roleFilter) return false
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })
  const activeCount = collaborators.filter(c => c.active).length

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Equipe</h1>
          <p className="mt-0.5 text-[13px] text-slate-400">{collaborators.length} colaborador(es) · {activeCount} ativo(s)</p>
        </div>
        <button onClick={onNew}
          className="flex items-center gap-1.5 rounded-xl bg-brand-500 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-brand-500/20 transition hover:bg-brand-600">
          <UserPlus className="h-3.5 w-3.5" /> Novo colaborador
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {roles.map(r => (
          <button key={r} onClick={() => setRoleFilter(r)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${roleFilter === r ? 'bg-brand-500 text-white shadow-sm shadow-brand-500/20' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
            {r === 'all' ? 'Todos' : ROLE_LABELS[r as Collaborator['role']] || r}
          </button>
        ))}
      </div>

      <Card>
        <div className="relative mb-3 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar colaborador…"
            className="h-9 w-full rounded-xl border border-slate-200/80 bg-slate-50/80 pl-10 pr-4 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100" />
        </div>
        <div className="max-h-[520px] space-y-1.5 overflow-y-auto pr-1">
          {filtered.length === 0 && <p className="py-8 text-center text-sm text-slate-400">Nenhum colaborador encontrado</p>}
          {filtered.map(c => (
            <div key={c.id} className={`flex items-center justify-between rounded-xl px-3 py-3 transition ${c.active ? 'hover:bg-slate-50' : 'bg-slate-50/40 opacity-60'}`}>
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 text-sm font-bold">
                  {c.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-slate-800">{c.name}</p>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${ROLE_COLORS[c.role]}`}>
                      {ROLE_LABELS[c.role]}
                    </span>
                    {!c.active && <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-400">Inativo</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    {c.phone && <span className="flex items-center gap-1 text-xs text-slate-400"><Phone className="h-3 w-3" />{c.phone}</span>}
                    {c.email && <span className="flex items-center gap-1 text-xs text-slate-400"><Mail className="h-3 w-3" />{c.email}</span>}
                    {c.commissionPct > 0 && <span className="text-xs text-emerald-500 font-medium">{c.commissionPct}% comissão</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => onEdit(c)} className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-400 transition hover:border-brand-300 hover:text-brand-600" title="Editar">
                  <Edit2 className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => onToggleActive(c.id)}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${c.active ? 'border-slate-200 bg-white text-slate-500 hover:border-rose-300 hover:text-rose-500' : 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`}>
                  {c.active ? 'Desativar' : 'Ativar'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        {(['vendedor', 'optometrista', 'gerente'] as const).map(role => {
          const count = collaborators.filter(c => c.role === role && c.active).length
          const avgComm = count > 0 ? (collaborators.filter(c => c.role === role && c.active).reduce((s, c) => s + c.commissionPct, 0) / count) : 0
          return (
            <Card key={role}>
              <div className="flex items-center gap-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${ROLE_COLORS[role]}`}>
                  <Briefcase className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">{ROLE_LABELS[role]}</p>
                  <p className="text-xs text-slate-400">{count} ativo(s) · Comissão média: {avgComm.toFixed(1)}%</p>
                </div>
              </div>
            </Card>
          )
        })}
      </div>
    </>
  )
}
