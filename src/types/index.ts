export type PageKey =
  | 'overview' | 'pdv' | 'cash' | 'patients' | 'lab' | 'stock' | 'suppliers'
  | 'finance' | 'collaborators' | 'reports' | 'settings'

export type Role = 'proprietario' | 'gerente' | 'optometrista' | 'vendedor' | 'montador' | 'atendente'

export interface RxData { sph: string; cyl: string; axis: string; add: string; dnp: string; height: string }

export interface Prescription {
  id: number
  patientId: number
  rxOD: RxData
  rxOE: RxData
  examDate: string        // dd/mm/yyyy
  expiresAt: string       // dd/mm/yyyy
  lensType: string
  prescriber: string
  notes: string
}

export type OrderStatus = 'production' | 'ready' | 'delivered' | 'cancelled'

export interface ServiceOrder {
  id: string                      // "OS-1482"
  number: number
  prescriptionId: number | null
  patientId: number
  status: OrderStatus
  frameItemId: number | null      // stock item used for frame (armação)
  lensItemId: number | null       // stock item used for lens (lab flow)
  lensId: number | null           // lens catalog item (PDV flow)
  lensDescription: string
  lensQtyUsed: number
  total: number                   // value of the OS (receivable while unpaid)
  paid: boolean
  saleId: number | null
  dueDate: string                 // dd/mm/yyyy or ''
  notes: string
  createdAt: string
  productionStartedAt: string | null
  readyAt: string | null
  deliveredAt: string | null
}

export interface SaleItem {
  id: number
  kind: 'product' | 'glasses' | 'service_order'
  productId: number | null
  lensId: number | null
  beneficiaryId: number | null
  prescriptionId: number | null
  name: string
  price: number
  cost: number
  qty: number
}

export interface Sale {
  id: number
  patientId: number | null
  orderId: string | null           // linked OS ("OS-1482")
  sessionId: number | null
  sellerName: string
  items: SaleItem[]
  subtotal: number
  discount: number
  total: number
  paymentMethod: string
  status: 'completed' | 'cancelled'
  cancelReason: string
  date: string                     // dd/mm/yyyy
  time: string                     // HH:mm
}

export interface Patient {
  id: number
  name: string
  cpf: string
  phone: string
  email: string
  birthDate: string       // dd/mm/yyyy
  notes: string
  createdAt: string
  parentId?: number       // responsável financeiro (se for dependente)
}

export interface StockItem {
  id: number
  name: string
  qty: number
  min: number
  price: number
  costPrice: number
  commissionPct: number
  category: string
  sku: string
  supplier: string
  supplierId: number | null
  active: boolean
}

export interface Notification {
  id: string
  title: string
  sub: string
  type: 'stock' | 'birthday' | 'prescription' | 'order' | 'info'
  read: boolean
}

export interface CartItem {
  id: number; stockItemId: number; name: string; price: number; qty: number
}

export interface CartGlassesItem {
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

export interface LensCatalogItem {
  id: number
  name: string
  description: string
  price: number
  costPrice: number
  lensType: string
  index: string
  active: boolean
}

export type MovementReason =
  'service_order' | 'sale' | 'manual_adjustment' | 'purchase' | 'physical_count' | 'sale_cancel'

export interface StockMovement {
  id: number
  stockItemId: number
  qty: number
  type: 'in' | 'out'
  date: string
  reason: MovementReason
  performedBy: string
  notes?: string
  timestamp?: string        // HH:mm
  orderId?: string
  prescriptionId?: number
  invoiceNumber?: string
  previousQty?: number
  newQty?: number
}

export interface Collaborator {
  id: number
  name: string
  role: Role
  phone: string
  email: string
  commissionPct: number
  active: boolean
  hasAccess: boolean
  lastLoginAt: string | null
  createdAt: string
}

export interface Supplier {
  id: number
  name: string
  cnpj: string
  contact: string
  phone: string
  email: string
  creditTerm: number
  notes: string
  active: boolean
}

export interface Payable {
  id: number
  supplierId: number | null
  supplierName: string
  description: string
  category: string
  amount: number
  dueDate: string          // dd/mm/yyyy
  dueDateISO: string       // yyyy-mm-dd (sorting/filters)
  status: 'pending' | 'paid' | 'cancelled'
  invoiceNumber: string
  paidAt: string
  paidAmount: number | null
  cancelReason: string
}

export interface Tenant {
  id: number
  name: string
  cnpj: string
  phone: string
  email: string
  address: string
  city: string
  state: string
  plan: string
  trialEndsAt: string | null
  requireCashSession: boolean
  rxValidityMonths: number
  receiptFooter: string
}

export interface CashMethodTotal { method: string; total: number; count: number }

export interface CashMovement {
  id: number
  type: 'withdrawal' | 'deposit'
  amount: number
  reason: string
  userName: string
  createdAt: string
}

export interface CashSession {
  id: number
  openedByName: string
  closedByName: string
  openingAmount: number
  closingAmount: number | null
  expectedAmount: number | null
  notes: string
  openedAt: string
  closedAt: string | null
  summary?: {
    salesTotal: number
    salesCount: number
    byMethod: CashMethodTotal[]
    cashSales: number
    deposits: number
    withdrawals: number
    expectedCash: number
    movements: CashMovement[]
  }
}

export interface FinanceSummary {
  from: string
  to: string
  revenue: number
  salesCount: number
  avgTicket: number
  discounts: number
  cogs: number
  grossProfit: number
  grossMarginPct: number
  operatingExpenses: number
  merchandisePurchases: number
  netResult: number
  receivables: number
  receivablesCount: number
  payablesPending: number
  payablesOverdue: number
  payablesOverdueCount: number
  byMethod: CashMethodTotal[]
  expensesByCategory: { category: string; total: number }[]
  daily: { date: string; inflow: number; outflow: number; balance: number }[]
  commissions: { sellerId: number; sellerName: string; salesTotal: number; salesCount: number; commissionPct: number; commission: number }[]
}

export interface CampaignFilter {
  type: 'birthday' | 'prescription_expiry'
  daysAhead: number
}

export interface Suggestion { title: string; sub: string; severity: 'critical' | 'warning' | 'info' }
