// A etiqueta 📦 da Galeria: o título do template ativo aparece só nos cartões dos agentes do projeto que vieram
// dele. Sobre um sistema de arquivos em memória, como os outros testes do painel.

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

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

const NOW = 1_700_000_000_000
const ETIQUETA = '📦 Meu squad'
const AGENTES = '/proj/.claude/agents'
const MANIFESTO = '/proj/.claude/agents-creator.json'
const BIBLIOTECA = '/home/u/.claude/agents-creator/estruturas'
const USUARIO = '/home/u/.claude/agents'

// Gerador do template "Meu squad", igual no projeto.
const GERADOR = `---
name: gerador
description: Implementa um mini-plano fechado, mexendo só nos arquivos listados.
tools: Read, Write, Edit, Bash
model: sonnet
---

Você implementa o mini-plano.
`

// Versão antiga do gerador: o template da biblioteca usa esta, então ela não casa com o projeto.
const GERADOR_ANTIGO = GERADOR.replace('Você implementa o mini-plano.', 'Versão antiga do prompt.')

// Agente que o usuário criou sozinho: não veio de template.
const REVISOR = `---
name: revisor
description: Revisa cada entrega antes de aprovar a parte do squad.
tools: Read, Grep, Glob, Bash
model: opus
color: blue
---

Você revisa a entrega.
`

// Agente do catálogo jurídico, sem template na biblioteca.
const ADVOGADO = `---
name: advogado-senior
description: Advogado sênior da minha equipe, com as regras do meu escritório.
---

Meu prompt próprio.
`

type Files = Map<string, string>

/** Um nó da árvore desenhada por `ui.drawn()`: a chave do nó fica em `props.key`. */
type No = { type?: string; props?: Record<string, unknown>; children?: unknown }

/** O mundo abaixo do plugin: ambiente, relógio, store, sessão e arquivos em memória. */
function world(on: On, files: Files): void {
  mock.env(on, { HOME: '/home/u' })
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/proj' }))
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
    // No Windows o caminho vai por variável de ambiente; no resto, é o último argumento do rm.
    const target = e.argv[0] === 'powershell.exe' ? (e.init?.env?.AGENTS_CREATOR_ALVO ?? '') : (e.argv[e.argv.length - 1] ?? '')
    files.delete(norm(target))
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
}

/** Um template de Meus templates, gravado como o estúdio grava: <id>.json na pasta da biblioteca. */
function templateNaBiblioteca(files: Files, id: string, title: string, agents: { file: string; content: string }[]): void {
  const tpl = { formato: 1, id, title, icon: '🧩', summary: '', origin: 'proprio', createdAt: NOW, agents, claudeMd: '', base: '' }
  files.set(`${BIBLIOTECA}/${id}.json`, `${JSON.stringify(tpl, null, 2)}\n`)
}

/** O manifesto do template ativo do projeto (`.claude/agents-creator.json`), como o estúdio grava. */
function manifestoJson(ativo: string, arquivos: string[]): string {
  return `${JSON.stringify({ formato: 1, ativo, arquivos }, null, 2)}\n`
}

/** O texto que um nó desenhado mostra, filhos incluídos, na ordem em que aparece. */
function textoDe(no: unknown): string {
  if (typeof no === 'string' || typeof no === 'number') return String(no)
  if (Array.isArray(no)) return no.map(filho => textoDe(filho)).join('')
  if (no === null || typeof no !== 'object') return ''
  return textoDe((no as No).children)
}

/** Os cartões da Galeria: id do agente (a chave `cartao-<id>` sem o prefixo) → texto do cartão. */
function cartoes(arvore: unknown): Map<string, string> {
  const achados = new Map<string, string>()
  const visita = (no: unknown): void => {
    if (Array.isArray(no)) {
      for (const filho of no) visita(filho)
      return
    }
    if (no === null || typeof no !== 'object') return
    const { type, props, children } = no as No
    const chave = String(props?.key ?? '')
    if (type === 'Box' && chave.startsWith('cartao-')) achados.set(chave.slice('cartao-'.length), textoDe(no))
    visita(children)
  }
  visita(arvore)
  return achados
}

/** Quantas vezes a etiqueta 📦 aparece na tela inteira. */
function etiquetas(arvore: unknown): number {
  return textoDe(arvore).split('📦').length - 1
}

