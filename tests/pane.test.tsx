// O painel de ponta a ponta, sobre um sistema de arquivos em memória: galeria, editor, gravação,
// renomear, lixeira, geração com IA, a ferramenta do Claude, o mapa e agentes de plugin.

import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

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

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const
const EDITABLE = ['terminal', 'desktop', 'vscode'] as const

const REVIEWER = `---
name: code-reviewer
description: Revisor de código. Use logo depois de alterar código para revisar qualidade e segurança.
tools: Read, Grep, Glob, Bash
model: sonnet
color: blue
---

Você é um revisor de código sênior.
`

const RESEARCHER = `---
name: pesquisador
description: Pesquisa bibliotecas e APIs na web e no código do projeto.
tools: Read, WebFetch, WebSearch
color: purple
---

Você pesquisa.
`

const ORCHESTRATOR = `---
name: orquestrador
description: Coordena subagentes especialistas em tarefas grandes do projeto.
tools: Agent(code-reviewer), Read
model: opus
color: pink
---

Você coordena.
`

const NOW = 1_700_000_000_000

type Files = Map<string, string>

/** O mundo abaixo do plugin: ambiente, relógio, store, sessão e arquivos em memória. */
function world(on: On, files: Files, options: { root?: string; env?: Record<string, string> } = {}): void {
  mock.env(on, options.env ?? { HOME: '/home/u' })
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: options.root ?? '/proj' }))
  on('session.model', () => ({ value: 'sonnet' }))
  on('command.register', () => ({ value: { command: 'agentes' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__agents-creator__open_agents_studio' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.list', () => ({
    value: [
      { name: 'Read', description: 'lê', mcp: false },
      { name: 'Bash', description: 'roda', mcp: false },
      { name: 'mcp__github__create_issue', description: 'issue', mcp: true },
    ],
  }))
  // O motor entrega os caminhos já absolutos no formato do sistema (no Windows, `C:\proj\...`):
  // aqui eles voltam para a forma `/proj/...` usada nas chaves do mapa.
  const norm = (path: string): string => path.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')
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
    // No Windows o caminho vai por variável de ambiente; no resto, é o último argumento do rm.
    const target = e.argv[0] === 'powershell.exe' ? (e.init?.env?.AGENTS_CREATOR_ALVO ?? '') : (e.argv[e.argv.length - 1] ?? '')
    files.delete(norm(target))
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

async function start($: Parameters<Parameters<typeof test>[1]>[0]): Promise<void> {
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
}

test('a galeria mostra os agentes do projeto e do usuário em todas as superfícies', async ($, on) => {
  const files: Files = new Map([
    ['/proj/.claude/agents/code-reviewer.md', REVIEWER],
    ['/home/u/.claude/agents/pesquisador.md', RESEARCHER],
  ])
  world(on, files)
  await start($)
  const opened = await $.command.run({ command: 'agentes', args: '' })
  expect(opened.text).toContain('Estúdio de Agentes')
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /^code-reviewer$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^pesquisador$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^PROJETO$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('no Windows: caminhos com barra invertida, pasta do usuário e exclusão via PowerShell', async ($, on) => {
  const files: Files = new Map([['/home/u/.claude/agents/pesquisador.md', RESEARCHER]])
  world(on, files, { root: 'C:\\proj', env: { USERPROFILE: 'C:\\home\\u', HOME: '/c/outro' } })
  await start($)
  await $.command.run({ command: 'agentes', args: 'pesquisador' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Input', key: 'ed-nome' }))?.props.value).toBe('pesquisador')
  await ui.select({ key: 'ed-modelo', value: 'haiku' })
  await ui.press({ key: 'ed-salvar' })
  expect(files.get('/home/u/.claude/agents/pesquisador.md')).toContain('model: haiku')
  expect(await ui.find({ type: 'Text', text: /Salvo em ~\/\.claude\/agents\/pesquisador\.md/ })).toBeDefined()
  await ui.press({ key: 'ed-excluir' })
  await ui.press({ key: 'ed-excluir-sim' })
  expect(files.has('/home/u/.claude/agents/pesquisador.md')).toBe(false)
  await ui.unmount()
})

test('sem agentes, o painel convida a criar o primeiro', async ($, on) => {
  world(on, new Map())
  await start($)
  await $.command.run({ command: 'agentes', args: '' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Nenhum agente por aqui/ })).toBeDefined()
    expect(await ui.find({ key: 'vazio-novo' })).toBeDefined()
    await ui.unmount()
  }
})

test('criar um agente pelo editor grava o .md esperado', async ($, on) => {
  const files: Files = new Map()
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: 'novo' })
  for (const surface of EDITABLE) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Input', key: 'ed-nome' })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.input({ key: 'ed-nome', text: 'Revisor de Código', kind: 'change' })
  expect((await ui.find({ type: 'Input', key: 'ed-nome' }))?.props.value).toBe('revisor-de-codigo')
  await ui.input({ key: 'ed-descricao', text: 'Use depois de alterar código para revisar qualidade e segurança.', kind: 'change' })
  await ui.press({ key: 'ed-cor-green' })
  await ui.select({ key: 'ed-modelo', value: 'opus' })
  await ui.press({ key: 'ed-ferr-escolher' })
  await ui.press({ key: 'ed-ferr-Bash' })
  await ui.press({ key: 'ed-ferr-Glob' })
  await ui.input({ key: 'ed-prompt', text: 'Você é um revisor de código sênior e criterioso.', kind: 'change' })
  await ui.press({ key: 'ed-salvar' })
  expect(files.get('/proj/.claude/agents/revisor-de-codigo.md')).toBe(
    '---\nname: revisor-de-codigo\ndescription: Use depois de alterar código para revisar qualidade e segurança.\ntools: Read, Grep, Bash\nmodel: opus\ncolor: green\n---\n\nVocê é um revisor de código sênior e criterioso.\n',
  )
  expect((await ui.find({ type: 'Text', text: /Salvo em \.claude\/agents\/revisor-de-codigo\.md/ }))?.text).toContain('reinicie a sessão')
  expect(await ui.find({ type: 'Text', text: /✓ salvo/ })).toBeDefined()
  await ui.unmount()
})

test('salvar com erro mostra o motivo e não grava', async ($, on) => {
  const files: Files = new Map()
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: 'novo' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'ed-salvar' })
  expect(files.size).toBe(0)
  expect(await ui.find({ type: 'Text', text: /Corrija antes de salvar/ })).toBeDefined()
  await ui.unmount()
})

test('editar e renomear move o arquivo; excluir vai para a lixeira; restaurar volta', async ($, on) => {
  const files: Files = new Map([['/proj/.claude/agents/code-reviewer.md', REVIEWER]])
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: 'code-reviewer' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Input', key: 'ed-nome' }))?.props.value).toBe('code-reviewer')
  await ui.input({ key: 'ed-nome', text: 'revisor', kind: 'change' })
  await ui.press({ key: 'ed-salvar' })
  expect(files.has('/proj/.claude/agents/code-reviewer.md')).toBe(false)
  expect(files.get('/proj/.claude/agents/revisor.md')).toBe(REVIEWER.replace('name: code-reviewer', 'name: revisor'))

  await ui.press({ key: 'ed-excluir' })
  await ui.press({ key: 'ed-excluir-sim' })
  expect(files.has('/proj/.claude/agents/revisor.md')).toBe(false)
  expect(await ui.find({ type: 'Text', text: /foi para a lixeira/ })).toBeDefined()

  await ui.press({ key: 'nav-lixeira' })
  await ui.press({ key: `lixo-restaurar-${NOW}` })
  expect(files.get('/proj/.claude/agents/revisor.md')).toBe(REVIEWER.replace('name: code-reviewer', 'name: revisor'))
  await ui.unmount()
})

test('o arquivo alterado fora do estúdio pede confirmação antes de sobrescrever', async ($, on) => {
  const files: Files = new Map([['/proj/.claude/agents/code-reviewer.md', REVIEWER]])
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: 'code-reviewer' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  files.set('/proj/.claude/agents/code-reviewer.md', REVIEWER.replace('color: blue', 'color: red'))
  await ui.select({ key: 'ed-modelo', value: 'haiku' })
  await ui.press({ key: 'ed-salvar' })
  expect(files.get('/proj/.claude/agents/code-reviewer.md')).toContain('color: red')
  expect(await ui.find({ key: 'ed-sobrescrever' })).toBeDefined()
  await ui.press({ key: 'ed-sobrescrever' })
  expect(files.get('/proj/.claude/agents/code-reviewer.md')).toContain('model: haiku')
  await ui.unmount()
})

test('modelos prontos viram rascunhos no editor', async ($, on) => {
  const files: Files = new Map()
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: 'modelos' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'modelo-usar-revisor' })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'modelo-usar-testes' })
  expect((await ui.find({ type: 'Input', key: 'ed-nome' }))?.props.value).toBe('executor-de-testes')
  await ui.press({ key: 'ed-salvar' })
  expect(files.get('/proj/.claude/agents/executor-de-testes.md')).toContain('tools: Bash, Read, Edit, Grep, Glob')
  await ui.unmount()
})

