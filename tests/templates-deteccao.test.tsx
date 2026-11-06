// Os templates do usuário no estúdio, de ponta a ponta sobre um sistema de arquivos em memória: o projeto que já usa um
// template é detectado, o template salvo vira o ativo, o aviso de mudanças (agente alterado, agente apagado e fluxo do
// CLAUDE.md) leva a Atualizar o template ou a Aplicar o template no projeto, e a cópia de uma estrutura do catálogo
// pede "Salvar como template seu" em vez de atualizar.

import type { On } from 'claude-code'
import { type Engine, expect, mock, test } from 'claude-code/testing'

import { estruturaPorId } from '../hooks/lib/estruturas/index'
import { marcadorFim, marcadorInicio } from '../hooks/lib/estruturas/protocolo'

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
const SQUAD_BUS = '/home/u/.claude/plugins/cache/skill-squad-room/squad-stream/0.2.0/skills/squad-stream/scripts/bus.js'

const AGENTES = '/proj/.claude/agents'
const CLAUDE_MD = '/proj/CLAUDE.md'
const MANIFESTO = '/proj/.claude/agents-creator.json'
const BIBLIOTECA = '/home/u/.claude/agents-creator/estruturas'
const MEU_SQUAD = `${BIBLIOTECA}/meu-squad.json`
const CR = String.fromCharCode(13)

// Os dois agentes do template "Meu squad", como o usuário os salvou.
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

// O gerador depois de o usuário mexer nele no projeto.
const GERADOR_ALTERADO = `---
name: gerador
description: Implementa um mini-plano fechado e roda os testes antes de entregar.
tools: Read, Write, Edit, Bash
model: sonnet
---

Você implementa o mini-plano e roda os testes.
`

// Um agente do próprio usuário com o nome de um agente do jurídico (vai dar "alterado" depois de baixar a estrutura).
const ADVOGADO_PROPRIO = `---
name: advogado-senior
description: Advogado sênior da minha equipe, com as regras do meu escritório.
---

Meu prompt próprio.
`

const FLUXO = '# Meu fluxo\n\nTexto.'
const FLUXO_ALTERADO = '# Meu fluxo\n\nTexto alterado.'

type Files = Map<string, string>
type Agente = { file: string; content: string }
type Manifesto = { formato?: number; ativo?: string; arquivos?: string[] }
type Modelo = { origin?: string; title?: string; agents?: Agente[]; claudeMd?: string }

/** Os dois agentes do template "Meu squad" (o gerador e o revisor, em LF). */
const AGENTES_DO_TEMPLATE: Agente[] = [
  { file: 'gerador.md', content: GERADOR_PROPRIO },
  { file: 'revisor.md', content: REVISOR_PROPRIO },
]

/** O texto com o fim de linha pedido (CRLF ou LF), qualquer que seja o do fonte. */
function eol(texto: string, crlf: boolean): string {
  const lf = texto.split(CR + '\n').join('\n')
  return crlf ? lf.split('\n').join(CR + '\n') : lf
}

/** O mundo abaixo do plugin: ambiente, relógio, store, sessão e arquivos em memória (copiado de estruturas-painel). */
function world(on: On, files: Files): void {
  // O painel só procura o arquivo do bus na pasta de plugins do usuário: aqui ele sempre existe.
  files.set(SQUAD_BUS, '// bus.js de exemplo: o painel só verifica que o arquivo existe')
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
    // No Windows o caminho vai por variável de ambiente (é o que remove um agente do projeto); no resto, é o último argumento do rm.
    const target = e.argv[0] === 'powershell.exe' ? (e.init?.env?.AGENTS_CREATOR_ALVO ?? '') : (e.argv[e.argv.length - 1] ?? '')
    files.delete(norm(target))
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
}

/** O template `id` gravado na biblioteca do usuário, ou null. */
function biblioteca(files: Files, id: string): Modelo | null {
  const texto = files.get(`${BIBLIOTECA}/${id}.json`)
  return texto === undefined ? null : (JSON.parse(texto) as Modelo)
}

