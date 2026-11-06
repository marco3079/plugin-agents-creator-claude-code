// Cenário que gera as telas do README. NÃO é um teste do plugin: o nome não termina em .test.tsx
// de propósito, para `claude plugin test` não executá-lo.
// gerar-telas.mjs copia este arquivo para tests/zz-telas.test.tsx numa cópia temporária do plugin e
// roda `claude plugin test` nela. Para cada tela, o teste imprime uma linha DUMP:<nome>:<json>, que
// renderizar.mjs transforma em HTML. Os imports relativos (../hooks/lib/...) valem a partir de tests/ dessa cópia.
import type { On } from 'claude-code'
import { mock, test } from 'claude-code/testing'

import { toMarkdown } from '../hooks/lib/agent'
import { estruturaPorId } from '../hooks/lib/estruturas/index'
import { mesclarClaudeMd, templateDaEstrutura } from '../hooks/lib/estruturas/protocolo'
import { TEMPLATES } from '../hooks/lib/templates'

const ROOT = '/work/minha-api'
const HOME = '/home/u'
const NOW = 1_762_180_000_000
const pane = (cols: number) =>
  ({
    plugin: 'agents-creator',
    component: 'Pane',
    requestId: 'agentes',
    props: { title: 'Agentes', isFocused: true, bodyColumns: cols, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
  }) as const

function agentFile(id: string, name?: string): string {
  const template = TEMPLATES.find(item => item.id === id)
  if (!template) throw new Error(id)
  return toMarkdown({ ...template.fields, ...(name ? { name } : {}) }, '', null, '\n')
}

// Os dois agentes do projeto. O template "Meu squad" copia os mesmos conteúdos: a detecção só casa com conteúdo igual.
const REVISOR_MD = agentFile('revisor')
const DEPURADOR_MD = agentFile('depurador')

// A aba Estruturas lê o squad-stream e o bloco "Plugins necessários" (os 7 plugins de dependência do plugin).
// Os dados são de exemplo: historico está desatualizado (1.1.0 instalado, 1.2.0 no catálogo) e os demais estão na
// mais nova. Os marketplaces são de origem github, em <configDir>/plugins/marketplaces/<nome>; nenhum é pasta local.
const CONFIG = `${HOME}/.claude`
const SQUAD_VERSAO = '0.2.0'
const SQUAD_BUS = `${CONFIG}/plugins/cache/skill-squad-room/squad-stream/${SQUAD_VERSAO}/skills/squad-stream/scripts/bus.js`
const DEPENDENCIAS = [
  { plugin: 'historico', marketplace: 'historico-requisicoes', instalada: '1.1.0', catalogo: '1.2.0' },
  { plugin: 'historico-painel', marketplace: 'historico-requisicoes', instalada: '1.2.0', catalogo: '1.2.0' },
  { plugin: 'diff-review', marketplace: 'skill-diff-claude-code', instalada: '0.9.4', catalogo: '0.9.4' },
  { plugin: 'diff-review-pane', marketplace: 'skill-diff-claude-code', instalada: '0.9.4', catalogo: '0.9.4' },
  { plugin: 'squad-stream', marketplace: 'skill-squad-room', instalada: SQUAD_VERSAO, catalogo: SQUAD_VERSAO },
  { plugin: 'squad-room-pane', marketplace: 'skill-squad-room', instalada: SQUAD_VERSAO, catalogo: SQUAD_VERSAO },
  { plugin: 'popup-perguntas', marketplace: 'popup-perguntas', instalada: '2.3.1', catalogo: '2.3.1' },
]

/** As entradas de installed_plugins.json dos plugins de dependência, com a pasta de cada um no cache. */
function instalados(): Record<string, { scope: string; version: string; installPath: string }[]> {
  return Object.fromEntries(
    DEPENDENCIAS.map(dep => [
      `${dep.plugin}@${dep.marketplace}`,
      [{ scope: 'user', version: dep.instalada, installPath: `${CONFIG}/plugins/cache/${dep.marketplace}/${dep.plugin}/${dep.instalada}` }],
    ]),
  )
}

/** known_marketplaces.json, e em cada marketplace o marketplace.json e o plugin.json (com a versão do catálogo). */
function marketplaces(): [string, string][] {
  const nomes = [...new Set(DEPENDENCIAS.map(dep => dep.marketplace))]
  const conhecidos = Object.fromEntries(
    nomes.map(nome => [nome, { source: { source: 'github', repo: `exemplo/${nome}` }, installLocation: `${CONFIG}/plugins/marketplaces/${nome}` }]),
  )
  const arquivos: [string, string][] = [[`${CONFIG}/plugins/known_marketplaces.json`, JSON.stringify(conhecidos)]]
  for (const nome of nomes) {
    const pasta = `${CONFIG}/plugins/marketplaces/${nome}`
    const plugins = DEPENDENCIAS.filter(dep => dep.marketplace === nome)
    const lista = plugins.map(dep => ({ name: dep.plugin, source: `./${dep.plugin}`, version: dep.catalogo }))
    arquivos.push([`${pasta}/.claude-plugin/marketplace.json`, JSON.stringify({ name: nome, plugins: lista })])
    for (const dep of plugins) arquivos.push([`${pasta}/${dep.plugin}/.claude-plugin/plugin.json`, JSON.stringify({ name: dep.plugin, version: dep.catalogo })])
  }
  return arquivos
}

const DIA = 86_400_000
const FLUXO_MEU_SQUAD = 'O depurador investiga a falha e o revisor confere a correção antes de entregar.'

/**
 * Meus templates de exemplo e o CLAUDE.md do projeto. "Meu squad" é um template seu com os dois agentes do projeto e
 * o fluxo no CLAUDE.md: o projeto aparece como usando o template (📦 na Galeria). "juridico" é uma cópia do catálogo
 * gerada com outra versão do squad (0.1.0): aparece com "· versão nova" e o botão Atualizar.
 */
function templatesDeExemplo(): [string, string][] {
  const estrutura = estruturaPorId('juridico')
  if (!estrutura) throw new Error('a estrutura juridico não existe no catálogo')
  const pasta = `${CONFIG}/agents-creator/estruturas`
  const meuSquad = {
    formato: 1,
    id: 'meu-squad',
    title: 'Meu squad',
    icon: '🛠️',
    summary: 'Os agentes deste projeto, salvos como template.',
    origin: 'proprio',
    createdAt: NOW - 3 * DIA,
    agents: [
      { file: 'revisor-de-codigo.md', content: REVISOR_MD },
      { file: 'depurador.md', content: DEPURADOR_MD },
    ],
    claudeMd: FLUXO_MEU_SQUAD,
    base: '',
  }
  const copia = templateDaEstrutura(estrutura, '0.1.0', NOW - 12 * DIA)
  return [
    [`${pasta}/meu-squad.json`, `${JSON.stringify(meuSquad, null, 2)}\n`],
    [`${pasta}/juridico.json`, `${JSON.stringify(copia, null, 2)}\n`],
    [`${ROOT}/CLAUDE.md`, mesclarClaudeMd(null, 'meu-squad', FLUXO_MEU_SQUAD)],
  ]
}

function world(on: On, files: Map<string, string>): void {
  mock.env(on, { HOME })
  mock.clock(on, { now: NOW })
  mock.store(on, { uso: { 'revisor-de-codigo': 14, depurador: 6, pesquisador: 9, 'executor-de-testes': 3 } })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: ROOT }))
  on('session.model', () => ({ value: 'sonnet' }))
  on('command.register', () => ({ value: { command: 'agentes' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__agents-creator__open_agents_studio' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  on('tool.list', () => ({
    value: ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash', 'WebFetch', 'WebSearch', 'Agent'].map(name => ({ name, description: '', mcp: false }))
      .concat([{ name: 'mcp__github__create_issue', description: '', mcp: true }, { name: 'mcp__github__list_pull_requests', description: '', mcp: true }]),
  }))
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
    if (found.size === 0) return { deny: 'ENOENT' }
    return { value: [...found].map(([name, kind]) => ({ name, kind, size: 10, mtimeMs: NOW, isLink: false })) }
  })
  on('fs.read', (_, e) => {
    const text = files.get(norm(e.path))
    return text === undefined ? { deny: 'ENOENT' } : { value: text }
  })
  on('fs.write', (_, e) => {
    files.set(norm(e.path), e.text)
    return { value: undefined }
  })
  on('fs.exists', (_, e) => ({ value: files.has(norm(e.path)) || children(norm(e.path)).size > 0 }))
}

