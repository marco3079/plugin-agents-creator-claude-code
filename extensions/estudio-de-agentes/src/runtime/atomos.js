/**
 * Substitui o módulo 'claude-code' no bundle da extensão: atom, read, update e o estado em memória.
 */

export const ESTADO = Symbol.for('estudio-de-agentes.estado')

/**
 * Declara um átomo: uma chave de valor guardada no estado.
 * @param {{ plugin: string, key: string, id?: string }} ref
 * @param {*} initial valor inicial, usado enquanto nada foi gravado
 * @param {{ shape?: * }} [options]
 * @returns {Readonly<{ ref: object, initial: *, shape?: * }>}
 */
export function atom(ref, initial, options) {
  return Object.freeze({
    ref: Object.freeze({ ...ref }),
    initial,
    ...(options && options.shape ? { shape: options.shape } : {}),
  })
}

/** Chave interna do átomo: `plugin/key` (+ `#id` quando houver). */
function chave(ref) {
  return `${ref.plugin}/${ref.key}` + (ref.id !== undefined ? `#${ref.id}` : '')
}

/** Cópia profunda do valor (undefined continua undefined). */
function copiar(valor) {
  return valor === undefined ? undefined : structuredClone(valor)
}

/**
 * Cria o estado em memória usado pelo `$` falso.
 * @returns {{
 *   ler: (a: object) => *,
 *   escrever: (a: object, valor: *) => boolean,
 *   valor: (plugin: string, key: string) => *,
 *   aoMudar: (fn: (chave: string) => void) => () => void,
 *   readonly versao: number
 * }}
 */
export function criarEstado() {
  const valores = new Map()
  const ouvintes = new Set()
  let versao = 0

  return {
    /** Cópia do valor gravado, ou cópia do initial se nunca foi gravado. */
    ler(a) {
      const k = chave(a.ref)
      return valores.has(k) ? copiar(valores.get(k)) : copiar(a.initial)
    },

    /** Grava uma cópia. Não faz nada (devolve false) se o JSON for igual ao já gravado. */
    escrever(a, valor) {
      const k = chave(a.ref)
      if (valores.has(k) && JSON.stringify(valores.get(k)) === JSON.stringify(valor)) return false
      valores.set(k, copiar(valor))
      versao += 1
      for (const fn of [...ouvintes]) {
        try {
          fn(k)
        } catch {
          // erro de ouvinte é ignorado
        }
      }
      return true
    },

    /** Cópia do valor gravado em `plugin/key`, ou undefined. */
    valor(plugin, key) {
      const k = `${plugin}/${key}`
      return valores.has(k) ? copiar(valores.get(k)) : undefined
    },

    /** Registra um ouvinte; a função devolvida o remove. */
    aoMudar(fn) {
      ouvintes.add(fn)
      return () => {
        ouvintes.delete(fn)
      }
    },

    /** Contador que cresce a cada escrita que mudou algo. */
    get versao() {
      return versao
    },
  }
}

/** Obtém o estado do `$`; falha se o `$` não tiver ESTADO. */
function estadoDe($) {
  if (!$ || !$[ESTADO]) throw new Error('estado ausente: o $ não tem ESTADO')
  return $[ESTADO]
}

/** Lê o valor atual de um átomo. */
export async function read($, a) {
  return estadoDe($).ler(a)
}

/** Grava `await fn(atual)` no átomo e devolve o novo valor. */
export async function update($, a, fn) {
  const e = estadoDe($)
  const atual = e.ler(a)
  const proximo = await fn(atual)
  e.escrever(a, proximo)
  return proximo
}
