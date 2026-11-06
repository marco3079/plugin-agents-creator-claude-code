// Os testes das funções puras das dependências das dependências: a tabela REQUISITOS e o estado de cada requisito.

import { expect, test } from 'claude-code/testing'

import type { EstadoRequisito, RequisitoInfo } from '../types'
import {
  REQUISITOS,
  caminhosInstalados,
  comandoDoPrograma,
  dependenciasDoManifesto,
  escolherVsix,
  estadoDaExtensao,
  estadoDaSkill,
  estadoDoPrograma,
  estadoDoServidor,
  extensaoDoManifesto,
  extensoesDaLista,
  extensoesInstaladas,
  instrucaoDoPrograma,
  precisaAtencao,
  resumoRequisitos,
  versaoDoTexto,
} from '../hooks/lib/requisitos'

const SERVIDOR = 'plugin:popup-perguntas:popup-perguntas'

/** Um requisito com o estado dado, para testar o resumo. */
function requisito(id: string, estado: EstadoRequisito): RequisitoInfo {
  return { id, tipo: 'programa', nome: id, de: [], para: '', encontrada: '', esperada: '', estado, detalhe: '' }
}

test('REQUISITOS tem os 11 itens da tabela, com ids únicos', { timeoutMs: 20000 }, async () => {
  const ids = REQUISITOS.map(item => item.id)
  expect(ids.length).toBe(11)
  expect(new Set(ids).size).toBe(11)
})

test('REQUISITOS segue a ordem dos tipos: 2 skills, 5 extensões, 3 programas e 1 servidor', { timeoutMs: 20000 }, async () => {
  expect(REQUISITOS.map(item => item.tipo)).toEqual([
    'skill', 'skill',
    'extensao', 'extensao', 'extensao', 'extensao', 'extensao',
    'programa', 'programa', 'programa',
    'servidor',
  ])
})

test('a skill squad-stream aponta para scripts/bus.js e para o plugin squad-stream@skill-squad-room', { timeoutMs: 20000 }, async () => {
  expect(REQUISITOS.find(item => item.id === 'skill:squad-stream')).toEqual({
    tipo: 'skill',
    id: 'skill:squad-stream',
    nome: 'skill squad-stream',
    de: ['squad-room-pane@skill-squad-room'],
    para: 'o /sala achar a sala dos agentes',
    skill: 'squad-stream',
    plugin: 'squad-stream@skill-squad-room',
    arquivo: 'scripts/bus.js',
  })
})

test('o Node.js exige 18.0.0 e é pedido por quatro plugins', { timeoutMs: 20000 }, async () => {
  expect(REQUISITOS.find(item => item.id === 'programa:node')).toEqual({
    tipo: 'programa',
    id: 'programa:node',
    nome: 'Node.js',
    de: ['historico@historico-requisicoes', 'diff-review@skill-diff-claude-code', 'squad-stream@skill-squad-room', 'popup-perguntas@popup-perguntas'],
    para: 'os scripts das skills, os hooks e o servidor do popup',
    programa: 'node',
    minimo: '18.0.0',
  })
})

test('caminhosInstalados prefere a entrada do escopo user à do projeto', { timeoutMs: 20000 }, async () => {
  const json = JSON.stringify({
    version: 2,
    plugins: {
      'historico@historico-requisicoes': [
        { scope: 'project', installPath: '/projeto/historico', version: '0.9.0' },
        { scope: 'user', installPath: '/home/u/historico', version: '1.0.0' },
      ],
    },
  })
  expect(caminhosInstalados(json)).toEqual({ 'historico@historico-requisicoes': '/home/u/historico' })
})

