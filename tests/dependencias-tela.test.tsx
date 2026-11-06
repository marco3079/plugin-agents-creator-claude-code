// A tela Dependências de ponta a ponta: /agentes-dependencias, /agentes dependencias e o botão "Ver tudo o que eles
// precisam" da aba Estruturas, sobre um sistema de arquivos, um relógio e um processo em memória. Cobre as skills
// avulsas, as extensões do VS Code, os programas, o servidor do popup, o plugin desativado e os botões de correção.

import type { On } from 'claude-code'
import { type Engine, type MockClock, expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'agents-creator',
  component: 'Pane',
  requestId: 'agentes',
  props: {
    title: 'Agentes',
    isFocused: true,
    bodyColumns: 72,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const NOW = 1_700_000_000_000

// O mundo do usuário: a casa, a pasta do claude, as lojas dos marketplaces, as cópias das skills e o VS Code.
const HOME = '/home/u'
const CONFIG = `${HOME}/.claude`
const PLUGINS = `${CONFIG}/plugins`
const SKILLS = `${CONFIG}/skills`
const INSTALADOS = `${PLUGINS}/installed_plugins.json`
const MARKETPLACES = `${PLUGINS}/known_marketplaces.json`
const HISTORICO_LOJA = `${PLUGINS}/marketplaces/historico-requisicoes`
const DIFF_LOJA = `${PLUGINS}/marketplaces/skill-diff-claude-code`
const POPUP_LOJA = `${PLUGINS}/marketplaces/popup-perguntas`
const AC_LOJA = `${PLUGINS}/marketplaces/agents-creator`
const SQUAD_LOCAL = '/dev/skill-squad-room'
const SQUAD_CACHE = `${PLUGINS}/cache/skill-squad-room/squad-stream/0.2.0`
const DIFF_CACHE = `${PLUGINS}/cache/skill-diff-claude-code/diff-review/2.0.0`
const EXTENSOES = `${HOME}/.vscode/extensions/extensions.json`

// As 5 extensões do VS Code que os plugins e o estúdio pedem, pelo nome de cada uma (o id no VS Code é marco3079.<nome>).
const EXTENSOES_REQ: readonly string[] = ['claude-request-history', 'claude-review', 'squad-room', 'claude-popup-perguntas', 'estudio-de-agentes']

type Files = Map<string, string>
type Runs = string[][]
type Resposta = { exitCode: number; stdout: string; stderr?: string }
type Responder = (argv: readonly string[]) => Resposta | 'rejeita' | undefined
type WorldOptions = { windows?: boolean; ligados?: Record<string, boolean>; responder?: Responder }

/** Versões do node, do git e do code, e o servidor do popup conectado: o que um computador em dia responde. */
const TUDO_CERTO: Readonly<Record<string, Resposta>> = {
  'node --version': { exitCode: 0, stdout: 'v24.1.0' },
  'git --version': { exitCode: 0, stdout: 'git version 2.45.1' },
  'code --version': { exitCode: 0, stdout: '1.95.0\nabc\nx64' },
  'claude mcp list': { exitCode: 0, stdout: 'plugin:popup-perguntas:popup-perguntas: node x.js - ✓ Connected' },
}

/** O resultado de um comando que terminou bem, sem saída. */
function sucesso() {
  return { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
}

/** O comando como se digita: o `cmd.exe /d /s /c` do Windows sai, e o resto vira texto (`node --version`). */
function comando(argv: readonly string[]): string {
  const dados = argv[0] === 'cmd.exe' ? argv.slice(4) : argv
  return dados.join(' ')
}

/** Responde cada comando pelo texto dele; o que a tabela não traz dá certo, com saída vazia. */
function saidas(tabela: Readonly<Record<string, Resposta | 'rejeita'>>): Responder {
  return argv => tabela[comando(argv)]
}

/**
 * O mundo abaixo do plugin, como em dependencias-painel.test.tsx: ambiente, relógio, store, sessão, arquivos em memória
 * e processos. Cada comando (direto, ou pelo cmd.exe com `windows`) entra em `runs`, e `responder` diz a saída ou a
 * rejeição dele. `ligados` é o enabledPlugins que $.settings devolve. Devolve o relógio, para andá-lo.
 */
function world(on: On, files: Files, runs: Runs, options: WorldOptions = {}): MockClock {
  mock.env(on, { HOME })
  const relogio = mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: options.windows ? 'C:/proj' : '/proj' }))
  on('session.model', () => ({ value: 'sonnet' }))
  on('command.register', () => ({ value: { command: 'agentes' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__agents-creator__open_agents_studio' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.list', () => ({
    value: [
      { name: 'Read', description: 'lê', mcp: false },
      { name: 'Bash', description: 'roda', mcp: false },
    ],
  }))
  on('settings.read', () => ({ value: { enabledPlugins: options.ligados ?? {} } }))
  // O motor entrega os caminhos absolutos do sistema (no Windows, `C:\...`); aqui voltam para `/x/y`.
  const norm = (path: string): string => path.replace(/^[A-Za-z]:/, '').split(String.fromCharCode(92)).join('/')
  const filhos = (dir: string): Map<string, 'file' | 'dir'> => {
    const prefixo = dir.endsWith('/') ? dir : `${dir}/`
    const achados = new Map<string, 'file' | 'dir'>()
    for (const path of files.keys()) {
      if (!path.startsWith(prefixo)) continue
      const [primeiro = '', ...resto] = path.slice(prefixo.length).split('/')
      achados.set(primeiro, resto.length > 0 ? 'dir' : 'file')
    }
    return achados
  }
  on('fs.list', (_, e) => {
    const achados = filhos(norm(e.path))
    if (achados.size === 0) return { deny: `ENOENT: ${e.path}` }
    return { value: [...achados].map(([name, kind]) => ({ name, kind, size: 10, mtimeMs: NOW, isLink: false })) }
  })
  on('fs.read', (_, e) => {
    const text = files.get(norm(e.path))
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('fs.write', (_, e) => {
    files.set(norm(e.path), e.text)
    return { value: undefined }
  })
  on('fs.exists', (_, e) => ({ value: files.has(norm(e.path)) || filhos(norm(e.path)).size > 0 }))
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    const resposta = options.responder?.(e.argv)
    if (resposta === 'rejeita') return { deny: `ENOENT: ${e.argv[0]}` }
    if (resposta) return { value: { ...sucesso(), ...resposta } }
    return { value: sucesso() }
  })
  return relogio
}

async function start($: Engine, windows = false): Promise<void> {
  await $.session.start({ cwd: windows ? 'C:/proj' : '/proj', surface: 'desktop', isInteractive: true })
}

/**
 * O mundo com tudo em dia: os 7 plugins instalados (o historico na versão dada), os marketplaces e o catálogo de cada
 * um, as skills no cache e na pasta ~/.claude/skills, as 5 extensões nos repositórios e no VS Code. Cada teste tira,
 * troca ou acrescenta o que precisa.
 */
function mundoCompleto(versaoHistorico = '1.1.0'): Files {
  const files: Files = new Map()
  const manifesto = (nome: string, versao: string): string => JSON.stringify({ publisher: 'marco3079', name: nome, version: versao })
  const instalado = (version: string, installPath: string) => [{ scope: 'user', version, installPath }]
  files.set(
    INSTALADOS,
    JSON.stringify({
      version: 2,
      plugins: {
        'historico@historico-requisicoes': instalado(versaoHistorico, `${PLUGINS}/cache/historico-requisicoes/historico/${versaoHistorico}`),
        'historico-painel@historico-requisicoes': instalado('1.1.0', `${PLUGINS}/cache/historico-requisicoes/historico-painel/1.1.0`),
        'diff-review@skill-diff-claude-code': instalado('2.0.0', DIFF_CACHE),
        'diff-review-pane@skill-diff-claude-code': instalado('2.0.0', `${PLUGINS}/cache/skill-diff-claude-code/diff-review-pane/2.0.0`),
        'squad-stream@skill-squad-room': instalado('0.2.0', SQUAD_CACHE),
        'squad-room-pane@skill-squad-room': instalado('0.2.0', `${PLUGINS}/cache/skill-squad-room/squad-room-pane/0.2.0`),
        'popup-perguntas@popup-perguntas': instalado('1.0.0', `${PLUGINS}/cache/popup-perguntas/popup-perguntas/1.0.0`),
      },
    }),
  )
  files.set(
    MARKETPLACES,
    JSON.stringify({
      'historico-requisicoes': { source: { source: 'github', repo: 'exemplo/historico-requisicoes' }, installLocation: HISTORICO_LOJA },
      'skill-diff-claude-code': { source: { source: 'github', repo: 'exemplo/skill-diff-claude-code' }, installLocation: DIFF_LOJA },
      'skill-squad-room': { source: { source: 'directory', path: SQUAD_LOCAL }, installLocation: SQUAD_LOCAL },
      'popup-perguntas': { source: { source: 'github', repo: 'exemplo/popup-perguntas' }, installLocation: POPUP_LOJA },
      'agents-creator': { source: { source: 'github', repo: 'exemplo/agents-creator' }, installLocation: AC_LOJA },
    }),
  )
  files.set(
    `${HISTORICO_LOJA}/.claude-plugin/marketplace.json`,
    JSON.stringify({
      name: 'historico-requisicoes',
      plugins: [
        { name: 'historico', source: './plugin' },
        { name: 'historico-painel', source: './painel', version: '1.1.0' },
      ],
    }),
  )
  files.set(`${HISTORICO_LOJA}/plugin/.claude-plugin/plugin.json`, JSON.stringify({ name: 'historico', version: '1.1.0' }))
  files.set(
    `${DIFF_LOJA}/.claude-plugin/marketplace.json`,
    JSON.stringify({
      name: 'skill-diff-claude-code',
      plugins: [
        { name: 'diff-review', source: './diff-review', version: '2.0.0' },
        { name: 'diff-review-pane', source: './diff-review-pane', version: '2.0.0' },
      ],
    }),
  )
  files.set(
    `${POPUP_LOJA}/.claude-plugin/marketplace.json`,
    JSON.stringify({ name: 'popup-perguntas', plugins: [{ name: 'popup-perguntas', source: './plugin', version: '1.0.0' }] }),
  )
  // As skills: a do plugin (no cache) e a cópia avulsa em ~/.claude/skills, iguais.
  files.set(`${SQUAD_CACHE}/skills/squad-stream/SKILL.md`, 'skill squad')
  files.set(`${SQUAD_CACHE}/skills/squad-stream/scripts/bus.js`, '// bus')
  files.set(`${DIFF_CACHE}/skills/review-edits/SKILL.md`, 'skill review')
  files.set(`${DIFF_CACHE}/skills/review-edits/scripts/review.js`, '// review')
  files.set(`${SKILLS}/squad-stream/SKILL.md`, 'skill squad')
  files.set(`${SKILLS}/squad-stream/scripts/bus.js`, '// bus')
  files.set(`${SKILLS}/review-edits/SKILL.md`, 'skill review')
  files.set(`${SKILLS}/review-edits/scripts/review.js`, '// review')
  // As extensões: o package.json e o .vsix de cada repositório.
  files.set(`${HISTORICO_LOJA}/vscode-extension/package.json`, manifesto('claude-request-history', '1.3.0'))
  files.set(`${HISTORICO_LOJA}/dist/claude-request-history.vsix`, 'vsix')
  files.set(`${DIFF_LOJA}/extensions/claude-review/package.json`, manifesto('claude-review', '0.3.1'))
  files.set(`${DIFF_LOJA}/dist/claude-review-0.3.1.vsix`, 'vsix')
  files.set(`${SQUAD_LOCAL}/extensions/squad-room/package.json`, manifesto('squad-room', '0.2.1'))
  files.set(`${SQUAD_LOCAL}/dist/squad-room-0.2.1.vsix`, 'vsix')
  files.set(`${POPUP_LOJA}/vscode-extension/package.json`, manifesto('claude-popup-perguntas', '1.0.0'))
  files.set(`${POPUP_LOJA}/dist/claude-popup-perguntas-1.0.0.vsix`, 'vsix')
  files.set(`${AC_LOJA}/extensions/estudio-de-agentes/package.json`, manifesto('estudio-de-agentes', '0.1.0'))
  files.set(`${AC_LOJA}/dist/estudio-de-agentes-0.1.0.vsix`, 'vsix')
  files.set(
    EXTENSOES,
    JSON.stringify([
      { identifier: { id: 'marco3079.claude-request-history' }, version: '1.3.0' },
      { identifier: { id: 'marco3079.claude-review' }, version: '0.3.1' },
      { identifier: { id: 'marco3079.squad-room' }, version: '0.2.1' },
      { identifier: { id: 'marco3079.claude-popup-perguntas' }, version: '1.0.0' },
      { identifier: { id: 'marco3079.estudio-de-agentes' }, version: '0.1.0' },
    ]),
  )
  return files
}

/** Tira do mundo o arquivo ou a pasta dado, com tudo o que está dentro. */
function tirar(files: Files, caminho: string): void {
  for (const path of [...files.keys()]) {
    if (path === caminho || path.startsWith(`${caminho}/`)) files.delete(path)
  }
}

/** Tira uma extensão da lista do extensions.json do VS Code; as outras ficam. */
function tirarExtensao(files: Files, id: string): void {
  const lista = JSON.parse(files.get(EXTENSOES) ?? '[]') as { identifier: { id: string } }[]
  files.set(EXTENSOES, JSON.stringify(lista.filter(item => item.identifier.id !== id)))
}

/** Os argumentos de um comando do claude, direto ou pelo cmd.exe /d /s /c; null para os outros comandos. */
function argsDoClaude(argv: string[]): string[] | null {
  if (argv[0] === 'claude') return argv.slice(1)
  if (argv[0] === 'cmd.exe' && argv[4] === 'claude') return argv.slice(5)
  return null
}

/** Algum comando do claude tem exatamente estes argumentos, direto ou pelo cmd.exe /d /s /c. */
function rodou(runs: Runs, args: string[]): boolean {
  return runs.some(argv => {
    const dados = argsDoClaude(argv)
    return dados !== null && dados.length === args.length && dados.every((arg, i) => arg === args[i])
  })
}

/** Algum comando teve exatamente este argv (o programa e os argumentos, sem cmd.exe). */
function rodouComando(runs: Runs, argv: string[]): boolean {
  return runs.some(item => item.length === argv.length && item.every((arg, i) => arg === argv[i]))
}

test('/agentes-dependencias abre a tela, diz que está verificando e agenda a verificação completa', { timeoutMs: 20000 }, async ($, on) => {
  const runs: Runs = []
  const relogio = world(on, mundoCompleto(), runs)
  await start($)
  const resposta = await $.command.run({ command: 'agentes-dependencias', args: '' })
  expect(resposta.text).toMatch(/Verificando/)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Dependências/ })).toBeDefined()
  expect(await ui.find({ key: 'dep-plugin-historico' })).toBeDefined()
  expect(await ui.find({ key: 'dep-req-skill:squad-stream' })).toBeDefined()
  // A verificação completa fica para depois da resposta: só roda quando o relógio anda.
  expect(rodouComando(runs, ['node', '--version'])).toBe(false)
  await relogio.advance(1)
  expect(rodouComando(runs, ['node', '--version'])).toBe(true)
  await ui.unmount()
})

