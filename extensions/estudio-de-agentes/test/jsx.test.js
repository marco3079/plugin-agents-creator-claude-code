import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Fragment, NOMES, TABELA, h, normalizarFilhos } from '../src/runtime/jsx.js'

test('h(TABELA.Box, { gap: 1 }, "a") gera Box com children', () => {
  assert.deepEqual(h(TABELA.Box, { gap: 1 }, 'a'), { type: 'Box', props: { gap: 1 }, children: ['a'] })
})

test('TABELA tem os 8 tipos e NOMES os lista', () => {
  assert.deepEqual(Object.keys(TABELA), NOMES)
  assert.deepEqual(NOMES, ['Box', 'Text', 'Button', 'Code', 'Markdown', 'Input', 'Select', 'Svg'])
})

test('filhos em arrays aninhados são achatados; null/false/true/"" somem; número vira string', () => {
  assert.deepEqual(normalizarFilhos([1, [2, [null, 'x', [false, true, '', [3.5]]]], undefined]), ['1', '2', 'x', '3.5'])
  assert.deepEqual(
    h(TABELA.Text, null, ['a', [null, 'b']], false, 7),
    { type: 'Text', props: {}, children: ['a', 'b', '7'] },
  )
})

test('normalizarFilhos devolve sempre um array novo', () => {
  const lista = [{ type: 'Box' }]
  const r = normalizarFilhos(lista)
  assert.notEqual(r, lista)
  assert.deepEqual(normalizarFilhos(undefined), [])
})

test('componente-função recebe children (filho único = o próprio filho; vários = array) e devolve o resultado', () => {
  const vistos = []
  const Comp = (props) => {
    vistos.push(props.children)
    return { type: 'Marcador', props: {}, children: [] }
  }
  const unico = h(Comp, { cor: 'red' }, 'x')
  assert.equal(vistos[0], 'x')
  assert.deepEqual(unico, { type: 'Marcador', props: {}, children: [] })

  h(Comp, null, 'x', 'y')
  assert.deepEqual(vistos[1], ['x', 'y'])
})

test('h(Fragment, null, x, y) gera Box em coluna com os dois filhos', () => {
  const x = { type: 'Text', props: {}, children: ['1'] }
  const y = { type: 'Text', props: {}, children: ['2'] }
  assert.deepEqual(h(Fragment, null, x, y), {
    type: 'Box',
    props: { flexDirection: 'column' },
    children: [x, y],
  })
})

test('key e handlers ficam em props; children nunca fica em props', () => {
  const onPress = () => {}
  const el = h(TABELA.Button, { key: 'nav-novo', onPress, label: 'Novo' }, 'texto')
  assert.equal(el.props.key, 'nav-novo')
  assert.equal(el.props.onPress, onPress)
  assert.equal(el.props.label, 'Novo')
  assert.equal('children' in el.props, false)
  assert.deepEqual(el.children, ['texto'])
})

test('string desconhecida lança erro', () => {
  assert.throws(() => h('div', null), /elemento desconhecido: div/)
  assert.throws(() => h('toString', null), /elemento desconhecido: toString/)
})
