import { useState } from 'react'
import { Menu, X } from 'lucide-react'
import type { PageKey } from '../types'
import { BOTTOM_BAR_KEYS, type NavItem } from '../constants/navigation'
import { ArgusLogo } from './ArgusLogo'

export function MobileNav({ page, onChangePage, nav }: { page: PageKey; onChangePage: (p: PageKey) => void; nav: NavItem[] }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const bottomItems = nav.filter(n => BOTTOM_BAR_KEYS.includes(n.key))
  const isOnSecondary = !bottomItems.some(n => n.key === page)

  return (
    <>
      {/* Bottom bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/50 bg-white/95 backdrop-blur-md lg:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="flex items-center justify-around py-1.5 px-1">
          {bottomItems.map(item => {
            const Icon = item.icon
            const active = page === item.key
            return (
              <button key={item.key} onClick={() => { onChangePage(item.key); setDrawerOpen(false) }}
                className={`flex flex-1 flex-col items-center gap-0.5 py-1 text-[10px] font-semibold transition ${active ? 'text-brand-600' : 'text-slate-400'}`}>
                <div className={`flex h-8 w-8 items-center justify-center rounded-xl transition ${active ? 'bg-brand-50' : ''}`}>
                  <Icon className="h-5 w-5" strokeWidth={active ? 2 : 1.7} />
                </div>
                <span>{item.label}</span>
              </button>
            )
          })}
          {/* Menu/drawer button */}
          <button onClick={() => setDrawerOpen(true)}
            className={`flex flex-1 flex-col items-center gap-0.5 py-1 text-[10px] font-semibold transition ${isOnSecondary ? 'text-brand-600' : 'text-slate-400'}`}>
            <div className={`flex h-8 w-8 items-center justify-center rounded-xl transition ${isOnSecondary ? 'bg-brand-50' : ''}`}>
              <Menu className="h-5 w-5" strokeWidth={1.7} />
            </div>
            <span>Mais</span>
          </button>
        </div>
      </nav>

      {/* Drawer overlay */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" onClick={() => setDrawerOpen(false)}>
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-fadeIn" />

          {/* Drawer panel */}
          <div className="absolute bottom-0 left-0 right-0 animate-slideUp rounded-t-2xl bg-white shadow-xl"
            onClick={e => e.stopPropagation()}
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
            {/* Handle bar */}
            <div className="flex justify-center py-3">
              <div className="h-1 w-10 rounded-full bg-slate-200" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 pb-3">
              <div className="flex items-center gap-2.5">
                <ArgusLogo size={22} />
                <span className="text-sm font-bold text-slate-900">ARGUS</span>
              </div>
              <button onClick={() => setDrawerOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* All nav items */}
            <div className="grid grid-cols-4 gap-1 px-4 pb-5">
              {nav.map(item => {
                const Icon = item.icon
                const active = page === item.key
                return (
                  <button key={item.key} onClick={() => { onChangePage(item.key); setDrawerOpen(false) }}
                    className={`flex flex-col items-center gap-1 rounded-2xl py-3 transition ${active ? 'bg-brand-50 text-brand-600' : 'text-slate-500 active:bg-slate-50'}`}>
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl transition ${active ? 'bg-brand-100 text-brand-600' : 'bg-slate-100 text-slate-400'}`}>
                      <Icon className="h-5 w-5" strokeWidth={active ? 2.2 : 1.7} />
                    </div>
                    <span className="text-[11px] font-semibold">{item.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
