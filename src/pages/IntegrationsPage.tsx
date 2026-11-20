import { useCallback, useEffect, useId, useState } from 'react'
import {
  BookOpen, Check, ChevronDown, Copy, Eye, KeyRound, Loader2, Plus, RefreshCw, Send, Sparkles, Trash2, Webhook,
} from 'lucide-react'
import type { ToastKind } from '../components/Toasts'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { FormField } from '../components/ui/FormField'
import { SectionTitle } from '../components/ui/SectionTitle'
import { SelectField } from '../components/ui/SelectField'
import { errorMessage } from '../api'
import {
  aiApi, integrationsApi, type AIEffort, type AISettings, type AIUsage, type ApiKeyDTO, type DeliveryDTO, type EventInfo,
  type ScopeInfo, type WebhookDTO,
} from '../api/integrations'

export type IntegrationsTab = 'keys' | 'webhooks' | 'ai' | 'docs'
type Notify = (kind: ToastKind, message: string) => void

const TABS: { key: IntegrationsTab; label: string; icon: typeof KeyRound }[] = [
  { key: 'keys', label: 'Chaves de API', icon: KeyRound },
  { key: 'webhooks', label: 'Webhooks', icon: Webhook },
  { key: 'ai', label: 'Inteligência artificial', icon: Sparkles },
  { key: 'docs', label: 'Documentação', icon: BookOpen },
]

const dateTime = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
  : '—'
const num = (n: number) => n.toLocaleString('pt-BR')

export function IntegrationsPage({ tab, onTabChange, notify }: { tab: IntegrationsTab; onTabChange: (t: IntegrationsTab) => void; notify: Notify }) {
  return (
    <>
      <div>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Integrações</h1>
        <p className="mt-0.5 text-[13px] text-slate-400">Conecte o Argus a outros sistemas e configure o assistente de IA.</p>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist">
        {TABS.map(t => {
          const Icon = t.icon
          return (
            <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => onTabChange(t.key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${tab === t.key ? 'bg-brand-500 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
              <Icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          )
        })}
      </div>
      {tab === 'keys' && <ApiKeysTab notify={notify} />}
      {tab === 'webhooks' && <WebhooksTab notify={notify} />}
      {tab === 'ai' && <AITab notify={notify} />}
      {tab === 'docs' && <DocsTab />}
    </>
  )
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* blocked */ }
  }
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-slate-500">{label}</p>
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-3 pr-1.5">
        <code className="min-w-0 flex-1 break-all font-mono text-[13px] text-slate-800">{value}</code>
        <Button size="sm" variant="secondary" onClick={copy}>{copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Copiado' : 'Copiar'}</Button>
      </div>
    </div>
  )
}

