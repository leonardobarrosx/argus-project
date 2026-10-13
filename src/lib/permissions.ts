import type { PageKey, Role } from '../types'

export const ROLE_LABELS: Record<Role, string> = {
  proprietario: 'Proprietário(a)', gerente: 'Gerente', optometrista: 'Optometrista',
  vendedor: 'Vendedor(a)', montador: 'Montador(a)', atendente: 'Atendente',
}

const MANAGERS: Role[] = ['proprietario', 'gerente']
const SELLERS: Role[] = ['proprietario', 'gerente', 'vendedor', 'atendente']
const CLINICAL: Role[] = ['proprietario', 'gerente', 'optometrista', 'vendedor', 'atendente']
const ALL: Role[] = ['proprietario', 'gerente', 'optometrista', 'vendedor', 'montador', 'atendente']

/** Mirrors the API route guards so the UI only offers what the user can do. */
export const can = {
  manage: (r: Role) => MANAGERS.includes(r),
  sell: (r: Role) => SELLERS.includes(r),
  clinical: (r: Role) => CLINICAL.includes(r),
}

const PAGE_ROLES: Record<PageKey, Role[]> = {
  overview: ALL,
  pdv: SELLERS,
  cash: SELLERS,
  patients: ALL,
  lab: ALL,
  stock: ALL,
  suppliers: MANAGERS,
  finance: MANAGERS,
  collaborators: MANAGERS,
  reports: MANAGERS,
  settings: ALL,
}

export const canSeePage = (role: Role, page: PageKey) => PAGE_ROLES[page].includes(role)
