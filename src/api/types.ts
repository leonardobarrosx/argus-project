// Wire types returned by the Argus API (dates in ISO format).
import type { RxData, Role } from '../types'

export interface ApiErrorBody { error: string; code: string }

export interface UserDTO {
  id: number; name: string; email: string; phone: string; role: Role; commissionPct: number
  active: boolean; hasAccess: boolean; lastLoginAt: string | null; createdAt: string
}

export interface TenantDTO {
  id: number; name: string; slug: string; cnpj: string; phone: string; email: string; address: string
  city: string; state: string; plan: string; trialEndsAt: string | null; requireCashSession: boolean
  rxValidityMonths: number; receiptFooter: string; createdAt: string
}

export interface SessionDTO {
  user: UserDTO
  tenant: TenantDTO
  token: { accessToken: string; expiresIn: number }
}

export interface PatientDTO {
  id: number; parentId: number | null; name: string; cpf: string; phone: string; email: string
  birthDate: string; notes: string; createdAt: string
}

export interface PrescriptionDTO {
  id: number; patientId: number; rxOD: RxData; rxOE: RxData; examDate: string; expiresAt: string
  lensType: string; prescriber: string; notes: string; createdAt: string
}

export interface ProductDTO {
  id: number; name: string; category: string; sku: string; qty: number; min: number; price: number
  costPrice: number; commissionPct: number; supplierId: number | null; supplier: string; active: boolean
}

export interface LensDTO {
  id: number; name: string; description: string; lensType: string; index: string; price: number
  costPrice: number; active: boolean
}

export interface MovementDTO {
  id: number; productId: number; qty: number; type: 'in' | 'out'; reason: string; performedBy: string
  notes: string; orderNumber: number | null; prescriptionId: number | null; invoiceNumber: string
  previousQty: number | null; newQty: number | null; createdAt: string
}

export interface SupplierDTO {
  id: number; name: string; cnpj: string; contact: string; phone: string; email: string
  creditTerm: number; notes: string; active: boolean; createdAt: string
}

export interface OrderDTO {
  id: number; number: number; patientId: number; prescriptionId: number | null
  status: 'production' | 'ready' | 'delivered' | 'cancelled'
  frameProductId: number | null; lensProductId: number | null; lensId: number | null
  lensDescription: string; lensQtyUsed: number; total: number; paid: boolean; saleId: number | null
  dueDate: string; notes: string; createdAt: string; productionStartedAt: string | null
  readyAt: string | null; deliveredAt: string | null
}

export interface SaleItemDTO {
  id: number; kind: 'product' | 'glasses' | 'service_order'; productId: number | null; lensId: number | null
  beneficiaryId: number | null; prescriptionId: number | null; name: string; price: number; cost: number; qty: number
}

export interface SaleDTO {
  id: number; patientId: number | null; orderNumber: number | null; sessionId: number | null
  sellerId: number | null; sellerName: string; subtotal: number; discount: number; total: number
  paymentMethod: string; status: 'completed' | 'cancelled'; cancelReason: string; createdAt: string
  items: SaleItemDTO[]
}

export interface PayableDTO {
  id: number; supplierId: number | null; supplierName: string; description: string; category: string
  amount: number; dueDate: string; status: 'pending' | 'paid' | 'cancelled'; invoiceNumber: string
  paidAt: string; paidAmount: number | null; cancelReason: string; createdAt: string
}

export interface CashSessionDTO {
  id: number; openedByName: string; closedByName: string; openingAmount: number
  closingAmount: number | null; expectedAmount: number | null; notes: string; openedAt: string
  closedAt: string | null
  summary?: {
    salesTotal: number; salesCount: number
    byMethod: { method: string; total: number; count: number }[]
    cashSales: number; deposits: number; withdrawals: number; expectedCash: number
    movements: { id: number; type: 'withdrawal' | 'deposit'; amount: number; reason: string; userName: string; createdAt: string }[]
  }
}

export interface BootstrapDTO {
  tenant: TenantDTO
  user: UserDTO
  users: UserDTO[]
  patients: PatientDTO[]
  prescriptions: PrescriptionDTO[]
  products: ProductDTO[]
  lenses: LensDTO[]
  movements: MovementDTO[]
  suppliers: SupplierDTO[]
  orders: OrderDTO[]
  sales: SaleDTO[]
  payables: PayableDTO[]
  cashSession: CashSessionDTO | null
}

/** Stock-affecting mutation responses share this shape. */
export interface StockEffect {
  products?: ProductDTO[]
  movements?: MovementDTO[]
}
