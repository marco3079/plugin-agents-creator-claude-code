// Aba "Estruturas": o catálogo de templates de equipes, a biblioteca local ("Meus templates") e o
// template ativo do projeto. As ações (baixar, trocar, remover, salvar, apagar) ficam em ../estruturas.

import type { RenderElement } from 'claude-code'

import type { EstruturasUi, LibraryItem } from '../../types'
import {
  apagarDaBiblioteca,
  aplicarTemplate,
  baixarDoCatalogo,
  carregarEstruturas,
  conflitosDe,
  removerDoProjeto,
  salvarComoTemplate,
  selecionar,
  setEstruturas,
  voltar,
} from '../estruturas'
import { colorHex, modelLabel, toolsSummary } from '../lib/catalog'
import { CATEGORIAS, ESTRUTURAS, estruturaPorId } from '../lib/estruturas/index'
import { SQUAD_VERSAO_PADRAO, agenteMarkdown, fluxoMarkdown } from '../lib/estruturas/protocolo'
import type { Structure, StructureRole } from '../lib/estruturas/tipos'
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
        </Box>
      )}
    </Box>
  )
}

/** Cartão de um template da biblioteca: origem, agentes, data e as ações. */
function cartaoBiblioteca($: Dollar, ctx: Ctx, est: EstruturasUi, item: LibraryItem): RenderElement {
  const { k } = ctx
  const { Box, Text, Button } = k
  const ativo = est.ativo === item.id
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
      </Box>
      <Text dimColor>{item.summary}</Text>
      <Text dimColor>{truncate(`${item.agents.length} agentes: ${item.agents.join(', ')}`, 200)}</Text>
      <Text dimColor>{`Salvo em ${formatDate(item.createdAt)}`}</Text>
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

export function estruturasView($: Dollar, ctx: Ctx, est: EstruturasUi): RenderElement {
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
  const remover = est.ativo === '' ? null : est.ocupado ? (
    trabalhando(k)
  ) : (
    <Button key="est-remover" plain dimColor onPress={() => void setEstruturas($, { confirmar: 'remover' })}>
      Remover do projeto
    </Button>
  )
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Button
          key="est-aba-catalogo"
          variant={est.aba === 'catalogo' ? 'primary' : 'secondary'}
          onPress={() => void setEstruturas($, { aba: 'catalogo', selecionado: '', confirmar: '', alvoConfirmacao: '' })}
        >
          {`Catálogo (${ESTRUTURAS.length})`}
        </Button>
        <Button
          key="est-aba-biblioteca"
          variant={est.aba === 'biblioteca' ? 'primary' : 'secondary'}
          onPress={() => void setEstruturas($, { aba: 'biblioteca', selecionado: '', confirmar: '', alvoConfirmacao: '' })}
        >
          {`Meus templates (${est.biblioteca.length})`}
        </Button>
      </Box>
      <Box flexDirection="row" gap={1} flexWrap="wrap" alignItems="center">
        {est.ativo ? <Text>{`Ativo neste projeto: ${nomeDe(est, est.ativo)}`}</Text> : <Text dimColor>Nenhum template ativo neste projeto</Text>}
        {remover}
      </Box>
      {est.squadVersao === '' ? (
        <Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
          <Text>⚠ O plugin squad-stream não está instalado: as equipes conversam pela sala dele.</Text>
          <Text dimColor>{'Ele vem como dependência do estúdio: adicione o marketplace marco3079/skill-squad-room (no app desktop, + → Plugins → Add marketplace; no terminal, /plugin marketplace add marco3079/skill-squad-room) e rode /reload-plugins.'}</Text>
        </Box>
      ) : null}
      {confirmacaoView($, ctx, est)}
      {est.aba === 'biblioteca'
        ? bibliotecaView($, ctx, est)
        : detalhe
          ? detalheView($, ctx, est, detalhe)
          : catalogoView($, ctx, est)}
    </Box>
  )
}
