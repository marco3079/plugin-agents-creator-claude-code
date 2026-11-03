// Editor de um agente: identidade, execução, ferramentas, prompt, avançado, arquivo, teste e verificação.

import type { RenderElement } from 'claude-code'

import type { Draft } from '../../types'
import {
  PROMPT_SKELETON,
  addToList,
  back,
  deleteCurrent,
  duplicate,
  editFields,
  improve,
  openAgent,
  overwrite,
  patchDraft,
  revert,
  runTest,
  save,
  saveCopy,
  setBuffer,
  setField,
  setFlags,
  setMainAgent,
  setNameInput,
  setTest,
  targetPath,
  toggleSection,
  undo,
} from '../actions'
import { type Issue, agentRefs, finalize, hasTool, splitList, toMarkdown, toggleTool, toolBase, validate, withAgentRefs } from '../lib/agent'
import {
  CATALOG_TOOLS,
  COLORS,
  EFFORTS,
  MEMORY,
  MODELS,
  MODEL_ALIASES,
  PERMISSION_MODES,
  PRESETS,
  TOOL_GROUPS,
  UNSET,
  colorHex,
  colorLabel,
  mcpServer,
  modelLabel,
  withCurrent,
} from '../lib/catalog'
import { displayPath } from '../lib/files'
import { previewSvg } from '../lib/svg'
import { type Ctx, type Dollar, field, isOpen, picker, section, styleOf, svgWidth, toggleButton } from './kit'

const unset = (value: string): string => value || UNSET
const fromSelect = (value: string): string => (value === UNSET ? '' : value)

const BLOCKABLE = ['Write', 'Edit', 'Bash', 'PowerShell', 'WebFetch', 'WebSearch', 'Agent', 'NotebookEdit'] as const

type ToolItem = { name: string; label: string; hint: string }

// ---------------------------------------------------------------------------
// tela

export function editorView($: Dollar, ctx: Ctx): RenderElement {
  const { k, draft, catalog } = ctx
  const { Box, Text, Button } = k
  if (!draft || !catalog) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>Nenhum agente aberto no editor.</Text>
        <Button key="ed-vazio-voltar" onPress={() => void back($)}>
          ← Voltar para a galeria
        </Button>
      </Box>
    )
  }
  const fields = draft.fields
  const readOnly = draft.mode === 'view' || !k.canEdit
  const final = finalize(fields)
  const issues = validate(final, {
    scope: draft.scope,
    selfPath: draft.mode === 'edit' ? draft.originPath : '',
    others: catalog.agents,
  })
  const errors = issues.filter(issue => issue.level === 'error').length
  const warnings = issues.filter(issue => issue.level === 'warn').length
  const hex = colorHex(fields.color)
  const title = draft.mode === 'new' ? 'Novo agente' : draft.mode === 'view' ? 'Agente de plugin' : 'Editando'
  const promptLines = fields.prompt ? fields.prompt.split('\n').length : 0
  const toolsBadge = fields.tools === null ? 'herda todas' : `${fields.tools.length} selecionadas`
  const checkBadge = errors > 0 ? `${errors} erro(s)` : warnings > 0 ? `${warnings} aviso(s)` : 'ok'

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
        <Button key="ed-voltar" plain onPress={() => void back($)}>
          ← Voltar
        </Button>
        <Text weight="bold">{title}</Text>
        <Text color={hex} weight="bold">
          {fields.name || 'sem-nome'}
        </Text>
        {draft.dirty ? <Text color="warning">● não salvo</Text> : draft.mode === 'edit' ? <Text color="success">✓ salvo</Text> : null}
        {draft.dirty && !readOnly ? (
          <Button key="ed-salvar-topo" variant="primary" onPress={() => void save($)}>
            {draft.mode === 'new' ? 'Criar agente' : 'Salvar'}
          </Button>
        ) : null}
      </Box>
      {preview($, ctx, draft, hex)}
      {confirmations($, ctx, draft)}
      {section($, ctx, 'identidade', 'Identidade', true, () => identity($, ctx, draft, readOnly))}
      {section($, ctx, 'execucao', 'Modelo e execução', true, () => execution($, ctx, draft, readOnly), modelLabel(fields.model))}
      {section($, ctx, 'ferramentas', 'Ferramentas', true, () => tools($, ctx, draft, readOnly), toolsBadge)}
      {section($, ctx, 'prompt', 'Prompt do sistema', true, () => prompt($, ctx, draft, readOnly), `${promptLines} linhas`)}
      {section($, ctx, 'avancado', 'Avançado', false, () => advanced($, ctx, draft, readOnly))}
      {section($, ctx, 'arquivo', 'Arquivo e destino', false, () => file($, ctx, draft, readOnly), displayPath(catalog.paths, targetPath(catalog, draft, final)))}
      {draft.mode !== 'view' && k.canEdit ? section($, ctx, 'testar', 'Testar agora', false, () => testing($, ctx)) : null}
      {section($, ctx, 'verificacao', 'Verificação', true, () => checks($, ctx, issues), checkBadge)}
      {actionBar($, ctx, draft, errors)}
    </Box>
  )
}

