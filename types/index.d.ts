// Contrato de estado do Estúdio de Agentes (agents-creator).
// Cada valor guardado em $.state é declarado aqui; os tipos são importados pelo módulo de hooks.

/** De onde vem um agente: pasta do projeto, pasta do usuário ou um plugin instalado. */
export type Scope = 'project' | 'user' | 'plugin'

/** Onde o estúdio pode gravar (plugins são somente leitura). */
export type SaveScope = 'project' | 'user'

export type View = 'lista' | 'editor' | 'modelos' | 'gerar' | 'mapa' | 'lixeira' | 'estruturas'

/** Campos editáveis de um agente: o frontmatter conhecido e o prompt do sistema. */
export type AgentFields = {
  name: string
  description: string
  prompt: string
  /** `null`: campo omitido, o agente herda todas as ferramentas. */
  tools: string[] | null
  disallowedTools: string[]
  model: string
  color: string
  effort: string
  permissionMode: string
  /** Texto do campo (número inteiro) ou vazio. */
  maxTurns: string
  memory: string
  background: boolean
  isolation: string
  omitClaudeMd: boolean
  skills: string[]
  initialPrompt: string
}

/** Resumo de um arquivo de agente, como a galeria e o mapa mostram. */
export type AgentSummary = {
  id: string
  scope: Scope
  path: string
  /** Caminho relativo à pasta de agentes (`revisao/seguranca.md`). */
  relPath: string
  /** Nome do plugin, para agentes de plugin; vazio nos demais. */
  plugin: string
  name: string
  /** Como o Claude chama o agente: o nome, ou `plugin:nome` para plugins. */
  qualifiedName: string
  description: string
  color: string
  model: string
  tools: string[] | null
  disallowedTools: string[]
  permissionMode: string
  promptLength: number
  mtimeMs: number
  /** Problema ao ler o arquivo; vazio quando está tudo certo. */
  error: string
  /** Outro agente de maior prioridade usa o mesmo nome. */
  shadowed: boolean
}

export type Paths = {
  root: string
  projectDir: string
  userDir: string
  configDir: string
  isWindows: boolean
}

export type Catalog = {
  paths: Paths
  agents: AgentSummary[]
  /** Valor da configuração `agent` (agente principal da sessão), ou vazio. */
  mainAgent: string
  scannedAt: number
}

/** Para onde o rascunho vai ao salvar: a pasta de agentes, ou um agente de um template da biblioteca. */
export type DestinoRascunho = { tipo: 'arquivo' } | { tipo: 'template'; templateId: string; file: string; titulo: string }

/** O agente aberto no editor. */
export type Draft = {
  /** `view`: agente de plugin, aberto só para leitura (pode ser copiado). */
  mode: 'new' | 'edit' | 'view'
  scope: SaveScope
  originId: string
  originPath: string
  originRaw: string
  originName: string
  fields: AgentFields
  /** YAML dos campos que o editor não conhece (mcpServers, hooks, ...), preservado como está. */
  extra: string
  dirty: boolean
  /** Versões anteriores dos campos, para desfazer (ex.: depois de "Melhorar com IA"). */
  history: AgentFields[]
  /** Gravar mesmo que o arquivo tenha mudado fora do estúdio. */
  force: boolean
  eol: string
  /** Texto cru de campos digitados como lista (skills, ferramenta extra...), como o usuário digitou. */
  buffers: Record<string, string>
  /** Destino ao salvar: a pasta de agentes ou um agente de um template da biblioteca. */
  destino: DestinoRascunho
}

export type StatusKind = 'info' | 'ok' | 'warn' | 'error'
export type Status = { kind: StatusKind; text: string } | null

export type GenState = { request: string; scope: SaveScope; busy: boolean; error: string }

export type TestState = {
  task: string
  busy: boolean
  agentId: string
  agent: string
  answer: string
  error: string
}

export type Flags = {
  /** Seções cujo estado (aberta/fechada) difere do padrão. */
  toggled: string[]
  preview: boolean
  showFile: boolean
  /** Confirmação pendente: '', 'delete' ou 'overwrite'. */
  confirm: string
  /** Filtro da galeria: '', 'project', 'user' ou 'plugin'. */
  scopeFilter: string
  improving: boolean
  /** Para onde "Voltar" leva a partir do editor. */
  back: string
}