test('caminhosInstalados sem escopo user usa o primeiro com installPath e deixa de fora o que não tem', { timeoutMs: 20000 }, async () => {
  const json = JSON.stringify({
    version: 2,
    plugins: {
      'squad-stream@skill-squad-room': [
        { scope: 'project', version: '0.2.0' },
        { scope: 'project', installPath: '/projeto/a', version: '0.2.0' },
        { scope: 'local', installPath: '/projeto/b', version: '0.2.1' },
      ],
      'popup-perguntas@popup-perguntas': [{ scope: 'user', version: '1.0.0' }],
    },
  })
  expect(caminhosInstalados(json)).toEqual({ 'squad-stream@skill-squad-room': '/projeto/a' })
})

test('caminhosInstalados com JSON inválido ou null devolve vazio', { timeoutMs: 20000 }, async () => {
  expect(caminhosInstalados('{ isto não é json')).toEqual({})
  expect(caminhosInstalados(null)).toEqual({})
})

test('dependenciasDoManifesto aceita o texto nome@marketplace e o objeto com name ou plugin e marketplace', { timeoutMs: 20000 }, async () => {
  const json = JSON.stringify({
    name: 'agents-creator',
    dependencies: [
      'historico@historico-requisicoes',
      { name: 'diff-review', marketplace: 'skill-diff-claude-code' },
      { plugin: 'popup-perguntas', marketplace: 'popup-perguntas' },
    ],
  })
  expect(dependenciasDoManifesto(json)).toEqual([
    'historico@historico-requisicoes',
    'diff-review@skill-diff-claude-code',
    'popup-perguntas@popup-perguntas',
  ])
})

test('dependenciasDoManifesto descarta o que não é um id de plugin', { timeoutMs: 20000 }, async () => {
  const json = JSON.stringify({ dependencies: ['a b@c', 3, {}, { name: 'x' }, 'historico@historico-requisicoes'] })
  expect(dependenciasDoManifesto(json)).toEqual(['historico@historico-requisicoes'])
})

test('dependenciasDoManifesto não repete um id', { timeoutMs: 20000 }, async () => {
  const json = JSON.stringify({
    dependencies: [
      'historico@historico-requisicoes',
      { name: 'historico', marketplace: 'historico-requisicoes' },
      'squad-stream@skill-squad-room',
      'historico@historico-requisicoes',
    ],
  })
  expect(dependenciasDoManifesto(json)).toEqual(['historico@historico-requisicoes', 'squad-stream@skill-squad-room'])
})

test('dependenciasDoManifesto sem o campo dependencies, ou com JSON inválido, devolve vazio', { timeoutMs: 20000 }, async () => {
  expect(dependenciasDoManifesto(JSON.stringify({ name: 'x' }))).toEqual([])
  expect(dependenciasDoManifesto('{ quebrado')).toEqual([])
  expect(dependenciasDoManifesto(null)).toEqual([])
})

test('extensoesInstaladas põe os ids em minúsculas e guarda a versão', { timeoutMs: 20000 }, async () => {
  const json = JSON.stringify([
    { identifier: { id: 'Marco3079.Squad-Room' }, version: '0.2.1' },
    { identifier: { id: 'ms-vscode.cpptools' }, version: '1.2.3' },
  ])
  expect(extensoesInstaladas(json)).toEqual({ 'marco3079.squad-room': '0.2.1', 'ms-vscode.cpptools': '1.2.3' })
})

test('extensoesInstaladas ignora o item sem version e o que não é lista', { timeoutMs: 20000 }, async () => {
  const json = JSON.stringify([{ identifier: { id: 'Marco3079.Squad-Room' } }, { identifier: {}, version: '1.0.0' }])
  expect(extensoesInstaladas(json)).toEqual({})
  expect(extensoesInstaladas('{"a":1}')).toEqual({})
  expect(extensoesInstaladas(null)).toEqual({})
})

test('extensoesDaLista lê publisher.nome@versao em minúsculas e ignora a linha vazia', { timeoutMs: 20000 }, async () => {
  expect(extensoesDaLista('Marco3079.Squad-Room@0.2.1')).toEqual({ 'marco3079.squad-room': '0.2.1' })
  expect(extensoesDaLista('Marco3079.Squad-Room@0.2.1\r\n\r\nms-vscode.cpptools@1.2.3\n')).toEqual({
    'marco3079.squad-room': '0.2.1',
    'ms-vscode.cpptools': '1.2.3',
  })
})