function preview($: Dollar, ctx: Ctx, draft: Draft, hex: string): RenderElement | null {
  const { k } = ctx
  const { Svg } = k
  if (!Svg) return null
  const fields = draft.fields
  const width = svgWidth(k)
  const source = previewSvg(width, {
    name: fields.name,
    description: fields.description.replace(/\\n/g, ' '),
    hex,
    model: modelLabel(fields.model),
    tools: fields.tools === null ? ['todas as ferramentas'] : fields.tools.length === 0 ? ['nenhuma ferramenta'] : fields.tools,
  })
  return <Svg source={source} alt={`Prévia do agente ${fields.name || 'sem nome'}`} width={width} height={108} />
}

function confirmations($: Dollar, ctx: Ctx, draft: Draft): RenderElement | null {
  const { k, flags } = ctx
  const { Box, Text, Button } = k
  if (flags.confirm === 'delete') {
    return (
      <Box borderStyle="round" borderColor="error" paddingX={1} flexDirection="column" gap={1}>
        <Text>{`Excluir "${draft.originName}"? O arquivo sai da pasta de agentes e fica guardado na lixeira do estúdio.`}</Text>
        <Box flexDirection="row" gap={1}>
          <Button key="ed-excluir-sim" variant="primary" onPress={() => void deleteCurrent($)}>
            Excluir
          </Button>
          <Button key="ed-excluir-nao" onPress={() => void setFlags($, { confirm: '' })}>
            Cancelar
          </Button>
        </Box>
      </Box>
    )
  }
  if (flags.confirm === 'overwrite') {
    return (
      <Box borderStyle="round" borderColor="warning" paddingX={1} flexDirection="column" gap={1}>
        <Text>O arquivo mudou fora do estúdio depois que você o abriu. O que prefere?</Text>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="ed-sobrescrever" variant="primary" onPress={() => void overwrite($)}>
            Gravar a minha versão
          </Button>
          <Button key="ed-recarregar" onPress={() => void openAgent($, draft.originId)}>
            Recarregar do disco
          </Button>
          <Button key="ed-sobrescrever-nao" onPress={() => void setFlags($, { confirm: '' })}>
            Cancelar
          </Button>
        </Box>
      </Box>
    )
  }
  return null
}

// ---------------------------------------------------------------------------
// seções

