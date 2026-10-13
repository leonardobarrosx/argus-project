import { useState } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { ArgusLogo } from '../components/ArgusLogo'
import { api, errorMessage } from '../api'
import type { SessionDTO } from '../api/types'

type Mode = 'login' | 'register'

export function LoginPage({ onSession, notice }: { onSession: (s: SessionDTO) => void; notice?: string }) {
  const [mode, setMode] = useState<Mode>('login')
  const [form, setForm] = useState({ storeName: '', name: '', email: '', password: '' })
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (mode === 'register' && form.password.length < 8) {
      setError('A senha precisa ter pelo menos 8 caracteres.')
      return
    }
    setLoading(true)
    try {
      const session = mode === 'login'
        ? await api.login(form.email.trim(), form.password)
        : await api.register({ storeName: form.storeName.trim(), name: form.name.trim(), email: form.email.trim(), password: form.password })
      onSession(session)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const input = 'w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100'

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f6f8fb] px-4 py-10">
      <div className="w-full max-w-sm animate-rise">
        <div className="mb-6 flex flex-col items-center text-center">
          <ArgusLogo size={44} />
          <h1 className="mt-3 text-xl font-bold tracking-tight text-slate-900">ARGUS</h1>
          <p className="text-[13px] text-slate-400">Gestão completa para óticas</p>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-card">
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
            {(['login', 'register'] as const).map(m => (
              <button key={m} type="button" onClick={() => { setMode(m); setError('') }}
                className={`rounded-lg py-2 text-xs font-semibold transition ${mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {m === 'login' ? 'Entrar' : 'Criar conta'}
              </button>
            ))}
          </div>

          {notice && mode === 'login' && (
            <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">{notice}</p>
          )}

          <form onSubmit={submit} className="space-y-3">
            {mode === 'register' && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500" htmlFor="storeName">Nome da ótica</label>
                  <input id="storeName" required minLength={2} value={form.storeName} onChange={set('storeName')} placeholder="Ex: Ótica Visão Clara" className={input} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500" htmlFor="name">Seu nome</label>
                  <input id="name" required minLength={2} value={form.name} onChange={set('name')} placeholder="Ex: Ana Souza" className={input} autoComplete="name" />
                </div>
              </>
            )}
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500" htmlFor="email">E-mail</label>
              <input id="email" type="email" required value={form.email} onChange={set('email')} placeholder="voce@otica.com.br" className={input} autoComplete="email" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500" htmlFor="password">Senha</label>
              <div className="relative">
                <input id="password" type={showPass ? 'text' : 'password'} required value={form.password} onChange={set('password')}
                  placeholder={mode === 'register' ? 'Mínimo 8 caracteres' : '••••••••'} className={`${input} pr-10`}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
                <button type="button" onClick={() => setShowPass(s => !s)} aria-label={showPass ? 'Ocultar senha' : 'Mostrar senha'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:text-slate-600">
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700" role="alert">{error}</p>}

            <button type="submit" disabled={loading}
              className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-60">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === 'login' ? 'Entrar' : 'Criar ótica e entrar'}
            </button>
          </form>
          {mode === 'register' && (
            <p className="mt-4 text-center text-[11px] text-slate-400">14 dias de teste grátis. Você poderá convidar sua equipe depois.</p>
          )}
        </div>
      </div>
    </div>
  )
}
