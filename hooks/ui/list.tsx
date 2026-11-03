// Galeria: os agentes do projeto, do usuário e dos plugins, em cartões coloridos.

import type { RenderElement } from 'claude-code'

import type { AgentSummary, Scope } from '../../types'
import { go, newDraft, openAgent, setFilter, setFlags, toggleSection } from '../actions'
import { colorHex, modelLabel, toolsSummary } from '../lib/catalog'
import { displayPath } from '../lib/files'
import { avatarSvg } from '../lib/svg'
import { type Ctx, type Dollar, isOpen, truncate } from './kit'

const SCOPES: readonly { scope: Scope; title: string }[] = [
  { scope: 'project', title: 'Projeto' },
  { scope: 'user', title: 'Usuário' },
  { scope: 'plugin', title: 'Plugins' },
]

function matches(agent: AgentSummary, query: string): boolean {
  const haystack = [agent.qualifiedName, agent.description, agent.model, ...(agent.tools ?? [])].join(' ').toLowerCase()
  return query.split(/\s+/).every(word => haystack.includes(word))
}

function card($: Dollar, ctx: Ctx, agent: AgentSummary): RenderElement {
  const { k, catalog, running, usage } = ctx
  const { Box, Text, Button, Svg } = k
  const hex = colorHex(agent.color)
  const isRunning = Object.values(running).includes(agent.qualifiedName)
  const uses = usage[agent.qualifiedName] ?? 0
  const main = catalog?.mainAgent ?? ''
  const isMain = main !== '' && (main === agent.qualifiedName || main === agent.name)
  const facts = [
    toolsSummary(agent.tools),
    uses > 0 ? `usado ${uses}×` : '',
    agent.shadowed ? 'sobrescrito pelo do projeto' : '',
  ].filter(Boolean)
  return (
    <Box key={`cartao-${agent.id}`} flexDirection="column" borderStyle="round" borderColor={hex} paddingX={1}>
      <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
        {Svg ? <Svg source={avatarSvg(agent.name, hex, 26)} alt={`Avatar de ${agent.name}`} width={26} height={26} /> : null}
        {Svg ? (
          <Button key={`abrir-${agent.id}`} plain onPress={() => void openAgent($, agent.id)}>
            <Text weight="bold">{agent.qualifiedName}</Text>
          </Button>
        ) : (
          <Button key={`abrir-${agent.id}`} plain onPress={() => void openAgent($, agent.id)}>
            <Text color={hex}>● </Text>
            <Text weight="bold">{agent.qualifiedName}</Text>
          </Button>
        )}
        <Text color={hex}>{modelLabel(agent.model)}</Text>
        {isRunning ? <Text color="success">● em execução</Text> : null}
        {isMain ? <Text color="claude">★ principal</Text> : null}
      </Box>
      {agent.error ? (
        <Text color="warning">{`⚠ ${agent.error}`}</Text>
      ) : (
        <Text dimColor>{truncate(agent.description, 150) || 'Sem descrição.'}</Text>
      )}
      <Text dimColor wrap="truncate-end">
        {facts.join(' · ')}
      </Text>
    </Box>
  )
}

function emptyState($: Dollar, ctx: Ctx): RenderElement {
  const { k, catalog } = ctx
  const { Box, Text, Button } = k
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1} paddingY={1} gap={1}>
      <Text weight="bold">Nenhum agente por aqui ainda</Text>
      <Text dimColor>
        Agentes (subagentes) são assistentes especializados para os quais o Claude delega tarefas: revisar código, rodar
        testes, pesquisar, documentar… Cada um tem seu próprio prompt, ferramentas e modelo.
      </Text>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Button key="vazio-novo" variant="primary" onPress={() => void newDraft($, null)}>
          + Criar do zero
        </Button>
        <Button key="vazio-modelos" onPress={() => void go($, 'modelos')}>
          Usar um modelo
        </Button>
        <Button key="vazio-gerar" onPress={() => void go($, 'gerar')}>
          ✨ Gerar com IA
        </Button>
      </Box>
      {catalog ? (
        <Text dimColor>
          {`Pastas: ${displayPath(catalog.paths, catalog.paths.projectDir)} (projeto) e ${displayPath(catalog.paths, catalog.paths.userDir)} (usuário)`}
        </Text>
      ) : null}
    </Box>
  )
}

export function listView($: Dollar, ctx: Ctx): RenderElement {
  const { k, catalog, filter, flags } = ctx
  const { Box, Text, Button, Input } = k
  if (!catalog) return <Text dimColor>Carregando agentes…</Text>
  if (catalog.agents.length === 0) return emptyState($, ctx)

  const query = filter.trim().toLowerCase()
  const visible = catalog.agents.filter(
    agent => (!flags.scopeFilter || agent.scope === flags.scopeFilter) && (!query || matches(agent, query)),
  )
  const count = (scope: Scope): number => catalog.agents.filter(agent => agent.scope === scope).length
  const filters: readonly { value: string; label: string }[] = [
    { value: '', label: `Todos (${catalog.agents.length})` },
    ...SCOPES.filter(item => count(item.scope) > 0).map(item => ({ value: item.scope, label: `${item.title} (${count(item.scope)})` })),
  ]

  return (
    <Box flexDirection="column" gap={1}>
      {Input ? (
        <Input
          key="busca"
          label="Buscar"
          placeholder="nome, descrição, modelo ou ferramenta…"
          value={filter}
          onInput={value => void setFilter($, value)}
          onSubmit={value => void setFilter($, value)}
        />
      ) : null}
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {filters.map(item => (
          <Button
            key={`filtro-${item.value || 'todos'}`}
            variant={flags.scopeFilter === item.value ? 'primary' : 'secondary'}
            onPress={() => void setFlags($, { scopeFilter: item.value })}
          >
            {item.label}
          </Button>
        ))}
      </Box>
      {visible.length === 0 ? <Text dimColor>Nenhum agente corresponde à busca.</Text> : null}
      {SCOPES.map(({ scope, title }) => {
        const agents = visible.filter(agent => agent.scope === scope)
        if (agents.length === 0) return null
        const dir = scope === 'project' ? catalog.paths.projectDir : scope === 'user' ? catalog.paths.userDir : ''
        const isPlugins = scope === 'plugin'
        const open = !isPlugins || isOpen(flags, 'lista-plugins', agents.length <= 4)
        return (
          <Box key={`grupo-${scope}`} flexDirection="column" gap={1}>
            <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
              {isPlugins ? (
                <Button key="lista-plugins" plain onPress={() => void toggleSection($, 'lista-plugins')}>
                  <Text weight="bold">{`${open ? '▾' : '▸'} ${title.toUpperCase()}`}</Text>
                </Button>
              ) : (
                <Text weight="bold">{title.toUpperCase()}</Text>
              )}
              <Text dimColor>{`${agents.length} · ${dir ? displayPath(catalog.paths, dir) : 'somente leitura'}`}</Text>
              {isPlugins ? null : (
                <Button
                  key={`novo-${scope}`}
                  plain
                  dimColor
                  onPress={() => void newDraft($, null, { scope: scope === 'user' ? 'user' : 'project' })}
                >
                  + novo aqui
                </Button>
              )}
            </Box>
            {open ? (
              <Box flexDirection="column" gap={1}>
                {agents.map(agent => card($, ctx, agent))}
              </Box>
            ) : null}
          </Box>
        )
      })}
    </Box>
  )
}
