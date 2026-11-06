// Clonar uma estrutura padrão para editar (no detalhe e no cartão de cópia), com o nome padrão, as colisões de id e o
// cancelar; e as cópias do catálogo em Meus templates: versão nova → Atualizar, cópia em dia e o cartão com a ação certa.
// Sobre um sistema de arquivos em memória, como tests/estruturas-painel.test.tsx.

import type { On } from 'claude-code'
import { type Engine, expect, mock, test } from 'claude-code/testing'

import { estruturaPorId } from '../hooks/lib/estruturas/index'
import { SQUAD_VERSAO_PADRAO, templateDaEstrutura } from '../hooks/lib/estruturas/protocolo'

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
const BIBLIOTECA = '/home/u/.claude/agents-creator/estruturas'

// O nome padrão de uma cópia de 'juridico' e o id que ele vira: acento sai, espaço e parênteses viram '-', e o '-' do fim sai.
const NOME_PADRAO_JURIDICO = 'Escritório jurídico (minha versão)'
const CLONE_JURIDICO = 'escritorio-juridico-minha-versao'

type Files = Map<string, string>

type WorldOptions = { root?: string; env?: Record<string, string>; squad?: boolean }

type Biblioteca = {
  id?: string
  title?: string
  origin?: string
  base?: string
  agents?: { file: string; content: string }[]
  claudeMd?: string
}

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

/** Os arquivos gravados na biblioteca do usuário. */
function arquivosDaBiblioteca(files: Files): string[] {
  return [...files.keys()].filter(caminho => caminho.startsWith(`${BIBLIOTECA}/`))
}

/** A estrutura padrão como o catálogo a monta, na versão do squad-stream instalada no mundo de teste. */
function doCatalogo(id: string) {
  const estrutura = estruturaPorId(id)
  if (!estrutura) throw new Error(`a estrutura ${id} não existe no catálogo`)
  return templateDaEstrutura(estrutura, SQUAD_VERSAO_PADRAO, NOW)
}

/** O texto de um JSON da biblioteca, como o app grava (2 espaços e quebra de linha no fim). */
function json(tpl: object): string {
  return JSON.stringify(tpl, null, 2) + '\n'
}

test('Clonar no detalhe: o nome vem "<Título> (minha versão)", a cópia fica em Meus templates e o editor abre', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map()
  world(on, files, { squad: true })
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-ver-juridico' })
  await ui.press({ key: 'est-clonar' })
  expect((await ui.find({ type: 'Input', key: 'est-nome-clone' }))?.props.value).toBe(NOME_PADRAO_JURIDICO)
  await ui.press({ key: 'est-clone-ok' })
  const copia = biblioteca(files, CLONE_JURIDICO)
  expect(copia?.id).toBe(CLONE_JURIDICO)
  expect(copia?.origin).toBe('proprio')
  expect(copia?.base).toBe('juridico')
  expect(copia?.title).toBe(NOME_PADRAO_JURIDICO)
  // A cópia leva a equipe e o fluxo da estrutura padrão.
  expect(copia?.agents).toEqual(doCatalogo('juridico').agents)
  expect(copia?.claudeMd).toBe(doCatalogo('juridico').claudeMd)
  // O editor do template abre: "Voltar" fica sempre; "Salvar" só aparece com alterações.
  expect(await ui.find({ key: 'est-edicao-voltar' })).toBeDefined()
  expect(await ui.find({ key: 'est-edicao-salvar' })).toBeUndefined()
  expect((await ui.find({ type: 'Input', key: 'est-edicao-titulo' }))?.props.value).toBe(NOME_PADRAO_JURIDICO)
  expect(await ui.find({ key: 'est-clone-ok' })).toBeUndefined()
  await ui.unmount()
})

test('nome igual ao id do catálogo ganha "-propria"; repetindo o clone com o mesmo nome, "-2"', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map()
  world(on, files, { squad: true })
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // 'Jogos' vira o slug 'jogos', que é o id do catálogo: a cópia não pode levar esse id.
  await ui.press({ key: 'est-ver-jogos' })
  await ui.press({ key: 'est-clonar' })
  await ui.input({ key: 'est-nome-clone', text: 'Jogos', kind: 'change' })
  await ui.press({ key: 'est-clone-ok' })
  expect(files.has(`${BIBLIOTECA}/jogos-propria.json`)).toBe(true)
  expect(files.has(`${BIBLIOTECA}/jogos.json`)).toBe(false)
  expect(biblioteca(files, 'jogos-propria')?.origin).toBe('proprio')
  expect(biblioteca(files, 'jogos-propria')?.base).toBe('jogos')
  // Sai do editor, volta ao catálogo e clona de novo com o mesmo nome: o id ganha "-2" e o primeiro fica como está.
  await ui.press({ key: 'est-edicao-voltar' })
  await ui.press({ key: 'est-aba-catalogo' })
  await ui.press({ key: 'est-ver-jogos' })
  await ui.press({ key: 'est-clonar' })
  await ui.input({ key: 'est-nome-clone', text: 'Jogos', kind: 'change' })
  await ui.press({ key: 'est-clone-ok' })
  expect(biblioteca(files, 'jogos-propria-2')?.origin).toBe('proprio')
  expect(biblioteca(files, 'jogos-propria-2')?.base).toBe('jogos')
  expect(biblioteca(files, 'jogos-propria')?.origin).toBe('proprio')
  await ui.unmount()
})

