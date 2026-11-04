// Peças compartilhadas pelas telas do painel: a tabela de elementos da superfície, o contexto
// de desenho e componentes pequenos (seção recolhível, aviso, faixa, navegação, campos).

import type {
  BoxProps,
  ButtonProps,
  CodeProps,
  ElementConstructor,
  EngineInterface,
  InputProps,
  MarkdownProps,
  RenderElement,
  SelectProps,
  SvgProps,
  TextProps,
} from 'claude-code'

import type { Catalog, Draft, Flags, GenState, LiveTool, Status, TestState, TrashItem, View } from '../../types'
import { clearStatus, go, newDraft, recover, refresh, toggleSection } from '../actions'
import { abrirEstruturas } from '../estruturas'
import { colorHex } from '../lib/catalog'
import { bannerSvg } from '../lib/svg'

export type Dollar = EngineInterface

/** Os elementos que a superfície desenha. `Input`/`Select` faltam no celular; `Svg`, no terminal. */
export type Kit = {
  surface: string
  cols: number
  canEdit: boolean
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  Code: ElementConstructor<CodeProps>
  Markdown: ElementConstructor<MarkdownProps>
  Input: ElementConstructor<InputProps> | null
  Select: ElementConstructor<SelectProps> | null
  Svg: ElementConstructor<SvgProps> | null
}

/**
 * Monta o kit a partir da tabela de `$.ui.resolve(e)`. A tabela é completada com todos os nomes
 * (um elemento que a superfície não tem vira um fragmento vazio), por isso decide pelo nome da superfície.
 */
export function makeKit(table: unknown, surface: string, cols: number): Kit {
  const t = table as Record<string, unknown>
  const canEdit = surface === 'terminal' || surface === 'desktop' || surface === 'vscode'
  const hasSvg = surface === 'desktop' || surface === 'vscode' || surface === 'mobile'
  return {
    surface,
    cols,
    canEdit,
    Box: t.Box as ElementConstructor<BoxProps>,
    Text: t.Text as ElementConstructor<TextProps>,
    Button: t.Button as ElementConstructor<ButtonProps>,
    Code: t.Code as ElementConstructor<CodeProps>,
    Markdown: t.Markdown as ElementConstructor<MarkdownProps>,
    Input: canEdit ? (t.Input as ElementConstructor<InputProps>) : null,
    Select: canEdit ? (t.Select as ElementConstructor<SelectProps>) : null,
    Svg: hasSvg ? (t.Svg as ElementConstructor<SvgProps>) : null,
  }
}

export type Ctx = {
  k: Kit
  view: View
  filter: string
  catalog: Catalog | null
  draft: Draft | null
  stash: Draft | null
  status: Status
  gen: GenState
  test: TestState
  flags: Flags
  running: Record<string, string>
  usage: Record<string, number>
  trash: TrashItem[]
  liveTools: LiveTool[]
}

/** Largura em pixels para os SVGs, a partir das colunas do painel. */
export function svgWidth(k: Kit): number {
  return Math.round(Math.max(260, Math.min(720, k.cols * 7.4)))
}

export function isOpen(flags: Flags, id: string, byDefault: boolean): boolean {
  return byDefault !== flags.toggled.includes(id)
}

export type Style = { color: string; icon: string }

const INFO_STYLE: Style = { color: 'suggestion', icon: 'ℹ' }

const STYLES: Record<string, Style> = {
  info: INFO_STYLE,
  tip: INFO_STYLE,
  ok: { color: 'success', icon: '✓' },
  warn: { color: 'warning', icon: '⚠' },
  error: { color: 'error', icon: '✖' },
}

export function styleOf(kind: string): Style {
  return STYLES[kind] ?? INFO_STYLE
}

/** Seção com cabeçalho clicável; o corpo só é montado quando a seção está aberta. */
export function section(
  $: Dollar,
  ctx: Ctx,
  id: string,
  title: string,
  byDefault: boolean,
  body: () => RenderElement,
  badge = '',
): RenderElement {
  const { k } = ctx
  const { Box, Text, Button } = k
  const open = isOpen(ctx.flags, id, byDefault)
  return (
    <Box flexDirection="column" gap={open ? 1 : 0}>
      <Button key={`secao-${id}`} plain onPress={() => void toggleSection($, id)}>
        <Text weight="bold" color="claude">
          {open ? '▾ ' : '▸ '}
        </Text>
        <Text weight="bold">{title}</Text>
        <Text dimColor>{badge ? `  ${badge}` : ' '}</Text>
      </Button>
      {open ? (
        <Box flexDirection="column" gap={1} paddingLeft={2}>
          {body()}
        </Box>
      ) : null}
    </Box>
  )
}

/** Linha de aviso abaixo da navegação. */
export function statusBar($: Dollar, ctx: Ctx): RenderElement | null {
  const { k, status, stash } = ctx
  const { Box, Text, Button } = k
  if (!status) return null
  const style = styleOf(status.kind)
  return (
    <Box borderStyle="round" borderColor={style.color} paddingX={1} flexDirection="row" gap={1} alignItems="flex-start">
      <Text color={style.color}>{style.icon}</Text>
      <Box flexGrow={1} flexShrink={1}>
        <Text>{status.text}</Text>
      </Box>
      {stash ? (
        <Button key="aviso-recuperar" onPress={() => void recover($)}>
          Recuperar
        </Button>
      ) : null}
      <Button key="aviso-fechar" plain dimColor onPress={() => void clearStatus($)}>
        ✕
      </Button>
    </Box>
  )
}

