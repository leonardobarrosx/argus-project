import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react'

export type ToastKind = 'success' | 'error' | 'info'
export interface Toast { id: number; kind: ToastKind; message: string }

const STYLES: Record<ToastKind, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  error: 'border-rose-200 bg-rose-50 text-rose-800',
  info: 'border-brand-200 bg-brand-50 text-brand-800',
}
const ICONS = { success: CheckCircle2, error: AlertTriangle, info: Info }

export function Toasts({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[200] flex flex-col items-center gap-2 px-3 sm:items-end sm:pr-6" aria-live="polite">
      {toasts.map(t => {
        const Icon = ICONS[t.kind]
        return (
          <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex w-full max-w-sm animate-fadeIn items-start gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium shadow-dropdown ${STYLES[t.kind]}`}>
            <Icon className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="flex-1">{t.message}</p>
            <button onClick={() => onDismiss(t.id)} className="rounded p-0.5 opacity-60 transition hover:opacity-100" aria-label="Fechar">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