export type TrashItem = {
  id: string
  name: string
  scope: SaveScope
  path: string
  content: string
  deletedAt: number
}

export type LiveTool = { name: string; mcp: boolean }

/** Um template em Meus templates (biblioteca local): só o resumo, sem o conteúdo dos agentes. `base`: id da estrutura do catálogo de origem, ou ''. */
export type LibraryItem = { id: string; title: string; icon: string; summary: string; origin: 'catalogo' | 'proprio'; createdAt: number; agents: string[]; base: string }

/** Estado de um plugin exigido: `local` é pasta do desenvolvedor (não é comparada com o catálogo). */
export type EstadoDependencia = 'atual' | 'desatualizada' | 'faltando' | 'local' | 'desconhecida'

/** Um plugin exigido pelo agents-creator. `instalada` vazia: não instalado; `ultima` vazia: versão do catálogo desconhecida. */
export type DepInfo = { id: string; nome: string; para: string; marketplace: string; repo: string; instalada: string; ultima: string; estado: EstadoDependencia }

/** Um agente do template ativo que mudou no projeto: `alterado` (conteúdo diferente) ou `faltando` (não está no projeto). */
export type MudancaAgente = { file: string; tipo: 'alterado' | 'faltando' }

/** Estado da aba Estruturas: catálogo, biblioteca local e o template ativo deste projeto. */
export type EstruturasUi = {
  aba: 'catalogo' | 'biblioteca'
  /** Id do item aberto; '' mostra a lista. */
  selecionado: string
  origemSelecionado: 'catalogo' | 'biblioteca'
  sobrescrever: boolean
  confirmar: '' | 'aplicar' | 'remover' | 'apagar' | 'remover-agente'
  alvoConfirmacao: string
  verAgente: string
  verFluxo: boolean
  titulo: string
  icone: string
  resumo: string
  /** Versão do squad-stream instalada; '' quando não foi encontrado. */
  squadVersao: string
  carregado: boolean
  biblioteca: LibraryItem[]
  ativo: string
  /** Caminhos dos agentes do template ativo, relativos ao projeto, com '/'. */
  arquivosAtivos: string[]
  ocupado: boolean
  /** Plugins que o agents-creator exige, com o estado de cada um neste computador. */
  dependencias: DepInfo[]
  /** Uma verificação ou instalação está rodando (o `claude` está em uso). */
  verificandoDeps: boolean
  /** O comando `claude` não conseguiu iniciar; a aba mostra o que rodar no terminal. */
  claudeAusente: boolean
  /** Bloco "Plugins necessários" aberto. */
  verDeps: boolean
  /** Id do template aberto no editor de template; '' = nenhum. */
  editando: string
  /** Campos do template em edição (ainda não salvos quando `edicaoSujo`). */
  edicaoTitulo: string
  edicaoResumo: string
  edicaoIcone: string
  edicaoFluxo: string
  /** Os campos do template mudaram e não foram salvos. */
  edicaoSujo: boolean
  /** Id da estrutura do catálogo que está sendo clonada; '' = nenhuma. */
  clonando: string
  /** Nome proposto para a cópia (ex.: "<Título> (minha versão)"). */
  nomeClone: string
  /** Agentes do template ativo que mudaram no projeto (vazio sem template ativo ou sem mudanças). */
  mudancas: MudancaAgente[]
  /** O fluxo (CLAUDE.md) do template ativo mudou no projeto. */
  fluxoMudou: boolean
  /** Ids das cópias do catálogo que têm versão nova na estrutura padrão. */
  desatualizados: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'agents-creator': {
      view: View
      filter: string
      catalog: Shaped<Catalog | null>
      draft: Shaped<Draft | null>
      /** Rascunho com alterações não salvas que foi substituído por outro (dá para recuperar). */
      stash: Shaped<Draft | null>
      status: Shaped<Status>
      gen: Shaped<GenState>
      test: Shaped<TestState>
      flags: Shaped<Flags>
      /** Subagentes em execução agora: id do agente → tipo. */
      running: Shaped<Record<string, string>>
      /** Quantas vezes cada tipo de agente foi chamado (também gravado em $.store). */
      usage: Shaped<Record<string, number>>
      trash: Shaped<TrashItem[]>
      liveTools: Shaped<LiveTool[]>
      /** Aba Estruturas: catálogo, biblioteca local e o template ativo do projeto. */
      estruturas: Shaped<EstruturasUi>
    }
  }
}
