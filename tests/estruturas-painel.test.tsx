// A aba Estruturas do painel, de ponta a ponta sobre um sistema de arquivos em memória: catálogo,
// baixar, alternar, salvar o próprio squad, conflito com agentes do projeto e o aviso sem squad-stream.

import type { On } from 'claude-code'
import { type Engine, expect, mock, test } from 'claude-code/testing'

import { estruturaPorId } from '../hooks/lib/estruturas/index'
import { SQUAD_VERSAO_PADRAO, marcadorInicio, templateDaEstrutura } from '../hooks/lib/estruturas/protocolo'

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
const SQUAD_BUS = '/home/u/.claude/plugins/cache/skill-squad-room/squad-stream/0.2.0/skills/squad-stream/scripts/bus.js'
const AVISO_SEM_SQUAD = /squad-stream não está instalado/
const CONFLITO = /Já existem no projeto/

const AGENTES = '/proj/.claude/agents'
const CLAUDE_MD = '/proj/CLAUDE.md'
const MANIFESTO = '/proj/.claude/agents-creator.json'
const BIBLIOTECA = '/home/u/.claude/agents-creator/estruturas'

// Um agente do projeto com o mesmo nome de um agente do jurídico (para o conflito).
const ADVOGADO_PROPRIO = `---
name: advogado-senior
description: Advogado sênior da minha equipe, com as regras do meu escritório.
---

Meu prompt próprio.
`

// Dois agentes válidos do projeto, para salvar a estrutura própria.
const GERADOR_PROPRIO = `---
name: gerador
description: Implementa um mini-plano fechado, mexendo só nos arquivos listados.
tools: Read, Write, Edit, Bash
model: sonnet
---

Você implementa o mini-plano.
`

const REVISOR_PROPRIO = `---
name: revisor
description: Revisa cada entrega antes de aprovar a parte do squad.
tools: Read, Grep, Glob, Bash
model: opus
color: blue
---

Você revisa a entrega.
`

type Files = Map<string, string>

type WorldOptions = { root?: string; env?: Record<string, string>; squad?: boolean }

type Biblioteca = { origin?: string; agents?: { file: string; content: string }[]; claudeMd?: string }

/** O mundo abaixo do plugin: ambiente, relógio, store, sessão e arquivos em memória. */
function world(on: On, files: Files, options: WorldOptions = {}): void {
  // Com squad: o painel só procura o arquivo do bus na pasta de plugins do usuário.
  if (options.squad) files.set(SQUAD_BUS, '// bus.js de exemplo: o painel só verifica que o arquivo existe')
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

/** O template gravado na biblioteca do usuário, ou null quando não existe. */
function biblioteca(files: Files, id: string): Biblioteca | null {
  const texto = files.get(`${BIBLIOTECA}/${id}.json`)
  return texto === undefined ? null : (JSON.parse(texto) as Biblioteca)
}

/** Os caminhos que a estrutura grava em `.claude/agents`, conforme o próprio template do catálogo. */
function arquivosDaEstrutura(id: string): string[] {
  const st = estruturaPorId(id)
  if (!st) throw new Error(`a estrutura ${id} não existe no catálogo`)
  return templateDaEstrutura(st, SQUAD_VERSAO_PADRAO, NOW).agents.map(agent => `${AGENTES}/${agent.file}`)
}

test('a aba Estruturas abre nas quatro superfícies com o catálogo', { timeoutMs: 20000 }, async ($, on) => {
  world(on, new Map(), { squad: true })
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'est-ver-juridico' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Escritório jurídico/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: AVISO_SEM_SQUAD })).toBeUndefined()
    await ui.unmount()
  }
})

