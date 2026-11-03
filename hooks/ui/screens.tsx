// Telas menores: modelos prontos, geração com IA, mapa de delegação e lixeira.

import type { RenderElement } from 'claude-code'

import type { AgentSummary } from '../../types'
import { forget, generate, newDraft, openAgent, restore, setGen, setMainAgent, useTemplate } from '../actions'
import { agentRefs } from '../lib/agent'
import { colorHex, modelLabel, toolsSummary } from '../lib/catalog'
import { displayPath } from '../lib/files'
import { type MapNode, mapSvg } from '../lib/svg'
import { TEMPLATES } from '../lib/templates'
import { type Ctx, type Dollar, field, picker, svgWidth } from './kit'

// ---------------------------------------------------------------------------
// modelos

export function templatesView($: Dollar, ctx: Ctx): RenderElement {
  const { k } = ctx
  const { Box, Text, Button } = k
  return (
    <Box flexDirection="column" gap={1}>
      <Text dimColor>Escolha um ponto de partida: dá para mudar tudo antes de salvar.</Text>
      {TEMPLATES.map(template => (
        <Box key={`modelo-${template.id}`} flexDirection="column" borderStyle="round" borderColor={colorHex(template.fields.color)} paddingX={1}>
          <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
            <Button key={`modelo-usar-${template.id}`} plain onPress={() => void useTemplate($, template.id)}>
              <Text>{`${template.icon} `}</Text>
              <Text weight="bold">{template.title}</Text>
            </Button>
            <Text color={colorHex(template.fields.color)}>{`${template.fields.name} · ${modelLabel(template.fields.model)}`}</Text>
          </Box>
          <Text dimColor>{template.summary}</Text>
          <Text dimColor wrap="truncate-end">
            {toolsSummary(template.fields.tools, 6)}
          </Text>
        </Box>
      ))}
      <Button key="modelo-branco" onPress={() => void newDraft($, null)}>
        + Começar em branco
      </Button>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// gerar com IA

const IDEAS = [
  'Revisor de pull requests focado em segurança e performance',
  'Especialista em testes unitários com Jest e React Testing Library',
  'Revisor de firmware C para microcontroladores: memória, interrupções e watchdog',
  'Analista de logs que encontra a causa de erros em produção',
  'Tradutor de documentação técnica de português para inglês',
]

export function generateView($: Dollar, ctx: Ctx): RenderElement {
  const { k, gen } = ctx
  const { Box, Text, Button } = k
  const scopes = [
    { value: 'project', label: 'Projeto (.claude/agents)' },
    { value: 'user', label: 'Usuário (~/.claude/agents)' },
  ]
  if (!k.canEdit) {
    return <Text dimColor>Para gerar um agente, abra o painel no desktop, no VS Code ou no terminal.</Text>
  }
  return (
    <Box flexDirection="column" gap={1}>
      <Text>Descreva o agente e o Claude escreve o nome, a descrição, as ferramentas e o prompt. Você revisa antes de salvar.</Text>
      {field(
        k,
        'gerar-pedido',
        'Pedido',
        gen.request,
        { rows: 5, placeholder: 'Ex.: um agente que revisa migrações de banco antes do deploy e aponta riscos de perda de dados', submitLabel: 'gerar' },
        value => setGen($, { request: value }),
        value => setGen($, { request: value }).then(() => generate($)),
      )}
      <Text dimColor>Ideias:</Text>
      <Box flexDirection="column">
        {IDEAS.map((idea, i) => (
          <Button key={`gerar-ideia-${i}`} plain dimColor onPress={() => void setGen($, { request: idea, error: '' })}>
            {`› ${idea}`}
          </Button>
        ))}
      </Box>
      {picker(k, 'gerar-escopo', 'Salvar em', scopes, gen.scope, false, value => setGen($, { scope: value === 'user' ? 'user' : 'project' }))}
      {gen.busy ? (
        <Text color="claude">✨ Gerando com o Claude… isso leva alguns segundos.</Text>
      ) : (
        <Button key="gerar-ir" variant="primary" onPress={() => void generate($)}>
          ✨ Gerar agente
        </Button>
      )}
      {gen.error ? <Text color="error">{gen.error}</Text> : null}
      <Text dimColor>Usa o modelo da sua conta (Sonnet, ou o da sessão se ele não estiver disponível).</Text>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// mapa

type MapModel = {
  root: MapNode
  rootAgent: AgentSummary | null
  children: AgentSummary[]
  missing: string[]
  canDelegate: boolean
}

function nodeOf(agent: AgentSummary): MapNode {
  const tools = agent.tools === null ? 'todas' : `${agent.tools.length} ferr.`
  const own = agentRefs(agent.tools)
  return {
    id: agent.id,
    label: agent.qualifiedName,
    sub: `${modelLabel(agent.model)} · ${tools}`,
    hex: colorHex(agent.color),
    isPlugin: agent.scope === 'plugin',
    isMissing: false,
    calls: own.restricted ? own.allowed : [],
  }
}

function buildMap(ctx: Ctx): MapModel | null {
  const catalog = ctx.catalog
  if (!catalog) return null
  const usable = catalog.agents.filter(agent => !agent.error && !agent.shadowed)
  const main = catalog.mainAgent
  const rootAgent = main ? (usable.find(agent => agent.qualifiedName === main || agent.name === main) ?? null) : null
  const root: MapNode = rootAgent
    ? { ...nodeOf(rootAgent), id: 'raiz', label: `@${rootAgent.qualifiedName} (principal)`, calls: [] }
    : {
        id: 'raiz',
        label: 'Claude (sessão principal)',
        sub: 'delega a qualquer subagente',
        hex: '#d97757',
        isPlugin: false,
        isMissing: false,
        calls: [],
      }
  const refs = agentRefs(rootAgent ? rootAgent.tools : null)
  const pool = usable.filter(agent => agent !== rootAgent)
  const children = !refs.has
    ? []
    : refs.restricted
      ? pool.filter(agent => refs.allowed.includes(agent.qualifiedName) || refs.allowed.includes(agent.name))
      : pool
  const missing = refs.restricted ? refs.allowed.filter(name => !pool.some(agent => agent.qualifiedName === name || agent.name === name)) : []
  return { root, rootAgent, children, missing, canDelegate: refs.has }
}

export function mapView($: Dollar, ctx: Ctx): RenderElement {
  const { k, catalog } = ctx
  const { Box, Text, Button, Svg } = k
  const model = buildMap(ctx)
  if (!catalog || !model) return <Text dimColor>Carregando…</Text>
  const choices = [
    { value: '_claude', label: 'Claude padrão' },
    ...catalog.agents
      .filter(agent => !agent.error && !agent.shadowed)
      .map(agent => ({ value: agent.qualifiedName, label: agent.qualifiedName })),
  ]
  const current = catalog.mainAgent && choices.some(choice => choice.value === catalog.mainAgent) ? catalog.mainAgent : '_claude'
  const nodes: MapNode[] = [
    ...model.children.map(nodeOf),
    ...model.missing.map(name => ({
      id: `faltando-${name}`,
      label: name,
      sub: 'não encontrado',
      hex: '#e5484d',
      isPlugin: false,
      isMissing: true,
      calls: [],
    })),
  ]

  const graph = Svg ? (
    <Svg
      source={mapSvg(svgWidth(k), model.root, nodes)}
      alt={`Mapa de delegação: ${model.root.label} chama ${model.children.map(agent => agent.qualifiedName).join(', ') || 'nenhum subagente'}`}
      width={svgWidth(k)}
      isInteractive
    />
  ) : (
    <Box flexDirection="column">
      <Text weight="bold" color="claude">{`◆ ${model.root.label}`}</Text>
      {!model.canDelegate ? <Text dimColor>   (sem a ferramenta Agent: não delega)</Text> : null}
      {model.children.map((agent, i) => {
        const isLast = i === model.children.length - 1 && model.missing.length === 0
        const own = agentRefs(agent.tools)
        return (
          <Box key={`mapa-linha-${agent.id}`} flexDirection="column">
            <Box flexDirection="row">
              <Text dimColor>{isLast ? '└─' : '├─'}</Text>
              <Text color={colorHex(agent.color)}>{'● '}</Text>
              <Text weight="bold">{agent.qualifiedName}</Text>
              <Text dimColor>{`  ${nodeOf(agent).sub}`}</Text>
            </Box>
            {own.restricted ? <Text dimColor>{`${isLast ? '   ' : '│  '}  ⤷ como principal chama: ${own.allowed.join(', ')}`}</Text> : null}
          </Box>
        )
      })}
      {model.missing.map(name => (
        <Text color="error">{`└─ ✖ ${name} (não encontrado)`}</Text>
      ))}
    </Box>
  )

  return (
    <Box flexDirection="column" gap={1}>
      <Text dimColor>
        Quem pode delegar para quem. O agente principal é quem conversa com você; ele chama os subagentes pela ferramenta
        Agent. ⤷: orquestrador que chama outros subagentes quando ele mesmo é o principal.
      </Text>
      {picker(k, 'mapa-principal', 'Agente principal do projeto', choices, current, !k.canEdit, value =>
        setMainAgent($, value === '_claude' ? '' : value),
      )}
      {graph}
      {model.children.length > 0 ? (
        <Box flexDirection="column">
          <Text dimColor>Abrir no editor:</Text>
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {[...(model.rootAgent ? [model.rootAgent] : []), ...model.children].map(agent => (
              <Button key={`mapa-abrir-${agent.id}`} plain onPress={() => void openAgent($, agent.id, 'mapa')}>
                <Text color={colorHex(agent.color)}>{'● '}</Text>
                <Text>{agent.qualifiedName}</Text>
              </Button>
            ))}
          </Box>
        </Box>
      ) : null}
      {catalog.mainAgent && !model.rootAgent ? (
        <Text color="warning">{`A configuração "agent" aponta para "${catalog.mainAgent}", que não foi encontrado.`}</Text>
      ) : null}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// lixeira

function formatDate(ms: number): string {
  const date = new Date(ms)
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${two(date.getDate())}/${two(date.getMonth() + 1)}/${date.getFullYear()} ${two(date.getHours())}:${two(date.getMinutes())}`
}

export function trashView($: Dollar, ctx: Ctx): RenderElement {
  const { k, trash, catalog } = ctx
  const { Box, Text, Button } = k
  if (trash.length === 0) {
    return <Text dimColor>A lixeira está vazia. Agentes excluídos pelo estúdio ficam guardados aqui para restaurar.</Text>
  }
  return (
    <Box flexDirection="column" gap={1}>
      <Text dimColor>{`Os ${trash.length} agentes excluídos mais recentes (até 30). Restaurar grava o arquivo de volta no mesmo lugar.`}</Text>
      {trash.map(item => (
        <Box key={`lixo-${item.id}`} flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
          <Text weight="bold">{item.name}</Text>
          <Text dimColor>
            {`${item.scope === 'user' ? 'Usuário' : 'Projeto'} · excluído em ${formatDate(item.deletedAt)} · ${catalog ? displayPath(catalog.paths, item.path) : item.path}`}
          </Text>
          <Box flexDirection="row" gap={1}>
            <Button key={`lixo-restaurar-${item.id}`} variant="primary" onPress={() => void restore($, item.id)}>
              Restaurar
            </Button>
            <Button key={`lixo-apagar-${item.id}`} plain dimColor onPress={() => void forget($, item.id)}>
              Apagar da lixeira
            </Button>
          </Box>
        </Box>
      ))}
    </Box>
  )
}
