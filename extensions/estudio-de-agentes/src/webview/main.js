// Cliente da webview do Estúdio de Agentes (navegador, empacotado pelo esbuild como IIFE).
// Aplica o HTML vindo da extensão sem perder foco, cursor nem rolagem, e manda os eventos de volta.
import morphdom from 'morphdom'

const vscode = acquireVsCodeApi()
const raiz = document.getElementById('raiz')

/**
 * Quantas colunas de texto cabem na largura do conteúdo (7.4 px por coluna, mínimo 30).
 * @returns {number}
 */
function medirColunas() {
  return Math.max(30, Math.floor((raiz.clientWidth || document.body.clientWidth) / 7.4))
}

/**
 * Envia uma mensagem para a extensão.
 * @param {object} msg
 */
function enviar(msg) {
  vscode.postMessage(msg)
}

/**
 * Monta o evento do painel. `valor` só entra quando estiver definido.
 * @param {string} id
 * @param {'press'|'input'|'submit'|'select'} acao
 * @param {string} [valor]
 * @returns {{ tipo: 'evento', id: string, acao: string, valor?: string }}
 */
function evento(id, acao, valor) {
  const msg = { tipo: 'evento', id, acao }
  if (valor !== undefined) msg.valor = valor
  return msg
}

// Digitação: um timer por campo (150 ms) antes de mandar o 'input'.
const pendentes = new Map()

/**
 * Manda o 'input' de um campo na hora, se ele tem um timer pendente.
 * @param {HTMLElement} el
 */
function descarregar(el) {
  const timer = pendentes.get(el)
  if (timer === undefined) return
  clearTimeout(timer)
  pendentes.delete(el)
  enviar(evento(el.dataset.h, 'input', el.value))
}

/** Manda os 'input' pendentes de todos os campos. */
function descarregarTodos() {
  for (const el of Array.from(pendentes.keys())) descarregar(el)
}

raiz.addEventListener('input', e => {
  const el = e.target
  if (!el || !el.matches || !el.matches('input[data-h], textarea[data-h]')) return
  clearTimeout(pendentes.get(el))
  pendentes.set(el, setTimeout(() => {
    pendentes.delete(el)
    enviar(evento(el.dataset.h, 'input', el.value))
  }, 150))
})

raiz.addEventListener('click', e => {
  const alvo = e.target && e.target.closest ? e.target.closest('[role="button"][data-h]') : null
  if (!alvo || !raiz.contains(alvo)) return
  e.preventDefault()
  descarregarTodos()
  enviar(evento(alvo.dataset.h, 'press'))
})

raiz.addEventListener('keydown', e => {
  const alvo = e.target
  if (!alvo || !alvo.matches) return

  // Botão acessível: Enter ou Espaço disparam o clique.
  if (alvo.matches('[role="button"][data-h]')) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      descarregarTodos()
      enviar(evento(alvo.dataset.h, 'press'))
    }
    return
  }

  // Campo de uma linha: Enter envia (submit).
  if (alvo.matches('input[data-h]')) {
    if (e.key === 'Enter') {
      e.preventDefault()
      descarregar(alvo)
      enviar(evento(alvo.dataset.h, 'submit', alvo.value))
    }
    return
  }

  // Campo de várias linhas: Ctrl+Enter ou Cmd+Enter envia; Enter sozinho quebra a linha.
  if (alvo.matches('textarea[data-h]')) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      descarregar(alvo)
      enviar(evento(alvo.dataset.h, 'submit', alvo.value))
    }
  }
})

raiz.addEventListener('change', e => {
  const el = e.target
  if (!el || !el.matches || !el.matches('select[data-h]')) return
  enviar(evento(el.dataset.h, 'select', el.value))
})

raiz.addEventListener('focusout', e => {
  const el = e.target
  if (!el || !el.matches || !el.matches('input[data-h], textarea[data-h]')) return
  descarregar(el)
})

// Ids dos campos que já receberam o foco automático, para não roubar o foco de novo.
const focados = new Set()

/**
 * Aplica o HTML do painel na raiz, preservando o campo em edição.
 * @param {string} html
 */
function aplicarHtml(html) {
  morphdom(raiz, `<div id="raiz">${html}</div>`, {
    onBeforeElUpdated(de, para) {
      if (de === document.activeElement && (de.tagName === 'INPUT' || de.tagName === 'TEXTAREA')) {
        para.value = de.value
        if (de.tagName === 'TEXTAREA') para.textContent = de.value
        else para.setAttribute('value', de.value)
      }
      return !de.isEqualNode(para)
    },
  })
  const auto = raiz.querySelector('[autofocus], [data-autofocus]')
  if (auto && auto.id && !focados.has(auto.id) && !raiz.contains(document.activeElement)) {
    focados.add(auto.id)
    auto.focus()
  }
}

window.addEventListener('message', e => {
  const m = e.data
  if (!m || typeof m !== 'object') return
  if (m.tipo === 'html' && typeof m.html === 'string') aplicarHtml(m.html)
  else if (m.tipo === 'rolar') window.scrollTo({ top: 0 })
})

// Largura: avisa a extensão quando o número de colunas muda (espera 120 ms depois do último ajuste).
let colunasAtuais = medirColunas()
let esperaLargura = null

if (typeof ResizeObserver === 'function') {
  new ResizeObserver(() => {
    clearTimeout(esperaLargura)
    esperaLargura = setTimeout(() => {
      const colunas = medirColunas()
      if (colunas !== colunasAtuais) {
        colunasAtuais = colunas
        enviar({ tipo: 'colunas', colunas })
      }
    }, 120)
  }).observe(raiz)
}

enviar({ tipo: 'pronto', colunas: colunasAtuais })
