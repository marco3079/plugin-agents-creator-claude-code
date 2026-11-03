// Arquivos de agentes: onde ficam, varredura das pastas, gravação, remoção e o agente principal.

import type { EngineInterface } from 'claude-code'

import type { AgentSummary, Catalog, Paths, SaveScope, Scope } from '../../types'
import { parseAgent } from './agent'

type Dollar = EngineInterface

const MAX_DEPTH = 4

// ---------------------------------------------------------------------------
// caminhos

export function joinPath(paths: Pick<Paths, 'isWindows'>, ...parts: string[]): string {
  const sep = paths.isWindows ? '\\' : '/'
  const cleaned = parts
    .filter(part => part !== '')
    .map((part, i) => {
      const normalized = paths.isWindows ? part.replace(/\//g, '\\') : part
      return i === 0 ? normalized.replace(/[\\/]+$/, '') : normalized.replace(/^[\\/]+|[\\/]+$/g, '')
    })
  return cleaned.join(sep)
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

export function dirName(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut < 0 ? '' : path.slice(0, cut)
}

/** Caminho curto para exibir: `~` no lugar da home, relativo ao projeto quando possível. */
export function displayPath(paths: Paths, path: string): string {
  const same = (a: string, b: string): boolean => (paths.isWindows ? a.toLowerCase() === b.toLowerCase() : a === b)
  const under = (root: string): boolean => path.length > root.length && same(path.slice(0, root.length), root)
  if (under(paths.root)) return path.slice(paths.root.length + 1).replace(/\\/g, '/')
  const home = dirName(paths.configDir)
  if (home && under(home)) return `~/${path.slice(home.length + 1).replace(/\\/g, '/')}`
  return path
}

export async function resolvePaths($: Dollar): Promise<Paths> {
  const root = await $.session.root()
  const isWindows = /^[A-Za-z]:[\\/]/.test(root) || root.startsWith('\\\\')
  const configured = await $.env.get('CLAUDE_CONFIG_DIR')
  const userProfile = await $.env.get('USERPROFILE')
  const homeVar = await $.env.get('HOME')
  const home = (isWindows ? (userProfile ?? homeVar) : (homeVar ?? userProfile)) ?? ''
  const base = { isWindows }
  const configDir = configured ? configured : joinPath(base, home, '.claude')
  return {
    root,
    isWindows,
    configDir,
    projectDir: joinPath(base, root, '.claude', 'agents'),
    userDir: joinPath(base, configDir, 'agents'),
  }
}

export function scopeDir(paths: Paths, scope: SaveScope): string {
  return scope === 'project' ? paths.projectDir : paths.userDir
}

// ---------------------------------------------------------------------------
// varredura

type FoundFile = { path: string; relPath: string; mtimeMs: number }

async function listMarkdown($: Dollar, paths: Paths, dir: string, prefix = '', depth = 0): Promise<FoundFile[]> {
  let entries
  try {
    entries = await $.fs.list(dir)
  } catch {
    return []
  }
  const found: FoundFile[] = []
  for (const entry of entries) {
    const path = joinPath(paths, dir, entry.name)
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
    let kind: string = entry.kind
    let mtimeMs = entry.mtimeMs
    if (entry.kind === 'other' && entry.isLink) {
      const stat = await $.fs.stat(path).catch(() => null)
      kind = stat?.kind ?? 'other'
      mtimeMs = stat?.mtimeMs ?? 0
    }
    if (kind === 'file' && entry.name.toLowerCase().endsWith('.md')) {
      found.push({ path, relPath, mtimeMs })
    } else if (kind === 'dir' && depth < MAX_DEPTH && !entry.name.startsWith('.')) {
      found.push(...(await listMarkdown($, paths, path, relPath, depth + 1)))
    }
  }
  return found.sort((a, b) => a.relPath.localeCompare(b.relPath))
}

async function summarize(
  $: Dollar,
  file: FoundFile,
  scope: Scope,
  plugin: string,
): Promise<AgentSummary> {
  let text = ''
  let readError = ''
  try {
    text = await $.fs.read(file.path)
  } catch (error) {
    readError = `Não foi possível ler o arquivo: ${String(error)}`
  }
  const parsed = parseAgent(text)
  const fields = parsed.fields
  const fallbackName = baseName(file.relPath).replace(/\.md$/i, '')
  const name = fields.name || fallbackName
  const folders = file.relPath.split('/').slice(0, -1)
  const qualifiedName = plugin ? [plugin, ...folders, name].join(':') : name
  let error = readError || parsed.error
  if (!error && !fields.name) error = 'Falta o campo obrigatório "name".'
  if (!error && !fields.description) error = 'Falta o campo obrigatório "description".'
  return {
    id: `${scope}:${plugin ? `${plugin}/` : ''}${file.relPath}`,
    scope,
    path: file.path,
    relPath: file.relPath,
    plugin,
    name,
    qualifiedName,
    description: fields.description,
    color: fields.color,
    model: fields.model,
    tools: fields.tools,
    disallowedTools: fields.disallowedTools,
    permissionMode: fields.permissionMode,
    promptLength: fields.prompt.length,
    mtimeMs: file.mtimeMs,
    error,
    shadowed: false,
  }
}

type InstalledPlugins = {
  plugins?: Record<string, readonly { scope?: string; installPath?: string; projectPath?: string }[]>
}

/** Pastas `agents/` dos plugins instalados e habilitados. */
async function pluginAgentDirs($: Dollar, paths: Paths): Promise<{ plugin: string; dir: string }[]> {
  let installed: InstalledPlugins
  try {
    installed = JSON.parse(await $.fs.read(joinPath(paths, paths.configDir, 'plugins', 'installed_plugins.json')))
  } catch {
    return []
  }
  let enabled: Record<string, unknown> | null = null
  try {
    const value = await $.settings.read({ key: 'enabledPlugins' })
    if (value && typeof value === 'object') enabled = value as Record<string, unknown>
  } catch {
    enabled = null
  }
  const dirs: { plugin: string; dir: string }[] = []
  for (const [key, installs] of Object.entries(installed.plugins ?? {})) {
    if (enabled && enabled[key] !== true) continue
    const plugin = key.split('@')[0] ?? key
    if (plugin === 'agents-creator') continue
    const install =
      installs.find(item => item.scope === 'project' && item.projectPath === paths.root) ??
      installs.find(item => item.scope !== 'project') ??
      installs[0]
    if (install?.installPath) dirs.push({ plugin, dir: joinPath(paths, install.installPath, 'agents') })
  }
  return dirs
}

export async function readMainAgent($: Dollar): Promise<string> {
  try {
    const value = await $.settings.read({ key: 'agent' })
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}

export async function scanCatalog($: Dollar, now: number): Promise<Catalog> {
  const paths = await resolvePaths($)
  const agents: AgentSummary[] = []
  for (const file of await listMarkdown($, paths, paths.projectDir)) agents.push(await summarize($, file, 'project', ''))
  for (const file of await listMarkdown($, paths, paths.userDir)) agents.push(await summarize($, file, 'user', ''))
  for (const { plugin, dir } of await pluginAgentDirs($, paths)) {
    for (const file of await listMarkdown($, paths, dir)) agents.push(await summarize($, file, 'plugin', plugin))
  }
  // O projeto tem prioridade sobre o usuário quando os nomes coincidem.
  const projectNames = new Set(agents.filter(agent => agent.scope === 'project').map(agent => agent.name))
  for (const agent of agents) {
    if (agent.scope === 'user' && projectNames.has(agent.name)) agent.shadowed = true
  }
  return { paths, agents, mainAgent: await readMainAgent($), scannedAt: now }
}

// ---------------------------------------------------------------------------
// gravação e remoção

export async function readText($: Dollar, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

/**
 * Remove um arquivo. `$.fs` não apaga, então usa um processo: no Windows o caminho vai por
 * variável de ambiente, para nenhum caractere do caminho ser interpretado por um shell.
 */
export async function removeFile($: Dollar, paths: Paths, path: string): Promise<void> {
  if (paths.isWindows) {
    await $.process.run(
      ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', 'Remove-Item -LiteralPath $env:AGENTS_CREATOR_ALVO -Force'],
      { env: { AGENTS_CREATOR_ALVO: path }, timeoutMs: 30000 },
    )
  } else {
    await $.process.run(['rm', '-f', '--', path], { timeoutMs: 30000 })
  }
  if (await $.fs.exists(path)) throw new Error(`não foi possível remover ${path}`)
}

/**
 * Grava (ou apaga) a configuração `agent` em `.claude/settings.local.json`: vale só para este
 * usuário neste projeto e não entra no git, ao contrário de `.claude/settings.json`.
 */
export async function writeMainAgent($: Dollar, paths: Paths, name: string): Promise<void> {
  const file = joinPath(paths, paths.root, '.claude', 'settings.local.json')
  const current = await readText($, file)
  let settings: Record<string, unknown> = {}
  if (current !== null && current.trim() !== '') {
    const parsed: unknown = JSON.parse(current)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('o arquivo não contém um objeto JSON')
    settings = parsed as Record<string, unknown>
  }
  if (name) settings.agent = name
  else delete settings.agent
  await $.fs.write(file, `${JSON.stringify(settings, null, 2)}\n`)
}
