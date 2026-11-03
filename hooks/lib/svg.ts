// Desenhos SVG das superfícies gráficas (desktop, VS Code, celular): faixa do topo, avatares,
// cartão de pré-visualização e o mapa de delegação. O terminal usa texto no lugar deles.

const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif'

// Cores que acompanham o tema claro/escuro do sistema.
const THEME = `<style>
.bg{fill:#ffffff}.bd{stroke:#d9dbe1}.fg{fill:#1c2024}.mut{fill:#60646c}.ln{stroke:#b9bbc6}.chip{fill:#eef0f3}
@media (prefers-color-scheme: dark){.bg{fill:#1d1e22}.bd{stroke:#3a3d45}.fg{fill:#edeef0}.mut{fill:#a6a9b2}.ln{stroke:#4f525c}.chip{fill:#2b2d33}}
</style>`

export function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[char] ?? char)
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text
}

/** Quebra o texto em linhas de até `max` caracteres (por palavras). */
export function wrapText(text: string, max: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if (!word) continue
    const candidate = line ? `${line} ${word}` : word
    if (candidate.length <= max) {
      line = candidate
      continue
    }
    if (line) lines.push(line)
    line = word.length > max ? cut(word, max) : word
    if (lines.length === maxLines) break
  }
  if (line && lines.length < maxLines) lines.push(line)
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = cut(lines[maxLines - 1] ?? '', max - 1) + (lines[maxLines - 1]?.endsWith('…') ? '' : '…')
  }
  return lines
}

export function initials(name: string): string {
  const parts = name.split(/[-_\s.]+/).filter(Boolean)
  const strong = parts.filter(part => part.length > 2)
  const pick = strong.length > 0 ? strong : parts
  if (pick.length === 0) return '?'
  if (pick.length === 1) return (pick[0] ?? '?').slice(0, 2).toUpperCase()
  return `${(pick[0] ?? '')[0] ?? ''}${(pick[pick.length - 1] ?? '')[0] ?? ''}`.toUpperCase()
}

export function avatarSvg(name: string, hex: string, size: number): string {
  const r = size / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<circle cx="${r}" cy="${r}" r="${r}" fill="${hex}"/>
<text x="${r}" y="${r}" dy=".35em" text-anchor="middle" font-family="${FONT}" font-size="${Math.round(size * 0.4)}" font-weight="700" fill="#ffffff">${escapeXml(initials(name))}</text>
</svg>`
}

/** Faixa do topo: título, subtítulo e uma "constelação" com as cores dos agentes. */
export function bannerSvg(width: number, title: string, subtitle: string, colors: readonly string[]): string {
  const height = 76
  const dots = (colors.length > 0 ? colors : ['#ffffff']).slice(0, 7)
  const cx = width - 70
  const points = dots.map((color, i) => {
    const angle = (i / dots.length) * Math.PI * 2 - Math.PI / 2
    return { x: cx + Math.cos(angle) * 26, y: height / 2 + Math.sin(angle) * 22, color }
  })
  const showNetwork = width >= 300
  const network = showNetwork
    ? [
        ...points.map(p => `<line x1="${cx}" y1="${height / 2}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="#ffffff" stroke-opacity=".45" stroke-width="1.2"/>`),
        `<circle cx="${cx}" cy="${height / 2}" r="9" fill="#ffffff"/>`,
        ...points.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="6" fill="${p.color}" stroke="#ffffff" stroke-width="2"/>`),
      ].join('')
    : ''
  const maxChars = Math.max(12, Math.floor((width - (showNetwork ? 150 : 40)) / 7))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d97757"/><stop offset="1" stop-color="#8e4ec6"/></linearGradient></defs>
<rect width="${width}" height="${height}" rx="14" fill="url(#g)"/>
${network}
<text x="20" y="34" font-family="${FONT}" font-size="19" font-weight="700" fill="#ffffff">${escapeXml(cut(title, maxChars))}</text>
<text x="20" y="56" font-family="${FONT}" font-size="12.5" fill="#ffffff" fill-opacity=".9">${escapeXml(cut(subtitle, maxChars + 8))}</text>
</svg>`
}

export type PreviewData = {
  name: string
  description: string
  hex: string
  model: string
  tools: readonly string[]
}

