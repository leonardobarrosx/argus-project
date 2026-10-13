/** Downloads rows as a ;-separated CSV (Excel pt-BR friendly, UTF-8 BOM). */
export function exportCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const cell = (v: string | number) => {
    const s = String(v ?? '')
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = '﻿' + [headers.map(cell).join(';'), ...rows.map(r => r.map(cell).join(';'))].join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
