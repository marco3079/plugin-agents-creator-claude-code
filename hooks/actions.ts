// Estado da sessão e o que cada botão do estúdio faz. Roda em handlers e hooks; o desenho só lê
// (por `snapshot`).
//
// Os valores de $.state ficam declarados aqui porque a verificação do plugin só aceita `read` e
// `update` sobre átomos escritos no mesmo arquivo. Mude o `shape` de um valor quando o formato dele
// mudar: o que uma versão anterior gravou é então descartado depois de um recarregamento.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type {
  AgentFields,
  Catalog,
  Draft,
  Flags,
  GenState,
  LiveTool,
  SaveScope,
  Status,
  StatusKind,
  TestState,
  TrashItem,
  View,
} from '../types'
import { agentSpec, emptyFields, finalSlug, finalize, liveSlug, parseAgent, splitList, toMarkdown, validate } from './lib/agent'
import { complete, extractJson, fieldsFromJson, generationPrompt, improvementPrompt } from './lib/ai'
import { baseName, dirName, displayPath, joinPath, readText, removeFile, scanCatalog, scopeDir, writeMainAgent } from './lib/files'
import { REGRA_POPUP_GERAL } from './lib/perguntas'
import { TEMPLATES } from './lib/templates'

type Dollar = EngineInterface

export const PANE = 'agentes'
const PANE_TITLE = 'Agentes'

/** Chaves do $.store (persistem entre sessões). */
const STORE_USAGE = 'uso'
const STORE_TRASH = 'lixeira'
const TRASH_LIMIT = 30

export const EMPTY_TEST: TestState = { task: '', busy: false, agentId: '', agent: '', answer: '', error: '' }

const viewAtom = atom({ plugin: 'agents-creator', key: 'view' } as const, 'lista' as View)
const filterAtom = atom({ plugin: 'agents-creator', key: 'filter' } as const, '')
const catalogAtom = atom({ plugin: 'agents-creator', key: 'catalog' } as const, null as Catalog | null, { shape: 'catalog-1' })
const draftAtom = atom({ plugin: 'agents-creator', key: 'draft' } as const, null as Draft | null, { shape: 'draft-1' })
const stashAtom = atom({ plugin: 'agents-creator', key: 'stash' } as const, null as Draft | null, { shape: 'draft-1' })
const statusAtom = atom({ plugin: 'agents-creator', key: 'status' } as const, null as Status, { shape: 'status-1' })
const genAtom = atom(
  { plugin: 'agents-creator', key: 'gen' } as const,
  { request: '', scope: 'project', busy: false, error: '' } as GenState,
  { shape: 'gen-1' },
)
const testAtom = atom(
  { plugin: 'agents-creator', key: 'test' } as const,
  { task: '', busy: false, agentId: '', agent: '', answer: '', error: '' } as TestState,
  { shape: 'test-1' },
)
const flagsAtom = atom(
  { plugin: 'agents-creator', key: 'flags' } as const,
  { toggled: [], preview: false, showFile: false, confirm: '', scopeFilter: '', improving: false, back: 'lista' } as Flags,
  { shape: 'flags-1' },
)
const runningAtom = atom({ plugin: 'agents-creator', key: 'running' } as const, {} as Record<string, string>, { shape: 'running-1' })
const usageAtom = atom({ plugin: 'agents-creator', key: 'usage' } as const, {} as Record<string, number>, { shape: 'usage-1' })
const trashAtom = atom({ plugin: 'agents-creator', key: 'trash' } as const, [] as TrashItem[], { shape: 'trash-1' })
const liveToolsAtom = atom({ plugin: 'agents-creator', key: 'liveTools' } as const, [] as LiveTool[], { shape: 'tools-1' })

export type Snapshot = {
  view: View
  filter: string
  catalog: Catalog | null
  draft: Draft | null
  stash: Draft | null
  status: Status
  gen: GenState
  test: TestState
  flags: Flags
  running: Record<string, string>
  usage: Record<string, number>
  trash: TrashItem[]
  liveTools: LiveTool[]
}

/** Tudo o que o painel desenha; chamado durante o desenho, assina o painel a cada valor. */
export async function snapshot($: Dollar): Promise<Snapshot> {
  const [view, filter, catalog, draft, stash, status, gen, test, flags, running, usage, trash, liveTools] = await Promise.all([
    read($, viewAtom),
    read($, filterAtom),
    read($, catalogAtom),
    read($, draftAtom),
    read($, stashAtom),
    read($, statusAtom),
    read($, genAtom),
    read($, testAtom),
    read($, flagsAtom),
    read($, runningAtom),
    read($, usageAtom),
    read($, trashAtom),
    read($, liveToolsAtom),
  ])
  return { view, filter, catalog, draft, stash, status, gen, test, flags, running, usage, trash, liveTools }
}

