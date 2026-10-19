export const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export const PAYMENT_METHODS = ['Dinheiro', 'PIX', 'Cartão crédito', 'Cartão débito', 'Boleto', 'Crediário']

export const PAYABLE_CATEGORIES = [
  'Mercadorias', 'Aluguel', 'Folha de pagamento', 'Impostos', 'Energia/Água/Internet', 'Laboratório',
  'Marketing', 'Serviços', 'Manutenção', 'Outros',
]

export const PRODUCT_CATEGORIES = [
  'Armações', 'Lentes', 'Lentes de contato', 'Solar', 'Acessórios', 'Produtos de limpeza', 'Tratamentos',
]

/** Parses "12,50" or "12.50"; returns NaN for invalid input. */
export function parseMoney(s: string): number {
  const t = s.trim().replace(/\s/g, '')
  if (!t) return NaN
  const normalized = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  return Number(normalized)
}

export const todayISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const addDaysISO = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
