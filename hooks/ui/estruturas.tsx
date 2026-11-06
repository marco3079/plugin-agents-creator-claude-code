// Aba "Estruturas": o catálogo de templates de equipes, a biblioteca local ("Meus templates", com o editor
// de cada template) e o template ativo do projeto. As ações (baixar, trocar, remover, salvar, apagar, editar,
// clonar) ficam em ../estruturas.

import type { RenderElement } from 'claude-code'

import type { DepInfo, EstruturasUi, LibraryItem } from '../../types'
import {
  abrirEdicao,
  apagarDaBiblioteca,
  aplicarTemplate,
  aplicarTemplateNoProjeto,
  atualizarCopia,
  atualizarDependencia,
  atualizarTemplateComProjeto,
  atualizarTodas,
  baixarDoCatalogo,
  cancelarClone,
  carregarEstruturas,
  confirmarClone,
  conflitosDe,
  iniciarClone,
  procurarAtualizacoes,
  removerAgenteDoTemplate,
  removerDoProjeto,
  salvarComoTemplate,
  selecionar,
  setEstruturas,
  setNomeClone,
  voltar,
} from '../estruturas'
import { colorHex, modelLabel, toolsSummary } from '../lib/catalog'
import { comandoDe } from '../lib/dependencias'
import { CATEGORIAS, ESTRUTURAS, estruturaPorId } from '../lib/estruturas/index'
import { SQUAD_VERSAO_PADRAO, agenteMarkdown, fluxoMarkdown } from '../lib/estruturas/protocolo'
import type { LocalTemplate, Structure, StructureRole } from '../lib/estruturas/tipos'
import { edicaoView } from './estruturas-edicao'
import { type Ctx, type Dollar, type Kit, field, picker, toggleButton, truncate } from './kit'

const ICONES = ['🧩', '🛠️', '⚖️', '📈', '🎬', '🎓', '🔬', '📡', '🛡️', '🎧', '🎮', '🤖'].map(icone => ({ value: icone, label: icone }))

