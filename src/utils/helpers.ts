import type { RxData } from '../types'

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

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, d.getDate())
}

export function nextBirthdayDate(birthDate: string, reference: Date): Date | null {
  const bd = parseDMY(birthDate)
  if (!bd) return null
  let next = new Date(reference.getFullYear(), bd.getMonth(), bd.getDate())
  if (next < reference) next = new Date(reference.getFullYear() + 1, bd.getMonth(), bd.getDate())
  return next
}

export const emptyRx = (): RxData => ({ sph: '', cyl: '', axis: '', add: '', dnp: '', height: '' })

export const TODAY = fmtDate(new Date())
export const TODAY_D = parseDMY(TODAY)!
