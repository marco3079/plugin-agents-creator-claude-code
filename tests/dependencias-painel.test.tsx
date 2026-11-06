// A seção "Plugins necessários" da aba Estruturas, sobre um sistema de arquivos em memória: o que está
// instalado ou desatualizado, o que é pasta local, o que está desligado em enabledPlugins, a procura de
// atualizações, o aviso sem o claude e as duas rotas do claude (a direta e a do Windows, com where.exe e cmd.exe).

import type { On } from 'claude-code'
import { type Engine, expect, mock, test } from 'claude-code/testing'

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

// O squad-stream aparece como instalado: o painel acha o bus.js dele, então o aviso sem squad não entra.
const SQUAD_BUS = '/home/u/.claude/plugins/cache/skill-squad-room/squad-stream/0.2.0/skills/squad-stream/scripts/bus.js'

// Os arquivos do claude em ~/.claude/plugins (configDir = /home/u/.claude no mock).
const PLUGINS = '/home/u/.claude/plugins'
const INSTALADOS = `${PLUGINS}/installed_plugins.json`
const MARKETPLACES = `${PLUGINS}/known_marketplaces.json`
const HISTORICO_LOJA = `${PLUGINS}/marketplaces/historico-requisicoes`
const DIFF_LOJA = `${PLUGINS}/marketplaces/skill-diff-claude-code`
const POPUP_LOJA = `${PLUGINS}/marketplaces/popup-perguntas`
const SQUAD_LOCAL = '/dev/skill-squad-room'

type Files = Map<string, string>
type Runs = string[][]
type WorldOptions = { claudeAusente?: boolean; windows?: boolean; ligados?: Record<string, boolean> }

