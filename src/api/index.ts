import { http, request, setAccessToken } from './client'
import type {
  BootstrapDTO, CashSessionDTO, LensDTO, MovementDTO, OrderDTO, PatientDTO, PayableDTO, PrescriptionDTO,
  ProductDTO, SaleDTO, SessionDTO, SupplierDTO, TenantDTO, UserDTO,
} from './types'
import type { FinanceSummary, Role, RxData } from '../types'

export { ApiError, errorMessage, refreshSession, setAccessToken, setSessionExpiredHandler } from './client'

export interface PatientInput {
  parentId?: number | null; name: string; cpf?: string; phone?: string; email?: string; birthDate?: string; notes?: string
}
export interface PrescriptionInput {
  patientId: number; rxOD: RxData; rxOE: RxData; examDate: string; expiresAt?: string; lensType?: string
  prescriber?: string; notes?: string
}
export interface ProductInput {
  name: string; category: string; sku?: string; min: number; price: number; costPrice: number; commissionPct: number
  supplierId?: number | null; supplier?: string; active?: boolean
}
export interface LensInput {
  name: string; description: string; lensType: string; index: string; price: number; costPrice: number; active?: boolean
}
export interface UserInput {
  name: string; email: string; phone: string; role: Role; commissionPct: number; password?: string; revokeAccess?: boolean
}
export interface SupplierInput {
  name: string; cnpj: string; contact: string; phone: string; email: string; creditTerm: number; notes: string; active?: boolean
}
export interface TenantInput {
  name: string; cnpj: string; phone: string; email: string; address: string; city: string; state: string
  requireCashSession: boolean; rxValidityMonths: number; receiptFooter: string
}
export interface SaleInput {
  patientId: number
  items: { productId: number; qty: number }[]
  glasses: { beneficiaryId: number; frameProductId: number; lensId: number | null; prescriptionId: number | null; readyMade: boolean }[]
  generateOs: boolean; osPaid: boolean; dueDate?: string; paymentMethod: string; discount: number
}
export interface EntryInput {
  invoiceNumber: string; supplierId: number | null; supplier: string
  items: { productId: number; qty: number; costPrice?: number }[]
  createPayable: boolean; dueDate?: string
}
export interface PayableInput {
  supplierId: number | null; description: string; category: string; amount: number; dueDate: string; invoiceNumber: string
}

type Effect = { products: ProductDTO[]; movements: MovementDTO[] }