const dump = (name: string, tree: unknown): void => console.log(`DUMP:${name}:${JSON.stringify(tree)}`)

// Limite de 2 minutos: o padrão de 5 s estoura quando a máquina está ocupada com outros testes.
test('dump', { timeoutMs: 120000 }, async ($, on) => {
  const install = `${HOME}/.claude/plugins/cache/loja/qa-kit/1.2.0`
  const files = new Map<string, string>([
    [`${ROOT}/.claude/agents/revisor-de-codigo.md`, REVISOR_MD],
    [`${ROOT}/.claude/agents/depurador.md`, DEPURADOR_MD],
    [`${ROOT}/.claude/agents/executor-de-testes.md`, agentFile('testes')],
    [`${ROOT}/.claude/agents/orquestrador.md`, agentFile('orquestrador')],
    [`${HOME}/.claude/agents/pesquisador.md`, agentFile('pesquisador')],
    [`${HOME}/.claude/agents/documentador.md`, agentFile('documentador')],
    [`${CONFIG}/plugins/installed_plugins.json`, JSON.stringify({ version: 2, plugins: { 'qa-kit@loja': [{ scope: 'user', installPath: install }], ...instalados() } })],
    [`${install}/agents/auditor.md`, agentFile('seguranca', 'auditor')],
    [SQUAD_BUS, '// bus.js de exemplo: a aba só lê o nome da pasta da versão'],
    ...marketplaces(),
    ...templatesDeExemplo(),
  ])
  world(on, files)
  await $.session.start({ cwd: ROOT, surface: 'desktop', isInteractive: true })
  await $.agent.spawn({ subagentType: 'executor-de-testes', prompt: 'rode os testes', description: 'testes' })

  await $.command.run({ command: 'agentes', args: '' })
  let ui = await $.ui.mount({ ...pane(64), surface: 'desktop' })
  dump('galeria', await ui.drawn())
  await ui.unmount()

  ui = await $.ui.mount({ ...pane(64), surface: 'terminal' })
  dump('terminal-galeria', await ui.drawn())
  await ui.unmount()

  await $.command.run({ command: 'agentes', args: 'revisor-de-codigo' })
  ui = await $.ui.mount({ ...pane(64), surface: 'desktop' })
  await ui.press({ key: 'secao-execucao' })
  await ui.press({ key: 'secao-prompt' })
  dump('editor', await ui.drawn())
  await ui.press({ key: 'secao-execucao' })
  await ui.press({ key: 'secao-prompt' })
  await ui.press({ key: 'secao-identidade' })
  await ui.press({ key: 'secao-ferramentas' })
  await ui.press({ key: 'ed-prompt-ver' })
  dump('editor-prompt', await ui.drawn())
  await ui.press({ key: 'secao-identidade' })
  await ui.press({ key: 'secao-ferramentas' })
  await ui.unmount()

  await $.command.run({ command: 'agentes', args: 'mapa' })
  ui = await $.ui.mount({ ...pane(64), surface: 'desktop' })
  dump('mapa', await ui.drawn())
  await ui.unmount()

  await $.command.run({ command: 'agentes', args: 'gerar' })
  ui = await $.ui.mount({ ...pane(64), surface: 'desktop' })
  await ui.input({ key: 'gerar-pedido', text: 'Um revisor de pull requests focado em segurança e performance, que comenta só o que importa.', kind: 'change' })
  dump('gerar', await ui.drawn())
  await ui.unmount()

  await $.command.run({ command: 'agentes', args: 'modelos' })
  ui = await $.ui.mount({ ...pane(64), surface: 'desktop' })
  dump('modelos', await ui.drawn())
  await ui.unmount()

  await $.command.run({ command: 'agentes', args: 'estruturas' })
  ui = await $.ui.mount({ ...pane(64), surface: 'desktop' })
  dump('estruturas', await ui.drawn())
  await ui.press({ key: 'est-ver-juridico' })
  dump('estruturas-detalhe', await ui.drawn())
  // Na mesma montagem: a aba Meus templates e o template "Meu squad" aberto para edição.
  await ui.press({ key: 'est-aba-biblioteca' })
  dump('estruturas-templates', await ui.drawn())
  await ui.press({ key: 'est-editar-meu-squad' })
  dump('estruturas-edicao', await ui.drawn())
  await ui.unmount()
})
