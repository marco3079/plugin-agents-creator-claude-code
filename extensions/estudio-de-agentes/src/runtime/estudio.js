// Orquestração do estúdio: liga o painel do plugin ao motor, ao desenho HTML e à entrega ao Claude Code.
import { loadPersisted, openStudio, refresh, say, setFlags, setGen, setTest } from '../../../../hooks/actions'
import { carregarEstruturas } from '../../../../hooks/estruturas'
import { makeKit } from '../../../../hooks/ui/kit'
import { renderPane } from '../../../../hooks/ui/pane'
import { AVISOS, textoGerar, textoMelhorar, textoTestar, tipoDoPedido } from './handoff.js'
import { esc, paraHtml } from './html.js'
import { TABELA } from './jsx.js'
import { criarMotor } from './motor.js'

/**
 * Cria o estúdio de agentes para uma ou mais vistas (barra lateral, aba).
 * @param {object} opcoes - { raiz, armazenamento, abrirNoClaude, temVistaAberta?, aoRolar?, env? }
 * @returns {object} { iniciar, desenhar, disparar, atualizar, abrir, aoMudar, descartar, indice, ocioso, interno }
 */
export function criarEstudio(opcoes) {
  // vistaId -> { handlers, indice } do último desenho
  const vistas = new Map()

  const { $, estado, pendentes } = criarMotor({
    raiz: opcoes.raiz,
    armazenamento: opcoes.armazenamento,
    abrirNoClaude: opcoes.abrirNoClaude,
    handoff: { tipoDoPedido, textoGerar, textoMelhorar, textoTestar },
    aoHandoff: tipo => void aplicarAviso(tipo),
    aoRolar: opcoes.aoRolar,
    temVistaAberta: opcoes.temVistaAberta,
    env: opcoes.env,
  })

  /** Libera o estado de "trabalhando" da ação de IA e mostra o aviso no lugar do erro. */
  async function aplicarAviso(tipo) {
    try {
      if (tipo === 'gerar') await setGen($, { busy: false, error: '' })
      else if (tipo === 'melhorar') await setFlags($, { improving: false })
      else if (tipo === 'testar') await setTest($, { busy: false, error: '', answer: '' })
      await say($, 'info', AVISOS[tipo])
    } catch (erro) {
      console.error('[estudio] aviso', erro)
    }
  }

  /** Executa uma operação do painel sem deixar a exceção escapar. */
  async function tentar(rotulo, fn) {
    try {
      return await fn()
    } catch (erro) {
      console.error(`[estudio] ${rotulo}`, erro)
    }
  }

  async function iniciar() {
    await tentar('loadPersisted', () => loadPersisted($))
    await tentar('openStudio', () => openStudio($, ''))
    await tentar('carregarEstruturas', () => carregarEstruturas($))
  }

  async function desenhar(vistaId, { colunas, tema }) {
    const cols = Math.max(30, Math.round(Number(colunas) || 60))
    try {
      const arvore = await renderPane($, makeKit(TABELA, 'vscode', cols))
      const r = paraHtml(arvore, { tema })
      vistas.set(vistaId, { handlers: r.handlers, indice: r.indice })
      return r.html
    } catch (erro) {
      console.error('[estudio] desenhar', erro)
      const mensagem = esc(erro?.message ?? erro)
      return `<div class="box" style="display:flex;flex-direction:column;border:1px solid var(--c-error);border-radius:12px;padding:6px 9px"><span class="text" style="color:var(--c-error)">Não foi possível desenhar o estúdio: ${mensagem}</span></div>`
    }
  }

  async function disparar(vistaId, evento) {
    const h = vistas.get(vistaId)?.handlers?.[evento.id]
    if (!h) return // desenho antigo
    const arg = { element: evento.id }
    const valor = evento.valor ?? ''
    try {
      if (evento.acao === 'press') h.onPress?.(arg)
      else if (evento.acao === 'input') h.onInput?.(valor, arg)
      else if (evento.acao === 'submit') h.onSubmit?.(valor, arg)
      else if (evento.acao === 'select') h.onSelect?.(valor, arg)
    } catch (erro) {
      console.error('[estudio] disparar', erro)
    }
  }

  async function atualizar() {
    await tentar('refresh', () => refresh($))
    await tentar('carregarEstruturas', () => carregarEstruturas($))
  }

  async function abrir(args) {
    await tentar('openStudio', () => openStudio($, String(args ?? '')))
    await tentar('carregarEstruturas', () => carregarEstruturas($))
  }

  function aoMudar(fn) {
    return estado.aoMudar(() => fn())
  }

  function descartar(vistaId) {
    vistas.delete(vistaId)
  }

  function indice(vistaId) {
    return vistas.get(vistaId)?.indice ?? []
  }

  /** Resolve quando o estado para de mudar por `quietoMs` e não há operação pendente (ou ao passar de `limiteMs`). */
  async function ocioso({ quietoMs = 80, limiteMs = 8000 } = {}) {
    const inicio = Date.now()
    for (;;) {
      const versao = estado.versao
      await new Promise(resolve => setTimeout(resolve, quietoMs))
      if (Date.now() - inicio > limiteMs) return
      if (estado.versao === versao && pendentes() === 0) return
    }
  }

  return {
    iniciar,
    desenhar,
    disparar,
    atualizar,
    abrir,
    aoMudar,
    descartar,
    indice,
    ocioso,
    interno: { $, estado },
  }
}