test('uma skill avulsa que falta aparece com Copiar, e apertar copia os arquivos do plugin', { timeoutMs: 20000 }, async ($, on) => {
  const files = mundoCompleto()
  tirar(files, `${SKILLS}/squad-stream`)
  world(on, files, [])
  await start($)
  await $.command.run({ command: 'agentes', args: 'dependencias' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'dep-acao-skill:squad-stream' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /falta em ~\/\.claude\/skills\/squad-stream/ })).toBeDefined()
  await ui.press({ key: 'dep-acao-skill:squad-stream' })
  expect(files.get(`${SKILLS}/squad-stream/scripts/bus.js`)).toBe('// bus')
  expect(files.get(`${SKILLS}/squad-stream/SKILL.md`)).toBe('skill squad')
  expect(await ui.find({ key: 'dep-acao-skill:squad-stream' })).toBeUndefined()
  await ui.unmount()
})

test('uma skill avulsa diferente da do plugin aparece com Atualizar, e apertar troca o arquivo', { timeoutMs: 20000 }, async ($, on) => {
  const files = mundoCompleto()
  files.set(`${SKILLS}/review-edits/scripts/review.js`, '// velho')
  world(on, files, [])
  await start($)
  await $.command.run({ command: 'agentes', args: 'dependencias' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'dep-acao-skill:review-edits' })).toBeDefined()
  await ui.press({ key: 'dep-acao-skill:review-edits' })
  expect(files.get(`${SKILLS}/review-edits/scripts/review.js`)).toBe('// review')
  await ui.unmount()
})

