import { useState, useCallback, useMemo, useEffect } from 'react'
import {
  AlertTriangle, Bell, Boxes, Check, ChevronDown, ChevronRight,
  ClipboardPlus, Glasses, Phone, Plus, Send, Trash2,
  TrendingDown, TrendingUp, UserRound, Users,
} from 'lucide-react'

/* ── Types ── */
import type {
  PageKey, Prescription, ServiceOrder, Sale, Patient, StockItem,
  CartItem, CartGlassesItem, StockMovement, Collaborator, CampaignFilter,
} from './types'

/* ── Helpers & constants ── */
import {
  parseDMY, fmtDate, daysBetween, addYears, nextBirthdayDate,
  readPersistedState, writePersistedState,
  emptyRx, nextOS, setOidMin, TODAY, TODAY_D,
} from './utils/helpers'
import { NAV } from './constants/navigation'
import {
  seedPatients, seedStock, seedPrescriptions, seedOrders, seedSales, LENS_CATALOG,
} from './constants/seedData'

/* ── Engines ── */
import { computeSuggestions } from './lib/suggestions'
import { computeNotifications } from './lib/notifications'

/* ── UI Components ── */
import { Modal } from './components/ui/Modal'
import { FormField } from './components/ui/FormField'
import { SelectField } from './components/ui/SelectField'
import { InfoBox } from './components/ui/InfoBox'
import { Badge } from './components/ui/Badge'

/* ── Feature Components ── */
import { ArgusLogo } from './components/ArgusLogo'
import { NotificationDropdown } from './components/NotificationDropdown'
import { SmartSearch } from './components/SmartSearch'
import { RxInputRow } from './components/RxInputRow'
import { RxDisplay } from './components/RxDisplay'
import { MobileNav } from './components/MobileNav'

/* ── Pages ── */
import { OverviewPage } from './pages/OverviewPage'
import { PdvPage } from './pages/PdvPage'
import { PatientsPage } from './pages/PatientsPage'
import { LabPage } from './pages/LabPage'
import { StockPage } from './pages/StockPage'
import { CollaboratorsPage } from './pages/CollaboratorsPage'
import { ReportsPage } from './pages/ReportsPage'

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
    if (Number.isFinite(maxOrder)) setOidMin(maxOrder + 1)
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

  const NOW_TIME = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

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

    const hasInsufficient = cart.some(c => {
      const item = stock.find(s => s.id === c.stockItemId)
      return !item || item.qty < c.qty
    })
    if (hasInsufficient) return false

    const frameInsufficient = glassesCart.some(g => {
      const item = stock.find(s => s.id === g.frameStockItemId)
      return !item || item.qty < 1
    })
    if (frameInsufficient) return false

    const saleItems = [
      ...cart.map(c => ({ name: c.name, price: c.price, qty: c.qty })),
      ...glassesCart.map(g => ({ name: `${g.frameName} + ${g.lensName} (${g.beneficiaryName})`, price: g.framePrice + g.lensPrice, qty: 1 })),
    ]

    setStock(prev => {
      const updated = [...prev]
      for (const c of cart) {
        const idx = updated.findIndex(s => s.id === c.stockItemId)
        if (idx >= 0) updated[idx] = { ...updated[idx], qty: updated[idx].qty - c.qty }
      }
      for (const g of glassesCart) {
        const idx = updated.findIndex(s => s.id === g.frameStockItemId)
        if (idx >= 0) updated[idx] = { ...updated[idx], qty: updated[idx].qty - 1 }
      }
      return updated
    })

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