function Checks<T extends string>({ label, options, value, onChange }: {
  label: string; options: { value: T; label: string; description: string }[]; value: T[]; onChange: (v: T[]) => void
}) {
  const toggle = (v: T) => onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v])
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-semibold text-slate-500">{label}</legend>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {options.map(o => (
          <label key={o.value} className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2 transition ${value.includes(o.value) ? 'border-brand-200 bg-brand-50/50' : 'border-slate-100 hover:border-slate-200'}`}>
            <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} className="mt-0.5 h-4 w-4 accent-brand-500" />
            <span>
              <span className="block text-[13px] font-medium text-slate-800">{o.label}</span>
              <span className="block text-[11px] text-slate-400">{o.description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-3">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-brand-500' : 'bg-slate-200'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
      <span className="text-sm text-slate-700">{label}</span>
    </label>
  )
}

function Confirm({ open, title, children, action, danger, busy, onConfirm, onClose }: {
  open: boolean; title: string; children: React.ReactNode; action: string; danger?: boolean; busy?: boolean
  onConfirm: () => void; onClose: () => void
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="text-sm text-slate-600">{children}</div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={onConfirm}>{action}</Button>
      </div>
    </Modal>
  )
}

function Loading() {
  return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-brand-500" /></div>
}

// ─── API keys ────────────────────────────────────────────────────────────────

function keyState(k: ApiKeyDTO): { label: string; color: string } {
  if (k.revokedAt) return { label: 'Revogada', color: 'slate' }
  if (k.expiresAt && new Date(k.expiresAt) < new Date()) return { label: 'Expirada', color: 'amber' }
  return { label: 'Ativa', color: 'emerald' }
}

function ApiKeysTab({ notify }: { notify: Notify }) {
  const [keys, setKeys] = useState<ApiKeyDTO[] | null>(null)
  const [scopes, setScopes] = useState<ScopeInfo[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [expires, setExpires] = useState('0')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<{ key: string; name: string } | null>(null)
  const [revoke, setRevoke] = useState<ApiKeyDTO | null>(null)

  const load = useCallback(async () => {
    try {
      const [k, s] = await Promise.all([integrationsApi.apiKeys(), integrationsApi.scopes()])
      setKeys(k.apiKeys); setScopes(s.scopes)
    } catch (err) { notify('error', errorMessage(err)); setKeys([]) }
  }, [notify])
  useEffect(() => { void load() }, [load])

  const create = async () => {
    if (name.trim().length < 2 || picked.length === 0) return
    setBusy(true)
    try {
      const out = await integrationsApi.createApiKey(name.trim(), picked, Number(expires))
      setKeys(prev => [out.apiKey, ...(prev ?? [])])
      setFormOpen(false)
      setCreated({ key: out.key, name: out.apiKey.name })
    } catch (err) { notify('error', errorMessage(err)) } finally { setBusy(false) }
  }

  const doRevoke = async () => {
    if (!revoke) return
    setBusy(true)
    try {
      const out = await integrationsApi.revokeApiKey(revoke.id)
      setKeys(prev => prev?.map(k => k.id === out.apiKey.id ? out.apiKey : k) ?? null)
      notify('success', 'Chave revogada')
      setRevoke(null)
    } catch (err) { notify('error', errorMessage(err)) } finally { setBusy(false) }
  }

  const scopeLabel = (s: string) => scopes.find(x => x.scope === s)?.label ?? s

  return (
    <Card>
      <SectionTitle title="Chaves de API" sub="Use uma chave para que outro sistema leia ou cadastre dados pela API v1."
        action={<div className="shrink-0"><Button size="sm" onClick={() => { setName(''); setPicked([]); setExpires('0'); setFormOpen(true) }}><Plus className="h-4 w-4" /> Nova chave</Button></div>} />
      {keys === null ? <Loading /> : keys.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center">
          <KeyRound className="mx-auto h-6 w-6 text-slate-300" />
          <p className="mt-2 text-sm font-medium text-slate-700">Nenhuma chave criada</p>
          <p className="text-[13px] text-slate-400">Crie uma chave para conectar um e-commerce, BI ou planilha ao Argus.</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {keys.map(k => {
            const st = keyState(k)
            return (
              <div key={k.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-slate-800">{k.name}</p>
                    <Badge color={st.color}>{st.label}</Badge>
                    <code className="font-mono text-xs text-slate-400">{k.prefix}…</code>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {k.scopes.map(s => <span key={s} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">{scopeLabel(s)}</span>)}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Criada por {k.createdByName || '—'} em {dateTime(k.createdAt)} · Último uso: {dateTime(k.lastUsedAt)}
                    {k.expiresAt && ` · Expira em ${dateTime(k.expiresAt)}`}
                  </p>
                </div>
                {!k.revokedAt && <Button size="sm" variant="secondary" onClick={() => setRevoke(k)}>Revogar</Button>}
              </div>
            )
          })}
        </div>
      )}

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title="Nova chave de API" wide>
        <div className="space-y-4">
          <FormField label="Nome" value={name} onChange={setName} placeholder="Ex.: Loja virtual, Power BI" />
          <Checks label="Permissões" value={picked} onChange={setPicked}
            options={scopes.map(s => ({ value: s.scope, label: s.label, description: s.description }))} />
          <SelectField label="Validade" value={expires} onChange={setExpires} options={[
            { value: '0', label: 'Sem expiração' }, { value: '30', label: '30 dias' }, { value: '90', label: '90 dias' }, { value: '365', label: '1 ano' },
          ]} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setFormOpen(false)}>Cancelar</Button>
            <Button onClick={create} loading={busy} disabled={name.trim().length < 2 || picked.length === 0}>Criar chave</Button>
          </div>
        </div>
      </Modal>

      <Modal open={created !== null} onClose={() => setCreated(null)} title="Chave criada">
        {created && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">Copie a chave <strong>{created.name}</strong> agora. Por segurança, ela não será mostrada de novo.</p>
            <CopyField label="Chave de API" value={created.key} />
            <div className="flex justify-end"><Button onClick={() => setCreated(null)}>Já copiei</Button></div>
          </div>
        )}
      </Modal>

      <Confirm open={revoke !== null} title="Revogar chave" action="Revogar" danger busy={busy} onConfirm={doRevoke} onClose={() => setRevoke(null)}>
        Os sistemas que usam <strong>{revoke?.name}</strong> perdem o acesso na hora. Isso não pode ser desfeito.
      </Confirm>
    </Card>
  )
}

// ─── Webhooks ────────────────────────────────────────────────────────────────

const DELIVERY_STATUS: Record<string, { label: string; color: string }> = {
  delivered: { label: 'Entregue', color: 'emerald' },
  failed: { label: 'Falhou', color: 'rose' },
  pending: { label: 'Pendente', color: 'amber' },
}

function WebhooksTab({ notify }: { notify: Notify }) {
  const [hooks, setHooks] = useState<WebhookDTO[] | null>(null)
  const [events, setEvents] = useState<EventInfo[]>([])
  const [editing, setEditing] = useState<WebhookDTO | 'new' | null>(null)
  const [form, setForm] = useState({ url: '', description: '', events: [] as string[], active: true })
  const [busy, setBusy] = useState(false)
  const [secret, setSecret] = useState<{ hook: WebhookDTO; value: string | null; fresh: boolean } | null>(null)
  const [remove, setRemove] = useState<WebhookDTO | null>(null)
  const [rotate, setRotate] = useState<WebhookDTO | null>(null)
  const [log, setLog] = useState<WebhookDTO | null>(null)
  const [testing, setTesting] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const [w, e] = await Promise.all([integrationsApi.webhooks(), integrationsApi.events()])
      setHooks(w.webhooks); setEvents(e.events)
    } catch (err) { notify('error', errorMessage(err)); setHooks([]) }
  }, [notify])
  useEffect(() => { void load() }, [load])

  const openForm = (w: WebhookDTO | 'new') => {
    setForm(w === 'new' ? { url: '', description: '', events: [], active: true } : { url: w.url, description: w.description, events: w.events, active: w.active })
    setEditing(w)
  }

  const save = async () => {
    if (!form.url.trim() || form.events.length === 0 || editing === null) return
    setBusy(true)
    try {
      const input = { ...form, url: form.url.trim(), description: form.description.trim() }
      if (editing === 'new') {
        const out = await integrationsApi.createWebhook(input)
        setSecret({ hook: out.webhook, value: out.secret, fresh: true })
      } else {
        await integrationsApi.updateWebhook(editing.id, input)
        notify('success', 'Webhook atualizado')
      }
      setEditing(null)
      await load()
    } catch (err) { notify('error', errorMessage(err)) } finally { setBusy(false) }
  }

  const test = async (w: WebhookDTO) => {
    setTesting(w.id)
    try {
      const { delivery } = await integrationsApi.testWebhook(w.id)
      if (delivery.status === 'delivered') notify('success', `Teste entregue (HTTP ${delivery.responseStatus}, ${delivery.durationMs ?? 0} ms)`)
      else notify('error', `Teste falhou: ${delivery.error || `HTTP ${delivery.responseStatus ?? '—'}`}`)
      await load()
    } catch (err) { notify('error', errorMessage(err)) } finally { setTesting(null) }
  }

  const revealSecret = async (w: WebhookDTO) => {
    setSecret({ hook: w, value: null, fresh: false })
    try {
      const out = await integrationsApi.webhookSecret(w.id)
      setSecret({ hook: w, value: out.secret, fresh: false })
    } catch (err) { notify('error', errorMessage(err)); setSecret(null) }
  }

  const doRotate = async () => {
    if (!rotate) return
    setBusy(true)
    try {
      const out = await integrationsApi.rotateWebhookSecret(rotate.id)
      setSecret({ hook: rotate, value: out.secret, fresh: true })
      setRotate(null)
    } catch (err) { notify('error', errorMessage(err)) } finally { setBusy(false) }
  }

  const doRemove = async () => {
    if (!remove) return
    setBusy(true)
    try {
      await integrationsApi.deleteWebhook(remove.id)
      setHooks(prev => prev?.filter(h => h.id !== remove.id) ?? null)
      notify('success', 'Webhook excluído')
      setRemove(null)
    } catch (err) { notify('error', errorMessage(err)) } finally { setBusy(false) }
  }

  const eventLabel = (t: string) => events.find(e => e.type === t)?.label ?? t

  return (
    <Card>
      <SectionTitle title="Webhooks" sub="O Argus avisa outro sistema na hora em que algo acontece: venda, OS, estoque baixo, contas."
        action={<div className="shrink-0"><Button size="sm" onClick={() => openForm('new')}><Plus className="h-4 w-4" /> Novo webhook</Button></div>} />
      {hooks === null ? <Loading /> : hooks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center">
          <Webhook className="mx-auto h-6 w-6 text-slate-300" />
          <p className="mt-2 text-sm font-medium text-slate-700">Nenhum webhook cadastrado</p>
          <p className="text-[13px] text-slate-400">Cadastre a URL do outro sistema e escolha os eventos que ele deve receber.</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {hooks.map(w => {
            const last = DELIVERY_STATUS[w.lastStatus]
            return (
              <div key={w.id} className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="break-all font-mono text-[13px] font-medium text-slate-800">{w.url}</code>
                    {!w.active && <Badge color="slate">Pausado</Badge>}
                    {w.failed24h > 0 && <Badge color="rose">{w.failed24h} falha{w.failed24h > 1 ? 's' : ''} em 24h</Badge>}
                    {w.pending > 0 && <Badge color="amber">{w.pending} na fila</Badge>}
                  </div>
                  {w.description && <p className="mt-0.5 text-[13px] text-slate-500">{w.description}</p>}
                  <p className="mt-1 text-[11px] text-slate-400">
                    {w.events.map(eventLabel).join(' · ')}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    Última entrega: {last ? <span className={last.color === 'rose' ? 'text-rose-500' : last.color === 'emerald' ? 'text-emerald-600' : 'text-amber-600'}>{last.label}</span> : 'nenhuma'}{w.lastAt && ` em ${dateTime(w.lastAt)}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="secondary" loading={testing === w.id} onClick={() => test(w)}><Send className="h-3.5 w-3.5" /> Testar</Button>
                  <Button size="sm" variant="secondary" onClick={() => setLog(w)}>Entregas</Button>
                  <Button size="sm" variant="secondary" onClick={() => revealSecret(w)}><Eye className="h-3.5 w-3.5" /> Segredo</Button>
                  <Button size="sm" variant="secondary" onClick={() => openForm(w)}>Editar</Button>
                  <Button size="sm" variant="ghost" title="Excluir" onClick={() => setRemove(w)}><Trash2 className="h-3.5 w-3.5" /><span className="sr-only">Excluir</span></Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Novo webhook' : 'Editar webhook'} wide>
        <div className="space-y-4">
          <FormField label="URL de destino" value={form.url} onChange={url => setForm(f => ({ ...f, url }))} placeholder="https://seu-sistema.com.br/webhooks/argus" />
          <FormField label="Descrição (opcional)" value={form.description} onChange={description => setForm(f => ({ ...f, description }))} placeholder="Ex.: Integração com o ERP" />
          <Checks label="Eventos" value={form.events} onChange={evs => setForm(f => ({ ...f, events: evs }))}
            options={events.map(e => ({ value: e.type, label: e.label, description: e.description }))} />
          <Toggle checked={form.active} onChange={active => setForm(f => ({ ...f, active }))} label="Ativo (enviar eventos)" />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={save} loading={busy} disabled={!form.url.trim() || form.events.length === 0}>{editing === 'new' ? 'Criar webhook' : 'Salvar'}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={secret !== null} onClose={() => setSecret(null)} title={secret?.fresh ? 'Segredo do webhook' : 'Segredo de assinatura'}>
        {secret && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              {secret.fresh ? 'Guarde este segredo no sistema que recebe os eventos. ' : ''}
              Cada envio leva o cabeçalho <code className="font-mono text-xs">X-Argus-Signature</code>, assinado com ele. Veja como conferir na aba Documentação.
            </p>
            {secret.value ? <CopyField label="Segredo" value={secret.value} /> : <Loading />}
            <div className="flex justify-between gap-2">
              <Button variant="secondary" onClick={() => { const h = secret.hook; setSecret(null); setRotate(h) }}><RefreshCw className="h-3.5 w-3.5" /> Gerar novo</Button>
              <Button onClick={() => setSecret(null)}>Fechar</Button>
            </div>
          </div>
        )}
      </Modal>

      <Confirm open={rotate !== null} title="Gerar novo segredo" action="Gerar novo" busy={busy} onConfirm={doRotate} onClose={() => setRotate(null)}>
        O segredo atual deixa de valer na hora. Atualize o sistema que recebe os eventos logo em seguida.
      </Confirm>
      <Confirm open={remove !== null} title="Excluir webhook" action="Excluir" danger busy={busy} onConfirm={doRemove} onClose={() => setRemove(null)}>
        <strong className="break-all">{remove?.url}</strong> deixa de receber eventos, e o histórico de entregas é apagado.
      </Confirm>

      {log && <DeliveriesModal hook={log} eventLabel={eventLabel} notify={notify} onClose={() => { setLog(null); void load() }} />}
    </Card>
  )
}

