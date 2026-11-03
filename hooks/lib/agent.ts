// Modelo de um agente: arquivo .md <-> campos do editor, validação e utilitários de ferramentas.

import type { AgentFields, SaveScope } from '../../types'
import { type Entry, type Value, formatScalar, isBlockSafe, isPlainSafe, splitDocument } from './yaml'

/** Ordem canônica dos campos que o editor conhece. */
export const FIELD_ORDER = [
  'name',
  'description',
  'tools',
  'disallowedTools',
  'model',
  'color',
  'effort',
  'permissionMode',
  'maxTurns',
  'memory',
  'background',
  'isolation',
  'omitClaudeMd',
  'skills',
  'initialPrompt',
] as const

type FieldKey = (typeof FIELD_ORDER)[number]

const KNOWN = new Set<string>(FIELD_ORDER)

export function emptyFields(): AgentFields {
  return {
    name: '',
    description: '',
    prompt: '',
    tools: null,
    disallowedTools: [],
    model: '',
    color: '',
    effort: '',
    permissionMode: '',
    maxTurns: '',
    memory: '',
    background: false,
    isolation: '',
    omitClaudeMd: false,
    skills: [],
    initialPrompt: '',
  }
}

// ---------------------------------------------------------------------------
// leitura

export type ParsedAgent = {
  fields: AgentFields
  /** YAML das chaves desconhecidas ou complexas, na ordem original. */
  extra: string
  error: string
  eol: '\n' | '\r\n'
  /** Estilo original de cada chave, para regravar no mesmo estilo. */
  styles: Record<string, string>
}

export function parseAgent(text: string): ParsedAgent {
  const doc = splitDocument(text)
  const fields = emptyFields()
  const extra: string[] = []
  const styles: Record<string, string> = {}
  for (const entry of doc.entries) {
    if (!KNOWN.has(entry.key) || entry.value.kind === 'complex') {
      extra.push(...entry.raw)
      continue
    }
    applyEntry(fields, entry.key as FieldKey, entry.value)
    styles[entry.key] = entry.value.style
  }
  fields.prompt = doc.body.replace(/^\s*\n/, '').replace(/\s+$/, '')
  const error = doc.error || (doc.hasFrontmatter ? '' : 'O arquivo não começa com um frontmatter (---).')
  return { fields, extra: trimBlankEdges(extra).join('\n'), error, eol: doc.eol, styles }
}

function applyEntry(fields: AgentFields, key: FieldKey, value: Value): void {
  const text = value.kind === 'scalar' ? value.text : value.kind === 'list' ? value.items.join(', ') : ''
  const list = value.kind === 'list' ? value.items : splitList(text)
  switch (key) {
    case 'name':
      fields.name = text.trim()
      break
    case 'description':
      fields.description = text.trim()
      break
    case 'tools':
      // `tools:` vazio (nulo) equivale a omitir o campo; `tools: []` é "nenhuma ferramenta".
      fields.tools = value.kind === 'scalar' && text.trim() === '' ? null : list
      break
    case 'disallowedTools':
      fields.disallowedTools = list
      break
    case 'skills':
      fields.skills = list
      break
    case 'background':
      fields.background = isTrue(text)
      break
    case 'omitClaudeMd':
      fields.omitClaudeMd = isTrue(text)
      break
    case 'maxTurns':
      fields.maxTurns = text.trim()
      break
    case 'model':
      fields.model = text.trim()
      break
    case 'color':
      fields.color = text.trim()
      break
    case 'effort':
      fields.effort = text.trim()
      break
    case 'permissionMode':
      fields.permissionMode = text.trim()
      break
    case 'memory':
      fields.memory = text.trim()
      break
    case 'isolation':
      fields.isolation = text.trim()
      break
    case 'initialPrompt':
      fields.initialPrompt = text
      break
  }
}

function isTrue(text: string): boolean {
  return /^(true|yes|on)$/i.test(text.trim())
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && (lines[start] ?? '').trim() === '') start += 1
  while (end > start && (lines[end - 1] ?? '').trim() === '') end -= 1
  return lines.slice(start, end)
}

// ---------------------------------------------------------------------------
// escrita