function identity($: Dollar, ctx: Ctx, draft: Draft, readOnly: boolean): RenderElement {
  const { k } = ctx
  const { Box, Text, Button } = k
  const fields = draft.fields
  return (
    <Box flexDirection="column" gap={1}>
      {field(k, 'ed-nome', 'Nome', fields.name, { placeholder: 'ex.: revisor-de-codigo', readOnly }, value => setNameInput($, value))}
      <Text dimColor>Minúsculas, números e hífens. É o nome pelo qual o Claude chama o agente.</Text>
      {field(
        k,
        'ed-descricao',
        'Descrição',
        fields.description,
        {
          placeholder: 'Quando o Claude deve delegar a este agente? Ex.: Use logo depois de alterar código para revisar qualidade e segurança.',
          rows: 4,
          readOnly,
        },
        value => setField($, 'description', value),
      )}
      <Text dimColor>{`O Claude lê a descrição para decidir quando delegar · ${fields.description.trim().length} caracteres`}</Text>
      <Text>Cor</Text>
      {readOnly ? (
        <Text color={colorHex(fields.color)}>{`● ${colorLabel(fields.color)}`}</Text>
      ) : (
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {COLORS.map(color => (
            <Button key={`ed-cor-${color.id}`} plain onPress={() => void setField($, 'color', color.id)}>
              <Text color={color.hex}>{fields.color === color.id ? '◉' : '●'}</Text>
              <Text>{` ${color.label}`}</Text>
            </Button>
          ))}
          <Button key="ed-cor-nenhuma" plain dimColor onPress={() => void setField($, 'color', '')}>
            {fields.color ? '○ sem cor' : '◉ sem cor'}
          </Button>
        </Box>
      )}
    </Box>
  )
}

function execution($: Dollar, ctx: Ctx, draft: Draft, readOnly: boolean): RenderElement {
  const { k } = ctx
  const { Box, Text } = k
  const fields = draft.fields
  const isCustom = fields.model !== '' && !MODEL_ALIASES.has(fields.model)
  return (
    <Box flexDirection="column" gap={1}>
      {picker(k, 'ed-modelo', 'Modelo', withCurrent(MODELS, unset(fields.model)), unset(fields.model), readOnly, value =>
        setField($, 'model', fromSelect(value)),
      )}
      {readOnly
        ? null
        : field(k, 'ed-modelo-id', 'ou ID do modelo', isCustom ? fields.model : '', { placeholder: 'ex.: claude-opus-5-5' }, value =>
            setField($, 'model', value.trim()),
          )}
      {picker(k, 'ed-esforco', 'Esforço', withCurrent(EFFORTS, unset(fields.effort)), unset(fields.effort), readOnly, value =>
        setField($, 'effort', fromSelect(value)),
      )}
      {picker(
        k,
        'ed-permissao',
        'Permissões',
        withCurrent(PERMISSION_MODES, unset(fields.permissionMode)),
        unset(fields.permissionMode),
        readOnly,
        value => setField($, 'permissionMode', fromSelect(value)),
      )}
      {field(k, 'ed-turnos', 'Máx. de turnos', fields.maxTurns, { placeholder: 'sem limite', readOnly }, value => setField($, 'maxTurns', value.trim()))}
      {picker(k, 'ed-memoria', 'Memória', withCurrent(MEMORY, unset(fields.memory)), unset(fields.memory), readOnly, value =>
        setField($, 'memory', fromSelect(value)),
      )}
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {toggleButton(k, 'ed-segundo-plano', 'Sempre em segundo plano', fields.background, () => editFields($, current => ({ background: !current.background })), { readOnly })}
        {toggleButton(
          k,
          'ed-worktree',
          'Worktree isolado',
          fields.isolation === 'worktree',
          () => editFields($, current => ({ isolation: current.isolation === 'worktree' ? '' : 'worktree' })),
          { readOnly },
        )}
        {toggleButton(k, 'ed-sem-claudemd', 'Sem CLAUDE.md', fields.omitClaudeMd, () => editFields($, current => ({ omitClaudeMd: !current.omitClaudeMd })), { readOnly })}
      </Box>
      <Text dimColor>
        Segundo plano: o Claude não espera o agente terminar. Worktree: roda numa cópia git separada. Sem CLAUDE.md: não
        carrega as instruções do projeto.
      </Text>
    </Box>
  )
}

