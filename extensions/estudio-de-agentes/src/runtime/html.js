// Converte a árvore de elementos que o painel devolve (Box, Text, Button, Input, Select, Svg, Markdown, Code)
// em HTML para a webview. As medidas e regras seguem scripts/telas/renderizar.mjs (copiadas aqui, não importadas).
// Também registra as funções de cada botão/campo (handlers) e a lista de elementos interativos (indice).

const UX = 9
const UY = 6
const ALTURA_LINHA = 18

const TOKENS = { xs: 4, sm: 9, md: 18, lg: 27, xl: 36 }
const PESOS = { regular: 400, medium: 500, semibold: 600, bold: 700 }

const LIGHT = '.bg{fill:#ffffff}.bd{stroke:#d9dbe1}.fg{fill:#1c2024}.mut{fill:#60646c}.ln{stroke:#b9bbc6}.chip{fill:#eef0f3}'
const DARK = '.bg{fill:#1b1c20}.bd{stroke:#3a3d45}.fg{fill:#edeef0}.mut{fill:#a6a9b2}.ln{stroke:#5a5e68}.chip{fill:#2b2d33}'

/** Nomes de cor do tema (ThemeKey do plugin). Viram var(--c-<nome>) no HTML. */
export const TEMAS = new Set([
  'text', 'inverseText', 'inactive', 'subtle', 'suggestion', 'remember', 'success', 'error', 'warning', 'merged',
  'claude', 'permission', 'planMode', 'autoAccept', 'promptBorder', 'bashBorder', 'ide', 'diffAdded', 'diffRemoved',
  'diffAddedDimmed', 'diffRemovedDimmed', 'diffAddedWord', 'diffRemovedWord'
])

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

