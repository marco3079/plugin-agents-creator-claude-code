// Renderizador das telas do README: converte as árvores de interface que o painel desenha
// (dump do cenário scripts/telas/cenario.tsx) em páginas HTML, imitando um painel lateral escuro
// (desktop) ou um terminal, para o Chrome headless tirar os prints.
// Sem dependências. Exporta só lerDumps e paginaHtml, usadas por gerar-telas.mjs.

const THEME = {
  text: '#e6e6e6', inverseText: '#111', inactive: '#7d8590', subtle: '#4a4d55', suggestion: '#7aa7ff',
  remember: '#7aa7ff', success: '#3fb950', error: '#f85149', warning: '#e3b341', merged: '#a371f7',
  claude: '#d97757', permission: '#b392f0', planMode: '#48b3a8', autoAccept: '#b392f0',
}
const color = value => (value ? (THEME[value] ?? value) : '')
const esc = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

const LIGHT = '.bg{fill:#ffffff}.bd{stroke:#d9dbe1}.fg{fill:#1c2024}.mut{fill:#60646c}.ln{stroke:#b9bbc6}.chip{fill:#eef0f3}'
const DARK = '.bg{fill:#1b1c20}.bd{stroke:#3a3d45}.fg{fill:#edeef0}.mut{fill:#a6a9b2}.ln{stroke:#5a5e68}.chip{fill:#2b2d33}'
const darkSvg = source => source.replace(LIGHT, DARK)

function inline(md) {
  return esc(md)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/_([^_]+)_/g, '<i>$1</i>')
}

function markdown(text) {
  const out = []
  let list = ''
  const close = () => {
    if (list) out.push(`</${list}>`)
    list = ''
  }
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    let m
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
      close()
      out.push(`<div class="md-h md-h${m[1].length}">${inline(m[2])}</div>`)
    } else if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) {
      if (list !== 'ul') { close(); out.push('<ul>'); list = 'ul' }
      out.push(`<li>${inline(m[1])}</li>`)
    } else if ((m = /^\s*\d+\.\s+(.*)$/.exec(line))) {
      if (list !== 'ol') { close(); out.push('<ol>'); list = 'ol' }
      out.push(`<li>${inline(m[1])}</li>`)
    } else if (line.trim() === '') {
      close()
    } else {
      close()
      out.push(`<p>${inline(line)}</p>`)
    }
  }
  close()
  return out.join('')
}

function boxStyle(p, terminal) {
  const s = ['display:flex', `flex-direction:${p.flexDirection ?? 'row'}`, 'min-width:0']
  const unitX = terminal ? 8.4 : 9
  const unitY = terminal ? 18 : 6
  if (p.gap) s.push(`gap:${p.gap * (p.flexDirection === 'row' ? unitX : terminal ? unitY : 9)}px`)
  if (p.flexWrap) s.push(`flex-wrap:${p.flexWrap}`)
  if (p.alignItems) s.push(`align-items:${p.alignItems}`)
  if (p.justifyContent) s.push(`justify-content:${p.justifyContent}`)
  if (p.flexGrow !== undefined) s.push(`flex-grow:${p.flexGrow}`)
  if (p.flexShrink !== undefined) s.push(`flex-shrink:${p.flexShrink}`)
  const padX = p.paddingX ?? p.padding ?? 0
  const padY = p.paddingY ?? p.padding ?? 0
  const left = p.paddingLeft ?? padX
  if (padX || padY || left) s.push(`padding:${padY * unitY}px ${padX * unitX}px ${padY * unitY}px ${left * unitX}px`)
  if (p.borderStyle) {
    s.push(`border:1px solid ${color(p.borderColor) || '#3a3d45'}`, `border-radius:${terminal ? 6 : 12}px`)
    if (!terminal) s.push('background:rgba(255,255,255,.015)')
    if (terminal && !padY) s.push('padding-top:2px', 'padding-bottom:2px')
  }
  return s.join(';')
}

