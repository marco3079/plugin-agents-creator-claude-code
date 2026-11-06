// As funções puras das dependências do estúdio: comparação de versões, leitura dos arquivos do claude
// (instalados, marketplaces e catálogos), estado de cada plugin e o comando que o corrige.

import { expect, test } from 'claude-code/testing'

import {
  DEPENDENCIAS,
  ativacaoDe,
  comandoDe,
  compararVersoes,
  entradaNoCatalogo,
  estadoComAtivacao,
  estadoDe,
  marketplacesConhecidos,
  versaoDoManifesto,
  versoesInstaladas,
} from '../hooks/lib/dependencias'

// Os mesmos ids do campo "dependencies" de .claude-plugin/plugin.json.
const IDS_ESPERADOS = [
  'historico@historico-requisicoes',
  'historico-painel@historico-requisicoes',
  'diff-review@skill-diff-claude-code',
  'diff-review-pane@skill-diff-claude-code',
  'squad-stream@skill-squad-room',
  'squad-room-pane@skill-squad-room',
  'popup-perguntas@popup-perguntas',
]

/** Um installed_plugins.json (versão 2, como o claude grava) com as entradas dadas. */
function instalados(plugins: Record<string, { scope: string; version: string }[]>): string {
  return JSON.stringify({ version: 2, plugins })
}

test('compararVersoes compara as partes numéricas, não o texto', async () => {
  expect(compararVersoes('0.2.0', '0.10.0')).toBe(-1)
  expect(compararVersoes('0.10.0', '0.2.0')).toBe(1)
  expect(compararVersoes('2.0.0', '1.9.9')).toBe(1)
  expect(compararVersoes('1.0', '1.0.0')).toBe(0)
})

test('versoesInstaladas dá a versão de cada id: prefere o escopo user e, sem ele, usa o do projeto', async () => {
  const json = instalados({
    'historico@historico-requisicoes': [
      { scope: 'project', version: '0.9.0' },
      { scope: 'user', version: '1.0.0' },
    ],
    'popup-perguntas@popup-perguntas': [
      { scope: 'user', version: '1.0.0' },
      { scope: 'project', version: '0.9.0' },
    ],
    'squad-stream@skill-squad-room': [{ scope: 'user', version: '0.2.0' }],
    'diff-review@skill-diff-claude-code': [{ scope: 'project', version: '2.0.0' }],
  })
  expect(versoesInstaladas(json)).toEqual({
    'historico@historico-requisicoes': '1.0.0',
    'popup-perguntas@popup-perguntas': '1.0.0',
    'squad-stream@skill-squad-room': '0.2.0',
    'diff-review@skill-diff-claude-code': '2.0.0',
  })
})

test('versoesInstaladas com arquivo ausente ou inválido devolve vazio', async () => {
  expect(versoesInstaladas(null)).toEqual({})
  expect(versoesInstaladas('{ isto não é json')).toEqual({})
  expect(versoesInstaladas('{"version":2}')).toEqual({})
})

test('marketplacesConhecidos marca como local o marketplace de pasta e guarda o caminho dele', async () => {
  const json = JSON.stringify({
    'historico-requisicoes': {
      source: { source: 'github', repo: 'exemplo/historico-requisicoes' },
      installLocation: '/home/u/.claude/plugins/marketplaces/historico-requisicoes',
    },
    'skill-squad-room': {
      source: { source: 'directory', path: '/dev/skill-squad-room' },
      installLocation: '/dev/skill-squad-room',
    },
  })
  expect(marketplacesConhecidos(json)).toEqual({
    'historico-requisicoes': { local: false, pasta: '/home/u/.claude/plugins/marketplaces/historico-requisicoes' },
    'skill-squad-room': { local: true, pasta: '/dev/skill-squad-room' },
  })
  expect(marketplacesConhecidos(null)).toEqual({})
})