function DeliveriesModal({ hook, eventLabel, notify, onClose }: { hook: WebhookDTO; eventLabel: (t: string) => string; notify: Notify; onClose: () => void }) {
  const [items, setItems] = useState<DeliveryDTO[] | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [retrying, setRetrying] = useState<number | null>(null)

  const load = useCallback(async () => {
    try { setItems((await integrationsApi.deliveries(hook.id)).deliveries) } catch (err) { notify('error', errorMessage(err)); setItems([]) }
  }, [hook.id, notify])
  useEffect(() => { void load() }, [load])

  const retry = async (d: DeliveryDTO) => {
    setRetrying(d.id)
    try {
      const out = await integrationsApi.retryDelivery(d.id)
      setItems(prev => prev?.map(x => x.id === d.id ? out.delivery : x) ?? null)
      notify(out.delivery.status === 'delivered' ? 'success' : 'error', out.delivery.status === 'delivered' ? 'Entrega reenviada' : 'O reenvio falhou de novo')
    } catch (err) { notify('error', errorMessage(err)) } finally { setRetrying(null) }
  }

  return (
    <Modal open onClose={onClose} title="Entregas recentes" wide>
      <p className="mb-3 break-all font-mono text-xs text-slate-400">{hook.url}</p>
      {items === null ? <Loading /> : items.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-400">Nenhuma entrega ainda. Use “Testar” para enviar um ping.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map(d => {
            const st = DELIVERY_STATUS[d.status]
            const expanded = open === d.id
            return (
              <li key={d.id} className="py-2">
                <button className="flex w-full items-center gap-2 text-left" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : d.id)}>
                  <Badge color={st.color}>{st.label}</Badge>
                  <span className="flex-1 truncate text-[13px] font-medium text-slate-700">{d.event === 'ping' ? 'Teste (ping)' : eventLabel(d.event)}</span>
                  <span className="hidden text-[11px] text-slate-400 sm:inline">{d.responseStatus ? `HTTP ${d.responseStatus}` : ''}{d.durationMs != null ? ` · ${d.durationMs} ms` : ''}</span>
                  <span className="text-[11px] text-slate-400">{dateTime(d.createdAt)}</span>
                  <ChevronDown className={`h-4 w-4 text-slate-300 transition ${expanded ? 'rotate-180' : ''}`} />
                </button>
                {expanded && (
                  <div className="mt-2 space-y-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                    <p>Tentativas: {d.attempts}{d.status === 'pending' && ` · próxima em ${dateTime(d.nextAttemptAt)}`}{d.deliveredAt && ` · entregue em ${dateTime(d.deliveredAt)}`}</p>
                    {d.error && <p className="text-rose-600">Erro: {d.error}</p>}
                    <p className="font-semibold text-slate-500">Conteúdo enviado</p>
                    <pre className="max-h-48 overflow-auto rounded-lg bg-white p-2 font-mono text-[11px]">{JSON.stringify(d.payload, null, 2)}</pre>
                    {d.responseBody && <>
                      <p className="font-semibold text-slate-500">Resposta</p>
                      <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-2 font-mono text-[11px]">{d.responseBody}</pre>
                    </>}
                    {d.status === 'failed' && <Button size="sm" variant="secondary" loading={retrying === d.id} onClick={() => retry(d)}><RefreshCw className="h-3.5 w-3.5" /> Reenviar</Button>}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Modal>
  )
}

// ─── AI settings ─────────────────────────────────────────────────────────────

const EFFORTS: { value: AIEffort; label: string; hint: string }[] = [
  { value: 'low', label: 'Rápido', hint: 'Respostas curtas, menor custo' },
  { value: 'medium', label: 'Equilibrado', hint: 'Bom para o dia a dia' },
  { value: 'high', label: 'Profundo', hint: 'Análises mais completas, mais lento' },
]

function AITab({ notify }: { notify: Notify }) {
  const [settings, setSettings] = useState<AISettings | null>(null)
  const [usage, setUsage] = useState<AIUsage | null>(null)
  const [form, setForm] = useState({ enabled: true, model: '', effort: 'medium' as AIEffort, instructions: '', apiKey: '' })
  const [busy, setBusy] = useState(false)
  const [clearKey, setClearKey] = useState(false)
  const instructionsId = useId()
  const keyId = useId()

  useEffect(() => {
    Promise.all([aiApi.settings(), aiApi.usage()])
      .then(([s, u]) => {
        setSettings(s.settings); setUsage(u.usage)
        setForm({ enabled: s.settings.enabled, model: s.settings.model, effort: s.settings.effort, instructions: s.settings.instructions, apiKey: '' })
      })
      .catch(err => notify('error', errorMessage(err)))
  }, [notify])

  const save = async (opts: { clearApiKey?: boolean } = {}) => {
    setBusy(true)
    try {
      const out = await aiApi.updateSettings({
        enabled: form.enabled, model: form.model, effort: form.effort, instructions: form.instructions,
        ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}), ...(opts.clearApiKey ? { clearApiKey: true } : {}),
      })
      setSettings(out.settings)
      setForm(f => ({ ...f, apiKey: '' }))
      notify('success', opts.clearApiKey ? 'Chave removida' : 'Configurações salvas')
      setClearKey(false)
    } catch (err) { notify('error', errorMessage(err)) } finally { setBusy(false) }
  }

  if (!settings) return <Card><Loading /></Card>

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        <SectionTitle title="Assistente de IA" sub="O assistente usa o Claude, da Anthropic, para responder sobre os dados da ótica. Ele só lê, nunca altera."
          action={<Badge color={settings.ready ? 'emerald' : 'amber'}>{settings.ready ? 'Pronto' : settings.enabled ? 'Falta a chave' : 'Desativado'}</Badge>} />
        <div className="space-y-5">
          <Toggle checked={form.enabled} onChange={enabled => setForm(f => ({ ...f, enabled }))} label="Ativar o assistente para gerentes e proprietários" />

          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-slate-500">Modelo</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {settings.models.map(m => (
                <label key={m.id} className={`cursor-pointer rounded-xl border px-3 py-2.5 transition ${form.model === m.id ? 'border-brand-300 bg-brand-50/60' : 'border-slate-100 hover:border-slate-200'}`}>
                  <input type="radio" name="ai-model" value={m.id} checked={form.model === m.id} onChange={() => setForm(f => ({ ...f, model: m.id }))} className="sr-only" />
                  <span className="block text-[13px] font-semibold text-slate-800">{m.label}</span>
                  <span className="block text-[11px] text-slate-400">{m.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-1.5 text-xs font-semibold text-slate-500">Nível de análise</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {EFFORTS.map(e => (
                <label key={e.value} className={`cursor-pointer rounded-xl border px-3 py-2.5 transition ${form.effort === e.value ? 'border-brand-300 bg-brand-50/60' : 'border-slate-100 hover:border-slate-200'}`}>
                  <input type="radio" name="ai-effort" value={e.value} checked={form.effort === e.value} onChange={() => setForm(f => ({ ...f, effort: e.value }))} className="sr-only" />
                  <span className="block text-[13px] font-semibold text-slate-800">{e.label}</span>
                  <span className="block text-[11px] text-slate-400">{e.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor={instructionsId} className="mb-1 block text-xs font-semibold text-slate-500">Instruções para o assistente (opcional)</label>
            <textarea id={instructionsId} value={form.instructions} maxLength={2000} rows={3}
              onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))}
              placeholder="Ex.: Nossa meta mensal é R$ 80.000. Trabalhamos com margem mínima de 40% em armações."
              className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100" />
            <p className="mt-1 text-right text-[11px] text-slate-400">{form.instructions.length}/2000</p>
          </div>

          <div>
            <label htmlFor={keyId} className="mb-1 block text-xs font-semibold text-slate-500">Chave da Anthropic</label>
            <input id={keyId} type="password" autoComplete="off" value={form.apiKey} onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
              placeholder={settings.hasOwnKey ? `Chave salva (${settings.keyHint}). Digite para trocar.` : 'sk-ant-…'}
              className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 font-mono text-sm text-slate-800 outline-none transition placeholder:font-sans placeholder:text-slate-400 focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100" />
            <p className="mt-1 text-[11px] text-slate-400">
              {settings.hasOwnKey
                ? 'A chave fica cifrada no servidor e nunca é mostrada de novo.'
                : settings.serverKeyAvailable
                  ? 'Sem chave própria, o assistente usa a chave do servidor do Argus.'
                  : 'Crie uma chave em console.anthropic.com. Ela fica cifrada no servidor.'}
              {settings.hasOwnKey && <> <button type="button" className="font-semibold text-rose-500 hover:underline" onClick={() => setClearKey(true)}>Remover chave</button></>}
            </p>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => save()} loading={busy}>Salvar configurações</Button>
          </div>
        </div>
      </Card>

      <Card className="h-fit">
        <SectionTitle title="Consumo deste mês" />
        {usage ? (
          <dl className="space-y-3">
            <div className="flex justify-between text-sm"><dt className="text-slate-500">Respostas</dt><dd className="font-semibold tabular-nums text-slate-800">{num(usage.answers)}</dd></div>
            <div className="flex justify-between text-sm"><dt className="text-slate-500">Tokens de entrada</dt><dd className="font-semibold tabular-nums text-slate-800">{num(usage.inputTokens)}</dd></div>
            <div className="flex justify-between text-sm"><dt className="text-slate-500">Tokens de saída</dt><dd className="font-semibold tabular-nums text-slate-800">{num(usage.outputTokens)}</dd></div>
          </dl>
        ) : <Loading />}
        <p className="mt-4 text-[11px] leading-relaxed text-slate-400">O custo é cobrado pela Anthropic na conta da chave usada. Modelos menores e o nível “Rápido” gastam menos.</p>
      </Card>

      <Confirm open={clearKey} title="Remover chave" action="Remover" danger busy={busy} onConfirm={() => save({ clearApiKey: true })} onClose={() => setClearKey(false)}>
        {settings.serverKeyAvailable
          ? 'O assistente passa a usar a chave do servidor do Argus.'
          : 'Sem chave, o assistente para de responder até que outra seja cadastrada.'}
      </Confirm>
    </div>
  )
}