function textStyle(p) {
  const s = []
  const c = color(p.color)
  if (c) s.push(`color:${c}`)
  else if (p.dimColor) s.push('color:#9a9ca3')
  const weight = p.weight ?? (p.bold ? 'semibold' : '')
  if (weight) s.push(`font-weight:${{ regular: 400, medium: 500, semibold: 600, bold: 700 }[weight] ?? 600}`)
  if (p.italic) s.push('font-style:italic')
  if (p.wrap && p.wrap.startsWith('truncate')) s.push('white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis')
  return s.join(';')
}

function render(node, terminal) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return esc(node)
  if (Array.isArray(node)) return node.map(child => render(child, terminal)).join('')
  const p = node.props ?? {}
  const kids = (node.children ?? []).map(child => render(child, terminal)).join('')
  switch (node.type) {
    case 'Box':
      return `<div class="box" style="${boxStyle(p, terminal)}">${kids}</div>`
    case 'Text':
      return `<span class="text" style="${textStyle(p)}">${kids}</span>`
    case 'Button': {
      const body = kids || esc(p.label ?? '')
      const cls = p.plain ? 'btn plain' : p.variant === 'primary' ? 'btn primary' : 'btn'
      const dim = p.dimColor ? ' dim' : ''
      if (terminal) {
        const inner = p.plain ? body : `[ ${body} ]`
        return `<span class="${cls}${dim}">${inner}</span>`
      }
      return `<span class="${cls}${dim}">${body}</span>`
    }
    case 'Input': {
      const rows = p.rows ?? 1
      const value = p.value ? esc(p.value) : `<span class="ph">${esc(p.placeholder ?? '')}</span>`
      return `<div class="field"><div class="label">${esc(p.label ?? '')}</div><div class="input" style="min-height:${rows * 19}px">${value}</div></div>`
    }
    case 'Select': {
      const option = (p.options ?? []).find(o => o.value === p.value)
      return `<div class="field"><div class="label">${esc(p.label ?? '')}</div><div class="input select"><span>${esc(option?.label ?? p.value ?? '')}</span><span class="chev">▾</span></div></div>`
    }
    case 'Svg': {
      const src = `data:image/svg+xml;base64,${Buffer.from(darkSvg(p.source ?? ''), 'utf8').toString('base64')}`
      return `<img class="svg" src="${src}" width="${p.width ?? ''}" ${p.height ? `height="${p.height}"` : ''} alt="${esc(p.alt ?? '')}">`
    }
    case 'Markdown':
      return `<div class="md">${markdown(p.text ?? '')}</div>`
    case 'Code':
      return `<pre class="code">${esc(p.source ?? '')}</pre>`
    default:
      return kids
  }
}

const CSS_DESKTOP = `
*{box-sizing:border-box} html,body{margin:0;background:transparent}
body{font-family:"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;font-size:13.5px;line-height:1.45;color:#e6e6e6;padding:28px}
.pane{width:532px;background:#1e1f22;border:1px solid #303237;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.45),0 2px 6px rgba(0,0,0,.3);overflow:hidden}
.bar{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-bottom:1px solid #2c2e33;background:#1a1b1e}
.bar .t{font-weight:600;font-size:13px;color:#d6d6d6}.bar .x{color:#7d8590;font-size:13px}
.body{padding:16px 22px 22px}
.text{min-width:0;overflow-wrap:anywhere}
.btn{display:inline-flex;align-items:center;gap:2px;padding:4px 11px;border-radius:8px;background:#2b2d31;border:1px solid #3a3d44;color:#e6e6e6;font-size:13px;line-height:1.4;white-space:nowrap}
.btn.primary{background:#c8643f;border-color:#c8643f;color:#fff;font-weight:600}
.btn.plain{background:none;border:none;padding:0;border-radius:0}
.btn.dim{color:#9a9ca3}
.btn.primary .text[style*="#9a9ca3"]{color:rgba(255,255,255,.8)!important}
.field{display:flex;flex-direction:column;gap:4px;width:100%}
.label{font-size:12px;color:#9a9ca3}
.input{background:#141517;border:1px solid #393c43;border-radius:9px;padding:7px 10px;white-space:pre-wrap;overflow-wrap:anywhere;color:#e6e6e6}
.select{display:flex;justify-content:space-between;align-items:center}.chev{color:#9a9ca3}
.ph{color:#6b6f76}
.svg{display:block;max-width:100%;height:auto}
.md{font-size:13px}.md p{margin:4px 0}.md ul,.md ol{margin:4px 0;padding-left:20px}.md-h{font-weight:700;margin:8px 0 2px}.md-h1{font-size:16px}.md-h2{font-size:14.5px}
.md code{font-family:Consolas,monospace;background:#2b2d31;border-radius:4px;padding:0 4px;font-size:12px}
.code{font-family:Consolas,monospace;font-size:12px;background:#141517;border:1px solid #393c43;border-radius:9px;padding:10px;white-space:pre-wrap;margin:0}
`