function toolGroup($: Dollar, ctx: Ctx, id: string, label: string, byDefault: boolean, items: readonly ToolItem[], selected: readonly string[]): RenderElement {
  const { k, flags } = ctx
  const { Box, Text, Button } = k
  const open = isOpen(flags, `ferr-${id}`, byDefault)
  const chosen = items.filter(item => hasTool(selected, item.name)).length
  return (
    <Box key={`ed-grupo-${id}`} flexDirection="column">
      <Button key={`secao-ferr-${id}`} plain onPress={() => void toggleSection($, `ferr-${id}`)}>
        <Text dimColor>{open ? '▾ ' : '▸ '}</Text>
        <Text>{label}</Text>
        <Text dimColor>{chosen > 0 ? `  ${chosen} de ${items.length}` : `  ${items.length}`}</Text>
      </Button>
      {open ? (
        <Box flexDirection="row" gap={1} flexWrap="wrap" paddingLeft={2}>
          {items.map(item =>
            toggleButton(
              k,
              `ed-ferr-${item.name}`,
              item.label,
              hasTool(selected, item.name),
              () => editFields($, current => ({ tools: toggleTool(current.tools ?? [], item.name) })),
              item.hint ? { hint: item.hint } : {},
            ),
          )}
        </Box>
      ) : null}
    </Box>
  )
}

/** Atalho de ferramentas: troca as do catálogo e mantém as extras (MCP, Agent(...)). */
function applyPreset(current: readonly string[], preset: readonly string[]): string[] {
  const kept = current.filter(tool => {
    const base = toolBase(tool)
    return !CATALOG_TOOLS.has(base) || base === 'Agent' || base === 'Task'
  })
  return [...preset, ...kept.filter(tool => !preset.includes(tool))]
}