// ─── Docs ────────────────────────────────────────────────────────────────────

const ENDPOINTS: { method: string; path: string; scope: string; desc: string }[] = [
  { method: 'GET', path: '/me', scope: '—', desc: 'Dados da chave e da ótica' },
  { method: 'GET', path: '/patients?q=&createdSince=', scope: 'patients:read', desc: 'Lista pacientes' },
  { method: 'GET', path: '/patients/{id}', scope: 'patients:read', desc: 'Paciente com receitas' },
  { method: 'POST', path: '/patients', scope: 'patients:write', desc: 'Cadastra paciente' },
  { method: 'GET', path: '/products?category=&lowStock=&active=', scope: 'catalog:read', desc: 'Produtos e estoque' },
  { method: 'GET', path: '/lenses', scope: 'catalog:read', desc: 'Catálogo de lentes' },
  { method: 'GET', path: '/stock/movements?from=&to=&productId=', scope: 'stock:read', desc: 'Movimentações de estoque' },
  { method: 'GET', path: '/orders?status=', scope: 'orders:read', desc: 'Ordens de serviço' },
  { method: 'GET', path: '/orders/{number}', scope: 'orders:read', desc: 'Uma OS pelo número' },
  { method: 'GET', path: '/sales?from=&to=&status=', scope: 'sales:read', desc: 'Vendas com itens' },
  { method: 'GET', path: '/payables?status=', scope: 'finance:read', desc: 'Contas a pagar' },
  { method: 'GET', path: '/finance/summary?from=&to=', scope: 'finance:read', desc: 'Resumo financeiro do período' },
]

