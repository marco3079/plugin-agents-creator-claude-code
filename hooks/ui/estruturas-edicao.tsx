// Tela do template aberta para edição (só templates "seus"): nome, resumo, ícone e fluxo do CLAUDE.md, e os
// agentes do template, com Editar (abre o editor do estúdio, que salva no template) e Remover. Os campos mostram
// o rascunho (est.edicao*); o cabeçalho e a lista de agentes mostram o que está salvo (`edicao`, lido do disco).

import type { RenderElement } from 'claude-code'

import type { EstruturasUi } from '../../types'
import { editarAgenteDoTemplate, fecharEdicao, novoAgenteNoTemplate, salvarEdicao, setEdicao, setEstruturas } from '../estruturas'
import { parseAgent } from '../lib/agent'
import type { LocalTemplate, TemplateAgent } from '../lib/estruturas/tipos'
import { type Ctx, type Dollar, field, picker, truncate } from './kit'

// A mesma lista de ícones do bloco "Salvar" de estruturas.tsx.
const ICONES = ['🧩', '🛠️', '⚖️', '📈', '🎬', '🎓', '🔬', '📡', '🛡️', '🎧', '🎮', '🤖'].map(icone => ({ value: icone, label: icone }))

/** Um agente do template: nome e descrição (lidos do .md); Editar e Remover só onde dá para editar. */
function agenteView($: Dollar, ctx: Ctx, agente: TemplateAgent): RenderElement {
  const { k } = ctx
  const { Box, Text, Button } = k
  const { fields } = parseAgent(agente.content)
  return (
    <Box key={`est-edicao-linha-${agente.file}`} flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={1}>
      <Text weight="bold">{fields.name.trim() || agente.file}</Text>
      {fields.description.trim() ? <Text dimColor>{truncate(fields.description, 200)}</Text> : null}
      {k.canEdit ? (
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key={`est-edicao-agente-${agente.file}`} onPress={() => void editarAgenteDoTemplate($, agente.file)}>
            Editar
          </Button>
          <Button
            key={`est-edicao-remover-${agente.file}`}
            plain
            dimColor
            onPress={() => void setEstruturas($, { confirmar: 'remover-agente', alvoConfirmacao: agente.file })}
          >
            Remover
          </Button>
        </Box>
      ) : null}
    </Box>
  )
}

/** Fluxo do CLAUDE.md: campo de texto onde o kit edita; senão, o Markdown salvo e a explicação. */
function fluxoView($: Dollar, ctx: Ctx, est: EstruturasUi, edicao: LocalTemplate): RenderElement {
  const { k } = ctx
  const { Box, Text, Markdown } = k
  if (k.Input) {
    return field(k, 'est-edicao-fluxo', 'Fluxo do CLAUDE.md', est.edicaoFluxo, { rows: 8 }, valor =>
      setEdicao($, { edicaoFluxo: valor }),
    )
  }
  return (
    <Box flexDirection="column" gap={1}>
      <Text dimColor>Fluxo do CLAUDE.md</Text>
      {edicao.claudeMd.trim() ? <Markdown text={edicao.claudeMd} /> : <Text>—</Text>}
      <Text dimColor>{'O fluxo vem do CLAUDE.md do projeto: ele muda com "Atualizar o template com o projeto".'}</Text>
    </Box>
  )
}

/** Tela do template: o que se edita no template (nome, resumo, ícone, fluxo) e os agentes dele. Substitui as listas da aba. */
export function edicaoView($: Dollar, ctx: Ctx, est: EstruturasUi, edicao: LocalTemplate): RenderElement {
  const { k } = ctx
  const { Box, Text, Button } = k
  return (
    <Box flexDirection="column" gap={1}>
      <Button key="est-edicao-voltar" plain onPress={() => void fecharEdicao($)}>
        {est.edicaoSujo ? '← Voltar sem salvar' : '← Voltar'}
      </Button>
      <Box flexDirection="column">
        <Text weight="bold">{`✏️ ${edicao.icon} ${edicao.title}`}</Text>
        {edicao.id === est.ativo ? (
          <Text dimColor>
            {'Este template está ativo neste projeto. Depois de salvar, volte e use "Aplicar o template no projeto" no topo da aba.'}
          </Text>
        ) : null}
        {k.canEdit ? null : <Text dimColor>{'Para editar, abra o painel no desktop, no VS Code ou no terminal.'}</Text>}
      </Box>
      <Box flexDirection="column" gap={1}>
        {field(k, 'est-edicao-titulo', 'Nome', est.edicaoTitulo, { placeholder: 'ex.: Meu squad de jogos' }, valor =>
          setEdicao($, { edicaoTitulo: valor }),
        )}
        {field(k, 'est-edicao-resumo', 'Resumo', est.edicaoResumo, { placeholder: 'para que serve esta equipe' }, valor =>
          setEdicao($, { edicaoResumo: valor }),
        )}
        {picker(k, 'est-edicao-icone', 'Ícone', ICONES, est.edicaoIcone || '🧩', false, valor =>
          setEdicao($, { edicaoIcone: valor }),
        )}
        {fluxoView($, ctx, est, edicao)}
      </Box>
      {k.canEdit && est.edicaoSujo ? (
        <Button key="est-edicao-salvar" variant="primary" onPress={() => void salvarEdicao($)}>
          Salvar
        </Button>
      ) : null}
      <Box flexDirection="column" gap={1}>
        <Text weight="bold">Agentes do template</Text>
        {k.canEdit ? (
          <Text dimColor>{'Editar abre o agente no editor. Ao salvar, a mudança vai só para o template: o projeto não muda.'}</Text>
        ) : null}
        {edicao.agents.map(agente => agenteView($, ctx, agente))}
        {k.canEdit ? (
          <Button key="est-edicao-novo" onPress={() => void novoAgenteNoTemplate($)}>
            + Novo agente
          </Button>
        ) : null}
      </Box>
    </Box>
  )
}
