import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  AlertTriangle, BarChart3, Bell, Boxes, CalendarDays, Check, CheckCircle2,
  ChevronDown, ChevronLeft, ChevronRight, ClipboardPlus, CreditCard,
  Download, FileText, Filter, FlaskConical, Gift, LayoutDashboard, MessageCircle,
  Microscope, Package, Plus, Search, Send, ShoppingCart,
  Sparkles, Stethoscope, TrendingDown, TrendingUp, UserPlus,
  UserRound, Users, X, History, Phone, Glasses, Trash2, Briefcase, Mail, Edit2,
} from 'lucide-react'

/* ================================================================== */
/*  TYPES                                                              */
/* ================================================================== */

type PageKey = 'overview' | 'pdv' | 'patients' | 'lab' | 'stock' | 'collaborators' | 'reports'

interface RxData { sph: string; cyl: string; axis: string; add: string; dnp: string; height: string }

interface Prescription {
  id: number
  patientId: number
  rxOD: RxData
  rxOE: RxData
  examDate: string        // dd/mm/yyyy
  expiresAt: string       // dd/mm/yyyy (1 year from exam)
  lensType: string
}

interface ServiceOrder {
  id: string
  prescriptionId: number
  patientId: number
  status: 'production' | 'ready' | 'delivered'
  frameItemId: number | null      // stock item used for frame (armação)
  lensItemId: number | null       // stock item used for lens
  lensQtyUsed: number
  createdAt: string
  productionStartedAt: string | null
  readyAt: string | null
  deliveredAt: string | null
  saleId?: number                 // linked sale (if paid upfront)
  paid: boolean                   // whether OS was paid at creation
}

interface Sale {
  id: number
  patientId: number | null
  orderId: string | null           // linked OS
  items: { name: string; price: number; qty: number }[]
  total: number
  paymentMethod: string
  date: string
  beneficiaryId?: number           // quem vai usar (dependente)
  prescriptionId?: number          // Rx usada na venda
}

interface Patient {
  id: number
  name: string
  cpf: string
  phone: string
  birthDate: string       // dd/mm/yyyy
  createdAt: string
  parentId?: number       // responsável financeiro (se for dependente)
}

interface StockItem {
  id: number
  name: string
  qty: number
  min: number
  price: number
  costPrice: number
  commissionPct: number
  category: string
  supplier: string
}

interface Notification {
  id: string
  title: string
  sub: string
  type: 'stock' | 'birthday' | 'prescription' | 'order' | 'info'
  read: boolean
}

interface CartItem {
  id: number; stockItemId: number; name: string; price: number; qty: number
}

interface CartGlassesItem {
  id: number
  beneficiaryId: number
  beneficiaryName: string
  frameStockItemId: number
  frameName: string
  framePrice: number
  lensId: number
  lensName: string
  lensPrice: number
  prescriptionId: number | null
  isReadyMade: boolean
}

interface LensCatalogItem {
  id: number
  name: string
  description: string
  price: number
  lensType: string
  index: string
}

interface StockMovement {
  id: number
  stockItemId: number
  qty: number
  type: 'in' | 'out'
  date: string
  reason: 'service_order' | 'sale' | 'manual_adjustment' | 'purchase' | 'physical_count'
  performedBy: string
  notes?: string
  timestamp?: string        // HH:mm
  orderId?: string
  prescriptionId?: number
  invoiceNumber?: string
  previousQty?: number
  newQty?: number
}

interface Collaborator {
  id: number
  name: string
  role: 'optometrista' | 'vendedor' | 'montador' | 'atendente' | 'gerente'
  phone: string
  email: string
  commissionPct: number
  active: boolean
  createdAt: string
}

interface CampaignFilter {
  type: 'birthday' | 'prescription_expiry'
  daysAhead: number
}

interface PersistedState {
  patients: Patient[]
  stock: StockItem[]
  prescriptions: Prescription[]
  orders: ServiceOrder[]
  sales: Sale[]
  stockMovements: StockMovement[]
  dismissedNotifs: string[]
  collaborators: Collaborator[]
}

/* ================================================================== */
/*  CONSTANTS                                                          */
/* ================================================================== */

const TODAY = fmtDate(new Date())
const TODAY_D = parseDMY(TODAY)!
const STORAGE_KEY = 'argus-erp-mvp-v1'

const NAV: { key: PageKey; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'overview', label: 'Visão geral', icon: LayoutDashboard },
  { key: 'pdv', label: 'PDV', icon: ShoppingCart },
  { key: 'patients', label: 'Pacientes', icon: UserRound },
  { key: 'lab', label: 'Laboratório', icon: FlaskConical },
  { key: 'stock', label: 'Estoque', icon: Boxes },
  { key: 'collaborators', label: 'Equipe', icon: Briefcase },
  { key: 'reports', label: 'Relatórios', icon: BarChart3 },
]

/* ================================================================== */
/*  HELPERS                                                            */
/* ================================================================== */

function parseDMY(s: string): Date | null {
  const [d, m, y] = s.split('/').map(Number)
  if (!d || !m || !y) return null
  return new Date(y, m - 1, d)
}

function fmtDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

function addYears(d: Date, n: number): Date {
  const r = new Date(d)
  r.setFullYear(r.getFullYear() + n)
  return r
}

function nextBirthdayDate(birthDate: string, reference: Date): Date | null {
  const bd = parseDMY(birthDate)
  if (!bd) return null
  let next = new Date(reference.getFullYear(), bd.getMonth(), bd.getDate())
  if (next < reference) next = new Date(reference.getFullYear() + 1, bd.getMonth(), bd.getDate())
  return next
}

function readPersistedState(): Partial<PersistedState> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as Partial<PersistedState>
  } catch {
    return null
  }
}

function writePersistedState(state: PersistedState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Ignore quota/storage errors to avoid breaking core UX.
  }
}

const emptyRx = (): RxData => ({ sph: '', cyl: '', axis: '', add: '', dnp: '', height: '' })

let _oid = 1490
function nextOS() { return `OS-${_oid++}` }

/* ================================================================== */
/*  SEED DATA                                                          */
/* ================================================================== */

const seedPatients = (): Patient[] => [
  { id: 1, name: 'Marina Costa', cpf: '412.522.891-91', phone: '(11) 98765-4321', birthDate: '09/03/1990', createdAt: '15/01/2026' },
  { id: 2, name: 'Diego Nunes', cpf: '321.118.442-44', phone: '(11) 91234-5678', birthDate: '22/06/1985', createdAt: '20/01/2026' },
  { id: 3, name: 'Lucia Ramos', cpf: '155.300.123-12', phone: '(21) 99876-5432', birthDate: '14/09/1978', createdAt: '01/02/2026' },
  { id: 4, name: 'Carla Mendes', cpf: '289.455.672-67', phone: '(21) 98765-1234', birthDate: '30/12/1992', createdAt: '10/02/2026' },
  { id: 5, name: 'Tiago Costa', cpf: '567.789.231-23', phone: '(11) 97654-3210', birthDate: '05/08/1988', createdAt: '25/02/2026' },
]

const seedStock = (): StockItem[] => [
  { id: 1, name: 'Lentes Blue Light 1.59', qty: 10, min: 10, price: 189.90, costPrice: 85.00, commissionPct: 5, category: 'Lentes', supplier: 'Zeiss Brasil' },
  { id: 2, name: 'Armação Titan Slim M', qty: 3, min: 8, price: 320.00, costPrice: 120.00, commissionPct: 8, category: 'Armações', supplier: 'Chilli Beans' },
  { id: 3, name: 'Lente Progres. Office', qty: 4, min: 5, price: 350.00, costPrice: 150.00, commissionPct: 5, category: 'Lentes', supplier: 'Essilor' },
  { id: 4, name: 'Armação Classic Round G', qty: 21, min: 10, price: 280.00, costPrice: 95.00, commissionPct: 8, category: 'Armações', supplier: 'Ray-Ban' },
  { id: 5, name: 'Lentes Transitions Gen8', qty: 7, min: 6, price: 450.00, costPrice: 200.00, commissionPct: 5, category: 'Lentes', supplier: 'Transitions Optical' },
  { id: 6, name: 'Flanela de microfibra', qty: 48, min: 20, price: 15.00, costPrice: 3.50, commissionPct: 0, category: 'Acessórios', supplier: 'Genérico' },
  { id: 7, name: 'Antirreflexo Premium', qty: 18, min: 8, price: 120.00, costPrice: 45.00, commissionPct: 5, category: 'Tratamentos', supplier: 'Hoya' },
  { id: 8, name: 'Estojo rígido premium', qty: 30, min: 15, price: 35.00, costPrice: 12.00, commissionPct: 0, category: 'Acessórios', supplier: 'Genérico' },
]

const seedPrescriptions = (): Prescription[] => [
  { id: 1, patientId: 1, rxOD: { sph: '-1.25', cyl: '-0.50', axis: '90', add: '', dnp: '31.5', height: '18' }, rxOE: { sph: '-1.00', cyl: '-0.25', axis: '85', add: '', dnp: '31.0', height: '17' }, examDate: '15/03/2025', expiresAt: '15/03/2026', lensType: 'Blue Light' },
  { id: 2, patientId: 2, rxOD: { sph: '-2.75', cyl: '-1.00', axis: '180', add: '+2.00', dnp: '32', height: '20' }, rxOE: { sph: '-2.50', cyl: '-0.75', axis: '175', add: '+2.00', dnp: '31.5', height: '19' }, examDate: '20/01/2026', expiresAt: '20/01/2027', lensType: 'Progressiva' },
  { id: 3, patientId: 3, rxOD: { sph: '+1.50', cyl: '-0.25', axis: '45', add: '', dnp: '30', height: '17' }, rxOE: { sph: '+1.75', cyl: '-0.50', axis: '135', add: '', dnp: '30.5', height: '17' }, examDate: '01/02/2026', expiresAt: '01/02/2027', lensType: 'Transitions' },
  { id: 4, patientId: 4, rxOD: { sph: '-0.50', cyl: '', axis: '', add: '', dnp: '31', height: '16' }, rxOE: { sph: '-0.75', cyl: '-0.25', axis: '90', add: '', dnp: '31', height: '16' }, examDate: '10/02/2026', expiresAt: '10/02/2027', lensType: 'Blue Light' },
]

const seedOrders = (): ServiceOrder[] => [
  { id: 'OS-1482', prescriptionId: 2, patientId: 2, status: 'production', frameItemId: 4, lensItemId: 3, lensQtyUsed: 2, createdAt: '25/02/2026', productionStartedAt: '26/02/2026', readyAt: null, deliveredAt: null, paid: false },
  { id: 'OS-1479', prescriptionId: 4, patientId: 4, status: 'ready', frameItemId: 2, lensItemId: 1, lensQtyUsed: 2, createdAt: '20/02/2026', productionStartedAt: '21/02/2026', readyAt: '05/03/2026', deliveredAt: null, paid: false },
  { id: 'OS-1472', prescriptionId: 1, patientId: 1, status: 'delivered', frameItemId: 4, lensItemId: 1, lensQtyUsed: 2, createdAt: '01/03/2026', productionStartedAt: '02/03/2026', readyAt: '06/03/2026', deliveredAt: '09/03/2026', saleId: 1, paid: true },
  { id: 'OS-1468', prescriptionId: 3, patientId: 3, status: 'production', frameItemId: 2, lensItemId: 5, lensQtyUsed: 2, createdAt: '04/03/2026', productionStartedAt: '05/03/2026', readyAt: null, deliveredAt: null, paid: false },
]

const seedSales = (): Sale[] => [
  { id: 1, patientId: 1, orderId: 'OS-1472', items: [{ name: 'Armação Classic Round G', price: 280, qty: 1 }], total: 280.00, paymentMethod: 'Cartão crédito', date: '09/03/2026' },
]

const LENS_CATALOG: LensCatalogItem[] = [
  { id: 1, name: 'Visão Simples CR-39 1.56', description: 'Lente básica para miopia/hipermetropia leve', price: 120.00, lensType: 'Simples', index: '1.56' },
  { id: 2, name: 'Visão Simples Policarbonato 1.59', description: 'Resistente a impacto, ideal para crianças e esportes', price: 180.00, lensType: 'Simples', index: '1.59' },
  { id: 3, name: 'Visão Simples Alto Índice 1.67', description: 'Mais fina, ideal para graus médios', price: 280.00, lensType: 'Simples', index: '1.67' },
  { id: 4, name: 'Visão Simples Ultra Fina 1.74', description: 'Ultra fina, graus altos (+/- 4.00 ou mais)', price: 450.00, lensType: 'Simples', index: '1.74' },
  { id: 5, name: 'Blue Light 1.56', description: 'Filtro de luz azul para uso digital', price: 189.90, lensType: 'Blue Light', index: '1.56' },
  { id: 6, name: 'Blue Light Policarbonato 1.59', description: 'Policarbonato + filtro luz azul', price: 250.00, lensType: 'Blue Light', index: '1.59' },
  { id: 7, name: 'Blue Light Alto Índice 1.67', description: 'Fina + filtro luz azul', price: 350.00, lensType: 'Blue Light', index: '1.67' },
  { id: 8, name: 'Progressiva Standard 1.56', description: 'Multifocal básica', price: 350.00, lensType: 'Progressiva', index: '1.56' },
  { id: 9, name: 'Progressiva Premium 1.67', description: 'Multifocal fina, campo visual ampliado', price: 650.00, lensType: 'Progressiva', index: '1.67' },
  { id: 10, name: 'Progressiva Elite 1.74', description: 'Multifocal ultra fina, máxima precisão', price: 950.00, lensType: 'Progressiva', index: '1.74' },
  { id: 11, name: 'Transitions Gen8 1.56', description: 'Fotossensível, adapta-se à luz', price: 450.00, lensType: 'Transitions', index: '1.56' },
  { id: 12, name: 'Transitions Gen8 1.67', description: 'Fotossensível fina', price: 680.00, lensType: 'Transitions', index: '1.67' },
  { id: 13, name: 'Lente Pronta Leitura', description: 'Óculos pronto para leitura simples (sem grau personalizado)', price: 60.00, lensType: 'Leitura', index: '1.50' },
  { id: 14, name: 'Lente Solar (sem grau)', description: 'Lente escura para óculos de sol', price: 80.00, lensType: 'Solar', index: '1.50' },
]

/* ================================================================== */
/*  SMART SUGGESTIONS ENGINE (real stock analysis)                     */
/* ================================================================== */

interface Suggestion { title: string; sub: string; severity: 'critical' | 'warning' | 'info' }

function computeSuggestions(stock: StockItem[], orders: ServiceOrder[]): Suggestion[] {
  const suggestions: Suggestion[] = []

  // Items below minimum
  const critical = stock.filter(s => s.qty <= s.min)
  for (const item of critical) {
    const deficit = item.min - item.qty
    if (item.qty === 0) {
      suggestions.push({ title: `${item.name} — ESGOTADO`, sub: `Repor imediatamente. Mínimo: ${item.min} un`, severity: 'critical' })
    } else if (item.qty <= Math.ceil(item.min * 0.5)) {
      suggestions.push({ title: `Repor ${item.name}`, sub: `Apenas ${item.qty} un (mín: ${item.min}). Déficit: ${deficit} un`, severity: 'critical' })
    } else {
      suggestions.push({ title: `Estoque baixo: ${item.name}`, sub: `${item.qty}/${item.min} un — considere repor`, severity: 'warning' })
    }
  }

  // Stock being consumed by active orders
  const activeOrders = orders.filter(o => o.status === 'production')
  const lensUsageMap = new Map<number, number>()
  for (const o of activeOrders) {
    if (o.lensItemId) lensUsageMap.set(o.lensItemId, (lensUsageMap.get(o.lensItemId) || 0) + o.lensQtyUsed)
  }
  for (const [itemId, qtyReserved] of lensUsageMap) {
    const item = stock.find(s => s.id === itemId)
    if (item && item.qty - qtyReserved < item.min) {
      suggestions.push({ title: `${item.name} em uso elevado`, sub: `${qtyReserved} un reservadas em OS ativas. Saldo livre: ${item.qty - qtyReserved}`, severity: 'warning' })
    }
  }

  // Check for overstocked items
  const overstocked = stock.filter(s => s.qty > s.min * 3 && s.min > 0)
  for (const item of overstocked) {
    suggestions.push({ title: `Excesso: ${item.name}`, sub: `${item.qty} un (mín: ${item.min}). Considere promoção ou combo`, severity: 'info' })
  }

  return suggestions.slice(0, 6)
}

/* ================================================================== */
/*  DYNAMIC NOTIFICATIONS ENGINE                                       */
/* ================================================================== */

function computeNotifications(
  patients: Patient[],
  prescriptions: Prescription[],
  orders: ServiceOrder[],
  stock: StockItem[],
): Notification[] {
  const notifs: Notification[] = []

  // Birthday alerts (today and upcoming week)
  for (const p of patients) {
    const nextBd = nextBirthdayDate(p.birthDate, TODAY_D)
    if (!nextBd) continue
    const days = daysBetween(TODAY_D, nextBd)
    if (days === 0) {
      notifs.push({ id: `bday-${p.id}`, title: `🎂 Aniversário hoje: ${p.name}`, sub: `Envie felicitações pelo WhatsApp`, type: 'birthday', read: false })
    } else if (days > 0 && days <= 7) {
      notifs.push({ id: `bdaysoon-${p.id}`, title: `Aniversário em ${days} dia(s)`, sub: `${p.name} · preparar campanha`, type: 'birthday', read: false })
    }
  }

  // Prescriptions expiring within 30 days
  for (const rx of prescriptions) {
    const exp = parseDMY(rx.expiresAt)
    if (!exp) continue
    const days = daysBetween(TODAY_D, exp)
    if (days > 0 && days <= 30) {
      const pat = patients.find(p => p.id === rx.patientId)
      notifs.push({ id: `rxexp-${rx.id}`, title: `Receita expirando em ${days} dias`, sub: `${pat?.name ?? 'Paciente'} — vence ${rx.expiresAt}`, type: 'prescription', read: false })
    } else if (days <= 0) {
      const pat = patients.find(p => p.id === rx.patientId)
      notifs.push({ id: `rxexpd-${rx.id}`, title: `Receita vencida`, sub: `${pat?.name ?? 'Paciente'} — venceu ${rx.expiresAt}`, type: 'prescription', read: false })
    }
  }

  // Orders ready for pickup
  for (const o of orders.filter(o => o.status === 'ready')) {
    const pat = patients.find(p => p.id === o.patientId)
    notifs.push({ id: `ordy-${o.id}`, title: `Óculos pronto para retirada`, sub: `${o.id} · ${pat?.name ?? 'Paciente'}`, type: 'order', read: false })
  }

  // Stock critical
  for (const s of stock.filter(s => s.qty <= Math.ceil(s.min * 0.5))) {
    notifs.push({ id: `stk-${s.id}`, title: `Estoque crítico`, sub: `${s.name} — apenas ${s.qty} un`, type: 'stock', read: false })
  }

  return notifs
}

/* ================================================================== */
/*  SHARED COMPONENTS                                                  */
/* ================================================================== */

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white p-5 shadow-card ${className}`}>{children}</div>
}

function Badge({ children, color = 'blue' }: { children: React.ReactNode; color?: string }) {
  const map: Record<string, string> = {
    blue: 'bg-brand-50 text-brand-600', emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600', rose: 'bg-rose-50 text-rose-600',
    slate: 'bg-slate-100 text-slate-500',
  }
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none ${map[color] ?? map.blue}`}>{children}</span>
}

