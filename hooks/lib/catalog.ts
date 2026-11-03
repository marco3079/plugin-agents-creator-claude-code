// Vocabulário do editor: cores, modelos, modos de permissão e o catálogo de ferramentas.

export type Option = { value: string; label: string }

export type ColorDef = { id: string; label: string; hex: string }

/** As oito cores que o Claude Code aceita no campo `color`. */
export const COLORS: readonly ColorDef[] = [
  { id: 'red', label: 'Vermelho', hex: '#e5484d' },
  { id: 'orange', label: 'Laranja', hex: '#f76b15' },
  { id: 'yellow', label: 'Amarelo', hex: '#d4a017' },
  { id: 'green', label: 'Verde', hex: '#30a46c' },
  { id: 'cyan', label: 'Ciano', hex: '#0ea5c6' },
  { id: 'blue', label: 'Azul', hex: '#3e63dd' },
  { id: 'purple', label: 'Roxo', hex: '#8e4ec6' },
  { id: 'pink', label: 'Rosa', hex: '#d6409f' },
]

export const NEUTRAL_HEX = '#8b8d98'

export function colorHex(color: string): string {
  if (color === 'magenta') return '#c2298a'
  return COLORS.find(item => item.id === color)?.hex ?? NEUTRAL_HEX
}

export function colorLabel(color: string): string {
  return COLORS.find(item => item.id === color)?.label ?? (color || 'Sem cor')
}

/** Valor que representa "campo omitido" nos Selects (eles não aceitam valor vazio). */
export const UNSET = '_padrao'

export const MODELS: readonly Option[] = [
  { value: UNSET, label: 'Padrão (herda da conversa)' },
  { value: 'inherit', label: 'inherit · mesmo modelo da conversa' },
  { value: 'sonnet', label: 'Sonnet · equilibrado' },
  { value: 'opus', label: 'Opus · mais capaz' },
  { value: 'haiku', label: 'Haiku · rápido e econômico' },
  { value: 'fable', label: 'Fable' },
]

/** As opções de um Select mais o valor atual, quando ele não está entre elas (o Select exige isso). */
export function withCurrent(options: readonly Option[], value: string): readonly Option[] {
  return options.some(option => option.value === value) ? options : [...options, { value, label: `${value} (atual)` }]
}

export const MODEL_ALIASES = new Set(['inherit', 'sonnet', 'opus', 'haiku', 'fable'])

export function modelLabel(model: string): string {
  if (!model) return 'padrão'
  return model === 'inherit' ? 'herda' : model
}

export const EFFORTS: readonly Option[] = [
  { value: UNSET, label: 'Padrão do modelo' },
  { value: 'low', label: 'low · baixo' },
  { value: 'medium', label: 'medium · médio' },
  { value: 'high', label: 'high · alto' },
  { value: 'xhigh', label: 'xhigh · muito alto' },
  { value: 'max', label: 'max · máximo' },
]

export const PERMISSION_MODES: readonly Option[] = [
  { value: UNSET, label: 'Padrão (o da conversa)' },
  { value: 'default', label: 'default · pergunta antes de agir' },
  { value: 'acceptEdits', label: 'acceptEdits · aceita edições' },
  { value: 'plan', label: 'plan · só planeja' },
  { value: 'auto', label: 'auto · automático' },
  { value: 'dontAsk', label: 'dontAsk · não pergunta' },
  { value: 'bypassPermissions', label: 'bypassPermissions · ignora permissões' },
]

export const MEMORY: readonly Option[] = [
  { value: UNSET, label: 'Sem memória persistente' },
  { value: 'user', label: 'user · do usuário (todos os projetos)' },
  { value: 'project', label: 'project · do projeto (versionada)' },
  { value: 'local', label: 'local · do projeto, só nesta máquina' },
]

export type ToolDef = { name: string; hint: string }
export type ToolGroup = { id: string; label: string; isOpen: boolean; tools: readonly ToolDef[] }

