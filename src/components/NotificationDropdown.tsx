import { useRef } from 'react'
import type { Notification } from '../types'
import { useClickOutside } from '../hooks/useClickOutside'

export function NotificationDropdown({ notifications, open, onClose, onMarkRead, onMarkAllRead }: {
  notifications: Notification[]; open: boolean; onClose: () => void; onMarkRead: (id: string) => void; onMarkAllRead: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, onClose)
  if (!open) return null
  const unread = notifications.filter(n => !n.read).length
  const typeIcon: Record<string, string> = { stock: '📦', birthday: '🎂', prescription: '💊', order: '✅', info: 'ℹ️' }

  return (
    <div ref={ref} className="absolute right-0 top-full z-50 mt-2 w-[min(85vw,380px)] animate-fadeIn rounded-2xl bg-white shadow-dropdown sm:right-0 -right-2">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Notificações</h3>
          {unread > 0 && <span className="rounded-full bg-brand-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{unread}</span>}
        </div>
        {unread > 0 && <button onClick={onMarkAllRead} className="text-xs font-medium text-brand-500 hover:text-brand-700 transition">Marcar tudo como lido</button>}
      </div>
      <div className="max-h-[360px] overflow-y-auto py-1">
        {notifications.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">Nenhuma notificação</p>
        ) : notifications.map(n => (
          <button key={n.id} onClick={() => onMarkRead(n.id)}
            className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50 ${!n.read ? 'bg-brand-50/40' : ''}`}>
            <span className="mt-0.5 text-base">{typeIcon[n.type] || 'ℹ️'}</span>
            <div className="min-w-0 flex-1">
              <p className={`text-sm leading-snug ${!n.read ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>{n.title}</p>
              <p className="mt-0.5 text-xs text-slate-400">{n.sub}</p>
            </div>
            {!n.read && <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
          </button>
        ))}
      </div>
    </div>
  )
}