function tools($: Dollar, ctx: Ctx, draft: Draft, readOnly: boolean): RenderElement {
  const { k, liveTools, catalog } = ctx
  const { Box, Text, Button } = k
  const fields = draft.fields
  const inherit = fields.tools === null
  const selected = fields.tools ?? []

  if (readOnly) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text>{inherit ? 'Herda todas as ferramentas da conversa.' : selected.length > 0 ? selected.join(', ') : 'Nenhuma ferramenta.'}</Text>
        {fields.disallowedTools.length > 0 ? <Text dimColor>{`Bloqueadas: ${fields.disallowedTools.join(', ')}`}</Text> : null}
      </Box>
    )
  }

  const liveNames = new Set(liveTools.map(tool => tool.name))
  const otherBuiltins: ToolItem[] = liveTools
    .filter(tool => !tool.mcp && !CATALOG_TOOLS.has(tool.name) && !tool.name.startsWith('mcp__'))
    .map(tool => ({ name: tool.name, label: tool.name, hint: '' }))
  const servers = new Map<string, ToolItem[]>()
  for (const tool of liveTools) {
    const server = mcpServer(tool.name)
    if (!tool.mcp && !server) continue
    const key = server || 'outros'
    const label = tool.name.split('__').slice(2).join('__') || tool.name
    servers.set(key, [...(servers.get(key) ?? []), { name: tool.name, label, hint: '' }])
  }
  const custom = selected.filter(tool => !CATALOG_TOOLS.has(toolBase(tool)) && !liveNames.has(tool))
  const refs = agentRefs(fields.tools)

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Button key="ed-ferr-herdar" variant={inherit ? 'primary' : 'secondary'} onPress={() => void setField($, 'tools', null)}>
          {inherit ? '◉ Herdar todas' : '○ Herdar todas'}
        </Button>
        <Button
          key="ed-ferr-escolher"
          variant={inherit ? 'secondary' : 'primary'}
          onPress={() => void editFields($, current => ({ tools: current.tools ?? ['Read', 'Glob', 'Grep'] }))}
        >
          {inherit ? '○ Escolher' : '◉ Escolher'}
        </Button>
      </Box>
      {inherit ? (
        <Text dimColor>
          O agente recebe todas as ferramentas da conversa, inclusive as de MCP. Escolha uma lista para limitar o que ele
          pode fazer.
        </Text>
      ) : (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
            <Text dimColor>Atalhos:</Text>
            {PRESETS.map(preset => (
              <Button
                key={`ed-preset-${preset.id}`}
                plain
                dimColor
                onPress={() => void editFields($, current => ({ tools: applyPreset(current.tools ?? [], preset.tools) }))}
              >
                {preset.label}
              </Button>
            ))}
            <Button key="ed-preset-limpar" plain dimColor onPress={() => void setField($, 'tools', [])}>
              Limpar
            </Button>
          </Box>
          {TOOL_GROUPS.map(group =>
            toolGroup($, ctx, group.id, group.label, group.isOpen, group.tools.map(tool => ({ name: tool.name, label: tool.name, hint: tool.hint })), selected),
          )}
          {otherBuiltins.length > 0 ? toolGroup($, ctx, 'sessao', 'Outras desta sessão', false, otherBuiltins, selected) : null}
          {[...servers.entries()].map(([server, items]) => toolGroup($, ctx, `mcp-${server}`, `MCP · ${server}`, false, items, selected))}
          {custom.length > 0 ? (
            <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
              <Text dimColor>Personalizadas:</Text>
              {custom.map(tool => (
                <Button
                  key={`ed-ferr-remover-${tool}`}
                  plain
                  onPress={() => void editFields($, current => ({ tools: (current.tools ?? []).filter(item => item !== tool) }))}
                >
                  {`${tool} ✕`}
                </Button>
              ))}
            </Box>
          ) : null}
          {field(
            k,
            'ed-ferr-extra',
            'Adicionar',
            draft.buffers.ferramenta ?? '',
            { placeholder: 'ex.: Bash(git *) ou mcp__servidor__ferramenta', submitLabel: 'adicionar' },
            value => setBuffer($, 'ferramenta', value),
            value => addToList($, 'tools', 'ferramenta', value),
          )}
          <Text dimColor>{`Selecionadas (${selected.length}): ${selected.join(', ') || 'nenhuma'}`}</Text>
        </Box>
      )}
      {!inherit && refs.has ? subagents($, ctx, draft) : null}
      {blocked($, ctx, draft)}
      {catalog && inherit && hasTool(fields.disallowedTools, 'Agent') ? (
        <Text dimColor>Agent está bloqueada: este agente não poderá delegar.</Text>
      ) : null}
    </Box>
  )
}

function subagents($: Dollar, ctx: Ctx, draft: Draft): RenderElement {
  const { k, catalog } = ctx
  const { Box, Text } = k
  const fields = draft.fields
  const refs = agentRefs(fields.tools)
  const self = fields.name.trim()
  const candidates = (catalog?.agents ?? []).filter(agent => !agent.error && !agent.shadowed && agent.qualifiedName !== self)
  const known = new Set(candidates.map(agent => agent.qualifiedName))
  const missing = refs.allowed.filter(name => !known.has(name))
  const toggleOne = (name: string): Promise<void> =>
    editFields($, current => {
      const now = agentRefs(current.tools)
      const list = now.restricted ? now.allowed : []
      const next = list.includes(name) ? list.filter(item => item !== name) : [...list, name]
      return { tools: withAgentRefs(current.tools ?? [], next) }
    })
  return (
    <Box flexDirection="column" gap={1} borderStyle="round" borderColor="claude" paddingX={1}>
      <Text weight="bold">Subagentes que ele pode chamar</Text>
      <Text dimColor>{`Vale quando ele roda como agente principal (claude --agent ${self || '<nome>'} ou a configuração "agent").`}</Text>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {toggleButton(k, 'ed-sub-todos', 'Qualquer um', !refs.restricted, () => editFields($, current => ({ tools: withAgentRefs(current.tools ?? [], []) })))}
        {candidates.map(agent =>
          toggleButton(k, `ed-sub-${agent.id}`, agent.qualifiedName, refs.restricted && refs.allowed.includes(agent.qualifiedName), () =>
            toggleOne(agent.qualifiedName),
          ),
        )}
      </Box>
      {missing.length > 0 ? <Text color="warning">{`Não encontrados: ${missing.join(', ')}`}</Text> : null}
    </Box>
  )
}

