import type { Patient, Prescription, ServiceOrder, StockItem, Notification } from '../types'
import { parseDMY, daysBetween, nextBirthdayDate, TODAY_D } from '../utils/helpers'

export function computeNotifications(
  patients: Patient[],
  prescriptions: Prescription[],
  orders: ServiceOrder[],
  stock: StockItem[],
): Notification[] {
  const notifs: Notification[] = []

  // Birthday alerts (today and upcoming week)
  for (const p of patients) {
    const nextBd = nextBirthdayDate(p.birthDate, TODAY_D)
    if (!nextBd) continue
    const days = daysBetween(TODAY_D, nextBd)
    if (days === 0) {
      notifs.push({ id: `bday-${p.id}`, title: `🎂 Aniversário hoje: ${p.name}`, sub: `Envie felicitações pelo WhatsApp`, type: 'birthday', read: false })
    } else if (days > 0 && days <= 7) {
      notifs.push({ id: `bdaysoon-${p.id}`, title: `Aniversário em ${days} dia(s)`, sub: `${p.name} · preparar campanha`, type: 'birthday', read: false })
    }
  }

  // Prescriptions expiring within 30 days
  for (const rx of prescriptions) {
    const exp = parseDMY(rx.expiresAt)
    if (!exp) continue
    const days = daysBetween(TODAY_D, exp)
    if (days > 0 && days <= 30) {
      const pat = patients.find(p => p.id === rx.patientId)
      notifs.push({ id: `rxexp-${rx.id}`, title: `Receita expirando em ${days} dias`, sub: `${pat?.name ?? 'Paciente'} — vence ${rx.expiresAt}`, type: 'prescription', read: false })
    } else if (days <= 0) {
      const pat = patients.find(p => p.id === rx.patientId)
      notifs.push({ id: `rxexpd-${rx.id}`, title: `Receita vencida`, sub: `${pat?.name ?? 'Paciente'} — venceu ${rx.expiresAt}`, type: 'prescription', read: false })
    }
  }

  // Orders ready for pickup
  for (const o of orders.filter(o => o.status === 'ready')) {
    const pat = patients.find(p => p.id === o.patientId)
    notifs.push({ id: `ordy-${o.id}`, title: `Óculos pronto para retirada`, sub: `${o.id} · ${pat?.name ?? 'Paciente'}`, type: 'order', read: false })
  }

  // Stock critical
  for (const s of stock.filter(s => s.qty <= Math.ceil(s.min * 0.5))) {
    notifs.push({ id: `stk-${s.id}`, title: `Estoque crítico`, sub: `${s.name} — apenas ${s.qty} un`, type: 'stock', read: false })
  }

  return notifs
}
