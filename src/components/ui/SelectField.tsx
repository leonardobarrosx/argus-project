import { useId } from 'react'

export function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold text-slate-500">{label}</label>
      <select id={id} value={value} onChange={e => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}