function blocked($: Dollar, ctx: Ctx, draft: Draft): RenderElement {
  const { k, flags } = ctx
  const { Box, Text, Button } = k
  const list = draft.fields.disallowedTools
  const id = 'bloqueadas'
  const open = isOpen(flags, id, list.length > 0)
  const extras = list.filter(tool => !(BLOCKABLE as readonly string[]).includes(toolBase(tool)))
  return (
    <Box flexDirection="column" gap={open ? 1 : 0}>
      <Button key={`secao-${id}`} plain onPress={() => void toggleSection($, id)}>
        <Text dimColor>{open ? '▾ ' : '▸ '}</Text>
        <Text>Bloqueadas (disallowedTools)</Text>
        <Text dimColor>{list.length > 0 ? `  ${list.length}` : ' '}</Text>
      </Button>
      {open ? (
        <Box flexDirection="column" gap={1} paddingLeft={2}>
          <Text dimColor>Removidas do que o agente herdaria ou escolheu: útil para "tudo, menos editar arquivos".</Text>
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            {BLOCKABLE.map(name =>
              toggleButton(k, `ed-bloq-${name}`, name, hasTool(list, name), () =>
                editFields($, current => ({ disallowedTools: toggleTool(current.disallowedTools, name) })),
              ),
            )}
            {extras.map(tool => (
              <Button
                key={`ed-bloq-remover-${tool}`}
                plain
                onPress={() => void editFields($, current => ({ disallowedTools: current.disallowedTools.filter(item => item !== tool) }))}
              >
                {`${tool} ✕`}
              </Button>
            ))}
          </Box>
          {field(
            k,
            'ed-bloq-extra',
            'Bloquear',
            draft.buffers.bloqueada ?? '',
            { placeholder: 'ex.: Bash(git push *)', submitLabel: 'bloquear' },
            value => setBuffer($, 'bloqueada', value),
            value => addToList($, 'disallowedTools', 'bloqueada', value),
          )}
        </Box>
      ) : null}
    </Box>
  )
}

function prompt($: Dollar, ctx: Ctx, draft: Draft, readOnly: boolean): RenderElement {
  const { k, flags } = ctx
  const { Box, Text, Button, Markdown } = k
  const fields = draft.fields
  const showPreview = readOnly || flags.preview
  return (
    <Box flexDirection="column" gap={1}>
      {readOnly ? null : (
        <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
          <Button key="ed-prompt-editar" variant={showPreview ? 'secondary' : 'primary'} onPress={() => void setFlags($, { preview: false })}>
            Editar
          </Button>
          <Button key="ed-prompt-ver" variant={showPreview ? 'primary' : 'secondary'} onPress={() => void setFlags($, { preview: true })}>
            Pré-visualizar
          </Button>
          {flags.improving ? (
            <Text color="claude">✨ Melhorando com o Claude…</Text>
          ) : (
            <Button key="ed-melhorar" onPress={() => void improve($)}>
              ✨ Melhorar com IA
            </Button>
          )}
          {draft.history.length > 0 ? (
            <Button key="ed-desfazer" onPress={() => void undo($)}>
              ↶ Desfazer
            </Button>
          ) : null}
          {fields.prompt.trim() === '' ? (
            <Button key="ed-estrutura" plain dimColor onPress={() => void setField($, 'prompt', PROMPT_SKELETON)}>
              Inserir estrutura sugerida
            </Button>
          ) : null}
        </Box>
      )}
      {showPreview ? (
        <Box borderStyle="round" borderColor="subtle" paddingX={1} flexDirection="column">
          <Markdown text={fields.prompt.trim() || '_Sem prompt do sistema._'} />
        </Box>
      ) : (
        field(
          k,
          'ed-prompt',
          'Prompt',
          fields.prompt,
          { rows: 14, placeholder: 'Você é um especialista em… Descreva o papel, o processo passo a passo, as regras e o formato da resposta.' },
          value => setField($, 'prompt', value),
        )
      )}
      <Text dimColor>O corpo do arquivo .md vira o prompt do sistema do agente: ele substitui o prompt padrão do Claude Code.</Text>
    </Box>
  )
}