export const TOOL_GROUPS: readonly ToolGroup[] = [
  {
    id: 'leitura',
    label: 'Leitura e busca',
    isOpen: true,
    tools: [
      { name: 'Read', hint: 'ler arquivos' },
      { name: 'Glob', hint: 'achar arquivos por padrão' },
      { name: 'Grep', hint: 'buscar texto no código' },
      { name: 'LSP', hint: 'navegação de código' },
    ],
  },
  {
    id: 'edicao',
    label: 'Edição',
    isOpen: true,
    tools: [
      { name: 'Edit', hint: 'alterar arquivos' },
      { name: 'Write', hint: 'criar e sobrescrever' },
      { name: 'NotebookEdit', hint: 'notebooks Jupyter' },
    ],
  },
  {
    id: 'execucao',
    label: 'Execução',
    isOpen: true,
    tools: [
      { name: 'Bash', hint: 'comandos de terminal' },
      { name: 'PowerShell', hint: 'comandos no Windows' },
      { name: 'Monitor', hint: 'acompanhar processos' },
    ],
  },
  {
    id: 'web',
    label: 'Web',
    isOpen: true,
    tools: [
      { name: 'WebFetch', hint: 'ler páginas' },
      { name: 'WebSearch', hint: 'pesquisar na web' },
    ],
  },
  {
    id: 'agentes',
    label: 'Agentes e tarefas',
    isOpen: false,
    tools: [
      { name: 'Agent', hint: 'delegar a subagentes' },
      { name: 'SendMessage', hint: 'falar com outros agentes' },
      { name: 'TaskCreate', hint: 'criar tarefas' },
      { name: 'TaskUpdate', hint: 'atualizar tarefas' },
      { name: 'TaskList', hint: 'listar tarefas' },
      { name: 'TaskGet', hint: 'ler uma tarefa' },
      { name: 'TaskStop', hint: 'parar tarefas' },
    ],
  },
  {
    id: 'outras',
    label: 'Interação e outras',
    isOpen: false,
    tools: [
      { name: 'AskUserQuestion', hint: 'perguntar ao usuário' },
      { name: 'Skill', hint: 'usar skills' },
      { name: 'ToolSearch', hint: 'carregar ferramentas' },
      { name: 'EnterPlanMode', hint: 'entrar no modo plano' },
      { name: 'ExitPlanMode', hint: 'sair do modo plano' },
      { name: 'EnterWorktree', hint: 'abrir worktree' },
      { name: 'ExitWorktree', hint: 'sair do worktree' },
      { name: 'CronCreate', hint: 'agendar' },
    ],
  },
]

export const CATALOG_TOOLS = new Set(TOOL_GROUPS.flatMap(group => group.tools.map(tool => tool.name)))

export type Preset = { id: string; label: string; tools: readonly string[] }

export const PRESETS: readonly Preset[] = [
  { id: 'leitura', label: 'Somente leitura', tools: ['Read', 'Glob', 'Grep'] },
  { id: 'edicao', label: 'Leitura + edição', tools: ['Read', 'Glob', 'Grep', 'Edit', 'Write'] },
  { id: 'dev', label: 'Desenvolvimento', tools: ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'Bash'] },
  { id: 'web', label: 'Pesquisa web', tools: ['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch'] },
]

/** `mcp__github__create_issue` -> `github`. */
export function mcpServer(tool: string): string {
  const parts = tool.split('__')
  return parts.length >= 3 && parts[0] === 'mcp' ? (parts[1] ?? '') : ''
}

/** Resumo curto das ferramentas para cartões: "Read · Grep · +3". */
export function toolsSummary(tools: readonly string[] | null, max = 4): string {
  if (tools === null) return 'todas as ferramentas (herda)'
  if (tools.length === 0) return 'nenhuma ferramenta'
  const shown = tools.slice(0, max).join(' · ')
  return tools.length > max ? `${shown} · +${tools.length - max}` : shown
}