/** O resultado de um comando que terminou bem. */
function sucesso() {
  return { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
}

/**
 * O mundo abaixo do plugin, como em estruturas-painel.test.tsx: ambiente, relógio, store, sessão e arquivos em
 * memória. O process.run registra em `runs` cada comando do claude. Com `claudeAusente`, esses comandos rejeitam
 * (o claude não está no PATH). Com `windows`, a raiz da sessão tem letra de unidade, e o painel usa a rota do Windows.
 * Com `ligados`, o settings.read responde com esse enabledPlugins (quem está desligado aparece como desativado).
 */
function world(on: On, files: Files, runs: Runs, options: WorldOptions = {}): void {
  files.set(SQUAD_BUS, '// bus.js de exemplo: o painel só verifica que o arquivo existe')
  mock.env(on, { HOME: '/home/u' })
  mock.clock(on, { now: NOW })
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
  // O motor entrega os caminhos absolutos do sistema (no Windows, `C:\...`); aqui voltam para `/x/y`.
  const norm = (path: string): string => path.replace(/^[A-Za-z]:/, '').split(String.fromCharCode(92)).join('/')
  const children = (dir: string): Map<string, 'file' | 'dir'> => {
    const prefix = dir.endsWith('/') ? dir : `${dir}/`
    const found = new Map<string, 'file' | 'dir'>()
    for (const path of files.keys()) {
      if (!path.startsWith(prefix)) continue
      const [first = '', ...rest] = path.slice(prefix.length).split('/')
      found.set(first, rest.length > 0 ? 'dir' : 'file')
    }
    return found
  }
  on('fs.list', (_, e) => {
    const found = children(norm(e.path))
    if (found.size === 0) return { deny: `ENOENT: ${e.path}` }
    return { value: [...found].map(([name, kind]) => ({ name, kind, size: 10, mtimeMs: NOW, isLink: false })) }
  })
  on('fs.read', (_, e) => {
    const text = files.get(norm(e.path))
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('fs.write', (_, e) => {
    files.set(norm(e.path), e.text)
    return { value: undefined }
  })
  on('fs.exists', (_, e) => ({ value: files.has(norm(e.path)) || children(norm(e.path)).size > 0 }))
  on('process.run', (_, e) => {
    // Só com a raiz em letra de unidade (windows), o painel roda antes `where.exe claude`: exitCode
    // diferente de 0 quer dizer claude ausente.
    if (e.argv[0] === 'where.exe') {
      runs.push([...e.argv])
      return { value: options.claudeAusente ? { ...sucesso(), exitCode: 1 } : sucesso() }
    }
    // Comando do claude (direto, ou pelo cmd.exe /d /s /c no Windows): registra o argv e, com o claude
    // ausente, a chamada rejeita. Os outros comandos dão certo.
    if (e.argv.includes('claude')) {
      runs.push([...e.argv])
      if (options.claudeAusente) return { deny: 'ENOENT: claude' }
    }
    return { value: sucesso() }
  })
  // O settings.read responde com as configurações inteiras (o `key` é lido dentro delas): só o enabledPlugins dado.
  if (options.ligados !== undefined) {
    const ligados = options.ligados
    on('settings.read', () => ({ value: { enabledPlugins: ligados } }))
  }
}

async function start($: Engine, windows = false): Promise<void> {
  await $.session.start({ cwd: windows ? 'C:/proj' : '/proj', surface: 'desktop', isInteractive: true })
}

/**
 * Os arquivos do claude: os 7 plugins instalados (o historico e o diff-review nas versões dadas), os 4 marketplaces
 * e os catálogos dos que vêm do GitHub. A versão do historico vem do plugin.json da pasta dele; a dos outros, do catálogo.
 */
function arquivosDoClaude(historicoInstalado: string, diffReviewInstalado = '2.0.0'): Files {
  return new Map<string, string>([
    [
      INSTALADOS,
      JSON.stringify({
        version: 2,
        plugins: {
          'historico@historico-requisicoes': [{ scope: 'user', version: historicoInstalado }],
          'historico-painel@historico-requisicoes': [{ scope: 'user', version: '1.1.0' }],
          'diff-review@skill-diff-claude-code': [{ scope: 'user', version: diffReviewInstalado }],
          'diff-review-pane@skill-diff-claude-code': [{ scope: 'user', version: '2.0.0' }],
          'squad-stream@skill-squad-room': [{ scope: 'user', version: '0.2.0' }],
          'squad-room-pane@skill-squad-room': [{ scope: 'user', version: '0.2.0' }],
          'popup-perguntas@popup-perguntas': [{ scope: 'user', version: '1.0.0' }],
        },
      }),
    ],
    [
      MARKETPLACES,
      JSON.stringify({
        'historico-requisicoes': {
          source: { source: 'github', repo: 'exemplo/historico-requisicoes' },
          installLocation: HISTORICO_LOJA,
        },
        'skill-diff-claude-code': {
          source: { source: 'github', repo: 'exemplo/skill-diff-claude-code' },
          installLocation: DIFF_LOJA,
        },
        'skill-squad-room': { source: { source: 'directory', path: SQUAD_LOCAL }, installLocation: SQUAD_LOCAL },
        'popup-perguntas': { source: { source: 'github', repo: 'exemplo/popup-perguntas' }, installLocation: POPUP_LOJA },
      }),
    ],
    [
      `${HISTORICO_LOJA}/.claude-plugin/marketplace.json`,
      JSON.stringify({
        name: 'historico-requisicoes',
        plugins: [
          { name: 'historico', source: './plugin' },
          { name: 'historico-painel', source: './painel', version: '1.1.0' },
        ],
      }),
    ],
    [`${HISTORICO_LOJA}/plugin/.claude-plugin/plugin.json`, JSON.stringify({ name: 'historico', version: '1.1.0' })],
    [
      `${DIFF_LOJA}/.claude-plugin/marketplace.json`,
      JSON.stringify({
        name: 'skill-diff-claude-code',
        plugins: [
          { name: 'diff-review', source: './diff-review', version: '2.0.0' },
          { name: 'diff-review-pane', source: './diff-review-pane', version: '2.0.0' },
        ],
      }),
    ],
    [
      `${POPUP_LOJA}/.claude-plugin/marketplace.json`,
      JSON.stringify({
        name: 'popup-perguntas',
        plugins: [{ name: 'popup-perguntas', source: './plugin', version: '1.0.0' }],
      }),
    ],
  ])
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

test('a aba mostra Plugins necessários, o historico de 1.0.0 para 1.1.0 e o botão de atualizar', { timeoutMs: 20000 }, async ($, on) => {
  world(on, arquivosDoClaude('1.0.0'), [])
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Plugins necessários/ })).toBeDefined()
  expect(await ui.find({ key: 'est-dep-historico' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1\.0\.0 → 1\.1\.0/ })).toBeDefined()
  expect(await ui.find({ key: 'est-dep-atualizar-historico' })).toBeDefined()
  await ui.unmount()
})

test('apertar Atualizar no historico roda claude plugin update com o id dele', { timeoutMs: 20000 }, async ($, on) => {
  const runs: Runs = []
  world(on, arquivosDoClaude('1.0.0'), runs)
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-dep-atualizar-historico' })
  expect(rodou(runs, ['plugin', 'update', 'historico@historico-requisicoes'])).toBe(true)
  await ui.unmount()
})

test('o squad-stream aparece como pasta local, com a versão dele, e sem botão de atualizar', { timeoutMs: 20000 }, async ($, on) => {
  world(on, arquivosDoClaude('1.0.0'), [])
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'est-dep-squad-stream' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /0\.2\.0 · pasta local/ })).toBeDefined()
  expect(await ui.find({ key: 'est-dep-atualizar-squad-stream' })).toBeUndefined()
  await ui.unmount()
})