test('gerar com IA abre o rascunho no editor', async ($, on) => {
  world(on, new Map())
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      text: JSON.stringify({
        name: 'revisor-pr',
        description: 'Revisa pull requests com foco em segurança e performance.',
        tools: ['Read', 'Grep'],
        model: 'sonnet',
        color: 'purple',
        prompt: 'Você revisa PRs.',
      }),
      usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  }))
  await start($)
  await $.command.run({ command: 'agentes', args: 'gerar' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'gerar-pedido', text: 'um revisor de PRs', kind: 'change' })
  await ui.press({ key: 'gerar-ir' })
  expect((await ui.find({ type: 'Input', key: 'ed-nome' }))?.props.value).toBe('revisor-pr')
  expect(await ui.find({ type: 'Text', text: /Rascunho gerado/ })).toBeDefined()
  await ui.unmount()
})

test('a ferramenta do Claude abre um rascunho sem gravar nada', async ($, on) => {
  const files: Files = new Map()
  world(on, files)
  await start($)
  const answer = await $.tool.call({
    tool: 'mcp__agents-creator__open_agents_studio',
    draft: { name: 'Doc Writer', description: 'Escreve documentação depois de mudanças na API.', prompt: 'Você escreve docs.', tools: ['Read', 'Write'] },
  })
  expect(JSON.stringify(answer)).toContain('doc-writer')
  expect(files.size).toBe(0)
  const ui = await $.ui.mount({ ...PANE, surface: 'vscode' })
  expect((await ui.find({ type: 'Input', key: 'ed-nome' }))?.props.value).toBe('doc-writer')
  await ui.unmount()
})