function advanced($: Dollar, ctx: Ctx, draft: Draft, readOnly: boolean): RenderElement {
  const { k } = ctx
  const { Box, Text } = k
  const fields = draft.fields
  return (
    <Box flexDirection="column" gap={1}>
      {field(
        k,
        'ed-skills',
        'Skills pré-carregadas',
        draft.buffers.skills ?? fields.skills.join(', '),
        { placeholder: 'nomes separados por vírgula', readOnly },
        value => setBuffer($, 'skills', value, { skills: splitList(value) }),
      )}
      {field(
        k,
        'ed-inicial',
        'Prompt inicial (initialPrompt)',
        fields.initialPrompt,
        { placeholder: 'enviado sozinho quando o agente roda como principal', rows: 2, readOnly },
        value => setField($, 'initialPrompt', value),
      )}
      {field(k, 'ed-extra', 'Outros campos (YAML)', draft.extra, { placeholder: 'ex.: mcpServers: [github]', rows: 6, readOnly }, value =>
        patchDraft($, { extra: value, dirty: true }),
      )}
      <Text dimColor>Campos que o editor não mostra (mcpServers, hooks, experimental…) são gravados exatamente como estiverem aqui.</Text>
    </Box>
  )
}

function file($: Dollar, ctx: Ctx, draft: Draft, readOnly: boolean): RenderElement {
  const { k, catalog, flags } = ctx
  const { Box, Text, Button, Code } = k
  if (!catalog) return <Text dimColor>Carregando…</Text>
  const fields = finalize(draft.fields)
  const target = targetPath(catalog, draft, fields)
  const isSaved = draft.mode === 'edit'
  const isMoving = isSaved && !draft.originId.startsWith(`${draft.scope}:`)
  const main = catalog.mainAgent
  const isMain = isSaved && main !== '' && main === draft.originName
  const scopes = [
    { value: 'project', label: 'Projeto · .claude/agents (vai para o git)' },
    { value: 'user', label: 'Usuário · ~/.claude/agents (todos os projetos)' },
  ]
  return (
    <Box flexDirection="column" gap={1}>
      {draft.mode === 'view' ? (
        <Text dimColor>{`Arquivo do plugin: ${displayPath(catalog.paths, draft.originPath)}`}</Text>
      ) : (
        picker(k, 'ed-escopo', 'Salvar em', scopes, draft.scope, readOnly, value => patchDraft($, { scope: value === 'user' ? 'user' : 'project', dirty: true }))
      )}
      {draft.mode === 'view' ? null : <Text dimColor>{`${isMoving ? 'Será movido para' : 'Arquivo'}: ${displayPath(catalog.paths, target)}`}</Text>}
      {isSaved && !readOnly
        ? toggleButton(k, 'ed-principal', 'Usar como agente principal neste projeto', isMain, () => setMainAgent($, isMain ? '' : draft.originName))
        : null}
      {isSaved ? (
        <Text dimColor>
          {`Agente principal: a conversa inteira roda com o prompt, o modelo e as ferramentas dele (grava "agent" em .claude/settings.local.json). Para uma sessão só: claude --agent ${draft.originName}`}
        </Text>
      ) : null}
      <Button key="ed-ver-arquivo" plain onPress={() => void setFlags($, { showFile: !flags.showFile })}>
        {flags.showFile ? '▾ Ocultar o arquivo .md' : '▸ Ver o arquivo .md que será gravado'}
      </Button>
      {flags.showFile ? <Code source={toMarkdown(fields, draft.extra, isSaved ? draft.originRaw : null, '\n')} language="markdown" /> : null}
    </Box>
  )
}

