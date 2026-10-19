import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import {
  AlertTriangle, Bell, Boxes, Check, ChevronDown, ChevronRight,
  ClipboardPlus, Edit2, Glasses, LogOut, Phone, Plus, Printer, Send, Settings, Trash2,
  TrendingDown, TrendingUp, UserRound, Users,
} from 'lucide-react'

/* ── Types ── */
import type {
  PageKey, Prescription, ServiceOrder, Sale, Patient, StockItem, CartItem, CartGlassesItem, StockMovement,
  Collaborator, CampaignFilter, Supplier, Payable, CashSession, Tenant, LensCatalogItem, FinanceSummary,
} from './types'

/* ── API ── */
import { api, errorMessage } from './api'
import type { LensInput, PatientInput, PayableInput, SupplierInput, TenantInput, UserInput } from './api'
import type { BootstrapDTO, MovementDTO, OrderDTO, ProductDTO, SaleDTO } from './api/types'
import {
  dmyToISO, mapCashSession, mapLens, mapMovement, mapOrder, mapPatient, mapPayable, mapPrescription,
  mapProduct, mapSale, mapSupplier, mapTenant, mapUser, upsertById,
} from './api/mappers'

/* ── Helpers & constants ── */
import { parseDMY, fmtDate, daysBetween, addMonths, nextBirthdayDate, emptyRx, TODAY, TODAY_D } from './utils/helpers'
import { NAV } from './constants/navigation'
import { PAYMENT_METHODS, PRODUCT_CATEGORIES, brl, parseMoney, todayISO, addDaysISO } from './utils/format'
import { ROLE_LABELS, can, canSeePage } from './lib/permissions'
import { printOrder, printReceipt } from './lib/print'

/* ── Engines ── */
import { computeSuggestions } from './lib/suggestions'
import { computeNotifications } from './lib/notifications'

/* ── UI Components ── */
import { Modal } from './components/ui/Modal'
import { FormField } from './components/ui/FormField'
import { SelectField } from './components/ui/SelectField'
import { InfoBox } from './components/ui/InfoBox'
import { Badge } from './components/ui/Badge'
import { Button } from './components/ui/Button'
import { Toasts, type Toast, type ToastKind } from './components/Toasts'

/* ── Feature Components ── */
import { ArgusLogo } from './components/ArgusLogo'
import { NotificationDropdown } from './components/NotificationDropdown'
import { SmartSearch } from './components/SmartSearch'
import { RxInputRow } from './components/RxInputRow'
import { RxDisplay } from './components/RxDisplay'
import { MobileNav } from './components/MobileNav'
import { useClickOutside } from './hooks/useClickOutside'

/* ── Pages ── */
import { OverviewPage } from './pages/OverviewPage'
import { PdvPage } from './pages/PdvPage'
import { PatientsPage } from './pages/PatientsPage'
import { LabPage } from './pages/LabPage'
import { StockPage } from './pages/StockPage'
import { CollaboratorsPage } from './pages/CollaboratorsPage'
import { ReportsPage } from './pages/ReportsPage'
import { CashPage } from './pages/CashPage'
import { FinancePage } from './pages/FinancePage'
import { SuppliersPage } from './pages/SuppliersPage'
import { SettingsPage } from './pages/SettingsPage'

const STATUS_LABELS: Record<ServiceOrder['status'], string> = {
  production: 'Em produção', ready: 'Pronto', delivered: 'Entregue', cancelled: 'Cancelada',
}

const EMPTY_PATIENT = { name: '', cpf: '', phone: '', email: '', birthDate: '', notes: '' }
const EMPTY_PRODUCT = { name: '', category: 'Armações', min: '', costPrice: '', salePrice: '', commissionPct: '', supplierId: '', sku: '' }
const EMPTY_COLLAB = { name: '', role: 'vendedor' as Collaborator['role'], phone: '', email: '', commissionPct: '', grantAccess: false, password: '', revokeAccess: false }

const byNumber = (o: ServiceOrder) => o.number
const dismissKey = (tenantId: number, userId: number) => `argus-dismissed-notifs-${tenantId}-${userId}`

