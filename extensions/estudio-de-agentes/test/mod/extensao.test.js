// Testes da extensão (src/extension.js) com o `vscode` falso. Rodam pelo bundle: `node scripts/build.mjs --teste`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as vscode from 'vscode'
import { activate, _estudioAtual } from '../../src/extension.js'
import { criarProjetoDeAmostra } from '../amostra.js'

const VISTA = 'estudioDeAgentes.painel'
const ABA = 'estudioDeAgentes.aba'
const EXT = path.resolve(process.cwd())
const COMANDOS_DA_EXTENSAO = [
  'estudioDeAgentes.abrirEmAba',
  'estudioDeAgentes.atualizar',
  'estudioDeAgentes.novo',
  'estudioDeAgentes.abrirNoClaude',
  'estudioDeAgentes.focar',
]

const ORIGINAIS = {
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
}

/** Espera uma condição ficar verdadeira, testando a cada 25 ms. */
async function esperar(cond, ms = 15000) {
  const fim = Date.now() + ms
  while (Date.now() < fim) {
    if (await cond()) return
    await new Promise(r => setTimeout(r, 25))
  }
  assert.fail('tempo esgotado esperando a condição')
}

/** Contexto de extensão falso. */
function contexto() {
  return {
    subscriptions: [],
    extensionUri: vscode.Uri.file(EXT),
    globalState: {
      m: new Map(),
      get(k) {
        return this.m.get(k)
      },
      update(k, v) {
        this.m.set(k, v)
        return Promise.resolve()
      },
    },
  }
}

/** Limpa o registro, cria o projeto de exemplo e aponta HOME para ele. */
function preparar() {
  vscode.reiniciar()
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-'))
  const amostra = criarProjetoDeAmostra(base)
  process.env.HOME = amostra.home
  process.env.USERPROFILE = amostra.home
  delete process.env.CLAUDE_CONFIG_DIR
  return { base, raiz: amostra.raiz }
}

/** Restaura as variáveis de ambiente e apaga a pasta temporária. */
function restaurar(base) {
  for (const [k, v] of Object.entries(ORIGINAIS)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  fs.rmSync(base, { recursive: true, force: true })
}

/** Desfaz as assinaturas registradas pela extensão (estúdio, observadores, timers). */
function encerrar(ctx) {
  for (const d of ctx.subscriptions) d?.dispose?.()
}

/** Verdadeiro se alguma chamada registrada tem exatamente os valores esperados. */
function temChamada(lista, esperada) {
  return lista.some(c => c.length === esperada.length && esperada.every((x, i) => c[i] === x))
}

test('registra a barra lateral com retainContextWhenHidden e os 5 comandos', { timeout: 60000 }, async () => {
  const p = preparar()
  try {
    vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file(p.raiz) }]
    const ctx = contexto()
    activate(ctx)
    try {
      const provedor = vscode.registro.provedores.get(VISTA)
      assert.ok(provedor, 'provedor da vista não foi registrado')
      assert.equal(provedor.opcoes.webviewOptions.retainContextWhenHidden, true)
      for (const id of COMANDOS_DA_EXTENSAO) {
        assert.ok(vscode.registro.comandos.has(id), `comando ${id} não registrado`)
      }
    } finally {
      encerrar(ctx)
    }
  } finally {
    restaurar(p.base)
  }
})

test('resolve a vista da barra lateral e desenha o estúdio ao receber "pronto"', { timeout: 60000 }, async () => {
  const p = preparar()
  try {
    vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file(p.raiz) }]
    const ctx = contexto()
    activate(ctx)
    try {
      const vista = vscode.criarVistaFalsa()
      vscode.registro.provedores.get(VISTA).provedor.resolveWebviewView(vista)
      assert.ok(vista.webview.html.includes('webview:'), 'html sem o caminho da webview')
      assert.ok(vista.webview.html.includes('webview.js'), 'html sem o script webview.js')
      assert.ok(vista.webview.html.includes('nonce-'), 'html sem nonce')

      await vista.webview.enviar({ tipo: 'pronto', colunas: 50 })
      await esperar(() =>
        vista.webview.postados.some(
          m => m.tipo === 'html' && m.html.includes('Estúdio de Agentes') && m.html.includes('revisor-de-codigo'),
        ),
      )
    } finally {
      encerrar(ctx)
    }
  } finally {
    restaurar(p.base)
  }
})