test('o mapa mostra quem delega para quem', async ($, on) => {
  const files: Files = new Map([
    ['/proj/.claude/agents/code-reviewer.md', REVIEWER],
    ['/proj/.claude/agents/orquestrador.md', ORCHESTRATOR],
  ])
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: 'mapa' })
  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await terminal.find({ type: 'Text', text: /Claude \(sessão principal\)/ })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: /como principal chama: code-reviewer/ })).toBeDefined()
  await terminal.unmount()
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.select({ key: 'mapa-principal', value: 'orquestrador' })
  expect(files.get('/proj/.claude/settings.local.json')).toBe('{\n  "agent": "orquestrador"\n}\n')
  await ui.unmount()
})

test('agentes de plugin são só leitura, mas dá para salvar uma cópia', async ($, on) => {
  const install = '/home/u/.claude/plugins/cache/mk/meu-plugin/1.0.0'
  const files: Files = new Map([
    ['/home/u/.claude/plugins/installed_plugins.json', JSON.stringify({ plugins: { 'meu-plugin@mk': [{ scope: 'user', installPath: install }] } })],
    [`${install}/agents/ajudante.md`, RESEARCHER.replace('name: pesquisador', 'name: ajudante')],
  ])
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: 'meu-plugin:ajudante' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Input', key: 'ed-nome' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /somente leitura/ })).toBeDefined()
  await ui.press({ key: 'ed-copiar-projeto' })
  expect(files.get('/proj/.claude/agents/ajudante.md')).toContain('name: ajudante')
  await ui.unmount()
})

test('um subagente em execução acende o cartão', async ($, on) => {
  world(on, new Map([['/proj/.claude/agents/code-reviewer.md', REVIEWER]]))
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'a1' }))
  await start($)
  await $.command.run({ command: 'agentes', args: '' })
  await $.agent.spawn({ subagentType: 'code-reviewer', prompt: 'revise', description: 'revisão' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /em execução/ })).toBeDefined()
  await ui.unmount()
})

test('testar agora registra o rascunho e inicia o subagente', async ($, on) => {
  const registered: string[] = []
  const spawned: string[] = []
  world(on, new Map([['/proj/.claude/agents/code-reviewer.md', REVIEWER]]))
  on('agent.register', (_, e) => {
    registered.push(e.name)
    return { value: { agent: `agents-creator:${e.name}` } }
  })
  on('agent.spawn', (_, e) => {
    spawned.push(e.prompt)
    return { model: 'sonnet', agentId: 't1' }
  })
  await start($)
  await $.command.run({ command: 'agentes', args: 'code-reviewer' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'secao-testar' })
  await ui.input({ key: 'ed-teste', text: 'Revise o README', kind: 'change' })
  await ui.press({ key: 'ed-testar' })
  expect(registered).toEqual(['code-reviewer'])
  expect(spawned).toEqual(['Revise o README'])
  // O id do subagente é do motor: com ele o painel espera a resposta; sem ele, avisa onde acompanhar.
  const waiting = await ui.find({ type: 'Text', text: /Rodando agents-creator:code-reviewer|acompanhe a resposta na conversa/ })
  expect(waiting).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Não deu para testar/ })).toBeUndefined()
  await ui.unmount()
})