/**
 * Monta o arquivo .md. Com `original`, mantém a ordem das chaves e o texto exato
 * de tudo que não mudou, para o diff mostrar só o que o usuário editou.
 */
export function toMarkdown(fields: AgentFields, extra: string, original: string | null, eol: string): string {
  const extraText = extra.replace(/\s+$/, '')
  const lines: string[] = []
  const done = new Set<string>()
  const doc = original === null ? null : splitDocument(original)

  if (doc && doc.hasFrontmatter && original !== null) {
    const before = parseAgent(original)
    const isExtraSame = normalize(before.extra) === normalize(extraText)
    for (const entry of doc.entries) {
      if (KNOWN.has(entry.key) && entry.value.kind !== 'complex') {
        const key = entry.key as FieldKey
        if (done.has(key)) continue
        done.add(key)
        const fresh = emit(key, fields, before.styles[key] === 'block')
        if (!fresh) continue
        lines.push(...(isSameField(key, before.fields, fields) ? entry.raw : fresh))
      } else if (isExtraSame) {
        lines.push(...entry.raw)
      }
    }
    for (const key of FIELD_ORDER) {
      if (done.has(key)) continue
      const fresh = emit(key, fields, false)
      if (fresh) lines.push(...fresh)
    }
    if (!isExtraSame && extraText) lines.push(...extraText.split('\n'))
  } else {
    for (const key of FIELD_ORDER) {
      const fresh = emit(key, fields, false)
      if (fresh) lines.push(...fresh)
    }
    if (extraText) lines.push(...extraText.split('\n'))
  }

  while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') lines.pop()
  const prompt = fields.prompt.replace(/\s+$/, '')
  const text = `---\n${lines.join('\n')}\n---\n${prompt ? `\n${prompt}\n` : ''}`
  return eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text
}

function normalize(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\s+$/, '')
}

function emit(key: FieldKey, fields: AgentFields, preferBlock: boolean): string[] | null {
  switch (key) {
    case 'name':
      return [`name: ${formatScalar(fields.name)}`]
    case 'description':
      return textLines('description', fields.description, preferBlock)
    case 'tools':
      return fields.tools === null ? null : [`tools: ${formatList(fields.tools)}`]
    case 'disallowedTools':
      return fields.disallowedTools.length > 0 ? [`disallowedTools: ${formatList(fields.disallowedTools)}`] : null
    case 'skills':
      return fields.skills.length > 0 ? ['skills:', ...fields.skills.map(skill => `  - ${formatScalar(skill)}`)] : null
    case 'background':
      return fields.background ? ['background: true'] : null
    case 'omitClaudeMd':
      return fields.omitClaudeMd ? ['omitClaudeMd: true'] : null
    case 'maxTurns': {
      const turns = fields.maxTurns.trim()
      if (!turns) return null
      return [`maxTurns: ${/^\d+$/.test(turns) ? turns : formatScalar(turns)}`]
    }
    case 'initialPrompt':
      return fields.initialPrompt.trim() ? textLines('initialPrompt', fields.initialPrompt, preferBlock) : null
    case 'model':
    case 'color':
    case 'effort':
    case 'permissionMode':
    case 'memory':
    case 'isolation': {
      const value = fields[key].trim()
      return value ? [`${key}: ${formatScalar(value)}`] : null
    }
  }
}

function textLines(key: string, text: string, preferBlock: boolean): string[] {
  if (preferBlock && isBlockSafe(text)) {
    return [`${key}: |-`, ...text.split('\n').map(line => (line === '' ? '' : `  ${line}`))]
  }
  return [`${key}: ${formatScalar(text)}`]
}

function formatList(items: readonly string[]): string {
  if (items.length === 0) return '[]'
  const joined = items.join(', ')
  return isPlainSafe(joined) ? joined : JSON.stringify(joined)
}

function isSameField(key: FieldKey, a: AgentFields, b: AgentFields): boolean {
  const left = a[key]
  const right = b[key]
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, i) => item === right[i])
  }
  return left === right
}

// ---------------------------------------------------------------------------
// ferramentas

