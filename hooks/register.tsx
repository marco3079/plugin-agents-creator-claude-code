// Estúdio de Agentes: um painel ao lado do chat para criar e editar agentes e subagentes do Claude Code.
//
// Entradas: o comando /agentes, a ferramenta open_agents_studio (o Claude abre o painel com um
// rascunho) e os eventos de subagentes, que acendem "em execução" nos cartões e trazem a resposta
// do "Testar agora".

import type { Register } from 'claude-code'

import { loadPersisted, openFromTool, openStudio, refreshIfOpen, trackEnd, trackSpawn } from './actions'
import { makeKit } from './ui/kit'
import { renderPane } from './ui/pane'

const TOOL_DESCRIPTION = [
  'Opens the Agents Studio pane beside the chat: a visual editor for Claude Code subagents',
  '(.claude/agents and ~/.claude/agents). Use it when the user wants to create, edit, review, test or',
  'visualize agents or subagents. Pass "draft" to pre-fill a NEW agent that the user reviews and saves in',
  'the pane (do not also write the file yourself), "agent" to open an existing one, or "view" to open a',
  'screen. The tool itself writes nothing.',
].join(' ')

const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    draft: {
      type: 'object',
      description: 'A new agent to pre-fill in the editor for the user to review and save.',
      properties: {
        name: { type: 'string', description: 'kebab-case identifier, e.g. "code-reviewer".' },
        description: { type: 'string', description: 'When Claude should delegate to this agent, with clear triggers.' },
        prompt: { type: 'string', description: 'The system prompt, in Markdown.' },
        tools: { type: 'array', items: { type: 'string' }, description: 'Allowed tools. Omit to inherit every tool.' },
        disallowedTools: { type: 'array', items: { type: 'string' } },
        model: { type: 'string', description: 'sonnet, opus, haiku, fable, inherit, or a full model id.' },
        color: { type: 'string', enum: ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'] },
        permissionMode: { type: 'string', enum: ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions'] },
        effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max'] },
        maxTurns: { type: 'integer', minimum: 1 },
        skills: { type: 'array', items: { type: 'string' } },
        memory: { type: 'string', enum: ['user', 'project', 'local'] },
        scope: { type: 'string', enum: ['project', 'user'], description: 'project = .claude/agents (default), user = ~/.claude/agents.' },
      },
      required: ['name', 'description', 'prompt'],
    },
    agent: { type: 'string', description: 'Name of an existing agent to open in the editor.' },
    view: { type: 'string', enum: ['lista', 'modelos', 'gerar', 'mapa', 'lixeira'], description: 'Screen to open.' },
  },
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'agentes',
        description: 'Estúdio de Agentes: crie e edite agentes e subagentes num painel visual',
        argumentHint: '[novo | gerar <pedido> | modelos | mapa | <nome do agente>]',
      })
    } catch {
      // sem o comando, a ferramenta ainda abre o painel
    }
    try {
      await $.tool.register({ name: 'open_agents_studio', description: TOOL_DESCRIPTION, inputSchema: TOOL_SCHEMA })
    } catch {
      // sem a ferramenta, o comando ainda funciona
    }
    try {
      await loadPersisted($)
    } catch {
      // contadores e lixeira começam vazios
    }
    return next(e)
  })

  on('command.run', { command: 'agentes' }, async ($, e) => ({ text: await openStudio($, e.args) })).catch(() => ({
    text: 'Não foi possível abrir o Estúdio de Agentes agora. Tente /agentes de novo.',
  }))

  on('tool.call', { tool: 'mcp__agents-creator__open_agents_studio' }, async ($, e) => ({
    result: await openFromTool($, { ...e }),
  })).catch(() => ({
    result: 'O Estúdio de Agentes não abriu. Sugira ao usuário digitar /agentes, ou crie o arquivo do agente diretamente.',
  }))

  // Só observa: anota quem está rodando e nunca impede um subagente de começar.
  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if (result.agentId) await trackSpawn($, result.agentId, e.subagentType)
    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    try {
      if (e.agentId) await trackEnd($, e.agentId, e.answer)
      else await refreshIfOpen($)
    } catch {
      // o painel se atualiza na próxima ação
    }
    return result
  })

  on('ui.render', { component: 'Pane', requestId: 'agentes' }, async ($, e) => {
    const table = $.ui.resolve(e)
    return renderPane($, makeKit(table, String(e.surface), e.props.bodyColumns))
  })
}
