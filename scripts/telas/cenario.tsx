// Cenário que gera as telas do README. NÃO é um teste do plugin: o nome não termina em .test.tsx
// de propósito, para `claude plugin test` não executá-lo.
// gerar-telas.mjs copia este arquivo para tests/zz-telas.test.tsx numa cópia temporária do plugin e
// roda `claude plugin test` nela. Para cada tela, o teste imprime uma linha DUMP:<nome>:<json>, que
// renderizar.mjs transforma em HTML. Os imports relativos (../hooks/lib/agent e ../hooks/lib/templates)
// valem a partir de tests/ dessa cópia.
import type { On } from 'claude-code'
import { mock, test } from 'claude-code/testing'

import { toMarkdown } from '../hooks/lib/agent'
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

test('dump', async ($, on) => {
  const install = `${HOME}/.claude/plugins/cache/loja/qa-kit/1.2.0`
  const files = new Map<string, string>([
    [`${ROOT}/.claude/agents/revisor-de-codigo.md`, agentFile('revisor')],
    [`${ROOT}/.claude/agents/depurador.md`, agentFile('depurador')],
    [`${ROOT}/.claude/agents/executor-de-testes.md`, agentFile('testes')],
    [`${ROOT}/.claude/agents/orquestrador.md`, agentFile('orquestrador')],
    [`${HOME}/.claude/agents/pesquisador.md`, agentFile('pesquisador')],
    [`${HOME}/.claude/agents/documentador.md`, agentFile('documentador')],
    [`${HOME}/.claude/plugins/installed_plugins.json`, JSON.stringify({ plugins: { 'qa-kit@loja': [{ scope: 'user', installPath: install }] } })],
    [`${install}/agents/auditor.md`, agentFile('seguranca', 'auditor')],
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
})
