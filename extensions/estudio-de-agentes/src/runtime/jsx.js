/**
 * Fábrica JSX (h, Fragment) e a tabela de elementos do painel, no lugar de $.ui.resolve.
 */

export const NOMES = ['Box', 'Text', 'Button', 'Code', 'Markdown', 'Input', 'Select', 'Svg']

/**
 * Achata filhos em qualquer profundidade, descarta null/undefined/true/false/'' e
 * converte números em string. Sempre devolve um array novo.
 * @param {*} lista
 * @returns {Array<object|string>}
 */
export function normalizarFilhos(lista) {
  const saida = []
  const andar = (x) => {
    if (Array.isArray(x)) {
      for (const y of x) andar(y)
      return
    }
    if (x === null || x === undefined || x === true || x === false || x === '') return
    if (typeof x === 'number') {
      saida.push(String(x))
      return
    }
    saida.push(x)
  }
  andar(lista)
  return saida
}

/** Cria o construtor de um tipo de elemento: props => { type, props (sem children), children }. */
function construtor(tipo) {
  const f = (props) => {
    const { children, ...resto } = props ?? {}
    return { type: tipo, props: resto, children: normalizarFilhos([children]) }
  }
  Object.defineProperty(f, 'name', { value: tipo })
  return f
}

/** Tabela dos 8 tipos de elemento do painel. */
export const TABELA = Object.freeze(Object.fromEntries(NOMES.map((n) => [n, construtor(n)])))

/**
 * Fábrica JSX: `h(tag, props, ...filhos)`.
 * Função é chamada com as props (children incluído); string precisa ser um tipo da TABELA.
 */
export function h(tag, props, ...filhos) {
  const p = { ...(props ?? {}) }
  if (filhos.length === 1) p.children = filhos[0]
  else if (filhos.length > 1) p.children = filhos
  if (typeof tag === 'function') return tag(p)
  if (typeof tag === 'string' && Object.prototype.hasOwnProperty.call(TABELA, tag)) return TABELA[tag](p)
  throw new Error(`elemento desconhecido: ${String(tag)}`)
}

/** Fragmento: vira um Box em coluna com os filhos. */
export function Fragment(props) {
  return {
    type: 'Box',
    props: { flexDirection: 'column' },
    children: normalizarFilhos([props && props.children]),
  }
}