test('baixar o jurídico grava os agentes, o trecho do CLAUDE.md, o manifesto e a cópia na biblioteca', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map()
  world(on, files, { squad: true })
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-ver-juridico' })
  await ui.press({ key: 'est-baixar' })
  expect(files.get(`${AGENTES}/advogado-senior.md`)).toContain('name: advogado-senior')
  for (const arquivo of arquivosDaEstrutura('juridico')) expect(files.has(arquivo)).toBe(true)
  expect(files.get(CLAUDE_MD)).toContain(marcadorInicio('juridico'))
  expect((JSON.parse(files.get(MANIFESTO) ?? 'null') as { ativo?: string } | null)?.ativo).toBe('juridico')
  expect(biblioteca(files, 'juridico')?.origin).toBe('catalogo')
  await ui.unmount()
})

test('alternar a estrutura troca os agentes e o trecho do CLAUDE.md; o manifesto guarda só o ativo', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map()
  world(on, files, { squad: true })
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-ver-juridico' })
  await ui.press({ key: 'est-baixar' })
  await ui.press({ key: 'est-voltar' })
  await ui.press({ key: 'est-ver-desenvolvimento' })
  await ui.press({ key: 'est-baixar' })
  await ui.press({ key: 'est-confirmar-sim' })
  for (const arquivo of arquivosDaEstrutura('juridico')) expect(files.has(arquivo)).toBe(false)
  expect(files.has(`${AGENTES}/gerador.md`)).toBe(true)
  expect(files.get(CLAUDE_MD)).toContain(marcadorInicio('desenvolvimento'))
  expect(files.get(CLAUDE_MD)).not.toContain(marcadorInicio('juridico'))
  expect((JSON.parse(files.get(MANIFESTO) ?? 'null') as { ativo?: string } | null)?.ativo).toBe('desenvolvimento')
  await ui.unmount()
})

test('salvar a estrutura do projeto cria um template próprio na biblioteca', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map([
    [`${AGENTES}/gerador.md`, GERADOR_PROPRIO],
    [`${AGENTES}/revisor.md`, REVISOR_PROPRIO],
    [CLAUDE_MD, '# Meu fluxo\n\nTexto.\n'],
  ])
  world(on, files, { squad: true })
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-aba-biblioteca' })
  await ui.input({ key: 'est-titulo', text: 'Meu squad', kind: 'change' })
  await ui.press({ key: 'est-salvar' })
  const salvo = biblioteca(files, 'meu-squad')
  expect(salvo?.origin).toBe('proprio')
  expect(salvo?.agents?.length).toBe(2)
  expect(salvo?.claudeMd).toBe('# Meu fluxo\n\nTexto.')
  await ui.unmount()
})

test('um agente do projeto com o mesmo nome bloqueia a baixa até confirmar a sobrescrita', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map([[`${AGENTES}/advogado-senior.md`, ADVOGADO_PROPRIO]])
  world(on, files, { squad: true })
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-ver-juridico' })
  expect(await ui.find({ type: 'Text', text: CONFLITO })).toBeDefined()
  await ui.press({ key: 'est-baixar' })
  expect(files.get(`${AGENTES}/advogado-senior.md`)).toBe(ADVOGADO_PROPRIO)
  await ui.press({ key: 'est-sobrescrever' })
  await ui.press({ key: 'est-baixar' })
  expect(files.get(`${AGENTES}/advogado-senior.md`)).not.toBe(ADVOGADO_PROPRIO)
  expect(files.get(`${AGENTES}/advogado-senior.md`)).toContain('name: advogado-senior')
  await ui.unmount()
})

test('sem o squad-stream instalado, a aba avisa que a equipe precisa dele', { timeoutMs: 20000 }, async ($, on) => {
  world(on, new Map(), { squad: false })
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: AVISO_SEM_SQUAD })).toBeDefined()
  await ui.press({ key: 'est-ver-juridico' })
  expect(await ui.find({ type: 'Text', text: AVISO_SEM_SQUAD })).toBeDefined()
  await ui.unmount()
})

