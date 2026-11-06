// Testes puros da página da webview (src/pagina.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gerarNonce, paginaDoEstudio, paginaSemPasta } from '../src/pagina.js'

test('gerarNonce tem 32 caracteres hex e muda a cada chamada', () => {
  const a = gerarNonce()
  const b = gerarNonce()
  assert.match(a, /^[0-9a-f]{32}$/)
  assert.match(b, /^[0-9a-f]{32}$/)
  assert.notEqual(a, b)
})

test('paginaDoEstudio monta a página com nonce, script, estilo e lugar', () => {
  const html = paginaDoEstudio({
    cspSource: 'vscode-webview://x',
    scriptUri: 'w/s.js',
    estiloUri: 'w/e.css',
    nonce: 'abc',
    lugar: 'aba',
  })
  assert.ok(html.includes("script-src 'nonce-abc'"))
  assert.ok(html.includes('<script nonce="abc" src="w/s.js">'))
  assert.ok(html.includes('href="w/e.css"'))
  assert.ok(html.includes('data-lugar="aba"'))
  assert.ok(html.includes('id="raiz"'))
})

test('paginaDoEstudio trata lugar desconhecido como lateral', () => {
  const html = paginaDoEstudio({
    cspSource: 'vscode-webview://x',
    scriptUri: 'w/s.js',
    estiloUri: 'w/e.css',
    nonce: 'abc',
    lugar: 'xyz',
  })
  assert.ok(html.includes('data-lugar="lateral"'))
  assert.ok(!html.includes('data-lugar="xyz"'))
})

test('paginaDoEstudio escapa valores interpolados nos atributos', () => {
  const html = paginaDoEstudio({
    cspSource: 'vscode-webview://x',
    scriptUri: 'w/"s".js',
    estiloUri: 'w/e.css',
    nonce: 'abc',
  })
  assert.ok(html.includes('src="w/&quot;s&quot;.js"'))
  assert.ok(!html.includes('src="w/"s"'))
})

test('paginaSemPasta não tem script e mostra o aviso de pasta', () => {
  const html = paginaSemPasta({ cspSource: 'vscode-webview://x', estiloUri: 'w/e.css' })
  assert.ok(!html.includes('<script'))
  assert.ok(!html.includes('script-src'))
  assert.ok(html.includes('Abra uma pasta de projeto'))
})
