import type { RxData } from '../types'

export function RxInputRow({ label, rx, onChange }: { label: string; rx: RxData; onChange: (r: RxData) => void }) {
  const fields: { key: keyof RxData; name: string; ph: string }[] = [
    { key: 'sph', name: 'Esf', ph: '-1.25' }, { key: 'cyl', name: 'Cil', ph: '-0.50' },
    { key: 'axis', name: 'Eixo', ph: '90' }, { key: 'add', name: 'Ad', ph: '+2.00' },
    { key: 'dnp', name: 'DNP', ph: '31.5' }, { key: 'height', name: 'Alt', ph: '18' },
  ]
  return (
    <div className="rounded-xl bg-slate-50/70 p-3">
      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {fields.map(f => (
          <div key={f.key}>
            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-300">{f.name}</p>
            <input value={rx[f.key]} onChange={e => onChange({ ...rx, [f.key]: e.target.value })} placeholder={f.ph}
              className="w-full rounded-lg border border-slate-200/80 bg-white px-2 py-1.5 text-sm text-slate-800 placeholder:text-slate-300 outline-none transition focus:border-brand-300 focus:ring-1 focus:ring-brand-100" />
          </div>
        ))}
      </div>
    </div>
  )
}
