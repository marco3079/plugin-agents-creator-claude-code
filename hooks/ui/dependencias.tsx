// Tela Dependências (/agentes-dependencias): cada plugin exigido com o que ele precisa (plugins, skills avulsas,
// extensões do VS Code e o servidor do popup), os programas e os botões para instalar, atualizar ou ativar.

import type { RenderElement } from 'claude-code'

import type { DepInfo, EstruturasUi, RequisitoInfo, RequisitosUi } from '../../types'
import { atualizarDependencia } from '../estruturas'
import { comandoDe } from '../lib/dependencias'
import { precisaAtencao } from '../lib/requisitos'
import { corrigirRequisito, corrigirTudo, verificarTudo } from '../requisitos'
import { type Ctx, type Dollar } from './kit'

/** Símbolo e cor de cada estado de um plugin exigido. */
const ESTADO_PLUGIN: Record<DepInfo['estado'], { simbolo: string; cor: string }> = {
  atual: { simbolo: '✓', cor: 'success' }, desatualizada: { simbolo: '↑', cor: 'warning' },
  faltando: { simbolo: '✗', cor: 'error' }, local: { simbolo: '●', cor: 'subtle' },
  desconhecida: { simbolo: '?', cor: 'subtle' }, desativada: { simbolo: '⏸', cor: 'warning' },
}

/** Símbolo e cor de cada estado de um requisito. */
const ESTADO_REQ: Record<RequisitoInfo['estado'], { simbolo: string; cor: string }> = {
  ok: { simbolo: '✓', cor: 'success' }, desatualizado: { simbolo: '↑', cor: 'warning' },
  faltando: { simbolo: '✗', cor: 'error' }, parado: { simbolo: '■', cor: 'error' },
  opcional: { simbolo: '–', cor: 'subtle' }, desconhecido: { simbolo: '?', cor: 'subtle' },
}

/** Versão que aparece ao lado do nome do plugin, conforme o estado. */
function versaoPlugin(dep: DepInfo): string {
  if (dep.estado === 'faltando') return 'não instalado'
  if (dep.estado === 'desativada') return `${dep.instalada} · desativado`
  if (dep.estado === 'local') return `${dep.instalada} · pasta local`
  if (dep.estado === 'desatualizada') return `${dep.instalada} → ${dep.ultima}`
  return dep.instalada || '?'
}

/** Versão de um requisito: a do programa e o mínimo dele; nos outros, a encontrada e a esperada quando diferem. */
function versaoReq(r: RequisitoInfo): string {
  if (r.tipo === 'programa') {
    if (r.estado === 'ok') return r.encontrada
    if (r.estado === 'desatualizado') return `${r.encontrada} (precisa do ${r.esperada} ou mais novo)`
    return ''
  }
  if (r.encontrada && r.esperada && r.encontrada !== r.esperada) return `${r.encontrada} → ${r.esperada}`
  if (r.encontrada) return r.encontrada
  return ''
}

/** Rótulo do botão de um requisito: Copiar (skill), Instalar (o que falta), Atualizar; nenhum no servidor. */
function acaoReq(r: RequisitoInfo): string {
  if (r.tipo === 'servidor') return ''
  if (r.estado === 'faltando') return r.tipo === 'skill' ? 'Copiar' : 'Instalar'
  if (r.estado === 'desatualizado') return 'Atualizar'
  return ''
}

/** Rótulo do botão de um plugin: Instalar, Ativar ou Atualizar; vazio quando não há comando para ele. */
function acaoPlugin(dep: DepInfo): string {
  if (comandoDe(dep) === null) return ''
  if (dep.estado === 'faltando') return 'Instalar'
  if (dep.estado === 'desativada') return 'Ativar'
  return 'Atualizar'
}