/** Como o agente aparece: avatar, nome, modelo, descrição e ferramentas. */
export function previewSvg(width: number, data: PreviewData): string {
  const textWidth = width - 84
  const maxChars = Math.max(16, Math.floor(textWidth / 6.6))
  const lines = wrapText(data.description || 'Sem descrição ainda.', maxChars, 2)
  const chips = data.tools.slice(0, 6)
  let x = 72
  const chipSvg: string[] = []
  for (const tool of chips) {
    const label = cut(tool, 16)
    const w = label.length * 6.4 + 14
    if (x + w > width - 12) break
    chipSvg.push(
      `<rect x="${x.toFixed(1)}" y="78" width="${w.toFixed(1)}" height="18" rx="9" class="chip"/><text x="${(x + 7).toFixed(1)}" y="91" font-family="${FONT}" font-size="10.5" class="mut">${escapeXml(label)}</text>`,
    )
    x += w + 6
  }
  const model = escapeXml(cut(data.model, 14))
  const modelWidth = model.length * 6.6 + 16
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="108" viewBox="0 0 ${width} 108">${THEME}
<rect x=".5" y=".5" width="${width - 1}" height="107" rx="12" class="bg bd"/>
<rect x=".5" y=".5" width="6" height="107" rx="3" fill="${data.hex}"/>
<circle cx="40" cy="36" r="20" fill="${data.hex}"/>
<text x="40" y="36" dy=".35em" text-anchor="middle" font-family="${FONT}" font-size="14" font-weight="700" fill="#ffffff">${escapeXml(initials(data.name || '?'))}</text>
<text x="72" y="30" font-family="${FONT}" font-size="15" font-weight="700" class="fg">${escapeXml(cut(data.name || 'sem-nome', maxChars - 10))}</text>
<rect x="${width - modelWidth - 12}" y="16" width="${modelWidth}" height="20" rx="10" fill="${data.hex}" fill-opacity=".16"/>
<text x="${width - modelWidth / 2 - 12}" y="30" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" fill="${data.hex}">${model}</text>
${lines.map((line, i) => `<text x="72" y="${50 + i * 15}" font-family="${FONT}" font-size="11.5" class="mut">${escapeXml(line)}</text>`).join('')}
${chipSvg.join('')}
</svg>`
}

export type MapNode = {
  id: string
  label: string
  sub: string
  hex: string
  isPlugin: boolean
  isMissing: boolean
  /** Subagentes que este agente chamaria se rodasse como principal (Agent(...)). */
  calls: readonly string[]
}

/**
 * Mapa de delegação no estilo organograma: o agente principal no topo e, abaixo, os subagentes
 * que ele pode chamar. As ligações são ortogonais e passam por um barramento na lateral esquerda,
 * para nunca cruzar os cartões quando há várias fileiras.
 */
export function mapSvg(width: number, root: MapNode, nodes: readonly MapNode[]): string {
  const pad = 16
  const gapX = 12
  const nodeH = 50
  const rowGap = 40
  const nodeW = Math.min(170, Math.max(120, (width - pad * 2 - gapX) / 2))
  const perRow = Math.max(1, Math.floor((width - pad * 2 + gapX) / (nodeW + gapX)))
  const rows = Math.ceil(nodes.length / perRow)
  const rootW = Math.min(240, width - pad * 2)
  const rootX = (width - rootW) / 2
  const rootY = 12
  const firstRowY = rootY + nodeH + 40
  const trunkX = pad / 2
  const center = width / 2
  const hasLegend = nodes.some(node => node.isPlugin || node.calls.length > 0)
  const height =
    nodes.length === 0 ? rootY + nodeH + 52 : firstRowY + rows * nodeH + (rows - 1) * rowGap + (hasLegend ? 40 : 16)

  const place = new Map<string, { x: number; y: number; row: number }>()
  nodes.forEach((node, i) => {
    const row = Math.floor(i / perRow)
    const inRow = Math.min(perRow, nodes.length - row * perRow)
    const rowWidth = inRow * nodeW + (inRow - 1) * gapX
    const x = (width - rowWidth) / 2 + (i % perRow) * (nodeW + gapX)
    place.set(node.id, { x, y: firstRowY + row * (nodeH + rowGap), row })
  })

  const line = (x1: number, y1: number, x2: number, y2: number, arrow = false): string =>
    `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" class="ln" stroke-width="1.6"${arrow ? ' marker-end="url(#seta)"' : ''}/>`

  const wires: string[] = []
  if (nodes.length > 0) {
    const busY = (row: number): number => firstRowY + row * (nodeH + rowGap) - 18
    const centers = (row: number): number[] =>
      nodes.flatMap(node => {
        const at = place.get(node.id)
        return at && at.row === row ? [at.x + nodeW / 2] : []
      })
    wires.push(line(center, rootY + nodeH, center, busY(0)))
    for (let row = 0; row < rows; row += 1) {
      const xs = centers(row)
      const reach = row === 0 ? [...xs, center] : xs
      const left = rows > 1 ? trunkX : Math.min(...reach)
      wires.push(line(left, busY(row), Math.max(...reach), busY(row)))
      for (const x of xs) wires.push(line(x, busY(row), x, busY(row) + 15, true))
    }
    if (rows > 1) wires.push(line(trunkX, busY(0), trunkX, busY(rows - 1)))
  }

  const box = (node: MapNode, x: number, y: number, w: number, isRoot: boolean): string => {
    const hasCalls = node.calls.length > 0
    const chars = Math.max(8, Math.floor((w - (hasCalls ? 72 : 40)) / 7))
    const dash = node.isPlugin || node.isMissing ? ' stroke-dasharray="5 3"' : ''
    const stroke = node.isMissing ? '#e5484d' : node.hex
    const tip = hasCalls ? `${node.label} — chama ${node.calls.join(', ')} quando é o principal` : `${node.label} — ${node.sub}`
    const pill = hasCalls
      ? `<rect x="${(x + w - 40).toFixed(1)}" y="${(y + 8).toFixed(1)}" width="32" height="16" rx="8" fill="${node.hex}" fill-opacity=".22"/><text x="${(x + w - 24).toFixed(1)}" y="${(y + 20).toFixed(1)}" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="700" fill="${node.hex}">⤷${node.calls.length}</text>`
      : ''
    return `<g>
<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${nodeH}" rx="10" class="bg" stroke="${stroke}" stroke-width="${isRoot ? 2.2 : 1.5}"${dash}/>
<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${nodeH}" rx="10" fill="${node.hex}" fill-opacity="${isRoot ? 0.16 : 0.08}"/>
<circle cx="${(x + 18).toFixed(1)}" cy="${(y + nodeH / 2).toFixed(1)}" r="7" fill="${node.isMissing ? '#e5484d' : node.hex}"/>
<text x="${(x + 32).toFixed(1)}" y="${(y + 21).toFixed(1)}" font-family="${FONT}" font-size="12.5" font-weight="700" class="fg">${escapeXml(cut(node.label, chars))}</text>
<text x="${(x + 32).toFixed(1)}" y="${(y + 37).toFixed(1)}" font-family="${FONT}" font-size="10.5" class="mut">${escapeXml(cut(node.sub, chars + 6))}</text>
${pill}<title>${escapeXml(tip)}</title>
</g>`
  }

  const cards = nodes.map(node => {
    const at = place.get(node.id)
    return at ? box(node, at.x, at.y, nodeW, false) : ''
  })
  const legend = hasLegend
    ? `<text x="${pad}" y="${height - 12}" font-family="${FONT}" font-size="10.5" class="mut">${escapeXml(cut('tracejado: agente de plugin · ⤷N: orquestrador que chama N subagentes quando é o principal', Math.floor((width - pad * 2) / 5.4)))}</text>`
    : ''
  const empty =
    nodes.length === 0
      ? `<text x="${center}" y="${rootY + nodeH + 34}" text-anchor="middle" font-family="${FONT}" font-size="12" class="mut">Nenhum subagente disponível para este agente.</text>`
      : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${THEME}
<defs><marker id="seta" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#9ea1ab"/></marker></defs>
${wires.join('')}
${box(root, rootX, rootY, rootW, true)}
${cards.join('')}
${empty}${legend}
</svg>`
}