/** Escapa texto para HTML (atributos e conteúdo). */
export function esc(texto) {
  return String(texto).replace(/[&<>"']/g, c => ESCAPES[c])
}

/** Cor do painel: nome do tema vira var(--c-<nome>); qualquer outra coisa passa como veio. Vazio vira ''. */
export function cor(valor) {
  if (!valor) return ''
  if (TEMAS.has(valor)) return `var(--c-${valor})`
  return String(valor)
}

/** Espaçamento em px: número é multiplicado pela unidade; token (xs, sm, md, lg, xl) vale px direto; resto vale 0. */
export function espaco(valor, unidade) {
  if (valor === undefined || valor === null) return null
  if (typeof valor === 'number') return valor * unidade
  if (typeof valor === 'string' && Object.prototype.hasOwnProperty.call(TOKENS, valor)) return TOKENS[valor]
  return 0
}

/** Texto puro de um nó (strings, números, arrays e elementos). */
export function textoPlano(no) {
  if (typeof no === 'string' || typeof no === 'number') return String(no)
  if (Array.isArray(no)) return no.map(filho => textoPlano(filho)).join('')
  if (no !== null && typeof no === 'object' && 'type' in no) return textoPlano(no.children)
  return ''
}

// Medida de largura/altura/posição: número é multiplicado pela unidade (px); string passa como veio.
function medida(valor, unidade) {
  return typeof valor === 'number' ? `${valor * unidade}px` : String(valor)
}

// Os quatro lados de padding ou margin, em px: topo, dir, baixo, esq (mesma regra de precedência do renderizar.mjs).
function lados(p, base) {
  return {
    topo: espaco(p[base + 'Top'] ?? p[base + 'Y'] ?? p[base] ?? 0, UY),
    dir: espaco(p[base + 'Right'] ?? p[base + 'X'] ?? p[base] ?? 0, UX),
    baixo: espaco(p[base + 'Bottom'] ?? p[base + 'Y'] ?? p[base] ?? 0, UY),
    esq: espaco(p[base + 'Left'] ?? p[base + 'X'] ?? p[base] ?? 0, UX)
  }
}

/** Estilo CSS de uma Box (string `a:b;c:d`, só o que estiver definido). */
export function estiloBox(p) {
  const s = [`display:${p.display === 'none' ? 'none' : 'flex'}`, `flex-direction:${p.flexDirection ?? 'row'}`, 'min-width:0']
  if (p.gap !== undefined && p.gap !== null) s.push(`gap:${espaco(p.gap, UX)}px`)
  if (p.columnGap !== undefined && p.columnGap !== null) s.push(`column-gap:${espaco(p.columnGap, UX)}px`)
  if (p.rowGap !== undefined && p.rowGap !== null) s.push(`row-gap:${espaco(p.rowGap, UX)}px`)
  if (p.flexWrap) s.push(`flex-wrap:${p.flexWrap}`)
  if (p.alignItems) s.push(`align-items:${p.alignItems}`)
  if (p.alignSelf) s.push(`align-self:${p.alignSelf}`)
  if (p.justifyContent) s.push(`justify-content:${p.justifyContent}`)
  if (p.flexGrow !== undefined && p.flexGrow !== null) s.push(`flex-grow:${p.flexGrow}`)
  if (p.flexShrink !== undefined && p.flexShrink !== null) s.push(`flex-shrink:${p.flexShrink}`)

  const pad = lados(p, 'padding')
  if ([pad.topo, pad.dir, pad.baixo, pad.esq].some(v => v > 0)) {
    s.push(`padding:${pad.topo}px ${pad.dir}px ${pad.baixo}px ${pad.esq}px`)
  }
  const mar = lados(p, 'margin')
  if ([mar.topo, mar.dir, mar.baixo, mar.esq].some(v => v !== 0)) {
    s.push(`margin:${mar.topo}px ${mar.dir}px ${mar.baixo}px ${mar.esq}px`)
  }

  if (p.width !== undefined && p.width !== null) s.push(`width:${medida(p.width, UX)}`)
  if (p.minWidth !== undefined && p.minWidth !== null) s.push(`min-width:${medida(p.minWidth, UX)}`)
  if (p.height !== undefined && p.height !== null) s.push(`height:${medida(p.height, ALTURA_LINHA)}`)
  if (p.minHeight !== undefined && p.minHeight !== null) s.push(`min-height:${medida(p.minHeight, ALTURA_LINHA)}`)

  if (p.borderStyle) {
    s.push(
      `border:1px ${p.borderStyle === 'dashed' ? 'dashed' : 'solid'} ${cor(p.borderColor) || 'var(--borda)'}`,
      'border-radius:12px'
    )
    if (!p.backgroundColor) s.push('background:var(--card)')
  }
  if (p.backgroundColor) s.push(`background:${cor(p.backgroundColor)}`)
  if (p.overflow) s.push(`overflow:${p.overflow}`)
  if (p.position) s.push(`position:${p.position}`)
  if (p.top !== undefined && p.top !== null) s.push(`top:${medida(p.top, UY)}`)
  if (p.bottom !== undefined && p.bottom !== null) s.push(`bottom:${medida(p.bottom, UY)}`)
  if (p.left !== undefined && p.left !== null) s.push(`left:${medida(p.left, UX)}`)
  if (p.right !== undefined && p.right !== null) s.push(`right:${medida(p.right, UX)}`)
  return s.join(';')
}

/** Estilo CSS de um Text (string `a:b;c:d`, só o que estiver definido). */
export function estiloTexto(p) {
  const s = []
  const c = cor(p.color)
  if (c) s.push(`color:${c}`)
  else if (p.dimColor) s.push('color:var(--dim)')

  const peso = p.weight ?? (p.bold ? 'semibold' : '')
  if (peso) s.push(`font-weight:${PESOS[peso] ?? 600}`)

  if (p.size === 'caption') s.push('font-size:11px')
  else if (p.size === 'footnote') s.push('font-size:12px')
  else if (p.size === 'heading') {
    s.push('font-size:15px')
    if (!peso) s.push('font-weight:600')
  } else if (p.size === 'title') {
    s.push('font-size:18px')
    if (!peso) s.push('font-weight:700')
  }

  if (p.italic) s.push('font-style:italic')
  const decoracao = [p.underline ? 'underline' : '', p.strikethrough ? 'line-through' : ''].filter(Boolean).join(' ')
  if (decoracao) s.push(`text-decoration:${decoracao}`)
  if (p.mono) s.push('font-family:var(--mono)')
  if (p.backgroundColor) s.push(`background:${cor(p.backgroundColor)}`, 'border-radius:4px', 'padding:0 4px')
  if (p.inverse) s.push('color:var(--c-inverseText)', 'background:var(--texto)')
  if (typeof p.wrap === 'string' && p.wrap.startsWith('truncate')) {
    s.push('white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis', 'display:inline-block', 'max-width:100%', 'vertical-align:bottom')
  }
  return s.join(';')
}

/** Atributos e variáveis CSS do hover. attrs = string com espaço à frente de cada atributo; vars = array de `--nome:valor`. */
export function atributosHover(hover, ehBox) {
  const attrs = []
  const vars = []
  if (!hover) return { attrs: '', vars }
  if (ehBox) {
    if (hover.backgroundColor) {
      attrs.push('data-hover-bg')
      vars.push(`--hv-bg:${cor(hover.backgroundColor)}`)
    }
    if (hover.borderColor) {
      attrs.push('data-hover-borda')
      vars.push(`--hv-borda:${cor(hover.borderColor)}`)
    }
  } else {
    if (hover.color) {
      attrs.push('data-hover-cor')
      vars.push(`--hv-cor:${cor(hover.color)}`)
    }
    if (hover.backgroundColor) {
      attrs.push('data-hover-bg')
      vars.push(`--hv-bg:${cor(hover.backgroundColor)}`)
    }
    if (hover.underline) attrs.push('data-hover-sublinhado')
  }
  return { attrs: attrs.map(a => ` ${a}`).join(''), vars }
}

// Markdown simples (cópia de renderizar.mjs, com o esc deste arquivo).
function inline(md) {
  return esc(md)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/_([^_]+)_/g, '<i>$1</i>')
}

function markdown(texto) {
  const saida = []
  let lista = ''
  const fechar = () => {
    if (lista) saida.push(`</${lista}>`)
    lista = ''
  }
  for (const bruta of String(texto).split('\n')) {
    const linha = bruta.trimEnd()
    let m
    if ((m = /^(#{1,6})\s+(.*)$/.exec(linha))) {
      fechar()
      saida.push(`<div class="md-h md-h${m[1].length}">${inline(m[2])}</div>`)
    } else if ((m = /^\s*[-*]\s+(.*)$/.exec(linha))) {
      if (lista !== 'ul') { fechar(); saida.push('<ul>'); lista = 'ul' }
      saida.push(`<li>${inline(m[1])}</li>`)
    } else if ((m = /^\s*\d+\.\s+(.*)$/.exec(linha))) {
      if (lista !== 'ol') { fechar(); saida.push('<ol>'); lista = 'ol' }
      saida.push(`<li>${inline(m[1])}</li>`)
    } else if (linha.trim() === '') {
      fechar()
    } else {
      fechar()
      saida.push(`<p>${inline(linha)}</p>`)
    }
  }
  fechar()
  return saida.join('')
}

const temChave = p => p.key !== undefined && p.key !== null && p.key !== ''

// id do elemento interativo: 'k:<key>' (repetida no desenho ganha ~1, ~2…) ou 'p:<caminho>'.
function novoId(ctx, p, caminho) {
  let id
  if (temChave(p)) {
    const base = 'k:' + p.key
    id = base
    let n = 0
    while (ctx.ids.has(id)) {
      n++
      id = `${base}~${n}`
    }
  } else {
    id = 'p:' + caminho
  }
  ctx.ids.add(id)
  return id
}

// id do controle no DOM (campo-K): repetido no desenho ganha -2, -3…
function idDoCampo(ctx, p, id) {
  const base = 'campo-' + String(temChave(p) ? p.key : id).replace(/[^A-Za-z0-9_-]/g, '-')
  let nome = base
  let n = 1
  while (ctx.campos.has(nome)) {
    n++
    nome = `${base}-${n}`
  }
  ctx.campos.add(nome)
  return nome
}

function renderNo(no, caminho, ctx) {
  if (no === null || no === undefined || typeof no === 'boolean') return ''
  if (typeof no === 'string' || typeof no === 'number') return esc(no)
  if (Array.isArray(no)) return no.map((filho, i) => renderNo(filho, `${caminho}.${i}`, ctx)).join('')

  const p = no.props ?? {}
  const filhos = no.children ?? []
  const kids = () => filhos.map((filho, i) => renderNo(filho, `${caminho}.${i}`, ctx)).join('')

  switch (no.type) {
    case 'Box': {
      const hov = atributosHover(p.hover, true)
      const estilo = [estiloBox(p), ...hov.vars].join(';')
      return `<div class="box"${hov.attrs} style="${esc(estilo)}">${kids()}</div>`
    }
    case 'Text': {
      const hov = atributosHover(p.hover, false)
      const estilo = [estiloTexto(p), ...hov.vars].filter(Boolean).join(';')
      return `<span class="text"${hov.attrs} style="${esc(estilo)}">${kids()}</span>`
    }
    case 'Button': {
      const id = novoId(ctx, p, caminho)
      ctx.handlers[id] = { onPress: p.onPress }
      ctx.indice.push({ id, tipo: 'Button', texto: p.label || textoPlano(filhos) })
      const corpo = filhos.length > 0 ? kids() : esc(p.label ?? '')
      const classes = ['btn']
      if (p.plain) classes.push('plain')
      else if (p.variant === 'primary') classes.push('primary')
      if (p.dimColor) classes.push('dim')
      const hov = atributosHover(p.hover, false)
      const rotulo = p.label !== undefined && p.label !== null && filhos.length > 0 ? ` aria-label="${esc(p.label)}"` : ''
      const auto = p.autoFocus ? ' data-autofocus' : ''
      const estilo = hov.vars.length > 0 ? ` style="${esc(hov.vars.join(';'))}"` : ''
      return `<span class="${classes.join(' ')}" role="button" tabindex="0" data-h="${esc(id)}"${rotulo}${auto}${hov.attrs}${estilo}>${corpo}</span>`
    }
    case 'Input': {
      const id = novoId(ctx, p, caminho)
      ctx.handlers[id] = { onInput: p.onInput, onSubmit: p.onSubmit }
      ctx.indice.push({ id, tipo: 'Input', texto: p.label || p.placeholder || '' })
      const rows = p.rows ?? 1
      const campo = idDoCampo(ctx, p, id)
      const submit = p.submitLabel !== undefined && p.submitLabel !== null ? ` data-submit="${esc(p.submitLabel)}"` : ''
      const auto = p.autoFocus ? ' autofocus' : ''
      const rotulo = p.label ? `<div class="label">${esc(p.label)}</div>` : ''
      const placeholder = esc(p.placeholder ?? '')
      let controle
      if (rows <= 1) {
        controle = `<input class="input" type="text" id="${campo}" data-h="${esc(id)}" value="${esc(p.value ?? '')}" placeholder="${placeholder}"${submit}${auto}>`
      } else {
        controle = `<textarea class="input" rows="${rows}" id="${campo}" data-h="${esc(id)}" data-multi="1" placeholder="${placeholder}"${submit}${auto}>${esc(p.value ?? '')}</textarea>`
      }
      return `<div class="field">${rotulo}${controle}</div>`
    }
    case 'Select': {
      const id = novoId(ctx, p, caminho)
      ctx.handlers[id] = { onSelect: p.onSelect }
      ctx.indice.push({ id, tipo: 'Select', texto: p.label || '' })
      const campo = idDoCampo(ctx, p, id)
      const rotulo = p.label ? `<div class="label">${esc(p.label)}</div>` : ''
      const opcoes = (p.options ?? [])
        .map(o => `<option value="${esc(o.value)}"${o.value === p.value ? ' selected' : ''}>${esc(o.label ?? o.value)}</option>`)
        .join('')
      return `<div class="field">${rotulo}<div class="select-wrap"><select class="input select" id="${campo}" data-h="${esc(id)}">${opcoes}</select></div></div>`
    }
    case 'Svg': {
      let fonte = String(p.source ?? '')
      // O SVG do plugin segue o tema do sistema (@media prefers-color-scheme); aqui quem manda é o tema do VS Code.
      fonte = fonte.replace(/@media \(prefers-color-scheme: dark\)\{(?:[^{}]*\{[^{}]*\})*\}/g, '')
      if (ctx.tema === 'escuro') fonte = fonte.replace(LIGHT, DARK)
      const src = `data:image/svg+xml;base64,${Buffer.from(fonte, 'utf8').toString('base64')}`
      const largura = p.width !== undefined && p.width !== null ? ` width="${esc(p.width)}"` : ''
      const altura = p.height !== undefined && p.height !== null ? ` height="${esc(p.height)}"` : ''
      return `<img class="svg" src="${src}" alt="${esc(p.alt ?? '')}"${largura}${altura}>`
    }
    case 'Markdown':
      return `<div class="md${p.dimColor ? ' dim' : ''}">${markdown(p.text ?? '')}</div>`
    case 'Code':
      return `<pre class="code">${esc(p.source ?? '')}</pre>`
    default:
      // Tipo desconhecido: mostra só os filhos.
      return kids()
  }
}

/**
 * Converte a árvore do painel em HTML.
 * @param {*} arvore árvore de elementos ({ type, props, children }) ou array de nós
 * @param {{ tema?: 'escuro'|'claro' }} [opcoes]
 * @returns {{ html: string, handlers: Object, indice: Array<{ id: string, tipo: string, texto: string }> }}
 */
export function paraHtml(arvore, opcoes = {}) {
  const tema = opcoes.tema === 'claro' ? 'claro' : 'escuro'
  const ctx = { tema, handlers: {}, indice: [], ids: new Set(), campos: new Set() }
  const html = renderNo(arvore, '0', ctx)
  return { html, handlers: ctx.handlers, indice: ctx.indice }
}
