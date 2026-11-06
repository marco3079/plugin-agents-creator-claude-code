// Testes de ponta a ponta do estúdio, rodando o código REAL do painel do plugin (pelo bundle --teste).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { criarEstudio } from '../../src/runtime/estudio.js'
import { criarProjetoDeAmostra } from '../amostra.js'

let chamadas = []

/** Cria o estúdio sobre o projeto de exemplo dentro de `base` e espera ele assentar. */
async function montar(base) {
  const { raiz, env } = criarProjetoDeAmostra(base)
  const armazenamento = new Map()
  const e = criarEstudio({
    raiz,
    env,
    armazenamento,
    abrirNoClaude: async t => {
      chamadas.push(t)
    },
    temVistaAberta: () => true,
  })
  await e.iniciar()
  await e.ocioso()
  // a webview sempre tem um desenho antes de qualquer evento: sem ele, disparar() ignora o clique
  await e.desenhar('t', { colunas: 60, tema: 'escuro' })
  return { e, raiz, env }
}

/** Espera o estado assentar e devolve o HTML do desenho da vista 't'. */
async function tela(e) {
  await e.ocioso()
  return e.desenhar('t', { colunas: 60, tema: 'escuro' })
}

/** Primeiro id do último desenho que começa com `prefixo`. Falha com a lista de ids existentes. */
function id(e, prefixo) {
  const ids = e.indice('t').map(item => item.id)
  const achado = ids.find(x => x.startsWith(prefixo))
  assert.ok(achado, `nenhum id começa com "${prefixo}". ids existentes: ${ids.join(', ')}`)
  return achado
}

/** Campo (Input) do desenho cujo rótulo/placeholder contém `texto`. */
function campo(e, texto) {
  const itens = e.indice('t')
  const achado = itens.find(item => item.tipo === 'Input' && String(item.texto).includes(texto))
  assert.ok(achado, `nenhum campo contém "${texto}". itens: ${itens.map(i => `${i.tipo}:${i.id}:${i.texto}`).join(' | ')}`)
  return achado.id
}

/** Caso de teste com pasta temporária própria, apagada no fim. */
function caso(nome, fn) {
  test(nome, { timeout: 60000 }, async () => {
    chamadas = []
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-'))
    try {
      await fn(base)
    } finally {
      fs.rmSync(base, { recursive: true, force: true })
    }
  })
}

caso('1. galeria mostra o título e os agentes do projeto, do usuário e do plugin', async base => {
  const { e } = await montar(base)
  const html = await tela(e)
  assert.ok(html.includes('Estúdio de Agentes'), 'falta o título do estúdio')
  assert.ok(html.includes('revisor-de-codigo'), 'falta o agente revisor-de-codigo')
  assert.ok(html.includes('depurador'), 'falta o agente depurador')
  assert.ok(html.includes('pesquisador'), 'falta o agente pesquisador (do usuário)')
  assert.ok(html.includes('qa-kit:auditor'), 'falta o agente do plugin qa-kit:auditor')
})

caso('2. novo agente: preencher nome e descrição e salvar cria o arquivo', async base => {
  const { e, raiz } = await montar(base)
  await e.disparar('t', { id: 'k:nav-novo', acao: 'press' })
  let html = await tela(e)
  assert.ok(html.includes('Identidade'), 'o editor não abriu (falta "Identidade")')

  await e.disparar('t', { id: 'k:ed-nome', acao: 'input', valor: 'meu-agente' })
  await e.disparar('t', { id: 'k:ed-nome', acao: 'submit', valor: 'meu-agente' })

  html = await tela(e)
  const descricao = campo(e, 'Descrição')
  const texto = 'Revisa migrações. Use antes do deploy.'
  await e.disparar('t', { id: descricao, acao: 'input', valor: texto })
  await e.disparar('t', { id: descricao, acao: 'submit', valor: texto })

  await tela(e)
  await e.disparar('t', { id: 'k:ed-salvar', acao: 'press' })
  await e.ocioso()

  const arquivo = path.join(raiz, '.claude', 'agents', 'meu-agente.md')
  assert.ok(fs.existsSync(arquivo), `o arquivo ${arquivo} não foi criado`)
  const conteudo = fs.readFileSync(arquivo, 'utf8')
  assert.ok(conteudo.includes('name: meu-agente'), `o arquivo não tem "name: meu-agente":\n${conteudo}`)
})