/** Separa por vírgulas fora de parênteses: `Agent(a, b), Read` -> [`Agent(a, b)`, `Read`]. */
export function splitList(text: string): string[] {
  const items: string[] = []
  let depth = 0
  let current = ''
  for (const char of text) {
    if (char === '(' || char === '[') depth += 1
    if (char === ')' || char === ']') depth = Math.max(0, depth - 1)
    if (char === ',' && depth === 0) {
      items.push(current)
      current = ''
      continue
    }
    current += char
  }
  items.push(current)
  return items.map(item => item.trim().replace(/^["']|["']$/g, '')).filter(item => item !== '')
}

/** Nome base de uma entrada de ferramenta: `Bash(git *)` -> `Bash`. */
export function toolBase(tool: string): string {
  const paren = tool.indexOf('(')
  return (paren < 0 ? tool : tool.slice(0, paren)).trim()
}

export function hasTool(tools: readonly string[] | null, name: string): boolean {
  if (tools === null) return false
  return tools.some(tool => toolBase(tool) === name || (name === 'Agent' && toolBase(tool) === 'Task'))
}

export function toggleTool(tools: readonly string[], name: string): string[] {
  if (hasTool(tools, name)) {
    return tools.filter(tool => toolBase(tool) !== name && !(name === 'Agent' && toolBase(tool) === 'Task'))
  }
  return [...tools, name]
}

export type AgentRefs = {
  /** O agente pode chamar a ferramenta Agent. */
  has: boolean
  /** A lista entre parênteses restringe quais subagentes ele chama. */
  restricted: boolean
  allowed: string[]
}

/** Lê `Agent(a, b)` (ou o alias `Task(...)`) da lista de ferramentas. */
export function agentRefs(tools: readonly string[] | null): AgentRefs {
  if (tools === null) return { has: true, restricted: false, allowed: [] }
  for (const tool of tools) {
    const match = /^(Agent|Task)\s*(\((.*)\))?$/.exec(tool.trim())
    if (match) {
      return { has: true, restricted: match[2] !== undefined, allowed: match[3] ? splitList(match[3]) : [] }
    }
  }
  return { has: false, restricted: false, allowed: [] }
}

/** Troca a entrada Agent: `null` remove, `[]` libera todos, uma lista restringe. */
export function withAgentRefs(tools: readonly string[], allowed: readonly string[] | null): string[] {
  const entry = allowed === null ? null : allowed.length === 0 ? 'Agent' : `Agent(${allowed.join(', ')})`
  const index = tools.findIndex(tool => /^(Agent|Task)\b/.test(tool.trim()))
  const rest = tools.filter((_, i) => i !== index)
  if (entry === null) return rest
  if (index < 0) return [...tools, entry]
  return [...rest.slice(0, index), entry, ...rest.slice(index)]
}

// ---------------------------------------------------------------------------
// nomes e validação

/** Normaliza enquanto o usuário digita (mantém o hífen final para não "comer" o espaço). */
export function liveSlug(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
}

export function finalSlug(text: string): string {
  return liveSlug(text).replace(/-+$/, '')
}

/** Campos prontos para gravar: espaços nas pontas removidos, listas sem itens vazios. */
export function finalize(fields: AgentFields): AgentFields {
  const clean = (items: readonly string[]): string[] => items.map(item => item.trim()).filter(item => item !== '')
  return {
    ...fields,
    name: fields.name.trim().replace(/-+$/, ''),
    description: fields.description.trim(),
    prompt: fields.prompt.replace(/\s+$/, ''),
    tools: fields.tools === null ? null : clean(fields.tools),
    disallowedTools: clean(fields.disallowedTools),
    skills: clean(fields.skills),
    model: fields.model.trim(),
    maxTurns: fields.maxTurns.trim(),
  }
}

export type IssueLevel = 'error' | 'warn' | 'tip'
export type Issue = { level: IssueLevel; text: string }

export type ValidateContext = {
  scope: SaveScope
  selfPath: string
  others: readonly { name: string; scope: string; path: string }[]
}

const SCOPE_LABEL: Record<string, string> = { project: 'Projeto', user: 'Usuário', plugin: 'Plugin' }

export function validate(fields: AgentFields, context: ValidateContext): Issue[] {
  const issues: Issue[] = []
  const add = (level: IssueLevel, text: string): void => {
    issues.push({ level, text })
  }
  const name = fields.name.trim()
  if (!name) {
    add('error', 'Dê um nome ao agente.')
  } else {
    if (name.includes(':')) add('error', 'O nome não pode ter ":" (reservado para agentes de plugin).')
    else if (/[\s/\\<>"|?*]/.test(name)) add('error', 'Use só letras minúsculas, números e hífens no nome.')
    else if (name.startsWith('-')) add('error', 'O nome não pode começar com hífen.')
    else if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) add('warn', 'Prefira minúsculas, números e hífens (ex.: revisor-de-codigo).')
    if (name.length > 64) add('warn', 'Nome longo: prefira até 64 caracteres.')
    const clash = context.others.find(other => other.name === name && other.path !== context.selfPath && other.scope !== 'plugin')
    if (clash && clash.scope === context.scope) {
      add('error', `Já existe um agente "${name}" em ${SCOPE_LABEL[clash.scope] ?? clash.scope}.`)
    } else if (clash) {
      add('warn', `Também existe "${name}" em ${SCOPE_LABEL[clash.scope] ?? clash.scope}: o do Projeto tem prioridade sobre o do Usuário.`)
    }
  }
  const description = fields.description.trim()
  if (!description) add('error', 'A descrição é obrigatória: é por ela que o Claude decide quando delegar.')
  else if (description.length < 40) add('warn', 'Descrição curta: diga em que situações o Claude deve usar este agente.')
  const prompt = fields.prompt.trim()
  if (!prompt) add('warn', 'Sem prompt do sistema: o agente terá só as instruções da tarefa.')
  else if (prompt.length < 120) add('tip', 'Prompts com papel, passos e formato de resposta costumam dar resultados melhores.')
  if (fields.maxTurns.trim() && !/^[1-9]\d*$/.test(fields.maxTurns.trim())) {
    add('error', 'Máx. de turnos deve ser um número inteiro positivo.')
  }
  if (/\s/.test(fields.model.trim())) add('error', 'O ID do modelo não pode ter espaços.')
  if (fields.tools !== null && fields.tools.length === 0) {
    add('warn', 'Nenhuma ferramenta selecionada: o agente só poderá responder em texto.')
  }
  if (fields.permissionMode === 'bypassPermissions') {
    add('warn', '"Ignorar permissões" deixa o agente agir sem pedir confirmação.')
  }
  if (agentRefs(fields.tools).restricted) {
    add('tip', 'Agent(...) só restringe subagentes quando este agente roda como principal (claude --agent ou a configuração "agent").')
  }
  if (hasTool(fields.tools, 'Skill')) add('tip', 'Para pré-carregar skills, prefira o campo "Skills" em Avançado.')
  if (fields.memory) add('tip', 'Com memória persistente, Read, Write e Edit são adicionadas automaticamente.')
  return issues
}

/** Especificação para `$.agent.register`, usada no "Testar agora". */
export function agentSpec(fields: AgentFields, name: string): Record<string, unknown> {
  const spec: Record<string, unknown> = {
    name,
    description: fields.description.trim() || `Agente ${name}`,
    prompt: fields.prompt.trim() || 'Você é um assistente prestativo.',
  }
  if (fields.tools !== null) spec.tools = [...new Set(fields.tools.map(toolBase))]
  if (fields.disallowedTools.length > 0) spec.disallowedTools = [...new Set(fields.disallowedTools.map(toolBase))]
  if (fields.model) spec.model = fields.model
  if (fields.effort) spec.effort = fields.effort
  if (fields.permissionMode) spec.permissionMode = fields.permissionMode
  if (/^[1-9]\d*$/.test(fields.maxTurns)) spec.maxTurns = Number(fields.maxTurns)
  if (fields.skills.length > 0) spec.skills = fields.skills
  if (fields.memory === 'user' || fields.memory === 'project' || fields.memory === 'local') spec.memory = fields.memory
  if (fields.background) spec.background = true
  if (fields.omitClaudeMd) spec.omitClaudeMd = true
  if (fields.isolation === 'worktree') spec.isolation = 'worktree'
  return spec
}

/** Entradas cruas do YAML (para testes e diagnóstico). */
export function frontmatterEntries(text: string): Entry[] {
  return splitDocument(text).entries
}
