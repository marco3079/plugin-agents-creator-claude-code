// Testes de src/claude.js com uma API do VS Code falsa.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { criarAbridorDoClaude } from '../src/claude.js'

function vscodeFalso({ comandos = [], executar, extensao = false } = {}) {
  const chamadas = { executar: [], uris: [], copiados: [], avisos: [] }
  const vscode = {
    commands: {
      getCommands: async () => comandos,
      executeCommand: async (...args) => {
        chamadas.executar.push(args)
        if (executar) return executar()
      },
    },
    extensions: { getExtension: () => (extensao ? { id: 'anthropic.claude-code' } : undefined) },
    env: {
      uriScheme: 'vscode',
      openExternal: async uri => {
        chamadas.uris.push(uri)
        return true
      },
      clipboard: {
        writeText: async texto => {
          chamadas.copiados.push(texto)
        },
      },
    },
    window: {
      showWarningMessage: msg => {
        chamadas.avisos.push(msg)
        return Promise.resolve(undefined)
      },
    },
    Uri: { parse: s => ({ texto: s, toString: () => s }) },
  }
  return { vscode, chamadas }
}

test('usa o comando do Claude Code quando ele existe', async () => {
  const { vscode, chamadas } = vscodeFalso({ comandos: ['claude-vscode.primaryEditor.open'] })
  const abrir = criarAbridorDoClaude(vscode)
  assert.equal(await abrir('/agentes'), 'aba')
  assert.deepEqual(chamadas.executar, [['claude-vscode.primaryEditor.open', undefined, '/agentes']])
  assert.equal(chamadas.uris.length, 0)
})

test('sem o comando, mas com a extensão, abre pelo link', async () => {
  const { vscode, chamadas } = vscodeFalso({ extensao: true })
  const abrir = criarAbridorDoClaude(vscode)
  assert.equal(await abrir('/agentes'), 'uri')
  assert.equal(chamadas.uris.length, 1)
  assert.ok(chamadas.uris[0].texto.includes('anthropic.claude-code/open?prompt=%2Fagentes'))
  assert.equal(chamadas.copiados.length, 0)
})

test('se o comando lança erro, cai no link', async () => {
  const { vscode, chamadas } = vscodeFalso({
    comandos: ['claude-vscode.primaryEditor.open'],
    extensao: true,
    executar: () => {
      throw new Error('falhou')
    },
  })
  const abrir = criarAbridorDoClaude(vscode)
  assert.equal(await abrir('/agentes'), 'uri')
  assert.equal(chamadas.executar.length, 1)
  assert.equal(chamadas.uris.length, 1)
})

test('sem nada disponível, copia o texto e avisa', async () => {
  const { vscode, chamadas } = vscodeFalso()
  const abrir = criarAbridorDoClaude(vscode)
  assert.equal(await abrir('/agentes'), 'copiado')
  assert.deepEqual(chamadas.copiados, ['/agentes'])
  assert.equal(chamadas.avisos.length, 1)
  assert.equal(chamadas.uris.length, 0)
})
