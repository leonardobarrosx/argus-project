// Converts API DTOs (ISO dates) into the UI models (dd/mm/yyyy dates).
import type {
  CashSessionDTO, LensDTO, MovementDTO, OrderDTO, PatientDTO, PayableDTO, PrescriptionDTO, ProductDTO,
  SaleDTO, SupplierDTO, TenantDTO, UserDTO,
} from './types'
import type {
  CashSession, Collaborator, LensCatalogItem, MovementReason, Patient, Payable, Prescription, Sale,
  ServiceOrder, StockItem, StockMovement, Supplier, Tenant,
} from '../types'

const pad = (n: number) => String(n).padStart(2, '0')

/** "2026-10-13" → "13/10/2026" ("" stays ""). */
export function isoToDMY(iso: string | null | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return y && m && d ? `${d}/${m}/${y}` : ''
}

/** "13/10/2026" → "2026-10-13"; returns "" for empty or invalid input. */
export function dmyToISO(dmy: string): string {
  const parts = dmy.trim().split('/')
  if (parts.length !== 3) return ''
  const [d, m, y] = parts.map(Number)
  if (!d || !m || !y || y < 1900 || m > 12 || d > 31) return ''
  const date = new Date(y, m - 1, d)
  if (date.getDate() !== d || date.getMonth() !== m - 1) return ''
  return `${y}-${pad(m)}-${pad(d)}`
}

/** RFC3339 timestamp → local "dd/mm/yyyy". */
export function tsToDMY(ts: string | null | undefined): string {
  if (!ts) return ''
  const d = new Date(ts)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

/** RFC3339 timestamp → local "HH:mm". */
export function tsToHM(ts: string | null | undefined): string {
  if (!ts) return ''
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const orderLabel = (n: number) => `OS-${n}`

export const mapPatient = (p: PatientDTO): Patient => ({
  id: p.id, name: p.name, cpf: p.cpf, phone: p.phone, email: p.email, birthDate: isoToDMY(p.birthDate),
  notes: p.notes, createdAt: tsToDMY(p.createdAt), ...(p.parentId ? { parentId: p.parentId } : {}),
})

export const mapPrescription = (r: PrescriptionDTO): Prescription => ({
  id: r.id, patientId: r.patientId, rxOD: r.rxOD, rxOE: r.rxOE, examDate: isoToDMY(r.examDate),
  expiresAt: isoToDMY(r.expiresAt), lensType: r.lensType, prescriber: r.prescriber, notes: r.notes,
})

export const mapProduct = (p: ProductDTO): StockItem => ({
  id: p.id, name: p.name, qty: p.qty, min: p.min, price: p.price, costPrice: p.costPrice,
  commissionPct: p.commissionPct, category: p.category, sku: p.sku, supplier: p.supplier,
  supplierId: p.supplierId, active: p.active,
})

export const mapLens = (l: LensDTO): LensCatalogItem => ({
  id: l.id, name: l.name, description: l.description, price: l.price, costPrice: l.costPrice,
  lensType: l.lensType, index: l.index, active: l.active,
})

export const mapMovement = (m: MovementDTO): StockMovement => ({
  id: m.id, stockItemId: m.productId, qty: m.qty, type: m.type, reason: m.reason as MovementReason,
  performedBy: m.performedBy, notes: m.notes || undefined, date: tsToDMY(m.createdAt), timestamp: tsToHM(m.createdAt),
  orderId: m.orderNumber ? orderLabel(m.orderNumber) : undefined, prescriptionId: m.prescriptionId ?? undefined,
  invoiceNumber: m.invoiceNumber || undefined, previousQty: m.previousQty ?? undefined, newQty: m.newQty ?? undefined,
})

export const mapSupplier = (s: SupplierDTO): Supplier => ({
  id: s.id, name: s.name, cnpj: s.cnpj, contact: s.contact, phone: s.phone, email: s.email,
  creditTerm: s.creditTerm, notes: s.notes, active: s.active,
})

export const mapOrder = (o: OrderDTO): ServiceOrder => ({
  id: orderLabel(o.number), number: o.number, prescriptionId: o.prescriptionId, patientId: o.patientId,
  status: o.status, frameItemId: o.frameProductId, lensItemId: o.lensProductId, lensId: o.lensId,
  lensDescription: o.lensDescription, lensQtyUsed: o.lensQtyUsed, total: o.total, paid: o.paid, saleId: o.saleId,
  dueDate: isoToDMY(o.dueDate), notes: o.notes, createdAt: tsToDMY(o.createdAt),
  productionStartedAt: o.productionStartedAt ? tsToDMY(o.productionStartedAt) : null,
  readyAt: o.readyAt ? tsToDMY(o.readyAt) : null, deliveredAt: o.deliveredAt ? tsToDMY(o.deliveredAt) : null,
})

export const mapSale = (s: SaleDTO): Sale => ({
  id: s.id, patientId: s.patientId, orderId: s.orderNumber ? orderLabel(s.orderNumber) : null,
  sessionId: s.sessionId, sellerName: s.sellerName, items: s.items, subtotal: s.subtotal, discount: s.discount,
  total: s.total, paymentMethod: s.paymentMethod, status: s.status, cancelReason: s.cancelReason,
  date: tsToDMY(s.createdAt), time: tsToHM(s.createdAt),
})

export const mapUser = (u: UserDTO): Collaborator => ({
  id: u.id, name: u.name, role: u.role, phone: u.phone, email: u.email, commissionPct: u.commissionPct,
  active: u.active, hasAccess: u.hasAccess, lastLoginAt: u.lastLoginAt, createdAt: tsToDMY(u.createdAt),
})

export const mapPayable = (p: PayableDTO): Payable => ({
  id: p.id, supplierId: p.supplierId, supplierName: p.supplierName, description: p.description,
  category: p.category, amount: p.amount, dueDate: isoToDMY(p.dueDate), dueDateISO: p.dueDate, status: p.status,
  invoiceNumber: p.invoiceNumber, paidAt: isoToDMY(p.paidAt), paidAmount: p.paidAmount, cancelReason: p.cancelReason,
})

export const mapTenant = (t: TenantDTO): Tenant => ({
  id: t.id, name: t.name, cnpj: t.cnpj, phone: t.phone, email: t.email, address: t.address, city: t.city,
  state: t.state, plan: t.plan, trialEndsAt: t.trialEndsAt, requireCashSession: t.requireCashSession,
  rxValidityMonths: t.rxValidityMonths, receiptFooter: t.receiptFooter,
})

export const mapCashSession = (s: CashSessionDTO): CashSession => ({ ...s })

/** Replaces items with the same id (or appends), keeping ascending id order. */
export function upsertById<T extends { id: number | string }>(list: T[], items: T[], sortKey?: (t: T) => number): T[] {
  if (items.length === 0) return list
  const map = new Map(list.map(i => [i.id, i]))
  for (const it of items) map.set(it.id, it)
  const out = Array.from(map.values())
  const key = sortKey ?? ((t: T) => (typeof t.id === 'number' ? t.id : 0))
  return out.sort((a, b) => key(a) - key(b))
}