test('extensoesDaLista divide no último @, e a linha sem @ sai', { timeoutMs: 20000 }, async () => {
  expect(extensoesDaLista('x@y@1.0.0\nsem-arroba\n')).toEqual({ 'x@y': '1.0.0' })
})

test('extensaoDoManifesto monta o id publisher.nome em minúsculas, com nome e versão', { timeoutMs: 20000 }, async () => {
  const json = JSON.stringify({ name: 'squad-room', publisher: 'Marco3079', version: '0.2.1' })
  expect(extensaoDoManifesto(json)).toEqual({ id: 'marco3079.squad-room', nome: 'squad-room', versao: '0.2.1' })
})

test('extensaoDoManifesto sem publisher, ou com JSON inválido, devolve null', { timeoutMs: 20000 }, async () => {
  expect(extensaoDoManifesto(JSON.stringify({ name: 'squad-room', version: '0.2.1' }))).toBeNull()
  expect(extensaoDoManifesto('{ quebrado')).toBeNull()
  expect(extensaoDoManifesto(null)).toBeNull()
})

test('escolherVsix prefere o arquivo com a versão pedida, mesmo que outro seja mais novo em ordem alfabética', { timeoutMs: 20000 }, async () => {
  expect(escolherVsix(['squad-room-0.2.1.vsix', 'squad-room-0.1.0.vsix'], 'squad-room', '0.1.0')).toBe('squad-room-0.1.0.vsix')
})

test('escolherVsix sem a versão pedida devolve o último em ordem alfabética', { timeoutMs: 20000 }, async () => {
  expect(escolherVsix(['squad-room-0.1.0.vsix', 'squad-room-0.2.1.vsix'], 'squad-room', '9.9.9')).toBe('squad-room-0.2.1.vsix')
})

test('escolherVsix aceita o .vsix sem versão no nome (claude-request-history.vsix)', { timeoutMs: 20000 }, async () => {
  expect(escolherVsix(['claude-request-history.vsix'], 'claude-request-history', '1.0.0')).toBe('claude-request-history.vsix')
  expect(escolherVsix(['Claude-Request-History.VSIX'], 'claude-request-history', '1.0.0')).toBe('Claude-Request-History.VSIX')
})

test('escolherVsix não confunde squad-room com squad-room-pane-0.1.0.vsix', { timeoutMs: 20000 }, async () => {
  expect(escolherVsix(['squad-room-pane-0.1.0.vsix'], 'squad-room', '0.1.0')).toBe('')
  expect(escolherVsix(['squad-room-pane-1.vsix', 'squad-room-2.vsix'], 'squad-room', '2')).toBe('squad-room-2.vsix')
})

test('escolherVsix devolve vazio quando não há nenhum .vsix da extensão', { timeoutMs: 20000 }, async () => {
  expect(escolherVsix([], 'squad-room', '0.2.1')).toBe('')
  expect(escolherVsix(['readme.md', 'outra-1.0.0.vsix'], 'squad-room', '0.2.1')).toBe('')
})

test('escolherVsix acha o arquivo mesmo com o nome em maiúsculas (Squad-Room)', { timeoutMs: 20000 }, async () => {
  expect(escolherVsix(['squad-room-0.1.0.vsix', 'squad-room-0.2.1.vsix'], 'Squad-Room', '0.2.1')).toBe('squad-room-0.2.1.vsix')
})

test('versaoDoTexto lê x.y.z como o node, o git e o code mostram', { timeoutMs: 20000 }, async () => {
  expect(versaoDoTexto('v24.1.0')).toBe('24.1.0')
  expect(versaoDoTexto('git version 2.45.1.windows.1')).toBe('2.45.1')
  expect(versaoDoTexto('1.95.3\nabc123\nx64')).toBe('1.95.3')
})

