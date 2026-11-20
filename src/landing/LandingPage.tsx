import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight, BadgeCheck, Boxes, Building2, ChevronDown, ClipboardList, Eye, FileSpreadsheet, FlaskConical,
  Glasses, KeyRound, Landmark, Lock, Menu, MessageCircle, Printer, Receipt, ScrollText, ShieldCheck,
  ShoppingCart, Stethoscope, UserCog, Users, Wrench, X,
} from 'lucide-react'
import { useReveal } from './useReveal'
import './landing.css'

const APP = '/app'
const SIGNUP = '/app?cadastro=1'
const REPO = 'https://github.com/leonardobarrosx/argus-project'

const NAV = [
  { href: '#fluxo', label: 'Como funciona' },
  { href: '#recursos', label: 'Recursos' },
  { href: '#seguranca', label: 'Segurança' },
  { href: '#perguntas', label: 'Perguntas' },
]

const FLOW = [
  { n: '01', icon: ScrollText, title: 'Receita', text: 'Cadastre o paciente, os dependentes e a receita com validade. Receita vencida não abre OS.' },
  { n: '02', icon: FlaskConical, title: 'Laboratório', text: 'A OS nasce na venda e anda em produção, pronto e entregue, com previsão e impressão.' },
  { n: '03', icon: BadgeCheck, title: 'Entrega', text: 'A entrega exige a OS paga. O que ficou a receber é cobrado no balcão, com o caixa aberto.' },
  { n: '04', icon: MessageCircle, title: 'Relacionamento', text: 'Aniversariantes, receitas vencendo e óculos prontos viram campanhas pelo WhatsApp.' },
]

type Feature = {
  id: string
  tab: string
  icon: typeof ShoppingCart
  title: string
  text: string
  points: string[]
  img: string
  alt: string
}

const FEATURES: Feature[] = [
  {
    id: 'pdv', tab: 'PDV', icon: ShoppingCart,
    title: 'Monte os óculos na venda.',
    text: 'Armação, lente e receita entram juntas no carrinho. A armação sai do estoque e a ordem de serviço já nasce pronta para o laboratório.',
    points: ['Óculos completos e produtos avulsos no mesmo carrinho', 'OS paga na hora ou a receber na entrega', 'Recibo impresso direto do navegador'],
    img: '/landing/03-pdv.webp', alt: 'Tela de ponto de venda do Argus com seleção de cliente e montagem de óculos',
  },
  {
    id: 'lab', tab: 'Laboratório', icon: FlaskConical,
    title: 'Cada OS no seu lugar.',
    text: 'Colunas de produção, pronto e entregue mostram o que está na bancada, o que já pode ser retirado e o que ainda falta receber.',
    points: ['Receitas válidas sem OS aparecem para abrir produção', 'Cancelar uma OS não paga devolve a armação ao estoque', 'Impressão da OS para o montador'],
    img: '/landing/02-laboratorio.webp', alt: 'Quadro do laboratório do Argus com ordens em produção, prontas e entregues',
  },
  {
    id: 'estoque', tab: 'Estoque', icon: Boxes,
    title: 'Estoque que explica cada número.',
    text: 'A quantidade só muda por entrada de nota, venda, OS, ajuste justificado, contagem física ou estorno. Tudo fica na trilha de auditoria.',
    points: ['Entrada de NF que lança a conta a pagar no prazo do fornecedor', 'Alerta de mínimo e sugestão de reposição', 'Margem e custo por produto'],
    img: '/landing/05-estoque.webp', alt: 'Tela de estoque do Argus com lentes e armações, mínimo e margem',
  },
  {
    id: 'financeiro', tab: 'Financeiro', icon: Landmark,
    title: 'O dinheiro da ótica, sem planilha.',
    text: 'Contas a pagar, OS a receber, fluxo de caixa diário e um DRE simplificado com o custo registrado em cada venda.',
    points: ['Fechamento de caixa compara contado e esperado', 'Comissões por vendedor no período', 'Exportação em CSV'],
    img: '/landing/04-financeiro.webp', alt: 'Painel financeiro do Argus com DRE, contas e fluxo de caixa',
  },
  {
    id: 'pacientes', tab: 'Pacientes', icon: Users,
    title: 'A família inteira na mesma ficha.',
    text: 'Paciente titular, dependentes, receitas e histórico de compras. Um responsável financeiro paga os óculos de todos.',
    points: ['Receitas com validade e alerta antes de vencer', 'Histórico de vendas e OS por paciente', 'Contato pelo WhatsApp a um clique'],
    img: '/landing/06-pacientes.webp', alt: 'Ficha de pacientes do Argus com dependentes e receitas',
  },
]

