// Editar um template próprio na aba Estruturas: os campos da tela do template, o agente pelo editor (Salvar no
// template não toca no projeto), + Novo agente, Remover agente e o template do catálogo, que só se clona.

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
const SQUAD_BUS = '/home/u/.claude/plugins/cache/skill-squad-room/squad-stream/0.2.0/skills/squad-stream/scripts/bus.js'
const AGENTES = '/proj/.claude/agents'
const BIBLIOTECA = '/home/u/.claude/agents-creator/estruturas'

// O gerador como está no template.
const GERADOR = `---
name: gerador
description: Implementa um mini-plano fechado, mexendo só nos arquivos listados.
tools: Read, Write, Edit, Bash
model: sonnet
---

Você implementa o mini-plano.
`

// O mesmo gerador, mas editado direto no projeto: o projeto não pode mudar com as edições do template.
const GERADOR_DO_PROJETO = `---
name: gerador
description: Editado direto no projeto, implementa um mini-plano fechado, mexendo só nos arquivos listados.
tools: Read, Write, Edit, Bash
model: sonnet
---

Você implementa o mini-plano.
`

const REVISOR = `---
name: revisor
description: Revisa cada entrega antes de aprovar a parte do squad.
tools: Read, Grep, Glob, Bash
model: opus
color: blue
---

Você revisa a entrega.
`

const ADVOGADO = `---
name: advogado-senior
description: Advogado sênior da minha equipe, com as regras do meu escritório.
---

Meu prompt próprio.
`

type Files = Map<string, string>
type Agente = { file: string; content: string }
type Modelo = { title?: string; summary?: string; icon?: string; claudeMd?: string; origin?: string; agents?: Agente[] }

/** O mundo abaixo do plugin, copiado de estruturas-painel.test.tsx: ambiente, relógio, store, sessão e arquivos em memória. */
function world(on: On, files: Files): void {
  // O squad-stream está instalado: o painel acha o bus.js dele, então o aviso sem squad não entra.
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
    // No Windows o caminho vai por variável de ambiente; no resto, é o último argumento do rm.
    const target = e.argv[0] === 'powershell.exe' ? (e.init?.env?.AGENTS_CREATOR_ALVO ?? '') : (e.argv[e.argv.length - 1] ?? '')
    files.delete(norm(target))
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
}

/** Um template da biblioteca, como o estúdio grava: formato 1, com os agentes dados e sem fluxo do CLAUDE.md. */
function modelo(id: string, title: string, origin: 'proprio' | 'catalogo', agents: Agente[], claudeMd = ''): string {
  return JSON.stringify({ formato: 1, id, title, icon: '📋', summary: 'Template de teste.', origin, base: '', createdAt: NOW, agents, claudeMd })
}

/** O template da biblioteca lido de volta, ou null quando não existe. */
function lerModelo(files: Files, id: string): Modelo | null {
  const texto = files.get(`${BIBLIOTECA}/${id}.json`)
  return texto === undefined ? null : (JSON.parse(texto) as Modelo)
}

test('editar nome, resumo, ícone e fluxo de um template próprio e salvar grava os quatro, sem mexer nos agentes', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map([[`${BIBLIOTECA}/meu-squad.json`, modelo('meu-squad', 'Meu squad', 'proprio', [{ file: 'gerador.md', content: GERADOR }], 'Fluxo antigo.')]])
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-aba-biblioteca' })
  await ui.press({ key: 'est-editar-meu-squad' })
  // Sem mudança não há o que salvar: o botão Salvar só aparece depois de editar um campo.
  expect(await ui.find({ key: 'est-edicao-salvar' })).toBeUndefined()
  await ui.input({ key: 'est-edicao-titulo', text: 'Meu squad novo', kind: 'change' })
  await ui.input({ key: 'est-edicao-resumo', text: 'Resumo novo, escrito no editor.', kind: 'change' })
  await ui.select({ key: 'est-edicao-icone', value: '🎮' })
  await ui.input({ key: 'est-edicao-fluxo', text: 'Fluxo novo, escrito no editor.', kind: 'change' })
  expect(await ui.find({ key: 'est-edicao-salvar' })).toBeDefined()
  await ui.press({ key: 'est-edicao-salvar' })
  const salvo = lerModelo(files, 'meu-squad')
  expect(salvo?.title).toBe('Meu squad novo')
  expect(salvo?.summary).toBe('Resumo novo, escrito no editor.')
  expect(salvo?.icon).toBe('🎮')
  expect(salvo?.claudeMd).toBe('Fluxo novo, escrito no editor.')
  // Os agentes e a origem do template ficam como estavam.
  expect(salvo?.origin).toBe('proprio')
  expect(salvo?.agents).toEqual([{ file: 'gerador.md', content: GERADOR }])
  expect(await ui.find({ type: 'Text', text: /Template "Meu squad novo" salvo\./ })).toBeDefined()
  expect(await ui.find({ key: 'est-edicao-salvar' })).toBeUndefined()
  await ui.unmount()
})