/** Hora e minuto de um instante (em ms), no formato HH:MM. */
function hora(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Linha de título: quantos plugins e requisitos precisam de atenção, ou "tudo em dia" / "falta verificar". */
function resumoGeral(est: EstruturasUi, req: RequisitosUi): string {
  const p = est.dependencias.filter(dep => dep.estado === 'faltando' || dep.estado === 'desatualizada' || dep.estado === 'desativada').length
  const r = req.lista.filter(item => precisaAtencao(item.estado) || (item.tipo === 'servidor' && item.estado === 'desconhecido' && req.verificadoEm > 0)).length
  if (p === 0 && r === 0) return req.verificadoEm > 0 ? 'tudo em dia' : 'falta verificar'
  const partes: string[] = []
  if (p > 0) partes.push(p === 1 ? '1 plugin' : `${p} plugins`)
  if (r > 0) partes.push(r === 1 ? '1 requisito' : `${r} requisitos`)
  return `${partes.join(' e ')} com pendência`
}

/** Uma linha de requisito: o símbolo do estado, o nome, a versão, para que serve e o botão, quando há ação. */
function linhaReq($: Dollar, ctx: Ctx, ocupado: boolean, r: RequisitoInfo): RenderElement {
  const { k } = ctx
  const { Box, Text, Button } = k
  const { simbolo, cor } = ESTADO_REQ[r.estado]
  const versao = versaoReq(r)
  const acao = acaoReq(r)
  return (
    <Box key={`dep-req-${r.id}`} flexDirection="row" gap={1} flexWrap="wrap" paddingLeft={3}>
      <Text color={cor}>{simbolo}</Text>
      <Text>{r.nome}</Text>
      {versao ? <Text dimColor>{versao}</Text> : null}
      <Text dimColor>{`· ${r.para}`}</Text>
      {r.detalhe ? <Text dimColor>{`· ${r.detalhe}`}</Text> : null}
      {acao !== '' && k.canEdit && !ocupado ? (
        <Button key={`dep-acao-${r.id}`} onPress={() => void corrigirRequisito($, r.id)}>{acao}</Button>
      ) : null}
    </Box>
  )
}

/** Um plugin exigido: a linha dele (estado, nome, versão e botão) e, embaixo, o que ele precisa. */
function linhaPlugin($: Dollar, ctx: Ctx, ocupado: boolean, dep: DepInfo, filhos: readonly RequisitoInfo[]): RenderElement {
  const { k } = ctx
  const { Box, Text, Button } = k
  const { simbolo, cor } = ESTADO_PLUGIN[dep.estado]
  const acao = acaoPlugin(dep)
  return (
    <Box key={`dep-plugin-${dep.nome}`} flexDirection="column">
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Text color={cor}>{simbolo}</Text>
        <Text weight="bold">{dep.nome}</Text>
        <Text dimColor>{versaoPlugin(dep)}</Text>
        <Text dimColor>{`· ${dep.para}`}</Text>
        {acao !== '' && k.canEdit && !ocupado ? (
          <Button key={`dep-plugin-acao-${dep.nome}`} onPress={() => void atualizarDependencia($, dep.id)}>{acao}</Button>
        ) : null}
      </Box>
      {filhos.map(r => linhaReq($, ctx, ocupado, r))}
    </Box>
  )
}

/** A tela Dependências: os plugins com o que cada um precisa, os programas e os botões Verificar tudo e Corrigir tudo. */
export function dependenciasTela($: Dollar, ctx: Ctx, est: EstruturasUi, req: RequisitosUi): RenderElement {
  const { k } = ctx
  const { Box, Text, Button } = k
  const ocupado = req.ocupado || est.verificandoDeps
  // Cada requisito que não é programa aparece embaixo do plugin que precisa dele; o que sobra é "do próprio estúdio".
  const mostrados = new Set<string>()
  const porPlugin = est.dependencias.map(dep => {
    const filhos = req.lista.filter(r => r.tipo !== 'programa' && r.de.includes(dep.id))
    for (const r of filhos) mostrados.add(r.id)
    return { dep, filhos }
  })
  const doEstudio = req.lista.filter(r => r.tipo !== 'programa' && !mostrados.has(r.id))
  const programas = req.lista.filter(r => r.tipo === 'programa')
  // Os programas não entram: "Corrigir tudo" não instala programa (isso é por botão, na linha do programa).
  const corrigivel =
    est.dependencias.some(dep => comandoDe(dep) !== null) ||
    req.lista.some(r => (r.tipo === 'plugin' || r.tipo === 'skill' || r.tipo === 'extensao') && (r.estado === 'faltando' || r.estado === 'desatualizado'))
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        <Text weight="bold">Dependências</Text>
        <Text dimColor>{resumoGeral(est, req)}</Text>
      </Box>
      <Text dimColor>Os plugins de que o estúdio precisa e o que cada um precisa para funcionar: skills, extensões do VS Code, programas e o servidor do popup.</Text>
      {req.verificadoEm === 0 ? (
        <Text dimColor>Ainda não verificado nesta sessão: Verificar tudo procura versões novas e testa os programas e o servidor do popup.</Text>
      ) : (
        <Text dimColor>{`Última verificação: ${hora(req.verificadoEm)}`}</Text>
      )}
      {!k.canEdit ? (
        <Text dimColor>Para instalar ou atualizar, abra o painel no desktop, no VS Code ou no terminal.</Text>
      ) : ocupado ? (
        <Text color="claude">⏳ Verificando…</Text>
      ) : (
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="dep-verificar" onPress={() => void verificarTudo($)}>Verificar tudo</Button>
          {corrigivel ? (
            <Button key="dep-corrigir" variant="primary" onPress={() => void corrigirTudo($)}>Corrigir tudo</Button>
          ) : null}
        </Box>
      )}
      <Text weight="bold">Plugins e o que cada um precisa</Text>
      {porPlugin.map(({ dep, filhos }) => linhaPlugin($, ctx, ocupado, dep, filhos))}
      {doEstudio.length > 0 ? <Text weight="bold">Do próprio estúdio</Text> : null}
      {doEstudio.map(r => linhaReq($, ctx, ocupado, r))}
      {programas.length > 0 ? <Text weight="bold">Programas</Text> : null}
      {programas.map(r => linhaReq($, ctx, ocupado, r))}
      {req.manuais.length > 0 ? <Text dimColor>Para rodar no terminal:</Text> : null}
      {req.manuais.map(comando => (
        <Text>{comando}</Text>
      ))}
      {!req.carregado && est.dependencias.length === 0 ? <Text dimColor>Carregando…</Text> : null}
    </Box>
  )
}