/** O conteúdo que o template `id` guarda para o arquivo `file`, ou undefined. */
function conteudoNoTemplate(files: Files, id: string, file: string): string | undefined {
  return biblioteca(files, id)?.agents?.find(agente => agente.file === file)?.content
}

/** O manifesto do projeto (qual template está ativo e os arquivos que ele pôs em .claude/agents), ou null. */
function manifestoDo(files: Files): Manifesto | null {
  const texto = files.get(MANIFESTO)
  return texto === undefined ? null : (JSON.parse(texto) as Manifesto)
}

/** Os arquivos que o manifesto lista, em ordem alfabética. */
function arquivosDoManifesto(files: Files): string[] {
  return [...(manifestoDo(files)?.arquivos ?? [])].sort()
}

/** Um template próprio já gravado na biblioteca, no JSON que o estúdio grava (2 espaços e fim de linha). */
function templateProprio(id: string, title: string, agents: readonly Agente[], claudeMd: string): string {
  return `${JSON.stringify({ formato: 1, id, title, icon: '🧩', summary: 'Meu time.', origin: 'proprio', createdAt: NOW, base: '', agents, claudeMd }, null, 2)}\n`
}

/** O manifesto de um projeto que usa o template `ativo`, com estes agentes em .claude/agents. */
function manifestoTexto(ativo: string, agents: readonly Agente[]): string {
  return `${JSON.stringify({ formato: 1, ativo, arquivos: agents.map(agente => `.claude/agents/${agente.file}`) }, null, 2)}\n`
}

/** O CLAUDE.md do projeto com o bloco do template `id` (marcadores e corpo do fluxo), como o estúdio escreve. */
function claudeMdComBloco(id: string, fluxo: string): string {
  return `# Projeto\n\n${marcadorInicio(id)}\n${fluxo}\n${marcadorFim(id)}\n`
}

test('um projeto com os agentes de um template próprio passa a usá-lo, mesmo com CRLF de um lado e LF do outro', { timeoutMs: 20000 }, async ($, on) => {
  // No projeto o gerador está em CRLF e o revisor em LF; no template é o contrário. O conteúdo é o mesmo.
  const files: Files = new Map([
    [`${AGENTES}/gerador.md`, eol(GERADOR_PROPRIO, true)],
    [`${AGENTES}/revisor.md`, eol(REVISOR_PROPRIO, false)],
    [CLAUDE_MD, claudeMdComBloco('meu-squad', FLUXO)],
    [MEU_SQUAD, templateProprio('meu-squad', 'Meu squad', [
      { file: 'gerador.md', content: eol(GERADOR_PROPRIO, false) },
      { file: 'revisor.md', content: eol(REVISOR_PROPRIO, true) },
    ], FLUXO)],
  ])
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(manifestoDo(files)?.formato).toBe(1)
  expect(manifestoDo(files)?.ativo).toBe('meu-squad')
  expect(arquivosDoManifesto(files)).toEqual(['.claude/agents/gerador.md', '.claude/agents/revisor.md'])
  expect(await ui.find({ type: 'Text', text: /Este projeto usa o template "Meu squad"/ })).toBeDefined()
  // Agentes e fluxo batem com o template: nenhum aviso de mudança.
  expect(await ui.find({ type: 'Text', text: /Mudou desde o template/ })).toBeUndefined()
  await ui.unmount()
})

test('mesmos nomes de agente com conteúdo diferente não contam como o template: nada é detectado', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map([
    [`${AGENTES}/gerador.md`, GERADOR_ALTERADO],
    [`${AGENTES}/revisor.md`, REVISOR_PROPRIO],
    [CLAUDE_MD, claudeMdComBloco('meu-squad', FLUXO)],
    [MEU_SQUAD, templateProprio('meu-squad', 'Meu squad', AGENTES_DO_TEMPLATE, FLUXO)],
  ])
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // O gerador tem o mesmo nome do template, mas outro conteúdo: o projeto não usa o template.
  expect(manifestoDo(files)).toBeNull()
  expect(await ui.find({ type: 'Text', text: /Este projeto usa o template/ })).toBeUndefined()
  await ui.unmount()
})