function readDismissed(key: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(key)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

/* ================================================================== */
/*  APP — MAIN                                                         */
/* ================================================================== */

export default function App({ boot, onLogout, onReload }: { boot: BootstrapDTO; onLogout: () => void; onReload: () => void }) {
  const [page, setPage] = useState<PageKey>('overview')

  // ── Session ──
  const [tenant, setTenant] = useState<Tenant>(() => mapTenant(boot.tenant))
  const [me, setMe] = useState<Collaborator>(() => mapUser(boot.user))
  const role = me.role
  const isManager = can.manage(role)

  // ── Core state (loaded from the API) ──
  const [patients, setPatients] = useState<Patient[]>(() => boot.patients.map(mapPatient).sort((a, b) => a.id - b.id))
  const [stock, setStock] = useState<StockItem[]>(() => boot.products.map(mapProduct).sort((a, b) => a.id - b.id))
  const [lenses, setLenses] = useState<LensCatalogItem[]>(() => boot.lenses.map(mapLens))
  const [prescriptions, setPrescriptions] = useState<Prescription[]>(() => boot.prescriptions.map(mapPrescription).sort((a, b) => a.id - b.id))
  const [orders, setOrders] = useState<ServiceOrder[]>(() => boot.orders.map(mapOrder).sort((a, b) => a.number - b.number))
  const [sales, setSales] = useState<Sale[]>(() => boot.sales.map(mapSale).sort((a, b) => a.id - b.id))
  const [stockMovements, setStockMovements] = useState<StockMovement[]>(() => boot.movements.map(mapMovement).sort((a, b) => a.id - b.id))
  const [collaborators, setCollaborators] = useState<Collaborator[]>(() => boot.users.map(mapUser))
  const [suppliers, setSuppliers] = useState<Supplier[]>(() => boot.suppliers.map(mapSupplier))
  const [payables, setPayables] = useState<Payable[]>(() => boot.payables.map(mapPayable))
  const [cashSession, setCashSession] = useState<CashSession | null>(() => boot.cashSession ? mapCashSession(boot.cashSession) : null)
  const [cart, setCart] = useState<CartItem[]>([])
  const [glassesCart, setGlassesCart] = useState<CartGlassesItem[]>([])

  const completedSales = useMemo(() => sales.filter(s => s.status === 'completed'), [sales])
  const activeLenses = useMemo(() => lenses.filter(l => l.active), [lenses])

  // ── Toasts ──
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastSeq = useRef(0)
  const notify = useCallback((kind: ToastKind, message: string) => {
    const id = ++toastSeq.current
    setToasts(prev => [...prev.slice(-3), { id, kind, message }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), kind === 'error' ? 6000 : 3500)
  }, [])

  /** Runs an API call, showing a success toast or the API error. */
  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: string): Promise<T | null> => {
    try {
      const out = await fn()
      if (success) notify('success', success)
      return out
    } catch (err) {
      notify('error', errorMessage(err))
      return null
    }
  }, [notify])

  const applyEffect = useCallback((effect: { products?: ProductDTO[]; movements?: MovementDTO[] }) => {
    if (effect.products?.length) setStock(prev => upsertById(prev, effect.products!.map(mapProduct)))
    if (effect.movements?.length) setStockMovements(prev => upsertById(prev, effect.movements!.map(mapMovement)))
  }, [])
  const upsertOrders = useCallback((list: OrderDTO[]) => {
    if (list.length) setOrders(prev => upsertById(prev, list.map(mapOrder), byNumber))
  }, [])
  const upsertSales = useCallback((list: SaleDTO[]) => {
    if (list.length) setSales(prev => upsertById(prev, list.map(mapSale)))
  }, [])
  const refreshCash = useCallback(async () => {
    try {
      const { session } = await api.cashCurrent()
      setCashSession(session ? mapCashSession(session) : null)
    } catch { /* non-critical */ }
  }, [])

  // ── Notifications (computed from real data; dismissals per user/device) ──
  const dynamicNotifs = useMemo(() => computeNotifications(patients, prescriptions, orders, stock.filter(s => s.active)), [patients, prescriptions, orders, stock])
  const [dismissedNotifs, setDismissedNotifs] = useState<Set<string>>(() => readDismissed(dismissKey(boot.tenant.id, boot.user.id)))
  useEffect(() => {
    try { window.localStorage.setItem(dismissKey(tenant.id, me.id), JSON.stringify(Array.from(dismissedNotifs))) } catch { /* ignore */ }
  }, [dismissedNotifs, tenant.id, me.id])
  const notifications = useMemo(() => dynamicNotifs.map(n => ({ ...n, read: dismissedNotifs.has(n.id) })), [dynamicNotifs, dismissedNotifs])
  const [notifOpen, setNotifOpen] = useState(false)
  const unreadCount = notifications.filter(n => !n.read).length
  const markRead = useCallback((id: string) => setDismissedNotifs(prev => new Set(prev).add(id)), [])
  const markAllRead = useCallback(() => setDismissedNotifs(new Set(notifications.map(n => n.id))), [notifications])

  const suggestions = useMemo(() => computeSuggestions(stock.filter(s => s.active), orders), [stock, orders])

  // ── Navigation (filtered by role) ──
  const nav = useMemo(() => NAV.filter(n => canSeePage(role, n.key)), [role])
  const goTo = useCallback((p: PageKey) => setPage(canSeePage(role, p) ? p : 'overview'), [role])

  // ── User menu ──
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  useClickOutside(userMenuRef, () => setUserMenuOpen(false))

  // ── UI modals ──
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null)
  const [patientFormOpen, setPatientFormOpen] = useState(false)
  const [patientEditId, setPatientEditId] = useState<number | null>(null)
  const [patientForm, setPatientForm] = useState(EMPTY_PATIENT)
  const [newRxOpen, setNewRxOpen] = useState(false)
  const [newRxPatientId, setNewRxPatientId] = useState<number | null>(null)
  const [newRxOD, setNewRxOD] = useState(emptyRx())
  const [newRxOE, setNewRxOE] = useState(emptyRx())
  const [newRxLensType, setNewRxLensType] = useState('')
  const [newRxPrescriber, setNewRxPrescriber] = useState('')
  const [newRxExamDate, setNewRxExamDate] = useState(TODAY)
  const [newRxExpiresAt, setNewRxExpiresAt] = useState(() => fmtDate(addMonths(TODAY_D, boot.tenant.rxValidityMonths)))
  const [newOsOpen, setNewOsOpen] = useState(false)
  const [newOsRxId, setNewOsRxId] = useState<number | null>(null)
  const [newOsLensItemId, setNewOsLensItemId] = useState<string>('')
  const [newOsFrameItemId, setNewOsFrameItemId] = useState<string>('')
  const [newOsQty, setNewOsQty] = useState<string>('2')
  const [newOsTotal, setNewOsTotal] = useState('')
  const [newOsDueDate, setNewOsDueDate] = useState(addDaysISO(todayISO(), 7))
  const [stockEditId, setStockEditId] = useState<number | null>(null)
  const [stockEditQty, setStockEditQty] = useState('')
  const [stockEditReason, setStockEditReason] = useState('')
  const [stockEditType, setStockEditType] = useState<'adjust' | 'count'>('adjust')
  const [stockLogItemId, setStockLogItemId] = useState<number | null>(null)
  const [campaignOpen, setCampaignOpen] = useState(false)
  const [campaignFilter, setCampaignFilter] = useState<CampaignFilter>({ type: 'birthday', daysAhead: 7 })
  const [orderDetailId, setOrderDetailId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // OS payment / cancellation, sale cancellation
  const [payOrderId, setPayOrderId] = useState<string | null>(null)
  const [payMethod, setPayMethod] = useState('PIX')
  const [payDiscount, setPayDiscount] = useState('')
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null)
  const [cancelSaleId, setCancelSaleId] = useState<number | null>(null)
  const [cancelReason, setCancelReason] = useState('')

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
  const [pdvAddRxExpiresAt, setPdvAddRxExpiresAt] = useState(() => fmtDate(addMonths(TODAY_D, boot.tenant.rxValidityMonths)))
  const [pdvGenerateOs, setPdvGenerateOs] = useState(true)
  const [pdvOsPaid, setPdvOsPaid] = useState(true)
  const [lastSale, setLastSale] = useState<Sale | null>(null)

  // ── Stock: product modal (create/edit) ──
  const [productFormOpen, setProductFormOpen] = useState(false)
  const [productEditId, setProductEditId] = useState<number | null>(null)
  const [productForm, setProductForm] = useState(EMPTY_PRODUCT)

  // ── Stock: entry NF (batch purchase entry) ──
  const [stockEntryOpen, setStockEntryOpen] = useState(false)
  const [stockEntryNF, setStockEntryNF] = useState('')
  const [stockEntrySupplierId, setStockEntrySupplierId] = useState('')
  const [stockEntryPayable, setStockEntryPayable] = useState(true)
  const [stockEntryDueDate, setStockEntryDueDate] = useState('')
  const [stockEntryItems, setStockEntryItems] = useState<{ stockItemId: number; qty: string; costPrice: string }[]>([])

  // ── Collaborators ──
  const [newCollabOpen, setNewCollabOpen] = useState(false)
  const [newCollabForm, setNewCollabForm] = useState(EMPTY_COLLAB)
  const [editCollabId, setEditCollabId] = useState<number | null>(null)

  // Helpers
  const getPatient = (id: number) => patients.find(p => p.id === id)
  const getPatientRxs = (id: number) => prescriptions.filter(r => r.patientId === id)
  const getPatientOrders = (id: number) => orders.filter(o => o.patientId === id)
  const getPatientSales = (id: number) => sales.filter(s => s.patientId === id)
  const getDependents = (clientId: number) => patients.filter(p => p.parentId === clientId)
  const productName = (id: number | null) => (id ? stock.find(s => s.id === id)?.name : undefined) ?? '—'
  const orderLensName = (o: ServiceOrder) => o.lensDescription || (o.lensItemId ? productName(o.lensItemId) : '—')

  const openWhatsAppForPatient = (patient: Patient) => {
    const phoneDigits = patient.phone.replace(/\D/g, '')
    if (phoneDigits.length < 10) {
      notify('error', `Telefone inválido para ${patient.name}.`)
      return false
    }
    window.open(`https://wa.me/55${phoneDigits}`, '_blank', 'noopener,noreferrer')
    return true
  }

  /** Validates an optional dd/mm/aaaa field, returning ISO ('' when empty) or null when invalid. */
  const optionalDate = (dmy: string, label: string): string | null => {
    if (!dmy.trim()) return ''
    const iso = dmyToISO(dmy)
    if (!iso) {
      notify('error', `${label} inválida. Use dd/mm/aaaa.`)
      return null
    }
    return iso
  }

  // ── Patients ──
  const createPatient = async (form: { name: string; cpf: string; phone: string; birthDate: string; email?: string; notes?: string }, parentId?: number): Promise<Patient | null> => {
    const birthDate = optionalDate(form.birthDate, 'Data de nascimento')
    if (birthDate === null) return null
    const input: PatientInput = {
      name: form.name.trim(), cpf: form.cpf.trim(), phone: form.phone.trim(), email: form.email?.trim() ?? '',
      notes: form.notes?.trim() ?? '', birthDate, parentId: parentId ?? null,
    }
    const res = await run(() => api.createPatient(input), parentId ? `Dependente ${input.name} cadastrado!` : 'Paciente cadastrado!')
    if (!res) return null
    const p = mapPatient(res.patient)
    setPatients(prev => upsertById(prev, [p]))
    return p
  }

  const openPatientForm = (p?: Patient) => {
    setPatientEditId(p?.id ?? null)
    setPatientForm(p ? { name: p.name, cpf: p.cpf, phone: p.phone, email: p.email, birthDate: p.birthDate, notes: p.notes } : EMPTY_PATIENT)
    setPatientFormOpen(true)
  }

  const savePatientForm = async () => {
    if (!patientForm.name.trim()) return
    setBusy(true)
    try {
      if (patientEditId === null) {
        if (await createPatient(patientForm)) setPatientFormOpen(false)
        return
      }
      const birthDate = optionalDate(patientForm.birthDate, 'Data de nascimento')
      if (birthDate === null) return
      const current = getPatient(patientEditId)
      const res = await run(() => api.updatePatient(patientEditId, {
        name: patientForm.name.trim(), cpf: patientForm.cpf.trim(), phone: patientForm.phone.trim(),
        email: patientForm.email.trim(), notes: patientForm.notes.trim(), birthDate, parentId: current?.parentId ?? null,
      }), 'Cadastro atualizado!')
      if (res) {
        setPatients(prev => upsertById(prev, [mapPatient(res.patient)]))
        setPatientFormOpen(false)
      }
    } finally {
      setBusy(false)
    }
  }

  // ── Prescriptions ──
  const createPrescription = async (patientId: number, od: Prescription['rxOD'], oe: Prescription['rxOE'], lensType: string,
    examDMY: string, expiresDMY: string, prescriber = ''): Promise<Prescription | null> => {
    const examDate = dmyToISO(examDMY)
    if (!examDate) {
      notify('error', 'Data do exame inválida. Use dd/mm/aaaa.')
      return null
    }
    const expiresAt = optionalDate(expiresDMY, 'Validade da receita')
    if (expiresAt === null) return null
    const res = await run(() => api.createPrescription({
      patientId, rxOD: od, rxOE: oe, examDate, expiresAt, lensType: lensType.trim() || 'Simples', prescriber: prescriber.trim(),
    }), 'Prescrição salva!')
    if (!res) return null
    const rx = mapPrescription(res.prescription)
    setPrescriptions(prev => upsertById(prev, [rx]))
    return rx
  }

  const resetRxForm = () => {
    setNewRxOD(emptyRx()); setNewRxOE(emptyRx()); setNewRxLensType(''); setNewRxPrescriber('')
    setNewRxExamDate(TODAY); setNewRxExpiresAt(fmtDate(addMonths(TODAY_D, tenant.rxValidityMonths)))
  }

  const saveNewPrescription = async () => {
    if (!newRxPatientId) return
    setBusy(true)
    const rx = await createPrescription(newRxPatientId, newRxOD, newRxOE, newRxLensType, newRxExamDate, newRxExpiresAt, newRxPrescriber)
    setBusy(false)
    if (rx) {
      resetRxForm()
      setNewRxOpen(false); setNewRxPatientId(null)
    }
  }

  // ── Service orders ──
  const openNewOS = (rxId: number | null) => {
    setNewOsRxId(rxId); setNewOsLensItemId(''); setNewOsFrameItemId(''); setNewOsQty('2'); setNewOsTotal('')
    setNewOsDueDate(addDaysISO(todayISO(), 7)); setNewOsOpen(true)
  }

  // Suggest the OS value as frame + lens price whenever the selection changes.
  const selectOsItem = (kind: 'frame' | 'lens', value: string) => {
    const frameId = kind === 'frame' ? value : newOsFrameItemId
    const lensId = kind === 'lens' ? value : newOsLensItemId
    if (kind === 'frame') setNewOsFrameItemId(value)
    else setNewOsLensItemId(value)
    const frame = stock.find(s => s.id === parseInt(frameId))
    const lens = stock.find(s => s.id === parseInt(lensId))
    setNewOsTotal(frame || lens ? ((frame?.price ?? 0) + (lens?.price ?? 0)).toFixed(2).replace('.', ',') : '')
  }

  const createServiceOrder = async () => {
    if (!newOsRxId || !newOsLensItemId || !newOsFrameItemId) return
    const total = parseMoney(newOsTotal)
    if (!(total >= 0)) {
      notify('error', 'Informe um valor válido para a OS.')
      return
    }
    setBusy(true)
    const res = await run(() => api.createOrder({
      prescriptionId: newOsRxId, frameProductId: parseInt(newOsFrameItemId), lensProductId: parseInt(newOsLensItemId),
      lensQty: parseInt(newOsQty, 10), total, dueDate: newOsDueDate,
    }))
    setBusy(false)
    if (!res) return
    upsertOrders([res.order])
    applyEffect(res)
    notify('success', `OS-${res.order.number} aberta e estoque baixado.`)
    setNewOsOpen(false); setNewOsRxId(null)
  }

  const advanceOrder = async (id: string) => {
    const o = orders.find(x => x.id === id)
    if (!o) return
    if (o.status === 'ready' && !o.paid && o.total > 0) {
      notify('info', 'Registre o pagamento antes de entregar.')
      openPayOrder(o.id)
      return
    }
    const res = await run(() => api.advanceOrder(o.number), o.status === 'production' ? `${o.id} pronta para retirada` : `${o.id} entregue`)
    if (res) upsertOrders([res.order])
  }

  const openPayOrder = (id: string) => {
    setPayOrderId(id); setPayMethod('PIX'); setPayDiscount('')
  }

  const confirmPayOrder = async () => {
    const o = orders.find(x => x.id === payOrderId)
    if (!o) return
    const discount = payDiscount ? parseMoney(payDiscount) : 0
    if (!(discount >= 0) || discount > o.total) {
      notify('error', 'Desconto inválido.')
      return
    }
    setBusy(true)
    const res = await run(() => api.payOrder(o.number, payMethod, discount), `Pagamento de ${o.id} registrado!`)
    setBusy(false)
    if (!res) return
    upsertOrders([res.order])
    upsertSales([res.sale])
    setLastSale(mapSale(res.sale))
    setPayOrderId(null)
    refreshCash()
  }

  const confirmCancelOrder = async () => {
    const o = orders.find(x => x.id === cancelOrderId)
    if (!o || cancelReason.trim().length < 3) return
    setBusy(true)
    const res = await run(() => api.cancelOrder(o.number, cancelReason.trim()), `${o.id} cancelada e estoque devolvido.`)
    setBusy(false)
    if (!res) return
    upsertOrders([res.order])
    applyEffect(res)
    setCancelOrderId(null); setCancelReason('')
  }

  const confirmCancelSale = async () => {
    if (cancelSaleId === null || cancelReason.trim().length < 3) return
    setBusy(true)
    const res = await run(() => api.cancelSale(cancelSaleId, cancelReason.trim()), `Venda #${cancelSaleId} cancelada.`)
    setBusy(false)
    if (!res) return
    upsertSales([res.sale])
    upsertOrders(res.orders)
    applyEffect(res)
    setCancelSaleId(null); setCancelReason('')
    refreshCash()
  }

  const printOrderById = (id: string) => {
    const o = orders.find(x => x.id === id)
    if (!o) return
    printOrder(o, tenant, getPatient(o.patientId), prescriptions.find(r => r.id === o.prescriptionId), productName(o.frameItemId), orderLensName(o))
  }
  const printSale = (s: Sale) => printReceipt(s, tenant, s.patientId ? getPatient(s.patientId) : undefined)

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
  const clearFullCart = () => { setCart([]); setGlassesCart([]) }
  const accessoriesTotal = cart.reduce((s, c) => s + c.price * c.qty, 0)
  const glassesTotal = glassesCart.reduce((s, g) => s + g.framePrice + g.lensPrice, 0)
  const cartTotal = accessoriesTotal + glassesTotal

  const resetGlassesForm = () => {
    setPdvGlassesBeneficiary(null); setPdvGlassesFrame(''); setPdvGlassesLens('')
    setPdvGlassesRxId(null); setPdvGlassesIsReady(false)
  }

  const addGlassesToCart = () => {
    if (!pdvGlassesBeneficiary || !pdvGlassesFrame) return
    const frameId = parseInt(pdvGlassesFrame)
    const frameItem = stock.find(s => s.id === frameId)
    if (!frameItem || frameItem.qty < 1) return
    const alreadyInCart = glassesCart.filter(g => g.frameStockItemId === frameId).length
    if (alreadyInCart >= frameItem.qty) {
      notify('error', `Estoque insuficiente de ${frameItem.name}.`)
      return
    }
    const lens = pdvGlassesLens ? lenses.find(l => l.id === parseInt(pdvGlassesLens)) : undefined
    const beneficiary = patients.find(p => p.id === pdvGlassesBeneficiary)
    setGlassesCart(prev => [...prev, {
      id: Date.now(),
      beneficiaryId: pdvGlassesBeneficiary,
      beneficiaryName: beneficiary?.name ?? '—',
      frameStockItemId: frameId,
      frameName: frameItem.name,
      framePrice: frameItem.price,
      lensId: lens?.id ?? 0,
      lensName: lens?.name ?? 'Sem lente',
      lensPrice: lens?.price ?? 0,
      prescriptionId: pdvGlassesIsReady ? null : pdvGlassesRxId,
      isReadyMade: pdvGlassesIsReady,
    }])
    setPdvAddGlassesOpen(false)
    resetGlassesForm()
  }

  const savePdvPrescription = async () => {
    if (!pdvGlassesBeneficiary) return
    setBusy(true)
    const rx = await createPrescription(pdvGlassesBeneficiary, pdvAddRxOD, pdvAddRxOE, pdvAddRxLensType, pdvAddRxExamDate, pdvAddRxExpiresAt)
    setBusy(false)
    if (!rx) return
    setPdvGlassesRxId(rx.id)
    setPdvAddRxOD(emptyRx()); setPdvAddRxOE(emptyRx()); setPdvAddRxLensType('')
    setPdvAddRxExamDate(TODAY); setPdvAddRxExpiresAt(fmtDate(addMonths(TODAY_D, tenant.rxValidityMonths)))
    setPdvAddRxOpen(false)
  }

  const createPdvClient = async () => {
    if (!pdvNewClientForm.name.trim()) return
    setBusy(true)
    const p = await createPatient(pdvNewClientForm)
    setBusy(false)
    if (!p) return
    setPdvClientId(p.id)
    setPdvNewClientForm({ name: '', cpf: '', phone: '', birthDate: '' })
    setPdvNewClientOpen(false)
  }

  const createPdvDependent = async () => {
    if (!pdvNewDependentForm.name.trim() || !pdvClientId) return
    setBusy(true)
    const p = await createPatient(pdvNewDependentForm, pdvClientId)
    setBusy(false)
    if (!p) return
    setPdvNewDependentForm({ name: '', cpf: '', phone: '', birthDate: '' })
    setPdvNewDependentOpen(false)
  }

  /** Finalizes the PDV checkout on the server. Returns true on success. */
  const finalizeSale = async (paymentMethod: string, discount: number, dueDate: string): Promise<boolean> => {
    if (!pdvClientId || (cart.length === 0 && glassesCart.length === 0)) return false
    const generateOs = glassesCart.length > 0 && pdvGenerateOs
    const res = await run(() => api.createSale({
      patientId: pdvClientId,
      items: cart.map(c => ({ productId: c.stockItemId, qty: c.qty })),
      glasses: glassesCart.map(g => ({
        beneficiaryId: g.beneficiaryId, frameProductId: g.frameStockItemId, lensId: g.lensId || null,
        prescriptionId: g.isReadyMade ? null : g.prescriptionId, readyMade: g.isReadyMade,
      })),
      generateOs, osPaid: pdvOsPaid, dueDate: generateOs ? dueDate : '', paymentMethod, discount,
    }))
    if (!res) return false
    if (res.sale) {
      upsertSales([res.sale])
      setLastSale(mapSale(res.sale))
    }
    upsertOrders(res.orders)
    applyEffect(res)
    const osLabels = res.orders.map(o => `OS-${o.number}`).join(', ')
    notify('success', res.sale
      ? `Venda #${res.sale.id} registrada${osLabels ? ` · ${osLabels} aberta(s)` : ''}`
      : `${osLabels} aberta(s) — pagamento na entrega`)
    setCart([]); setGlassesCart([])
    setPdvClientId(null); setPdvGenerateOs(true); setPdvOsPaid(true)
    refreshCash()
    return true
  }

  // ── Stock adjust / physical count ──
  const adjustStock = async () => {
    if (stockEditId === null) return
    const newQty = parseInt(stockEditQty, 10)
    if (isNaN(newQty) || newQty < 0) return
    if (!stockEditReason.trim() && stockEditType === 'adjust') return
    setBusy(true)
    const res = await run(() => api.adjustStock(stockEditId, newQty, stockEditType, stockEditReason.trim()),
      stockEditType === 'count' ? 'Contagem registrada!' : 'Ajuste registrado!')
    setBusy(false)
    if (!res) return
    applyEffect({ products: [res.product], movements: res.movements })
    setStockEditId(null); setStockEditQty(''); setStockEditReason(''); setStockEditType('adjust')
  }

  // ── Product create / edit ──
  const openProductForm = (p?: StockItem) => {
    setProductEditId(p?.id ?? null)
    setProductForm(p ? {
      name: p.name, category: p.category, min: String(p.min), costPrice: String(p.costPrice), salePrice: String(p.price),
      commissionPct: String(p.commissionPct), supplierId: p.supplierId ? String(p.supplierId) : '', sku: p.sku,
    } : EMPTY_PRODUCT)
    setProductFormOpen(true)
  }

  const saveProduct = async () => {
    const f = productForm
    const price = parseMoney(f.salePrice)
    if (!f.name.trim() || !(price > 0)) return
    const supplierId = f.supplierId ? Number(f.supplierId) : null
    const input = {
      name: f.name.trim(), category: f.category, sku: f.sku.trim(), price, costPrice: parseMoney(f.costPrice) || 0,
      commissionPct: parseFloat(f.commissionPct) || 0, min: parseInt(f.min, 10) || 0, supplierId,
      supplier: supplierId ? suppliers.find(s => s.id === supplierId)?.name ?? '' : '',
    }
    setBusy(true)
    const res = productEditId === null
      ? await run(() => api.createProduct(input), 'Produto cadastrado! Use "Entrada NF" para dar entrada no estoque.')
      : await run(() => api.updateProduct(productEditId, input), 'Produto atualizado!')
    setBusy(false)
    if (!res) return
    applyEffect({ products: [res.product] })
    setProductFormOpen(false)
  }

  const toggleProductActive = async (p: StockItem) => {
    const res = await run(() => api.updateProduct(p.id, {
      name: p.name, category: p.category, sku: p.sku, price: p.price, costPrice: p.costPrice, commissionPct: p.commissionPct,
      min: p.min, supplierId: p.supplierId, supplier: p.supplier, active: !p.active,
    }), p.active ? 'Produto desativado' : 'Produto reativado')
    if (res) applyEffect({ products: [res.product] })
  }

  // ── Stock entry (batch purchase with NF) ──
  const openStockEntry = (preSelectId?: number) => {
    setStockEntryNF(''); setStockEntrySupplierId(''); setStockEntryPayable(true); setStockEntryDueDate('')
    if (preSelectId) {
      const item = stock.find(s => s.id === preSelectId)
      setStockEntryItems([{ stockItemId: preSelectId, qty: '', costPrice: item?.costPrice ? String(item.costPrice) : '' }])
      if (item?.supplierId) setStockEntrySupplierId(String(item.supplierId))
    } else {
      setStockEntryItems([])
    }
    setStockEntryOpen(true)
  }
  const addStockEntryItem = () => setStockEntryItems(prev => [...prev, { stockItemId: 0, qty: '', costPrice: '' }])
  const removeStockEntryItem = (idx: number) => setStockEntryItems(prev => prev.filter((_, i) => i !== idx))
  const updateStockEntryItem = (idx: number, field: string, value: string | number) => setStockEntryItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item))
  const validEntryItems = stockEntryItems.filter(ei => ei.stockItemId > 0 && parseInt(ei.qty, 10) > 0)
  const submitStockEntry = async () => {
    if (validEntryItems.length === 0) return
    const supplierId = stockEntrySupplierId ? Number(stockEntrySupplierId) : null
    setBusy(true)
    const res = await run(() => api.stockEntry({
      invoiceNumber: stockEntryNF.trim(), supplierId, supplier: '',
      items: validEntryItems.map(ei => {
        const cost = parseMoney(ei.costPrice)
        return { productId: ei.stockItemId, qty: parseInt(ei.qty, 10), ...(cost > 0 ? { costPrice: cost } : {}) }
      }),
      createPayable: stockEntryPayable, dueDate: stockEntryDueDate,
    }))
    setBusy(false)
    if (!res) return
    applyEffect(res)
    if (res.payable) setPayables(prev => upsertById(prev, [mapPayable(res.payable!)]))
    notify('success', `Entrada registrada! ${validEntryItems.length} produto(s)${res.payable ? ` · conta a pagar de ${brl(res.payable.amount)} criada` : ''}`)
    setStockEntryOpen(false); setStockEntryItems([])
  }

  // ── Collaborators ──
  const saveCollaborator = async () => {
    const f = newCollabForm
    if (!f.name.trim()) return
    const current = editCollabId !== null ? collaborators.find(c => c.id === editCollabId) : undefined
    const wantsAccess = f.grantAccess || (current?.hasAccess && !f.revokeAccess)
    if (wantsAccess && !f.email.trim()) {
      notify('error', 'Informe o e-mail para dar acesso ao sistema.')
      return
    }
    if (f.grantAccess && !current?.hasAccess && f.password.length < 8) {
      notify('error', 'A senha de acesso precisa ter pelo menos 8 caracteres.')
      return
    }
    if (f.password && f.password.length < 8) {
      notify('error', 'A senha de acesso precisa ter pelo menos 8 caracteres.')
      return
    }
    const input: UserInput = {
      name: f.name.trim(), role: f.role, phone: f.phone.trim(), email: f.email.trim(), commissionPct: parseFloat(f.commissionPct) || 0,
      ...(f.password ? { password: f.password } : {}), ...(f.revokeAccess ? { revokeAccess: true } : {}),
    }
    setBusy(true)
    const res = editCollabId !== null
      ? await run(() => api.updateUser(editCollabId, input), 'Colaborador atualizado!')
      : await run(() => api.createUser(input), 'Colaborador adicionado!')
    setBusy(false)
    if (!res) return
    const u = mapUser(res.user)
    setCollaborators(prev => upsertById(prev, [u]))
    if (u.id === me.id) setMe(u)
    setNewCollabOpen(false); setEditCollabId(null)
  }
  const toggleCollaboratorActive = async (id: number) => {
    const res = await run(() => api.toggleUser(id))
    if (res) setCollaborators(prev => upsertById(prev, [mapUser(res.user)]))
  }
  const startEditCollaborator = (c: Collaborator) => {
    setNewCollabForm({ name: c.name, role: c.role, phone: c.phone, email: c.email, commissionPct: String(c.commissionPct), grantAccess: false, password: '', revokeAccess: false })
    setEditCollabId(c.id)
    setNewCollabOpen(true)
  }

  // ── Cash register ──
  const cashOpen = async (amount: number, notes: string) => {
    const res = await run(() => api.cashOpen(amount, notes), 'Caixa aberto!')
    if (res) setCashSession(mapCashSession(res.session))
    return !!res
  }
  const cashClose = async (amount: number, notes: string) => {
    const res = await run(() => api.cashClose(amount, notes), 'Caixa fechado!')
    if (!res) return null
    setCashSession(null)
    return mapCashSession(res.session)
  }
  const cashMovement = async (type: 'withdrawal' | 'deposit', amount: number, reason: string) => {
    const res = await run(() => api.cashMovement(type, amount, reason), type === 'withdrawal' ? 'Sangria registrada' : 'Suprimento registrado')
    if (res) setCashSession(mapCashSession(res.session))
    return !!res
  }
  const loadCashHistory = useCallback(async () => (await api.cashSessions()).sessions.map(mapCashSession), [])

  // ── Finance ──
  const loadFinanceSummary = useCallback(async (from: string, to: string): Promise<FinanceSummary | null> => {
    try {
      return (await api.financeSummary(from, to)).summary
    } catch (err) {
      notify('error', errorMessage(err))
      return null
    }
  }, [notify])
  const createPayable = async (input: PayableInput) => {
    const res = await run(() => api.createPayable(input), 'Conta cadastrada!')
    if (res) setPayables(prev => upsertById(prev, [mapPayable(res.payable)]))
    return !!res
  }
  const payPayable = async (id: number, paidAt: string, amount?: number) => {
    const res = await run(() => api.payPayable(id, paidAt, amount), 'Pagamento registrado!')
    if (res) setPayables(prev => upsertById(prev, [mapPayable(res.payable)]))
    return !!res
  }
  const cancelPayable = async (id: number, reason: string) => {
    const res = await run(() => api.cancelPayable(id, reason), 'Conta cancelada')
    if (res) setPayables(prev => upsertById(prev, [mapPayable(res.payable)]))
    return !!res
  }

  // ── Suppliers ──
  const saveSupplier = async (id: number | null, input: SupplierInput) => {
    const res = id === null
      ? await run(() => api.createSupplier(input), 'Fornecedor cadastrado!')
      : await run(() => api.updateSupplier(id, input), 'Fornecedor atualizado!')
    if (!res) return false
    const s = mapSupplier(res.supplier)
    setSuppliers(prev => upsertById(prev, [s]).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)))
    setStock(prev => prev.map(p => p.supplierId === s.id ? { ...p, supplier: s.name } : p))
    return true
  }

  // ── Settings ──
  const saveTenant = async (input: TenantInput) => {
    const res = await run(() => api.updateTenant(input), 'Configurações salvas!')
    if (res) setTenant(mapTenant(res.tenant))
    return !!res
  }
  const changePassword = async (current: string, next: string) => !!(await run(() => api.changePassword(current, next), 'Senha alterada!'))
  const saveLens = async (id: number | null, input: LensInput) => {
    const res = id === null
      ? await run(() => api.createLens(input), 'Lente cadastrada!')
      : await run(() => api.updateLens(id, input), 'Lente atualizada!')
    if (res) setLenses(prev => upsertById(prev, [mapLens(res.lens)]).sort((a, b) => a.lensType.localeCompare(b.lensType) || a.price - b.price))
    return !!res
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

  const initials = me.name.split(' ').filter(w => !/^(dr|dra)\.?$/i.test(w)).map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const cashRequiredAndClosed = tenant.requireCashSession && !cashSession

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <div className="flex min-h-screen w-full bg-[#f6f8fb]">
      <Toasts toasts={toasts} onDismiss={id => setToasts(prev => prev.filter(t => t.id !== id))} />

      {/* ── Sidebar ── */}
      <aside className="hidden w-[68px] shrink-0 flex-col items-center border-r border-slate-200/50 bg-white py-5 lg:flex">
        <div className="mb-8"><ArgusLogo size={30} /></div>
        <nav className="flex flex-1 flex-col items-center gap-1">
          {nav.map(item => {
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

      {/* ── Mobile nav ── */}
      <MobileNav page={page} onChangePage={setPage} nav={nav} />

      {/* ── Main ── */}
      <div className="flex flex-1 flex-col overflow-x-hidden pb-20 lg:pb-0">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-slate-200/50 bg-white/80 px-3 py-3 backdrop-blur-md sm:gap-4 sm:px-6">
          <div className="mr-1 lg:hidden"><ArgusLogo size={24} /></div>
          <SmartSearch patients={patients} orders={orders} onSelectPatient={p => setSelectedPatientId(p.id)} onSelectOrder={o => setOrderDetailId(o.id)} />
          <div className="ml-auto flex items-center gap-1 sm:gap-2 shrink-0">
            {can.sell(role) && (
              <button onClick={() => setPage('cash')} title={cashSession ? 'Caixa aberto' : 'Caixa fechado'}
                className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold sm:inline-flex ${cashSession ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${cashSession ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                {cashSession ? 'Caixa aberto' : 'Caixa fechado'}
              </button>
            )}
            <div className="relative">
              <button onClick={() => setNotifOpen(p => !p)} aria-label="Notificações" className="relative rounded-xl p-2 text-slate-400 transition hover:bg-slate-50 hover:text-slate-600">
                <Bell className="h-[18px] w-[18px]" />
                {unreadCount > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-[9px] font-bold text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>}
              </button>
              <NotificationDropdown notifications={notifications} open={notifOpen} onClose={() => setNotifOpen(false)} onMarkRead={markRead} onMarkAllRead={markAllRead} />
            </div>
            <div className="relative" ref={userMenuRef}>
              <button onClick={() => setUserMenuOpen(o => !o)} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition hover:bg-slate-50" aria-haspopup="menu" aria-expanded={userMenuOpen}>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-500 text-xs font-bold text-white">{initials}</div>
                <div className="hidden text-left sm:block">
                  <p className="text-[13px] font-semibold leading-tight text-slate-800">{me.name}</p>
                  <p className="text-[11px] leading-tight text-slate-400">{ROLE_LABELS[role]}</p>
                </div>
                <ChevronDown className="hidden h-3.5 w-3.5 text-slate-300 sm:block" />
              </button>
              {userMenuOpen && (
                <div role="menu" className="absolute right-0 top-full z-50 mt-1.5 w-56 animate-fadeIn rounded-xl bg-white py-1.5 shadow-dropdown">
                  <div className="border-b border-slate-100 px-4 pb-2 pt-1">
                    <p className="truncate text-sm font-semibold text-slate-800">{tenant.name}</p>
                    <p className="truncate text-[11px] text-slate-400">{me.email}</p>
                  </div>
                  <button role="menuitem" onClick={() => { setPage('settings'); setUserMenuOpen(false) }} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-600 hover:bg-slate-50">
                    <Settings className="h-4 w-4" /> Configurações
                  </button>
                  <button role="menuitem" onClick={() => { setUserMenuOpen(false); onReload() }} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-600 hover:bg-slate-50">
                    <TrendingUp className="h-4 w-4" /> Recarregar dados
                  </button>
                  <button role="menuitem" onClick={onLogout} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-rose-600 hover:bg-rose-50">
                    <LogOut className="h-4 w-4" /> Sair
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page */}
        <main className="flex-1 px-4 py-5 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-[1360px] animate-rise space-y-5">
            {page === 'overview' && <OverviewPage patients={patients} prescriptions={prescriptions} orders={orders} stock={stock.filter(s => s.active)} sales={completedSales}
              suggestions={suggestions} onAdvanceOrder={advanceOrder} userName={me.name}
              onOpenCampaign={() => setCampaignOpen(true)} onGoToPage={goTo} />}
            {page === 'pdv' && <PdvPage stock={stock.filter(s => s.active)} patients={patients}
              cart={cart} glassesCart={glassesCart} cartTotal={cartTotal} glassesTotal={glassesTotal}
              onAddToCart={addToCart} onRemoveFromCart={removeFromCart} onRemoveGlasses={removeGlassesFromCart}
              onClearCart={clearFullCart} onFinalizeSale={finalizeSale}
              pdvClientId={pdvClientId} onSelectClient={setPdvClientId}
              onOpenNewClient={() => setPdvNewClientOpen(true)}
              onOpenNewDependent={() => setPdvNewDependentOpen(true)}
              onOpenAddGlasses={() => setPdvAddGlassesOpen(true)}
              getDependents={getDependents}
              generateOs={pdvGenerateOs} onToggleOs={setPdvGenerateOs}
              osPaid={pdvOsPaid} onToggleOsPaid={setPdvOsPaid}
              cashBlocked={cashRequiredAndClosed} onGoToCash={() => setPage('cash')}
              lastSale={lastSale} onPrintSale={printSale} />}
            {page === 'cash' && <CashPage session={cashSession} sales={sales} patients={patients} canManage={isManager}
              onOpen={cashOpen} onClose={cashClose} onMovement={cashMovement} loadHistory={loadCashHistory} />}
            {page === 'patients' && <PatientsPage patients={patients} prescriptions={prescriptions} orders={orders} sales={completedSales}
              onSelectPatient={id => setSelectedPatientId(id)} onNewPatient={can.clinical(role) ? () => openPatientForm() : undefined}
              onNewRx={can.clinical(role) ? (pid) => { resetRxForm(); setNewRxPatientId(pid); setNewRxOpen(true) } : undefined} />}
            {page === 'lab' && <LabPage orders={orders} patients={patients} prescriptions={prescriptions} stock={stock}
              onAdvanceOrder={advanceOrder} onNewOS={can.clinical(role) ? openNewOS : undefined}
              onViewOrder={id => setOrderDetailId(id)} onPayOrder={can.sell(role) ? openPayOrder : undefined}
              onCancelOrder={isManager ? (id) => { setCancelOrderId(id); setCancelReason('') } : undefined}
              onPrintOrder={printOrderById} />}
            {page === 'stock' && <StockPage stock={stock} stockMovements={stockMovements} suggestions={suggestions} canManage={isManager}
              onAdjustStock={(id, qty) => { setStockEditId(id); setStockEditQty(String(qty)); setStockEditReason(''); setStockEditType('adjust') }}
              onPhysicalCount={(id, qty) => { setStockEditId(id); setStockEditQty(String(qty)); setStockEditReason(''); setStockEditType('count') }}
              onNewProduct={() => openProductForm()} onEditProduct={openProductForm} onToggleActive={toggleProductActive}
              onStockEntry={openStockEntry} onViewLog={id => setStockLogItemId(id)} />}
            {page === 'suppliers' && <SuppliersPage suppliers={suppliers} products={stock} payables={payables} onSave={saveSupplier} />}
            {page === 'finance' && <FinancePage payables={payables} suppliers={suppliers} orders={orders} patients={patients}
              loadSummary={loadFinanceSummary} onCreatePayable={createPayable} onPayPayable={payPayable}
              onCancelPayable={cancelPayable} onReceiveOrder={openPayOrder} />}
            {page === 'reports' && <ReportsPage patients={patients} prescriptions={prescriptions} orders={orders.filter(o => o.status !== 'cancelled')} sales={completedSales} stock={stock} />}
            {page === 'collaborators' && <CollaboratorsPage collaborators={collaborators} currentUserId={me.id}
              onNew={() => { setEditCollabId(null); setNewCollabForm(EMPTY_COLLAB); setNewCollabOpen(true) }}
              onEdit={startEditCollaborator} onToggleActive={toggleCollaboratorActive} />}
            {page === 'settings' && <SettingsPage tenant={tenant} user={me} lenses={lenses} canManage={isManager}
              onSaveTenant={saveTenant} onChangePassword={changePassword} onSaveLens={saveLens} />}
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
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600"><UserRound className="h-6 w-6" /></div>
                  <div>
                    <p className="font-semibold text-slate-900">{p.name}</p>
                    <p className="text-sm text-slate-400">{[p.cpf, p.phone, p.email].filter(Boolean).join(' · ') || 'Sem contato cadastrado'}</p>
                    {parent && <p className="text-xs text-brand-500">Dependente de: {parent.name}</p>}
                  </div>
                </div>
                {can.clinical(role) && (
                  <button onClick={() => openPatientForm(p)} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:border-brand-300 hover:text-brand-600">
                    <Edit2 className="h-3 w-3" /> Editar
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <InfoBox label="Aniversário" value={p.birthDate || '—'} />
                <InfoBox label="Cadastro" value={p.createdAt} />
                <InfoBox label="Receitas" value={String(rxs.length)} />
                <InfoBox label="Compras" value={String(sls.filter(s => s.status === 'completed').length)} />
              </div>
              {p.notes && <p className="rounded-xl bg-amber-50/60 px-3 py-2 text-xs text-amber-800">{p.notes}</p>}

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

              {rxs.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-slate-700">Prescrições</h4>
                  {rxs.slice().reverse().map(rx => {
                    const exp = parseDMY(rx.expiresAt)
                    const daysLeft = exp ? daysBetween(TODAY_D, exp) : 999
                    return (
                      <div key={rx.id} className="mb-2 rounded-xl border border-slate-100 bg-slate-50 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-sm font-semibold text-slate-800">Exame: {rx.examDate} · {rx.lensType}{rx.prescriber ? ` · ${rx.prescriber}` : ''}</p>
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

              {ords.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-slate-700">Ordens de serviço</h4>
                  {ords.slice().reverse().map(o => (
                    <button key={o.id} onClick={() => { setSelectedPatientId(null); setOrderDetailId(o.id) }}
                      className="mb-2 flex w-full items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-left transition hover:border-brand-200">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{o.id} · {brl(o.total)}</p>
                        <p className="text-xs text-slate-400">
                          Criada: {o.createdAt}
                          {o.readyAt && ` · Pronto: ${o.readyAt}`}
                          {o.deliveredAt && ` · Entregue: ${o.deliveredAt}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {!o.paid && o.status !== 'cancelled' && o.total > 0 && <Badge color="amber">A receber</Badge>}
                        <Badge color={o.status === 'delivered' ? 'emerald' : o.status === 'ready' ? 'blue' : o.status === 'cancelled' ? 'slate' : 'amber'}>{STATUS_LABELS[o.status]}</Badge>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {sls.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-semibold text-slate-700">Histórico de compras</h4>
                  {sls.slice().reverse().map(s => (
                    <div key={s.id} className={`mb-2 rounded-xl border px-3 py-2.5 ${s.status === 'cancelled' ? 'border-rose-100 bg-rose-50/40' : 'border-slate-100 bg-slate-50'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-800">{brl(s.total)} — {s.paymentMethod}{s.status === 'cancelled' && <span className="ml-2 text-xs font-semibold text-rose-600">Cancelada</span>}</p>
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-slate-400">#{s.id} · {s.date}{s.orderId ? ` · ${s.orderId}` : ''}</p>
                          <button onClick={() => printSale(s)} title="Imprimir recibo" className="rounded p-1 text-slate-400 hover:text-brand-600"><Printer className="h-3.5 w-3.5" /></button>
                          {isManager && s.status === 'completed' && (
                            <button onClick={() => { setCancelSaleId(s.id); setCancelReason('') }} className="text-[11px] font-semibold text-rose-500 hover:text-rose-700">Cancelar</button>
                          )}
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-slate-400">{s.items.map(i => `${i.qty}× ${i.name}`).join(', ')}</p>
                    </div>
                  ))}
                </div>
              )}

              {can.clinical(role) && (
                <button onClick={() => { resetRxForm(); setNewRxPatientId(p.id); setNewRxOpen(true); setSelectedPatientId(null) }}
                  className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600">
                  <ClipboardPlus className="h-4 w-4" /> Nova prescrição
                </button>
              )}
            </div>
          )
        })()}
      </Modal>

      {/* New / edit patient */}
      <Modal open={patientFormOpen} onClose={() => setPatientFormOpen(false)} title={patientEditId === null ? 'Novo paciente' : 'Editar paciente'}>
        <div className="space-y-3">
          <FormField label="Nome completo" value={patientForm.name} onChange={v => setPatientForm(p => ({ ...p, name: v }))} placeholder="Ex: João Silva" />
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="CPF" value={patientForm.cpf} onChange={v => setPatientForm(p => ({ ...p, cpf: v }))} placeholder="000.000.000-00" />
            <FormField label="Data de nascimento" value={patientForm.birthDate} onChange={v => setPatientForm(p => ({ ...p, birthDate: v }))} placeholder="dd/mm/aaaa" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Telefone / WhatsApp" value={patientForm.phone} onChange={v => setPatientForm(p => ({ ...p, phone: v }))} placeholder="(00) 00000-0000" />
            <FormField label="E-mail" value={patientForm.email} onChange={v => setPatientForm(p => ({ ...p, email: v }))} placeholder="email@exemplo.com" />
          </div>
          <FormField label="Observações" value={patientForm.notes} onChange={v => setPatientForm(p => ({ ...p, notes: v }))} placeholder="Opcional" />
          <Button full loading={busy} onClick={savePatientForm} disabled={!patientForm.name.trim()}>
            {patientEditId === null ? 'Cadastrar paciente' : 'Salvar alterações'}
          </Button>
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
          <div className="grid gap-2 sm:grid-cols-2">
            <FormField label="Tipo de lente" value={newRxLensType} onChange={setNewRxLensType} placeholder="Ex: Multifocal, Blue Light…" />
            <FormField label="Profissional (optometrista/oftalmologista)" value={newRxPrescriber} onChange={setNewRxPrescriber} placeholder="Opcional" />
          </div>
          <RxInputRow label="Olho direito (OD)" rx={newRxOD} onChange={setNewRxOD} />
          <RxInputRow label="Olho esquerdo (OE)" rx={newRxOE} onChange={setNewRxOE} />
          <div className="grid gap-2 sm:grid-cols-2">
            <FormField label="Data do exame" value={newRxExamDate} onChange={v => {
              setNewRxExamDate(v)
              const parsed = parseDMY(v)
              if (parsed) setNewRxExpiresAt(fmtDate(addMonths(parsed, tenant.rxValidityMonths)))
            }} placeholder="dd/mm/aaaa" />
            <FormField label="Validade da receita" value={newRxExpiresAt} onChange={setNewRxExpiresAt} placeholder="dd/mm/aaaa" />
          </div>
          <p className="text-[11px] text-slate-400">A validade é recalculada ao alterar a data do exame (padrão da ótica: {tenant.rxValidityMonths} meses). Você pode ajustar manualmente.</p>
          <Button full loading={busy} onClick={saveNewPrescription} disabled={!newRxPatientId}>
            <Check className="h-4 w-4" /> Salvar prescrição
          </Button>
        </div>
      </Modal>

      {/* New service order (lab flow) */}
      <Modal open={newOsOpen} onClose={() => { setNewOsOpen(false); setNewOsRxId(null) }} title="Nova ordem de serviço">
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
          <SelectField label="Armação do estoque" value={newOsFrameItemId} onChange={v => selectOsItem('frame', v)}
            options={[{ value: '', label: 'Selecione a armação…' }, ...stock.filter(s => s.active && s.category === 'Armações' && s.qty > 0).map(s => ({
              value: String(s.id), label: `${s.name} — ${s.qty} un disponíveis`,
            }))]} />
          <SelectField label="Lente do estoque" value={newOsLensItemId} onChange={v => selectOsItem('lens', v)}
            options={[{ value: '', label: 'Selecione a lente…' }, ...stock.filter(s => s.active && (s.category === 'Lentes' || s.category === 'Tratamentos') && s.qty > 0).map(s => ({
              value: String(s.id), label: `${s.name} — ${s.qty} un disponíveis`,
            }))]} />
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField label="Qtd. de lentes" value={newOsQty} onChange={setNewOsQty}
              options={[{ value: '1', label: '1 (monocular)' }, { value: '2', label: '2 (par)' }]} />
            <FormField label="Valor da OS (R$)" value={newOsTotal} onChange={setNewOsTotal} placeholder="0,00" />
            <FormField label="Previsão de entrega" type="date" value={newOsDueDate} onChange={setNewOsDueDate} placeholder="" />
          </div>
          {newOsRxId && (() => {
            const rx = prescriptions.find((r) => r.id === newOsRxId)
            const exp = rx ? parseDMY(rx.expiresAt) : null
            if (!exp || daysBetween(TODAY_D, exp) > 0) return null
            return <p className="text-sm font-medium text-rose-600">⚠ Receita vencida. Não é possível abrir OS.</p>
          })()}
          {newOsLensItemId && (() => {
            const item = stock.find(s => s.id === parseInt(newOsLensItemId))
            if (item && item.qty < parseInt(newOsQty, 10)) return <p className="text-sm font-medium text-rose-600">⚠ Lente com estoque insuficiente ({item.qty} un)</p>
            return null
          })()}
          <p className="text-[11px] text-slate-400">A OS é aberta como “a receber”. O pagamento é registrado no Laboratório ou no Financeiro antes da entrega.</p>
          <Button full loading={busy} onClick={createServiceOrder} disabled={!newOsRxId || !newOsLensItemId || !newOsFrameItemId}>
            Criar OS e abater estoque
          </Button>
        </div>
      </Modal>

      {/* Order detail */}
      <Modal open={orderDetailId !== null} onClose={() => setOrderDetailId(null)} title={`Detalhes — ${orderDetailId}`} wide>
        {orderDetailId && (() => {
          const o = orders.find(x => x.id === orderDetailId)
          if (!o) return null
          const rx = prescriptions.find(r => r.id === o.prescriptionId)
          const pat = getPatient(o.patientId)
          const linkedSales = sales.filter(s => s.id === o.saleId || s.orderId === o.id)
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <InfoBox label="Paciente" value={pat?.name ?? '—'} />
                <InfoBox label="Status" value={STATUS_LABELS[o.status]} />
                <InfoBox label="Valor" value={`${brl(o.total)} · ${o.paid ? 'Pago' : 'A receber'}`} />
                <InfoBox label="Criada em" value={o.createdAt} />
                <InfoBox label="Armação" value={productName(o.frameItemId)} />
                <InfoBox label="Lente" value={`${orderLensName(o)}${o.lensQtyUsed ? ` (${o.lensQtyUsed} un)` : ''}`} />
                {o.dueDate && <InfoBox label="Previsão" value={o.dueDate} />}
                {o.readyAt && <InfoBox label="Pronto em" value={o.readyAt} />}
                {o.deliveredAt && <InfoBox label="Entregue em" value={o.deliveredAt} />}
              </div>
              {o.notes && <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">{o.notes}</p>}
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
                    <div key={s.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-3">
                      <div>
                        <p className="text-sm font-medium text-slate-800">#{s.id} · {brl(s.total)} · {s.paymentMethod} · {s.date}{s.status === 'cancelled' ? ' · CANCELADA' : ''}</p>
                        <p className="text-xs text-slate-400">{s.items.map(i => `${i.qty}× ${i.name}`).join(', ')}</p>
                      </div>
                      <button onClick={() => printSale(s)} title="Imprimir recibo" className="rounded p-1 text-slate-400 hover:text-brand-600"><Printer className="h-4 w-4" /></button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => printOrderById(o.id)}><Printer className="h-3.5 w-3.5" /> Imprimir OS</Button>
                {!o.paid && o.status !== 'cancelled' && o.total > 0 && can.sell(role) && (
                  <Button size="sm" onClick={() => { setOrderDetailId(null); openPayOrder(o.id) }}>Registrar pagamento</Button>
                )}
                {(o.status === 'production' || o.status === 'ready') && (
                  <Button size="sm" variant="secondary" onClick={() => advanceOrder(o.id)}>
                    <ChevronRight className="h-3.5 w-3.5" /> {o.status === 'production' ? 'Marcar pronto' : 'Marcar entregue'}
                  </Button>
                )}
                {isManager && !o.paid && (o.status === 'production' || o.status === 'ready') && (
                  <Button size="sm" variant="ghost" onClick={() => { setOrderDetailId(null); setCancelOrderId(o.id); setCancelReason('') }}>Cancelar OS</Button>
                )}
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* Pay order */}
      <Modal open={payOrderId !== null} onClose={() => setPayOrderId(null)} title={`Receber ${payOrderId ?? ''}`}>
        {payOrderId && (() => {
          const o = orders.find(x => x.id === payOrderId)
          if (!o) return null
          const discount = payDiscount ? parseMoney(payDiscount) : 0
          return (
            <div className="space-y-3">
              <p className="text-sm text-slate-500">Paciente: <strong className="text-slate-800">{getPatient(o.patientId)?.name}</strong></p>
              <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Valor da OS: <strong className="text-slate-900">{brl(o.total)}</strong>
                {discount > 0 && <> · Desconto: −{brl(discount)} · <strong className="text-slate-900">Total {brl(Math.max(o.total - discount, 0))}</strong></>}
              </div>
              {cashRequiredAndClosed && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                  Abra o caixa antes de registrar o recebimento. <button className="underline" onClick={() => { setPayOrderId(null); setPage('cash') }}>Ir para o caixa</button>
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField label="Forma de pagamento" value={payMethod} onChange={setPayMethod} options={PAYMENT_METHODS.map(m => ({ value: m, label: m }))} />
                <FormField label="Desconto (R$)" value={payDiscount} onChange={setPayDiscount} placeholder="0,00" />
              </div>
              <Button full loading={busy} onClick={confirmPayOrder} disabled={cashRequiredAndClosed}>Confirmar recebimento</Button>
            </div>
          )
        })()}
      </Modal>

      {/* Cancel order / sale */}
      <Modal open={cancelOrderId !== null || cancelSaleId !== null} onClose={() => { setCancelOrderId(null); setCancelSaleId(null) }}
        title={cancelOrderId ? `Cancelar ${cancelOrderId}` : `Cancelar venda #${cancelSaleId}`}>
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            {cancelOrderId
              ? 'A armação e as lentes de estoque usadas voltam para o estoque.'
              : 'Os produtos voltam para o estoque; OS geradas por esta venda são canceladas e recebimentos de OS voltam para “a receber”.'}
          </p>
          <FormField label="Motivo (obrigatório)" value={cancelReason} onChange={setCancelReason} placeholder="Ex: Cliente desistiu da compra" />
          <Button full variant="danger" loading={busy} disabled={cancelReason.trim().length < 3}
            onClick={cancelOrderId ? confirmCancelOrder : confirmCancelSale}>
            Confirmar cancelamento
          </Button>
        </div>
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
              <Button full loading={busy} onClick={adjustStock}
                disabled={stockEditQty === '' || (stockEditType === 'adjust' && !stockEditReason.trim())}>
                {stockEditType === 'count' ? 'Registrar contagem' : 'Confirmar ajuste'}
              </Button>
              <p className="text-[10px] text-slate-300 text-center">Registrado como: {me.name} · {TODAY}</p>
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
          const fiscalReturn = movements.filter(m => m.type === 'in' && m.reason === 'sale_cancel').reduce((s, m) => s + m.qty, 0)
          const fiscalBalance = fiscalIn - fiscalOut + fiscalReturn
          const gerencialIn = movements.filter(m => m.type === 'in').reduce((s, m) => s + m.qty, 0)
          const gerencialOut = movements.filter(m => m.type === 'out').reduce((s, m) => s + m.qty, 0)
          const gerencialBalance = gerencialIn - gerencialOut
          const physicalBalance = item.qty
          const hasDiscrepancy = fiscalBalance !== physicalBalance || gerencialBalance !== physicalBalance

          const REASON_LABELS: Record<string, string> = {
            purchase: 'Compra (NF)', sale: 'Venda', service_order: 'Ordem de Serviço',
            manual_adjustment: 'Ajuste Manual', physical_count: 'Contagem Física', sale_cancel: 'Estorno / cancelamento',
          }

          return (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-semibold text-slate-800">{item.name}</p>
                <p className="text-xs text-slate-400">{item.category} · Fornecedor: {item.supplier || '—'}</p>
              </div>

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
          <Button full loading={busy} onClick={createPdvClient} disabled={!pdvNewClientForm.name.trim()}>Cadastrar e selecionar</Button>
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
          <Button full loading={busy} onClick={createPdvDependent} disabled={!pdvNewDependentForm.name.trim()}>Cadastrar dependente</Button>
        </div>
      </Modal>

      {/* ── PDV: Add glasses (montar óculos) ── */}
      <Modal open={pdvAddGlassesOpen} onClose={() => { setPdvAddGlassesOpen(false); resetGlassesForm() }} title="Montar óculos" wide>
        {pdvClientId && (() => {
          const client = getPatient(pdvClientId)
          const deps = getDependents(pdvClientId)
          const allBeneficiaries = client ? [client, ...deps] : deps
          const selectedBenef = pdvGlassesBeneficiary ? patients.find(p => p.id === pdvGlassesBeneficiary) : null
          const benefRxs = pdvGlassesBeneficiary ? getPatientRxs(pdvGlassesBeneficiary).filter(rx => {
            const exp = parseDMY(rx.expiresAt)
            return exp ? daysBetween(TODAY_D, exp) > 0 : false
          }) : []
          const frames = stock.filter(s => s.active && s.category === 'Armações' && s.qty > 0)
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
                    <input type="checkbox" checked={pdvGlassesIsReady} onChange={e => { setPdvGlassesIsReady(e.target.checked); setPdvGlassesLens(''); if (e.target.checked) setPdvGlassesRxId(null) }}
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
                  {frames.length === 0 ? <p className="text-sm text-rose-500">Nenhuma armação em estoque.</p> : (
                    <SelectField label="Selecione a armação" value={pdvGlassesFrame} onChange={setPdvGlassesFrame}
                      options={[{ value: '', label: 'Escolha uma armação…' }, ...frames.map(s => ({
                        value: String(s.id), label: `${s.name} — ${brl(s.price)} (${s.qty} em estoque)`,
                      }))]} />
                  )}
                </div>
              )}

              {/* Step 4: Lens */}
              {pdvGlassesBeneficiary && (pdvGlassesIsReady || pdvGlassesRxId) && pdvGlassesFrame && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">4. Tipo de lente</p>
                  {selectedRx && <p className="mb-2 text-xs text-slate-500">Prescrição indica: <strong>{selectedRx.lensType}</strong></p>}
                  <div className="max-h-[200px] space-y-1.5 overflow-y-auto pr-1">
                    {activeLenses.filter(l => {
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
                          <p className="text-sm font-bold text-brand-600">{brl(lens.price)}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Summary + add */}
              {pdvGlassesBeneficiary && (pdvGlassesIsReady || pdvGlassesRxId) && pdvGlassesFrame && pdvGlassesLens && (() => {
                const frame = stock.find(s => s.id === parseInt(pdvGlassesFrame))
                const lens = lenses.find(l => l.id === parseInt(pdvGlassesLens))
                if (!frame || !lens) return null
                return (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600 mb-2">Resumo</p>
                    <p className="text-sm text-slate-700">Beneficiário: <strong>{selectedBenef?.name}</strong></p>
                    <p className="text-sm text-slate-700">Armação: {frame.name} — {brl(frame.price)}</p>
                    <p className="text-sm text-slate-700">Lente: {lens.name} — {brl(lens.price)}</p>
                    <p className="mt-1 text-sm font-bold text-slate-900">Total: {brl(frame.price + lens.price)}</p>
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
              if (parsed) setPdvAddRxExpiresAt(fmtDate(addMonths(parsed, tenant.rxValidityMonths)))
            }} placeholder="dd/mm/aaaa" />
            <FormField label="Validade da receita" value={pdvAddRxExpiresAt} onChange={setPdvAddRxExpiresAt} placeholder="dd/mm/aaaa" />
          </div>
          <p className="text-[11px] text-slate-400">A validade é recalculada ao alterar a data do exame (padrão: {tenant.rxValidityMonths} meses). Você pode ajustar manualmente.</p>
          <Button full loading={busy} onClick={savePdvPrescription} disabled={!pdvGlassesBeneficiary}>Salvar prescrição e continuar</Button>
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
                  <div key={`${t.patient.id}-${t.reason}`} className="flex items-center justify-between px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-500"><UserRound className="h-4 w-4" /></div>
                      <div>
                        <p className="text-sm font-medium text-slate-800">{t.patient.name}</p>
                        <p className="text-xs text-slate-400">{t.patient.phone || 'Sem telefone'} · {t.reason}</p>
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

      {/* ── Product (create / edit) ── */}
      <Modal open={productFormOpen} onClose={() => setProductFormOpen(false)} title={productEditId === null ? 'Cadastrar novo produto' : 'Editar produto'} wide>
        <div className="space-y-3">
          {productEditId === null && <p className="text-xs text-slate-400">Cadastre o produto no catálogo. Para dar entrada no estoque, use "Entrada NF" depois.</p>}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <FormField label="Nome do produto" value={productForm.name} onChange={v => setProductForm(p => ({ ...p, name: v }))} placeholder="Ex: Armação Ray-Ban Round" />
            </div>
            <FormField label="Código / SKU" value={productForm.sku} onChange={v => setProductForm(p => ({ ...p, sku: v }))} placeholder="Opcional" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label="Categoria" value={productForm.category} onChange={v => setProductForm(p => ({ ...p, category: v }))}
              options={[...new Set([...PRODUCT_CATEGORIES, productForm.category])].map(c => ({ value: c, label: c }))} />
            <SelectField label="Fornecedor" value={productForm.supplierId} onChange={v => setProductForm(p => ({ ...p, supplierId: v }))}
              options={[{ value: '', label: suppliers.length ? 'Nenhum' : 'Cadastre fornecedores no menu Fornecedores' }, ...suppliers.filter(s => s.active || String(s.id) === productForm.supplierId).map(s => ({ value: String(s.id), label: s.name }))]} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Preço de custo (R$)" value={productForm.costPrice} onChange={v => setProductForm(p => ({ ...p, costPrice: v }))} placeholder="0,00" />
            <FormField label="Preço de venda (R$)" value={productForm.salePrice} onChange={v => setProductForm(p => ({ ...p, salePrice: v }))} placeholder="0,00" />
          </div>
          {(() => {
            const cost = parseMoney(productForm.costPrice) || 0
            const sale = parseMoney(productForm.salePrice) || 0
            if (cost > 0 && sale > 0) {
              const margin = ((sale - cost) / sale * 100)
              return (
                <div className={`flex items-center gap-3 rounded-xl px-4 py-2.5 ${margin >= 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-rose-50 border border-rose-200'}`}>
                  <TrendingUp className={`h-4 w-4 ${margin >= 0 ? 'text-emerald-500' : 'text-rose-500'}`} />
                  <p className={`text-sm font-semibold ${margin >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>Margem: {margin.toFixed(1)}% · Lucro: {brl(sale - cost)}</p>
                </div>
              )
            }
            return null
          })()}
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Estoque mínimo" value={productForm.min} onChange={v => setProductForm(p => ({ ...p, min: v }))} placeholder="3" type="number" />
            <FormField label="Comissão %" value={productForm.commissionPct} onChange={v => setProductForm(p => ({ ...p, commissionPct: v }))} placeholder="5" type="number" />
          </div>
          <Button full loading={busy} onClick={saveProduct} disabled={!productForm.name.trim() || !(parseMoney(productForm.salePrice) > 0)}>
            {productEditId === null ? 'Cadastrar produto' : 'Salvar alterações'}
          </Button>
        </div>
      </Modal>

      {/* ── Stock entry NF (batch purchase) ── */}
      <Modal open={stockEntryOpen} onClose={() => { setStockEntryOpen(false); setStockEntryItems([]) }} title="Entrada de estoque (NF)" wide>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Nº Nota Fiscal" value={stockEntryNF} onChange={setStockEntryNF} placeholder="Ex: NF-00123" />
            <SelectField label="Fornecedor" value={stockEntrySupplierId} onChange={setStockEntrySupplierId}
              options={[{ value: '', label: 'Não informado' }, ...suppliers.filter(s => s.active).map(s => ({ value: String(s.id), label: `${s.name} (${s.creditTerm === 0 ? 'à vista' : s.creditTerm + ' dias'})` }))]} />
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
                const costN = parseMoney(ei.costPrice) || 0
                const salePrice = selectedItem?.price || 0
                const margin = costN > 0 && salePrice > 0 ? ((salePrice - costN) / salePrice * 100) : 0
                return (
                  <div key={idx} className="rounded-xl border border-slate-100 bg-slate-50/50 p-3">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 grid gap-2 sm:grid-cols-3">
                        <div className="sm:col-span-1">
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400">Produto</label>
                          <select value={ei.stockItemId} onChange={e => updateStockEntryItem(idx, 'stockItemId', parseInt(e.target.value, 10))} aria-label="Produto"
                            className="h-9 w-full rounded-xl border border-slate-200/80 bg-white px-3 text-sm text-slate-800 outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-100">
                            <option value={0}>Selecione...</option>
                            {stock.filter(s => s.active).map(s => <option key={s.id} value={s.id}>{s.name} (estoque: {s.qty})</option>)}
                          </select>
                        </div>
                        <FormField label="Quantidade" value={ei.qty} onChange={v => updateStockEntryItem(idx, 'qty', v)} placeholder="0" type="number" />
                        <FormField label="Custo unitário (R$)" value={ei.costPrice} onChange={v => updateStockEntryItem(idx, 'costPrice', v)} placeholder={selectedItem?.costPrice?.toFixed(2) || '0,00'} />
                      </div>
                      <button onClick={() => removeStockEntryItem(idx)} aria-label="Remover" className="mt-5 rounded-lg p-1.5 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {selectedItem && costN > 0 && (
                      <div className="mt-2 flex items-center gap-4 text-xs">
                        <span className="text-slate-400">Venda: {brl(salePrice)}</span>
                        <span className={`font-semibold ${margin >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>Margem: {margin.toFixed(1)}%</span>
                        {parseInt(ei.qty, 10) > 0 && <span className="text-slate-400">Subtotal custo: {brl(costN * parseInt(ei.qty, 10))}</span>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {validEntryItems.length > 0 && (() => {
            const totalCost = validEntryItems.reduce((s, ei) => {
              const cost = parseMoney(ei.costPrice) || stock.find(p => p.id === ei.stockItemId)?.costPrice || 0
              return s + cost * (parseInt(ei.qty, 10) || 0)
            }, 0)
            return (
              <div className="space-y-3 rounded-xl bg-brand-50 border border-brand-200 px-4 py-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-brand-700">
                    {validEntryItems.length} produto(s) · {validEntryItems.reduce((s, ei) => s + (parseInt(ei.qty, 10) || 0), 0)} unidades
                  </span>
                  <span className="text-brand-600">Total custo: {brl(totalCost)}</span>
                </div>
                {isManager && totalCost > 0 && (
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-brand-800">
                      <input type="checkbox" checked={stockEntryPayable} onChange={e => setStockEntryPayable(e.target.checked)} className="h-4 w-4 rounded border-brand-300 text-brand-500" />
                      Lançar conta a pagar
                    </label>
                    {stockEntryPayable && (
                      <div className="w-44">
                        <FormField label="Vencimento (vazio = prazo do fornecedor)" type="date" value={stockEntryDueDate} onChange={setStockEntryDueDate} placeholder="" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })()}

          <Button full loading={busy} onClick={submitStockEntry} disabled={validEntryItems.length === 0}>Confirmar entrada</Button>
        </div>
      </Modal>

      {/* ── New / Edit collaborator ── */}
      <Modal open={newCollabOpen} onClose={() => { setNewCollabOpen(false); setEditCollabId(null) }} title={editCollabId !== null ? 'Editar colaborador' : 'Novo colaborador'}>
        {(() => {
          const current = editCollabId !== null ? collaborators.find(c => c.id === editCollabId) : undefined
          const roleOptions = (Object.keys(ROLE_LABELS) as Collaborator['role'][])
            .filter(r => role === 'proprietario' || (r !== 'proprietario' && r !== 'gerente') || r === newCollabForm.role)
          return (
            <div className="space-y-3">
              <FormField label="Nome completo" value={newCollabForm.name} onChange={v => setNewCollabForm(p => ({ ...p, name: v }))} placeholder="Ex: João Silva" />
              <SelectField label="Função" value={newCollabForm.role} onChange={v => setNewCollabForm(p => ({ ...p, role: v as Collaborator['role'] }))}
                options={roleOptions.map(r => ({ value: r, label: ROLE_LABELS[r] }))} />
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Telefone" value={newCollabForm.phone} onChange={v => setNewCollabForm(p => ({ ...p, phone: v }))} placeholder="(00) 00000-0000" />
                <FormField label="E-mail" value={newCollabForm.email} onChange={v => setNewCollabForm(p => ({ ...p, email: v }))} placeholder="email@exemplo.com" />
              </div>
              <FormField label="Comissão (%)" value={newCollabForm.commissionPct} onChange={v => setNewCollabForm(p => ({ ...p, commissionPct: v }))} placeholder="5" type="number" />

              <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Acesso ao sistema</p>
                {current?.hasAccess ? (
                  <>
                    <p className="text-xs text-slate-500">Este colaborador entra com <strong>{current.email}</strong>.</p>
                    {current.id !== me.id && (
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                        <input type="checkbox" checked={newCollabForm.revokeAccess} onChange={e => setNewCollabForm(p => ({ ...p, revokeAccess: e.target.checked, password: '' }))} className="h-4 w-4 rounded border-slate-300 text-rose-500" />
                        Remover acesso
                      </label>
                    )}
                    {!newCollabForm.revokeAccess && (
                      <FormField label="Redefinir senha (opcional)" type="password" value={newCollabForm.password} onChange={v => setNewCollabForm(p => ({ ...p, password: v }))} placeholder="Mínimo 8 caracteres" />
                    )}
                  </>
                ) : (
                  <>
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" checked={newCollabForm.grantAccess} onChange={e => setNewCollabForm(p => ({ ...p, grantAccess: e.target.checked }))} className="h-4 w-4 rounded border-slate-300 text-brand-500" />
                      Permitir que entre no ARGUS
                    </label>
                    {newCollabForm.grantAccess && (
                      <FormField label="Senha inicial" type="password" value={newCollabForm.password} onChange={v => setNewCollabForm(p => ({ ...p, password: v }))} placeholder="Mínimo 8 caracteres" />
                    )}
                    <p className="text-[11px] text-slate-400">Sem acesso, o colaborador aparece apenas em equipe e comissões.</p>
                  </>
                )}
              </div>

              <Button full loading={busy} onClick={saveCollaborator} disabled={!newCollabForm.name.trim()}>
                {editCollabId !== null ? 'Salvar alterações' : 'Adicionar colaborador'}
              </Button>
            </div>
          )
        })()}
      </Modal>
    </div>
  )
}