test('mexer em um campo só mantém os outros: a tela abre com os valores do template', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map([[`${BIBLIOTECA}/meu-squad.json`, modelo('meu-squad', 'Meu squad', 'proprio', [{ file: 'gerador.md', content: GERADOR }], 'Fluxo antigo.')]])
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-aba-biblioteca' })
  await ui.press({ key: 'est-editar-meu-squad' })
  // Só o resumo muda: nome, ícone e fluxo saem do que o template já tinha.
  await ui.input({ key: 'est-edicao-resumo', text: 'Só o resumo mudou.', kind: 'change' })
  await ui.press({ key: 'est-edicao-salvar' })
  const primeiro = lerModelo(files, 'meu-squad')
  expect([primeiro?.title, primeiro?.summary, primeiro?.icon, primeiro?.claudeMd]).toEqual(['Meu squad', 'Só o resumo mudou.', '📋', 'Fluxo antigo.'])
  // Reabre o template: só o nome muda, e o resumo novo continua.
  await ui.press({ key: 'est-edicao-voltar' })
  await ui.press({ key: 'est-editar-meu-squad' })
  await ui.input({ key: 'est-edicao-titulo', text: 'Só o nome mudou', kind: 'change' })
  await ui.press({ key: 'est-edicao-salvar' })
  const segundo = lerModelo(files, 'meu-squad')
  expect([segundo?.title, segundo?.summary, segundo?.icon, segundo?.claudeMd]).toEqual(['Só o nome mudou', 'Só o resumo mudou.', '📋', 'Fluxo antigo.'])
  await ui.unmount()
})


test('Editar um agente do template abre o editor; Salvar no template grava no template e não mexe no projeto', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map([
    [`${BIBLIOTECA}/meu-squad.json`, modelo('meu-squad', 'Meu squad', 'proprio', [{ file: 'gerador.md', content: GERADOR }])],
    [`${AGENTES}/gerador.md`, GERADOR_DO_PROJETO],
  ])
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-aba-biblioteca' })
  await ui.press({ key: 'est-editar-meu-squad' })
  await ui.press({ key: 'est-edicao-agente-gerador.md' })
  // O editor abre com a faixa do template, e o botão de salvar é o do template.
  expect(await ui.find({ type: 'Text', text: /Agente do template Meu squad/ })).toBeDefined()
  expect(await ui.find({ key: 'ed-salvar', text: /Salvar no template/ })).toBeDefined()
  await ui.input({ key: 'ed-descricao', text: 'Descrição escrita no editor do template.', kind: 'change' })
  await ui.press({ key: 'ed-salvar' })
  const agentes = lerModelo(files, 'meu-squad')?.agents ?? []
  expect(agentes.map(agente => agente.file)).toEqual(['gerador.md'])
  expect(agentes[0]?.content).toContain('Descrição escrita no editor do template.')
  // O projeto não muda: o agente do projeto continua como estava.
  expect(files.get(`${AGENTES}/gerador.md`)).toBe(GERADOR_DO_PROJETO)
  expect(await ui.find({ type: 'Text', text: /"gerador" salvo no template "Meu squad"\./ })).toBeDefined()
  // Voltou à aba: o editor fechou e a tela do template (da aba Estruturas) continua com o agente.
  expect(await ui.find({ key: 'ed-descricao' })).toBeUndefined()
  expect(await ui.find({ key: 'est-edicao-voltar' })).toBeDefined()
  expect(await ui.find({ key: 'est-edicao-agente-gerador.md' })).toBeDefined()
  await ui.unmount()
})