test('Salvar como template deixa o template novo ativo no manifesto do projeto', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map([
    [`${AGENTES}/gerador.md`, GERADOR_PROPRIO],
    [`${AGENTES}/revisor.md`, REVISOR_PROPRIO],
    [CLAUDE_MD, '# Meu fluxo\n\nTexto.\n'],
  ])
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // Nenhum template da biblioteca casa com estes agentes: o projeto ainda não usa nenhum.
  expect(manifestoDo(files)).toBeNull()
  await ui.press({ key: 'est-aba-biblioteca' })
  await ui.input({ key: 'est-titulo', text: 'Meu squad', kind: 'change' })
  await ui.press({ key: 'est-salvar' })
  expect(biblioteca(files, 'meu-squad')?.origin).toBe('proprio')
  expect(manifestoDo(files)?.ativo).toBe('meu-squad')
  expect(arquivosDoManifesto(files)).toEqual(['.claude/agents/gerador.md', '.claude/agents/revisor.md'])
  await ui.unmount()
})

test('Salvar como template troca o template ativo quando o projeto já usava outro', { timeoutMs: 20000 }, async ($, on) => {
  // O projeto usa "Outro time" (com o gerador mexido); o usuário salva o que está no projeto como "Meu squad".
  const agentesOutro: Agente[] = [
    { file: 'gerador.md', content: GERADOR_ALTERADO },
    { file: 'revisor.md', content: REVISOR_PROPRIO },
  ]
  const files: Files = new Map([
    [`${AGENTES}/gerador.md`, GERADOR_PROPRIO],
    [`${AGENTES}/revisor.md`, REVISOR_PROPRIO],
    [CLAUDE_MD, claudeMdComBloco('outro-time', FLUXO)],
    [MANIFESTO, manifestoTexto('outro-time', agentesOutro)],
    [`${BIBLIOTECA}/outro-time.json`, templateProprio('outro-time', 'Outro time', agentesOutro, FLUXO)],
  ])
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(manifestoDo(files)?.ativo).toBe('outro-time')
  await ui.press({ key: 'est-aba-biblioteca' })
  await ui.input({ key: 'est-titulo', text: 'Meu squad', kind: 'change' })
  await ui.press({ key: 'est-salvar' })
  expect(biblioteca(files, 'meu-squad')?.origin).toBe('proprio')
  expect(manifestoDo(files)?.ativo).toBe('meu-squad')
  await ui.unmount()
})

test('agente alterado e agente apagado aparecem no aviso; Atualizar o template grava o que está no projeto', { timeoutMs: 20000 }, async ($, on) => {
  // Template ativo: o projeto mudou o gerador e apagou o revisor.
  const files: Files = new Map([
    [`${AGENTES}/gerador.md`, GERADOR_ALTERADO],
    [CLAUDE_MD, claudeMdComBloco('meu-squad', FLUXO)],
    [MANIFESTO, manifestoTexto('meu-squad', AGENTES_DO_TEMPLATE)],
    [MEU_SQUAD, templateProprio('meu-squad', 'Meu squad', AGENTES_DO_TEMPLATE, FLUXO)],
  ])
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Mudou desde o template/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /gerador\.md \(alterado\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /revisor\.md \(faltando\)/ })).toBeDefined()
  // Template próprio: o botão é Atualizar, e não Salvar como template seu.
  expect(await ui.find({ key: 'est-atualizar-template' })).toBeDefined()
  expect(await ui.find({ key: 'est-salvar-como-seu' })).toBeUndefined()
  await ui.press({ key: 'est-atualizar-template' })
  expect(conteudoNoTemplate(files, 'meu-squad', 'gerador.md')).toBe(GERADOR_ALTERADO)
  // O revisor não está no projeto: o template mantém o que já tinha.
  expect(conteudoNoTemplate(files, 'meu-squad', 'revisor.md')).toBe(REVISOR_PROPRIO)
  expect(await ui.find({ type: 'Text', text: /O template foi atualizado com o projeto/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /gerador\.md \(alterado\)/ })).toBeUndefined()
  await ui.unmount()
})