/** Pastas de agentes criadas nesta sessão: o Claude Code só passa a vigiá-las depois de reiniciar. */
const createdDirs = new Set<string>()

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

// ---------------------------------------------------------------------------
// navegação e avisos

export async function say($: Dollar, kind: StatusKind, text: string): Promise<void> {
  await update($, statusAtom, () => ({ kind, text }))
}

export async function clearStatus($: Dollar): Promise<void> {
  await update($, statusAtom, () => null)
}

export async function go($: Dollar, view: View): Promise<void> {
  await update($, viewAtom, () => view)
  await update($, flagsAtom, flags => ({ ...flags, confirm: '' }))
  try {
    await $.ui.scroll({ to: 'start', in: PANE })
  } catch {
    // painel ainda não desenhado: nada a rolar
  }
}

export async function openPane($: Dollar, focus: boolean): Promise<string> {
  const result = focus
    ? await $.ui.open({ id: PANE, title: PANE_TITLE, focus: true, columns: 64 })
    : await $.ui.open({ id: PANE, title: PANE_TITLE, columns: 64 })
  return result.isPlaced ? '' : result.reason
}

export async function setFilter($: Dollar, text: string): Promise<void> {
  await update($, filterAtom, () => text)
}

export async function setFlags($: Dollar, patch: Partial<Flags>): Promise<void> {
  await update($, flagsAtom, flags => ({ ...flags, ...patch }))
}

export async function toggleSection($: Dollar, id: string): Promise<void> {
  await update($, flagsAtom, flags => ({
    ...flags,
    toggled: flags.toggled.includes(id) ? flags.toggled.filter(item => item !== id) : [...flags.toggled, id],
  }))
}

// ---------------------------------------------------------------------------
// catálogo

export async function refresh($: Dollar): Promise<Catalog> {
  const catalog = await scanCatalog($, await $.clock.now())
  await update($, catalogAtom, () => catalog)
  await pruneRunning($)
  return catalog
}

/** Tira do "em execução" os subagentes que terminaram sem que o fim chegasse até aqui. */
async function pruneRunning($: Dollar): Promise<void> {
  const running = await read($, runningAtom)
  if (Object.keys(running).length === 0) return
  let agents
  try {
    agents = await $.agent.list()
  } catch {
    return
  }
  const live = new Set(agents.filter(agent => ['pending', 'running', 'waiting'].includes(agent.status)).map(agent => agent.id))
  const stale = Object.keys(running).filter(id => !live.has(id))
  if (stale.length === 0) return
  await update($, runningAtom, current => {
    const next = { ...current }
    for (const id of stale) delete next[id]
    return next
  })
}

async function ensureCatalog($: Dollar): Promise<Catalog> {
  return (await read($, catalogAtom)) ?? (await refresh($))
}

export async function refreshIfOpen($: Dollar): Promise<void> {
  const panes = await $.ui.panes()
  if (panes.some(pane => pane.id === PANE)) await refresh($)
}

export async function loadLiveTools($: Dollar): Promise<void> {
  try {
    const tools = await $.tool.list()
    const live = tools.map(tool => ({ name: tool.name, mcp: tool.mcp })).sort((a, b) => a.name.localeCompare(b.name))
    await update($, liveToolsAtom, () => live)
  } catch {
    // sem a lista da sessão, o editor mostra só o catálogo fixo
  }
}

export async function loadPersisted($: Dollar): Promise<void> {
  const usage = await $.store.get(STORE_USAGE).catch(() => undefined)
  if (isRecord(usage)) {
    const counts: Record<string, number> = {}
    for (const [type, count] of Object.entries(usage)) if (typeof count === 'number') counts[type] = count
    await update($, usageAtom, () => counts)
  }
  const trash = await $.store.get(STORE_TRASH).catch(() => undefined)
  if (Array.isArray(trash)) {
    const items = trash.filter(
      (item): item is TrashItem =>
        isRecord(item) && typeof item.id === 'string' && typeof item.path === 'string' && typeof item.content === 'string',
    )
    await update($, trashAtom, () => items.slice(0, TRASH_LIMIT))
  }
}

