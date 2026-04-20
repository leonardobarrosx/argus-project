import type { RxData } from '../types'

export function RxDisplay({ label, rx }: { label: string; rx: RxData }) {
  const fields: { key: keyof RxData; name: string }[] = [
    { key: 'sph', name: 'Esf' }, { key: 'cyl', name: 'Cil' }, { key: 'axis', name: 'Eixo' },
    { key: 'add', name: 'Ad' }, { key: 'dnp', name: 'DNP' }, { key: 'height', name: 'Alt' },
  ]
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {fields.map(f => (
          <div key={f.key}>
            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-300">{f.name}</p>
            <div className="rounded-md bg-white px-2 py-1.5 text-sm font-medium text-slate-800">{rx[f.key] || '—'}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