test('Editar o agente do meio de três grava só esse agente, na mesma posição', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map([
    [
      `${BIBLIOTECA}/meu-squad.json`,
      modelo('meu-squad', 'Meu squad', 'proprio', [
        { file: 'gerador.md', content: GERADOR },
        { file: 'revisor.md', content: REVISOR },
        { file: 'advogado-senior.md', content: ADVOGADO },
      ]),
    ],
  ])
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-aba-biblioteca' })
  await ui.press({ key: 'est-editar-meu-squad' })
  await ui.press({ key: 'est-edicao-agente-revisor.md' })
  await ui.input({ key: 'ed-descricao', text: 'Revisa tudo, de ponta a ponta.', kind: 'change' })
  await ui.press({ key: 'ed-salvar' })
  const agentes = lerModelo(files, 'meu-squad')?.agents ?? []
  expect(agentes.map(agente => agente.file)).toEqual(['gerador.md', 'revisor.md', 'advogado-senior.md'])
  expect(agentes[1]?.content).toContain('Revisa tudo, de ponta a ponta.')
  expect(agentes[0]?.content).toBe(GERADOR)
  expect(agentes[2]?.content).toBe(ADVOGADO)
  await ui.unmount()
})


test('+ Novo agente abre um editor vazio no template; Salvar no template acrescenta o agente ao template', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map([[`${BIBLIOTECA}/meu-squad.json`, modelo('meu-squad', 'Meu squad', 'proprio', [{ file: 'gerador.md', content: GERADOR }])]])
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-aba-biblioteca' })
  await ui.press({ key: 'est-editar-meu-squad' })
  await ui.press({ key: 'est-edicao-novo' })
  expect(await ui.find({ type: 'Text', text: /Agente do template Meu squad/ })).toBeDefined()
  expect(await ui.find({ key: 'ed-salvar', text: /Salvar no template/ })).toBeDefined()
  await ui.input({ key: 'ed-nome', text: 'Revisor', kind: 'change' })
  await ui.input({ key: 'ed-descricao', text: 'Revisa cada entrega antes de aprovar a parte do squad.', kind: 'change' })
  await ui.input({ key: 'ed-prompt', text: 'Você revisa a entrega.', kind: 'change' })
  await ui.press({ key: 'ed-salvar' })
  const agentes = lerModelo(files, 'meu-squad')?.agents ?? []
  expect(agentes.map(agente => agente.file)).toEqual(['gerador.md', 'revisor.md'])
  expect(agentes[1]?.content).toContain('name: revisor')
  // O agente novo fica só no template: a pasta de agentes do projeto não ganha arquivo.
  expect(files.has(`${AGENTES}/revisor.md`)).toBe(false)
  expect(await ui.find({ type: 'Text', text: /"revisor" salvo no template "Meu squad"\./ })).toBeDefined()
  // A tela do template já lista o agente novo.
  expect(await ui.find({ key: 'est-edicao-agente-revisor.md' })).toBeDefined()
  await ui.unmount()
})

test('Remover um agente do template pede confirmação e tira só esse agente, sem tocar no projeto', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map([
    [
      `${BIBLIOTECA}/meu-squad.json`,
      modelo('meu-squad', 'Meu squad', 'proprio', [
        { file: 'gerador.md', content: GERADOR },
        { file: 'revisor.md', content: REVISOR },
      ]),
    ],
    [`${AGENTES}/gerador.md`, GERADOR_DO_PROJETO],
  ])
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-aba-biblioteca' })
  await ui.press({ key: 'est-editar-meu-squad' })
  await ui.press({ key: 'est-edicao-remover-gerador.md' })
  expect(await ui.find({ type: 'Text', text: /Tirar "gerador\.md" do template\? O projeto não muda\./ })).toBeDefined()
  // Até confirmar, o template continua com os dois agentes.
  expect(lerModelo(files, 'meu-squad')?.agents?.length).toBe(2)
  await ui.press({ key: 'est-confirmar-sim' })
  expect(lerModelo(files, 'meu-squad')?.agents?.map(agente => agente.file)).toEqual(['revisor.md'])
  expect(files.get(`${AGENTES}/gerador.md`)).toBe(GERADOR_DO_PROJETO)
  // A confirmação fechou e a tela do template não lista mais o agente tirado.
  expect(await ui.find({ key: 'est-confirmar-sim' })).toBeUndefined()
  expect(await ui.find({ key: 'est-edicao-agente-gerador.md' })).toBeUndefined()
  expect(await ui.find({ key: 'est-edicao-agente-revisor.md' })).toBeDefined()
  await ui.unmount()
})

test('Cancelar a remoção do agente não tira nada do template', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map([
    [
      `${BIBLIOTECA}/meu-squad.json`,
      modelo('meu-squad', 'Meu squad', 'proprio', [
        { file: 'gerador.md', content: GERADOR },
        { file: 'revisor.md', content: REVISOR },
      ]),
    ],
  ])
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-aba-biblioteca' })
  await ui.press({ key: 'est-editar-meu-squad' })
  await ui.press({ key: 'est-edicao-remover-gerador.md' })
  await ui.press({ key: 'est-confirmar-nao' })
  expect(await ui.find({ key: 'est-confirmar-sim' })).toBeUndefined()
  expect(lerModelo(files, 'meu-squad')?.agents?.map(agente => agente.file)).toEqual(['gerador.md', 'revisor.md'])
  await ui.unmount()
})