function testing($: Dollar, ctx: Ctx): RenderElement {
  const { k, test } = ctx
  const { Box, Text, Button, Markdown } = k
  return (
    <Box flexDirection="column" gap={1}>
      <Text dimColor>
        Roda o rascunho agora como subagente desta sessão, com as ferramentas configuradas, sem precisar salvar. Ele age
        de verdade no projeto.
      </Text>
      {field(
        k,
        'ed-teste',
        'Tarefa',
        test.task,
        { rows: 2, placeholder: 'ex.: Revise as mudanças do último commit', submitLabel: 'testar' },
        value => setTest($, { task: value }),
        value => setTest($, { task: value }).then(() => runTest($)),
      )}
      {test.busy ? (
        <Text color="claude">{`⏳ Rodando ${test.agent}… a resposta aparece aqui quando ele terminar.`}</Text>
      ) : (
        <Button key="ed-testar" variant="primary" onPress={() => void runTest($)}>
          ▶ Executar teste
        </Button>
      )}
      {test.error ? <Text color="error">{test.error}</Text> : null}
      {test.answer ? (
        <Box flexDirection="column" borderStyle="round" borderColor="success" paddingX={1}>
          <Text weight="bold">{`Resposta de ${test.agent}`}</Text>
          <Markdown text={test.answer} />
        </Box>
      ) : null}
    </Box>
  )
}

function checks($: Dollar, ctx: Ctx, issues: readonly Issue[]): RenderElement {
  const { k } = ctx
  const { Box, Text } = k
  if (issues.length === 0) return <Text color="success">✓ Tudo certo para salvar.</Text>
  return (
    <Box flexDirection="column">
      {issues.map((issue, i) => {
        const style = styleOf(issue.level)
        return (
          <Box key={`ed-aviso-${i}`} flexDirection="row" gap={1}>
            <Text color={style.color}>{style.icon}</Text>
            <Box flexShrink={1}>
              <Text>{issue.text}</Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

function actionBar($: Dollar, ctx: Ctx, draft: Draft, errors: number): RenderElement {
  const { k } = ctx
  const { Box, Text, Button } = k
  if (draft.mode === 'view') {
    return (
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {k.canEdit ? (
          <Button key="ed-copiar-projeto" variant="primary" onPress={() => void saveCopy($, 'project')}>
            Salvar cópia no projeto
          </Button>
        ) : null}
        {k.canEdit ? (
          <Button key="ed-copiar-usuario" onPress={() => void saveCopy($, 'user')}>
            Salvar cópia no usuário
          </Button>
        ) : null}
        <Button key="ed-fechar" onPress={() => void back($)}>
          Fechar
        </Button>
      </Box>
    )
  }
  if (!k.canEdit) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>Para editar, abra o painel no desktop, no VS Code ou no terminal.</Text>
        <Button key="ed-fechar" onPress={() => void back($)}>
          Fechar
        </Button>
      </Box>
    )
  }
  return (
    <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
      <Button key="ed-salvar" variant="primary" onPress={() => void save($)}>
        {draft.mode === 'new' ? 'Criar agente' : 'Salvar'}
      </Button>
      {draft.dirty ? (
        <Button key="ed-descartar" onPress={() => void revert($)}>
          Descartar alterações
        </Button>
      ) : null}
      {draft.mode === 'edit' ? (
        <Button key="ed-duplicar" onPress={() => void duplicate($)}>
          Duplicar
        </Button>
      ) : null}
      {draft.mode === 'edit' ? (
        <Button key="ed-excluir" onPress={() => void setFlags($, { confirm: 'delete' })}>
          Excluir
        </Button>
      ) : null}
      {errors > 0 ? <Text color="error">{`${errors} ${errors === 1 ? 'erro' : 'erros'} para corrigir`}</Text> : null}
    </Box>
  )
}