function uniqueName(name: string, catalog: Catalog | null): string {
  const taken = new Set((catalog?.agents ?? []).filter(agent => agent.scope !== 'plugin').map(agent => agent.name))
  if (!taken.has(name)) return name
  for (let i = 2; i < 100; i += 1) {
    if (!taken.has(`${name}-${i}`)) return `${name}-${i}`
  }
  return name
}

function originScope(draft: Draft): SaveScope | '' {
  if (draft.originId.startsWith('project:')) return 'project'
  if (draft.originId.startsWith('user:')) return 'user'
  return ''
}

function samePath(catalog: Catalog, a: string, b: string): boolean {
  return catalog.paths.isWindows ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** Onde o rascunho será gravado (mesma regra do salvar). */
export function targetPath(catalog: Catalog, draft: Draft, fields: AgentFields): string {
  const name = fields.name.trim().replace(/-+$/, '') || 'novo-agente'
  if (draft.mode === 'edit' && originScope(draft) === draft.scope && draft.originPath) {
    const fileName = baseName(draft.originPath)
    const isRename = name !== draft.originName && fileName.toLowerCase() === `${draft.originName.toLowerCase()}.md`
    return isRename ? joinPath(catalog.paths, dirName(draft.originPath), `${name}.md`) : draft.originPath
  }
  return joinPath(catalog.paths, scopeDir(catalog.paths, draft.scope), `${name}.md`)
}

// ---------------------------------------------------------------------------
// rascunhos

function blankDraft(fields: AgentFields, scope: SaveScope, isDirty: boolean): Draft {
  return {
    mode: 'new',
    scope,
    originId: '',
    originPath: '',
    originRaw: '',
    originName: '',
    fields,
    extra: '',
    dirty: isDirty,
    history: [],
    force: false,
    eol: '\n',
    buffers: {},
  }
}

/** Troca o rascunho; um rascunho com alterações não salvas fica guardado para "Recuperar". */
async function replaceDraft($: Dollar, next: Draft | null, back: View): Promise<void> {
  const previous = await read($, draftAtom)
  if (previous && previous.dirty) await update($, stashAtom, () => previous)
  await update($, draftAtom, () => next)
  await update($, testAtom, () => EMPTY_TEST)
  await update($, flagsAtom, flags => ({ ...flags, back, showFile: false, preview: false, confirm: '' }))
}

export async function newDraft(
  $: Dollar,
  base: AgentFields | null,
  options: { scope?: SaveScope; back?: View; note?: string } = {},
): Promise<void> {
  const previous = await read($, draftAtom)
  await replaceDraft($, blankDraft(base ?? emptyFields(), options.scope ?? 'project', base !== null), options.back ?? 'lista')
  await loadLiveTools($)
  if (previous?.dirty) await say($, 'warn', `As alterações não salvas de "${previous.fields.name || 'novo agente'}" foram guardadas.`)
  else if (options.note) await say($, 'info', options.note)
  else await clearStatus($)
  await go($, 'editor')
}

export async function useTemplate($: Dollar, id: string): Promise<void> {
  const template = TEMPLATES.find(item => item.id === id)
  if (!template) return
  const catalog = await ensureCatalog($)
  const fields = { ...template.fields, name: uniqueName(template.fields.name, catalog) }
  await newDraft($, fields, { back: 'modelos', note: `Modelo "${template.title}" carregado: ajuste o que quiser e clique em Criar agente.` })
}

export async function openAgent($: Dollar, id: string, back: View = 'lista'): Promise<void> {
  const catalog = await ensureCatalog($)
  const agent = catalog.agents.find(item => item.id === id)
  if (!agent) {
    await say($, 'error', 'Esse agente não está mais na lista; atualizei a galeria.')
    await refresh($)
    return
  }
  const text = await readText($, agent.path)
  if (text === null) {
    await say($, 'error', `Não consegui ler ${displayPath(catalog.paths, agent.path)}.`)
    await refresh($)
    return
  }
  const parsed = parseAgent(text)
  const isPlugin = agent.scope === 'plugin'
  const fields = parsed.fields.name ? parsed.fields : { ...parsed.fields, name: agent.name }
  const draft: Draft = {
    mode: isPlugin ? 'view' : 'edit',
    scope: agent.scope === 'user' ? 'user' : 'project',
    originId: agent.id,
    originPath: agent.path,
    originRaw: text,
    originName: fields.name,
    fields,
    extra: parsed.extra,
    dirty: false,
    history: [],
    force: false,
    eol: parsed.eol,
    buffers: {},
  }
  const previous = await read($, draftAtom)
  await replaceDraft($, draft, back)
  await loadLiveTools($)
  if (previous?.dirty && previous.originId !== draft.originId) {
    await say($, 'warn', `As alterações não salvas de "${previous.fields.name || 'novo agente'}" foram guardadas.`)
  } else if (isPlugin) {
    await say($, 'info', `Agente do plugin "${agent.plugin}" (somente leitura). Salve uma cópia no projeto ou no usuário para personalizar.`)
  } else if (parsed.error) {
    await say($, 'warn', parsed.error)
  } else {
    await clearStatus($)
  }
  await go($, 'editor')
}

export function findAgentId(catalog: Catalog, name: string): string {
  const wanted = name.trim().toLowerCase()
  const exact = catalog.agents.find(agent => agent.qualifiedName.toLowerCase() === wanted && !agent.shadowed)
  return (exact ?? catalog.agents.find(agent => agent.name.toLowerCase() === wanted))?.id ?? ''
}

export async function recover($: Dollar): Promise<void> {
  const stash = await read($, stashAtom)
  if (!stash) return
  const current = await read($, draftAtom)
  await update($, stashAtom, () => (current && current.dirty ? current : null))
  await update($, draftAtom, () => stash)
  await say($, 'info', `Rascunho "${stash.fields.name || 'novo agente'}" recuperado.`)
  await go($, 'editor')
}

/** Aplica uma mudança calculada a partir dos campos atuais (seguro para cliques seguidos). */
export async function editFields($: Dollar, change: (fields: AgentFields) => Partial<AgentFields>): Promise<void> {
  await update($, draftAtom, draft => (draft ? { ...draft, fields: { ...draft.fields, ...change(draft.fields) }, dirty: true } : draft))
}

export async function setField<K extends keyof AgentFields>($: Dollar, key: K, value: AgentFields[K]): Promise<void> {
  await update($, draftAtom, draft => (draft ? { ...draft, fields: { ...draft.fields, [key]: value }, dirty: true } : draft))
}

export async function setBuffer($: Dollar, key: string, value: string, fields?: Partial<AgentFields>): Promise<void> {
  await update($, draftAtom, draft =>
    draft
      ? { ...draft, buffers: { ...draft.buffers, [key]: value }, fields: { ...draft.fields, ...(fields ?? {}) }, dirty: draft.dirty || fields !== undefined }
      : draft,
  )
}

/** Acrescenta itens digitados (separados por vírgula) a uma lista de ferramentas e limpa o campo. */
export async function addToList($: Dollar, key: 'tools' | 'disallowedTools', buffer: string, value: string): Promise<void> {
  const items = splitList(value)
  await update($, draftAtom, draft => {
    if (!draft) return draft
    const current = key === 'tools' ? (draft.fields.tools ?? []) : draft.fields.disallowedTools
    const merged = [...current, ...items.filter(item => !current.includes(item))]
    return {
      ...draft,
      fields: { ...draft.fields, [key]: merged },
      buffers: { ...draft.buffers, [buffer]: '' },
      dirty: draft.dirty || items.length > 0,
    }
  })
}

export async function patchDraft($: Dollar, patch: Partial<Draft>): Promise<void> {
  await update($, draftAtom, draft => (draft ? { ...draft, ...patch } : draft))
}

export async function setNameInput($: Dollar, value: string): Promise<void> {
  await update($, draftAtom, draft =>
    draft ? { ...draft, fields: { ...draft.fields, name: draft.mode === 'new' ? liveSlug(value) : value }, dirty: true } : draft,
  )
}

export async function revert($: Dollar): Promise<void> {
  const draft = await read($, draftAtom)
  if (!draft) return
  if (draft.mode === 'new') {
    await update($, draftAtom, () => null)
    await clearStatus($)
    const flags = await read($, flagsAtom)
    await go($, (flags.back as View) || 'lista')
    return
  }
  await update($, draftAtom, () => null)
  await openAgent($, draft.originId, ((await read($, flagsAtom)).back as View) || 'lista')
  await say($, 'info', 'Alterações descartadas.')
}

export async function back($: Dollar): Promise<void> {
  const flags = await read($, flagsAtom)
  const target = (flags.back as View) || 'lista'
  await go($, target === 'editor' ? 'lista' : target)
}

// ---------------------------------------------------------------------------
// gravar, duplicar, excluir, restaurar

export async function save($: Dollar): Promise<boolean> {
  const draft = await read($, draftAtom)
  if (!draft) return false
  const catalog = await ensureCatalog($)
  const fields = finalize(draft.fields)
  const isEdit = draft.mode === 'edit'
  const issues = validate(fields, { scope: draft.scope, selfPath: isEdit ? draft.originPath : '', others: catalog.agents })
  const errors = issues.filter(issue => issue.level === 'error')
  if (errors.length > 0) {
    await say($, 'error', `Corrija antes de salvar: ${errors.map(issue => issue.text).join(' ')}`)
    return false
  }

  const target = targetPath(catalog, draft, fields)
  const isSameFile = isEdit && samePath(catalog, target, draft.originPath)
  if (!isSameFile && (await $.fs.exists(target))) {
    await say($, 'error', `Já existe ${displayPath(catalog.paths, target)}. Escolha outro nome ou outro local.`)
    return false
  }
  if (isEdit && !draft.force) {
    const current = await readText($, draft.originPath)
    if (current !== null && current !== draft.originRaw) {
      await setFlags($, { confirm: 'overwrite' })
      await say($, 'warn', 'O arquivo foi alterado fora do estúdio depois que você o abriu.')
      return false
    }
  }

  const text = toMarkdown(fields, draft.extra, isEdit ? draft.originRaw : null, draft.eol)
  const folder = dirName(target)
  const isNewFolder = createdDirs.has(folder) || !(await $.fs.exists(folder))
  try {
    await $.fs.write(target, text)
  } catch (error) {
    await say($, 'error', `Não consegui gravar ${displayPath(catalog.paths, target)}: ${message(error)}`)
    return false
  }
  if (isNewFolder) createdDirs.add(folder)

  let leftover = ''
  if (isEdit && !isSameFile) {
    try {
      await removeFile($, catalog.paths, draft.originPath)
    } catch (error) {
      leftover = ` O arquivo antigo continua em ${displayPath(catalog.paths, draft.originPath)} (${message(error)}).`
    }
  }

  const fresh = await refresh($)
  const saved = fresh.agents.find(agent => samePath(fresh, agent.path, target))
  await update($, draftAtom, () => ({
    ...draft,
    mode: 'edit' as const,
    originId: saved?.id ?? `${draft.scope}:${baseName(target)}`,
    originPath: target,
    originRaw: text,
    originName: fields.name,
    fields,
    dirty: false,
    force: false,
    buffers: {},
  }))
  await setFlags($, { confirm: '' })
  const note = isNewFolder
    ? ' A pasta de agentes foi criada agora: reinicie a sessão para o Claude Code carregá-lo (ou use "Testar agora").'
    : ' O Claude Code já pode delegar a ele.'
  await say($, 'ok', `Salvo em ${displayPath(fresh.paths, target)}.${note}${leftover}`)
  return true
}

export async function overwrite($: Dollar): Promise<void> {
  await patchDraft($, { force: true })
  await save($)
}

export async function saveCopy($: Dollar, scope: SaveScope): Promise<void> {
  const catalog = await ensureCatalog($)
  await update($, draftAtom, draft =>
    draft
      ? {
          ...draft,
          mode: 'new' as const,
          scope,
          originId: '',
          originPath: '',
          originRaw: '',
          originName: '',
          fields: { ...draft.fields, name: uniqueName(draft.fields.name.split(':').pop() ?? draft.fields.name, catalog) },
        }
      : draft,
  )
  await save($)
}

export async function duplicate($: Dollar): Promise<void> {
  const draft = await read($, draftAtom)
  if (!draft) return
  const catalog = await ensureCatalog($)
  const name = uniqueName(`${finalSlug(draft.fields.name) || 'agente'}-copia`, catalog)
  await update($, draftAtom, () => ({
    ...draft,
    mode: 'new' as const,
    scope: draft.mode === 'view' ? ('project' as const) : draft.scope,
    originId: '',
    originPath: '',
    originRaw: '',
    originName: '',
    fields: { ...draft.fields, name },
    dirty: true,
    history: [],
    force: false,
    buffers: {},
  }))
  await say($, 'info', `Cópia criada como "${name}": ainda não foi salva.`)
  await go($, 'editor')
}

export async function deleteCurrent($: Dollar): Promise<void> {
  const draft = await read($, draftAtom)
  if (!draft || draft.mode !== 'edit') return
  const catalog = await ensureCatalog($)
  const content = (await readText($, draft.originPath)) ?? draft.originRaw
  const now = await $.clock.now()
  const item: TrashItem = {
    id: String(now),
    name: draft.originName || draft.fields.name,
    scope: originScope(draft) || draft.scope,
    path: draft.originPath,
    content,
    deletedAt: now,
  }
  try {
    await removeFile($, catalog.paths, draft.originPath)
  } catch (error) {
    await setFlags($, { confirm: '' })
    await say($, 'error', `Não consegui excluir: ${message(error)}`)
    return
  }
  const trash = [item, ...(await read($, trashAtom))].slice(0, TRASH_LIMIT)
  await update($, trashAtom, () => trash)
  await $.store.set(STORE_TRASH, trash).catch(() => undefined)
  await update($, draftAtom, () => null)
  await refresh($)
  await go($, 'lista')
  await say($, 'ok', `"${item.name}" foi para a lixeira do estúdio. Dá para restaurar em Lixeira.`)
}

export async function restore($: Dollar, id: string): Promise<void> {
  const trash = await read($, trashAtom)
  const item = trash.find(entry => entry.id === id)
  if (!item) return
  const catalog = await ensureCatalog($)
  if (await $.fs.exists(item.path)) {
    await say($, 'error', `Já existe um arquivo em ${displayPath(catalog.paths, item.path)}. Renomeie ou exclua o atual antes.`)
    return
  }
  try {
    await $.fs.write(item.path, item.content)
  } catch (error) {
    await say($, 'error', `Não consegui restaurar: ${message(error)}`)
    return
  }
  const rest = trash.filter(entry => entry.id !== id)
  await update($, trashAtom, () => rest)
  await $.store.set(STORE_TRASH, rest).catch(() => undefined)
  await refresh($)
  await say($, 'ok', `"${item.name}" restaurado em ${displayPath(catalog.paths, item.path)}.`)
}

export async function forget($: Dollar, id: string): Promise<void> {
  const rest = (await read($, trashAtom)).filter(entry => entry.id !== id)
  await update($, trashAtom, () => rest)
  await $.store.set(STORE_TRASH, rest).catch(() => undefined)
  await say($, 'info', 'Removido da lixeira.')
}

/** Põe itens no começo da lixeira (os mais novos primeiro), respeita o limite e grava. */
export async function pushTrash($: Dollar, items: readonly TrashItem[]): Promise<void> {
  const trash = [...items, ...(await read($, trashAtom))].slice(0, TRASH_LIMIT)
  await update($, trashAtom, () => trash)
  await $.store.set(STORE_TRASH, trash).catch(() => undefined)
}

export async function setMainAgent($: Dollar, name: string): Promise<void> {
  const catalog = await ensureCatalog($)
  try {
    await writeMainAgent($, catalog.paths, name)
  } catch (error) {
    await say($, 'error', `Não consegui gravar .claude/settings.local.json: ${message(error)}`)
    return
  }
  await refresh($)
  await update($, catalogAtom, current => (current ? { ...current, mainAgent: name } : current))
  await say(
    $,
    'ok',
    name
      ? `Agente principal deste projeto: "${name}" (em .claude/settings.local.json). Vale para as próximas sessões.`
      : 'O projeto voltou a usar o Claude padrão como agente principal (nas próximas sessões).',
  )
}

// ---------------------------------------------------------------------------
// IA

export async function setGen($: Dollar, patch: Partial<{ request: string; scope: SaveScope; error: string }>): Promise<void> {
  await update($, genAtom, gen => ({ ...gen, ...patch }))
}

export async function generate($: Dollar): Promise<void> {
  const gen = await read($, genAtom)
  const request = gen.request.trim()
  if (gen.busy) return
  if (!request) {
    await setGen($, { error: 'Descreva o agente que você quer criar.' })
    return
  }
  await update($, genAtom, current => ({ ...current, busy: true, error: '' }))
  await clearStatus($)
  const catalog = await ensureCatalog($)
  await loadLiveTools($)
  const tools = (await read($, liveToolsAtom)).filter(tool => !tool.mcp).map(tool => tool.name)
  const { system, prompt } = generationPrompt(request, catalog.agents.map(agent => agent.name), tools)
  const { text, error } = await complete($, { system, prompt, maxTokens: 6000 })
  const data = text ? extractJson(text) : null
  if (!data) {
    await update($, genAtom, current => ({
      ...current,
      busy: false,
      error: error ? `Não deu para gerar: ${error}.` : 'A resposta do modelo não veio no formato esperado. Tente de novo.',
    }))
    return
  }
  const fields = fieldsFromJson(data)
  fields.name = uniqueName(fields.name || 'novo-agente', catalog)
  await update($, genAtom, current => ({ ...current, busy: false, error: '' }))
  await newDraft($, fields, {
    scope: gen.scope,
    back: 'gerar',
    note: 'Rascunho gerado pelo Claude: revise os campos e clique em Criar agente.',
  })
}

export async function improve($: Dollar): Promise<void> {
  const draft = await read($, draftAtom)
  const flags = await read($, flagsAtom)
  if (!draft || flags.improving) return
  await setFlags($, { improving: true })
  const { system, prompt } = improvementPrompt(draft.fields)
  const { text, error } = await complete($, { system, prompt, maxTokens: 6000 })
  await setFlags($, { improving: false })
  const data = text ? extractJson(text) : null
  const description = data && typeof data.description === 'string' ? data.description.trim() : ''
  const improved = data && typeof data.prompt === 'string' ? data.prompt.trim() : ''
  const notes = data && typeof data.notes === 'string' ? data.notes.trim() : ''
  if (!description && !improved) {
    await say($, 'error', error ? `Não deu para melhorar: ${error}.` : 'O modelo não sugeriu mudanças.')
    return
  }
  await update($, draftAtom, current =>
    current
      ? {
          ...current,
          history: [...current.history, current.fields].slice(-10),
          fields: {
            ...current.fields,
            ...(description ? { description } : {}),
            ...(improved ? { prompt: improved } : {}),
          },
          dirty: true,
        }
      : current,
  )
  await say($, 'ok', `Descrição e prompt melhorados${notes ? `: ${notes}` : '.'} Use "Desfazer" para voltar à versão anterior.`)
}

export async function undo($: Dollar): Promise<void> {
  await update($, draftAtom, draft => {
    if (!draft || draft.history.length === 0) return draft
    const previous = draft.history[draft.history.length - 1] ?? draft.fields
    return { ...draft, fields: previous, history: draft.history.slice(0, -1), dirty: true }
  })
  await say($, 'info', 'Versão anterior restaurada.')
}

export const PROMPT_SKELETON = `Você é um especialista em <área>.

## Quando agir
- <situações em que este agente é chamado>

## Processo
1. <primeiro passo>
2. <segundo passo>
3. <como verificar o resultado>

## Regras
- <o que sempre fazer>
- <o que nunca fazer>

## Formato da resposta
<como o resultado deve ser entregue>

## Dúvidas
- ${REGRA_POPUP_GERAL}`

// ---------------------------------------------------------------------------
// teste ao vivo e subagentes em execução

export async function setTest($: Dollar, patch: Partial<TestState>): Promise<void> {
  await update($, testAtom, test => ({ ...test, ...patch }))
}

export async function runTest($: Dollar): Promise<void> {
  const draft = await read($, draftAtom)
  const test = await read($, testAtom)
  if (!draft || test.busy) return
  const task = test.task.trim()
  if (!task) {
    await setTest($, { error: 'Escreva uma tarefa para o agente executar.' })
    return
  }
  const fields = finalize(draft.fields)
  const name = finalSlug(fields.name.split(':').pop() ?? fields.name) || 'rascunho'
  const type = `agents-creator:${name}`
  await setTest($, { busy: true, error: '', answer: '', agentId: '', agent: type })
  try {
    const spec = agentSpec(fields, name) as unknown as Parameters<Dollar['agent']['register']>[0]
    await $.agent.register(spec)
    const spawned = await $.agent.spawn({ subagentType: type, prompt: task, description: `Teste do agente ${name}` })
    if (spawned.deny !== undefined) throw new Error(spawned.deny)
    if (spawned.agentId) {
      await setTest($, { agentId: spawned.agentId })
    } else {
      // Sem o id não dá para casar a resposta: ela aparece só na conversa.
      await setTest($, { busy: false, answer: '', error: '' })
      await say($, 'info', `O teste de ${type} começou; acompanhe a resposta na conversa.`)
    }
  } catch (error) {
    await setTest($, { busy: false, error: `Não deu para testar: ${message(error)}` })
  }
}

export async function trackSpawn($: Dollar, agentId: string, type: string): Promise<void> {
  await update($, runningAtom, running => ({ ...running, [agentId]: type }))
  await update($, usageAtom, usage => ({ ...usage, [type]: (usage[type] ?? 0) + 1 }))
  await $.store.set(STORE_USAGE, await read($, usageAtom)).catch(() => undefined)
}

export async function trackEnd($: Dollar, agentId: string, answer: string): Promise<void> {
  const running = await read($, runningAtom)
  if (running[agentId] !== undefined) {
    await update($, runningAtom, current => {
      const next = { ...current }
      delete next[agentId]
      return next
    })
  }
  const test = await read($, testAtom)
  if (test.agentId === agentId) {
    await setTest($, { busy: false, answer: answer.trim() || '(o agente terminou sem texto de resposta)' })
  }
}

// ---------------------------------------------------------------------------
// entradas: /agentes e a ferramenta do modelo

const GENERATE_WORDS = new Set(['gerar', 'gere', 'gera', 'ia', 'ai', 'generate'])
const NEW_WORDS = new Set(['novo', 'nova', 'new', 'criar', 'crie'])
const VIEW_WORDS: Record<string, View> = {
  lista: 'lista',
  galeria: 'lista',
  agentes: 'lista',
  modelos: 'modelos',
  templates: 'modelos',
  mapa: 'mapa',
  map: 'mapa',
  lixeira: 'lixeira',
  trash: 'lixeira',
  estruturas: 'estruturas',
  equipes: 'estruturas',
}

/** `/agentes [novo | gerar <pedido> | modelos | estruturas | mapa | lixeira | <nome>]`. */
export async function openStudio($: Dollar, args: string): Promise<string> {
  const catalog = await refresh($)
  const text = args.trim()
  const [head = '', ...rest] = text.split(/\s+/)
  const word = head.toLowerCase()
  const tail = rest.join(' ').trim()
  let summary = 'Estúdio de Agentes aberto.'

  if (!text) {
    // Sem argumentos: volta para onde o usuário estava.
  } else if (NEW_WORDS.has(word)) {
    await newDraft($, tail ? { ...emptyFields(), name: finalSlug(tail) } : null)
    summary = 'Estúdio de Agentes aberto num agente novo.'
  } else if (GENERATE_WORDS.has(word)) {
    if (tail) await setGen($, { request: tail, error: '' })
    await go($, 'gerar')
    if (tail) {
      $.clock.after(1, () => void generate($))
      summary = 'Gerando o agente no Estúdio de Agentes; o rascunho abre no editor para revisão.'
    }
  } else if (VIEW_WORDS[word]) {
    await go($, VIEW_WORDS[word] ?? 'lista')
  } else {
    const id = findAgentId(catalog, text)
    if (id) {
      await openAgent($, id)
      summary = `Agente "${text}" aberto no Estúdio de Agentes.`
    } else {
      await setFilter($, text)
      await go($, 'lista')
      await say($, 'info', `Nenhum agente chamado "${text}"; mostrando a busca.`)
    }
  }
  const unplaced = await openPane($, true)
  return unplaced ? `${summary} (Esta tela não mostra painéis agora: ${unplaced}.)` : summary
}

/** Ferramenta `open_agents_studio`: o Claude abre o painel, com ou sem um rascunho. */
export async function openFromTool($: Dollar, input: Record<string, unknown>): Promise<string> {
  const catalog = await refresh($)
  const draftInput = input.draft
  if (isRecord(draftInput)) {
    const fields = fieldsFromJson(draftInput)
    fields.name = uniqueName(fields.name || 'novo-agente', catalog)
    const scope: SaveScope = draftInput.scope === 'user' ? 'user' : 'project'
    await newDraft($, fields, { scope, note: 'Rascunho sugerido pelo Claude: revise os campos e clique em Criar agente.' })
    const unplaced = await openPane($, true)
    const where = scope === 'user' ? '~/.claude/agents' : '.claude/agents'
    return [
      `O Estúdio de Agentes foi aberto com o rascunho "${fields.name}" (destino: ${where}).`,
      'Nada foi gravado ainda: o usuário revisa e salva pelo painel. Não crie o arquivo você mesmo.',
      unplaced ? `Atenção: a tela atual não mostra painéis (${unplaced}).` : '',
    ]
      .filter(Boolean)
      .join(' ')
  }
  if (typeof input.agent === 'string' && input.agent.trim()) {
    const id = findAgentId(catalog, input.agent)
    if (!id) return `Não existe agente chamado "${input.agent}". Agentes disponíveis: ${catalog.agents.map(agent => agent.qualifiedName).join(', ') || 'nenhum'}.`
    await openAgent($, id)
    await openPane($, true)
    return `Agente "${input.agent}" aberto no editor do Estúdio de Agentes.`
  }
  const view = typeof input.view === 'string' ? VIEW_WORDS[input.view] : undefined
  if (view) await go($, view)
  await openPane($, true)
  return 'Estúdio de Agentes aberto.'
}