test('versaoDoTexto com só x.y devolve x.y, e sem número devolve vazio', { timeoutMs: 20000 }, async () => {
  expect(versaoDoTexto('versão 3.2')).toBe('3.2')
  expect(versaoDoTexto('comando não encontrado')).toBe('')
  expect(versaoDoTexto('')).toBe('')
})

test('estadoDoServidor dá ok quando a linha do popup diz Connected', { timeoutMs: 20000 }, async () => {
  expect(estadoDoServidor(`Checking MCP server health...\n${SERVIDOR}: node x.js - √ Connected\n`, SERVIDOR)).toBe('ok')
})

test('estadoDoServidor dá parado quando a linha do popup diz Failed', { timeoutMs: 20000 }, async () => {
  expect(estadoDoServidor(`${SERVIDOR}: node x.js - × Failed to connect\n`, SERVIDOR)).toBe('parado')
})

test('estadoDoServidor dá desconhecido quando a saída não tem a linha do servidor', { timeoutMs: 20000 }, async () => {
  expect(estadoDoServidor('outro:servidor: node y.js - √ Connected', SERVIDOR)).toBe('desconhecido')
  expect(estadoDoServidor('', SERVIDOR)).toBe('desconhecido')
})

test('estadoDoServidor dá parado quando a mesma linha do servidor tem Connected e Failed', { timeoutMs: 20000 }, async () => {
  expect(estadoDoServidor(`${SERVIDOR}: node x.js - √ Connected × Failed to connect\n`, SERVIDOR)).toBe('parado')
  expect(estadoDoServidor(`${SERVIDOR}: node x.js - × Failed to connect √ Connected\n`, SERVIDOR)).toBe('parado')
})

test('estadoDaExtensao: opcional sem VS Code, faltando, desatualizado e ok', { timeoutMs: 20000 }, async () => {
  expect(estadoDaExtensao('', '', false)).toBe('opcional')
  expect(estadoDaExtensao('', '0.2.1', true)).toBe('faltando')
  expect(estadoDaExtensao('0.1.0', '0.2.1', true)).toBe('desatualizado')
  expect(estadoDaExtensao('0.2.1', '0.2.1', true)).toBe('ok')
})

test('estadoDoPrograma: faltando sem achar, desatualizado abaixo do mínimo, ok no resto', { timeoutMs: 20000 }, async () => {
  expect(estadoDoPrograma(false, '', '18.0.0')).toBe('faltando')
  expect(estadoDoPrograma(true, '16.20.0', '18.0.0')).toBe('desatualizado')
  expect(estadoDoPrograma(true, '18.0.0', '18.0.0')).toBe('ok')
  expect(estadoDoPrograma(true, '2.45.1', '')).toBe('ok')
})

test('estadoDaSkill: desconhecido sem fonte, faltando sem cópia, desatualizado com arquivo diferente e ok igual', { timeoutMs: 20000 }, async () => {
  const fonte = { 'scripts/bus.js': 'v2', 'SKILL.md': 'a' }
  expect(estadoDaSkill({}, {}, 'scripts/bus.js')).toBe('desconhecido')
  expect(estadoDaSkill(fonte, {}, 'scripts/bus.js')).toBe('faltando')
  expect(estadoDaSkill(fonte, { 'scripts/bus.js': null }, 'scripts/bus.js')).toBe('faltando')
  expect(estadoDaSkill(fonte, { 'scripts/bus.js': 'v1', 'SKILL.md': 'a' }, 'scripts/bus.js')).toBe('desatualizado')
  expect(estadoDaSkill(fonte, { 'scripts/bus.js': 'v2', 'SKILL.md': 'a' }, 'scripts/bus.js')).toBe('ok')
})