test('entradaNoCatalogo dá versão e fonte da entrada; o que não é texto, ou não existe, vira vazio', async () => {
  const catalogo = JSON.stringify({
    name: 'historico-requisicoes',
    plugins: [
      // O historico-painel vem antes do historico: uma busca por prefixo acharia a entrada errada.
      { name: 'historico-painel', source: './painel', version: '1.1.0' },
      { name: 'historico', source: './plugin' },
      { name: 'externo', source: { source: 'github', repo: 'exemplo/externo' }, version: '2.0.0' },
    ],
  })
  expect(entradaNoCatalogo(catalogo, 'historico-painel')).toEqual({ versao: '1.1.0', fonte: './painel' })
  expect(entradaNoCatalogo(catalogo, 'historico')).toEqual({ versao: '', fonte: './plugin' })
  expect(entradaNoCatalogo(catalogo, 'externo')).toEqual({ versao: '2.0.0', fonte: '' })
  expect(entradaNoCatalogo(catalogo, 'nao-existe')).toEqual({ versao: '', fonte: '' })
  expect(entradaNoCatalogo(null, 'historico')).toEqual({ versao: '', fonte: '' })
})

test('versaoDoManifesto lê a versão do plugin.json; sem ela, vazio', async () => {
  expect(versaoDoManifesto(JSON.stringify({ name: 'historico', version: '1.1.0' }))).toBe('1.1.0')
  expect(versaoDoManifesto(JSON.stringify({ name: 'historico' }))).toBe('')
  expect(versaoDoManifesto(null)).toBe('')
})

test('estadoDe separa os cinco estados: faltando, local, desconhecida, desatualizada e atual', async () => {
  expect(estadoDe('', '1.1.0', false)).toBe('faltando')
  expect(estadoDe('0.2.0', '0.2.0', true)).toBe('local')
  expect(estadoDe('1.0.0', '', false)).toBe('desconhecida')
  expect(estadoDe('1.0.0', '1.1.0', false)).toBe('desatualizada')
  expect(estadoDe('1.1.0', '1.1.0', false)).toBe('atual')
  // A ordem das regras: sem instalação é 'faltando' mesmo se for local; local vence a falta de catálogo; instalada mais nova é 'atual'.
  expect(estadoDe('', '', true)).toBe('faltando')
  expect(estadoDe('0.2.0', '', true)).toBe('local')
  expect(estadoDe('1.2.0', '1.1.0', false)).toBe('atual')
})

test('comandoDe instala o que falta, atualiza o desatualizado e não devolve comando nos outros casos', async () => {
  const id = 'historico@historico-requisicoes'
  expect(comandoDe({ id, estado: 'faltando' })).toEqual(['claude', 'plugin', 'install', id])
  expect(comandoDe({ id, estado: 'desatualizada' })).toEqual(['claude', 'plugin', 'update', id])
  expect(comandoDe({ id, estado: 'atual' })).toBeNull()
  expect(comandoDe({ id, estado: 'local' })).toBeNull()
  expect(comandoDe({ id, estado: 'desconhecida' })).toBeNull()
})

test('DEPENDENCIAS tem os 7 plugins do manifesto, sem repetir nenhum, e cada id é nome@marketplace', async () => {
  const ids = DEPENDENCIAS.map(dep => dep.id)
  expect(ids.length).toBe(7)
  expect(new Set(ids).size).toBe(7)
  expect([...ids].sort()).toEqual([...IDS_ESPERADOS].sort())
  for (const dep of DEPENDENCIAS) expect(dep.id).toBe(`${dep.nome}@${dep.marketplace}`)
})

test('comandoDe ativa o plugin desativado: claude plugin enable com o id dele', async () => {
  const id = 'historico@historico-requisicoes'
  expect(comandoDe({ id, estado: 'desativada' })).toEqual(['claude', 'plugin', 'enable', id])
})

test('estadoComAtivacao: instalado e desligado vira desativada; ligado ou sem a informação não muda; não instalado segue faltando', async () => {
  expect(estadoComAtivacao('atual', false)).toBe('desativada')
  expect(estadoComAtivacao('desatualizada', false)).toBe('desativada')
  expect(estadoComAtivacao('faltando', false)).toBe('faltando')
  expect(estadoComAtivacao('atual', true)).toBe('atual')
  expect(estadoComAtivacao('local', null)).toBe('local')
})

test('ativacaoDe dá o boolean de enabledPlugins[id]; sem o id, sem o objeto ou com valor que não é boolean, null', async () => {
  expect(ativacaoDe({ a: false }, 'a')).toBe(false)
  expect(ativacaoDe({ a: true }, 'a')).toBe(true)
  expect(ativacaoDe({ a: false }, 'b')).toBeNull()
  expect(ativacaoDe(null, 'a')).toBeNull()
  expect(ativacaoDe({ a: 'sim' }, 'a')).toBeNull()
})