test('"Cancelar" no formulário de clonar fecha o formulário e não grava nada', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map()
  world(on, files, { squad: true })
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-ver-juridico' })
  await ui.press({ key: 'est-clonar' })
  expect(await ui.find({ key: 'est-clone-ok' })).toBeDefined()
  await ui.press({ key: 'est-clone-cancelar' })
  expect(await ui.find({ key: 'est-clone-ok' })).toBeUndefined()
  expect(await ui.find({ type: 'Input', key: 'est-nome-clone' })).toBeUndefined()
  expect(arquivosDaBiblioteca(files)).toEqual([])
  await ui.unmount()
})

test('cópia do catálogo desatualizada mostra "versão nova"; Atualizar grava o conteúdo atual do catálogo', { timeoutMs: 20000 }, async ($, on) => {
  const atual = doCatalogo('juridico')
  // A cópia guardada tem um agente a menos que a estrutura padrão de hoje.
  const antiga = json({ ...atual, agents: atual.agents.slice(0, -1) })
  const files: Files = new Map([[`${BIBLIOTECA}/juridico.json`, antiga]])
  world(on, files, { squad: true })
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-aba-biblioteca' })
  expect(await ui.find({ type: 'Text', text: /versão nova/ })).toBeDefined()
  expect(await ui.find({ key: 'est-atualizar-copia-juridico' })).toBeDefined()
  await ui.press({ key: 'est-atualizar-copia-juridico' })
  expect(files.get(`${BIBLIOTECA}/juridico.json`)).not.toBe(antiga)
  expect(biblioteca(files, 'juridico')?.agents).toEqual(atual.agents)
  expect(biblioteca(files, 'juridico')?.claudeMd).toBe(atual.claudeMd)
  expect(await ui.find({ type: 'Text', text: /versão nova/ })).toBeUndefined()
  expect(await ui.find({ key: 'est-atualizar-copia-juridico' })).toBeUndefined()
  await ui.unmount()
})

test('cópia do catálogo em dia não mostra "versão nova" nem Atualizar', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map([[`${BIBLIOTECA}/juridico.json`, json(doCatalogo('juridico'))]])
  world(on, files, { squad: true })
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-aba-biblioteca' })
  // O cartão da cópia está lá (para o teste não passar em branco)...
  expect(await ui.find({ key: 'est-clonar-lib-juridico' })).toBeDefined()
  // ...e nada indica versão nova.
  expect(await ui.find({ type: 'Text', text: /versão nova/ })).toBeUndefined()
  expect(await ui.find({ key: 'est-atualizar-copia-juridico' })).toBeUndefined()
  await ui.unmount()
})

test('o cartão de uma cópia do catálogo mostra "Clonar para editar", e não "Editar"', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map([[`${BIBLIOTECA}/juridico.json`, json(doCatalogo('juridico'))]])
  world(on, files, { squad: true })
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-aba-biblioteca' })
  expect(await ui.find({ key: 'est-clonar-lib-juridico' })).toBeDefined()
  expect(await ui.find({ key: 'est-editar-juridico' })).toBeUndefined()
  await ui.unmount()
})

test('"Clonar para editar" no cartão pede o nome ali mesmo e cria a cópia própria, com base no catálogo', { timeoutMs: 20000 }, async ($, on) => {
  const files: Files = new Map([[`${BIBLIOTECA}/juridico.json`, json(doCatalogo('juridico'))]])
  world(on, files, { squad: true })
  await start($)
  await $.command.run({ command: 'agentes', args: 'estruturas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'est-aba-biblioteca' })
  await ui.press({ key: 'est-clonar-lib-juridico' })
  expect((await ui.find({ type: 'Input', key: 'est-nome-clone' }))?.props.value).toBe(NOME_PADRAO_JURIDICO)
  await ui.press({ key: 'est-clone-ok' })
  expect(biblioteca(files, CLONE_JURIDICO)?.origin).toBe('proprio')
  expect(biblioteca(files, CLONE_JURIDICO)?.base).toBe('juridico')
  expect(await ui.find({ key: 'est-edicao-voltar' })).toBeDefined()
  expect(await ui.find({ key: 'est-edicao-salvar' })).toBeUndefined()
  // Fechando o editor: o formulário de nome não volta (o cartão do catálogo é o mesmo de antes) e a cópia nova está na lista.
  await ui.press({ key: 'est-edicao-voltar' })
  expect(await ui.find({ key: 'est-clone-ok' })).toBeUndefined()
  expect(await ui.find({ type: 'Input', key: 'est-nome-clone' })).toBeUndefined()
  expect(await ui.find({ key: 'est-clonar-lib-juridico' })).toBeDefined()
  expect(await ui.find({ key: 'est-editar-' + CLONE_JURIDICO })).toBeDefined()
  await ui.unmount()
})
