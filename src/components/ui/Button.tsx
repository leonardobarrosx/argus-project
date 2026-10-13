import { Loader2 } from 'lucide-react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

const STYLES: Record<Variant, string> = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 shadow-sm shadow-brand-500/20',
  secondary: 'border border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:text-brand-600',
  danger: 'bg-rose-500 text-white hover:bg-rose-600',
  ghost: 'text-slate-500 hover:bg-slate-100',
}

export function Button({ children, onClick, disabled, loading, variant = 'primary', full, type = 'button', size = 'md', title }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean; loading?: boolean; variant?: Variant
  full?: boolean; type?: 'button' | 'submit'; size?: 'sm' | 'md'; title?: string
}) {
  const sz = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2.5 text-sm'
  return (
    <button type={type} onClick={onClick} disabled={disabled || loading} title={title}
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl font-semibold transition active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none ${sz} ${STYLES[variant]} ${full ? 'w-full' : ''}`}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
}