function SectionTitle({ title, sub, action }: { title: string; sub?: string; action?: React.ReactNode }) {
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

function useClickOutside(ref: React.RefObject<HTMLElement | null>, handler: () => void) {
  useEffect(() => {
    const listener = (e: MouseEvent) => { if (!ref.current || ref.current.contains(e.target as Node)) return; handler() }
    document.addEventListener('mousedown', listener)
    return () => document.removeEventListener('mousedown', listener)
  }, [ref, handler])
}

function ArgusLogo({ size = 28 }: { size?: number }) {
  const [err, setErr] = useState(false)
  if (err) return <Stethoscope style={{ width: size, height: size }} className="text-brand-500" />
  return <img src="/argus-logo.svg" alt="ARGUS" style={{ width: size, height: size }} className="object-contain" onError={() => setErr(true)} />
}

function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/30 px-3 py-6 sm:py-10 backdrop-blur-sm" onClick={onClose}>
      <div className={`w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} animate-fadeIn rounded-2xl bg-white shadow-dropdown`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"><X className="h-5 w-5" /></button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

function FormField({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-slate-500">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100" />
    </div>
  )
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-slate-500">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100">
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-slate-800">{value}</p>
    </div>
  )
}

/* ================================================================== */
/*  NOTIFICATION DROPDOWN                                              */
/* ================================================================== */

function NotificationDropdown({ notifications, open, onClose, onMarkRead, onMarkAllRead }: {
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

/* ================================================================== */
/*  SMART SEARCH                                                       */
/* ================================================================== */

function SmartSearch({ patients, orders, onSelectPatient, onSelectOrder }: {
  patients: Patient[]; orders: ServiceOrder[]; onSelectPatient: (p: Patient) => void; onSelectOrder: (o: ServiceOrder) => void
}) {
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useClickOutside(ref, () => setFocused(false))

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); inputRef.current?.focus() } }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const q = query.toLowerCase()
  const fPatients = query.length >= 2 ? patients.filter(p => p.name.toLowerCase().includes(q) || p.cpf.includes(query)).slice(0, 4) : []
  const fOrders = query.length >= 2 ? orders.filter(o => o.id.toLowerCase().includes(q)).slice(0, 3) : []

  return (
    <div ref={ref} className="relative flex-1 sm:max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
      <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} onFocus={() => setFocused(true)}
        placeholder="Buscar paciente, CPF ou OS…"
        className="h-10 w-full rounded-xl border border-slate-200/80 bg-slate-50/80 pl-10 pr-16 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100" />
      <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">Ctrl K</kbd>
      {focused && (fPatients.length > 0 || fOrders.length > 0) && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-full animate-fadeIn rounded-xl bg-white py-1 shadow-dropdown">
          {fPatients.length > 0 && <p className="px-4 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-300">Pacientes</p>}
          {fPatients.map(p => (
            <button key={p.id} onClick={() => { onSelectPatient(p); setQuery(''); setFocused(false) }}
              className="flex w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-slate-50">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><UserRound className="h-4 w-4" /></div>
              <div><p className="text-sm font-medium text-slate-800">{p.name}</p><p className="text-xs text-slate-400">{p.cpf}</p></div>
            </button>
          ))}
          {fOrders.length > 0 && <p className="px-4 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-300">Ordens de serviço</p>}
          {fOrders.map(o => (
            <button key={o.id} onClick={() => { onSelectOrder(o); setQuery(''); setFocused(false) }}
              className="flex w-full items-center gap-3 px-4 py-2 text-left transition hover:bg-slate-50">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600"><FileText className="h-4 w-4" /></div>
              <div><p className="text-sm font-medium text-slate-800">{o.id}</p><p className="text-xs text-slate-400">Status: {o.status}</p></div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ================================================================== */
/*  RX INPUT ROW                                                       */
/* ================================================================== */

function RxInputRow({ label, rx, onChange }: { label: string; rx: RxData; onChange: (r: RxData) => void }) {
  const fields: { key: keyof RxData; name: string; ph: string }[] = [
    { key: 'sph', name: 'Esf', ph: '-1.25' }, { key: 'cyl', name: 'Cil', ph: '-0.50' },
    { key: 'axis', name: 'Eixo', ph: '90' }, { key: 'add', name: 'Ad', ph: '+2.00' },
    { key: 'dnp', name: 'DNP', ph: '31.5' }, { key: 'height', name: 'Alt', ph: '18' },
  ]
  return (
    <div className="rounded-xl bg-slate-50/70 p-3">
      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {fields.map(f => (
          <div key={f.key}>
            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-300">{f.name}</p>
            <input value={rx[f.key]} onChange={e => onChange({ ...rx, [f.key]: e.target.value })} placeholder={f.ph}
              className="w-full rounded-lg border border-slate-200/80 bg-white px-2 py-1.5 text-sm text-slate-800 placeholder:text-slate-300 outline-none transition focus:border-brand-300 focus:ring-1 focus:ring-brand-100" />
          </div>
        ))}
      </div>
    </div>
  )
}

/* ================================================================== */
/*  RX DISPLAY (read only)                                             */
/* ================================================================== */

function RxDisplay({ label, rx }: { label: string; rx: RxData }) {
  const fields: { key: keyof RxData; name: string }[] = [
    { key: 'sph', name: 'Esf' }, { key: 'cyl', name: 'Cil' }, { key: 'axis', name: 'Eixo' },
    { key: 'add', name: 'Ad' }, { key: 'dnp', name: 'DNP' }, { key: 'height', name: 'Alt' },
  ]
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {fields.map(f => (
          <div key={f.key}>
            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-300">{f.name}</p>
            <div className="rounded-md bg-white px-2 py-1.5 text-sm font-medium text-slate-800">{rx[f.key] || '—'}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ================================================================== */
/*  APP — MAIN                                                         */
/* ================================================================== */

export default function App() {
  const [page, setPage] = useState<PageKey>('overview')
  const initialPersisted = useMemo(() => readPersistedState(), [])

  // Core state
  const [patients, setPatients] = useState<Patient[]>(() =>
    Array.isArray(initialPersisted?.patients) ? initialPersisted.patients : seedPatients(),
  )
  const [stock, setStock] = useState<StockItem[]>(() =>
    Array.isArray(initialPersisted?.stock) ? initialPersisted.stock : seedStock(),
  )
  const [prescriptions, setPrescriptions] = useState<Prescription[]>(() =>
    Array.isArray(initialPersisted?.prescriptions) ? initialPersisted.prescriptions : seedPrescriptions(),
  )
  const [orders, setOrders] = useState<ServiceOrder[]>(() =>
    Array.isArray(initialPersisted?.orders) ? initialPersisted.orders : seedOrders(),
  )
  const [sales, setSales] = useState<Sale[]>(() =>
    Array.isArray(initialPersisted?.sales) ? initialPersisted.sales : seedSales(),
  )
  const [cart, setCart] = useState<CartItem[]>([])
  const [glassesCart, setGlassesCart] = useState<CartGlassesItem[]>([])
  const [stockMovements, setStockMovements] = useState<StockMovement[]>(() =>
    Array.isArray(initialPersisted?.stockMovements) ? initialPersisted.stockMovements : [],
  )
  const [collaborators, setCollaborators] = useState<Collaborator[]>(() =>
    Array.isArray(initialPersisted?.collaborators) ? initialPersisted.collaborators : [
      { id: 1, name: 'Eliza Silva', role: 'gerente', phone: '(11) 99999-0001', email: 'eliza@argus.com', commissionPct: 0, active: true, createdAt: '01/01/2026' },
      { id: 2, name: 'Carlos Mendes', role: 'optometrista', phone: '(11) 99999-0002', email: 'carlos@argus.com', commissionPct: 3, active: true, createdAt: '01/01/2026' },
      { id: 3, name: 'Julia Santos', role: 'vendedor', phone: '(11) 99999-0003', email: 'julia@argus.com', commissionPct: 8, active: true, createdAt: '15/01/2026' },
    ],
  )

  // Dynamic notifications from real data
  const dynamicNotifs = useMemo(() => computeNotifications(patients, prescriptions, orders, stock), [patients, prescriptions, orders, stock])
  const [dismissedNotifs, setDismissedNotifs] = useState<Set<string>>(
    () => new Set(Array.isArray(initialPersisted?.dismissedNotifs) ? initialPersisted.dismissedNotifs : []),
  )
  const notifications = useMemo(() => dynamicNotifs.map(n => ({ ...n, read: dismissedNotifs.has(n.id) })), [dynamicNotifs, dismissedNotifs])

  const [notifOpen, setNotifOpen] = useState(false)
  const unreadCount = notifications.filter(n => !n.read).length

  const markRead = useCallback((id: string) => setDismissedNotifs(prev => new Set(prev).add(id)), [])
  const markAllRead = useCallback(() => setDismissedNotifs(new Set(notifications.map(n => n.id))), [notifications])

  // Smart suggestions from real stock
  const suggestions = useMemo(() => computeSuggestions(stock, orders), [stock, orders])

  // UI modals
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null)
  const [newPatientOpen, setNewPatientOpen] = useState(false)
  const [newPatientForm, setNewPatientForm] = useState({ name: '', cpf: '', phone: '', birthDate: '' })
  const [newRxOpen, setNewRxOpen] = useState(false)
  const [newRxPatientId, setNewRxPatientId] = useState<number | null>(null)
  const [newRxOD, setNewRxOD] = useState(emptyRx())
  const [newRxOE, setNewRxOE] = useState(emptyRx())
  const [newRxLensType, setNewRxLensType] = useState('')
  const [newRxExamDate, setNewRxExamDate] = useState(TODAY)
  const [newRxExpiresAt, setNewRxExpiresAt] = useState(fmtDate(addYears(TODAY_D, 1)))
  const [newOsOpen, setNewOsOpen] = useState(false)
  const [newOsRxId, setNewOsRxId] = useState<number | null>(null)
  const [newOsLensItemId, setNewOsLensItemId] = useState<string>('')
  const [newOsFrameItemId, setNewOsFrameItemId] = useState<string>('')
  const [newOsQty, setNewOsQty] = useState<string>('2')
  const [stockEditId, setStockEditId] = useState<number | null>(null)
  const [stockEditQty, setStockEditQty] = useState('')
  const [stockEditReason, setStockEditReason] = useState('')
  const [stockEditType, setStockEditType] = useState<'adjust' | 'count'>('adjust')
  const [stockLogItemId, setStockLogItemId] = useState<number | null>(null)
  const [saleLinkedOrderId, setSaleLinkedOrderId] = useState<string | null>(null)
  const [salePatientId, setSalePatientId] = useState<number | null>(null)
  const [campaignOpen, setCampaignOpen] = useState(false)
  const [campaignFilter, setCampaignFilter] = useState<CampaignFilter>({ type: 'birthday', daysAhead: 7 })
  const [orderDetailId, setOrderDetailId] = useState<string | null>(null)
  const [rxSaved, setRxSaved] = useState(false)
  const [systemMessage, setSystemMessage] = useState('')

  // ── PDV flow state ──
  const [pdvClientId, setPdvClientId] = useState<number | null>(null)
  const [pdvNewClientOpen, setPdvNewClientOpen] = useState(false)
  const [pdvNewClientForm, setPdvNewClientForm] = useState({ name: '', cpf: '', phone: '', birthDate: '' })
  const [pdvNewDependentOpen, setPdvNewDependentOpen] = useState(false)
  const [pdvNewDependentForm, setPdvNewDependentForm] = useState({ name: '', cpf: '', phone: '', birthDate: '' })
  const [pdvAddGlassesOpen, setPdvAddGlassesOpen] = useState(false)
  const [pdvGlassesBeneficiary, setPdvGlassesBeneficiary] = useState<number | null>(null)
  const [pdvGlassesFrame, setPdvGlassesFrame] = useState<string>('')
  const [pdvGlassesLens, setPdvGlassesLens] = useState<string>('')
  const [pdvGlassesRxId, setPdvGlassesRxId] = useState<number | null>(null)
  const [pdvGlassesIsReady, setPdvGlassesIsReady] = useState(false)
  const [pdvAddRxOpen, setPdvAddRxOpen] = useState(false)
  const [pdvAddRxOD, setPdvAddRxOD] = useState(emptyRx())
  const [pdvAddRxOE, setPdvAddRxOE] = useState(emptyRx())
  const [pdvAddRxLensType, setPdvAddRxLensType] = useState('')
  const [pdvAddRxExamDate, setPdvAddRxExamDate] = useState(TODAY)
  const [pdvAddRxExpiresAt, setPdvAddRxExpiresAt] = useState(fmtDate(addYears(TODAY_D, 1)))
  const [pdvGenerateOs, setPdvGenerateOs] = useState(true)
  const [pdvOsPaid, setPdvOsPaid] = useState(true)

  // ── Stock: new product modal ──
  const [newProductOpen, setNewProductOpen] = useState(false)
  const [newProductForm, setNewProductForm] = useState({
    name: '', category: 'Armações', min: '', costPrice: '', salePrice: '',
    commissionPct: '', supplier: '',
  })

  // ── Stock: entry NF (batch purchase entry) ──
  const [stockEntryOpen, setStockEntryOpen] = useState(false)
  const [stockEntryNF, setStockEntryNF] = useState('')
  const [stockEntrySupplier, setStockEntrySupplier] = useState('')
  const [stockEntryItems, setStockEntryItems] = useState<{ stockItemId: number; qty: string; costPrice: string }[]>([])

  // ── Collaborators ──
  const [newCollabOpen, setNewCollabOpen] = useState(false)
  const [newCollabForm, setNewCollabForm] = useState({
    name: '', role: 'vendedor' as Collaborator['role'], phone: '', email: '', commissionPct: '',
  })
  const [editCollabId, setEditCollabId] = useState<number | null>(null)

  useEffect(() => {
    if (!systemMessage) return
    const t = setTimeout(() => setSystemMessage(''), 4500)
    return () => clearTimeout(t)
  }, [systemMessage])

  useEffect(() => {
    if (orders.length === 0) return
    const maxOrder = Math.max(
      ...orders
        .map((o) => Number(o.id.replace('OS-', '')))
        .filter((n) => Number.isFinite(n)),
    )
    if (Number.isFinite(maxOrder) && maxOrder + 1 > _oid) _oid = maxOrder + 1
  }, [orders])

  useEffect(() => {
    writePersistedState({
      patients,
      stock,
      prescriptions,
      orders,
      sales,
      stockMovements,
      dismissedNotifs: Array.from(dismissedNotifs),
      collaborators,
    })
  }, [patients, stock, prescriptions, orders, sales, stockMovements, dismissedNotifs, collaborators])

  // Helpers
  const getPatient = (id: number) => patients.find(p => p.id === id)
  const getPatientRxs = (id: number) => prescriptions.filter(r => r.patientId === id)
  const getPatientOrders = (id: number) => orders.filter(o => o.patientId === id)
  const getPatientSales = (id: number) => sales.filter(s => s.patientId === id)
  const openWhatsAppForPatient = (patient: Patient) => {
    const phoneDigits = patient.phone.replace(/\D/g, '')
    if (phoneDigits.length < 10) {
      setSystemMessage(`Telefone inválido para ${patient.name}.`)
      return false
    }
    window.open(`https://wa.me/55${phoneDigits}`, '_blank', 'noopener,noreferrer')
    return true
  }

  // ── Add patient ──
  const addPatient = (form: { name: string; cpf: string; phone: string; birthDate: string; parentId?: number }): Patient => {
    const p: Patient = {
      id: Date.now(), name: form.name, cpf: form.cpf || '---', phone: form.phone || '---',
      birthDate: form.birthDate || '', createdAt: TODAY,
      ...(form.parentId ? { parentId: form.parentId } : {}),
    }
    setPatients(prev => [p, ...prev])
    setNewPatientForm({ name: '', cpf: '', phone: '', birthDate: '' })
    setNewPatientOpen(false)
    return p
  }

  // ── Save prescription ──
  const saveNewPrescription = () => {
    if (!newRxPatientId) return
    const rx: Prescription = {
      id: Date.now(), patientId: newRxPatientId, rxOD: newRxOD, rxOE: newRxOE,
      examDate: newRxExamDate, expiresAt: newRxExpiresAt, lensType: newRxLensType || 'Simples',
    }
    setPrescriptions(prev => [...prev, rx])
    setNewRxOD(emptyRx()); setNewRxOE(emptyRx()); setNewRxLensType('')
    setNewRxExamDate(TODAY); setNewRxExpiresAt(fmtDate(addYears(TODAY_D, 1)))
    setNewRxOpen(false); setNewRxPatientId(null)
    setRxSaved(true); setTimeout(() => setRxSaved(false), 2000)
  }

  // ── Create service order (deduct stock) ──
  const createServiceOrder = () => {
    if (!newOsRxId || !newOsLensItemId || !newOsFrameItemId) return
    const lensId = parseInt(newOsLensItemId)
    const frameId = parseInt(newOsFrameItemId)
    const rx = prescriptions.find(r => r.id === newOsRxId)
    if (!rx) return
    const hasActiveOrderForRx = orders.some((o) => o.prescriptionId === rx.id && o.status !== 'delivered')
    if (hasActiveOrderForRx) {
      setSystemMessage('Esta receita já possui uma OS ativa.')
      return
    }
    const lensItem = stock.find(s => s.id === lensId)
    const frameItem = stock.find(s => s.id === frameId)
    if (!lensItem || !frameItem) return
    const expiry = parseDMY(rx.expiresAt)
    if (expiry && daysBetween(TODAY_D, expiry) <= 0) {
      setSystemMessage('Não é possível abrir OS para receita vencida.')
      return
    }
    const qtyNeeded = Number.parseInt(newOsQty, 10)
    if (!Number.isFinite(qtyNeeded) || qtyNeeded <= 0) return
    if (lensItem.qty < qtyNeeded) return
    if (frameItem.qty < 1) return

    // Deduct lens + frame from stock
    setStock(prev => prev.map(s => {
      if (s.id === lensId) return { ...s, qty: s.qty - qtyNeeded }
      if (s.id === frameId) return { ...s, qty: s.qty - 1 }
      return s
    }))

    const os: ServiceOrder = {
      id: nextOS(), prescriptionId: rx.id, patientId: rx.patientId, status: 'production',
      frameItemId: frameId, lensItemId: lensId, lensQtyUsed: qtyNeeded, createdAt: TODAY,
      productionStartedAt: TODAY, readyAt: null, deliveredAt: null, paid: false,
    }
    setOrders(prev => [...prev, os])
    setStockMovements(prev => [
      ...prev,
      { id: Date.now(), stockItemId: lensId, qty: qtyNeeded, type: 'out', date: TODAY, timestamp: NOW_TIME, reason: 'service_order', performedBy: 'Dra. Eliza Silva', notes: `OS ${os.id}`, orderId: os.id, prescriptionId: rx.id },
      { id: Date.now() + 1, stockItemId: frameId, qty: 1, type: 'out', date: TODAY, timestamp: NOW_TIME, reason: 'service_order', performedBy: 'Dra. Eliza Silva', notes: `OS ${os.id}`, orderId: os.id, prescriptionId: rx.id },
    ])
    setNewOsOpen(false); setNewOsRxId(null); setNewOsLensItemId(''); setNewOsFrameItemId(''); setNewOsQty('2')
  }

  // ── Advance order status ──
  const advanceOrder = (id: string) => {
    setOrders(prev => prev.map(o => {
      if (o.id !== id) return o
      if (o.status === 'production') return { ...o, status: 'ready' as const, readyAt: TODAY }
      if (o.status === 'ready') {
        const hasSale = sales.some((s) => s.orderId === o.id)
        if (!hasSale) {
          setSystemMessage('Vincule uma venda no PDV antes de marcar como entregue.')
          return o
        }
        return { ...o, status: 'delivered' as const, deliveredAt: TODAY }
      }
      return o
    }))
  }

  // ── Cart + PDV ──
  const addToCart = (name: string, price: number, stockItemId: number) => {
    setCart(prev => {
      const item = stock.find(s => s.id === stockItemId)
      if (!item || item.qty <= 0) return prev
      const existing = prev.find(c => c.stockItemId === stockItemId)
      if (existing) {
        if (existing.qty >= item.qty) return prev
        return prev.map(c => c.stockItemId === stockItemId ? { ...c, qty: c.qty + 1 } : c)
      }
      return [...prev, { id: Date.now(), stockItemId, name, price, qty: 1 }]
    })
  }
  const removeFromCart = (id: number) => setCart(prev => prev.filter(c => c.id !== id))
  const removeGlassesFromCart = (id: number) => setGlassesCart(prev => prev.filter(c => c.id !== id))
  const clearFullCart = () => {
    setCart([]); setGlassesCart([])
    setSaleLinkedOrderId(null); setSalePatientId(null)
  }
  const accessoriesTotal = cart.reduce((s, c) => s + c.price * c.qty, 0)
  const glassesTotal = glassesCart.reduce((s, g) => s + g.framePrice + g.lensPrice, 0)
  const cartTotal = accessoriesTotal + glassesTotal

  // ── PDV: add glasses item ──
  const addGlassesToCart = () => {
    if (!pdvGlassesBeneficiary || !pdvGlassesFrame) return
    const frameId = parseInt(pdvGlassesFrame)
    const frameItem = stock.find(s => s.id === frameId)
    if (!frameItem || frameItem.qty < 1) return

    let lensName = 'Sem lente'
    let lensPrice = 0
    let lensId = 0
    if (pdvGlassesLens) {
      const lens = LENS_CATALOG.find(l => l.id === parseInt(pdvGlassesLens))
      if (lens) { lensName = lens.name; lensPrice = lens.price; lensId = lens.id }
    }

    const beneficiary = patients.find(p => p.id === pdvGlassesBeneficiary)
    const item: CartGlassesItem = {
      id: Date.now(),
      beneficiaryId: pdvGlassesBeneficiary,
      beneficiaryName: beneficiary?.name ?? '—',
      frameStockItemId: frameId,
      frameName: frameItem.name,
      framePrice: frameItem.price,
      lensId,
      lensName,
      lensPrice,
      prescriptionId: pdvGlassesIsReady ? null : pdvGlassesRxId,
      isReadyMade: pdvGlassesIsReady,
    }
    setGlassesCart(prev => [...prev, item])
    setPdvAddGlassesOpen(false)
    setPdvGlassesBeneficiary(null); setPdvGlassesFrame(''); setPdvGlassesLens('')
    setPdvGlassesRxId(null); setPdvGlassesIsReady(false)
  }

  // ── PDV: save prescription inline ──
  const savePdvPrescription = () => {
    if (!pdvGlassesBeneficiary) return
    const rx: Prescription = {
      id: Date.now(), patientId: pdvGlassesBeneficiary, rxOD: pdvAddRxOD, rxOE: pdvAddRxOE,
      examDate: pdvAddRxExamDate, expiresAt: pdvAddRxExpiresAt, lensType: pdvAddRxLensType || 'Simples',
    }
    setPrescriptions(prev => [...prev, rx])
    setPdvGlassesRxId(rx.id)
    setPdvAddRxOD(emptyRx()); setPdvAddRxOE(emptyRx()); setPdvAddRxLensType('')
    setPdvAddRxExamDate(TODAY); setPdvAddRxExpiresAt(fmtDate(addYears(TODAY_D, 1)))
    setPdvAddRxOpen(false)
    setSystemMessage('Prescrição salva!')
  }

  // ── PDV: create client inline ──
  const createPdvClient = () => {
    if (!pdvNewClientForm.name.trim()) return
    const p = addPatient(pdvNewClientForm)
    setPdvClientId(p.id)
    setPdvNewClientForm({ name: '', cpf: '', phone: '', birthDate: '' })
    setPdvNewClientOpen(false)
  }

  // ── PDV: create dependent inline ──
  const createPdvDependent = () => {
    if (!pdvNewDependentForm.name.trim() || !pdvClientId) return
    const p = addPatient({ ...pdvNewDependentForm, parentId: pdvClientId })
    setPdvNewDependentForm({ name: '', cpf: '', phone: '', birthDate: '' })
    setPdvNewDependentOpen(false)
    setSystemMessage(`Dependente ${p.name} cadastrado!`)
  }

  // ── Get dependents for a client ──
  const getDependents = (clientId: number) => patients.filter(p => p.parentId === clientId)

  // ── Finalize sale (new flow with glasses + OS generation) ──
  const finalizeSale = (paymentMethod: string): boolean => {
    const hasItems = cart.length > 0 || glassesCart.length > 0
    if (!hasItems) return false
    const patientId = pdvClientId ?? salePatientId ?? null
    if (!patientId) return false

    // Validate stock for accessories
    const hasInsufficient = cart.some(c => {
      const item = stock.find(s => s.id === c.stockItemId)
      return !item || item.qty < c.qty
    })
    if (hasInsufficient) return false

    // Validate stock for glasses frames
    const frameInsufficient = glassesCart.some(g => {
      const item = stock.find(s => s.id === g.frameStockItemId)
      return !item || item.qty < 1
    })
    if (frameInsufficient) return false

    // Build sale items list
    const saleItems = [
      ...cart.map(c => ({ name: c.name, price: c.price, qty: c.qty })),
      ...glassesCart.map(g => ({ name: `${g.frameName} + ${g.lensName} (${g.beneficiaryName})`, price: g.framePrice + g.lensPrice, qty: 1 })),
    ]

    // Deduct stock for accessories
    setStock(prev => {
      const updated = [...prev]
      for (const c of cart) {
        const idx = updated.findIndex(s => s.id === c.stockItemId)
        if (idx >= 0) updated[idx] = { ...updated[idx], qty: updated[idx].qty - c.qty }
      }
      // Deduct frames for glasses
      for (const g of glassesCart) {
        const idx = updated.findIndex(s => s.id === g.frameStockItemId)
        if (idx >= 0) updated[idx] = { ...updated[idx], qty: updated[idx].qty - 1 }
      }
      return updated
    })

    // Stock movements for accessories
    const newMovements: StockMovement[] = cart.map((c) => ({
      id: Date.now() + c.id,
      stockItemId: c.stockItemId,
      qty: c.qty,
      type: 'out' as const,
      date: TODAY,
      timestamp: NOW_TIME,
      reason: 'sale' as const,
      performedBy: 'Dra. Eliza Silva',
      notes: `Venda PDV`,
    }))

    const saleId = Date.now()

    // Generate OS for each glasses item if requested
    const generatedOrders: ServiceOrder[] = []
    if (pdvGenerateOs) {
      for (const g of glassesCart) {
        const osId = nextOS()
        const os: ServiceOrder = {
          id: osId,
          prescriptionId: g.prescriptionId ?? 0,
          patientId: g.beneficiaryId,
          status: 'production',
          frameItemId: g.frameStockItemId,
          lensItemId: null,
          lensQtyUsed: 0,
          createdAt: TODAY,
          productionStartedAt: TODAY,
          readyAt: null,
          deliveredAt: null,
          saleId: pdvOsPaid ? saleId : undefined,
          paid: pdvOsPaid,
        }
        generatedOrders.push(os)
        // Stock movements for frame deducted via OS
        newMovements.push({
          id: Date.now() + g.id,
          stockItemId: g.frameStockItemId,
          qty: 1,
          type: 'out' as const,
          date: TODAY,
          timestamp: NOW_TIME,
          reason: 'service_order' as const,
          performedBy: 'Dra. Eliza Silva',
          notes: `OS ${osId}`,
          orderId: osId,
          prescriptionId: g.prescriptionId ?? undefined,
        })
      }
    } else {
      // Still deduct frames even without OS
      for (const g of glassesCart) {
        newMovements.push({
          id: Date.now() + g.id + 1,
          stockItemId: g.frameStockItemId,
          qty: 1,
          type: 'out' as const,
          date: TODAY,
          timestamp: NOW_TIME,
          reason: 'sale' as const,
          performedBy: 'Dra. Eliza Silva',
          notes: 'Venda PDV (óculos)',
        })
      }
    }

    if (generatedOrders.length > 0) {
      setOrders(prev => [...prev, ...generatedOrders])
    }
    setStockMovements(prev => [...prev, ...newMovements])

    const sale: Sale = {
      id: saleId, patientId, orderId: generatedOrders[0]?.id ?? saleLinkedOrderId,
      items: saleItems,
      total: cartTotal, paymentMethod, date: TODAY,
    }
    setSales(prev => [...prev, sale])
    setCart([]); setGlassesCart([])
    setSaleLinkedOrderId(null); setSalePatientId(null)
    setPdvClientId(null); setPdvGenerateOs(true); setPdvOsPaid(true)
    return true
  }

  const NOW_TIME = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  // ── Stock adjust / physical count ──
  const adjustStock = () => {
    if (stockEditId === null) return
    const newQty = parseInt(stockEditQty, 10)
    if (isNaN(newQty) || newQty < 0) return
    if (!stockEditReason.trim() && stockEditType === 'adjust') return
    const current = stock.find((s) => s.id === stockEditId)
    if (!current) return
    setStock(prev => prev.map(s => s.id === stockEditId ? { ...s, qty: newQty } : s))
    if (current.qty !== newQty) {
      const delta = newQty - current.qty
      setStockMovements((prev) => [
        ...prev,
        {
          id: Date.now(),
          stockItemId: stockEditId,
          qty: Math.abs(delta),
          type: delta >= 0 ? 'in' : 'out',
          date: TODAY,
          timestamp: NOW_TIME,
          reason: stockEditType === 'count' ? 'physical_count' : 'manual_adjustment',
          performedBy: 'Dra. Eliza Silva',
          notes: stockEditType === 'count'
            ? `Contagem física: ${current.qty} → ${newQty}${stockEditReason.trim() ? ' · ' + stockEditReason.trim() : ''}`
            : stockEditReason.trim(),
          previousQty: current.qty,
          newQty: newQty,
        },
      ])
    }
    setStockEditId(null); setStockEditQty(''); setStockEditReason(''); setStockEditType('adjust')
  }

  // ── Add new product to catalog ──
  const addNewProduct = () => {
    const { name, category, costPrice, salePrice, commissionPct, min, supplier } = newProductForm
    if (!name.trim() || !salePrice) return
    const priceN = parseFloat(salePrice); const costN = parseFloat(costPrice) || 0
    const commN = parseFloat(commissionPct) || 0; const minN = parseInt(min, 10) || 3
    if (isNaN(priceN) || priceN <= 0) return
    const newItem: StockItem = { id: Date.now(), name: name.trim(), category, qty: 0, min: minN, price: priceN, costPrice: costN, commissionPct: commN, supplier: supplier.trim() }
    setStock(prev => [...prev, newItem])
    setNewProductForm({ name: '', category: 'Armações', min: '', costPrice: '', salePrice: '', commissionPct: '', supplier: '' })
    setNewProductOpen(false)
    setSystemMessage('Produto cadastrado! Use "Entrada NF" para dar entrada no estoque.')
  }

  // ── Stock entry (batch purchase with NF) ──
  const openStockEntry = (preSelectId?: number) => {
    setStockEntryNF(''); setStockEntrySupplier('')
    if (preSelectId) {
      const item = stock.find(s => s.id === preSelectId)
      setStockEntryItems([{ stockItemId: preSelectId, qty: '', costPrice: item?.costPrice ? String(item.costPrice) : '' }])
      if (item?.supplier) setStockEntrySupplier(item.supplier)
    } else {
      setStockEntryItems([])
    }
    setStockEntryOpen(true)
  }
  const addStockEntryItem = () => setStockEntryItems(prev => [...prev, { stockItemId: 0, qty: '', costPrice: '' }])
  const removeStockEntryItem = (idx: number) => setStockEntryItems(prev => prev.filter((_, i) => i !== idx))
  const updateStockEntryItem = (idx: number, field: string, value: string | number) => setStockEntryItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item))
  const submitStockEntry = () => {
    const validItems = stockEntryItems.filter(ei => ei.stockItemId > 0 && parseInt(ei.qty, 10) > 0)
    if (validItems.length === 0) return
    const nf = stockEntryNF.trim(); const supplier = stockEntrySupplier.trim()
    const newMovements: StockMovement[] = []
    setStock(prev => prev.map(s => {
      const entry = validItems.find(ei => ei.stockItemId === s.id)
      if (!entry) return s
      const qtyAdd = parseInt(entry.qty, 10)
      const costN = parseFloat(entry.costPrice) || s.costPrice
      newMovements.push({ id: Date.now() + s.id, stockItemId: s.id, qty: qtyAdd, type: 'in', date: TODAY, timestamp: NOW_TIME, reason: 'purchase', performedBy: 'Dra. Eliza Silva', notes: `Entrada NF${nf ? ': ' + nf : ''}${supplier ? ' · ' + supplier : ''}`, invoiceNumber: nf || undefined, previousQty: s.qty, newQty: s.qty + qtyAdd })
      return { ...s, qty: s.qty + qtyAdd, costPrice: costN, supplier: supplier || s.supplier }
    }))
    setStockMovements(prev => [...prev, ...newMovements])
    setStockEntryOpen(false); setStockEntryItems([]); setStockEntryNF(''); setStockEntrySupplier('')
    setSystemMessage(`Entrada registrada! ${validItems.length} produto(s) atualizados${nf ? ` · NF: ${nf}` : ''}`)
  }

  // ── Collaborator CRUD ──
  const saveCollaborator = () => {
    const { name, role, phone, email, commissionPct } = newCollabForm
    if (!name.trim()) return
    const commN = parseFloat(commissionPct) || 0
    if (editCollabId !== null) {
      setCollaborators(prev => prev.map(c => c.id === editCollabId ? { ...c, name: name.trim(), role, phone: phone.trim(), email: email.trim(), commissionPct: commN } : c))
      setEditCollabId(null)
    } else {
      setCollaborators(prev => [...prev, { id: Date.now(), name: name.trim(), role, phone: phone.trim(), email: email.trim(), commissionPct: commN, active: true, createdAt: TODAY }])
    }
    setNewCollabForm({ name: '', role: 'vendedor', phone: '', email: '', commissionPct: '' })
    setNewCollabOpen(false)
    setSystemMessage(editCollabId !== null ? 'Colaborador atualizado!' : 'Colaborador adicionado!')
  }
  const toggleCollaboratorActive = (id: number) => setCollaborators(prev => prev.map(c => c.id === id ? { ...c, active: !c.active } : c))
  const startEditCollaborator = (c: Collaborator) => {
    setNewCollabForm({ name: c.name, role: c.role, phone: c.phone, email: c.email, commissionPct: String(c.commissionPct) })
    setEditCollabId(c.id)
    setNewCollabOpen(true)
  }

  // ── Campaign targets ──
  const campaignTargets = useMemo(() => {
    const targets: { patient: Patient; reason: string }[] = []
    if (campaignFilter.type === 'birthday') {
      for (const p of patients) {
        const nextBd = nextBirthdayDate(p.birthDate, TODAY_D)
        if (!nextBd) continue
        const days = daysBetween(TODAY_D, nextBd)
        if (days >= 0 && days <= campaignFilter.daysAhead) {
          targets.push({ patient: p, reason: days === 0 ? 'Hoje!' : `em ${days} dia(s)` })
        }
      }
    } else {
      for (const rx of prescriptions) {
        const exp = parseDMY(rx.expiresAt)
        if (!exp) continue
        const days = daysBetween(TODAY_D, exp)
        if (days > 0 && days <= campaignFilter.daysAhead) {
          const p = patients.find((x) => x.id === rx.patientId)
          if (p) targets.push({ patient: p, reason: `Receita vence em ${days} dia(s)` })
        }
      }
    }
    return targets
  }, [campaignFilter, patients, prescriptions])

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <div className="flex min-h-screen w-full bg-[#f6f8fb]">
      {/* ── Sidebar ── */}
      <aside className="hidden w-[68px] shrink-0 flex-col items-center border-r border-slate-200/50 bg-white py-5 lg:flex">
        <div className="mb-8"><ArgusLogo size={30} /></div>
        <nav className="flex flex-1 flex-col items-center gap-1">
          {NAV.map(item => {
            const Icon = item.icon; const active = page === item.key
            return (
              <button key={item.key} onClick={() => setPage(item.key)} aria-label={item.label}
                className={`group relative flex h-10 w-10 items-center justify-center rounded-xl transition-all duration-200 ${active ? 'bg-brand-500 text-white shadow-sm shadow-brand-500/25' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'}`}>
                <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2 : 1.7} />
                <span className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">{item.label}</span>
              </button>
            )
          })}
        </nav>
      </aside>

      {/* ── Mobile nav (paginated toolbar) ── */}
      <MobileNav page={page} onChangePage={setPage} />

      {/* ── Main ── */}
      <div className="flex flex-1 flex-col overflow-x-hidden pb-20 lg:pb-0">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-slate-200/50 bg-white/80 px-3 py-3 backdrop-blur-md sm:gap-4 sm:px-6">
          <div className="mr-1 lg:hidden"><ArgusLogo size={24} /></div>
          <SmartSearch patients={patients} orders={orders} onSelectPatient={p => setSelectedPatientId(p.id)} onSelectOrder={o => setOrderDetailId(o.id)} />
          <div className="ml-auto flex items-center gap-1 sm:gap-2 shrink-0">
            <div className="relative">
              <button onClick={() => setNotifOpen(p => !p)} className="relative rounded-xl p-2 text-slate-400 transition hover:bg-slate-50 hover:text-slate-600">
                <Bell className="h-[18px] w-[18px]" />
                {unreadCount > 0 && <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand-500 text-[9px] font-bold text-white">{unreadCount}</span>}
              </button>
              <NotificationDropdown notifications={notifications} open={notifOpen} onClose={() => setNotifOpen(false)} onMarkRead={markRead} onMarkAllRead={markAllRead} />
            </div>
            <div className="flex items-center gap-2.5 rounded-xl px-2 py-1.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white">ES</div>
              <div className="hidden sm:block">
                <p className="text-[13px] font-semibold leading-tight text-slate-800">Dra. Eliza Silva</p>
                <p className="text-[11px] leading-tight text-slate-400">Gestora</p>
              </div>
              <ChevronDown className="hidden h-3.5 w-3.5 text-slate-300 sm:block" />
            </div>
          </div>
        </header>

        {/* Page */}
        <main className="flex-1 px-4 py-5 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-[1360px] animate-rise space-y-5">
            {systemMessage && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-700">
                {systemMessage}
              </div>
            )}
            {page === 'overview' && <OverviewPage patients={patients} prescriptions={prescriptions} orders={orders} stock={stock} sales={sales}
              suggestions={suggestions} onAdvanceOrder={advanceOrder}
              onOpenCampaign={() => setCampaignOpen(true)} onGoToPage={setPage} />}
            {page === 'pdv' && <PdvPage stock={stock} patients={patients}
              cart={cart} glassesCart={glassesCart} cartTotal={cartTotal}
              onAddToCart={addToCart} onRemoveFromCart={removeFromCart} onRemoveGlasses={removeGlassesFromCart}
              onClearCart={clearFullCart} onFinalizeSale={finalizeSale}
              pdvClientId={pdvClientId} onSelectClient={setPdvClientId}
              onOpenNewClient={() => setPdvNewClientOpen(true)}
              onOpenNewDependent={() => setPdvNewDependentOpen(true)}
              onOpenAddGlasses={() => setPdvAddGlassesOpen(true)}
              getDependents={getDependents}
              generateOs={pdvGenerateOs} onToggleOs={setPdvGenerateOs}
              osPaid={pdvOsPaid} onToggleOsPaid={setPdvOsPaid} />}
            {page === 'patients' && <PatientsPage patients={patients} prescriptions={prescriptions} orders={orders} sales={sales}
              onSelectPatient={id => setSelectedPatientId(id)} onNewPatient={() => setNewPatientOpen(true)}
              onNewRx={(pid) => { setNewRxPatientId(pid); setNewRxOpen(true) }} />}
            {page === 'lab' && <LabPage orders={orders} patients={patients} prescriptions={prescriptions} stock={stock} sales={sales}
              onAdvanceOrder={advanceOrder} onNewOS={(rxId) => { setNewOsRxId(rxId); setNewOsOpen(true) }}
              onViewOrder={id => setOrderDetailId(id)} />}
            {page === 'stock' && <StockPage stock={stock} stockMovements={stockMovements} suggestions={suggestions}
              onAdjustStock={(id, qty) => { setStockEditId(id); setStockEditQty(String(qty)); setStockEditReason(''); setStockEditType('adjust') }}
              onPhysicalCount={(id, qty) => { setStockEditId(id); setStockEditQty(String(qty)); setStockEditReason(''); setStockEditType('count') }}
              onNewProduct={() => setNewProductOpen(true)} onStockEntry={openStockEntry}
              onViewLog={id => setStockLogItemId(id)} />}
            {page === 'reports' && <ReportsPage patients={patients} prescriptions={prescriptions} orders={orders} sales={sales} stock={stock} />}
            {page === 'collaborators' && <CollaboratorsPage collaborators={collaborators} onNew={() => { setEditCollabId(null); setNewCollabForm({ name: '', role: 'vendedor', phone: '', email: '', commissionPct: '' }); setNewCollabOpen(true) }} onEdit={startEditCollaborator} onToggleActive={toggleCollaboratorActive} />}
          </div>
        </main>
      </div>

      {/* ════════════════ MODALS ════════════════ */}

      {/* Patient detail with full history */}
      <Modal open={selectedPatientId !== null} onClose={() => setSelectedPatientId(null)} title="Ficha do paciente" wide>
        {selectedPatientId !== null && (() => {
          const p = getPatient(selectedPatientId)
          if (!p) return <p className="text-sm text-slate-400">Paciente não encontrado</p>
          const rxs = getPatientRxs(p.id)
          const ords = getPatientOrders(p.id)
          const sls = getPatientSales(p.id)
          const deps = getDependents(p.id)
          const parent = p.parentId ? getPatient(p.parentId) : null
          return (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600"><UserRound className="h-6 w-6" /></div>
                <div>
                  <p className="font-semibold text-slate-900">{p.name}</p>
                  <p className="text-sm text-slate-400">{p.cpf} · {p.phone}</p>
                  {parent && <p className="text-xs text-brand-500">Dependente de: {parent.name}</p>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <InfoBox label="Aniversário" value={p.birthDate || '—'} />
                <InfoBox label="Cadastro" value={p.createdAt} />
                <InfoBox label="Receitas" value={String(rxs.length)} />
                <InfoBox label="Compras" value={String(sls.length)} />
              </div>

              {/* Dependents */}
              {deps.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-slate-700"><Users className="mr-1 inline h-4 w-4" /> Dependentes / Familiares</h4>
                  <div className="flex flex-wrap gap-2">
                    {deps.map(d => (
                      <button key={d.id} onClick={() => setSelectedPatientId(d.id)}
                        className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 transition hover:border-brand-300 hover:text-brand-600">
                        <UserRound className="h-3 w-3" /> {d.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Prescriptions */}
              {rxs.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-slate-700">Prescrições</h4>
                  {rxs.map(rx => {
                    const exp = parseDMY(rx.expiresAt)
                    const daysLeft = exp ? daysBetween(TODAY_D, exp) : 999
                    return (
                      <div key={rx.id} className="mb-2 rounded-xl border border-slate-100 bg-slate-50 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-sm font-semibold text-slate-800">Exame: {rx.examDate} · {rx.lensType}</p>
                          <Badge color={daysLeft <= 30 ? (daysLeft <= 0 ? 'rose' : 'amber') : 'emerald'}>
                            {daysLeft <= 0 ? 'Vencida' : `Vence ${rx.expiresAt}`}
                          </Badge>
                        </div>
                        <RxDisplay label="OD" rx={rx.rxOD} />
                        <div className="mt-2"><RxDisplay label="OE" rx={rx.rxOE} /></div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Orders timeline */}
              {ords.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-slate-700">Ordens de serviço</h4>
                  {ords.map(o => (
                    <div key={o.id} className="mb-2 flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{o.id}</p>
                        <p className="text-xs text-slate-400">
                          Criada: {o.createdAt}
                          {o.productionStartedAt && ` · Produção: ${o.productionStartedAt}`}
                          {o.readyAt && ` · Pronto: ${o.readyAt}`}
                          {o.deliveredAt && ` · Entregue: ${o.deliveredAt}`}
                        </p>
                      </div>
                      <Badge color={o.status === 'delivered' ? 'emerald' : o.status === 'ready' ? 'blue' : 'amber'}>{o.status}</Badge>
                    </div>
                  ))}
                </div>
              )}

              {/* Sales */}
              {sls.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-slate-700">Histórico de compras</h4>
                  {sls.map(s => (
                    <div key={s.id} className="mb-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-slate-800">R$ {s.total.toFixed(2)} — {s.paymentMethod}</p>
                        <p className="text-xs text-slate-400">{s.date}{s.orderId ? ` · ${s.orderId}` : ''}</p>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">{s.items.map(i => `${i.qty}× ${i.name}`).join(', ')}</p>
                    </div>
                  ))}
                </div>
              )}

              <button onClick={() => { setNewRxPatientId(p.id); setNewRxOpen(true); setSelectedPatientId(null) }}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600">
                <ClipboardPlus className="h-4 w-4" /> Nova prescrição
              </button>
            </div>
          )
        })()}
      </Modal>

      {/* New patient */}
      <Modal open={newPatientOpen} onClose={() => setNewPatientOpen(false)} title="Novo paciente">
        <div className="space-y-3">
          <FormField label="Nome completo" value={newPatientForm.name} onChange={v => setNewPatientForm(p => ({ ...p, name: v }))} placeholder="Ex: João Silva" />
          <FormField label="CPF" value={newPatientForm.cpf} onChange={v => setNewPatientForm(p => ({ ...p, cpf: v }))} placeholder="000.000.000-00" />
          <FormField label="Telefone" value={newPatientForm.phone} onChange={v => setNewPatientForm(p => ({ ...p, phone: v }))} placeholder="(00) 00000-0000" />
          <FormField label="Data de nascimento" value={newPatientForm.birthDate} onChange={v => setNewPatientForm(p => ({ ...p, birthDate: v }))} placeholder="dd/mm/aaaa" />
          <button onClick={() => addPatient(newPatientForm)} disabled={!newPatientForm.name.trim()}
            className="mt-2 w-full rounded-xl bg-brand-500 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-40">
            Cadastrar paciente
          </button>
        </div>
      </Modal>

      {/* New prescription */}
      <Modal open={newRxOpen} onClose={() => { setNewRxOpen(false); setNewRxPatientId(null) }} title="Nova prescrição" wide>
        <div className="space-y-3">
          {newRxPatientId ? (
            <p className="text-sm text-slate-500">Paciente: <strong className="text-slate-800">{getPatient(newRxPatientId)?.name}</strong></p>
          ) : (
            <SelectField label="Paciente" value={String(newRxPatientId ?? '')} onChange={v => setNewRxPatientId(parseInt(v))}
              options={[{ value: '', label: 'Selecione…' }, ...patients.map(p => ({ value: String(p.id), label: p.name }))]} />
          )}
          <FormField label="Tipo de lente" value={newRxLensType} onChange={setNewRxLensType} placeholder="Ex: Multifocal, Blue Light…" />
          <RxInputRow label="Olho direito (OD)" rx={newRxOD} onChange={setNewRxOD} />
          <RxInputRow label="Olho esquerdo (OE)" rx={newRxOE} onChange={setNewRxOE} />
          <div className="grid gap-2 sm:grid-cols-2">
            <FormField label="Data do exame" value={newRxExamDate} onChange={v => {
              setNewRxExamDate(v)
              const parsed = parseDMY(v)
              if (parsed) setNewRxExpiresAt(fmtDate(addYears(parsed, 1)))
            }} placeholder="dd/mm/aaaa" />
            <FormField label="Validade da receita" value={newRxExpiresAt} onChange={setNewRxExpiresAt} placeholder="dd/mm/aaaa" />
          </div>
          <p className="text-[11px] text-slate-400">A validade é recalculada automaticamente ao alterar a data do exame (padrão: 1 ano). Você pode ajustar manualmente.</p>
          <button onClick={saveNewPrescription} disabled={!newRxPatientId}
            className="mt-2 w-full rounded-xl bg-brand-500 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-40">
            {rxSaved ? <><Check className="mr-2 inline h-4 w-4" /> Salvo!</> : 'Salvar prescrição'}
          </button>
        </div>
      </Modal>

      {/* New service order */}
      <Modal open={newOsOpen} onClose={() => { setNewOsOpen(false); setNewOsRxId(null); setNewOsLensItemId(''); setNewOsFrameItemId(''); setNewOsQty('2') }} title="Nova ordem de serviço">
        <div className="space-y-3">
          {newOsRxId ? (() => {
            const rx = prescriptions.find(r => r.id === newOsRxId)
            const pat = rx ? getPatient(rx.patientId) : null
            return (
              <>
                <p className="text-sm text-slate-500">Paciente: <strong className="text-slate-800">{pat?.name}</strong></p>
                <p className="text-sm text-slate-500">Receita: <strong className="text-slate-800">{rx?.lensType} — Exame {rx?.examDate}</strong></p>
              </>
            )
          })() : (
            <SelectField label="Prescrição" value={String(newOsRxId ?? '')} onChange={v => setNewOsRxId(parseInt(v))}
              options={[{ value: '', label: 'Selecione…' }, ...prescriptions.map(r => {
                const p = getPatient(r.patientId)
                return { value: String(r.id), label: `${p?.name ?? '?'} — ${r.lensType} (${r.examDate})` }
              })]} />
          )}
          <SelectField label="Armação do estoque" value={newOsFrameItemId} onChange={setNewOsFrameItemId}
            options={[{ value: '', label: 'Selecione a armação…' }, ...stock.filter(s => s.category === 'Armações' && s.qty > 0).map(s => ({
              value: String(s.id), label: `${s.name} — ${s.qty} un disponíveis`,
            }))]} />
          <SelectField label="Lente do estoque" value={newOsLensItemId} onChange={setNewOsLensItemId}
            options={[{ value: '', label: 'Selecione a lente…' }, ...stock.filter(s => (s.category === 'Lentes' || s.category === 'Tratamentos') && s.qty > 0).map(s => ({
              value: String(s.id), label: `${s.name} — ${s.qty} un disponíveis`,
            }))]} />
          <SelectField
            label="Quantidade de lentes"
            value={newOsQty}
            onChange={setNewOsQty}
            options={[{ value: '1', label: '1 unidade (monocular)' }, { value: '2', label: '2 unidades (par)' }]}
          />
          {newOsRxId && (() => {
            const rx = prescriptions.find((r) => r.id === newOsRxId)
            if (!rx) return null
            const exp = parseDMY(rx.expiresAt)
            const isExpired = exp ? daysBetween(TODAY_D, exp) <= 0 : false
            if (!isExpired) return null
            return <p className="text-sm font-medium text-rose-600">⚠ Receita vencida. Não é possível abrir OS.</p>
          })()}
          {newOsFrameItemId && (() => {
            const item = stock.find(s => s.id === parseInt(newOsFrameItemId))
            if (item && item.qty < 1) return <p className="text-sm font-medium text-rose-600">⚠ Armação sem estoque</p>
            return null
          })()}
          {newOsLensItemId && (() => {
            const requestedQty = Number.parseInt(newOsQty, 10)
            const item = stock.find(s => s.id === parseInt(newOsLensItemId))
            if (item && item.qty < requestedQty) return <p className="text-sm font-medium text-rose-600">⚠ Lente com estoque insuficiente ({item.qty} un)</p>
            return null
          })()}
          <button onClick={createServiceOrder}
            disabled={!newOsRxId || !newOsLensItemId || !newOsFrameItemId || (() => {
              const rx = prescriptions.find((r) => r.id === newOsRxId)
              const exp = rx ? parseDMY(rx.expiresAt) : null
              const isExpired = exp ? daysBetween(TODAY_D, exp) <= 0 : false
              const requestedQty = Number.parseInt(newOsQty, 10)
              const lensQty = stock.find(s => s.id === parseInt(newOsLensItemId))?.qty ?? 0
              const frameQty = stock.find(s => s.id === parseInt(newOsFrameItemId))?.qty ?? 0
              return isExpired || !Number.isFinite(requestedQty) || requestedQty <= 0 || lensQty < requestedQty || frameQty < 1
            })()}
            className="mt-2 w-full rounded-xl bg-brand-500 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-40">
            Criar OS e abater estoque
          </button>
        </div>
      </Modal>

      {/* Order detail */}
      <Modal open={orderDetailId !== null} onClose={() => setOrderDetailId(null)} title={`Detalhes — ${orderDetailId}`} wide>
        {orderDetailId && (() => {
          const o = orders.find(x => x.id === orderDetailId)
          if (!o) return null
          const rx = prescriptions.find(r => r.id === o.prescriptionId)
          const pat = getPatient(o.patientId)
          const frameItem = o.frameItemId ? stock.find(s => s.id === o.frameItemId) : null
          const lensItem = o.lensItemId ? stock.find(s => s.id === o.lensItemId) : null
          const linkedSales = sales.filter(s => s.orderId === o.id)
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <InfoBox label="Paciente" value={pat?.name ?? '—'} />
                <InfoBox label="Status" value={o.status} />
                <InfoBox label="Criada em" value={o.createdAt} />
                <InfoBox label="Armação" value={frameItem?.name ?? '—'} />
                <InfoBox label="Lente usada" value={`${lensItem?.name ?? '—'} (${o.lensQtyUsed} un)`} />
                {o.productionStartedAt && <InfoBox label="Produção" value={o.productionStartedAt} />}
                {o.readyAt && <InfoBox label="Pronto em" value={o.readyAt} />}
                {o.deliveredAt && <InfoBox label="Entregue em" value={o.deliveredAt} />}
              </div>
              {rx && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-slate-700">Prescrição ({rx.lensType})</h4>
                  <RxDisplay label="OD" rx={rx.rxOD} />
                  <div className="mt-2"><RxDisplay label="OE" rx={rx.rxOE} /></div>
                </div>
              )}
              {linkedSales.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-slate-700">Venda vinculada</h4>
                  {linkedSales.map(s => (
                    <div key={s.id} className="rounded-xl bg-slate-50 p-3">
                      <p className="text-sm font-medium text-slate-800">R$ {s.total.toFixed(2)} · {s.paymentMethod} · {s.date}</p>
                      <p className="text-xs text-slate-400">{s.items.map(i => `${i.qty}× ${i.name}`).join(', ')}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })()}
      </Modal>

      {/* Stock adjust / physical count */}
      <Modal open={stockEditId !== null} onClose={() => { setStockEditId(null); setStockEditReason(''); setStockEditType('adjust') }}
        title={stockEditType === 'count' ? 'Contagem física' : 'Ajuste manual de estoque'}>
        {stockEditId !== null && (() => {
          const item = stock.find(s => s.id === stockEditId)
          if (!item) return null
          const newQ = parseInt(stockEditQty, 10)
          const delta = !isNaN(newQ) ? newQ - item.qty : 0
          return (
            <div className="space-y-3">
              <p className="text-sm text-slate-500">Produto: <strong className="text-slate-800">{item.name}</strong></p>
              <div className="flex items-center gap-3 rounded-xl bg-slate-50 border border-slate-100 px-4 py-2.5">
                <div className="text-center">
                  <p className="text-[11px] font-semibold uppercase text-slate-400">Atual</p>
                  <p className="text-lg font-bold text-slate-800">{item.qty}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-300" />
                <div className="text-center">
                  <p className="text-[11px] font-semibold uppercase text-slate-400">{stockEditType === 'count' ? 'Contado' : 'Novo'}</p>
                  <p className={`text-lg font-bold ${!isNaN(newQ) && delta !== 0 ? (delta > 0 ? 'text-emerald-600' : 'text-rose-600') : 'text-slate-800'}`}>{stockEditQty || '—'}</p>
                </div>
                {!isNaN(newQ) && delta !== 0 && (
                  <div className={`ml-auto rounded-lg px-2.5 py-1 text-xs font-bold ${delta > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                    {delta > 0 ? '+' : ''}{delta}
                  </div>
                )}
              </div>
              <FormField label={stockEditType === 'count' ? 'Quantidade contada' : 'Nova quantidade'} value={stockEditQty} onChange={setStockEditQty} placeholder="0" type="number" />
              <FormField label={stockEditType === 'count' ? 'Observações (opcional)' : 'Motivo do ajuste (obrigatório)'} value={stockEditReason} onChange={setStockEditReason} placeholder={stockEditType === 'count' ? 'Ex: Contagem de inventário mensal' : 'Ex: Quebra, devolução, erro de contagem'} />
              {stockEditType === 'adjust' && (
                <p className="text-[11px] text-amber-600 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Ajustes manuais geram divergência com o saldo fiscal. Justifique.</p>
              )}
              <button onClick={adjustStock}
                disabled={stockEditQty === '' || (stockEditType === 'adjust' && !stockEditReason.trim())}
                className="mt-2 w-full rounded-xl bg-brand-500 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-40">
                {stockEditType === 'count' ? 'Registrar contagem' : 'Confirmar ajuste'}
              </button>
              <p className="text-[10px] text-slate-300 text-center">Registrado como: Dra. Eliza Silva · {TODAY}</p>
            </div>
          )
        })()}
      </Modal>

      {/* Movement log per product */}
      <Modal open={stockLogItemId !== null} onClose={() => setStockLogItemId(null)} title="Histórico de movimentações" wide>
        {stockLogItemId !== null && (() => {
          const item = stock.find(s => s.id === stockLogItemId)
          if (!item) return <p className="text-sm text-slate-400">Produto não encontrado</p>
          const movements = stockMovements.filter(m => m.stockItemId === stockLogItemId).sort((a, b) => b.id - a.id)
          const fiscalIn = movements.filter(m => m.type === 'in' && m.invoiceNumber).reduce((s, m) => s + m.qty, 0)
          const fiscalOut = movements.filter(m => m.type === 'out' && (m.reason === 'sale' || m.reason === 'service_order')).reduce((s, m) => s + m.qty, 0)
          const fiscalBalance = fiscalIn - fiscalOut
          const gerencialIn = movements.filter(m => m.type === 'in').reduce((s, m) => s + m.qty, 0)
          const gerencialOut = movements.filter(m => m.type === 'out').reduce((s, m) => s + m.qty, 0)
          const gerencialBalance = gerencialIn - gerencialOut
          const physicalBalance = item.qty
          const hasDiscrepancy = fiscalBalance !== physicalBalance || gerencialBalance !== physicalBalance

          const REASON_LABELS: Record<string, string> = {
            purchase: 'Compra (NF)', sale: 'Venda', service_order: 'Ordem de Serviço',
            manual_adjustment: 'Ajuste Manual', physical_count: 'Contagem Física',
          }

          return (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-semibold text-slate-800">{item.name}</p>
                <p className="text-xs text-slate-400">{item.category} · Fornecedor: {item.supplier || '—'}</p>
              </div>

              {/* Three balance cards */}
              <div className="grid gap-2 sm:grid-cols-3">
                <div className={`rounded-xl border px-3 py-2.5 ${fiscalBalance === physicalBalance ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/50'}`}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Saldo Fiscal</p>
                  <p className="text-xl font-bold text-slate-800">{fiscalBalance}</p>
                  <p className="text-[10px] text-slate-400">Entradas c/ NF − Saídas</p>
                </div>
                <div className={`rounded-xl border px-3 py-2.5 ${gerencialBalance === physicalBalance ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/50'}`}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Saldo Gerencial</p>
                  <p className="text-xl font-bold text-slate-800">{gerencialBalance}</p>
                  <p className="text-[10px] text-slate-400">Todas movimentações</p>
                </div>
                <div className="rounded-xl border border-brand-200 bg-brand-50/50 px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Saldo Físico</p>
                  <p className="text-xl font-bold text-brand-700">{physicalBalance}</p>
                  <p className="text-[10px] text-slate-400">Estoque atual</p>
                </div>
              </div>

              {hasDiscrepancy && (
                <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-amber-700">Divergência detectada</p>
                    <p className="text-xs text-amber-600">
                      {fiscalBalance !== physicalBalance && `Fiscal (${fiscalBalance}) ≠ Físico (${physicalBalance}). `}
                      {gerencialBalance !== physicalBalance && `Gerencial (${gerencialBalance}) ≠ Físico (${physicalBalance}). `}
                      Realize uma contagem física ou ajuste manual para regularizar.
                    </p>
                  </div>
                </div>
              )}

              {/* Movement list */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">{movements.length} movimentação(ões)</p>
                <div className="max-h-[320px] space-y-1 overflow-y-auto pr-1">
                  {movements.length === 0 && <p className="py-6 text-center text-sm text-slate-300">Nenhuma movimentação registrada</p>}
                  {movements.map(m => (
                    <div key={m.id} className={`rounded-xl px-3 py-2.5 border ${m.type === 'in' ? 'border-emerald-100 bg-emerald-50/30' : 'border-rose-100 bg-rose-50/30'}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`flex h-6 w-6 items-center justify-center rounded-lg ${m.type === 'in' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                            {m.type === 'in' ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-800">
                              {m.type === 'in' ? '+' : '−'}{m.qty} un · {REASON_LABELS[m.reason] || m.reason}
                            </p>
                            <p className="text-[11px] text-slate-400">
                              {m.date}{m.timestamp ? ` ${m.timestamp}` : ''} · por <strong>{m.performedBy || 'Sistema'}</strong>
                              {m.invoiceNumber ? ` · NF: ${m.invoiceNumber}` : ''}
                              {m.orderId ? ` · ${m.orderId}` : ''}
                            </p>
                          </div>
                        </div>
                        {m.previousQty !== undefined && m.newQty !== undefined && (
                          <span className="text-[11px] text-slate-400 shrink-0">{m.previousQty} → {m.newQty}</span>
                        )}
                      </div>
                      {m.notes && <p className="mt-1 text-xs text-slate-500 italic pl-8">{m.notes}</p>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* ── PDV: New client inline ── */}
      <Modal open={pdvNewClientOpen} onClose={() => setPdvNewClientOpen(false)} title="Novo cliente">
        <div className="space-y-3">
          <FormField label="Nome completo" value={pdvNewClientForm.name} onChange={v => setPdvNewClientForm(p => ({ ...p, name: v }))} placeholder="Ex: João Silva" />
          <FormField label="CPF" value={pdvNewClientForm.cpf} onChange={v => setPdvNewClientForm(p => ({ ...p, cpf: v }))} placeholder="000.000.000-00" />
          <FormField label="Telefone" value={pdvNewClientForm.phone} onChange={v => setPdvNewClientForm(p => ({ ...p, phone: v }))} placeholder="(00) 00000-0000" />
          <FormField label="Data de nascimento" value={pdvNewClientForm.birthDate} onChange={v => setPdvNewClientForm(p => ({ ...p, birthDate: v }))} placeholder="dd/mm/aaaa" />
          <button onClick={createPdvClient} disabled={!pdvNewClientForm.name.trim()}
            className="mt-2 w-full rounded-xl bg-brand-500 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-40">
            Cadastrar e selecionar
          </button>
        </div>
      </Modal>

      {/* ── PDV: New dependent inline ── */}
      <Modal open={pdvNewDependentOpen} onClose={() => setPdvNewDependentOpen(false)} title="Novo dependente / familiar">
        <div className="space-y-3">
          {pdvClientId && (
            <p className="text-sm text-slate-500">Responsável: <strong className="text-slate-800">{getPatient(pdvClientId)?.name}</strong></p>
          )}
          <FormField label="Nome do dependente" value={pdvNewDependentForm.name} onChange={v => setPdvNewDependentForm(p => ({ ...p, name: v }))} placeholder="Ex: Maria Silva" />
          <FormField label="CPF (opcional)" value={pdvNewDependentForm.cpf} onChange={v => setPdvNewDependentForm(p => ({ ...p, cpf: v }))} placeholder="000.000.000-00" />
          <FormField label="Telefone (opcional)" value={pdvNewDependentForm.phone} onChange={v => setPdvNewDependentForm(p => ({ ...p, phone: v }))} placeholder="(00) 00000-0000" />
          <FormField label="Data de nascimento" value={pdvNewDependentForm.birthDate} onChange={v => setPdvNewDependentForm(p => ({ ...p, birthDate: v }))} placeholder="dd/mm/aaaa" />
          <button onClick={createPdvDependent} disabled={!pdvNewDependentForm.name.trim()}
            className="mt-2 w-full rounded-xl bg-brand-500 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-40">
            Cadastrar dependente
          </button>
        </div>
      </Modal>

      {/* ── PDV: Add glasses (montar óculos) ── */}
      <Modal open={pdvAddGlassesOpen} onClose={() => { setPdvAddGlassesOpen(false); setPdvGlassesBeneficiary(null); setPdvGlassesFrame(''); setPdvGlassesLens(''); setPdvGlassesRxId(null); setPdvGlassesIsReady(false) }} title="Montar óculos" wide>
        {pdvClientId && (() => {
          const client = getPatient(pdvClientId)
          const deps = getDependents(pdvClientId)
          const allBeneficiaries = client ? [client, ...deps] : deps
          const selectedBenef = pdvGlassesBeneficiary ? patients.find(p => p.id === pdvGlassesBeneficiary) : null
          const benefRxs = pdvGlassesBeneficiary ? getPatientRxs(pdvGlassesBeneficiary).filter(rx => {
            const exp = parseDMY(rx.expiresAt)
            return exp ? daysBetween(TODAY_D, exp) > 0 : false
          }) : []
          const frames = stock.filter(s => s.category === 'Armações' && s.qty > 0)
          const selectedRx = pdvGlassesRxId ? prescriptions.find(r => r.id === pdvGlassesRxId) : null

          return (
            <div className="space-y-4">
              {/* Step 1: Select beneficiary */}
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">1. Quem vai usar o óculos?</p>
                <div className="flex flex-wrap gap-2">
                  {allBeneficiaries.map(b => (
                    <button key={b.id} onClick={() => { setPdvGlassesBeneficiary(b.id); setPdvGlassesRxId(null); setPdvGlassesIsReady(false) }}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${pdvGlassesBeneficiary === b.id ? 'bg-brand-500 text-white' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}>
                      <UserRound className="mr-1 inline h-3 w-3" />
                      {b.name} {b.parentId ? '(dep.)' : '(titular)'}
                    </button>
                  ))}
                  <button onClick={() => { setPdvAddGlassesOpen(false); setPdvNewDependentOpen(true) }}
                    className="rounded-full border border-dashed border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-400 transition hover:border-brand-300 hover:text-brand-600">
                    <Plus className="mr-1 inline h-3 w-3" /> Novo dependente
                  </button>
                </div>
              </div>

              {/* Step 2: Prescription */}
              {pdvGlassesBeneficiary && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">2. Prescrição</p>
                  <label className="mb-2 flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={pdvGlassesIsReady} onChange={e => { setPdvGlassesIsReady(e.target.checked); if (e.target.checked) setPdvGlassesRxId(null) }}
                      className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-400" />
                    <span className="text-sm text-slate-700">Óculos pronto (leitura simples / sol, sem prescrição)</span>
                  </label>
                  {!pdvGlassesIsReady && (
                    <div className="space-y-2">
                      {benefRxs.length > 0 ? (
                        <div className="space-y-2">
                          {benefRxs.map(rx => (
                            <button key={rx.id} onClick={() => setPdvGlassesRxId(rx.id)}
                              className={`w-full rounded-xl border p-3 text-left transition ${pdvGlassesRxId === rx.id ? 'border-brand-300 bg-brand-50/40' : 'border-slate-100 bg-slate-50/50 hover:border-brand-200'}`}>
                              <div className="flex items-center justify-between mb-1">
                                <p className="text-sm font-semibold text-slate-800">{rx.lensType} — Exame: {rx.examDate}</p>
                                <Badge color="emerald">Válida até {rx.expiresAt}</Badge>
                              </div>
                              <p className="text-xs text-slate-400">OD: {rx.rxOD.sph || '—'}/{rx.rxOD.cyl || '—'} x{rx.rxOD.axis || '—'} | OE: {rx.rxOE.sph || '—'}/{rx.rxOE.cyl || '—'} x{rx.rxOE.axis || '—'}</p>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-400">Nenhuma prescrição válida encontrada para {selectedBenef?.name ?? 'este beneficiário'}.</p>
                      )}
                      <button onClick={() => setPdvAddRxOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-semibold text-slate-500 transition hover:border-brand-300 hover:text-brand-600">
                        <ClipboardPlus className="h-3.5 w-3.5" /> Adicionar nova prescrição
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Step 3: Frame */}
              {pdvGlassesBeneficiary && (pdvGlassesIsReady || pdvGlassesRxId) && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">3. Armação</p>
                  <SelectField label="Selecione a armação" value={pdvGlassesFrame} onChange={setPdvGlassesFrame}
                    options={[{ value: '', label: 'Escolha uma armação…' }, ...frames.map(s => ({
                      value: String(s.id), label: `${s.name} — R$ ${s.price.toFixed(2)} (${s.qty} em estoque)`,
                    }))]} />
                </div>
              )}

              {/* Step 4: Lens */}
              {pdvGlassesBeneficiary && (pdvGlassesIsReady || pdvGlassesRxId) && pdvGlassesFrame && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">4. Tipo de lente</p>
                  {selectedRx && <p className="mb-2 text-xs text-slate-500">Prescrição indica: <strong>{selectedRx.lensType}</strong></p>}
                  <div className="max-h-[200px] space-y-1.5 overflow-y-auto pr-1">
                    {LENS_CATALOG.filter(l => {
                      if (pdvGlassesIsReady) return l.lensType === 'Leitura' || l.lensType === 'Solar'
                      return l.lensType !== 'Leitura'
                    }).map(lens => (
                      <button key={lens.id} onClick={() => setPdvGlassesLens(String(lens.id))}
                        className={`w-full rounded-xl border p-2.5 text-left transition ${pdvGlassesLens === String(lens.id) ? 'border-brand-300 bg-brand-50/40' : 'border-slate-100 bg-slate-50/50 hover:border-brand-200'}`}>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-medium text-slate-800">{lens.name}</p>
                            <p className="text-xs text-slate-400">{lens.description}</p>
                          </div>
                          <p className="text-sm font-bold text-brand-600">R$ {lens.price.toFixed(2)}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Summary + add */}
              {pdvGlassesBeneficiary && (pdvGlassesIsReady || pdvGlassesRxId) && pdvGlassesFrame && pdvGlassesLens && (() => {
                const frame = stock.find(s => s.id === parseInt(pdvGlassesFrame))
                const lens = LENS_CATALOG.find(l => l.id === parseInt(pdvGlassesLens))
                if (!frame || !lens) return null
                return (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600 mb-2">Resumo</p>
                    <p className="text-sm text-slate-700">Beneficiário: <strong>{selectedBenef?.name}</strong></p>
                    <p className="text-sm text-slate-700">Armação: {frame.name} — R$ {frame.price.toFixed(2)}</p>
                    <p className="text-sm text-slate-700">Lente: {lens.name} — R$ {lens.price.toFixed(2)}</p>
                    <p className="mt-1 text-sm font-bold text-slate-900">Total: R$ {(frame.price + lens.price).toFixed(2)}</p>
                    <button onClick={addGlassesToCart}
                      className="mt-3 w-full rounded-xl bg-brand-500 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600">
                      <Glasses className="mr-2 inline h-4 w-4" /> Adicionar ao carrinho
                    </button>
                  </div>
                )
              })()}
            </div>
          )
        })()}
      </Modal>

      {/* ── PDV: Add prescription inline ── */}
      <Modal open={pdvAddRxOpen} onClose={() => setPdvAddRxOpen(false)} title="Nova prescrição (PDV)" wide>
        <div className="space-y-3">
          {pdvGlassesBeneficiary && (
            <p className="text-sm text-slate-500">Paciente: <strong className="text-slate-800">{getPatient(pdvGlassesBeneficiary)?.name}</strong></p>
          )}
          <FormField label="Tipo de lente" value={pdvAddRxLensType} onChange={setPdvAddRxLensType} placeholder="Ex: Multifocal, Blue Light…" />
          <RxInputRow label="Olho direito (OD)" rx={pdvAddRxOD} onChange={setPdvAddRxOD} />
          <RxInputRow label="Olho esquerdo (OE)" rx={pdvAddRxOE} onChange={setPdvAddRxOE} />
          <div className="grid gap-2 sm:grid-cols-2">
            <FormField label="Data do exame" value={pdvAddRxExamDate} onChange={v => {
              setPdvAddRxExamDate(v)
              const parsed = parseDMY(v)
              if (parsed) setPdvAddRxExpiresAt(fmtDate(addYears(parsed, 1)))
            }} placeholder="dd/mm/aaaa" />
            <FormField label="Validade da receita" value={pdvAddRxExpiresAt} onChange={setPdvAddRxExpiresAt} placeholder="dd/mm/aaaa" />
          </div>
          <p className="text-[11px] text-slate-400">A validade é recalculada automaticamente ao alterar a data do exame (padrão: 1 ano). Você pode ajustar manualmente.</p>
          <button onClick={savePdvPrescription} disabled={!pdvGlassesBeneficiary}
            className="mt-2 w-full rounded-xl bg-brand-500 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-40">
            Salvar prescrição e continuar
          </button>
        </div>
      </Modal>

      {/* Campaign / WhatsApp */}
      <Modal open={campaignOpen} onClose={() => setCampaignOpen(false)} title="Campanhas de marketing" wide>
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <SelectField label="Tipo" value={campaignFilter.type} onChange={v => setCampaignFilter(p => ({ ...p, type: v as CampaignFilter['type'] }))}
              options={[{ value: 'birthday', label: '🎂 Aniversariantes' }, { value: 'prescription_expiry', label: '💊 Receitas expirando' }]} />
            <FormField label="Dias à frente" value={String(campaignFilter.daysAhead)} onChange={v => setCampaignFilter(p => ({ ...p, daysAhead: parseInt(v) || 7 }))} placeholder="7" type="number" />
          </div>
          <div className="rounded-xl border border-slate-100">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
              <p className="text-sm font-semibold text-slate-700">{campaignTargets.length} paciente(s) encontrado(s)</p>
              {campaignTargets.length > 0 && (
                <button
                  onClick={() => {
                    campaignTargets.forEach((t, idx) => {
                      setTimeout(() => openWhatsAppForPatient(t.patient), idx * 120)
                    })
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-600"
                >
                  <Send className="h-3 w-3" /> Enviar WhatsApp para todos
                </button>
              )}
            </div>
            {campaignTargets.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-400">Nenhum paciente encontrado com esses filtros</p>
            ) : (
              <div className="max-h-[320px] divide-y divide-slate-50 overflow-y-auto">
                {campaignTargets.map(t => (
                  <div key={t.patient.id} className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-500"><UserRound className="h-4 w-4" /></div>
                      <div>
                        <p className="text-sm font-medium text-slate-800">{t.patient.name}</p>
                        <p className="text-xs text-slate-400">{t.patient.phone} · {t.reason}</p>
                      </div>
                    </div>
                    <button onClick={() => openWhatsAppForPatient(t.patient)}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-600 transition hover:bg-emerald-100">
                      <Phone className="h-3 w-3" /> WhatsApp
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* ── New product (catalog only) ── */}
      <Modal open={newProductOpen} onClose={() => setNewProductOpen(false)} title="Cadastrar novo produto" wide>
        <div className="space-y-3">
          <p className="text-xs text-slate-400">Cadastre o produto no catálogo. Para dar entrada no estoque, use "Entrada NF" depois.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Nome do produto" value={newProductForm.name} onChange={v => setNewProductForm(p => ({ ...p, name: v }))} placeholder="Ex: Armação Ray-Ban Round" />
            <SelectField label="Categoria" value={newProductForm.category} onChange={v => setNewProductForm(p => ({ ...p, category: v }))}
              options={[{ value: 'Armações', label: 'Armações' }, { value: 'Lentes', label: 'Lentes' }, { value: 'Lentes de contato', label: 'Lentes de contato' }, { value: 'Acessórios', label: 'Acessórios' }, { value: 'Solar', label: 'Solar' }, { value: 'Produtos de limpeza', label: 'Produtos de limpeza' }, { value: 'Tratamentos', label: 'Tratamentos' }]} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Preço de custo (R$)" value={newProductForm.costPrice} onChange={v => setNewProductForm(p => ({ ...p, costPrice: v }))} placeholder="0.00" type="number" />
            <FormField label="Preço de venda (R$)" value={newProductForm.salePrice} onChange={v => setNewProductForm(p => ({ ...p, salePrice: v }))} placeholder="0.00" type="number" />
          </div>
          {(() => {
            const cost = parseFloat(newProductForm.costPrice) || 0
            const sale = parseFloat(newProductForm.salePrice) || 0
            if (cost > 0 && sale > 0) {
              const margin = ((sale - cost) / sale * 100)
              return (
                <div className={`flex items-center gap-3 rounded-xl px-4 py-2.5 ${margin >= 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-rose-50 border border-rose-200'}`}>
                  <TrendingUp className={`h-4 w-4 ${margin >= 0 ? 'text-emerald-500' : 'text-rose-500'}`} />
                  <p className={`text-sm font-semibold ${margin >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>Margem: {margin.toFixed(1)}% · Lucro: R$ {(sale - cost).toFixed(2)}</p>
                </div>
              )
            }
            return null
          })()}
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label="Estoque mínimo" value={newProductForm.min} onChange={v => setNewProductForm(p => ({ ...p, min: v }))} placeholder="3" type="number" />
            <FormField label="Comissão %" value={newProductForm.commissionPct} onChange={v => setNewProductForm(p => ({ ...p, commissionPct: v }))} placeholder="5" type="number" />
            <FormField label="Fornecedor" value={newProductForm.supplier} onChange={v => setNewProductForm(p => ({ ...p, supplier: v }))} placeholder="Ex: Luxottica" />
          </div>
          <button onClick={addNewProduct} disabled={!newProductForm.name.trim() || !newProductForm.salePrice}
            className="mt-2 w-full rounded-xl bg-brand-500 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-40">
            Cadastrar produto
          </button>
        </div>
      </Modal>

      {/* ── Stock entry NF (batch purchase) ── */}
      <Modal open={stockEntryOpen} onClose={() => { setStockEntryOpen(false); setStockEntryItems([]) }} title="Entrada de estoque (NF)" wide>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Nº Nota Fiscal" value={stockEntryNF} onChange={setStockEntryNF} placeholder="Ex: NF-00123" />
            <FormField label="Fornecedor" value={stockEntrySupplier} onChange={setStockEntrySupplier} placeholder="Ex: Luxottica" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Produtos da entrada</p>
              <button onClick={addStockEntryItem}
                className="flex items-center gap-1 rounded-lg bg-brand-50 px-2.5 py-1.5 text-xs font-semibold text-brand-600 transition hover:bg-brand-100">
                <Plus className="h-3 w-3" /> Adicionar produto
              </button>
            </div>

            {stockEntryItems.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center">
                <Boxes className="mx-auto h-8 w-8 text-slate-200 mb-2" />
                <p className="text-sm text-slate-400">Nenhum produto adicionado</p>
                <button onClick={addStockEntryItem} className="mt-2 text-xs font-semibold text-brand-500 hover:text-brand-700">+ Adicionar produto</button>
              </div>
            )}

            <div className="space-y-2">
              {stockEntryItems.map((ei, idx) => {
                const selectedItem = stock.find(s => s.id === ei.stockItemId)
                const costN = parseFloat(ei.costPrice) || 0
                const salePrice = selectedItem?.price || 0
                const margin = costN > 0 && salePrice > 0 ? ((salePrice - costN) / salePrice * 100) : 0
                return (
                  <div key={idx} className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 grid gap-2 sm:grid-cols-3">
                        <div className="sm:col-span-1">
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Produto</label>
                          <select value={ei.stockItemId} onChange={e => updateStockEntryItem(idx, 'stockItemId', parseInt(e.target.value, 10))}
                            className="h-9 w-full rounded-xl border border-slate-200/80 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-100">
                            <option value={0}>Selecione...</option>
                            {stock.map(s => <option key={s.id} value={s.id}>{s.name} (estoque: {s.qty})</option>)}
                          </select>
                        </div>
                        <FormField label="Quantidade" value={ei.qty} onChange={v => updateStockEntryItem(idx, 'qty', v)} placeholder="0" type="number" />
                        <FormField label="Custo unitário (R$)" value={ei.costPrice} onChange={v => updateStockEntryItem(idx, 'costPrice', v)} placeholder={selectedItem?.costPrice?.toFixed(2) || '0.00'} type="number" />
                      </div>
                      <button onClick={() => removeStockEntryItem(idx)} className="mt-5 rounded-lg p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {selectedItem && costN > 0 && (
                      <div className="mt-2 flex items-center gap-4 text-xs">
                        <span className="text-slate-400">Venda: R$ {salePrice.toFixed(2)}</span>
                        <span className={`font-semibold ${margin >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>Margem: {margin.toFixed(1)}%</span>
                        {parseInt(ei.qty, 10) > 0 && <span className="text-slate-400">Subtotal custo: R$ {(costN * parseInt(ei.qty, 10)).toFixed(2)}</span>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {stockEntryItems.filter(ei => ei.stockItemId > 0 && parseInt(ei.qty, 10) > 0).length > 0 && (
            <div className="rounded-xl bg-brand-50 border border-brand-200 px-4 py-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold text-brand-700">
                  {stockEntryItems.filter(ei => ei.stockItemId > 0 && parseInt(ei.qty, 10) > 0).length} produto(s) ·{' '}
                  {stockEntryItems.filter(ei => ei.stockItemId > 0 && parseInt(ei.qty, 10) > 0).reduce((s, ei) => s + (parseInt(ei.qty, 10) || 0), 0)} unidades
                </span>
                <span className="text-brand-600">
                  Total custo: R$ {stockEntryItems.filter(ei => ei.stockItemId > 0).reduce((s, ei) => s + ((parseFloat(ei.costPrice) || 0) * (parseInt(ei.qty, 10) || 0)), 0).toFixed(2)}
                </span>
              </div>
            </div>
          )}

          <button onClick={submitStockEntry} disabled={stockEntryItems.filter(ei => ei.stockItemId > 0 && parseInt(ei.qty, 10) > 0).length === 0}
            className="w-full rounded-xl bg-brand-500 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-40">
            Confirmar entrada
          </button>
        </div>
      </Modal>

      {/* ── New / Edit collaborator ── */}
      <Modal open={newCollabOpen} onClose={() => { setNewCollabOpen(false); setEditCollabId(null) }} title={editCollabId !== null ? 'Editar colaborador' : 'Novo colaborador'}>
        <div className="space-y-3">
          <FormField label="Nome completo" value={newCollabForm.name} onChange={v => setNewCollabForm(p => ({ ...p, name: v }))} placeholder="Ex: João Silva" />
          <SelectField label="Função" value={newCollabForm.role} onChange={v => setNewCollabForm(p => ({ ...p, role: v as Collaborator['role'] }))}
            options={[{ value: 'gerente', label: 'Gerente' }, { value: 'optometrista', label: 'Optometrista' }, { value: 'vendedor', label: 'Vendedor(a)' }, { value: 'montador', label: 'Montador(a)' }, { value: 'atendente', label: 'Atendente' }]} />
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Telefone" value={newCollabForm.phone} onChange={v => setNewCollabForm(p => ({ ...p, phone: v }))} placeholder="(00) 00000-0000" />
            <FormField label="E-mail" value={newCollabForm.email} onChange={v => setNewCollabForm(p => ({ ...p, email: v }))} placeholder="email@exemplo.com" />
          </div>
          <FormField label="Comissão (%)" value={newCollabForm.commissionPct} onChange={v => setNewCollabForm(p => ({ ...p, commissionPct: v }))} placeholder="5" type="number" />
          <button onClick={saveCollaborator} disabled={!newCollabForm.name.trim()}
            className="mt-2 w-full rounded-xl bg-brand-500 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-40">
            {editCollabId !== null ? 'Salvar alterações' : 'Adicionar colaborador'}
          </button>
        </div>
      </Modal>
    </div>
  )
}

/* ================================================================== */
/*  PAGES                                                              */
/* ================================================================== */

/* ─── OVERVIEW ─── */
function OverviewPage({ patients, prescriptions, orders, stock, sales, suggestions, onAdvanceOrder, onOpenCampaign, onGoToPage }: {
  patients: Patient[]; prescriptions: Prescription[]; orders: ServiceOrder[]; stock: StockItem[]; sales: Sale[];
  suggestions: Suggestion[]; onAdvanceOrder: (id: string) => void;
  onOpenCampaign: () => void; onGoToPage: (p: PageKey) => void
}) {
  const inProd = orders.filter(o => o.status === 'production').length
  const ready = orders.filter(o => o.status === 'ready').length
  const lowStock = stock.filter(s => s.qty <= s.min).length
  const totalRevenue = sales.reduce((s, x) => s + x.total, 0)

  // Birthdays today
  const birthdaysToday = patients.filter(p => {
    const bd = parseDMY(p.birthDate)
    return bd && bd.getDate() === TODAY_D.getDate() && bd.getMonth() === TODAY_D.getMonth()
  })

  // Prescriptions expiring soon
  const expiringRxs = prescriptions.filter(r => {
    const exp = parseDMY(r.expiresAt)
    if (!exp) return false
    const days = daysBetween(TODAY_D, exp)
    return days > 0 && days <= 30
  })
  const producedToday = orders.filter((o) => o.readyAt === TODAY).length
  const deliveredToday = orders.filter((o) => o.deliveredAt === TODAY).length
  const salesToday = sales.filter((s) => s.date === TODAY).length

  const metrics = [
    { label: 'Faturamento', value: `R$ ${totalRevenue.toFixed(2).replace('.', ',')}`, trend: `${sales.length} venda(s)`, dir: 'up' as const, icon: TrendingUp, spark: 'M0 18 C10 10,20 14,30 8 C40 3,50 11,60 2' },
    { label: 'Produção / Prontos', value: `${inProd} / ${ready}`, trend: `${orders.length} OS total`, dir: 'neutral' as const, icon: Microscope, spark: 'M0 10 C10 4,20 9,30 16 C40 18,50 13,60 9' },
    { label: 'Alertas de estoque', value: String(lowStock), trend: `${stock.length} produtos`, dir: lowStock > 0 ? 'down' as const : 'neutral' as const, icon: AlertTriangle, spark: 'M0 14 C8 13,16 12,24 12 C34 12,44 8,60 8' },
  ]

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] text-slate-400">{TODAY} · {patients.length} pacientes · {prescriptions.length} receitas</p>
          <h1 className="mt-1 text-xl font-semibold text-slate-900 sm:text-2xl">Bem-vinda, Dra. Eliza</h1>
        </div>
        <div className="flex gap-2">
          <button onClick={onOpenCampaign} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-brand-300 hover:text-brand-600">
            <Send className="h-3.5 w-3.5" /> Campanhas
          </button>
          <Badge>Visão geral</Badge>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {metrics.map(m => {
          const Icon = m.icon
          return (
            <Card key={m.label}>
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <p className="text-[13px] text-slate-400">{m.label}</p>
                  <p className="mt-1.5 text-2xl font-bold text-slate-900">{m.value}</p>
                </div>
                <div className="rounded-xl bg-brand-50 p-2.5 text-brand-500"><Icon className="h-5 w-5" /></div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <Badge color={m.dir === 'up' ? 'emerald' : m.dir === 'down' ? 'rose' : 'slate'}>
                  {m.dir === 'up' && <TrendingUp className="h-3 w-3" />}{m.dir === 'down' && <TrendingDown className="h-3 w-3" />}{m.trend}
                </Badge>
                <svg viewBox="0 0 60 20" className="h-6 w-16 text-brand-400"><path d={m.spark} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              </div>
            </Card>
          )
        })}
      </div>

      {/* ERP process guide */}
      <Card>
        <SectionTitle title="Fluxo do ERP" sub="Sequência recomendada: Receita → Laboratório → Entrega → Venda/CRM" />
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">1. Receita</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{prescriptions.length} registradas</p>
            <button onClick={() => onGoToPage('patients')} className="mt-2 text-xs font-semibold text-brand-600 hover:text-brand-700">Ir para pacientes</button>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">2. Produção</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{inProd} em produção · {producedToday} prontas hoje</p>
            <button onClick={() => onGoToPage('lab')} className="mt-2 text-xs font-semibold text-brand-600 hover:text-brand-700">Ir para laboratório</button>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">3. Entrega</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{ready} aguardando retirada · {deliveredToday} entregues hoje</p>
            <button onClick={onOpenCampaign} className="mt-2 text-xs font-semibold text-brand-600 hover:text-brand-700">Notificar clientes</button>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">4. Venda/CRM</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{salesToday} venda(s) hoje · campanhas ativas</p>
            <button onClick={() => onGoToPage('pdv')} className="mt-2 text-xs font-semibold text-brand-600 hover:text-brand-700">Ir para PDV</button>
          </div>
        </div>
      </Card>

      {/* CRM actions — real data */}
      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <SectionTitle title="Alertas e ações" sub="Baseado nos dados reais do sistema" />
          <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
            {birthdaysToday.length > 0 && (
              <ActionRowCRM icon={Gift} title={`${birthdaysToday.length} aniversariante(s) hoje`}
                sub={birthdaysToday.map(p => p.name).join(', ')} tone="blue"
                onAction={onOpenCampaign} />
            )}
            {expiringRxs.length > 0 && (
              <ActionRowCRM icon={AlertTriangle} title={`${expiringRxs.length} receita(s) expirando em breve`}
                sub="Contatar para renovação" tone="amber" onAction={onOpenCampaign} />
            )}
            {ready > 0 && (
              <ActionRowCRM icon={CheckCircle2} title={`${ready} óculos pronto(s) para retirada`}
                sub="Avisar clientes para buscar" tone="emerald" onAction={onOpenCampaign} />
            )}
            {lowStock > 0 && (
              <ActionRowCRM icon={Package} title={`${lowStock} produto(s) abaixo do mínimo`}
                sub="Verificar estoque e repor" tone="amber" onAction={() => {}} />
            )}
            {birthdaysToday.length === 0 && expiringRxs.length === 0 && ready === 0 && lowStock === 0 && (
              <p className="py-4 text-center text-sm text-slate-400">✅ Nenhum alerta no momento</p>
            )}
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <SectionTitle title="Sugestões inteligentes" sub="Análise real do estoque"
            action={<Badge color="slate"><Sparkles className="h-3 w-3" /> Auto</Badge>} />
          {suggestions.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">Estoque equilibrado</p>
          ) : (
            <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
              {suggestions.slice(0, 4).map((s, i) => (
                <div key={i} className={`rounded-xl p-3 ${s.severity === 'critical' ? 'border border-rose-200 bg-rose-50/60' : s.severity === 'warning' ? 'border border-amber-200 bg-amber-50/40' : 'border border-slate-100 bg-slate-50/50'}`}>
                  <p className={`text-sm font-semibold ${s.severity === 'critical' ? 'text-rose-700' : s.severity === 'warning' ? 'text-amber-700' : 'text-slate-800'}`}>{s.title}</p>
                  <p className="text-xs text-slate-400">{s.sub}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Kanban + recent activity */}
      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <SectionTitle title="Laboratório" sub="Ordens de serviço" />
          <div className="grid gap-3 sm:grid-cols-3">
            {(['production', 'ready', 'delivered'] as const).map(status => {
              const colOrders = orders.filter(o => o.status === status)
              const colTitle = status === 'production' ? 'Em produção' : status === 'ready' ? 'Pronto' : 'Entregue'
              return (
                <div key={status} className="rounded-xl bg-slate-50 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-700">{colTitle}</h3>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500">{colOrders.length}</span>
                  </div>
                  <div className="max-h-[280px] space-y-2 overflow-y-auto pr-1">
                    {colOrders.length === 0 && <p className="py-3 text-center text-xs text-slate-300">Vazio</p>}
                    {colOrders.map(o => {
                      const pat = patients.find(p => p.id === o.patientId)
                      return (
                        <div key={o.id} className="rounded-xl border border-slate-100 bg-white p-2.5">
                          <div className="mb-1 flex items-center justify-between">
                            <p className="text-sm font-semibold text-slate-800">{pat?.name}</p>
                            <span className="rounded-md bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">{o.id}</span>
                          </div>
                          <p className="text-xs text-slate-400">Criada: {o.createdAt}</p>
                          {status !== 'delivered' && (
                            <button onClick={() => onAdvanceOrder(o.id)}
                              disabled={status === 'ready' && !sales.some(s => s.orderId === o.id)}
                              className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-brand-500 transition hover:text-brand-700 disabled:opacity-40 disabled:pointer-events-none">
                              <ChevronRight className="h-3 w-3" />{status === 'production' ? 'Marcar pronto' : 'Marcar entregue'}
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <SectionTitle title="Últimas vendas" />
          {sales.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">Nenhuma venda ainda</p>
          ) : (
            <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
              {sales.slice(-5).reverse().map(s => {
                const pat = s.patientId ? patients.find(p => p.id === s.patientId) : null
                return (
                  <div key={s.id} className="flex items-start gap-3 rounded-xl bg-slate-50 p-3">
                    <History className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
                    <div>
                      <p className="text-sm font-medium text-slate-800">R$ {s.total.toFixed(2)} · {s.paymentMethod}</p>
                      <p className="text-xs text-slate-400">{pat?.name ?? 'Sem paciente'} · {s.date}{s.orderId ? ` · ${s.orderId}` : ''}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>
    </>
  )
}

/* ─── PDV ─── */
function PdvPage({ stock, patients, cart, glassesCart, cartTotal,
  onAddToCart, onRemoveFromCart, onRemoveGlasses, onClearCart, onFinalizeSale,
  pdvClientId, onSelectClient, onOpenNewClient, onOpenNewDependent, onOpenAddGlasses,
  getDependents, generateOs, onToggleOs, osPaid, onToggleOsPaid }: {
  stock: StockItem[]; patients: Patient[];
  cart: CartItem[]; glassesCart: CartGlassesItem[]; cartTotal: number;
  onAddToCart: (name: string, price: number, stockItemId: number) => void; onRemoveFromCart: (id: number) => void;
  onRemoveGlasses: (id: number) => void; onClearCart: () => void;
  onFinalizeSale: (pm: string) => boolean;
  pdvClientId: number | null; onSelectClient: (id: number | null) => void;
  onOpenNewClient: () => void; onOpenNewDependent: () => void; onOpenAddGlasses: () => void;
  getDependents: (id: number) => Patient[];
  generateOs: boolean; onToggleOs: (v: boolean) => void;
  osPaid: boolean; onToggleOsPaid: (v: boolean) => void;
}) {
  const [saleCompleted, setSaleCompleted] = useState(false)
  const [saleError, setSaleError] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('Cartão crédito')
  const [catalogSearch, setCatalogSearch] = useState('')
  const [clientSearch, setClientSearch] = useState('')

  const hasItems = cart.length > 0 || glassesCart.length > 0

  const handleFinalize = () => {
    if (!hasItems) return
    if (!pdvClientId) {
      setSaleError('Selecione um cliente para finalizar a venda.')
      return
    }
    const ok = onFinalizeSale(paymentMethod)
    if (!ok) {
      setSaleError('Verifique estoque e cliente antes de finalizar.')
      return
    }
    setSaleError('')
    setSaleCompleted(true)
    setTimeout(() => setSaleCompleted(false), 2500)
  }

  // Catalog: accessories only (frames are in glasses flow)
  const catalog = stock.filter(s => s.qty > 0 && (s.category === 'Acessórios' || s.category === 'Tratamentos'))
  const catalogFiltered = catalogSearch ? catalog.filter(s => s.name.toLowerCase().includes(catalogSearch.toLowerCase())) : catalog

  // Client search list (only "responsáveis", not dependents at top level)
  const mainClients = patients.filter(p => !p.parentId)
  const clientsFiltered = clientSearch
    ? mainClients.filter(p => p.name.toLowerCase().includes(clientSearch.toLowerCase()) || p.cpf.includes(clientSearch))
    : mainClients

  const selectedClient = pdvClientId ? patients.find(p => p.id === pdvClientId) : null
  const dependents = pdvClientId ? getDependents(pdvClientId) : []

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Ponto de venda</h1>
          <p className="mt-0.5 text-[13px] text-slate-400">Selecione o cliente, monte os óculos e finalize a venda</p>
        </div>
        <Badge color="emerald">PDV ativo</Badge>
      </div>

      {/* ── 1. Client selection ── */}
      <Card>
        <SectionTitle title="1. Cliente (responsável financeiro)" sub="Selecione ou cadastre o cliente que realizará a compra" />
        {!selectedClient ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
                <input value={clientSearch} onChange={e => setClientSearch(e.target.value)} placeholder="Buscar cliente por nome ou CPF…"
                  className="h-10 w-full rounded-xl border border-slate-200/80 bg-slate-50/80 pl-10 pr-4 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100" />
              </div>
              <button onClick={onOpenNewClient}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600">
                <UserPlus className="h-4 w-4" /> Novo cliente
              </button>
            </div>
            <div className="max-h-[200px] space-y-1 overflow-y-auto pr-1">
              {clientsFiltered.length === 0 ? (
                <p className="py-4 text-center text-sm text-slate-400">Nenhum cliente encontrado. Cadastre um novo.</p>
              ) : clientsFiltered.map(p => (
                <button key={p.id} onClick={() => onSelectClient(p.id)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-brand-50/60">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-brand-500"><UserRound className="h-4 w-4" /></div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{p.name}</p>
                    <p className="text-xs text-slate-400">{p.cpf} · {p.phone}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50/40 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-brand-600"><UserRound className="h-5 w-5" /></div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{selectedClient.name}</p>
                  <p className="text-xs text-slate-400">{selectedClient.cpf} · {selectedClient.phone}</p>
                </div>
              </div>
              <button onClick={() => onSelectClient(null)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white hover:text-rose-500">
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* Dependents */}
            <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <Users className="mr-1 inline h-3 w-3" /> Dependentes / Familiares ({dependents.length})
                </p>
                <button onClick={onOpenNewDependent}
                  className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-brand-600 transition hover:bg-brand-50">
                  <Plus className="h-3 w-3" /> Adicionar
                </button>
              </div>
              {dependents.length === 0 ? (
                <p className="text-xs text-slate-400">Nenhum dependente cadastrado</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {dependents.map(d => (
                    <span key={d.id} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-200">
                      <UserRound className="h-3 w-3 text-slate-400" /> {d.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* ── 2. Build order ── */}
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3 space-y-4">
          {/* Add glasses */}
          <Card>
            <SectionTitle title="2. Montar óculos" sub="Adicione óculos completos (armação + lente + prescrição)" />
            <button onClick={onOpenAddGlasses} disabled={!pdvClientId}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600 disabled:opacity-40">
              <Glasses className="h-4 w-4" /> Montar óculos
            </button>
            {!pdvClientId && <p className="mt-2 text-xs text-slate-400">Selecione um cliente primeiro</p>}
          </Card>

          {/* Accessories catalog */}
          <Card>
            <SectionTitle title="Produtos avulsos" sub={`${catalog.length} acessórios e tratamentos disponíveis`} />
            <div className="relative mb-3 max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
              <input value={catalogSearch} onChange={e => setCatalogSearch(e.target.value)} placeholder="Buscar produto…"
                className="h-9 w-full rounded-xl border border-slate-200/80 bg-slate-50/80 pl-10 pr-4 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100" />
            </div>
            <div className="max-h-[300px] grid gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {catalogFiltered.map(item => (
                <button key={item.id} onClick={() => onAddToCart(item.name, item.price, item.id)}
                  className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 p-3 text-left transition hover:border-brand-200 hover:bg-brand-50/30 active:scale-[0.99]">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{item.name}</p>
                    <p className="text-xs text-slate-400">R$ {item.price.toFixed(2)} · {item.qty} em estoque</p>
                  </div>
                  <Plus className="h-4 w-4 text-brand-400" />
                </button>
              ))}
            </div>
          </Card>
        </div>

        {/* ── 3. Cart ── */}
        <Card className="xl:col-span-2">
          <SectionTitle title="Carrinho"
            sub={!hasItems ? 'Vazio' : `${glassesCart.length} óculos · ${cart.length} produto(s)`}
            action={hasItems ? <button onClick={onClearCart} className="text-xs font-medium text-rose-500 hover:text-rose-700 transition">Limpar</button> : undefined} />

          {!hasItems ? (
            <div className="flex flex-col items-center py-8 text-slate-300"><ShoppingCart className="mb-2 h-10 w-10" /><p className="text-sm">Monte óculos ou adicione produtos</p></div>
          ) : (
            <div className="max-h-[400px] space-y-2 overflow-y-auto pr-1">
              {/* Glasses items */}
              {glassesCart.map(g => (
                <div key={g.id} className="rounded-xl border border-brand-200 bg-brand-50/30 p-3">
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Glasses className="h-4 w-4 text-brand-500" />
                      <p className="text-sm font-semibold text-slate-900">{g.beneficiaryName}</p>
                    </div>
                    <button onClick={() => onRemoveGlasses(g.id)} className="rounded-lg p-1 text-slate-400 hover:bg-white hover:text-rose-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="text-xs text-slate-600">Armação: {g.frameName} · R$ {g.framePrice.toFixed(2)}</p>
                  <p className="text-xs text-slate-600">Lente: {g.lensName} · R$ {g.lensPrice.toFixed(2)}</p>
                  {g.isReadyMade && <Badge color="slate">Óculos pronto</Badge>}
                  <p className="mt-1 text-xs font-semibold text-brand-600">Subtotal: R$ {(g.framePrice + g.lensPrice).toFixed(2)}</p>
                </div>
              ))}
              {/* Accessory items */}
              {cart.map(c => (
                <div key={c.id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{c.name}</p>
                    <p className="text-xs text-slate-400">{c.qty}× R$ {c.price.toFixed(2)}</p>
                  </div>
                  <button onClick={() => onRemoveFromCart(c.id)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-500"><X className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          )}

          {hasItems && (
            <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
              {/* OS options */}
              {glassesCart.length > 0 && (
                <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Ordem de serviço</p>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={generateOs} onChange={e => onToggleOs(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-400" />
                    <span className="text-sm text-slate-700">Gerar OS para os óculos</span>
                  </label>
                  {generateOs && (
                    <label className="flex items-center gap-2 cursor-pointer ml-6">
                      <input type="checkbox" checked={osPaid} onChange={e => onToggleOsPaid(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-400" />
                      <span className="text-sm text-slate-700">OS já paga (pagamento antecipado)</span>
                    </label>
                  )}
                  {generateOs && !osPaid && (
                    <p className="text-xs text-amber-600 ml-6">OS será gerada como "não paga" — cobrar na entrega</p>
                  )}
                </div>
              )}

              <SelectField label="Forma de pagamento" value={paymentMethod} onChange={setPaymentMethod}
                options={[{ value: 'Cartão crédito', label: 'Cartão crédito' }, { value: 'Cartão débito', label: 'Cartão débito' }, { value: 'PIX', label: 'PIX' }, { value: 'Dinheiro', label: 'Dinheiro' }, { value: 'Boleto', label: 'Boleto' }]} />
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Total</span>
                <span className="text-lg font-bold text-slate-900">R$ {cartTotal.toFixed(2)}</span>
              </div>
              <button onClick={handleFinalize} disabled={saleCompleted || !pdvClientId}
                className="w-full rounded-xl bg-brand-500 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600 active:scale-[0.99] disabled:opacity-60">
                {saleCompleted ? <><Check className="mr-2 inline h-4 w-4" /> Venda registrada!</> : <><CreditCard className="mr-2 inline h-4 w-4" /> Finalizar venda</>}
              </button>
              {saleError && <p className="text-xs font-medium text-rose-600">{saleError}</p>}
            </div>
          )}
        </Card>
      </div>
    </>
  )
}

/* ─── PATIENTS ─── */
function PatientsPage({ patients, prescriptions, orders, sales, onSelectPatient, onNewPatient, onNewRx }: {
  patients: Patient[]; prescriptions: Prescription[]; orders: ServiceOrder[]; sales: Sale[];
  onSelectPatient: (id: number) => void; onNewPatient: () => void; onNewRx: (pid: number) => void
}) {
  const [filter, setFilter] = useState('')
  const mainClients = patients.filter(p => !p.parentId)
  const filtered = filter ? mainClients.filter(p => p.name.toLowerCase().includes(filter.toLowerCase()) || p.cpf.includes(filter)) : mainClients
  const getDeps = (id: number) => patients.filter(p => p.parentId === id)

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Clientes & Pacientes</h1>
          <p className="mt-0.5 text-[13px] text-slate-400">{mainClients.length} clientes · {patients.length - mainClients.length} dependentes · {prescriptions.length} receitas</p>
        </div>
        <button onClick={onNewPatient} className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 active:scale-[0.98]">
          <UserPlus className="h-4 w-4" /> Novo cliente
        </button>
      </div>

      <Card>
        <div className="mb-4">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filtrar por nome ou CPF…"
              className="h-10 w-full rounded-xl border border-slate-200/80 bg-slate-50/80 pl-10 pr-4 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100" />
          </div>
        </div>
        <div className="max-h-[520px] space-y-1 overflow-y-auto pr-1">
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">Nenhum cliente encontrado</p>
          ) : filtered.map(p => {
            const deps = getDeps(p.id)
            const rxCount = prescriptions.filter(r => r.patientId === p.id).length
            const orderCount = orders.filter(o => o.patientId === p.id).length
            const saleCount = sales.filter(s => s.patientId === p.id).length
            const latestRx = prescriptions.filter(r => r.patientId === p.id).slice(-1)[0]
            const daysToExpiry = latestRx ? (() => { const exp = parseDMY(latestRx.expiresAt); return exp ? daysBetween(TODAY_D, exp) : 999 })() : 999

            return (
              <div key={p.id}>
                <div className="flex items-center justify-between rounded-xl px-3 py-3 transition hover:bg-slate-50">
                  <button onClick={() => onSelectPatient(p.id)} className="flex items-center gap-3 text-left">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-50 text-brand-500"><UserRound className="h-4 w-4" /></div>
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{p.name}</p>
                      <p className="text-xs text-slate-400">{p.cpf} · {rxCount} rx · {orderCount} OS · {saleCount} compra(s){deps.length > 0 ? ` · ${deps.length} dep.` : ''}</p>
                    </div>
                  </button>
                  <div className="flex items-center gap-2">
                    {daysToExpiry <= 30 && daysToExpiry > 0 && <Badge color="amber">Rx vence em {daysToExpiry}d</Badge>}
                    {daysToExpiry <= 0 && <Badge color="rose">Rx vencida</Badge>}
                    <button onClick={() => onNewRx(p.id)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-600 transition hover:border-brand-300 hover:text-brand-600">
                      <ClipboardPlus className="mr-1 inline h-3 w-3" /> Rx
                    </button>
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                  </div>
                </div>
                {/* Dependents */}
                {deps.length > 0 && (
                  <div className="ml-10 space-y-0.5 mb-1">
                    {deps.map(d => {
                      const dRxCount = prescriptions.filter(r => r.patientId === d.id).length
                      return (
                        <div key={d.id} className="flex items-center justify-between rounded-lg px-3 py-2 transition hover:bg-slate-50">
                          <button onClick={() => onSelectPatient(d.id)} className="flex items-center gap-2 text-left">
                            <Users className="h-3.5 w-3.5 text-slate-300" />
                            <div>
                              <p className="text-xs font-medium text-slate-600">{d.name} <span className="text-slate-300">(dependente)</span></p>
                              <p className="text-[11px] text-slate-400">{dRxCount} rx</p>
                            </div>
                          </button>
                          <button onClick={() => onNewRx(d.id)} className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[10px] font-medium text-slate-500 transition hover:border-brand-300 hover:text-brand-600">
                            <ClipboardPlus className="mr-0.5 inline h-2.5 w-2.5" /> Rx
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><p className="text-[13px] text-slate-400">Receitas ativas</p><p className="mt-1 text-2xl font-bold text-slate-900">{prescriptions.filter(r => { const e = parseDMY(r.expiresAt); return e ? daysBetween(TODAY_D, e) > 0 : false }).length}</p></Card>
        <Card><p className="text-[13px] text-slate-400">Expirando em 30 dias</p><p className="mt-1 text-2xl font-bold text-amber-600">{prescriptions.filter(r => { const e = parseDMY(r.expiresAt); if (!e) return false; const d = daysBetween(TODAY_D, e); return d > 0 && d <= 30 }).length}</p></Card>
        <Card><p className="text-[13px] text-slate-400">Total vendas</p><p className="mt-1 text-2xl font-bold text-slate-900">R$ {sales.reduce((s, x) => s + x.total, 0).toFixed(2)}</p></Card>
      </div>
    </>
  )
}

/* ─── LAB ─── */
function LabPage({ orders, patients, prescriptions, stock, sales, onAdvanceOrder, onNewOS, onViewOrder }: {
  orders: ServiceOrder[]; patients: Patient[]; prescriptions: Prescription[]; stock: StockItem[]; sales: Sale[];
  onAdvanceOrder: (id: string) => void; onNewOS: (rxId: number) => void; onViewOrder: (id: string) => void
}) {
  const [labSearch, setLabSearch] = useState('')

  // Prescriptions without active OS
  const rxWithoutOS = prescriptions.filter(rx => !orders.some(o => o.prescriptionId === rx.id))

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Laboratório</h1>
          <p className="mt-0.5 text-[13px] text-slate-400">{orders.length} OS · {orders.filter(o => o.status === 'production').length} em produção</p>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
        <input value={labSearch} onChange={e => setLabSearch(e.target.value)} placeholder="Buscar por paciente ou OS…"
          className="h-10 w-full rounded-xl border border-slate-200/80 bg-slate-50/80 pl-10 pr-4 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100" />
      </div>

      {/* Prescriptions awaiting OS */}
      {rxWithoutOS.length > 0 && (
        <Card>
          <SectionTitle title="Receitas sem OS ativa" sub="Crie uma ordem de serviço para iniciar produção" />
          <div className="max-h-[280px] space-y-2 overflow-y-auto pr-1">
            {rxWithoutOS.map(rx => {
              const pat = patients.find(p => p.id === rx.patientId)
              return (
                <div key={rx.id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2.5">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{pat?.name ?? '—'}</p>
                    <p className="text-xs text-slate-400">{rx.lensType} · Exame: {rx.examDate} · Validade: {rx.expiresAt}</p>
                  </div>
                  <button onClick={() => onNewOS(rx.id)}
                    className="inline-flex items-center gap-1 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-600">
                    <Plus className="h-3 w-3" /> Criar OS
                  </button>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* Kanban */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(['production', 'ready', 'delivered'] as const).map(status => {
          const colOrders = orders.filter(o => o.status === status).filter(o => {
            if (!labSearch) return true
            const pat = patients.find(p => p.id === o.patientId)
            const q = labSearch.toLowerCase()
            return pat?.name.toLowerCase().includes(q) || o.id.toLowerCase().includes(q)
          })
          const title = status === 'production' ? 'Em produção' : status === 'ready' ? 'Pronto' : 'Entregue'
          return (
            <Card key={status}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900">{title}</h2>
                <Badge>{colOrders.length}</Badge>
              </div>
              <div className="max-h-[400px] space-y-2 overflow-y-auto pr-1">
                {colOrders.length === 0 && <p className="py-4 text-center text-sm text-slate-300">Nenhuma ordem</p>}
                {colOrders.map(o => {
                  const pat = patients.find(p => p.id === o.patientId)
                  const rx = prescriptions.find(r => r.id === o.prescriptionId)
                  const lensItem = o.lensItemId ? stock.find(s => s.id === o.lensItemId) : null
                  return (
                    <div key={o.id} className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                      <div className="mb-1 flex items-center justify-between">
                        <p className="text-sm font-semibold text-slate-800">{pat?.name}</p>
                        <button onClick={() => onViewOrder(o.id)} className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-medium text-brand-500 transition hover:bg-brand-50">{o.id}</button>
                      </div>
                      <p className="text-xs text-slate-400">{rx?.lensType ?? '—'} · {lensItem?.name ?? '—'} · {(() => { const fr = o.frameItemId ? stock.find(s => s.id === o.frameItemId) : null; return fr?.name ?? '—' })()}</p>
                      <p className="text-xs text-slate-400">Criada: {o.createdAt}{o.readyAt ? ` · Pronto: ${o.readyAt}` : ''}{o.deliveredAt ? ` · Entregue: ${o.deliveredAt}` : ''}</p>
                      {status !== 'delivered' && (
                        <button onClick={() => onAdvanceOrder(o.id)}
                          disabled={status === 'ready' && !sales.some(s => s.orderId === o.id)}
                          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-500 transition hover:text-brand-700 disabled:opacity-40 disabled:pointer-events-none">
                          <ChevronRight className="h-3 w-3" />{status === 'production' ? 'Marcar pronto' : 'Marcar entregue'}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </Card>
          )
        })}
      </div>
    </>
  )
}

/* ─── STOCK ─── */
function StockPage({ stock, stockMovements, suggestions, onAdjustStock, onPhysicalCount, onNewProduct, onStockEntry, onViewLog }: {
  stock: StockItem[]; stockMovements: StockMovement[]; suggestions: Suggestion[]; onAdjustStock: (id: number, qty: number) => void; onPhysicalCount: (id: number, qty: number) => void; onNewProduct: () => void; onStockEntry: (preSelectId?: number) => void; onViewLog: (id: number) => void
}) {
  const [catFilter, setCatFilter] = useState('all')
  const [stockSearch, setStockSearch] = useState('')
  const categories = ['all', ...new Set(stock.map(s => s.category))]
  const filtered = stock.filter(s => {
    if (catFilter !== 'all' && s.category !== catFilter) return false
    if (stockSearch && !s.name.toLowerCase().includes(stockSearch.toLowerCase())) return false
    return true
  })

  // Find last NF per product and compute fiscal balance from movements
  const lastNFMap = useMemo(() => {
    const map = new Map<number, string>()
    for (const m of stockMovements) {
      if (m.invoiceNumber) map.set(m.stockItemId, m.invoiceNumber)
    }
    return map
  }, [stockMovements])

  const fiscalBalances = useMemo(() => {
    const map = new Map<number, number>()
    for (const m of stockMovements) {
      const prev = map.get(m.stockItemId) || 0
      if (m.type === 'in' && m.invoiceNumber) map.set(m.stockItemId, prev + m.qty)
      else if (m.type === 'out' && (m.reason === 'sale' || m.reason === 'service_order')) map.set(m.stockItemId, prev - m.qty)
    }
    return map
  }, [stockMovements])

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Estoque</h1>
          <p className="mt-0.5 text-[13px] text-slate-400">{stock.length} produtos · {stock.reduce((s, i) => s + i.qty, 0)} unidades total · {stockMovements.length} movimentação(ões)</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {stock.filter(s => s.qty <= s.min).length > 0 && (
            <Badge color="rose"><AlertTriangle className="h-3 w-3" />{stock.filter(s => s.qty <= s.min).length} abaixo do mínimo</Badge>
          )}
          <button onClick={onNewProduct}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-brand-300 hover:text-brand-600">
            <Plus className="h-3.5 w-3.5" /> Novo produto
          </button>
          <button onClick={() => onStockEntry()}
            className="flex items-center gap-1.5 rounded-xl bg-brand-500 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-brand-500/20 transition hover:bg-brand-600">
            <Boxes className="h-3.5 w-3.5" /> Entrada NF
          </button>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {categories.map(cat => (
          <button key={cat} onClick={() => setCatFilter(cat)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${catFilter === cat ? 'bg-brand-500 text-white shadow-sm shadow-brand-500/20' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
            {cat === 'all' ? 'Todos' : cat}
          </button>
        ))}
      </div>

      <Card>
        <div className="relative mb-3 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
          <input value={stockSearch} onChange={e => setStockSearch(e.target.value)} placeholder="Buscar produto por nome…"
            className="h-9 w-full rounded-xl border border-slate-200/80 bg-slate-50/80 pl-10 pr-4 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100" />
        </div>
        <div className="max-h-[520px] space-y-1.5 overflow-y-auto pr-1">
          {filtered.map(s => {
            const critical = s.qty <= s.min
            const margin = s.costPrice > 0 ? ((s.price - s.costPrice) / s.price * 100) : 0
            const lastNF = lastNFMap.get(s.id)
            const fiscal = fiscalBalances.get(s.id) || 0
            const hasDivergence = fiscal !== s.qty && fiscal > 0
            return (
              <div key={s.id} className={`flex items-center justify-between rounded-xl px-3 py-3 transition ${critical ? 'bg-rose-50/60' : hasDivergence ? 'bg-amber-50/40' : 'hover:bg-slate-50'}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${critical ? 'bg-rose-100 text-rose-500' : hasDivergence ? 'bg-amber-100 text-amber-500' : 'bg-brand-50 text-brand-500'}`}>
                    <Package className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{s.name}</p>
                    <p className="text-xs text-slate-400 truncate">{s.category} · Mín: {s.min} · Venda: R$ {s.price.toFixed(2)}{s.costPrice > 0 ? ` · Custo: R$ ${s.costPrice.toFixed(2)} · Margem: ${margin.toFixed(0)}%` : ''}</p>
                    <div className="flex items-center gap-2">
                      {(s.supplier || lastNF) && <p className="text-[11px] text-slate-300 truncate">{s.supplier ? `Fornecedor: ${s.supplier}` : ''}{lastNF ? `${s.supplier ? ' · ' : ''}Última NF: ${lastNF}` : ''}</p>}
                      {hasDivergence && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-600">
                          <AlertTriangle className="h-2.5 w-2.5" /> Fiscal: {fiscal}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="text-right mr-1">
                    <p className={`text-sm font-bold ${critical ? 'text-rose-600' : 'text-slate-800'}`}>{s.qty}</p>
                    <p className="text-[11px] text-slate-400">unidades</p>
                  </div>
                  <button onClick={() => onViewLog(s.id)} title="Histórico"
                    className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-400 transition hover:border-brand-300 hover:text-brand-600"><FileText className="h-3.5 w-3.5" /></button>
                  <button onClick={() => onStockEntry(s.id)}
                    className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs font-medium text-emerald-600 transition hover:bg-emerald-100">Entrada</button>
                  <button onClick={() => onPhysicalCount(s.id, s.qty)}
                    className="rounded-lg border border-sky-200 bg-sky-50 px-2 py-1.5 text-xs font-medium text-sky-600 transition hover:bg-sky-100">Contagem</button>
                  <button onClick={() => onAdjustStock(s.id, s.qty)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-600 transition hover:border-brand-300 hover:text-brand-600">Ajustar</button>
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      {suggestions.length > 0 && (
        <Card>
          <SectionTitle title="Sugestões inteligentes" sub="Análise automática do estoque atual" action={<Badge color="slate"><Sparkles className="h-3 w-3" /> Auto</Badge>} />
          <div className="max-h-[320px] grid gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {suggestions.map((s, i) => (
              <div key={i} className={`rounded-xl p-3 ${s.severity === 'critical' ? 'border border-rose-200 bg-rose-50/60' : s.severity === 'warning' ? 'border border-amber-200 bg-amber-50/40' : 'border border-slate-100 bg-slate-50/50'}`}>
                <p className={`text-sm font-semibold ${s.severity === 'critical' ? 'text-rose-700' : s.severity === 'warning' ? 'text-amber-700' : 'text-slate-800'}`}>{s.title}</p>
                <p className="text-xs text-slate-400">{s.sub}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  )
}

/* ================================================================== */
/*  COLLABORATORS PAGE                                                 */
/* ================================================================== */

const ROLE_LABELS: Record<Collaborator['role'], string> = {
  gerente: 'Gerente', optometrista: 'Optometrista', vendedor: 'Vendedor(a)', montador: 'Montador(a)', atendente: 'Atendente',
}
const ROLE_COLORS: Record<Collaborator['role'], string> = {
  gerente: 'bg-violet-100 text-violet-700', optometrista: 'bg-sky-100 text-sky-700', vendedor: 'bg-emerald-100 text-emerald-700',
  montador: 'bg-amber-100 text-amber-700', atendente: 'bg-rose-100 text-rose-700',
}

function CollaboratorsPage({ collaborators, onNew, onEdit, onToggleActive }: {
  collaborators: Collaborator[]; onNew: () => void; onEdit: (c: Collaborator) => void; onToggleActive: (id: number) => void
}) {
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const roles = ['all', ...new Set(collaborators.map(c => c.role))]
  const filtered = collaborators.filter(c => {
    if (roleFilter !== 'all' && c.role !== roleFilter) return false
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })
  const activeCount = collaborators.filter(c => c.active).length

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Equipe</h1>
          <p className="mt-0.5 text-[13px] text-slate-400">{collaborators.length} colaborador(es) · {activeCount} ativo(s)</p>
        </div>
        <button onClick={onNew}
          className="flex items-center gap-1.5 rounded-xl bg-brand-500 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-brand-500/20 transition hover:bg-brand-600">
          <UserPlus className="h-3.5 w-3.5" /> Novo colaborador
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {roles.map(r => (
          <button key={r} onClick={() => setRoleFilter(r)}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${roleFilter === r ? 'bg-brand-500 text-white shadow-sm shadow-brand-500/20' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
            {r === 'all' ? 'Todos' : ROLE_LABELS[r as Collaborator['role']] || r}
          </button>
        ))}
      </div>

      <Card>
        <div className="relative mb-3 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar colaborador…"
            className="h-9 w-full rounded-xl border border-slate-200/80 bg-slate-50/80 pl-10 pr-4 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100" />
        </div>
        <div className="max-h-[520px] space-y-1.5 overflow-y-auto pr-1">
          {filtered.length === 0 && <p className="py-8 text-center text-sm text-slate-400">Nenhum colaborador encontrado</p>}
          {filtered.map(c => (
            <div key={c.id} className={`flex items-center justify-between rounded-xl px-3 py-3 transition ${c.active ? 'hover:bg-slate-50' : 'bg-slate-50/40 opacity-60'}`}>
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 text-sm font-bold">
                  {c.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-slate-800">{c.name}</p>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${ROLE_COLORS[c.role]}`}>
                      {ROLE_LABELS[c.role]}
                    </span>
                    {!c.active && <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-400">Inativo</span>}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    {c.phone && <span className="flex items-center gap-1 text-xs text-slate-400"><Phone className="h-3 w-3" />{c.phone}</span>}
                    {c.email && <span className="flex items-center gap-1 text-xs text-slate-400"><Mail className="h-3 w-3" />{c.email}</span>}
                    {c.commissionPct > 0 && <span className="text-xs text-emerald-500 font-medium">{c.commissionPct}% comissão</span>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => onEdit(c)} className="rounded-lg border border-slate-200 bg-white p-1.5 text-slate-400 transition hover:border-brand-300 hover:text-brand-600" title="Editar">
                  <Edit2 className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => onToggleActive(c.id)}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${c.active ? 'border-slate-200 bg-white text-slate-500 hover:border-rose-300 hover:text-rose-500' : 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100'}`}>
                  {c.active ? 'Desativar' : 'Ativar'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        {(['vendedor', 'optometrista', 'gerente'] as const).map(role => {
          const count = collaborators.filter(c => c.role === role && c.active).length
          const avgComm = count > 0 ? (collaborators.filter(c => c.role === role && c.active).reduce((s, c) => s + c.commissionPct, 0) / count) : 0
          return (
            <Card key={role}>
              <div className="flex items-center gap-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${ROLE_COLORS[role]}`}>
                  <Briefcase className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">{ROLE_LABELS[role]}</p>
                  <p className="text-xs text-slate-400">{count} ativo(s) · Comissão média: {avgComm.toFixed(1)}%</p>
                </div>
              </div>
            </Card>
          )
        })}
      </div>
    </>
  )
}

/* ================================================================== */
/*  MOBILE NAV (paginated RPG-style toolbar)                           */
/* ================================================================== */

function MobileNav({ page, onChangePage }: { page: PageKey; onChangePage: (p: PageKey) => void }) {
  const [toolbarPage, setToolbarPage] = useState(0)
  const perPage = 4
  const totalPages = Math.ceil(NAV.length / perPage)
  const visibleItems = NAV.slice(toolbarPage * perPage, toolbarPage * perPage + perPage)

  // Auto-switch toolbar page when active page is on another toolbar page
  useEffect(() => {
    const idx = NAV.findIndex(n => n.key === page)
    const targetPage = Math.floor(idx / perPage)
    if (targetPage !== toolbarPage) setToolbarPage(targetPage)
  }, [page, toolbarPage])

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/50 bg-white/95 backdrop-blur-md safe-b lg:hidden">
      <div className="flex items-center">
        {/* Left arrow */}
        <button
          onClick={() => setToolbarPage(p => Math.max(0, p - 1))}
          disabled={toolbarPage === 0}
          className="flex h-full w-9 shrink-0 items-center justify-center text-slate-300 transition disabled:opacity-0"
          aria-label="Página anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {/* Nav items */}
        <div className="flex flex-1 items-center justify-around py-2">
          {visibleItems.map(item => {
            const Icon = item.icon
            const active = page === item.key
            return (
              <button key={item.key} onClick={() => onChangePage(item.key)}
                className={`flex flex-col items-center gap-0.5 px-2 py-1 text-[10px] font-semibold transition ${active ? 'text-brand-500' : 'text-slate-400'}`}>
                <Icon className="h-5 w-5" strokeWidth={active ? 2 : 1.7} />
                <span className="max-w-[56px] truncate">{item.label}</span>
              </button>
            )
          })}
        </div>

        {/* Right arrow */}
        <button
          onClick={() => setToolbarPage(p => Math.min(totalPages - 1, p + 1))}
          disabled={toolbarPage >= totalPages - 1}
          className="flex h-full w-9 shrink-0 items-center justify-center text-slate-300 transition disabled:opacity-0"
          aria-label="Próxima página"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Page dots */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1.5 pb-1.5">
          {Array.from({ length: totalPages }, (_, i) => (
            <button key={i} onClick={() => setToolbarPage(i)}
              className={`h-1 rounded-full transition-all duration-200 ${i === toolbarPage ? 'w-4 bg-brand-500' : 'w-1.5 bg-slate-200'}`} />
          ))}
        </div>
      )}
    </nav>
  )
}

/* ================================================================== */
/*  REPORTS PAGE                                                       */
/* ================================================================== */

function ReportsPage({ patients, prescriptions, orders, sales, stock }: {
  patients: Patient[]; prescriptions: Prescription[]; orders: ServiceOrder[]; sales: Sale[]; stock: StockItem[]
}) {
  const [period, setPeriod] = useState<'7d' | '30d' | '90d' | 'custom' | 'all'>('30d')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [filterPatientId, setFilterPatientId] = useState<string>('')
  const [filterPayment, setFilterPayment] = useState<string>('')
  const [filterCategory, setFilterCategory] = useState<string>('')
  const [showFilters, setShowFilters] = useState(false)

  // Convert ISO (yyyy-mm-dd) to Date
  const parseISO = (s: string): Date | null => {
    if (!s) return null
    const [y, m, d] = s.split('-').map(Number)
    if (!y || !m || !d) return null
    return new Date(y, m - 1, d)
  }

  const paymentMethods = useMemo(() => [...new Set(sales.map(s => s.paymentMethod))], [sales])
  const productCategories = useMemo(() => [...new Set(stock.map(s => s.category))], [stock])

  // CSV export helper
  const exportCSV = (filename: string, headers: string[], rows: string[][]) => {
    const bom = '\uFEFF'
    const csv = bom + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const filteredSales = useMemo(() => {
    return sales.filter(s => {
      const d = parseDMY(s.date)
      if (!d) return false
      // Period filter
      if (period === 'custom') {
        if (dateFrom) { const from = parseISO(dateFrom); if (from && d < from) return false }
        if (dateTo) { const to = parseISO(dateTo); if (to && d > to) return false }
      } else if (period !== 'all') {
        const days = period === '7d' ? 7 : period === '30d' ? 30 : 90
        const diff = daysBetween(d, TODAY_D)
        if (diff > days || diff < 0) return false
      }
      // Patient filter
      if (filterPatientId && s.patientId !== parseInt(filterPatientId)) return false
      // Payment filter
      if (filterPayment && s.paymentMethod !== filterPayment) return false
      return true
    })
  }, [sales, period, dateFrom, dateTo, filterPatientId, filterPayment])

  const totalRevenue = filteredSales.reduce((sum, s) => sum + s.total, 0)
  const avgTicket = filteredSales.length > 0 ? totalRevenue / filteredSales.length : 0

  // Payment breakdown
  const paymentBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>()
    for (const s of filteredSales) {
      const entry = map.get(s.paymentMethod) || { count: 0, total: 0 }
      entry.count++
      entry.total += s.total
      map.set(s.paymentMethod, entry)
    }
    return Array.from(map.entries()).sort((a, b) => b[1].total - a[1].total)
  }, [filteredSales])

  // Top products (filtered by category if set)
  const topProducts = useMemo(() => {
    const map = new Map<string, { qty: number; revenue: number }>()
    for (const s of filteredSales) {
      for (const item of s.items) {
        if (filterCategory) {
          const stockItem = stock.find(si => si.name === item.name)
          if (stockItem && stockItem.category !== filterCategory) continue
        }
        const entry = map.get(item.name) || { qty: 0, revenue: 0 }
        entry.qty += item.qty
        entry.revenue += item.price * item.qty
        map.set(item.name, entry)
      }
    }
    return Array.from(map.entries()).sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 10)
  }, [filteredSales, filterCategory, stock])

  // OS stats
  const osProduction = orders.filter(o => o.status === 'production').length
  const osReady = orders.filter(o => o.status === 'ready').length
  const osDelivered = orders.filter(o => o.status === 'delivered').length

  // Stock health
  const stockFiltered = filterCategory ? stock.filter(s => s.category === filterCategory) : stock
  const stockCritical = stockFiltered.filter(s => s.qty <= Math.ceil(s.min * 0.5)).length
  const stockLow = stockFiltered.filter(s => s.qty <= s.min && s.qty > Math.ceil(s.min * 0.5)).length
  const stockOk = stockFiltered.filter(s => s.qty > s.min).length
  const stockValue = stockFiltered.reduce((sum, s) => sum + s.qty * s.price, 0)

  // Rx overview
  const rxActive = prescriptions.filter(r => { const e = parseDMY(r.expiresAt); return e ? daysBetween(TODAY_D, e) > 0 : false }).length
  const rxExpiringSoon = prescriptions.filter(r => { const e = parseDMY(r.expiresAt); if (!e) return false; const d = daysBetween(TODAY_D, e); return d > 0 && d <= 30 }).length
  const rxExpired = prescriptions.filter(r => { const e = parseDMY(r.expiresAt); return e ? daysBetween(TODAY_D, e) <= 0 : false }).length

  const periodLabel = period === '7d' ? 'últimos 7 dias' : period === '30d' ? 'últimos 30 dias' : period === '90d' ? 'últimos 90 dias' : period === 'custom' ? 'período personalizado' : 'todo o período'
  const activeFilterCount = [filterPatientId, filterPayment, filterCategory].filter(Boolean).length

  // Export functions
  const exportSales = () => {
    const headers = ['Data', 'Paciente', 'OS', 'Pagamento', 'Itens', 'Valor']
    const rows = filteredSales.slice().reverse().map(s => {
      const pat = s.patientId ? patients.find(p => p.id === s.patientId) : null
      return [s.date, pat?.name ?? '—', s.orderId ?? '—', s.paymentMethod, s.items.map(i => `${i.qty}x ${i.name}`).join(' | '), s.total.toFixed(2).replace('.', ',')]
    })
    exportCSV('vendas.csv', headers, rows)
  }

  const exportStock = () => {
    const headers = ['Produto', 'Categoria', 'Quantidade', 'Mínimo', 'Preço Unit.', 'Valor Total', 'Status']
    const rows = stockFiltered.map(s => [
      s.name, s.category, String(s.qty), String(s.min), s.price.toFixed(2).replace('.', ','),
      (s.qty * s.price).toFixed(2).replace('.', ','),
      s.qty <= Math.ceil(s.min * 0.5) ? 'CRÍTICO' : s.qty <= s.min ? 'BAIXO' : 'OK',
    ])
    exportCSV('estoque.csv', headers, rows)
  }

  const exportOrders = () => {
    const headers = ['OS', 'Paciente', 'Status', 'Criada', 'Pronto em', 'Entregue em']
    const rows = orders.map(o => {
      const pat = patients.find(p => p.id === o.patientId)
      return [o.id, pat?.name ?? '—', o.status, o.createdAt, o.readyAt ?? '—', o.deliveredAt ?? '—']
    })
    exportCSV('ordens_servico.csv', headers, rows)
  }

  const exportPatients = () => {
    const headers = ['Nome', 'CPF', 'Telefone', 'Nascimento', 'Cadastro', 'Receitas', 'OS', 'Compras']
    const rows = patients.map(p => [
      p.name, p.cpf, p.phone, p.birthDate, p.createdAt,
      String(prescriptions.filter(r => r.patientId === p.id).length),
      String(orders.filter(o => o.patientId === p.id).length),
      String(sales.filter(s => s.patientId === p.id).length),
    ])
    exportCSV('pacientes.csv', headers, rows)
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Relatórios</h1>
          <p className="mt-0.5 text-[13px] text-slate-400">Resumo gerencial — {periodLabel}{activeFilterCount > 0 ? ` · ${activeFilterCount} filtro(s) ativo(s)` : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowFilters(f => !f)}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${showFilters || activeFilterCount > 0 ? 'border-brand-300 bg-brand-50 text-brand-600' : 'border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:text-brand-600'}`}>
            <Filter className="h-3.5 w-3.5" /> Filtros{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
        </div>
      </div>

      {/* Filters panel */}
      {showFilters && (
        <Card>
          <SectionTitle title="Filtros do relatório" sub="Personalize a visualização dos dados" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-500">Período</label>
              <div className="flex flex-wrap gap-1.5">
                {(['7d', '30d', '90d', 'custom', 'all'] as const).map(p => (
                  <button key={p} onClick={() => setPeriod(p)}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${period === p ? 'bg-brand-500 text-white shadow-sm shadow-brand-500/20' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>
                    {p === '7d' ? '7d' : p === '30d' ? '30d' : p === '90d' ? '90d' : p === 'custom' ? 'Custom' : 'Tudo'}
                  </button>
                ))}
              </div>
            </div>
            {period === 'custom' && (
              <>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">De</label>
                  <div className="relative">
                    <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
                    <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50/80 py-2.5 pl-10 pr-3 text-sm text-slate-800 outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100" />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-500">Até</label>
                  <div className="relative">
                    <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
                    <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} min={dateFrom || undefined}
                      className="w-full rounded-xl border border-slate-200 bg-slate-50/80 py-2.5 pl-10 pr-3 text-sm text-slate-800 outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100" />
                  </div>
                </div>
              </>
            )}
            <SelectField label="Paciente" value={filterPatientId} onChange={setFilterPatientId}
              options={[{ value: '', label: 'Todos' }, ...patients.map(p => ({ value: String(p.id), label: p.name }))]} />
            <SelectField label="Forma de pagamento" value={filterPayment} onChange={setFilterPayment}
              options={[{ value: '', label: 'Todas' }, ...paymentMethods.map(m => ({ value: m, label: m }))]} />
            <SelectField label="Categoria de produto" value={filterCategory} onChange={setFilterCategory}
              options={[{ value: '', label: 'Todas' }, ...productCategories.map(c => ({ value: c, label: c }))]} />
          </div>
          {activeFilterCount > 0 && (
            <button onClick={() => { setFilterPatientId(''); setFilterPayment(''); setFilterCategory(''); setPeriod('30d'); setDateFrom(''); setDateTo('') }}
              className="mt-3 text-xs font-semibold text-rose-500 transition hover:text-rose-700">Limpar todos os filtros</button>
          )}
        </Card>
      )}

      {/* Export buttons */}
      <div className="flex flex-wrap gap-2">
        <button onClick={exportSales} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-brand-300 hover:text-brand-600">
          <Download className="h-3.5 w-3.5" /> Exportar vendas
        </button>
        <button onClick={exportStock} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-brand-300 hover:text-brand-600">
          <Download className="h-3.5 w-3.5" /> Exportar estoque
        </button>
        <button onClick={exportOrders} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-brand-300 hover:text-brand-600">
          <Download className="h-3.5 w-3.5" /> Exportar OS
        </button>
        <button onClick={exportPatients} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-brand-300 hover:text-brand-600">
          <Download className="h-3.5 w-3.5" /> Exportar pacientes
        </button>
      </div>

      {/* Revenue metrics */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <p className="text-[13px] text-slate-400">Faturamento</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">R$ {totalRevenue.toFixed(2).replace('.', ',')}</p>
          <p className="mt-1 text-xs text-slate-400">{filteredSales.length} venda(s)</p>
        </Card>
        <Card>
          <p className="text-[13px] text-slate-400">Ticket médio</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">R$ {avgTicket.toFixed(2).replace('.', ',')}</p>
          <p className="mt-1 text-xs text-slate-400">por venda</p>
        </Card>
        <Card>
          <p className="text-[13px] text-slate-400">Pacientes</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{patients.length}</p>
          <p className="mt-1 text-xs text-slate-400">cadastrados</p>
        </Card>
        <Card>
          <p className="text-[13px] text-slate-400">Valor em estoque</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">R$ {stockValue.toFixed(2).replace('.', ',')}</p>
          <p className="mt-1 text-xs text-slate-400">{stockFiltered.reduce((s, i) => s + i.qty, 0)} unidades{filterCategory ? ` (${filterCategory})` : ''}</p>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Payment breakdown */}
        <Card>
          <SectionTitle title="Formas de pagamento" sub={periodLabel} />
          {paymentBreakdown.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">Nenhuma venda no período</p>
          ) : (
            <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
              {paymentBreakdown.map(([method, data]) => {
                const pct = totalRevenue > 0 ? (data.total / totalRevenue) * 100 : 0
                return (
                  <div key={method} className="rounded-xl bg-slate-50/70 p-3">
                    <div className="mb-1.5 flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-800">{method}</p>
                      <p className="text-sm font-bold text-slate-900">R$ {data.total.toFixed(2)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-slate-200">
                        <div className="h-1.5 rounded-full bg-brand-400 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11px] font-semibold text-slate-400">{pct.toFixed(0)}% · {data.count}x</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        {/* Top products */}
        <Card>
          <SectionTitle title="Produtos mais vendidos" sub={`${periodLabel}${filterCategory ? ` · ${filterCategory}` : ''}`} />
          {topProducts.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">Nenhuma venda no período</p>
          ) : (
            <div className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
              {topProducts.map(([name, data], i) => (
                <div key={name} className="flex items-center justify-between rounded-xl px-3 py-2.5 hover:bg-slate-50">
                  <div className="flex items-center gap-3">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-50 text-xs font-bold text-brand-600">{i + 1}</span>
                    <div>
                      <p className="text-sm font-medium text-slate-800">{name}</p>
                      <p className="text-xs text-slate-400">{data.qty} un vendidas</p>
                    </div>
                  </div>
                  <p className="text-sm font-bold text-slate-900">R$ {data.revenue.toFixed(2)}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {/* OS stats */}
        <Card>
          <SectionTitle title="Ordens de serviço" sub="Status atual" action={
            <button onClick={exportOrders} className="text-xs font-medium text-brand-500 transition hover:text-brand-700"><Download className="mr-1 inline h-3 w-3" />CSV</button>
          } />
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-xl bg-amber-50/60 px-3 py-2.5">
              <span className="text-sm text-slate-700">Em produção</span>
              <span className="text-sm font-bold text-amber-700">{osProduction}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-emerald-50/60 px-3 py-2.5">
              <span className="text-sm text-slate-700">Prontos</span>
              <span className="text-sm font-bold text-emerald-700">{osReady}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-brand-50/60 px-3 py-2.5">
              <span className="text-sm text-slate-700">Entregues</span>
              <span className="text-sm font-bold text-brand-700">{osDelivered}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5">
              <span className="text-sm font-semibold text-slate-700">Total</span>
              <span className="text-sm font-bold text-slate-900">{orders.length}</span>
            </div>
          </div>
        </Card>

        {/* Stock health */}
        <Card>
          <SectionTitle title="Saúde do estoque" sub={`${stockFiltered.length} produtos${filterCategory ? ` (${filterCategory})` : ''}`} action={
            <button onClick={exportStock} className="text-xs font-medium text-brand-500 transition hover:text-brand-700"><Download className="mr-1 inline h-3 w-3" />CSV</button>
          } />
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-xl bg-rose-50/60 px-3 py-2.5">
              <span className="text-sm text-slate-700">Crítico (≤50% mín)</span>
              <span className="text-sm font-bold text-rose-700">{stockCritical}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-amber-50/60 px-3 py-2.5">
              <span className="text-sm text-slate-700">Abaixo do mínimo</span>
              <span className="text-sm font-bold text-amber-700">{stockLow}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-emerald-50/60 px-3 py-2.5">
              <span className="text-sm text-slate-700">Adequado</span>
              <span className="text-sm font-bold text-emerald-700">{stockOk}</span>
            </div>
          </div>
        </Card>

        {/* Rx stats */}
        <Card>
          <SectionTitle title="Receitas" sub={`${prescriptions.length} emitidas`} />
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-xl bg-emerald-50/60 px-3 py-2.5">
              <span className="text-sm text-slate-700">Ativas</span>
              <span className="text-sm font-bold text-emerald-700">{rxActive}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-amber-50/60 px-3 py-2.5">
              <span className="text-sm text-slate-700">Expirando (30 dias)</span>
              <span className="text-sm font-bold text-amber-700">{rxExpiringSoon}</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-rose-50/60 px-3 py-2.5">
              <span className="text-sm text-slate-700">Vencidas</span>
              <span className="text-sm font-bold text-rose-700">{rxExpired}</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Recent sales detail */}
      <Card>
        <SectionTitle title="Histórico de vendas" sub={periodLabel}
          action={<button onClick={exportSales} className="text-xs font-medium text-brand-500 transition hover:text-brand-700"><Download className="mr-1 inline h-3 w-3" />CSV</button>} />
        {filteredSales.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">Nenhuma venda no período selecionado</p>
        ) : (
          <div className="max-h-[400px] overflow-y-auto pr-1">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-100 text-left">
                  <th className="pb-2 pr-4 font-semibold text-slate-500">Data</th>
                  <th className="pb-2 pr-4 font-semibold text-slate-500">Paciente</th>
                  <th className="pb-2 pr-4 font-semibold text-slate-500">OS</th>
                  <th className="pb-2 pr-4 font-semibold text-slate-500">Pagamento</th>
                  <th className="pb-2 text-right font-semibold text-slate-500">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredSales.slice().reverse().map(s => {
                  const pat = s.patientId ? patients.find(p => p.id === s.patientId) : null
                  return (
                    <tr key={s.id} className="transition hover:bg-slate-50">
                      <td className="py-2.5 pr-4 text-slate-600">{s.date}</td>
                      <td className="py-2.5 pr-4 font-medium text-slate-800">{pat?.name ?? '—'}</td>
                      <td className="py-2.5 pr-4 text-slate-500">{s.orderId ?? '—'}</td>
                      <td className="py-2.5 pr-4 text-slate-500">{s.paymentMethod}</td>
                      <td className="py-2.5 text-right font-semibold text-slate-900">R$ {s.total.toFixed(2)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}

/* ================================================================== */
/*  SUB-COMPONENTS                                                     */
/* ================================================================== */

function ActionRowCRM({ icon: Icon, title, sub, tone, onAction }: {
  icon: typeof CalendarDays; title: string; sub: string; tone: 'blue' | 'amber' | 'emerald'; onAction: () => void
}) {
  const colors = { blue: 'bg-brand-50 text-brand-600', amber: 'bg-amber-50 text-amber-600', emerald: 'bg-emerald-50 text-emerald-600' }
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50/70 px-3 py-3 transition hover:bg-slate-50">
      <div className="flex items-start gap-3">
        <div className={`shrink-0 rounded-lg p-2 ${colors[tone]}`}><Icon className="h-4 w-4" /></div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-800">{title}</p>
          <p className="text-xs text-slate-400">{sub}</p>
        </div>
      </div>
      <button onClick={onAction} className="shrink-0 rounded-lg bg-white px-2.5 py-1.5 text-xs font-medium text-slate-500 shadow-card transition hover:text-brand-600 hover:shadow-elevated">
        <MessageCircle className="mr-1 inline h-3.5 w-3.5" /> Ação
      </button>
    </div>
  )
}