const ROLES = [
  { icon: Building2, role: 'Proprietário', access: 'Tudo, inclusive cadastrar gerentes.' },
  { icon: UserCog, role: 'Gerente', access: 'Tudo, exceto gerenciar proprietários e gerentes.' },
  { icon: Receipt, role: 'Vendedor e atendente', access: 'PDV, caixa, pacientes, receitas e laboratório.' },
  { icon: Stethoscope, role: 'Optometrista', access: 'Pacientes, receitas, abertura de OS e laboratório.' },
  { icon: Wrench, role: 'Montador', access: 'Avançar OS no laboratório e consultar estoque.' },
]

const SECURITY = [
  { icon: Lock, title: 'Cada ótica isolada no banco', text: 'Row Level Security no PostgreSQL. Mesmo que uma consulta esqueça o filtro, o banco não entrega dados de outra ótica.' },
  { icon: KeyRound, title: 'Sessão curta e rotativa', text: 'Token de acesso de 15 minutos só em memória e refresh token rotacionado a cada uso, em cookie httpOnly.' },
  { icon: ClipboardList, title: 'Trilha de auditoria', text: 'Toda movimentação de estoque guarda quem fez, quando e por quê, com saldo fiscal, gerencial e físico.' },
  { icon: ShieldCheck, title: 'Perfis e limites', text: 'Permissão por perfil em cada rota da API, limite de requisições e CORS por lista de origens.' },
]

const FAQ = [
  { q: 'Preciso instalar alguma coisa?', a: 'Não. O Argus roda no navegador, no computador do balcão, no notebook do laboratório ou no celular.' },
  { q: 'Como funciona o teste grátis?', a: 'Você cria a conta da ótica com seu e-mail e usa tudo por 14 dias. Depois pode convidar a equipe com o perfil de cada um.' },
  { q: 'Colaborador sem acesso ao sistema conta nas comissões?', a: 'Sim. Um colaborador pode existir sem login e ainda aparecer em equipe e no relatório de comissões.' },
  { q: 'O que acontece se eu cancelar uma venda?', a: 'A gerência cancela a venda, os produtos voltam ao estoque, as OS geradas são canceladas e os recebimentos voltam para a receber.' },
  { q: 'Meus dados ficam separados de outras óticas?', a: 'Ficam. O isolamento é feito no próprio banco com Row Level Security, e a API usa um usuário de banco sem permissão para ignorar essa regra.' },
]

function Logo({ light = false }: { light?: boolean }) {
  return (
    <a href="/" className="flex items-center gap-2.5" aria-label="Argus, página inicial">
      <img src="/argus-logo.svg" alt="" width={30} height={30} className={light ? 'brightness-0 invert' : ''} />
      <span className={`text-[17px] font-extrabold tracking-[0.18em] ${light ? 'text-white' : 'text-slate-900'}`}>ARGUS</span>
    </a>
  )
}