function formatDate(ms: number): string {
  const date = new Date(ms)
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${two(date.getDate())}/${two(date.getMonth() + 1)}/${date.getFullYear()} ${two(date.getHours())}:${two(date.getMinutes())}`
}

/** Indicador que substitui os botões de ação enquanto uma operação está rodando. */
function trabalhando(k: Kit): RenderElement {
  const { Text } = k
  return <Text color="claude">⏳ Trabalhando…</Text>
}

/** Nome de um template com ícone: procura na biblioteca e depois no catálogo; sem achar, mostra o id. */
function nomeDe(est: EstruturasUi, id: string): string {
  const item = est.biblioteca.find(entry => entry.id === id)
  if (item) return `${item.icon} ${item.title}`
  const estrutura = estruturaPorId(id)
  return estrutura ? `${estrutura.icon} ${estrutura.title}` : id
}

/** Agentes de .claude/agents do projeto, no formato que `conflitosDe` espera. */
function agentesDoProjeto(ctx: Ctx): { name: string; relPath: string }[] {
  return (ctx.catalog?.agents ?? [])
    .filter(agent => agent.scope === 'project')
    .map(agent => ({ name: agent.name, relPath: `.claude/agents/${agent.relPath}` }))
}

type Pedido = { pergunta: string; rotulo: string; executar: () => unknown }

/** O que a caixa de confirmação pergunta e o que o botão faz; `null` quando não há nada a confirmar. */
function pedidoDe($: Dollar, est: EstruturasUi): Pedido | null {
  const alvo = est.alvoConfirmacao
  if (est.confirmar === 'aplicar') {
    return {
      pergunta: `Trocar "${nomeDe(est, est.ativo)}" por "${nomeDe(est, alvo)}"? Os agentes de "${nomeDe(est, est.ativo)}" saem do projeto (vão para a lixeira do estúdio) e o fluxo dele sai do CLAUDE.md.`,
      rotulo: 'Trocar',
      executar: () =>
        est.origemSelecionado === 'catalogo' && est.selecionado === alvo ? baixarDoCatalogo($, alvo, true) : aplicarTemplate($, alvo),
    }
  }
  if (est.confirmar === 'remover') {
    return {
      pergunta: `Remover "${nomeDe(est, est.ativo)}" deste projeto? Os agentes dele vão para a lixeira do estúdio e o fluxo sai do CLAUDE.md.`,
      rotulo: 'Remover',
      executar: () => removerDoProjeto($),
    }
  }
  if (est.confirmar === 'apagar') {
    return {
      pergunta: `Apagar "${nomeDe(est, alvo)}" de Meus templates? O projeto não muda.`,
      rotulo: 'Apagar',
      executar: () => apagarDaBiblioteca($, alvo),
    }
  }
  if (est.confirmar === 'remover-agente') {
    return {
      pergunta: `Tirar "${alvo}" do template? O projeto não muda.`,
      rotulo: 'Remover',
      executar: () => removerAgenteDoTemplate($, alvo),
    }
  }
  return null
}

function confirmacaoView($: Dollar, ctx: Ctx, est: EstruturasUi): RenderElement | null {
  const pedido = pedidoDe($, est)
  if (!pedido) return null
  const { k } = ctx
  const { Box, Text, Button } = k
  return (
    <Box flexDirection="column" gap={1} borderStyle="round" borderColor="warning" paddingX={1}>
      <Text>{pedido.pergunta}</Text>
      {est.ocupado ? (
        trabalhando(k)
      ) : (
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="est-confirmar-sim" variant="primary" onPress={() => void pedido.executar()}>
            {pedido.rotulo}
          </Button>
          <Button key="est-confirmar-nao" onPress={() => void setEstruturas($, { confirmar: '', alvoConfirmacao: '' })}>
            Cancelar
          </Button>
        </Box>
      )}
    </Box>
  )
}

/** Caixa para dar o nome da cópia antes de clonar uma estrutura padrão. Só com canEdit: clonar grava em Meus templates. */
function caixaClone($: Dollar, ctx: Ctx, est: EstruturasUi): RenderElement | null {
  const { k } = ctx
  const { Box, Button } = k
  if (!k.canEdit) return null
  return (
    <Box flexDirection="column" gap={1} borderStyle="round" borderColor="claude" paddingX={1}>
      {field(k, 'est-nome-clone', 'Nome', est.nomeClone, {}, valor => setNomeClone($, valor))}
      {est.ocupado ? (
        trabalhando(k)
      ) : (
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="est-clone-ok" variant="primary" onPress={() => void confirmarClone($)}>
            Criar e editar
          </Button>
          <Button key="est-clone-cancelar" onPress={() => void cancelarClone($)}>
            Cancelar
          </Button>
        </Box>
      )}
    </Box>
  )
}

/** Cartão de um template do catálogo: nome, quantos agentes, resumo e os papéis coloridos. */
function cartaoCatalogo($: Dollar, ctx: Ctx, est: EstruturasUi, estrutura: Structure): RenderElement {
  const { k } = ctx
  const { Box, Text, Button } = k
  const primeiro = estrutura.roles[0]
  return (
    <Box
      key={`est-card-${estrutura.id}`}
      flexDirection="column"
      borderStyle="round"
      borderColor={colorHex(primeiro?.fields.color ?? '')}
      paddingX={1}
    >
      <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
        <Button key={`est-ver-${estrutura.id}`} plain onPress={() => void selecionar($, 'catalogo', estrutura.id)}>
          <Text>{`${estrutura.icon} `}</Text>
          <Text weight="bold">{estrutura.title}</Text>
        </Button>
        <Text dimColor>{`${estrutura.roles.length} agentes`}</Text>
        {est.ativo === estrutura.id ? <Text color="success">● ativo</Text> : null}
      </Box>
      <Text dimColor>{estrutura.summary}</Text>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {estrutura.roles.map(role => (
          <Text color={colorHex(role.fields.color)}>{`● ${role.name}`}</Text>
        ))}
      </Box>
    </Box>
  )
}

function catalogoView($: Dollar, ctx: Ctx, est: EstruturasUi): RenderElement {
  const { k } = ctx
  const { Box, Text } = k
  return (
    <Box flexDirection="column" gap={1}>
      {CATEGORIAS.map(categoria => {
        const estruturas = ESTRUTURAS.filter(estrutura => estrutura.category === categoria)
        if (estruturas.length === 0) return null
        return (
          <Box key={`est-categoria-${categoria}`} flexDirection="column" gap={1}>
            <Text weight="bold">{categoria.toUpperCase()}</Text>
            {estruturas.map(estrutura => cartaoCatalogo($, ctx, est, estrutura))}
          </Box>
        )
      })}
    </Box>
  )
}

/** Um papel da equipe: cor, modelo, ferramentas, descrição e o arquivo .md do agente (recolhível). */
function papelView($: Dollar, ctx: Ctx, est: EstruturasUi, estrutura: Structure, role: StructureRole): RenderElement {
  const { k } = ctx
  const { Box, Text, Button, Code } = k
  const cor = colorHex(role.fields.color)
  const aberto = est.verAgente === role.name
  return (
    <Box key={`est-papel-${role.name}`} flexDirection="column" borderStyle="round" borderColor={cor} paddingX={1}>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Text color={cor}>●</Text>
        <Text weight="bold">{role.name}</Text>
        <Text dimColor>{` · ${role.title} · ${role.kind}`}</Text>
      </Box>
      <Text dimColor>{`${modelLabel(role.fields.model)} · ${role.instances} · ${toolsSummary(role.fields.tools)}`}</Text>
      <Text>{truncate(role.fields.description, 220)}</Text>
      <Button
        key={`est-ver-agente-${role.name}`}
        plain
        dimColor
        onPress={() => void setEstruturas($, { verAgente: aberto ? '' : role.name })}
      >
        {aberto ? '▾ Ocultar o arquivo .md' : '▸ Ver o arquivo .md'}
      </Button>
      {aberto ? <Code source={agenteMarkdown(role, estrutura, est.squadVersao || SQUAD_VERSAO_PADRAO)} language="markdown" /> : null}
    </Box>
  )
}

/** Detalhe de um template do catálogo: a equipe, o fluxo do CLAUDE.md, os requisitos e as ações. */
function detalheView($: Dollar, ctx: Ctx, est: EstruturasUi, estrutura: Structure): RenderElement {
  const { k } = ctx
  const { Box, Text, Button, Markdown } = k
  const versao = est.squadVersao || SQUAD_VERSAO_PADRAO
  const conflitos = conflitosDe(
    agentesDoProjeto(ctx),
    estrutura.roles.map(role => `.claude/agents/${role.name}.md`),
    est.arquivosAtivos,
  )
  const outroAtivo = est.ativo !== '' && est.ativo !== estrutura.id
  const rotuloBaixar =
    est.ativo === estrutura.id ? 'Baixar de novo' : outroAtivo ? 'Baixar e trocar o ativo' : 'Baixar e usar no projeto'
  return (
    <Box flexDirection="column" gap={1}>
      <Button key="est-voltar" plain onPress={() => void voltar($)}>
        ← Voltar
      </Button>
      <Box flexDirection="column">
        <Text weight="bold">{`${estrutura.icon} ${estrutura.title}`}</Text>
        <Text>{estrutura.summary}</Text>
        <Text dimColor>{`Quando usar: ${estrutura.when}`}</Text>
      </Box>
      <Box flexDirection="column" gap={1}>
        <Text weight="bold">Equipe</Text>
        {estrutura.roles.map(role => papelView($, ctx, est, estrutura, role))}
      </Box>
      <Box flexDirection="column" gap={1}>
        <Button key="est-ver-fluxo" plain onPress={() => void setEstruturas($, { verFluxo: !est.verFluxo })}>
          {est.verFluxo ? '▾ Ocultar o fluxo do CLAUDE.md' : '▸ Ver o fluxo do CLAUDE.md'}
        </Button>
        {est.verFluxo ? (
          <Box borderStyle="round" borderColor="subtle" paddingX={1}>
            <Markdown text={fluxoMarkdown(estrutura, versao)} />
          </Box>
        ) : null}
      </Box>
      <Box flexDirection="column">
        <Text weight="bold">Requisitos</Text>
        <Text>{`• plugin squad-stream ${est.squadVersao ? `✓ ${est.squadVersao}` : '⚠ não encontrado'}`}</Text>
        <Text>{'• plugin popup-perguntas: o main pergunta ao usuário pelo popup (/popup-perguntas:perguntar)'}</Text>
        {estrutura.requirements.map(requisito => (
          <Text>{`• ${requisito}`}</Text>
        ))}
      </Box>
      {conflitos.length > 0 ? (
        <Box flexDirection="column" gap={1}>
          <Text color="warning">{`Já existem no projeto: ${conflitos.join(', ')}`}</Text>
          {toggleButton(k, 'est-sobrescrever', 'Sobrescrever (os atuais vão para a lixeira)', est.sobrescrever, () =>
            setEstruturas($, { sobrescrever: !est.sobrescrever }),
          )}
        </Box>
      ) : null}
      {!k.canEdit ? (
        <Text dimColor>Para baixar, abra o painel no desktop, no VS Code ou no terminal.</Text>
      ) : est.ocupado ? (
        trabalhando(k)
      ) : (
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button
            key="est-baixar"
            variant="primary"
            onPress={() =>
              void (outroAtivo
                ? setEstruturas($, { confirmar: 'aplicar', alvoConfirmacao: estrutura.id })
                : baixarDoCatalogo($, estrutura.id, true))
            }
          >
            {rotuloBaixar}
          </Button>
          <Button key="est-so-salvar" onPress={() => void baixarDoCatalogo($, estrutura.id, false)}>
            Só salvar em Meus templates
          </Button>
          {est.clonando === estrutura.id ? null : (
            <Button key="est-clonar" onPress={() => void iniciarClone($, estrutura.id)}>
              Clonar
            </Button>
          )}
        </Box>
      )}
      {est.clonando === estrutura.id ? caixaClone($, ctx, est) : null}
    </Box>
  )
}

/** Cartão de um template da biblioteca: origem, agentes, data e as ações. */
function cartaoBiblioteca($: Dollar, ctx: Ctx, est: EstruturasUi, item: LibraryItem): RenderElement {
  const { k } = ctx
  const { Box, Text, Button } = k
  const ativo = est.ativo === item.id
  const desatualizado = est.desatualizados.includes(item.id)
  const clonando = est.clonando === item.id && item.origin === 'catalogo'
  return (
    <Box
      key={`est-lib-${item.id}`}
      flexDirection="column"
      borderStyle="round"
      borderColor={ativo ? 'success' : 'subtle'}
      paddingX={1}
    >
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Text>{`${item.icon} `}</Text>
        <Text weight="bold">{item.title}</Text>
        <Text dimColor>{item.origin === 'catalogo' ? ' · do catálogo' : ' · seu'}</Text>
        {ativo ? <Text color="success"> · ATIVO</Text> : null}
        {desatualizado ? <Text color="warning">· versão nova</Text> : null}
        {k.canEdit && item.origin === 'proprio' ? (
          <Button key={`est-editar-${item.id}`} plain onPress={() => void abrirEdicao($, item.id)}>
            ✏️ Editar
          </Button>
        ) : null}
        {k.canEdit && item.origin === 'catalogo' && !clonando ? (
          <Button key={`est-clonar-lib-${item.id}`} plain onPress={() => void iniciarClone($, item.id)}>
            Clonar para editar
          </Button>
        ) : null}
      </Box>
      <Text dimColor>{item.summary}</Text>
      <Text dimColor>{truncate(`${item.agents.length} agentes: ${item.agents.join(', ')}`, 200)}</Text>
      <Text dimColor>{`Salvo em ${formatDate(item.createdAt)}`}</Text>
      {clonando ? caixaClone($, ctx, est) : null}
      {est.ocupado ? (
        trabalhando(k)
      ) : (
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {ativo || !k.canEdit ? null : (
            <Button
              key={`est-usar-${item.id}`}
              variant="primary"
              onPress={() =>
                void (est.ativo
                  ? setEstruturas($, { confirmar: 'aplicar', alvoConfirmacao: item.id, origemSelecionado: 'biblioteca' })
                  : aplicarTemplate($, item.id))
              }
            >
              Usar neste projeto
            </Button>
          )}
          {desatualizado && k.canEdit ? (
            <Button key={`est-atualizar-copia-${item.id}`} onPress={() => void atualizarCopia($, item.id)}>
              Atualizar
            </Button>
          ) : null}
          <Button key={`est-apagar-${item.id}`} plain dimColor onPress={() => void setEstruturas($, { confirmar: 'apagar', alvoConfirmacao: item.id })}>
            Apagar
          </Button>
        </Box>
      )}
    </Box>
  )
}

function bibliotecaView($: Dollar, ctx: Ctx, est: EstruturasUi): RenderElement {
  const { k } = ctx
  const { Box, Text, Button } = k
  return (
    <Box flexDirection="column" gap={1}>
      {k.canEdit ? (
        <Box flexDirection="column" gap={1}>
          <Text weight="bold">Salvar a estrutura deste projeto como template</Text>
          <Text dimColor>{`Entram os ${agentesDoProjeto(ctx).length} agentes de .claude/agents e o fluxo do CLAUDE.md: o bloco do template ativo ou, se não houver bloco marcado, o CLAUDE.md inteiro.`}</Text>
          {field(k, 'est-titulo', 'Nome', est.titulo, { placeholder: 'ex.: Meu squad de jogos' }, valor => setEstruturas($, { titulo: valor }))}
          {field(k, 'est-resumo', 'Resumo', est.resumo, { placeholder: 'para que serve esta equipe' }, valor => setEstruturas($, { resumo: valor }))}
          {picker(k, 'est-icone', 'Ícone', ICONES, est.icone || '🧩', false, valor => setEstruturas($, { icone: valor }))}
          {est.ocupado ? (
            trabalhando(k)
          ) : (
            <Button key="est-salvar" variant="primary" onPress={() => void salvarComoTemplate($)}>
              Salvar como template
            </Button>
          )}
        </Box>
      ) : null}
      {toggleButton(k, 'est-sobrescrever-lib', 'Sobrescrever agentes com o mesmo nome', est.sobrescrever, () =>
        setEstruturas($, { sobrescrever: !est.sobrescrever }),
      )}
      {est.biblioteca.length === 0 ? (
        <Text dimColor>Nenhum template ainda. Baixe um do catálogo ou salve a estrutura deste projeto.</Text>
      ) : (
        est.biblioteca.map(item => cartaoBiblioteca($, ctx, est, item))
      )}
    </Box>
  )
}

/** Aviso no topo da aba: o que mudou no projeto desde o template ativo (e o fluxo), com as ações para levar a mudança a um dos lados. */
function avisoMudancasView($: Dollar, ctx: Ctx, est: EstruturasUi, emEdicao: boolean): RenderElement | null {
  const ativo = est.biblioteca.find(item => item.id === est.ativo)
  if (ativo === undefined || (est.mudancas.length === 0 && !est.fluxoMudou)) return null
  const { k } = ctx
  const { Box, Text, Button } = k
  const linhas = [...est.mudancas.map(mudanca => `${mudanca.file} (${mudanca.tipo})`), ...(est.fluxoMudou ? ['fluxo do CLAUDE.md'] : [])]
  return (
    <Box flexDirection="column" gap={1} borderStyle="round" borderColor="warning" paddingX={1}>
      <Text weight="bold">Mudou desde o template:</Text>
      {linhas.map(linha => (
        <Text>{`• ${linha}`}</Text>
      ))}
      {est.ocupado ? (
        trabalhando(k)
      ) : emEdicao ? (
        // Com um template aberto, as ações ficariam fora de sincronia com o editor: só depois de voltar.
        <Text dimColor>Volte da edição do template para atualizar ou aplicar.</Text>
      ) : k.canEdit ? (
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {ativo.origin === 'proprio' ? (
            <Button key="est-atualizar-template" variant="primary" onPress={() => void atualizarTemplateComProjeto($)}>
              Atualizar o template com o projeto
            </Button>
          ) : (
            <Button
              key="est-salvar-como-seu"
              variant="primary"
              onPress={() =>
                void setEstruturas($, {
                  aba: 'biblioteca',
                  titulo: `${ativo.title} (minha versão)`,
                  selecionado: '',
                  confirmar: '',
                  alvoConfirmacao: '',
                })
              }
            >
              Salvar como template seu
            </Button>
          )}
          <Button key="est-aplicar-template" onPress={() => void aplicarTemplateNoProjeto($)}>
            Aplicar o template no projeto
          </Button>
        </Box>
      ) : null}
    </Box>
  )
}

/** Símbolo e cor de cada estado de um plugin necessário. */
const ESTADO_DEP: Record<DepInfo['estado'], { simbolo: string; cor: string }> = {
  atual: { simbolo: '✓', cor: 'success' },
  desatualizada: { simbolo: '↑', cor: 'warning' },
  faltando: { simbolo: '✗', cor: 'error' },
  local: { simbolo: '●', cor: 'subtle' },
  desconhecida: { simbolo: '?', cor: 'subtle' },
}

/** Versão que aparece ao lado do nome do plugin, conforme o estado. */
function versaoDe(dep: DepInfo): string {
  if (dep.estado === 'atual') return dep.instalada
  if (dep.estado === 'desatualizada') return `${dep.instalada} → ${dep.ultima}`
  if (dep.estado === 'faltando') return 'não instalado'
  if (dep.estado === 'local') return `${dep.instalada} · pasta local`
  return dep.instalada || '?'
}

/** Linha de título: o que precisa de atenção; se nada está desatualizado nem faltando, "Os N em dia". */
function resumoDeps(lista: readonly DepInfo[]): string {
  const desatualizados = lista.filter(dep => dep.estado === 'desatualizada').length
  const faltando = lista.filter(dep => dep.estado === 'faltando').length
  if (desatualizados === 0 && faltando === 0) return `Os ${lista.length} em dia`
  const partes: string[] = []
  if (desatualizados > 0) partes.push(`${desatualizados} com versão nova`)
  if (faltando > 0) partes.push(faltando === 1 ? '1 não instalado' : `${faltando} não instalados`)
  return partes.join(', ')
}

/** Comandos para o terminal, para quando o `claude` não roda aqui: um `marketplace update` por marketplace não local e um `update`/`install` por plugin. */
function comandosManuais(lista: readonly DepInfo[]): string[] {
  // Marketplace local: algum plugin dele está como 'local' (pasta do desenvolvedor). Esses não são atualizados.
  const locais = new Set(lista.filter(dep => dep.estado === 'local').map(dep => dep.marketplace))
  const marketplaces = lista
    .map(dep => dep.marketplace)
    .filter((nome, i, todos) => nome !== '' && !locais.has(nome) && todos.indexOf(nome) === i)
  const linhas = marketplaces.map(nome => ['claude', 'plugin', 'marketplace', 'update', nome].join(' '))
  for (const dep of lista) {
    const comando = comandoDe(dep)
    if (comando !== null) linhas.push(comando.join(' '))
  }
  return linhas
}

/** Uma linha por plugin: símbolo do estado, nome, versão, para que serve e o botão Instalar/Atualizar. */
function linhaDependencia($: Dollar, ctx: Ctx, est: EstruturasUi, dep: DepInfo): RenderElement {
  const { k } = ctx
  const { Box, Text, Button } = k
  const { simbolo, cor } = ESTADO_DEP[dep.estado]
  const podeAtualizar = comandoDe(dep) !== null && k.canEdit && !est.verificandoDeps
  return (
    <Box key={`est-dep-${dep.nome}`} flexDirection="row" gap={1} flexWrap="wrap">
      <Text color={cor}>{simbolo}</Text>
      <Text weight="bold">{dep.nome}</Text>
      <Text dimColor>{versaoDe(dep)}</Text>
      <Text dimColor>{`· ${dep.para}`}</Text>
      {podeAtualizar ? (
        <Button key={`est-dep-atualizar-${dep.nome}`} onPress={() => void atualizarDependencia($, dep.id)}>
          {dep.estado === 'faltando' ? 'Instalar' : 'Atualizar'}
        </Button>
      ) : null}
    </Box>
  )
}

/** Bloco "Plugins necessários": a versão de cada plugin do estúdio e como atualizar. Abre sozinho se algo precisa de atenção. */
function dependenciasView($: Dollar, ctx: Ctx, est: EstruturasUi): RenderElement {
  const { k } = ctx
  const { Box, Text, Button } = k
  const lista = est.dependencias
  const precisaAtencao = lista.some(dep => dep.estado === 'desatualizada' || dep.estado === 'faltando')
  const aberto = precisaAtencao || est.verDeps
  const rodape = !k.canEdit ? (
    <Text dimColor>Para atualizar, abra o painel no desktop, no VS Code ou no terminal.</Text>
  ) : est.verificandoDeps ? (
    <Text color="claude">⏳ Verificando…</Text>
  ) : (
    <Box flexDirection="row" gap={1} flexWrap="wrap">
      <Button key="est-dep-procurar" onPress={() => void procurarAtualizacoes($)}>
        Procurar atualizações
      </Button>
      {lista.some(dep => comandoDe(dep) !== null) ? (
        <Button key="est-dep-todas" variant="primary" onPress={() => void atualizarTodas($)}>
          Atualizar todos
        </Button>
      ) : null}
    </Box>
  )
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Text weight="bold">Plugins necessários</Text>
        <Text dimColor>{resumoDeps(lista)}</Text>
        {precisaAtencao ? null : (
          <Button key="est-dep-ver" plain dimColor onPress={() => void setEstruturas($, { verDeps: !est.verDeps })}>
            {est.verDeps ? '▾ Ocultar' : '▸ Ver os plugins'}
          </Button>
        )}
      </Box>
      {aberto ? (
        <Box flexDirection="column" gap={1}>
          {lista.map(dep => linhaDependencia($, ctx, est, dep))}
          {rodape}
          {est.claudeAusente ? (
            <Box flexDirection="column">
              {comandosManuais(lista).map(comando => (
                <Text dimColor>{comando}</Text>
              ))}
            </Box>
          ) : null}
        </Box>
      ) : null}
    </Box>
  )
}

export function estruturasView($: Dollar, ctx: Ctx, est: EstruturasUi, edicao: LocalTemplate | null): RenderElement {
  const { k } = ctx
  const { Box, Text, Button } = k
  if (!est.carregado) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>Carregando estruturas…</Text>
        <Button key="est-carregar" variant="primary" onPress={() => void carregarEstruturas($)}>
          Carregar
        </Button>
      </Box>
    )
  }
  // Sem estrutura encontrada para o id selecionado, a aba volta à lista do catálogo.
  const detalhe = est.aba === 'catalogo' && est.selecionado ? estruturaPorId(est.selecionado) : undefined
  // Template aberto no editor: as abas somem e a tela dele (edicaoView, em estruturas-edicao) substitui as listas.
  const editor = edicao !== null && edicao.id === est.editando ? edicao : null
  const remover = est.ativo === '' ? null : est.ocupado ? (
    trabalhando(k)
  ) : (
    <Button key="est-remover" plain dimColor onPress={() => void setEstruturas($, { confirmar: 'remover' })}>
      Remover do projeto
    </Button>
  )
  return (
    <Box flexDirection="column" gap={1}>
      {editor === null ? (
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button
            key="est-aba-catalogo"
            variant={est.aba === 'catalogo' ? 'primary' : 'secondary'}
            onPress={() => void setEstruturas($, { aba: 'catalogo', selecionado: '', confirmar: '', alvoConfirmacao: '', clonando: '' })}
          >
            {`Catálogo (${ESTRUTURAS.length})`}
          </Button>
          <Button
            key="est-aba-biblioteca"
            variant={est.aba === 'biblioteca' ? 'primary' : 'secondary'}
            onPress={() => void setEstruturas($, { aba: 'biblioteca', selecionado: '', confirmar: '', alvoConfirmacao: '', clonando: '' })}
          >
            {`Meus templates (${est.biblioteca.length})`}
          </Button>
        </Box>
      ) : null}
      <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
        {est.ativo ? <Text>{`Ativo neste projeto: ${nomeDe(est, est.ativo)}`}</Text> : <Text dimColor>Nenhum template ativo neste projeto</Text>}
        {remover}
      </Box>
      {avisoMudancasView($, ctx, est, editor !== null)}
      {est.squadVersao === '' ? (
        <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
          <Text>⚠ O plugin squad-stream não está instalado: as equipes conversam pela sala dele.</Text>
          <Text dimColor>{'Ele vem como dependência do estúdio: adicione o marketplace marco3079/skill-squad-room (no app desktop, + → Plugins → Add marketplace; no terminal, /plugin marketplace add marco3079/skill-squad-room) e rode /reload-plugins.'}</Text>
        </Box>
      ) : null}
      {editor === null && est.carregado && est.dependencias.length > 0 ? dependenciasView($, ctx, est) : null}
      {confirmacaoView($, ctx, est)}
      {editor !== null
        ? edicaoView($, ctx, est, editor)
        : est.aba === 'biblioteca'
          ? bibliotecaView($, ctx, est)
          : detalhe
            ? detalheView($, ctx, est, detalhe)
            : catalogoView($, ctx, est)}
    </Box>
  )
}
