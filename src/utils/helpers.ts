import type { RxData, PersistedState } from '../types'

export function parseDMY(s: string): Date | null {
  const [d, m, y] = s.split('/').map(Number)
  if (!d || !m || !y) return null
  return new Date(y, m - 1, d)
}

export function fmtDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

export function addYears(d: Date, n: number): Date {
  const r = new Date(d)
  r.setFullYear(r.getFullYear() + n)
  return r
}

export function nextBirthdayDate(birthDate: string, reference: Date): Date | null {
  const bd = parseDMY(birthDate)
  if (!bd) return null
  let next = new Date(reference.getFullYear(), bd.getMonth(), bd.getDate())
  if (next < reference) next = new Date(reference.getFullYear() + 1, bd.getMonth(), bd.getDate())
  return next
}

const STORAGE_KEY = 'argus-erp-mvp-v1'

export function readPersistedState(): Partial<PersistedState> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as Partial<PersistedState>
  } catch {
    return null
  }
}

export function writePersistedState(state: PersistedState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Ignore quota/storage errors to avoid breaking core UX.
  }
}

export const emptyRx = (): RxData => ({ sph: '', cyl: '', axis: '', add: '', dnp: '', height: '' })

let _oid = 1490
export function nextOS() { return `OS-${_oid++}` }
export function setOidMin(n: number) { if (n > _oid) _oid = n }

export const TODAY = fmtDate(new Date())
export const TODAY_D = parseDMY(TODAY)!