test('uma extensão do VS Code que falta aparece com Instalar, e apertar roda o code com o .vsix do repositório', { timeoutMs: 20000 }, async ($, on) => {
  const files = mundoCompleto()
  tirarExtensao(files, 'marco3079.squad-room')
  const runs: Runs = []
  world(on, files, runs)
  await start($)
  await $.command.run({ command: 'agentes', args: 'dependencias' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'dep-acao-extensao:squad-room' })).toBeDefined()
  await ui.press({ key: 'dep-acao-extensao:squad-room' })
  expect(rodouComando(runs, ['code', '--install-extension', `${SQUAD_LOCAL}/dist/squad-room-0.2.1.vsix`, '--force'])).toBe(true)
  await ui.unmount()
})

test('sem o VS Code, as extensões aparecem como opcionais e nenhuma tem botão', { timeoutMs: 20000 }, async ($, on) => {
  const files = mundoCompleto()
  files.delete(EXTENSOES)
  world(on, files, [])
  await start($)
  await $.command.run({ command: 'agentes', args: 'dependencias' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // Sanidade: a linha da extensão está na tela; só o botão é que não pode existir.
  expect(await ui.find({ key: 'dep-req-extensao:claude-review' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /VS Code não encontrado neste computador/ })).toBeDefined()
  for (const nome of EXTENSOES_REQ) expect(await ui.find({ key: `dep-acao-extensao:${nome}` })).toBeUndefined()
  await ui.unmount()
})

test('Verificar tudo mostra o Node.js antigo e o git que falta, e o servidor do popup conectado não tem botão', { timeoutMs: 20000 }, async ($, on) => {
  world(on, mundoCompleto(), [], {
    responder: saidas({
      'node --version': { exitCode: 0, stdout: 'v16.20.0' },
      'git --version': 'rejeita',
      'code --version': { exitCode: 0, stdout: '1.95.0\nabc\nx64' },
      'claude mcp list': { exitCode: 0, stdout: 'plugin:popup-perguntas:popup-perguntas: node x.js - ✓ Connected' },
    }),
  })
  await start($)
  await $.command.run({ command: 'agentes', args: 'dependencias' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'dep-verificar' })
  expect(await ui.find({ type: 'Text', text: /16\.20\.0 \(precisa do 18\.0\.0 ou mais novo\)/ })).toBeDefined()
  expect(await ui.find({ key: 'dep-acao-programa:git' })).toBeDefined()
  expect(await ui.find({ key: 'dep-req-servidor:popup-perguntas' })).toBeDefined()
  expect(await ui.find({ key: 'dep-acao-servidor:popup-perguntas' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Precisam de atenção/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Use Corrigir tudo ou o botão de cada um/ })).toBeDefined()
  await ui.unmount()
})

test('com o servidor do popup parado, Verificar tudo manda conferir o Node.js', { timeoutMs: 20000 }, async ($, on) => {
  world(on, mundoCompleto(), [], {
    responder: saidas({
      ...TUDO_CERTO,
      'claude mcp list': { exitCode: 0, stdout: 'plugin:popup-perguntas:popup-perguntas: node x.js - ✗ Failed to connect' },
    }),
  })
  await start($)
  await $.command.run({ command: 'agentes', args: 'dependencias' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'dep-verificar' })
  expect(await ui.find({ type: 'Text', text: /não conectou: confira o Node\.js/ })).toBeDefined()
  await ui.unmount()
})

test('com tudo em dia, Verificar tudo diz que está certo e não sobra Corrigir tudo', { timeoutMs: 20000 }, async ($, on) => {
  world(on, mundoCompleto(), [], { responder: saidas(TUDO_CERTO) })
  await start($)
  await $.command.run({ command: 'agentes', args: 'dependencias' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'dep-verificar' })
  expect(await ui.find({ type: 'Text', text: /Tudo certo: os plugins do estúdio/ })).toBeDefined()
  expect(await ui.find({ key: 'dep-corrigir' })).toBeUndefined()
  await ui.unmount()
})

test('um plugin desligado aparece com Ativar, e apertar roda claude plugin enable', { timeoutMs: 20000 }, async ($, on) => {
  const runs: Runs = []
  world(on, mundoCompleto(), runs, { ligados: { 'historico@historico-requisicoes': false } })
  await start($)
  await $.command.run({ command: 'agentes', args: 'dependencias' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /1\.1\.0 · desativado/ })).toBeDefined()
  expect(await ui.find({ key: 'dep-plugin-acao-historico' })).toBeDefined()
  await ui.press({ key: 'dep-plugin-acao-historico' })
  expect(rodou(runs, ['plugin', 'enable', 'historico@historico-requisicoes'])).toBe(true)
  await ui.unmount()
})

test('Corrigir tudo atualiza o historico, copia a skill que falta e instala a extensão que falta', { timeoutMs: 20000 }, async ($, on) => {
  const files = mundoCompleto('1.0.0')
  tirar(files, `${SKILLS}/squad-stream`)
  tirarExtensao(files, 'marco3079.claude-review')
  const runs: Runs = []
  world(on, files, runs)
  await start($)
  await $.command.run({ command: 'agentes', args: 'dependencias' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'dep-corrigir' })
  expect(rodou(runs, ['plugin', 'update', 'historico@historico-requisicoes'])).toBe(true)
  expect(files.get(`${SKILLS}/squad-stream/scripts/bus.js`)).toBe('// bus')
  expect(rodouComando(runs, ['code', '--install-extension', `${DIFF_LOJA}/dist/claude-review-0.3.1.vsix`, '--force'])).toBe(true)
  expect(await ui.find({ type: 'Text', text: /Feito:/ })).toBeDefined()
  await ui.unmount()
})

test('o botão Ver tudo o que eles precisam, na aba Estruturas, abre a tela Dependências', { timeoutMs: 20000 }, async ($, on) => {
  world(on, mundoCompleto(), [])
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // Sanidade: ainda na aba Estruturas, a lista de plugins da tela Dependências não aparece.
  expect(await ui.find({ key: 'dep-plugin-historico' })).toBeUndefined()
  await ui.press({ key: 'est-dep-tela' })
  expect(await ui.find({ key: 'dep-plugin-historico' })).toBeDefined()
  await ui.unmount()
})

test('no Windows, Instalar no git roda where.exe winget e depois o winget pelo cmd.exe', { timeoutMs: 20000 }, async ($, on) => {
  const runs: Runs = []
  world(on, mundoCompleto(), runs, { windows: true, responder: saidas({ ...TUDO_CERTO, 'where.exe git': { exitCode: 1, stdout: '' } }) })
  await start($, true)
  await $.command.run({ command: 'agentes', args: 'dependencias' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'dep-verificar' })
  const antes = runs.length
  await ui.press({ key: 'dep-acao-programa:git' })
  expect(runs.slice(antes)).toEqual([
    ['where.exe', 'winget'],
    ['cmd.exe', '/d', '/s', '/c', 'winget', 'install', '--id', 'Git.Git', '-e', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements'],
  ])
  await ui.unmount()
})

// O servidor fora do mcp list, o plugin de 2º nível, os programas no Corrigir tudo, os marketplaces e o clone velho.

test('com o servidor do popup fora do claude mcp list, Verificar tudo mostra o motivo e conta como pendência', { timeoutMs: 20000 }, async ($, on) => {
  world(on, mundoCompleto(), [], {
    responder: saidas({ ...TUDO_CERTO, 'claude mcp list': { exitCode: 0, stdout: 'outro-servidor: node y.js - ✓ Connected' } }),
  })
  await start($)
  await $.command.run({ command: 'agentes', args: 'dependencias' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'dep-verificar' })
  expect(await ui.find({ type: 'Text', text: /não aparece em claude mcp list/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Precisam de atenção: 1 requisito/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Tudo certo/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /O servidor do popup não respondeu/ })).toBeDefined()
  await ui.unmount()
})

test('um plugin que o historico declara como dependência e falta aparece com Instalar, e Corrigir tudo o instala e pede /reload-plugins', { timeoutMs: 20000 }, async ($, on) => {
  const files = mundoCompleto()
  files.set(`${PLUGINS}/cache/historico-requisicoes/historico/1.1.0/.claude-plugin/plugin.json`, JSON.stringify({ name: 'historico', version: '1.1.0', dependencies: ['extra@outro-mkt'] }))
  const runs: Runs = []
  world(on, files, runs)
  await start($)
  await $.command.run({ command: 'agentes', args: 'dependencias' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'dep-req-plugin:extra@outro-mkt' })).toBeDefined()
  expect(await ui.find({ key: 'dep-acao-plugin:extra@outro-mkt' })).toBeDefined()
  await ui.press({ key: 'dep-corrigir' })
  expect(rodou(runs, ['plugin', 'install', 'extra@outro-mkt'])).toBe(true)
  expect(await ui.find({ type: 'Text', text: /Rode \/reload-plugins/ })).toBeDefined()
  await ui.unmount()
})

test('Corrigir tudo não instala programa: o git que falta fica para o botão Instalar dele', { timeoutMs: 20000 }, async ($, on) => {
  const files = mundoCompleto()
  tirar(files, `${SKILLS}/squad-stream`)
  const runs: Runs = []
  world(on, files, runs, { responder: saidas({ ...TUDO_CERTO, 'git --version': 'rejeita' }) })
  await start($)
  await $.command.run({ command: 'agentes', args: 'dependencias' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'dep-verificar' })
  expect(await ui.find({ key: 'dep-acao-programa:git' })).toBeDefined()
  await ui.press({ key: 'dep-corrigir' })
  expect(files.get(`${SKILLS}/squad-stream/scripts/bus.js`)).toBe('// bus')
  expect(await ui.find({ type: 'Text', text: /Falta instalar: git/ })).toBeDefined()
  expect(runs.some(argv => argv[0] === 'brew' || argv[0] === 'winget')).toBe(false)
  await ui.unmount()
})

test('Verificar tudo atualiza o catálogo do próprio estúdio quando o marketplace dele vem do GitHub', { timeoutMs: 20000 }, async ($, on) => {
  const runs: Runs = []
  world(on, mundoCompleto(), runs, { responder: saidas(TUDO_CERTO) })
  await start($)
  await $.command.run({ command: 'agentes', args: 'dependencias' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'dep-verificar' })
  expect(rodou(runs, ['plugin', 'marketplace', 'update', 'agents-creator'])).toBe(true)
  await ui.unmount()
})

test('sem o VS Code, Verificar tudo não conta o comando code nem as extensões como pendência', { timeoutMs: 20000 }, async ($, on) => {
  const files = mundoCompleto()
  files.delete(EXTENSOES)
  world(on, files, [], { responder: saidas({ ...TUDO_CERTO, 'code --version': 'rejeita' }) })
  await start($)
  await $.command.run({ command: 'agentes', args: 'dependencias' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'dep-verificar' })
  expect(await ui.find({ type: 'Text', text: /Tudo certo: os plugins do estúdio/ })).toBeDefined()
  expect(await ui.find({ key: 'dep-acao-programa:code' })).toBeUndefined()
  await ui.unmount()
})

test('o marketplace agents-creator local, em pasta, não é atualizado pelo Verificar tudo', { timeoutMs: 20000 }, async ($, on) => {
  const files = mundoCompleto()
  const conhecidos = JSON.parse(files.get(MARKETPLACES) ?? '{}') as Record<string, unknown>
  conhecidos['agents-creator'] = { source: { source: 'directory', path: AC_LOJA }, installLocation: AC_LOJA }
  files.set(MARKETPLACES, JSON.stringify(conhecidos))
  const runs: Runs = []
  world(on, files, runs, { responder: saidas(TUDO_CERTO) })
  await start($)
  await $.command.run({ command: 'agentes', args: 'dependencias' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'dep-verificar' })
  // Sanidade: a verificação rodou (o historico, que vem do GitHub, foi atualizado).
  expect(rodou(runs, ['plugin', 'marketplace', 'update', 'historico-requisicoes'])).toBe(true)
  expect(rodou(runs, ['plugin', 'marketplace', 'update', 'agents-creator'])).toBe(false)
  await ui.unmount()
})

test('um clone velho do historico: Instalar atualiza o marketplace, vê que a extensão já está na versão e não instala por cima', { timeoutMs: 20000 }, async ($, on) => {
  const files = mundoCompleto()
  // O clone velho tem outro publisher e a versão 1.2.0: o id dele não casa com a extensão instalada (marco3079).
  files.set(`${HISTORICO_LOJA}/vscode-extension/package.json`, JSON.stringify({ publisher: 'bottomup', name: 'claude-request-history', version: '1.2.0' }))
  const runs: Runs = []
  world(on, files, runs, {
    responder: argv => {
      // Ao atualizar o marketplace, o clone passa a trazer a versão nova.
      if (argv.includes('update') && argv.includes('historico-requisicoes')) {
        files.set(`${HISTORICO_LOJA}/vscode-extension/package.json`, JSON.stringify({ publisher: 'marco3079', name: 'claude-request-history', version: '1.3.0' }))
      }
      return undefined
    },
  })
  await start($)
  await $.command.run({ command: 'agentes', args: 'dependencias' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'dep-acao-extensao:claude-request-history', text: 'Instalar' })).toBeDefined()
  await ui.press({ key: 'dep-acao-extensao:claude-request-history' })
  expect(rodou(runs, ['plugin', 'marketplace', 'update', 'historico-requisicoes'])).toBe(true)
  expect(runs.some(argv => argv.includes('--install-extension'))).toBe(false)
  expect(await ui.find({ type: 'Text', text: /extensão Claude Request History já está na versão 1[.]3[.]0[.]/ })).toBeDefined()
  expect(await ui.find({ key: 'dep-acao-extensao:claude-request-history' })).toBeUndefined()
  await ui.unmount()
})

test('depois de Verificar tudo, o servidor do popup desconhecido conta no título e no toast', { timeoutMs: 20000 }, async ($, on) => {
  world(on, mundoCompleto(), [], { responder: saidas({ ...TUDO_CERTO, 'claude mcp list': { exitCode: 0, stdout: 'outro-servidor: x - Connected' } }) })
  await start($)
  await $.command.run({ command: 'agentes', args: 'dependencias' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // Antes de verificar, o servidor desconhecido ainda não conta.
  expect(await ui.find({ type: 'Text', text: 'falta verificar' })).toBeDefined()
  await ui.press({ key: 'dep-verificar' })
  expect(await ui.find({ type: 'Text', text: /Precisam de atenção: 1 requisito[.]/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '1 requisito com pendência' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'tudo em dia' })).toBeUndefined()
  await ui.unmount()
})
