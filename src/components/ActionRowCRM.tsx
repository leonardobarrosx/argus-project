import { MessageCircle, CalendarDays } from 'lucide-react'

export function ActionRowCRM({ icon: Icon, title, sub, tone, onAction }: {
  icon: typeof CalendarDays; title: string; sub: string; tone: 'blue' | 'amber' | 'emerald'; onAction: () => void
}) {
  const colors = { blue: 'bg-brand-50 text-brand-600', amber: 'bg-amber-50 text-amber-600', emerald: 'bg-emerald-50 text-emerald-600' }
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50/70 px-3 py-3 transition hover:bg-slate-50">
      <div className="flex items-start gap-3">
        <div className={`shrink-0 rounded-lg p-2 ${colors[tone]}`}><Icon className="h-4 w-4" /></div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800">{title}</p>
          <p className="text-xs text-slate-400">{sub}</p>
        </div>
      </div>
      <button onClick={onAction} className="shrink-0 rounded-lg bg-white px-2.5 py-1.5 text-xs font-medium text-slate-500 shadow-card transition hover:text-brand-600 hover:shadow-elevated">
        <MessageCircle className="mr-1 inline h-3.5 w-3.5" /> Ação
      </button>
    </div>
  )
}
