// Small Markdown renderer for the assistant's answers. It builds React nodes
// (never raw HTML), and covers what the model writes in reports: headings,
// paragraphs, lists, tables, code, quotes and inline emphasis.
import type { ReactNode } from 'react'

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; head: string[]; align: ('left' | 'right' | 'center')[]; rows: string[][] }
  | { kind: 'code'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'rule' }

const splitRow = (line: string) => {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|')) t = t.slice(0, -1)
  return t.split('|').map(c => c.trim())
}
const isTableSep = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)
const listItem = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/

function parse(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    if (line.trim().startsWith('```')) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) body.push(lines[i++])
      i++
      blocks.push({ kind: 'code', text: body.join('\n') })
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) { blocks.push({ kind: 'heading', level: h[1].length, text: h[2].replace(/#+\s*$/, '') }); i++; continue }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { blocks.push({ kind: 'rule' }); i++; continue }
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = splitRow(line)
      const align = splitRow(lines[i + 1]).map(c => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left') as 'left' | 'right' | 'center')
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]))
      blocks.push({ kind: 'table', head, align, rows })
      continue
    }
    if (line.trimStart().startsWith('>')) {
      const body: string[] = []
      while (i < lines.length && lines[i].trimStart().startsWith('>')) body.push(lines[i++].trimStart().replace(/^>\s?/, ''))
      blocks.push({ kind: 'quote', text: body.join(' ') })
      continue
    }
    const li = listItem.exec(line)
    if (li) {
      const ordered = Boolean(li[2])
      const items: string[] = []
      while (i < lines.length) {
        const m = listItem.exec(lines[i])
        if (m && Boolean(m[2]) === ordered) { items.push(m[3]); i++; continue }
        // Indented continuation of the previous item.
        if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && !listItem.exec(lines[i]) && items.length) { items[items.length - 1] += ' ' + lines[i].trim(); i++; continue }
        // Nested items are flattened under the list.
        if (m && /^\s{2,}/.test(lines[i])) { items.push(m[3]); i++; continue }
        break
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }
    const body: string[] = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s/.test(lines[i]) && !lines[i].trim().startsWith('```')
      && !listItem.exec(lines[i]) && !lines[i].trimStart().startsWith('>')
      && !(lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))) body.push(lines[i++].trim())
    blocks.push({ kind: 'paragraph', text: body.join(' ') })
  }
  return blocks
}

/** Inline: `code`, **bold**, *italic* / _italic_ and ~~strike~~. */
function inline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g
  let last = 0
  let m: RegExpExecArray | null
  let n = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const k = `${key}-${n++}`
    if (tok.startsWith('`')) out.push(<code key={k} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] text-slate-700">{tok.slice(1, -1)}</code>)
    else if (tok.startsWith('**') || tok.startsWith('__')) out.push(<strong key={k} className="font-semibold text-slate-900">{inline(tok.slice(2, -2), k)}</strong>)
    else if (tok.startsWith('~~')) out.push(<s key={k}>{inline(tok.slice(2, -2), k)}</s>)
    else out.push(<em key={k}>{inline(tok.slice(1, -1), k)}</em>)
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const HEADINGS = ['text-lg', 'text-base', 'text-[15px]', 'text-sm', 'text-sm', 'text-sm']

export function Markdown({ text }: { text: string }) {
  const blocks = parse(text)
  return (
    <div className="space-y-3 text-sm leading-relaxed text-slate-700">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'heading':
            return <p key={i} role="heading" aria-level={b.level} className={`${HEADINGS[b.level - 1]} pt-1 font-semibold text-slate-900`}>{inline(b.text, `h${i}`)}</p>
          case 'paragraph':
            return <p key={i}>{inline(b.text, `p${i}`)}</p>
          case 'list': {
            const Tag = b.ordered ? 'ol' : 'ul'
            return (
              <Tag key={i} className={`space-y-1 pl-5 ${b.ordered ? 'list-decimal' : 'list-disc'} marker:text-slate-400`}>
                {b.items.map((it, j) => <li key={j}>{inline(it, `l${i}-${j}`)}</li>)}
              </Tag>
            )
          }
          case 'table':
            return (
              <div key={i} className="overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full min-w-max text-[13px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>{b.head.map((c, j) => <th key={j} scope="col" style={{ textAlign: b.align[j] ?? 'left' }} className="px-3 py-2 font-semibold">{inline(c, `th${i}-${j}`)}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {b.rows.map((r, j) => (
                      <tr key={j}>{b.head.map((_, k) => <td key={k} style={{ textAlign: b.align[k] ?? 'left' }} className="px-3 py-2 tabular-nums">{inline(r[k] ?? '', `td${i}-${j}-${k}`)}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          case 'code':
            return <pre key={i} className="overflow-x-auto rounded-xl bg-slate-900 px-4 py-3 font-mono text-xs text-slate-100">{b.text}</pre>
          case 'quote':
            return <blockquote key={i} className="border-l-2 border-brand-300 pl-3 text-slate-600">{inline(b.text, `q${i}`)}</blockquote>
          case 'rule':
            return <hr key={i} className="border-slate-100" />
        }
      })}
    </div>
  )
}