function Header() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <header className={`lp-header fixed inset-x-0 top-0 z-50 ${scrolled || open ? 'is-scrolled' : ''}`}>
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <nav className="hidden items-center gap-7 md:flex" aria-label="Seções">
          {NAV.map(n => (
            <a key={n.href} href={n.href} className="lp-navlink text-sm font-medium text-slate-600 hover:text-slate-900">{n.label}</a>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <a href={APP} className="rounded-full px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">Entrar</a>
          <a href={SIGNUP} className="lp-btn-primary rounded-full px-4 py-2 text-sm">Testar grátis</a>
        </div>
        <button type="button" className="-mr-2 rounded-lg p-2 text-slate-700 md:hidden" aria-expanded={open} aria-controls="lp-mobile-nav"
          aria-label={open ? 'Fechar menu' : 'Abrir menu'} onClick={() => setOpen(o => !o)}>
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>
      {open && (
        <div id="lp-mobile-nav" className="border-t border-slate-200/70 bg-white px-4 pb-5 pt-2 md:hidden">
          <nav className="flex flex-col" aria-label="Seções">
            {NAV.map(n => (
              <a key={n.href} href={n.href} onClick={() => setOpen(false)} className="border-b border-slate-100 py-3 text-[15px] font-medium text-slate-700">{n.label}</a>
            ))}
          </nav>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <a href={APP} className="rounded-full border border-slate-200 py-2.5 text-center text-sm font-semibold text-slate-700">Entrar</a>
            <a href={SIGNUP} className="lp-btn-primary rounded-full py-2.5 text-center text-sm">Testar grátis</a>
          </div>
        </div>
      )}
    </header>
  )
}

function BrowserFrame({ src, alt, className = '', eager = false }: { src: string; alt: string; className?: string; eager?: boolean }) {
  return (
    <div className={`lp-browser ${className}`}>
      <div className="flex items-center gap-1.5 border-b border-slate-200/80 px-3.5 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-3 hidden truncate rounded-md bg-slate-100 px-3 py-0.5 text-[11px] font-medium text-slate-400 sm:block">argus.app</span>
      </div>
      <img src={src} alt={alt} width={1400} height={875} loading={eager ? 'eager' : 'lazy'} decoding="async" className="block h-auto w-full" />
    </div>
  )
}

function Hero() {
  return (
    <section className="lp-hero relative overflow-hidden pt-28 sm:pt-32">
      <div className="lp-hero-glow" aria-hidden />
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1.02fr_1fr] lg:gap-10">
        <div>
          <p className="lp-in inline-flex items-center gap-2 rounded-full border border-brand-100 bg-white/80 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-brand-600 shadow-sm" style={{ ['--d' as string]: '0ms' }}>
            <span className="lp-pulse h-1.5 w-1.5 rounded-full bg-brand-500" /> Gestão para óticas · 14 dias grátis
          </p>
          <h1 className="lp-in mt-6 text-[2.6rem] font-extrabold leading-[1.02] tracking-[-0.035em] text-slate-950 sm:text-6xl lg:text-[4.1rem]" style={{ ['--d' as string]: '80ms' }}>
            Da receita à entrega, sua ótica <span className="lp-focus text-brand-500">em foco.</span>
          </h1>
          <p className="lp-in mt-6 max-w-xl text-[17px] leading-relaxed text-slate-600 sm:text-lg" style={{ ['--d' as string]: '160ms' }}>
            PDV que monta os óculos com armação, lente e receita, laboratório, estoque auditado, caixa e financeiro. Tudo conectado, no navegador.
          </p>
          <div className="lp-in mt-8 flex flex-wrap items-center gap-3" style={{ ['--d' as string]: '240ms' }}>
            <a href={SIGNUP} className="lp-btn-primary group inline-flex items-center gap-2 rounded-full px-6 py-3.5 text-[15px]">
              Criar minha ótica <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <a href="#fluxo" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-6 py-3.5 text-[15px] font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
              Ver como funciona
            </a>
          </div>
          <p className="lp-in mt-5 text-sm text-slate-500" style={{ ['--d' as string]: '300ms' }}>
            Já usa o Argus? <a href={APP} className="font-semibold text-brand-600 underline-offset-4 hover:underline">Entrar</a>
          </p>
        </div>

        <div className="lp-in relative lg:-mr-24" style={{ ['--d' as string]: '200ms' }}>
          <BrowserFrame src="/landing/01-visao-geral.webp" alt="Painel de visão geral do Argus com faturamento, produção e alertas" eager className="lp-tilt" />
          <div className="lp-chip lp-float-a absolute -left-3 top-[18%] hidden sm:flex" aria-hidden>
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-50 text-emerald-600"><Glasses className="h-4 w-4" /></span>
            <span><b>OS-1469 pronta</b><small>Carla Mendes · avisar retirada</small></span>
          </div>
          <div className="lp-chip lp-float-b absolute -bottom-5 left-[12%] hidden sm:flex" aria-hidden>
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-50 text-brand-600"><ScrollText className="h-4 w-4" /></span>
            <span><b>Receita válida</b><small>Pedro Costa · até 01/11/2027</small></span>
          </div>
          <div className="lp-chip lp-float-c absolute -top-4 right-[8%] hidden sm:flex lg:right-[30%]" aria-hidden>
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span><b>Caixa aberto</b></span>
          </div>
        </div>
      </div>

      <ul className="mx-auto mt-20 grid max-w-6xl grid-cols-2 gap-px overflow-hidden border-y border-slate-200/80 bg-slate-200/80 sm:mt-24 md:grid-cols-4" data-reveal>
        {[
          { icon: Glasses, t: 'Óculos montados no PDV' },
          { icon: FlaskConical, t: 'OS do laboratório' },
          { icon: Boxes, t: 'Estoque com auditoria' },
          { icon: Landmark, t: 'Caixa e DRE' },
        ].map(({ icon: Icon, t }) => (
          <li key={t} className="flex items-center gap-3 bg-[#f6f8fc] px-4 py-5 text-sm font-semibold text-slate-700 sm:px-6">
            <Icon className="h-4 w-4 shrink-0 text-brand-500" /> {t}
          </li>
        ))}
      </ul>
    </section>
  )
}

