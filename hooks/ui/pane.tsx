// O painel inteiro: lê o estado da sessão e monta a faixa, a navegação, os avisos e a tela atual.

import type { RenderElement } from 'claude-code'

import { refresh, snapshot } from '../actions'
import { estruturasSnapshot, modeloEmEdicao } from '../estruturas'
import { estruturaPorId } from '../lib/estruturas/index'
import { baseName } from '../lib/files'
import { editorView } from './editor'
import { estruturasView } from './estruturas'
import { type Ctx, type Dollar, type Kit, banner, nav, statusBar } from './kit'
import { listView } from './list'
import { generateView, mapView, templatesView, trashView } from './screens'

/** Template ativo do projeto para a etiqueta 📦 da Galeria; null sem template ativo ou sem nome para ele. */
async function estruturaAtiva($: Dollar): Promise<Ctx['estrutura']> {
  const ui = await estruturasSnapshot($)
  if (ui.ativo === '') return null
  // O nome vem de Meus templates; se o template não está lá, da estrutura do catálogo com o mesmo id.
  const fonte = ui.biblioteca.find(item => item.id === ui.ativo) ?? estruturaPorId(ui.ativo)
  if (fonte === undefined) return null
  return { titulo: fonte.title, icone: fonte.icon, arquivos: ui.arquivosAtivos }
}

export async function renderPane($: Dollar, k: Kit): Promise<RenderElement> {
  const ctx: Ctx = { k, ...(await snapshot($)), estrutura: await estruturaAtiva($) }
  const { Box, Button } = k
  const { view, catalog, running } = ctx

  const total = catalog?.agents.length ?? 0
  const busy = Object.keys(running).length
  const subtitle = catalog
    ? [`${total} ${total === 1 ? 'agente' : 'agentes'}`, busy > 0 ? `${busy} em execução` : '', baseName(catalog.paths.root)]
        .filter(Boolean)
        .join(' · ')
    : 'carregando…'

  const body =
    view === 'editor'
      ? editorView($, ctx)
      : view === 'modelos'
        ? templatesView($, ctx)
        : view === 'gerar'
          ? generateView($, ctx)
          : view === 'mapa'
            ? mapView($, ctx)
            : view === 'lixeira'
              ? trashView($, ctx)
              : view === 'estruturas'
                ? estruturasView($, ctx, await estruturasSnapshot($), await modeloEmEdicao($))
                : listView($, ctx)

  return (
    <Box flexDirection="column" gap={1}>
      {banner($, ctx, subtitle)}
      {nav($, ctx)}
      {statusBar($, ctx)}
      {catalog ? null : (
        <Button key="carregar" variant="primary" onPress={() => void refresh($)}>
          Carregar agentes
        </Button>
      )}
      {body}
    </Box>
  )
}