test('um clique em "+ Novo" redesenha a vista com o formulário de identidade', { timeout: 60000 }, async () => {
  const p = preparar()
  try {
    vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file(p.raiz) }]
    const ctx = contexto()
    activate(ctx)
    try {
      const vista = vscode.criarVistaFalsa()
      vscode.registro.provedores.get(VISTA).provedor.resolveWebviewView(vista)
      await vista.webview.enviar({ tipo: 'pronto', colunas: 50 })
      await esperar(() => vista.webview.postados.some(m => m.tipo === 'html'))

      const id = _estudioAtual().indice('lateral').find(i => i.id === 'k:nav-novo').id
      const antes = vista.webview.postados.length
      await vista.webview.enviar({ tipo: 'evento', id, acao: 'press' })
      await esperar(() =>
        vista.webview.postados.slice(antes).some(m => m.tipo === 'html' && m.html.includes('Identidade')),
      )
    } finally {
      encerrar(ctx)
    }
  } finally {
    restaurar(p.base)
  }
})

test('"Abrir no Claude" pede ao Claude Code a conversa com "/agentes"', { timeout: 60000 }, async () => {
  const p = preparar()
  try {
    vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file(p.raiz) }]
    const ctx = contexto()
    activate(ctx)
    try {
      vscode.registro.comandos.set('claude-vscode.primaryEditor.open', () => undefined)
      await vscode.commands.executeCommand('estudioDeAgentes.abrirNoClaude')
      assert.ok(
        temChamada(vscode.registro.executados, ['claude-vscode.primaryEditor.open', undefined, '/agentes']),
        `chamadas: ${JSON.stringify(vscode.registro.executados)}`,
      )
    } finally {
      encerrar(ctx)
    }
  } finally {
    restaurar(p.base)
  }
})

test('"Abrir em aba" cria o painel do editor uma única vez e depois só revela', { timeout: 60000 }, async () => {
  const p = preparar()
  try {
    vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file(p.raiz) }]
    const ctx = contexto()
    activate(ctx)
    try {
      await vscode.commands.executeCommand('estudioDeAgentes.abrirEmAba')
      assert.equal(vscode.registro.paineis.length, 1)
      assert.equal(vscode.registro.paineis[0].tipo, ABA)
      assert.ok(vscode.registro.paineis[0].webview.html.includes('data-lugar="aba"'), 'html da aba sem data-lugar="aba"')

      await vscode.commands.executeCommand('estudioDeAgentes.abrirEmAba')
      assert.equal(vscode.registro.paineis.length, 1, 'não deveria criar outra aba')
      assert.equal(vscode.registro.paineis[0].revelado, true, 'a aba existente deveria ser revelada')
    } finally {
      encerrar(ctx)
    }
  } finally {
    restaurar(p.base)
  }
})

test('sem pasta de projeto a vista mostra o aviso e não tem script', { timeout: 60000 }, async () => {
  const p = preparar()
  try {
    vscode.workspace.workspaceFolders = []
    const ctx = contexto()
    activate(ctx)
    try {
      const vista = vscode.criarVistaFalsa()
      vscode.registro.provedores.get(VISTA).provedor.resolveWebviewView(vista)
      assert.ok(vista.webview.html.includes('Abra uma pasta de projeto'), 'falta o aviso de pasta')
      assert.ok(!vista.webview.html.includes('<script'), 'a página sem pasta não deveria ter <script')
    } finally {
      encerrar(ctx)
    }
  } finally {
    restaurar(p.base)
  }
})

test('com pasta cria os 6 observadores de arquivos (uma vez)', { timeout: 60000 }, async () => {
  const p = preparar()
  try {
    vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file(p.raiz) }]
    const ctx = contexto()
    activate(ctx)
    try {
      const vista = vscode.criarVistaFalsa()
      vscode.registro.provedores.get(VISTA).provedor.resolveWebviewView(vista)
      await vista.webview.enviar({ tipo: 'pronto', colunas: 50 })
      await esperar(() => vista.webview.postados.some(m => m.tipo === 'html'))
      assert.equal(vscode.registro.observadores.length, 6)
    } finally {
      encerrar(ctx)
    }
  } finally {
    restaurar(p.base)
  }
})