const VERIFY_SNIPPET = `// Node.js: confira a assinatura antes de usar o evento
import crypto from 'node:crypto'

function verify(rawBody, header, secret) {
  const parts = Object.fromEntries(header.split(',').map(p => p.split('=')))
  const expected = crypto.createHmac('sha256', secret)
    .update(\`\${parts.t}.\${rawBody}\`).digest('hex')
  const fresh = Math.abs(Date.now() / 1000 - Number(parts.t)) < 300
  return fresh && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1))
}`

function DocsTab() {
  const base = `${window.location.origin}/api/v1`
  const curl = `curl ${base}/products?lowStock=true \\\n  -H "Authorization: Bearer argus_sk_..."`
  return (
    <div className="space-y-5">
      <Card>
        <SectionTitle title="API v1" sub="Autentique com uma chave no cabeçalho Authorization (ou X-API-Key). As respostas são JSON." />
        <div className="space-y-4">
          <CopyField label="URL base" value={base} />
          <pre className="overflow-x-auto rounded-xl bg-slate-900 px-4 py-3 font-mono text-xs text-slate-100">{curl}</pre>
          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr><th className="px-3 py-2 font-semibold">Rota</th><th className="px-3 py-2 font-semibold">Permissão</th><th className="px-3 py-2 font-semibold">O que faz</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ENDPOINTS.map(e => (
                  <tr key={e.method + e.path}>
                    <td className="px-3 py-2 font-mono text-xs"><span className={`mr-2 font-semibold ${e.method === 'GET' ? 'text-emerald-600' : 'text-brand-600'}`}>{e.method}</span>{e.path}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-500">{e.scope}</td>
                    <td className="px-3 py-2 text-slate-600">{e.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[13px] text-slate-500">
            Listas aceitam <code className="font-mono text-xs">limit</code> (até 200) e <code className="font-mono text-xs">offset</code>, e respondem
            {' '}<code className="font-mono text-xs">{'{ data, limit, offset, hasMore }'}</code>. Datas no formato <code className="font-mono text-xs">AAAA-MM-DD</code>.
            Erros vêm como <code className="font-mono text-xs">{'{ error, code }'}</code>: 401 chave inválida, 403 sem permissão, 429 limite de requisições.
          </p>
        </div>
      </Card>
      <Card>
        <SectionTitle title="Webhooks" sub="Cada evento chega como POST JSON. Responda com 2xx em até 10 segundos." />
        <div className="space-y-3 text-[13px] text-slate-600">
          <p>
            Corpo: <code className="font-mono text-xs">{'{ id, type, createdAt, data }'}</code>. Cabeçalhos: <code className="font-mono text-xs">X-Argus-Event</code>,
            {' '}<code className="font-mono text-xs">X-Argus-Event-Id</code> (use para ignorar repetidos) e <code className="font-mono text-xs">X-Argus-Signature: t=…,v1=…</code>.
          </p>
          <p>Se o destino falhar, o Argus tenta de novo até 6 vezes, com intervalos crescentes (30 s, 2 min, 8 min, 32 min…). Depois disso, a entrega fica como falha e pode ser reenviada pelo painel.</p>
          <pre className="overflow-x-auto rounded-xl bg-slate-900 px-4 py-3 font-mono text-xs text-slate-100">{VERIFY_SNIPPET}</pre>
        </div>
      </Card>
    </div>
  )
}