test('Procurar atualizações roda marketplace update nos marketplaces do GitHub e nunca no local', { timeoutMs: 20000 }, async ($, on) => {
  const runs: Runs = []
  world(on, arquivosDoClaude('1.0.0'), runs)
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-dep-procurar' })
  expect(rodou(runs, ['plugin', 'marketplace', 'update', 'historico-requisicoes'])).toBe(true)
  expect(rodou(runs, ['plugin', 'marketplace', 'update', 'skill-diff-claude-code'])).toBe(true)
  expect(rodou(runs, ['plugin', 'marketplace', 'update', 'popup-perguntas'])).toBe(true)
  expect(runs.map(argsDoClaude).some(args => args?.includes('skill-squad-room') === true)).toBe(false)
  await ui.unmount()
})

test('Procurar atualizações ignora o marketplace que não está entre os conhecidos', { timeoutMs: 20000 }, async ($, on) => {
  const files = arquivosDoClaude('1.0.0')
  // Sem o popup-perguntas na lista de marketplaces conhecidos, o painel não o procura.
  const conhecidos = JSON.parse(files.get(MARKETPLACES) ?? '{}') as Record<string, unknown>
  delete conhecidos['popup-perguntas']
  files.set(MARKETPLACES, JSON.stringify(conhecidos))
  const runs: Runs = []
  world(on, files, runs)
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-dep-procurar' })
  expect(rodou(runs, ['plugin', 'marketplace', 'update', 'historico-requisicoes'])).toBe(true)
  expect(runs.map(argsDoClaude).some(args => args?.includes('popup-perguntas') === true)).toBe(false)
  await ui.unmount()
})

test('sem o claude no PATH, atualizar avisa que não achou o comando claude', { timeoutMs: 20000 }, async ($, on) => {
  const runs: Runs = []
  world(on, arquivosDoClaude('1.0.0'), runs, { claudeAusente: true })
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-dep-atualizar-historico' })
  expect(runs.length).toBeGreaterThan(0)
  expect(await ui.find({ type: 'Text', text: /Não achei o comando claude/ })).toBeDefined()
  await ui.unmount()
})

