import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowUp, BarChart3, Boxes, CalendarClock, Check, Copy, Database, Landmark, Loader2, MessagesSquare,
  PackageX, Plus, Printer, ShoppingBag, Sparkles, Square, Trash2,
} from 'lucide-react'
import type { Tenant } from '../types'
import type { ToastKind } from '../components/Toasts'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { Markdown } from '../lib/markdown'
import { printReport } from '../lib/print'
import { errorMessage } from '../api'
import { aiApi, type AIConversation, type AIMessage, type AISettings } from '../api/integrations'

const PROMPTS = [
  { icon: ShoppingBag, title: 'Sugestão de compra', prompt: 'O que devo comprar para os próximos 30 dias? Monte a lista por fornecedor, com quantidades, custo estimado e o que é mais urgente.' },
  { icon: Boxes, title: 'Movimentação de estoque', prompt: 'Analise as movimentações de estoque dos últimos 30 dias: entradas, saídas, ajustes e perdas. Aponte o que chama atenção.' },
  { icon: Landmark, title: 'Análise financeira', prompt: 'Faça uma análise financeira deste mês comparada com o mês anterior: faturamento, ticket médio, margem, contas a pagar e caixa.' },
  { icon: BarChart3, title: 'Vendas por vendedor', prompt: 'Monte um relatório das vendas deste mês por vendedor, com quantidade de vendas, faturamento e ticket médio.' },
  { icon: PackageX, title: 'Estoque parado', prompt: 'Quais produtos estão parados há mais de 90 dias e quanto dinheiro está empatado neles? O que você sugere fazer?' },
  { icon: CalendarClock, title: 'Receitas vencendo', prompt: 'Liste os pacientes com receita vencendo nos próximos 30 dias, para eu chamar para um novo exame.' },
]

