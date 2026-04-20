export function SectionTitle({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-2">
      <div>
        <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
        {sub && <p className="mt-0.5 text-[13px] text-slate-400">{sub}</p>}
      </div>
      {action}
    </div>
  )
}
