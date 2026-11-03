// Leitura e escrita do frontmatter YAML dos arquivos de agente.
//
// Não é um parser YAML completo: entende o que aparece em agentes do Claude Code
// (escalares, strings entre aspas, blocos | e >, listas) e guarda o texto original
// de cada chave, para regravar sem mudança o que o editor não tocou (hooks, mcpServers...).

export type Value =
  | { kind: 'scalar'; text: string; style: 'plain' | 'double' | 'single' | 'block' }
  | { kind: 'list'; items: string[]; style: 'flow' | 'block' }
  | { kind: 'complex' }

export type Entry = {
  /** Chave de primeiro nível; vazia para comentários e linhas soltas. */
  key: string
  /** Linhas originais, sem o fim de linha. */
  raw: string[]
  value: Value
}

export type Document = {
  hasFrontmatter: boolean
  entries: Entry[]
  body: string
  eol: '\n' | '\r\n'
  error: string
}

const KEY_LINE = /^([A-Za-z_][\w-]*)[ \t]*:(?:[ \t]+(.*))?$/

// ---------------------------------------------------------------------------
// documento: frontmatter + corpo

export function splitDocument(text: string): Document {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const lines = src.split('\n')
  if ((lines[0] ?? '').trim() !== '---') {
    return { hasFrontmatter: false, entries: [], body: src, eol, error: '' }
  }
  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (/^(---|\.\.\.)[ \t]*$/.test(lines[i] ?? '')) {
      end = i
      break
    }
  }
  if (end < 0) {
    return {
      hasFrontmatter: false,
      entries: [],
      body: src,
      eol,
      error: 'O frontmatter não tem a linha "---" de fechamento.',
    }
  }
  return {
    hasFrontmatter: true,
    entries: parseEntries(lines.slice(1, end)),
    body: lines.slice(end + 1).join('\n'),
    eol,
    error: '',
  }
}

function parseEntries(lines: string[]): Entry[] {
  const groups: { key: string; raw: string[] }[] = []
  let current: { key: string; raw: string[] } | null = null
  for (const line of lines) {
    const match = KEY_LINE.exec(line)
    if (match) {
      current = { key: match[1] ?? '', raw: [line] }
      groups.push(current)
      continue
    }
    // Linhas indentadas, vazias ou itens "- " continuam a chave anterior.
    const continues = current !== null && !line.startsWith('#') && (line.trim() === '' || /^[ \t-]/.test(line))
    if (continues && current) {
      current.raw.push(line)
    } else {
      current = null
      groups.push({ key: '', raw: [line] })
    }
  }
  return groups.map(group => ({
    key: group.key,
    raw: group.raw,
    value: group.key ? interpret(group.raw) : { kind: 'complex' },
  }))
}