test('a etiqueta 📦 aparece só no cartão do agente que veio do template ativo, em todas as superfícies', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map([
    [`${AGENTES}/gerador.md`, GERADOR],
    [`${AGENTES}/revisor.md`, REVISOR],
    [MANIFESTO, manifestoJson('meu-squad', ['.claude/agents/gerador.md'])],
  ])
  templateNaBiblioteca(files, 'meu-squad', 'Meu squad', [{ file: 'gerador.md', content: GERADOR }])
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: '' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const arvore = await ui.drawn()
    const porCartao = cartoes(arvore)
    expect([...porCartao.keys()].sort()).toEqual(['project:gerador.md', 'project:revisor.md'])
    expect(porCartao.get('project:gerador.md')).toContain(ETIQUETA)
    expect(porCartao.get('project:revisor.md')).not.toContain('📦')
    expect(etiquetas(arvore)).toBe(1)
    await ui.unmount()
  }
})

test('o arquivo do manifesto casa sem diferenciar maiúsculas, nos dois sentidos (Gerador.md x gerador.md e revisor.md x Revisor.md)', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map([
    [`${AGENTES}/gerador.md`, GERADOR],
    [`${AGENTES}/Revisor.md`, REVISOR],
    [`${AGENTES}/advogado-senior.md`, ADVOGADO],
    [MANIFESTO, manifestoJson('meu-squad', ['.claude/agents/Gerador.md', '.claude/agents/revisor.md'])],
  ])
  templateNaBiblioteca(files, 'meu-squad', 'Meu squad', [
    { file: 'gerador.md', content: GERADOR },
    { file: 'revisor.md', content: REVISOR },
  ])
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const arvore = await ui.drawn()
  const porCartao = cartoes(arvore)
  expect([...porCartao.keys()].sort()).toEqual(['project:Revisor.md', 'project:advogado-senior.md', 'project:gerador.md'])
  expect(porCartao.get('project:gerador.md')).toContain(ETIQUETA)
  expect(porCartao.get('project:Revisor.md')).toContain(ETIQUETA)
  expect(porCartao.get('project:advogado-senior.md')).not.toContain('📦')
  expect(etiquetas(arvore)).toBe(2)
  await ui.unmount()
})

test('template do catálogo ativo sem cópia em Meus templates: a etiqueta usa o título do catálogo', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map([
    [`${AGENTES}/advogado-senior.md`, ADVOGADO],
    [`${AGENTES}/gerador.md`, GERADOR],
    [MANIFESTO, manifestoJson('juridico', ['.claude/agents/advogado-senior.md'])],
  ])
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const arvore = await ui.drawn()
  const porCartao = cartoes(arvore)
  expect([...porCartao.keys()].sort()).toEqual(['project:advogado-senior.md', 'project:gerador.md'])
  expect(porCartao.get('project:advogado-senior.md')).toContain('📦 Escritório jurídico')
  expect(porCartao.get('project:gerador.md')).not.toContain('📦')
  expect(etiquetas(arvore)).toBe(1)
  await ui.unmount()
})

test('sem template ativo, nenhum cartão mostra a etiqueta 📦', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map([
    [`${AGENTES}/gerador.md`, GERADOR],
    [`${AGENTES}/revisor.md`, REVISOR],
  ])
  // Há um template na biblioteca, mas ele não casa com o projeto: a detecção não o marca como ativo.
  templateNaBiblioteca(files, 'meu-squad', 'Meu squad', [{ file: 'gerador.md', content: GERADOR_ANTIGO }])
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const arvore = await ui.drawn()
  expect([...cartoes(arvore).keys()].sort()).toEqual(['project:gerador.md', 'project:revisor.md'])
  expect(etiquetas(arvore)).toBe(0)
  expect(files.has(MANIFESTO)).toBe(false)
  await ui.unmount()
})

test('agente do usuário com o mesmo nome do manifesto não ganha etiqueta; o do projeto ganha', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map([
    [`${AGENTES}/gerador.md`, GERADOR],
    [`${USUARIO}/gerador.md`, GERADOR],
    [MANIFESTO, manifestoJson('meu-squad', ['.claude/agents/gerador.md'])],
  ])
  templateNaBiblioteca(files, 'meu-squad', 'Meu squad', [{ file: 'gerador.md', content: GERADOR }])
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const arvore = await ui.drawn()
  const porCartao = cartoes(arvore)
  expect([...porCartao.keys()].sort()).toEqual(['project:gerador.md', 'user:gerador.md'])
  expect(porCartao.get('project:gerador.md')).toContain(ETIQUETA)
  expect(porCartao.get('user:gerador.md')).not.toContain('📦')
  expect(etiquetas(arvore)).toBe(1)
  await ui.unmount()
})
