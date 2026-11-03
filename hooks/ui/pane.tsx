// O painel inteiro: lê o estado da sessão e monta a faixa, a navegação, os avisos e a tela atual.

import type { RenderElement } from 'claude-code'

import { refresh, snapshot } from '../actions'
import { baseName } from '../lib/files'
import { editorView } from './editor'
import { type Ctx, type Dollar, type Kit, banner, nav, statusBar } from './kit'
import { listView } from './list'
import { generateView, mapView, templatesView, trashView } from './screens'

export async function renderPane($: Dollar, k: Kit): Promise<RenderElement> {
  const ctx: Ctx = { k, ...(await snapshot($)) }
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