const when = (iso: string) => {
  const d = new Date(iso)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

export function AssistantPage({ tenant, notify, onOpenSettings }: {
  tenant: Tenant
  notify: (kind: ToastKind, message: string) => void
  onOpenSettings: () => void
}) {
  const [settings, setSettings] = useState<AISettings | null>(null)
  const [loadError, setLoadError] = useState('')
  const [conversations, setConversations] = useState<AIConversation[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [messages, setMessages] = useState<AIMessage[]>([])
  const [loadingConv, setLoadingConv] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [showList, setShowList] = useState(false)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let alive = true
    Promise.all([aiApi.settings(), aiApi.conversations()])
      .then(([s, c]) => { if (alive) { setSettings(s.settings); setConversations(c.conversations) } })
      .catch(err => { if (alive) setLoadError(errorMessage(err)) })
    return () => { alive = false; abortRef.current?.abort() }
  }, [])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, status, error])

  const newConversation = useCallback(() => {
    if (sending) return
    setActiveId(null); setMessages([]); setError(''); setShowList(false)
    inputRef.current?.focus()
  }, [sending])

  const openConversation = async (id: number) => {
    if (sending || id === activeId) { setShowList(false); return }
    setLoadingConv(true); setError(''); setShowList(false)
    try {
      const out = await aiApi.conversation(id)
      setActiveId(id)
      setMessages(out.messages)
    } catch (err) {
      notify('error', errorMessage(err))
    } finally {
      setLoadingConv(false)
    }
  }

  const removeConversation = async () => {
    if (deleteId === null) return
    const id = deleteId
    setDeleteId(null)
    try {
      await aiApi.deleteConversation(id)
      setConversations(prev => prev.filter(c => c.id !== id))
      if (id === activeId) { setActiveId(null); setMessages([]) }
      notify('success', 'Conversa excluída')
    } catch (err) {
      notify('error', errorMessage(err))
    }
  }

  const send = async (raw: string) => {
    const text = raw.trim()
    if (!text || sending) return
    setInput('')
    setError('')
    setSending(true)
    setStatus('Pensando')
    setMessages(prev => [...prev, {
      id: -Date.now(), role: 'user', content: text, tools: null, model: '', inputTokens: 0, outputTokens: 0, createdAt: new Date().toISOString(),
    }])
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      await aiApi.chat(text, activeId, ev => {
        switch (ev.type) {
          case 'conversation':
            setActiveId(ev.conversation.id)
            setConversations(prev => [ev.conversation, ...prev.filter(c => c.id !== ev.conversation.id)])
            break
          case 'status':
            setStatus(ev.label)
            break
          case 'message':
            setMessages(prev => [...prev, ev.message])
            break
          case 'error':
            setError(ev.error.charAt(0).toUpperCase() + ev.error.slice(1))
            break
        }
      }, ctrl.signal)
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) setError(errorMessage(err))
    } finally {
      setSending(false)
      setStatus('')
      abortRef.current = null
    }
  }

  const stop = () => {
    abortRef.current?.abort()
    setError('Resposta interrompida.')
  }

  if (loadError) {
    return <Card><p className="text-sm text-rose-600">{loadError}</p></Card>
  }
  if (!settings) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-brand-500" /></div>
  }

  const list = (
    <div className="flex h-full flex-col">
      <Button full onClick={newConversation} disabled={sending}><Plus className="h-4 w-4" /> Nova conversa</Button>
      <p className="mb-1 mt-4 px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Conversas</p>
      {conversations.length === 0 && <p className="px-1 text-[13px] text-slate-400">Suas conversas aparecem aqui.</p>}
      <ul className="-mx-1 flex-1 space-y-0.5 overflow-y-auto">
        {conversations.map(c => (
          <li key={c.id} className="group relative">
            <button onClick={() => openConversation(c.id)} disabled={sending}
              className={`w-full rounded-xl px-3 py-2 pr-9 text-left transition disabled:opacity-60 ${c.id === activeId ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50'}`}>
              <span className="block truncate text-[13px] font-medium">{c.title}</span>
              <span className="text-[11px] text-slate-400">{when(c.updatedAt)}</span>
            </button>
            <button onClick={() => setDeleteId(c.id)} aria-label={`Excluir conversa ${c.title}`} disabled={sending}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-300 opacity-100 transition hover:bg-rose-50 hover:text-rose-500 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )

  const lastQuestion = (idx: number) => {
    for (let i = idx - 1; i >= 0; i--) if (messages[i].role === 'user') return messages[i].content
    return 'Relatório'
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900 sm:text-2xl">Assistente IA</h1>
          <p className="mt-0.5 text-[13px] text-slate-400">Pergunte sobre vendas, estoque, compras e financeiro. Ele consulta os dados da ótica para responder.</p>
        </div>
        <div className="flex gap-2 lg:hidden">
          <Button variant="secondary" size="sm" onClick={() => setShowList(v => !v)}><MessagesSquare className="h-4 w-4" /> Conversas</Button>
          <Button variant="secondary" size="sm" onClick={newConversation} disabled={sending}><Plus className="h-4 w-4" /> Nova</Button>
        </div>
      </div>

      {!settings.ready && (
        <Card className="flex flex-col items-start gap-3 border border-amber-100 sm:flex-row sm:items-center">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
          <div className="flex-1 text-sm text-slate-600">
            {settings.enabled
              ? 'Para usar o assistente, cadastre uma chave da Anthropic nas configurações de IA.'
              : 'O assistente está desativado para esta ótica.'}
          </div>
          <Button size="sm" onClick={onOpenSettings}>Configurar IA</Button>
        </Card>
      )}

      {showList && <Card className="lg:hidden">{list}</Card>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="hidden h-[calc(100vh-12rem)] min-h-[520px] lg:block">{list}</Card>

        <Card className="flex h-[calc(100vh-12rem)] min-h-[520px] min-w-0 flex-col !p-0">
          <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            {loadingConv && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-brand-500" /></div>}

            {!loadingConv && messages.length === 0 && (
              <div className="mx-auto max-w-2xl py-4 sm:py-8">
                <div className="mb-5 flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-50 text-brand-500"><Sparkles className="h-5 w-5" /></span>
                  <div>
                    <p className="font-semibold text-slate-900">Como posso ajudar a {tenant.name}?</p>
                    <p className="text-[13px] text-slate-400">Escolha um ponto de partida ou escreva sua pergunta.</p>
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {PROMPTS.map(p => {
                    const Icon = p.icon
                    return (
                      <button key={p.title} onClick={() => send(p.prompt)} disabled={!settings.ready || sending}
                        className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-left transition hover:border-brand-200 hover:bg-brand-50/40 disabled:pointer-events-none disabled:opacity-50">
                        <span className="flex items-center gap-2 text-[13px] font-semibold text-slate-800"><Icon className="h-4 w-4 text-brand-500" /> {p.title}</span>
                        <span className="mt-1 line-clamp-2 block text-xs text-slate-500">{p.prompt}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="mx-auto max-w-3xl space-y-5">
              {!loadingConv && messages.map((m, idx) => m.role === 'user'
                ? (
                  <div key={m.id} className="flex justify-end">
                    <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand-500 px-4 py-2.5 text-sm text-white">{m.content}</p>
                  </div>
                )
                : <AssistantMessage key={m.id} message={m} onPrint={html => printReport(tenant, lastQuestion(idx), html)} />)}

              {sending && (
                <div className="flex items-center gap-2.5 text-sm text-slate-500" aria-live="polite">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-50 text-brand-500"><Loader2 className="h-4 w-4 animate-spin" /></span>
                  {status}…
                </div>
              )}
              {error && (
                <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{error}</span>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          <form className="border-t border-slate-100 p-3 sm:p-4" onSubmit={e => { e.preventDefault(); void send(input) }}>
            <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50/80 p-2 transition focus-within:border-brand-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-100">
              <label htmlFor="ai-input" className="sr-only">Pergunta para o assistente</label>
              <textarea id="ai-input" ref={inputRef} value={input} onChange={e => setInput(e.target.value)} maxLength={4000}
                rows={Math.min(6, Math.max(1, input.split('\n').length))} disabled={!settings.ready}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input) } }}
                placeholder={settings.ready ? 'Ex.: quais armações mais venderam este trimestre?' : 'Configure a IA para começar'}
                className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-slate-800 outline-none placeholder:text-slate-400" />
              {sending
                ? <button type="button" onClick={stop} aria-label="Parar resposta"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-white transition hover:bg-slate-700"><Square className="h-3.5 w-3.5" /></button>
                : <button type="submit" aria-label="Enviar" disabled={!input.trim() || !settings.ready}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-white transition hover:bg-brand-600 disabled:opacity-40"><ArrowUp className="h-4 w-4" /></button>}
            </div>
            <p className="mx-auto mt-1.5 max-w-3xl px-1 text-[11px] text-slate-400">O assistente só lê os dados, nunca altera nada. Confira números importantes antes de decidir.</p>
          </form>
        </Card>
      </div>

      <Modal open={deleteId !== null} onClose={() => setDeleteId(null)} title="Excluir conversa">
        <p className="text-sm text-slate-600">A conversa e as respostas dela serão apagadas. Isso não pode ser desfeito.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDeleteId(null)}>Cancelar</Button>
          <Button variant="danger" onClick={removeConversation}>Excluir</Button>
        </div>
      </Modal>
    </>
  )
}

function AssistantMessage({ message, onPrint }: { message: AIMessage; onPrint: (html: string) => void }) {
  const [copied, setCopied] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const tools = message.tools ?? []
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard blocked */ }
  }
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-500"><Sparkles className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        {tools.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {tools.map((t, i) => (
              <span key={i} title={t.error ? `Falhou: ${t.error}` : undefined}
                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${t.error ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-500'}`}>
                <Database className="h-3 w-3" /> {t.label}
              </span>
            ))}
          </div>
        )}
        <div ref={bodyRef}><Markdown text={message.content} /></div>
        <div className="mt-2 flex items-center gap-1 text-slate-400">
          <button onClick={copy} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition hover:bg-slate-100 hover:text-slate-600">
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Copiado' : 'Copiar'}
          </button>
          <button onClick={() => bodyRef.current && onPrint(bodyRef.current.innerHTML)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition hover:bg-slate-100 hover:text-slate-600">
            <Printer className="h-3.5 w-3.5" /> Imprimir
          </button>
        </div>
      </div>
    </div>
  )
}