caso('3. excluir agente, ver na lixeira e restaurar', async base => {
  const { e, raiz } = await montar(base)
  const arquivo = path.join(raiz, '.claude', 'agents', 'revisor-de-codigo.md')
  assert.ok(fs.existsSync(arquivo), 'o agente de exemplo não existe antes do teste')

  await tela(e)
  const abrir = e.indice('t').map(item => item.id).find(x => x.startsWith('k:abrir-') && x.includes('revisor-de-codigo'))
  assert.ok(abrir, `nenhum k:abrir- do revisor. ids: ${e.indice('t').map(item => item.id).join(', ')}`)
  await e.disparar('t', { id: abrir, acao: 'press' })
  await tela(e)
  await e.disparar('t', { id: 'k:ed-excluir', acao: 'press' })
  await tela(e)
  await e.disparar('t', { id: 'k:ed-excluir-sim', acao: 'press' })
  await e.ocioso()
  assert.ok(!fs.existsSync(arquivo), 'o arquivo ainda existe depois de excluir')

  await e.abrir('lixeira')
  let html = await tela(e)
  assert.ok(html.includes('revisor-de-codigo'), 'a lixeira não mostra revisor-de-codigo')

  // a lixeira guarda o item com id de tempo (lixo-restaurar-<id>): o único botão de restaurar é o deste agente
  await tela(e)
  await e.disparar('t', { id: id(e, 'k:lixo-restaurar-'), acao: 'press' })
  await e.ocioso()
  assert.ok(fs.existsSync(arquivo), 'o arquivo não voltou depois de restaurar')
})

caso('4. gerar: o pedido vai para o Claude Code, sem /agentes quando o agents-creator não está instalado', async base => {
  const { e } = await montar(base)
  await e.abrir('gerar')
  await tela(e)
  await e.disparar('t', { id: campo(e, 'Pedido'), acao: 'input', valor: 'um revisor de SQL' })
  await e.disparar('t', { id: 'k:gerar-ir', acao: 'press' })
  await e.ocioso()

  assert.ok(chamadas.length >= 1, 'abrirNoClaude não foi chamado')
  assert.ok(chamadas[0].includes('um revisor de SQL'), `o texto não tem o pedido: ${chamadas[0]}`)
  assert.ok(!chamadas[0].startsWith('/agentes'), `o texto não deveria começar com /agentes: ${chamadas[0]}`)

  const html = await tela(e)
  assert.ok(html.includes('Abri o Claude Code'), 'falta o aviso "Abri o Claude Code"')
  assert.ok(!html.includes('Não deu para gerar'), 'apareceu "Não deu para gerar"')
})

caso('4b. gerar: com o agents-creator instalado o texto começa com /agentes', async base => {
  const { e, env } = await montar(base)
  const arquivoPlugins = path.join(env.HOME, '.claude', 'plugins', 'installed_plugins.json')
  const atual = JSON.parse(fs.readFileSync(arquivoPlugins, 'utf8'))
  atual.plugins['agents-creator@x'] = [{ scope: 'user', installPath: path.join(env.HOME, 'x'), version: '1.0.0' }]
  fs.writeFileSync(arquivoPlugins, JSON.stringify(atual, null, 2))
  await e.atualizar()

  await e.abrir('gerar')
  await tela(e)
  await e.disparar('t', { id: campo(e, 'Pedido'), acao: 'input', valor: 'um revisor de SQL' })
  await e.disparar('t', { id: 'k:gerar-ir', acao: 'press' })
  await e.ocioso()

  assert.equal(chamadas[0], '/agentes gerar um revisor de SQL')
})

caso('5. estruturas: a aba mostra o squad de desenvolvimento', async base => {
  const { e } = await montar(base)
  await e.disparar('t', { id: 'k:nav-estruturas', acao: 'press' })
  const html = await tela(e)
  assert.ok(html.includes('Squad de desenvolvimento'), 'falta "Squad de desenvolvimento"')
})

caso('6. mapa: desenha ao menos um SVG', async base => {
  const { e } = await montar(base)
  await e.disparar('t', { id: 'k:nav-mapa', acao: 'press' })
  const html = await tela(e)
  assert.ok(html.includes('<img class="svg"'), 'o mapa não tem <img class="svg"')
})

caso('7. tema claro com colunas estreitas desenha sem quebrar', async base => {
  const { e } = await montar(base)
  const html = await e.desenhar('t', { colunas: 44, tema: 'claro' })
  assert.ok(html.includes('Estúdio de Agentes'), 'falta o título no tema claro')
})