/** Faixa do topo: SVG nas superfícies gráficas, texto no terminal. */
export function banner($: Dollar, ctx: Ctx, subtitle: string): RenderElement {
  const { k } = ctx
  const { Box, Text, Svg } = k
  if (Svg) {
    const colors = (ctx.catalog?.agents ?? []).map(agent => colorHex(agent.color))
    const width = svgWidth(k)
    return (
      <Svg
        source={bannerSvg(width, 'Estúdio de Agentes', subtitle, colors)}
        alt={`Estúdio de Agentes: ${subtitle}`}
        width={width}
        height={76}
      />
    )
  }
  return (
    <Box flexDirection="column">
      <Text weight="bold" color="claude">
        ◆ Estúdio de Agentes
      </Text>
      <Text dimColor>{subtitle}</Text>
    </Box>
  )
}

type NavItem = { key: string; label: string; target: View | 'novo' }

/** Barra de navegação entre as telas. */
export function nav($: Dollar, ctx: Ctx): RenderElement {
  const { k, view, draft, trash } = ctx
  const { Box, Button } = k
  const items: NavItem[] = [
    { key: 'lista', label: 'Agentes', target: 'lista' },
    { key: 'novo', label: '+ Novo', target: 'novo' },
    { key: 'gerar', label: '✨ Gerar', target: 'gerar' },
    { key: 'modelos', label: 'Modelos', target: 'modelos' },
    { key: 'estruturas', label: 'Estruturas', target: 'estruturas' },
    { key: 'mapa', label: 'Mapa', target: 'mapa' },
  ]
  if (draft && view !== 'editor') {
    items.splice(1, 0, { key: 'editor', label: `✎ ${draft.fields.name || 'rascunho'}${draft.dirty ? ' ●' : ''}`, target: 'editor' })
  }
  if (trash.length > 0) items.push({ key: 'lixeira', label: `Lixeira (${trash.length})`, target: 'lixeira' })
  return (
    <Box flexDirection="row" gap={1} flexWrap="wrap">
      {items.map(item => (
        <Button
          key={`nav-${item.key}`}
          variant={item.target === view ? 'primary' : 'secondary'}
          onPress={() =>
            void (item.target === 'novo' ? newDraft($, null) : item.target === 'estruturas' ? abrirEstruturas($) : go($, item.target))
          }
        >
          {item.label}
        </Button>
      ))}
      <Button key="nav-atualizar" plain dimColor onPress={() => void refresh($)}>
        ↻ atualizar
      </Button>
    </Box>
  )
}

export type FieldOptions = { placeholder?: string; rows?: number; readOnly?: boolean; submitLabel?: string }

/** Campo de texto, ou o valor como texto quando a superfície não edita. */
export function field(
  k: Kit,
  key: string,
  label: string,
  value: string,
  options: FieldOptions,
  onChange: (value: string) => unknown,
  onEnter?: (value: string) => unknown,
): RenderElement {
  const { Box, Text, Input } = k
  if (!Input || options.readOnly) {
    return (
      <Box flexDirection="column">
        <Text dimColor>{label}</Text>
        <Text>{value.trim() ? value : '—'}</Text>
      </Box>
    )
  }
  const extra: Partial<InputProps> = {}
  if (options.placeholder) extra.placeholder = options.placeholder
  if (options.rows && options.rows > 1) extra.rows = options.rows
  if (options.submitLabel) extra.submitLabel = options.submitLabel
  const submit = onEnter ?? onChange
  return (
    <Input
      key={key}
      label={label}
      value={value}
      {...extra}
      onInput={next => void onChange(next)}
      onSubmit={next => void submit(next)}
    />
  )
}

export type Choice = { value: string; label: string }

/** Seletor, ou o rótulo da opção escolhida quando a superfície não edita. */
export function picker(
  k: Kit,
  key: string,
  label: string,
  options: readonly Choice[],
  value: string,
  readOnly: boolean,
  onPick: (value: string) => unknown,
): RenderElement {
  const { Box, Text, Select } = k
  if (!Select || readOnly) {
    return (
      <Box flexDirection="row" gap={1}>
        <Text dimColor>{`${label}:`}</Text>
        <Text>{options.find(option => option.value === value)?.label ?? value}</Text>
      </Box>
    )
  }
  return <Select key={key} label={label} options={options} value={value} onSelect={next => void onPick(next)} />
}

/** Botão liga/desliga; com `hint`, mostra uma explicação curta e esmaecida ao lado do nome. */
export function toggleButton(
  k: Kit,
  key: string,
  label: string,
  on: boolean,
  onPress: () => unknown,
  options: { readOnly?: boolean; hint?: string } = {},
): RenderElement {
  const { Button, Text } = k
  const text = `${on ? '✓ ' : ''}${label}`
  if (options.readOnly) return <Text dimColor={!on}>{`${on ? '☑' : '☐'} ${label}`}</Text>
  if (options.hint) {
    return (
      <Button key={key} variant={on ? 'primary' : 'secondary'} onPress={() => void onPress()}>
        <Text>{text}</Text>
        <Text dimColor>{` ${options.hint}`}</Text>
      </Button>
    )
  }
  return (
    <Button key={key} variant={on ? 'primary' : 'secondary'} onPress={() => void onPress()}>
      {text}
    </Button>
  )
}

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}