test('o fluxo do CLAUDE.md mudado aparece no aviso, e Atualizar o template grava o fluxo novo', { timeoutMs: 20000 }, async ($, on) => {
  // Os agentes são os do template; só o bloco do fluxo no CLAUDE.md mudou.
  const files: Files = new Map([
    [`${AGENTES}/gerador.md`, GERADOR_PROPRIO],
    [`${AGENTES}/revisor.md`, REVISOR_PROPRIO],
    [CLAUDE_MD, claudeMdComBloco('meu-squad', FLUXO_ALTERADO)],
    [MANIFESTO, manifestoTexto('meu-squad', AGENTES_DO_TEMPLATE)],
    [MEU_SQUAD, templateProprio('meu-squad', 'Meu squad', AGENTES_DO_TEMPLATE, FLUXO)],
  ])
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Mudou desde o template/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /fluxo do CLAUDE\.md/ })).toBeDefined()
  // Nenhum agente mudou: o aviso não lista arquivo nenhum.
  expect(await ui.find({ type: 'Text', text: /\((alterado|faltando)\)/ })).toBeUndefined()
  await ui.press({ key: 'est-atualizar-template' })
  expect(biblioteca(files, 'meu-squad')?.claudeMd?.trim()).toBe(FLUXO_ALTERADO)
  expect(await ui.find({ type: 'Text', text: /fluxo do CLAUDE\.md/ })).toBeUndefined()
  await ui.unmount()
})

test('Aplicar o template no projeto devolve o agente alterado ao template e manda o trocado para a lixeira', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map([
    [`${AGENTES}/gerador.md`, GERADOR_ALTERADO],
    [`${AGENTES}/revisor.md`, REVISOR_PROPRIO],
    [CLAUDE_MD, claudeMdComBloco('meu-squad', FLUXO)],
    [MANIFESTO, manifestoTexto('meu-squad', AGENTES_DO_TEMPLATE)],
    [MEU_SQUAD, templateProprio('meu-squad', 'Meu squad', AGENTES_DO_TEMPLATE, FLUXO)],
  ])
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // Antes de aplicar, a lixeira do estúdio não tem nada.
  expect(await ui.find({ key: 'nav-lixeira' })).toBeUndefined()
  await ui.press({ key: 'est-aplicar-template' })
  expect(files.get(`${AGENTES}/gerador.md`)).toBe(GERADOR_PROPRIO)
  expect(files.get(`${AGENTES}/revisor.md`)).toBe(REVISOR_PROPRIO)
  expect(await ui.find({ type: 'Text', text: /Mudou desde o template/ })).toBeUndefined()
  // Só o trocado foi para a lixeira: o revisor já era igual ao template e não saiu do lugar.
  expect(await ui.find({ key: 'nav-lixeira' })).toBeDefined()
  await ui.press({ key: 'nav-lixeira' })
  expect(await ui.find({ type: 'Text', text: /gerador\.md/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /revisor\.md/ })).toBeUndefined()
  await ui.unmount()
})

test('um template do catálogo ativo com mudança oferece "Salvar como template seu", e não "Atualizar o template"', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map()
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-ver-juridico' })
  await ui.press({ key: 'est-baixar' })
  expect(biblioteca(files, 'juridico')?.origin).toBe('catalogo')
  // O usuário muda um agente que veio da estrutura. O aviso é recalculado quando o estúdio abre de novo.
  files.set(`${AGENTES}/advogado-senior.md`, ADVOGADO_PROPRIO)
  await ui.unmount()
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const reaberta = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await reaberta.find({ type: 'Text', text: /advogado-senior\.md \(alterado\)/ })).toBeDefined()
  expect(await reaberta.find({ key: 'est-salvar-como-seu' })).toBeDefined()
  expect(await reaberta.find({ key: 'est-atualizar-template' })).toBeUndefined()
  // O botão leva à aba Meus templates com o título sugerido: "<título da estrutura> (minha versão)".
  await reaberta.press({ key: 'est-salvar-como-seu' })
  expect((await reaberta.find({ type: 'Input', key: 'est-titulo' }))?.props.value).toBe(`${estruturaPorId('juridico')?.title} (minha versão)`)
  await reaberta.unmount()
})
