// Geração e melhoria de agentes com o modelo da sessão ($.model.complete).

import type { EngineInterface, ModelCompleteResult } from 'claude-code'

import type { AgentFields } from '../../types'
import { emptyFields, finalSlug } from './agent'
import { COLORS, MODEL_ALIASES } from './catalog'

type Dollar = EngineInterface

const FORMAT_RULES = `Regras do formato de subagente do Claude Code:
- "name": identificador em minúsculas com hífens (ex.: "revisor-de-codigo"), sem ":".
- "description": diz QUANDO o Claude deve delegar ao agente; comece com o papel e inclua gatilhos claros
  (ex.: "Use logo depois de alterar código para..."). Uma ou duas frases.
- "tools": lista com o mínimo necessário de ferramentas, ou null para herdar todas. Ferramentas comuns:
  Read, Glob, Grep, Edit, Write, Bash, WebFetch, WebSearch, NotebookEdit, AskUserQuestion, Agent.
- "model": "sonnet", "opus", "haiku" ou "inherit".
- "color": uma de ${COLORS.map(color => `"${color.id}"`).join(', ')}.
- "prompt": o prompt do sistema em Markdown, na segunda pessoa ("Você é..."), com papel, processo
  passo a passo, critérios de qualidade e o formato da resposta. Entre 150 e 600 palavras.
Escreva os textos em português do Brasil, a menos que o pedido esteja em outro idioma.`

export function generationPrompt(request: string, existing: readonly string[], tools: readonly string[]): { system: string; prompt: string } {
  const system = `Você cria subagentes para o Claude Code. Responda somente com um objeto JSON, sem texto antes ou depois.

${FORMAT_RULES}

Formato exato:
{"name": "...", "description": "...", "tools": ["..."] | null, "model": "...", "color": "...", "prompt": "..."}`
  const lines = [`Pedido do usuário:\n${request.trim()}`]
  if (existing.length > 0) lines.push(`Nomes já usados (escolha outro): ${existing.join(', ')}`)
  if (tools.length > 0) lines.push(`Ferramentas disponíveis nesta sessão: ${tools.slice(0, 120).join(', ')}`)
  return { system, prompt: lines.join('\n\n') }
}

export function improvementPrompt(fields: AgentFields): { system: string; prompt: string } {
  const system = `Você revisa subagentes do Claude Code para torná-los mais eficazes. Responda somente com um objeto JSON:
{"description": "...", "prompt": "...", "notes": "..."}

${FORMAT_RULES}

Mantenha o propósito e o idioma do agente. Deixe a descrição mais clara sobre quando usá-lo e o prompt mais
estruturado e acionável. Em "notes", resuma em uma frase o que mudou.`
  const prompt = `Agente atual:
name: ${fields.name}
description: ${fields.description}
tools: ${fields.tools === null ? '(herda todas)' : fields.tools.join(', ')}
model: ${fields.model || '(padrão)'}

Prompt do sistema:
${fields.prompt || '(vazio)'}`
  return { system, prompt }
}

/** Primeiro objeto JSON do texto (tolera cercas ```json e texto em volta). */
export function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1))
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

/** Converte a resposta do modelo em campos do editor, descartando o que não for válido. */
export function fieldsFromJson(data: Record<string, unknown>): AgentFields {
  const fields = emptyFields()
  fields.name = finalSlug(asText(data.name))
  fields.description = asText(data.description).trim()
  fields.prompt = asText(data.prompt).trim()
  if (Array.isArray(data.tools)) {
    fields.tools = data.tools.filter((tool): tool is string => typeof tool === 'string' && tool.trim() !== '').map(tool => tool.trim())
  }
  const model = asText(data.model).trim()
  if (MODEL_ALIASES.has(model) || /^claude-[\w.-]+$/.test(model)) fields.model = model
  const color = asText(data.color).trim()
  if (COLORS.some(item => item.id === color)) fields.color = color
  for (const key of ['permissionMode', 'effort', 'memory', 'isolation', 'initialPrompt'] as const) {
    const value = asText(data[key]).trim()
    if (value) fields[key] = value
  }
  for (const key of ['disallowedTools', 'skills'] as const) {
    const value = data[key]
    if (Array.isArray(value)) fields[key] = value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
  }
  if (typeof data.maxTurns === 'number' && Number.isInteger(data.maxTurns) && data.maxTurns > 0) {
    fields.maxTurns = String(data.maxTurns)
  }
  if (data.background === true) fields.background = true
  return fields
}

export function failureText(result: ModelCompleteResult): string {
  if (result.isAnswered) return ''
  if (result.reason === 'api-error') return `a API recusou o pedido (status ${result.status})`
  if (result.reason === 'aborted') return 'o pedido demorou demais e foi cancelado'
  return 'o modelo respondeu sem texto'
}

/** Tenta o Sonnet e, se ele não estiver disponível, o modelo da própria sessão. */
export async function complete($: Dollar, request: { system: string; prompt: string; maxTokens: number }): Promise<{ text: string; error: string }> {
  const models = ['sonnet']
  try {
    const sessionModel = await $.session.model()
    if (sessionModel && !models.includes(sessionModel)) models.push(sessionModel)
  } catch {
    // sem o modelo da sessão, fica só o Sonnet
  }
  let error = 'nenhum modelo respondeu'
  for (const model of models) {
    try {
      const result = await $.model.complete({ model, ...request, timeoutMs: 180000 })
      if (result.isAnswered) return { text: result.text, error: '' }
      error = failureText(result)
    } catch (caught) {
      error = String(caught instanceof Error ? caught.message : caught)
    }
  }
  return { text: '', error }
}