function interpret(raw: string[]): Value {
  const first = raw[0] ?? ''
  const inline = first.slice(first.indexOf(':') + 1).trim()
  const rest = raw.slice(1)
  const content = rest.filter(line => line.trim() !== '' && !/^\s*#/.test(line))

  if (inline === '' || inline.startsWith('#')) {
    if (content.length === 0) return { kind: 'scalar', text: '', style: 'plain' }
    if (content.every(line => /^\s*-(\s|$)/.test(line))) {
      const items = content.map(line => line.replace(/^\s*-\s?/, '').trim())
      const isNested = items.some(item => KEY_LINE.test(item) || item.startsWith('{') || item.startsWith('['))
      if (isNested) return { kind: 'complex' }
      return { kind: 'list', items: items.map(unquote).filter(item => item !== ''), style: 'block' }
    }
    return { kind: 'complex' }
  }
  if (/^[|>][1-9]?[+-]?[1-9]?\s*(#.*)?$/.test(inline)) {
    return blockScalar(inline, rest)
  }
  if (inline.startsWith('"') || inline.startsWith("'")) {
    const joined = [inline, ...rest].join('\n')
    const quoted = readQuoted(joined)
    if (quoted) {
      return { kind: 'scalar', text: quoted.text, style: inline.startsWith('"') ? 'double' : 'single' }
    }
    return { kind: 'scalar', text: inline, style: 'plain' }
  }
  if (inline.startsWith('[')) {
    const items = readFlowList([inline, ...rest.map(line => line.trim())].join(' '))
    return items ? { kind: 'list', items, style: 'flow' } : { kind: 'complex' }
  }
  if (inline.startsWith('{')) return { kind: 'complex' }

  const head = stripComment(inline)
  if (content.length === 0) return { kind: 'scalar', text: head, style: 'plain' }
  return { kind: 'scalar', text: foldLines([head, ...rest.map(line => line.trim())]), style: 'plain' }
}

// ---------------------------------------------------------------------------
// escalares

/** Junta linhas como o YAML dobra um escalar: quebra simples vira espaço, linha vazia vira quebra. */
function foldLines(parts: string[]): string {
  let out = ''
  let breaks = 0
  for (const part of parts) {
    if (part === '') {
      breaks += 1
      continue
    }
    if (out !== '') out += breaks > 0 ? '\n'.repeat(breaks) : ' '
    out += part
    breaks = 0
  }
  return out
}

function blockScalar(header: string, rest: string[]): Value {
  const isLiteral = header.startsWith('|')
  const keep = header.includes('+')
  const explicit = /[1-9]/.exec(header)
  let indent = explicit ? Number(explicit[0]) : 0
  if (!indent) {
    const firstContent = rest.find(line => line.trim() !== '')
    indent = firstContent ? firstContent.length - firstContent.trimStart().length : 0
  }
  const lines = rest.map(line => (line.trim() === '' ? '' : line.slice(indent)))
  let end = lines.length
  while (end > 0 && lines[end - 1] === '') end -= 1
  const body = lines.slice(0, end)
  let text = isLiteral ? body.join('\n') : foldBlock(body)
  if (keep) text += '\n'
  return { kind: 'scalar', text, style: 'block' }
}

function foldBlock(lines: string[]): string {
  let out = ''
  let started = false
  let afterEmpty = false
  for (const line of lines) {
    if (line === '') {
      out += '\n'
      afterEmpty = true
      continue
    }
    if (!started) out += line
    else if (afterEmpty) out += line
    else if (line.startsWith(' ')) out += '\n' + line
    else out += ' ' + line
    started = true
    afterEmpty = false
  }
  return out
}

const ESCAPES: Record<string, string> = {
  '0': '\0', a: '\x07', b: '\b', t: '\t', '\t': '\t', n: '\n', v: '\v', f: '\f', r: '\r',
  e: '\x1b', ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\x85', _: '\xa0', L: ' ', P: ' ',
}

/** Lê uma string entre aspas (simples ou duplas) no começo de `src`; `end` é o índice após a aspa final. */
export function readQuoted(src: string): { text: string; end: number } | null {
  const quote = src[0]
  let out = ''
  let i = 1
  while (i < src.length) {
    const char = src[i] ?? ''
    if (char === '\n') {
      // Quebra de linha dentro das aspas: vira espaço (ou quebras, se houver linhas vazias).
      out = out.replace(/[ \t]+$/, '')
      let j = i + 1
      let breaks = 0
      while (j < src.length) {
        let k = j
        while (src[k] === ' ' || src[k] === '\t') k += 1
        if (src[k] === '\n') {
          breaks += 1
          j = k + 1
          continue
        }
        j = k
        break
      }
      out += breaks > 0 ? '\n'.repeat(breaks) : ' '
      i = j
      continue
    }
    if (quote === "'") {
      if (char === "'") {
        if (src[i + 1] === "'") {
          out += "'"
          i += 2
          continue
        }
        return { text: out, end: i + 1 }
      }
      out += char
      i += 1
      continue
    }
    if (char === '"') return { text: out, end: i + 1 }
    if (char === '\\') {
      const next = src[i + 1] ?? ''
      if (next === '\n') {
        i += 2
        while (src[i] === ' ' || src[i] === '\t') i += 1
        continue
      }
      const hexLength = next === 'x' ? 2 : next === 'u' ? 4 : next === 'U' ? 8 : 0
      if (hexLength) {
        const hex = src.slice(i + 2, i + 2 + hexLength)
        if (/^[0-9a-fA-F]+$/.test(hex) && hex.length === hexLength) {
          out += String.fromCodePoint(parseInt(hex, 16))
          i += 2 + hexLength
          continue
        }
      }
      out += ESCAPES[next] ?? next
      i += 2
      continue
    }
    out += char
    i += 1
  }
  return null
}

/** Lê uma lista em linha (`[a, "b", c]`); vírgulas dentro de parênteses não separam itens. */
function readFlowList(src: string): string[] | null {
  const items: string[] = []
  let i = 1
  while (i < src.length) {
    while (src[i] === ' ' || src[i] === '\t') i += 1
    const char = src[i]
    if (char === undefined) return null
    if (char === ']') return items
    if (char === ',') {
      i += 1
      continue
    }
    if (char === '"' || char === "'") {
      const quoted = readQuoted(src.slice(i))
      if (!quoted) return null
      items.push(quoted.text)
      i += quoted.end
      continue
    }
    let depth = 0
    let item = ''
    while (i < src.length) {
      const c = src[i] ?? ''
      if (depth === 0 && (c === ',' || c === ']')) break
      if (c === '(' || c === '[' || c === '{') depth += 1
      if (c === ')' || c === ']' || c === '}') depth -= 1
      item += c
      i += 1
    }
    const trimmed = item.trim()
    if (trimmed) items.push(trimmed)
  }
  return null
}

function stripComment(text: string): string {
  const match = /(^|[ \t])#/.exec(text)
  return (match ? text.slice(0, match.index) : text).trimEnd()
}

function unquote(text: string): string {
  if (text.startsWith('"') || text.startsWith("'")) return readQuoted(text)?.text ?? text
  return stripComment(text)
}

// ---------------------------------------------------------------------------
// escrita

/** Se o texto pode ir sem aspas depois de `chave: `. */
export function isPlainSafe(text: string): boolean {
  if (text === '' || text !== text.trim()) return false
  if (/[\x00-\x1f\x7f]/.test(text)) return false
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(text)) return false
  if (/:(\s|$)/.test(text) || /\s#/.test(text)) return false
  if (/^(true|false|yes|no|on|off|y|n|null|~)$/i.test(text)) return false
  if (/^[-+]?(\.\d+|\d[\d_]*(\.\d*)?)([eE][-+]?\d+)?$/.test(text)) return false
  if (/^0[xo]/i.test(text) || /^[-+]?\.(inf|nan)$/i.test(text)) return false
  return true
}

/** Um escalar pronto para `chave: <aqui>`: sem aspas quando possível, senão entre aspas duplas. */
export function formatScalar(text: string): string {
  // JSON é um subconjunto válido das strings YAML entre aspas duplas.
  return isPlainSafe(text) ? text : JSON.stringify(text)
}

/** Texto com quebras de linha que cabe num bloco `|-` sem indicador de indentação. */
export function isBlockSafe(text: string): boolean {
  if (!text.includes('\n')) return false
  const firstLine = text.split('\n')[0] ?? ''
  return firstLine.trim() !== '' && !/^\s/.test(firstLine) && !/[\x00-\x08\x0b-\x1f\x7f]/.test(text)
}