test('abrir a troca de template e mudar de aba fecha a confirmação, sem trocar nada', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map()
  world(on, files, { squad: true })
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-ver-juridico' })
  await ui.press({ key: 'est-baixar' })
  await ui.press({ key: 'est-voltar' })
  await ui.press({ key: 'est-ver-desenvolvimento' })
  await ui.press({ key: 'est-baixar' })
  expect(await ui.find({ key: 'est-confirmar-sim' })).toBeDefined()
  await ui.press({ key: 'est-aba-biblioteca' })
  expect(await ui.find({ key: 'est-confirmar-sim' })).toBeUndefined()
  // Nada foi trocado: o jurídico continua ativo e os agentes do desenvolvimento não foram gravados.
  expect(files.has(`${AGENTES}/gerador.md`)).toBe(false)
  expect((JSON.parse(files.get(MANIFESTO) ?? 'null') as { ativo?: string } | null)?.ativo).toBe('juridico')
  await ui.unmount()
})

test('um template próprio chamado Jogos vira jogos-propria, sem usar o id do catálogo', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map([
    [`${AGENTES}/gerador.md`, GERADOR_PROPRIO],
    [`${AGENTES}/revisor.md`, REVISOR_PROPRIO],
    [CLAUDE_MD, '# Meu fluxo\n\nTexto.\n'],
  ])
  world(on, files, { squad: true })
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-aba-biblioteca' })
  await ui.input({ key: 'est-titulo', text: 'Jogos', kind: 'change' })
  await ui.press({ key: 'est-salvar' })
  expect(files.has(`${BIBLIOTECA}/jogos-propria.json`)).toBe(true)
  expect(files.has(`${BIBLIOTECA}/jogos.json`)).toBe(false)
  expect(biblioteca(files, 'jogos-propria')?.origin).toBe('proprio')
  await ui.unmount()
})

test('"Só salvar" do catálogo não troca um template próprio de mesmo id e avisa', { timeoutMs: 20000 }, async ($, on) => {
  const proprio = JSON.stringify({
    formato: 1,
    id: 'jogos',
    title: 'Meus jogos',
    icon: '🎮',
    summary: 'Template meu, salvo antes.',
    origin: 'proprio',
    createdAt: NOW,
    agents: [{ file: 'gerador.md', content: GERADOR_PROPRIO }],
    claudeMd: 'Meu fluxo.',
  })
  const files: Files = new Map([[`${BIBLIOTECA}/jogos.json`, proprio]])
  world(on, files, { squad: true })
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-ver-jogos' })
  await ui.press({ key: 'est-so-salvar' })
  expect(files.get(`${BIBLIOTECA}/jogos.json`)).toBe(proprio)
  expect(await ui.find({ type: 'Text', text: /Já existe um template seu/ })).toBeDefined()
  await ui.unmount()
})

test('um CLAUDE.md em CRLF continua em CRLF depois de baixar e de trocar a estrutura', { timeoutMs: 20000 }, async ($, on) => {
  const CR = String.fromCharCode(13)
  const files: Files = new Map([[CLAUDE_MD, ['# Meu fluxo', '', 'Texto.', ''].join(CR + '\n')]])
  world(on, files, { squad: true })
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-ver-juridico' })
  await ui.press({ key: 'est-baixar' })
  // Sem LF solto: todo fim de linha do arquivo é CRLF.
  const temLfSolto = (texto: string): boolean => texto.split(CR + '\n').join('').includes('\n')
  expect(files.get(CLAUDE_MD)).toContain(marcadorInicio('juridico'))
  expect(files.get(CLAUDE_MD)).toContain('Texto.')
  expect(temLfSolto(files.get(CLAUDE_MD) ?? '')).toBe(false)
  await ui.press({ key: 'est-voltar' })
  await ui.press({ key: 'est-ver-desenvolvimento' })
  await ui.press({ key: 'est-baixar' })
  await ui.press({ key: 'est-confirmar-sim' })
  expect(files.get(CLAUDE_MD)).toContain(marcadorInicio('desenvolvimento'))
  expect(files.get(CLAUDE_MD)).toContain('Texto.')
  expect(temLfSolto(files.get(CLAUDE_MD) ?? '')).toBe(false)
  await ui.unmount()
})
