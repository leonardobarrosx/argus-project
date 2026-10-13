// Printable receipt (recibo) and service order (OS) documents.
import type { Patient, Prescription, Sale, ServiceOrder, Tenant } from '../types'

const esc = (s: string | number | null | undefined) =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

const money = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const STYLE = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; color: #0f172a; margin: 0; padding: 24px; font-size: 13px; }
  h1 { font-size: 18px; margin: 0; } h2 { font-size: 14px; margin: 18px 0 6px; text-transform: uppercase; letter-spacing: .04em; color: #475569; }
  .muted { color: #64748b; font-size: 12px; } .head { display: flex; justify-content: space-between; border-bottom: 2px solid #0f172a; padding-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; } th, td { text-align: left; padding: 6px 4px; border-bottom: 1px solid #e2e8f0; }
  th { font-size: 11px; text-transform: uppercase; color: #64748b; } td.r, th.r { text-align: right; }
  .total { font-size: 16px; font-weight: 700; text-align: right; margin-top: 10px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 16px; }
  .box { border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; margin-top: 8px; }
  .sign { margin-top: 48px; display: flex; gap: 40px; } .sign div { flex: 1; border-top: 1px solid #0f172a; padding-top: 4px; text-align: center; font-size: 11px; }
  .foot { margin-top: 24px; font-size: 11px; color: #64748b; text-align: center; }
  @media print { body { padding: 0; } @page { margin: 14mm; } }
`

function header(t: Tenant, title: string, ref: string) {
  const addr = [t.address, t.city && `${t.city}${t.state ? '/' + t.state : ''}`].filter(Boolean).join(' — ')
  return `<div class="head"><div><h1>${esc(t.name)}</h1>
    <div class="muted">${t.cnpj ? 'CNPJ ' + esc(t.cnpj) + ' · ' : ''}${esc(t.phone)}</div>
    <div class="muted">${esc(addr)}</div></div>
    <div style="text-align:right"><h1>${esc(title)}</h1><div class="muted">${esc(ref)}</div></div></div>`
}

function open(html: string, title: string) {
  const w = window.open('', '_blank', 'width=820,height=900')
  if (!w) {
    alert('Permita pop-ups para imprimir.')
    return
  }
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style></head><body>${html}</body></html>`)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 250)
}

export function printReceipt(sale: Sale, tenant: Tenant, customer: Patient | undefined) {
  const rows = sale.items.map(i => `<tr><td>${esc(i.name)}</td><td class="r">${i.qty}</td><td class="r">${money(i.price)}</td><td class="r">${money(i.price * i.qty)}</td></tr>`).join('')
  const html = `${header(tenant, 'Recibo de venda', `#${sale.id} · ${sale.date} ${sale.time}`)}
    <h2>Cliente</h2><div>${esc(customer?.name ?? 'Consumidor')}${customer?.cpf ? ' · CPF ' + esc(customer.cpf) : ''}</div>
    <h2>Itens</h2><table><thead><tr><th>Descrição</th><th class="r">Qtd</th><th class="r">Unitário</th><th class="r">Total</th></tr></thead><tbody>${rows}</tbody></table>
    ${sale.discount > 0 ? `<div class="total" style="font-size:13px;font-weight:500">Subtotal ${money(sale.subtotal)} · Desconto −${money(sale.discount)}</div>` : ''}
    <div class="total">Total ${money(sale.total)}</div>
    <div class="muted" style="text-align:right">Pagamento: ${esc(sale.paymentMethod)}${sale.orderId ? ' · ' + esc(sale.orderId) : ''} · Atendido por ${esc(sale.sellerName)}</div>
    ${sale.status === 'cancelled' ? `<div class="box" style="color:#be123c">VENDA CANCELADA — ${esc(sale.cancelReason)}</div>` : ''}
    <div class="foot">${esc(tenant.receiptFooter)}<br>Documento sem valor fiscal.</div>`
  open(html, `Recibo #${sale.id}`)
}

export function printOrder(o: ServiceOrder, tenant: Tenant, patient: Patient | undefined, rx: Prescription | undefined,
  frameName: string, lensName: string) {
  const eye = (label: string, r?: Prescription['rxOD']) => r ? `<tr><td><b>${label}</b></td><td>${esc(r.sph)}</td><td>${esc(r.cyl)}</td><td>${esc(r.axis)}</td><td>${esc(r.add)}</td><td>${esc(r.dnp)}</td><td>${esc(r.height)}</td></tr>` : ''
  const html = `${header(tenant, 'Ordem de serviço', `${o.id} · aberta em ${o.createdAt}`)}
    <h2>Paciente</h2><div class="grid">
      <div><span class="muted">Nome</span><br>${esc(patient?.name ?? '—')}</div>
      <div><span class="muted">Telefone</span><br>${esc(patient?.phone ?? '—')}</div>
      <div><span class="muted">Previsão de entrega</span><br>${esc(o.dueDate || '—')}</div></div>
    ${rx ? `<h2>Prescrição — ${esc(rx.lensType)} (exame ${esc(rx.examDate)}${rx.prescriber ? ' · ' + esc(rx.prescriber) : ''})</h2>
      <table><thead><tr><th></th><th>Esf.</th><th>Cil.</th><th>Eixo</th><th>Adição</th><th>DNP</th><th>Altura</th></tr></thead>
      <tbody>${eye('OD', rx.rxOD)}${eye('OE', rx.rxOE)}</tbody></table>` : '<h2>Prescrição</h2><div class="muted">Óculos pronto / sem prescrição</div>'}
    <h2>Montagem</h2><div class="grid">
      <div><span class="muted">Armação</span><br>${esc(frameName)}</div>
      <div><span class="muted">Lente</span><br>${esc(lensName)}${o.lensQtyUsed ? ` (${o.lensQtyUsed} un)` : ''}</div>
      <div><span class="muted">Status</span><br>${esc({ production: 'Em produção', ready: 'Pronto', delivered: 'Entregue', cancelled: 'Cancelada' }[o.status])}</div></div>
    ${o.notes ? `<div class="box">${esc(o.notes)}</div>` : ''}
    <div class="total">Valor ${money(o.total)} · ${o.paid ? 'PAGO' : 'A RECEBER'}</div>
    <div class="sign"><div>Responsável pela montagem</div><div>Cliente — retirada</div></div>
    <div class="foot">${esc(tenant.receiptFooter)}</div>`
  open(html, o.id)
}