test('no Windows, atualizar o historico roda where.exe claude e depois o claude pelo cmd.exe /d /s /c', { timeoutMs: 20000 }, async ($, on) => {
  const runs: Runs = []
  world(on, arquivosDoClaude('1.0.0'), runs, { windows: true })
  await start($, true)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-dep-atualizar-historico' })
  expect(runs).toEqual([
    ['where.exe', 'claude'],
    ['cmd.exe', '/d', '/s', '/c', 'claude', 'plugin', 'update', 'historico@historico-requisicoes'],
  ])
  await ui.unmount()
})

test('no Windows, sem o claude, o where.exe avisa que não achou e nenhum comando do claude roda', { timeoutMs: 20000 }, async ($, on) => {
  const runs: Runs = []
  world(on, arquivosDoClaude('1.0.0'), runs, { windows: true, claudeAusente: true })
  await start($, true)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-dep-atualizar-historico' })
  expect(runs).toEqual([['where.exe', 'claude']])
  expect(await ui.find({ type: 'Text', text: /Não achei o comando claude/ })).toBeDefined()
  await ui.unmount()
})

test('com tudo em dia, o bloco abre fechado e o est-dep-ver abre e fecha a lista', { timeoutMs: 20000 }, async ($, on) => {
  world(on, arquivosDoClaude('1.1.0'), [])
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Plugins necessários/ })).toBeDefined()
  expect(await ui.find({ key: 'est-dep-ver' })).toBeDefined()
  expect(await ui.find({ key: 'est-dep-historico' })).toBeUndefined()
  await ui.press({ key: 'est-dep-ver' })
  expect(await ui.find({ key: 'est-dep-historico' })).toBeDefined()
  await ui.press({ key: 'est-dep-ver' })
  expect(await ui.find({ key: 'est-dep-historico' })).toBeUndefined()
  await ui.unmount()
})

test('Atualizar todos roda o update de cada desatualizado, em sequência, e termina com o aviso para recarregar', { timeoutMs: 20000 }, async ($, on) => {
  const runs: Runs = []
  world(on, arquivosDoClaude('1.0.0', '1.9.0'), runs)
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-dep-todas' })
  // Só as duas desatualizadas recebem update, exatamente, na ordem da lista: o historico antes do diff-review.
  const atualizacoes = runs.map(argsDoClaude).filter(args => args?.[0] === 'plugin' && args[1] === 'update')
  expect(atualizacoes).toEqual([
    ['plugin', 'update', 'historico@historico-requisicoes'],
    ['plugin', 'update', 'diff-review@skill-diff-claude-code'],
  ])
  // A mensagem do fim traz o aviso para recarregar os plugins.
  expect(await ui.find({ type: 'Text', text: /Rode \/reload-plugins/ })).toBeDefined()
  await ui.unmount()
})

test('um plugin instalado e desligado em enabledPlugins aparece como desativado, com o botão Ativar, que roda claude plugin enable', { timeoutMs: 20000 }, async ($, on) => {
  const runs: Runs = []
  world(on, arquivosDoClaude('1.1.0'), runs, { ligados: { 'historico@historico-requisicoes': false } })
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // Desligado, o bloco abre sozinho, mesmo com o historico já na versão atual.
  expect(await ui.find({ key: 'est-dep-historico' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /desativado/ })).toBeDefined()
  expect(await ui.find({ key: 'est-dep-atualizar-historico' })).toBeDefined()
  await ui.press({ key: 'est-dep-atualizar-historico' })
  expect(rodou(runs, ['plugin', 'enable', 'historico@historico-requisicoes'])).toBe(true)
  await ui.unmount()
})

test('o bloco Plugins necessários tem o botão Ver tudo o que eles precisam', { timeoutMs: 20000 }, async ($, on) => {
  world(on, arquivosDoClaude('1.0.0'), [])
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'est-dep-tela' })).toBeDefined()
  await ui.unmount()
})