test('estadoDaSkill acusa desatualizado quando só o SKILL.md difere e o arquivo principal é igual', { timeoutMs: 20000 }, async () => {
  expect(estadoDaSkill({ 'scripts/bus.js': 'v2', 'SKILL.md': 'a' }, { 'scripts/bus.js': 'v2', 'SKILL.md': 'b' }, 'scripts/bus.js')).toBe('desatualizado')
})

test('comandoDoPrograma: o git usa o winget no Windows e o brew no macOS', { timeoutMs: 20000 }, async () => {
  expect(comandoDoPrograma('git', 'windows')).toEqual([
    'winget', 'install', '--id', 'Git.Git', '-e', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements',
  ])
  expect(comandoDoPrograma('git', 'brew')).toEqual(['brew', 'install', 'git'])
})

test('comandoDoPrograma: o node e o code têm o id do winget e o pacote do brew', { timeoutMs: 20000 }, async () => {
  expect(comandoDoPrograma('node', 'windows')).toEqual([
    'winget', 'install', '--id', 'OpenJS.NodeJS.LTS', '-e', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements',
  ])
  expect(comandoDoPrograma('code', 'windows')).toEqual([
    'winget', 'install', '--id', 'Microsoft.VisualStudioCode', '-e', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements',
  ])
  expect(comandoDoPrograma('node', 'brew')).toEqual(['brew', 'install', 'node'])
  expect(comandoDoPrograma('code', 'brew')).toEqual(['brew', 'install', '--cask', 'visual-studio-code'])
})

test('comandoDoPrograma numa plataforma sem gerenciador conhecido devolve null', { timeoutMs: 20000 }, async () => {
  expect(comandoDoPrograma('git', 'outro')).toBeNull()
  expect(comandoDoPrograma('code', 'outro')).toBeNull()
})

test('instrucaoDoPrograma devolve o texto de instalação de cada programa', { timeoutMs: 20000 }, async () => {
  expect(instrucaoDoPrograma('node')).toBe('Instale o Node.js 18 ou mais novo: https://nodejs.org (no Windows: winget install OpenJS.NodeJS.LTS).')
  expect(instrucaoDoPrograma('git')).toBe('Instale o git: https://git-scm.com/downloads (no Windows: winget install Git.Git).')
  expect(instrucaoDoPrograma('code')).toBe(`Instale o VS Code e deixe o comando code no PATH: https://code.visualstudio.com (no macOS: comando "Shell Command: Install 'code' command in PATH").`)
})

test('precisaAtencao vale para faltando, desatualizado e parado; os outros estados não', { timeoutMs: 20000 }, async () => {
  expect(precisaAtencao('faltando')).toBe(true)
  expect(precisaAtencao('desatualizado')).toBe(true)
  expect(precisaAtencao('parado')).toBe(true)
  expect(precisaAtencao('ok')).toBe(false)
  expect(precisaAtencao('opcional')).toBe(false)
  expect(precisaAtencao('desconhecido')).toBe(false)
})

test('resumoRequisitos conta faltando, desatualizado e parado, com o plural quando é mais de um', { timeoutMs: 20000 }, async () => {
  expect(resumoRequisitos([requisito('a', 'faltando'), requisito('b', 'faltando'), requisito('c', 'desatualizado')])).toBe('2 faltando, 1 desatualizado')
  expect(resumoRequisitos([requisito('d', 'faltando')])).toBe('1 faltando')
  expect(resumoRequisitos([requisito('e', 'parado'), requisito('f', 'parado')])).toBe('2 parados')
  expect(resumoRequisitos([requisito('g', 'desatualizado'), requisito('h', 'desatualizado'), requisito('i', 'parado')])).toBe('2 desatualizados, 1 parado')
})

test('resumoRequisitos sem pendência devolve vazio', { timeoutMs: 20000 }, async () => {
  expect(resumoRequisitos([requisito('a', 'ok'), requisito('b', 'opcional'), requisito('c', 'desconhecido')])).toBe('')
  expect(resumoRequisitos([])).toBe('')
})
