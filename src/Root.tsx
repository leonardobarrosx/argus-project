import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import App from './App'
import { LoginPage } from './pages/LoginPage'
import { api, errorMessage, refreshSession, setSessionExpiredHandler } from './api'
import type { BootstrapDTO } from './api/types'

type State =
  | { kind: 'loading' }
  | { kind: 'anonymous'; notice?: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: BootstrapDTO }

/** Restores the session from the refresh cookie and loads tenant data. */
export default function Root() {
  const [state, setState] = useState<State>({ kind: 'loading' })

  const load = useCallback(async () => {
    try {
      setState({ kind: 'ready', data: await api.bootstrap() })
    } catch (err) {
      setState({ kind: 'error', message: errorMessage(err) })
    }
  }, [])

  useEffect(() => {
    setSessionExpiredHandler(() => setState({ kind: 'anonymous', notice: 'Sua sessão expirou. Entre novamente.' }))
    refreshSession().then(s => (s ? load() : setState({ kind: 'anonymous' })))
    return () => setSessionExpiredHandler(null)
  }, [load])

  const onSession = () => { setState({ kind: 'loading' }); load() }
  const onLogout = async () => {
    await api.logout().catch(() => undefined)
    setState({ kind: 'anonymous' })
  }

  if (state.kind === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f6f8fb]">
        <Loader2 className="h-6 w-6 animate-spin text-brand-500" aria-label="Carregando" />
      </div>
    )
  }
  if (state.kind === 'anonymous') return <LoginPage onSession={onSession} notice={state.notice} />
  if (state.kind === 'error') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#f6f8fb] px-4 text-center">
        <p className="text-sm font-medium text-slate-700">Não foi possível carregar os dados.</p>
        <p className="text-xs text-slate-400">{state.message}</p>
        <div className="flex gap-2">
          <button onClick={() => { setState({ kind: 'loading' }); load() }} className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white">Tentar novamente</button>
          <button onClick={onLogout} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600">Sair</button>
        </div>
      </div>
    )
  }
  return <App boot={state.data} onLogout={onLogout} onReload={load} />
}