test('um template do catálogo na biblioteca mostra Clonar para editar e não Editar; o próprio mostra Editar', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map([
    [`${BIBLIOTECA}/juridico.json`, modelo('juridico', 'Escritório jurídico', 'catalogo', [{ file: 'advogado-senior.md', content: ADVOGADO }])],
    [`${BIBLIOTECA}/meu-squad.json`, modelo('meu-squad', 'Meu squad', 'proprio', [{ file: 'gerador.md', content: GERADOR }])],
  ])
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-aba-biblioteca' })
  expect(await ui.find({ key: 'est-clonar-lib-juridico', text: /Clonar para editar/ })).toBeDefined()
  expect(await ui.find({ key: 'est-editar-juridico' })).toBeUndefined()
  expect(await ui.find({ key: 'est-editar-meu-squad', text: /Editar/ })).toBeDefined()
  expect(await ui.find({ key: 'est-clonar-lib-meu-squad' })).toBeUndefined()
  await ui.unmount()
})


test('Voltar no editor do agente do template volta à tela do template, sem gravar nada', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map([[`${BIBLIOTECA}/meu-squad.json`, modelo('meu-squad', 'Meu squad', 'proprio', [{ file: 'gerador.md', content: GERADOR }])]])
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-aba-biblioteca' })
  await ui.press({ key: 'est-editar-meu-squad' })
  await ui.press({ key: 'est-edicao-agente-gerador.md' })
  await ui.input({ key: 'ed-descricao', text: 'Isto não vai ser salvo.', kind: 'change' })
  await ui.press({ key: 'ed-voltar' })
  expect(await ui.find({ key: 'ed-descricao' })).toBeUndefined()
  expect(await ui.find({ key: 'est-edicao-voltar' })).toBeDefined()
  expect(lerModelo(files, 'meu-squad')?.agents?.[0]?.content).toBe(GERADOR)
  await ui.unmount()
})

test('depois de salvar um agente do template ativo e voltar, o aviso de mudanças e o botão de aplicar aparecem', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map([
    [`${BIBLIOTECA}/meu-squad.json`, modelo('meu-squad', 'Meu squad', 'proprio', [{ file: 'gerador.md', content: GERADOR }])],
    [`${AGENTES}/gerador.md`, GERADOR],
  ])
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // O projeto tem os agentes do template: o estúdio o marca como ativo, e ainda não há mudança nenhuma.
  expect(await ui.find({ type: 'Text', text: /Ativo neste projeto: .*Meu squad/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Mudou desde o template/ })).toBeUndefined()
  await ui.press({ key: 'est-aba-biblioteca' })
  await ui.press({ key: 'est-editar-meu-squad' })
  await ui.press({ key: 'est-edicao-agente-gerador.md' })
  await ui.input({ key: 'ed-descricao', text: 'Descrição nova do template ativo.', kind: 'change' })
  await ui.press({ key: 'ed-salvar' })
  await ui.press({ key: 'est-edicao-voltar' })
  expect(await ui.find({ type: 'Text', text: /Mudou desde o template/ })).toBeDefined()
  expect(await ui.find({ key: 'est-aplicar-template' })).toBeDefined()
  await ui.unmount()
})

test('depois de salvar um agente novo no template e voltar, o cartão em Meus templates lista os dois agentes', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map([[`${BIBLIOTECA}/meu-squad.json`, modelo('meu-squad', 'Meu squad', 'proprio', [{ file: 'gerador.md', content: GERADOR }])]])
  world(on, files)
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-aba-biblioteca' })
  await ui.press({ key: 'est-editar-meu-squad' })
  await ui.press({ key: 'est-edicao-novo' })
  await ui.input({ key: 'ed-nome', text: 'Revisor', kind: 'change' })
  await ui.input({ key: 'ed-descricao', text: 'Revisa cada entrega antes de aprovar a parte do squad.', kind: 'change' })
  await ui.input({ key: 'ed-prompt', text: 'Você revisa a entrega.', kind: 'change' })
  await ui.press({ key: 'ed-salvar' })
  await ui.press({ key: 'est-edicao-voltar' })
  expect(await ui.find({ type: 'Text', text: /2 agentes: gerador, revisor/ })).toBeDefined()
  await ui.unmount()
})
