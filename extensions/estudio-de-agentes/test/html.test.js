import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paraHtml, esc, cor, textoPlano, espaco, TEMAS } from '../src/runtime/html.js'

const LIGHT = '.bg{fill:#ffffff}.bd{stroke:#d9dbe1}.fg{fill:#1c2024}.mut{fill:#60646c}.ln{stroke:#b9bbc6}.chip{fill:#eef0f3}'
const DARK = '.bg{fill:#1b1c20}.bd{stroke:#3a3d45}.fg{fill:#edeef0}.mut{fill:#a6a9b2}.ln{stroke:#5a5e68}.chip{fill:#2b2d33}'

const box = (props, ...children) => ({ type: 'Box', props, children })
const texto = (props, ...children) => ({ type: 'Text', props, children })
const botao = (props, ...children) => ({ type: 'Button', props, children })
const decodificaSvg = html => Buffer.from(html.match(/base64,([^"]+)"/)[1], 'base64').toString('utf8')

test('utilitários: esc, cor, espaco, textoPlano e TEMAS', () => {
  assert.equal(esc(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;')
  assert.equal(cor('error'), 'var(--c-error)')
  assert.equal(cor('#e5484d'), '#e5484d')
  assert.equal(cor(''), '')
  assert.equal(espaco(2, 9), 18)
  assert.equal(espaco('md', 9), 18)
  assert.equal(espaco(undefined, 9), null)
  assert.equal(textoPlano(['a', 1, botao({}, 'b')]), 'a1b')
  assert.equal(TEMAS.size, 23)
})

test('Box: gap, padding, borda e fundo padrão', () => {
  const { html } = paraHtml(box({ gap: 1, paddingX: 1, paddingY: 1, borderStyle: 'round', borderColor: 'success' }))
  assert.match(html, /gap:9px/)
  assert.match(html, /padding:6px 9px 6px 9px/)
  assert.match(html, /border:1px solid var\(--c-success\)/)
  assert.match(html, /border-radius:12px/)
  assert.match(html, /background:var\(--card\)/)
})

test('Text: cor, cor de tema, dimColor e negrito', () => {
  assert.match(paraHtml(texto({ color: 'error' }, 'x')).html, /color:var\(--c-error\)/)
  assert.match(paraHtml(texto({ color: '#e5484d' }, 'x')).html, /color:#e5484d/)
  assert.match(paraHtml(texto({ dimColor: true }, 'x')).html, /color:var\(--dim\)/)
  assert.match(paraHtml(texto({ bold: true }, 'x')).html, /font-weight:600/)
})

test('Button com key: id k:salvar, classe, corpo, handler e indice', () => {
  const salvar = () => {}
  const r = paraHtml(botao({ key: 'salvar', variant: 'primary', label: 'Salvar', onPress: salvar }))
  assert.match(r.html, /data-h="k:salvar"/)
  assert.match(r.html, /class="btn primary"/)
  assert.match(r.html, />Salvar<\/span>/)
  assert.equal(r.handlers['k:salvar'].onPress, salvar)
  assert.deepEqual(r.indice, [{ id: 'k:salvar', tipo: 'Button', texto: 'Salvar' }])
})

test('Button sem key ganha id por caminho; keys repetidas ganham ~1', () => {
  const sem = paraHtml(box({}, botao({ label: 'Um' })))
  assert.equal(sem.indice[0].id, 'p:0.0')
  assert.ok(sem.handlers['p:0.0'])

  const repetido = paraHtml(box({}, botao({ key: 'x', label: 'a' }), botao({ key: 'x', label: 'b' })))
  assert.deepEqual(repetido.indice.map(i => i.id), ['k:x', 'k:x~1'])
  assert.ok(repetido.handlers['k:x~1'])
})

test('Input: rows 1 vira input escapado; rows 3 vira textarea; handlers onInput e onSubmit', () => {
  const onInput = () => {}
  const onSubmit = () => {}
  const campo = { type: 'Input', props: { key: 'nome', value: 'a"b', placeholder: 'Nome', rows: 1, onInput, onSubmit }, children: [] }
  const r1 = paraHtml(campo)
  assert.match(r1.html, /<input/)
  assert.match(r1.html, /value="a&quot;b"/)
  assert.match(r1.html, /placeholder="Nome"/)
  assert.equal(r1.handlers['k:nome'].onInput, onInput)
  assert.equal(r1.handlers['k:nome'].onSubmit, onSubmit)

  const multi = paraHtml({ type: 'Input', props: { key: 'texto', value: 'oi', rows: 3, onInput, onSubmit }, children: [] })
  assert.match(multi.html, /<textarea/)
  assert.match(multi.html, /rows="3"/)
  assert.match(multi.html, /data-multi="1"/)
})

test('Select: selected só na opção do value e handler onSelect', () => {
  const onSelect = () => {}
  const options = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]
  const r = paraHtml({ type: 'Select', props: { key: 'tipo', options, value: 'b', onSelect }, children: [] })
  assert.equal(r.html.match(/selected/g).length, 1)
  assert.match(r.html, /<option value="b" selected>B<\/option>/)
  assert.equal(r.handlers['k:tipo'].onSelect, onSelect)
})

test('Svg: no tema escuro troca LIGHT por DARK; no claro mantém LIGHT', () => {
  const svg = { type: 'Svg', props: { source: `<svg>${LIGHT}</svg>`, alt: 'ícone' }, children: [] }
  const escuro = decodificaSvg(paraHtml(svg, { tema: 'escuro' }).html)
  const claro = decodificaSvg(paraHtml(svg, { tema: 'claro' }).html)
  assert.ok(escuro.includes(DARK))
  assert.ok(claro.includes(LIGHT))
})

test('Markdown: listas e negrito', () => {
  const md = texto => paraHtml({ type: 'Markdown', props: { text: texto }, children: [] }).html
  assert.match(md('- a\n- b'), /<ul><li>a<\/li><li>b<\/li><\/ul>/)
  assert.match(md('**x**'), /<b>x<\/b>/)
})

test('Texto com <script> sai escapado', () => {
  assert.match(paraHtml(texto({}, '<script>')).html, /&lt;script&gt;/)
})

test('Hover de Box: data-hover-bg e --hv-bg', () => {
  const { html } = paraHtml(box({ hover: { backgroundColor: 'subtle' } }))
  assert.match(html, /data-hover-bg/)
  assert.match(html, /--hv-bg:var\(--c-subtle\)/)
})
