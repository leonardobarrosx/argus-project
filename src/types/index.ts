export type PageKey = 'overview' | 'pdv' | 'patients' | 'lab' | 'stock' | 'collaborators' | 'reports'

export interface RxData { sph: string; cyl: string; axis: string; add: string; dnp: string; height: string }

export interface Prescription {
  id: number
  patientId: number
  rxOD: RxData
  rxOE: RxData
  examDate: string        // dd/mm/yyyy
  expiresAt: string       // dd/mm/yyyy (1 year from exam)
  lensType: string
}

export interface ServiceOrder {
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

export interface Sale {
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

export interface Patient {
  id: number
  name: string
  cpf: string
  phone: string
  birthDate: string       // dd/mm/yyyy
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
  supplier: string
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
  lensType: string
  index: string
}

export interface StockMovement {
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

export interface Collaborator {
  id: number
  name: string
  role: 'optometrista' | 'vendedor' | 'montador' | 'atendente' | 'gerente'
  phone: string
  email: string
  commissionPct: number
  active: boolean
  createdAt: string
}

export interface CampaignFilter {
  type: 'birthday' | 'prescription_expiry'
  daysAhead: number
}

export interface PersistedState {
  patients: Patient[]
  stock: StockItem[]
  prescriptions: Prescription[]
  orders: ServiceOrder[]
  sales: Sale[]
  stockMovements: StockMovement[]
  dismissedNotifs: string[]
  collaborators: Collaborator[]
}

export interface Suggestion { title: string; sub: string; severity: 'critical' | 'warning' | 'info' }