const CSS_TERMINAL = `
*{box-sizing:border-box} html,body{margin:0;background:transparent}
body{padding:28px;font-family:"Cascadia Mono","Cascadia Code",Consolas,monospace;font-size:13.5px;line-height:18px;color:#d4d4d4}
.term{width:640px;background:#0f1012;border:1px solid #2a2c31;border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.45);overflow:hidden}
.bar{display:flex;gap:7px;align-items:center;padding:9px 12px;background:#1a1b1e;border-bottom:1px solid #26282c}
.dot{width:11px;height:11px;border-radius:50%;background:#3a3d44}.bar .t{margin-left:8px;color:#8b8e95;font-size:12px;font-family:"Segoe UI",system-ui,sans-serif}
.body{padding:14px 16px 18px}
.prompt{color:#8b8e95;margin-bottom:12px}.prompt b{color:#d97757;font-weight:400}
.pane{border:1px solid #3a3d45;border-radius:6px;padding:6px 10px}
.text{min-width:0;white-space:pre-wrap}
.btn{white-space:nowrap}.btn.primary{color:#d97757}.btn.dim{color:#8b8e95}
.field{display:flex;gap:8px}.label{color:#8b8e95}.input{border-bottom:1px solid #3a3d45;min-width:240px}.ph{color:#5f636b}
`

// Lê as linhas "DUMP:<nome>:<json>" impressas pelo cenário e devolve [{ nome, arvore }], uma por tela.
export function lerDumps(texto) {
  return texto
    .split(/\r?\n/)
    .filter(linha => linha.startsWith('DUMP:'))
    .map(linha => {
      const corte = linha.indexOf(':', 5)
      return { nome: linha.slice(5, corte), arvore: JSON.parse(linha.slice(corte + 1)) }
    })
}

// Página HTML completa de uma tela (estilo terminal se o nome começa com "terminal", senão painel desktop).
// Ao carregar, o script de medição grava no título "H=<altura>;W=<largura>" (tamanho do painel + 28 px).
export function paginaHtml(nome, arvore) {
  const terminal = nome.startsWith('terminal')
  const html = terminal
    ? `<!doctype html><html><head><meta charset="utf-8"><style>${CSS_TERMINAL}</style></head><body><div class="term" id="alvo"><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="t">claude — minha-api</span></div><div class="body"><div class="prompt"><b>&gt;</b> /agentes</div><div class="pane">${render(arvore, true)}</div></div></div></body></html>`
    : `<!doctype html><html><head><meta charset="utf-8"><style>${CSS_DESKTOP}</style></head><body><div class="pane" id="alvo"><div class="bar"><span class="t">Agentes</span><span class="x">✕</span></div><div class="body">${render(arvore, false)}</div></div></body></html>`
  const measure = `<script>addEventListener('load',()=>{const r=document.getElementById('alvo').getBoundingClientRect();document.title='H='+Math.ceil(r.bottom+28)+';W='+Math.ceil(r.right+28)})</script>`
  return html.replace('</body>', `${measure}</body>`)
}