export const api = {
  // Auth
  async login(email: string, password: string) {
    const s = await request<SessionDTO>('POST', '/api/auth/login', { email, password }, false)
    setAccessToken(s.token.accessToken)
    return s
  },
  async register(input: { storeName: string; name: string; email: string; password: string }) {
    const s = await request<SessionDTO>('POST', '/api/auth/register', input, false)
    setAccessToken(s.token.accessToken)
    return s
  },
  async logout() {
    try { await request<void>('POST', '/api/auth/logout', {}, false) } finally { setAccessToken(null) }
  },
  changePassword: (currentPassword: string, newPassword: string) =>
    http.post<void>('/api/auth/change-password', { currentPassword, newPassword }),

  bootstrap: () => http.get<BootstrapDTO>('/api/bootstrap'),

  // Ótica
  updateTenant: (input: TenantInput) => http.put<{ tenant: TenantDTO }>('/api/tenant', input),

  // Equipe
  createUser: (input: UserInput) => http.post<{ user: UserDTO }>('/api/users', input),
  updateUser: (id: number, input: UserInput) => http.put<{ user: UserDTO }>(`/api/users/${id}`, input),
  toggleUser: (id: number) => http.post<{ user: UserDTO }>(`/api/users/${id}/toggle-active`),

  // Pacientes
  createPatient: (input: PatientInput) => http.post<{ patient: PatientDTO }>('/api/patients', input),
  updatePatient: (id: number, input: PatientInput) => http.put<{ patient: PatientDTO }>(`/api/patients/${id}`, input),
  createPrescription: (input: PrescriptionInput) => http.post<{ prescription: PrescriptionDTO }>('/api/prescriptions', input),

  // Fornecedores
  createSupplier: (input: SupplierInput) => http.post<{ supplier: SupplierDTO }>('/api/suppliers', input),
  updateSupplier: (id: number, input: SupplierInput) => http.put<{ supplier: SupplierDTO }>(`/api/suppliers/${id}`, input),

  // Estoque
  createProduct: (input: ProductInput) => http.post<{ product: ProductDTO }>('/api/products', input),
  updateProduct: (id: number, input: ProductInput) => http.put<{ product: ProductDTO }>(`/api/products/${id}`, input),
  adjustStock: (productId: number, newQty: number, type: 'adjust' | 'count', reason: string) =>
    http.post<{ product: ProductDTO; movements: MovementDTO[] }>('/api/stock/adjust', { productId, newQty, type, reason }),
  stockEntry: (input: EntryInput) => http.post<Effect & { payable: PayableDTO | null }>('/api/stock/entries', input),
  createLens: (input: LensInput) => http.post<{ lens: LensDTO }>('/api/lenses', input),
  updateLens: (id: number, input: LensInput) => http.put<{ lens: LensDTO }>(`/api/lenses/${id}`, input),

  // Ordens de serviço
  createOrder: (input: { prescriptionId: number; frameProductId: number; lensProductId: number; lensQty: number; total?: number; dueDate?: string; notes?: string }) =>
    http.post<Effect & { order: OrderDTO }>('/api/orders', input),
  advanceOrder: (number: number) => http.post<{ order: OrderDTO }>(`/api/orders/${number}/advance`),
  payOrder: (number: number, paymentMethod: string, discount: number) =>
    http.post<{ order: OrderDTO; sale: SaleDTO }>(`/api/orders/${number}/pay`, { paymentMethod, discount }),
  cancelOrder: (number: number, reason: string) =>
    http.post<Effect & { order: OrderDTO }>(`/api/orders/${number}/cancel`, { reason }),

  // PDV
  createSale: (input: SaleInput) => http.post<Effect & { sale: SaleDTO | null; orders: OrderDTO[] }>('/api/sales', input),
  cancelSale: (id: number, reason: string) =>
    http.post<Effect & { sale: SaleDTO; orders: OrderDTO[] }>(`/api/sales/${id}/cancel`, { reason }),

  // Caixa
  cashCurrent: () => http.get<{ session: CashSessionDTO | null }>('/api/cash/current'),
  cashOpen: (openingAmount: number, notes: string) => http.post<{ session: CashSessionDTO }>('/api/cash/open', { openingAmount, notes }),
  cashClose: (closingAmount: number, notes: string) => http.post<{ session: CashSessionDTO }>('/api/cash/close', { closingAmount, notes }),
  cashMovement: (type: 'withdrawal' | 'deposit', amount: number, reason: string) =>
    http.post<{ session: CashSessionDTO }>('/api/cash/movements', { type, amount, reason }),
  cashSessions: () => http.get<{ sessions: CashSessionDTO[] }>('/api/cash/sessions'),

  // Financeiro
  createPayable: (input: PayableInput) => http.post<{ payable: PayableDTO }>('/api/payables', input),
  payPayable: (id: number, paidAt: string, paidAmount?: number) =>
    http.post<{ payable: PayableDTO }>(`/api/payables/${id}/pay`, { paidAt, ...(paidAmount ? { paidAmount } : {}) }),
  cancelPayable: (id: number, reason: string) => http.post<{ payable: PayableDTO }>(`/api/payables/${id}/cancel`, { reason }),
  financeSummary: (from: string, to: string) =>
    http.get<{ summary: FinanceSummary }>(`/api/finance/summary?from=${from}&to=${to}`),
}