function Flow() {
  return (
    <section id="fluxo" className="scroll-mt-20 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead kicker="Como funciona" title="A rotina da ótica, num fluxo só." text="O Argus segue a mesma sequência do balcão: receita, laboratório, entrega e relacionamento. Cada etapa avisa a próxima." />
        <ol className="lp-flow relative mt-14 grid gap-4 md:grid-cols-4" data-reveal>
          <span className="lp-flow-line" aria-hidden />
          {FLOW.map(({ n, icon: Icon, title, text }, i) => (
            <li key={n} className="lp-flow-item relative rounded-2xl border border-slate-200/80 bg-white p-6" style={{ ['--i' as string]: i }}>
              <div className="flex items-center justify-between">
                <span className="lp-flow-dot grid h-11 w-11 place-items-center rounded-xl bg-brand-500 text-white"><Icon className="h-5 w-5" /></span>
                <span className="font-mono text-xs font-semibold text-slate-300">{n}</span>
              </div>
              <h3 className="mt-6 text-lg font-bold tracking-tight text-slate-900">{title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-slate-500">{text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

function SectionHead({ kicker, title, text, light = false, center = false }: { kicker: string; title: string; text?: string; light?: boolean; center?: boolean }) {
  return (
    <div className={`max-w-2xl ${center ? 'mx-auto text-center' : ''}`} data-reveal>
      <p className={`text-xs font-bold uppercase tracking-[0.2em] ${light ? 'text-brand-300' : 'text-brand-500'}`}>{kicker}</p>
      <h2 className={`mt-3 text-3xl font-extrabold leading-[1.08] tracking-[-0.03em] sm:text-[2.75rem] ${light ? 'text-white' : 'text-slate-950'}`}>{title}</h2>
      {text && <p className={`mt-4 text-[16px] leading-relaxed sm:text-[17px] ${light ? 'text-brand-100/80' : 'text-slate-500'}`}>{text}</p>}
    </div>
  )
}

function Features() {
  const [active, setActive] = useState(0)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const f = FEATURES[active]

  const onKey = (e: React.KeyboardEvent) => {
    let next = active
    if (e.key === 'ArrowRight') next = (active + 1) % FEATURES.length
    else if (e.key === 'ArrowLeft') next = (active - 1 + FEATURES.length) % FEATURES.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = FEATURES.length - 1
    else return
    e.preventDefault()
    setActive(next)
    tabs.current[next]?.focus()
  }

  return (
    <section id="recursos" className="scroll-mt-20 bg-white py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead kicker="Recursos" title="Venda, bancada e dinheiro conectados." text="Cada tela abaixo é o Argus funcionando, com os dados de uma ótica de demonstração." />

        <div role="tablist" aria-label="Recursos do Argus" onKeyDown={onKey}
          className="scrollbar-hide -mx-4 mt-10 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" data-reveal>
          {FEATURES.map((t, i) => {
            const Icon = t.icon
            const on = i === active
            return (
              <button key={t.id} ref={el => { tabs.current[i] = el }} role="tab" id={`tab-${t.id}`} aria-selected={on} aria-controls={`panel-${t.id}`}
                tabIndex={on ? 0 : -1} onClick={() => setActive(i)}
                className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold transition ${on ? 'border-brand-500 bg-brand-500 text-white shadow-[0_8px_24px_-8px_rgba(23,105,255,0.6)]' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'}`}>
                <Icon className="h-4 w-4" /> {t.tab}
              </button>
            )
          })}
        </div>

        <div role="tabpanel" id={`panel-${f.id}`} aria-labelledby={`tab-${f.id}`}
          className="mt-8 grid items-center gap-10 rounded-[28px] bg-[#f6f8fc] p-5 sm:p-8 lg:grid-cols-[0.8fr_1.2fr] lg:p-12">
          <div key={f.id} className="lp-swap">
            <h3 className="text-2xl font-extrabold tracking-[-0.02em] text-slate-950 sm:text-3xl">{f.title}</h3>
            <p className="mt-4 text-[15px] leading-relaxed text-slate-600">{f.text}</p>
            <ul className="mt-6 space-y-3">
              {f.points.map(p => (
                <li key={p} className="flex gap-3 text-[14px] font-medium text-slate-700">
                  <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" /> {p}
                </li>
              ))}
            </ul>
          </div>
          <div className="relative">
            {FEATURES.map((x, i) => (
              <div key={x.id} className={`lp-shot ${i === active ? 'is-on' : ''}`} aria-hidden={i !== active}>
                <BrowserFrame src={x.img} alt={x.alt} />
              </div>
            ))}
          </div>
        </div>

        <ul className="mt-6 grid gap-3 sm:grid-cols-3" data-reveal>
          {[
            { icon: Printer, t: 'Recibos e OS impressos', d: 'Direto do navegador, sem instalar driver.' },
            { icon: FileSpreadsheet, t: 'Exportação em CSV', d: 'Contas e relatórios para o contador.' },
            { icon: MessageCircle, t: 'Campanhas no WhatsApp', d: 'Aniversários, receitas vencendo e óculos prontos.' },
          ].map(({ icon: Icon, t, d }) => (
            <li key={t} className="flex gap-3 rounded-2xl border border-slate-200/80 p-5">
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />
              <span><b className="block text-sm font-bold text-slate-900">{t}</b><span className="text-[13px] text-slate-500">{d}</span></span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function Roles() {
  return (
    <section id="perfis" className="scroll-mt-20 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead kicker="Equipe" title="Cada pessoa vê o que precisa." text="Cinco perfis de acesso prontos. Quem não usa o sistema também pode ser cadastrado, para aparecer na equipe e nas comissões." />
        <ul className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-reveal>
          {ROLES.map(({ icon: Icon, role, access }, i) => (
            <li key={role} className="lp-role rounded-2xl border border-slate-200/80 bg-white p-5" style={{ ['--i' as string]: i }}>
              <Icon className="h-5 w-5 text-brand-500" />
              <h3 className="mt-4 text-[15px] font-bold text-slate-900">{role}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">{access}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function Security() {
  return (
    <section id="seguranca" className="lp-dark relative scroll-mt-20 overflow-hidden py-24 sm:py-32">
      <div className="lp-rings" aria-hidden />
      <div className="relative mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-14 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-center">
        <div className="min-w-0">
          <SectionHead light kicker="Segurança" title="Os dados da sua ótica não se misturam com os de ninguém." text="O Argus é multi-óticas desde o banco de dados. A API em Go roda com um usuário que não consegue ignorar o isolamento." />
          <pre className="lp-code mt-8" data-reveal aria-label="Exemplo da política de isolamento no PostgreSQL"><code>
<span className="c">-- cada transação sabe de qual ótica é</span>{'\n'}
<span className="k">select</span> set_config(<span className="s">'app.tenant_id'</span>, $1, <span className="k">true</span>);{'\n\n'}
<span className="k">create policy</span> tenant_isolation <span className="k">on</span> sales{'\n'}
{'  '}<span className="k">using</span> (tenant_id = current_setting(<span className="s">'app.tenant_id'</span>)::uuid);
          </code></pre>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2" data-reveal>
          {SECURITY.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="lp-sec rounded-2xl border border-white/10 bg-white/[0.04] p-6" style={{ ['--i' as string]: i }}>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-500/15 text-brand-300"><Icon className="h-5 w-5" /></span>
              <h3 className="mt-5 text-[15px] font-bold text-white">{title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-brand-100/70">{text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function Faq() {
  return (
    <section id="perguntas" className="scroll-mt-20 py-24 sm:py-32">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr]">
        <SectionHead kicker="Perguntas" title="Antes de começar." />
        <div className="divide-y divide-slate-200 border-y border-slate-200" data-reveal>
          {FAQ.map(({ q, a }) => (
            <details key={q} className="lp-faq group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-[16px] font-semibold text-slate-900">
                {q}
                <ChevronDown className="h-5 w-5 shrink-0 text-slate-400 transition-transform duration-300 group-open:rotate-180" />
              </summary>
              <p className="-mt-1 pb-6 pr-10 text-[15px] leading-relaxed text-slate-500">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

/** Snellen-style chart: the last CTA reads like an eye exam that ends on the brand. */
function FinalCta() {
  const rows = ['E', 'F P', 'T O Z', 'L P E D', 'A R G U S']
  return (
    <section className="px-4 pb-24 sm:px-6 sm:pb-32">
      <div className="lp-cta relative mx-auto grid max-w-6xl items-center gap-10 overflow-hidden rounded-[32px] px-6 py-14 sm:px-12 sm:py-16 lg:grid-cols-[1.2fr_0.8fr]" data-reveal>
        <div className="relative">
          <h2 className="text-3xl font-extrabold leading-[1.06] tracking-[-0.03em] text-white sm:text-5xl">Enxergue a ótica inteira numa tela.</h2>
          <p className="mt-4 max-w-lg text-[16px] leading-relaxed text-brand-100/85">Crie a conta da sua ótica em menos de um minuto e teste tudo por 14 dias.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={SIGNUP} className="group inline-flex items-center gap-2 rounded-full bg-white px-6 py-3.5 text-[15px] font-bold text-brand-700 transition hover:bg-brand-50">
              Criar minha ótica <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </a>
            <a href={APP} className="inline-flex items-center gap-2 rounded-full border border-white/30 px-6 py-3.5 text-[15px] font-semibold text-white transition hover:bg-white/10">
              Entrar
            </a>
          </div>
        </div>
        <div className="lp-snellen relative mx-auto hidden w-full max-w-[260px] select-none rounded-2xl bg-white px-6 py-7 text-center sm:block" aria-hidden>
          {rows.map((r, i) => (
            <p key={r} className="lp-snellen-row font-extrabold text-slate-900" style={{ ['--i' as string]: i, fontSize: `${[56, 42, 31, 23, 17][i]}px`, letterSpacing: `${0.12 + i * 0.05}em` }}>
              {r === 'A R G U S' ? <span className="text-brand-500">{r}</span> : r}
            </p>
          ))}
          <span className="mt-4 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400"><Eye className="h-3 w-3" /> 20/20</span>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <Logo />
          <p className="mt-2 text-[13px] text-slate-500">Gestão para óticas. PDV, laboratório, estoque e financeiro.</p>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] font-medium text-slate-500">
          {NAV.map(n => <a key={n.href} href={n.href} className="hover:text-slate-900">{n.label}</a>)}
          <a href={APP} className="hover:text-slate-900">Entrar</a>
        </div>
      </div>
      <div className="border-t border-slate-100">
        <p className="mx-auto max-w-6xl px-4 py-5 text-[12px] text-slate-400 sm:px-6">
          Projeto de Leonardo Barros · React, Go e PostgreSQL · <a href={REPO} target="_blank" rel="noreferrer" className="underline-offset-4 hover:text-slate-600 hover:underline">código no GitHub</a>
        </p>
      </div>
    </footer>
  )
}

export default function LandingPage() {
  const ref = useRef<HTMLDivElement>(null)
  useReveal(ref)
  useEffect(() => {
    document.title = 'ARGUS · Gestão para óticas'
  }, [])
  return (
    <div ref={ref} className="lp w-full">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:shadow-lg">Pular para o conteúdo</a>
      <Header />
      <main id="conteudo">
        <Hero />
        <Flow />
        <Features />
        <Roles />
        <Security />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  )
}
