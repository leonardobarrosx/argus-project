import type { StockItem, ServiceOrder, Suggestion } from '../types'

export function computeSuggestions(stock: StockItem[], orders: ServiceOrder[]): Suggestion[] {
  const suggestions: Suggestion[] = []

  // Items below minimum
  const critical = stock.filter(s => s.qty <= s.min)
  for (const item of critical) {
    const deficit = item.min - item.qty
    if (item.qty === 0) {
      suggestions.push({ title: `${item.name} — ESGOTADO`, sub: `Repor imediatamente. Mínimo: ${item.min} un`, severity: 'critical' })
    } else if (item.qty <= Math.ceil(item.min * 0.5)) {
      suggestions.push({ title: `Repor ${item.name}`, sub: `Apenas ${item.qty} un (mín: ${item.min}). Déficit: ${deficit} un`, severity: 'critical' })
    } else {
      suggestions.push({ title: `Estoque baixo: ${item.name}`, sub: `${item.qty}/${item.min} un — considere repor`, severity: 'warning' })
    }
  }

  // Stock being consumed by active orders
  const activeOrders = orders.filter(o => o.status === 'production')
  const lensUsageMap = new Map<number, number>()
  for (const o of activeOrders) {
    if (o.lensItemId) lensUsageMap.set(o.lensItemId, (lensUsageMap.get(o.lensItemId) || 0) + o.lensQtyUsed)
  }
  for (const [itemId, qtyReserved] of lensUsageMap) {
    const item = stock.find(s => s.id === itemId)
    if (item && item.qty - qtyReserved < item.min) {
      suggestions.push({ title: `${item.name} em uso elevado`, sub: `${qtyReserved} un reservadas em OS ativas. Saldo livre: ${item.qty - qtyReserved}`, severity: 'warning' })
    }
  }

  // Check for overstocked items
  const overstocked = stock.filter(s => s.qty > s.min * 3 && s.min > 0)
  for (const item of overstocked) {
    suggestions.push({ title: `Excesso: ${item.name}`, sub: `${item.qty} un (mín: ${item.min}). Considere promoção ou combo`, severity: 'info' })
  }

  return suggestions.slice(0, 6)
}
