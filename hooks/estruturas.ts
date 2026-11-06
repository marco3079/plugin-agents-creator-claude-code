// Aba Estruturas: catálogo de equipes, Meus templates (biblioteca local), o template ativo de cada projeto, as cópias do
// catálogo e a edição dos templates. Roda em handlers; a aba só lê o estado (`estruturasSnapshot`). O que sai do projeto
// vai antes para a lixeira.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { DepInfo, EstruturasUi, LibraryItem, MudancaAgente, Paths, TrashItem } from '../types'
import { finalSlug } from './lib/agent'
import { DEPENDENCIAS, comandoDe, entradaNoCatalogo, estadoDe, marketplacesConhecidos, versaoDoManifesto, versoesInstaladas } from './lib/dependencias'
import { baseName, joinPath, readText, removeFile, resolvePaths } from './lib/files'
import { ID_SEGURO, agenteValido, caminhoTemplate, gravarTemplate, lerModelo, lerTemplate, pastaBiblioteca } from './lib/estruturas/biblioteca'
import { chaveArquivo, copiaDesatualizada, fluxoMudou, idParaClone, mudancasDoTemplate, normalizarEol, templateCasa } from './lib/estruturas/deteccao'
import type { LocalTemplate, TemplateAgent } from './lib/estruturas/tipos'
import { SQUAD_VERSAO_PADRAO, extrairFluxo, mesclarClaudeMd, removerSecaoClaudeMd, templateDaEstrutura } from './lib/estruturas/protocolo'
import { ESTRUTURAS, estruturaPorId } from './lib/estruturas/index'
import { abrirRascunhoDeTemplate, go, novoRascunhoDeTemplate, pushTrash, refresh, say } from './actions'

type Dollar = EngineInterface

/** Pasta dos agentes do projeto. Os caminhos do estado são relativos à raiz do projeto, com '/'. */
const PASTA_AGENTES = '.claude/agents'
/** Versão do squad-stream: `0.2.0`, `1.10`. */
const VERSAO = /^\d+(\.\d+)*$/

const UI_INICIAL: EstruturasUi = {
  aba: 'catalogo',
  selecionado: '',
  origemSelecionado: 'catalogo',
  sobrescrever: false,
  confirmar: '',
  alvoConfirmacao: '',
  verAgente: '',
  verFluxo: false,
  titulo: '',
  icone: '🧩',
  resumo: '',
  squadVersao: '',
  carregado: false,
  biblioteca: [],
  ativo: '',
  arquivosAtivos: [],
  ocupado: false,
  dependencias: [],
  verificandoDeps: false,
  claudeAusente: false,
  verDeps: false,
  editando: '',
  edicaoTitulo: '',
  edicaoResumo: '',
  edicaoIcone: '',
  edicaoFluxo: '',
  edicaoSujo: false,
  clonando: '',
  nomeClone: '',
  mudancas: [],
  fluxoMudou: false,
  desatualizados: [],
}

const estruturasAtom = atom({ plugin: 'agents-creator', key: 'estruturas' } as const, UI_INICIAL, { shape: 'estruturas-3' })

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

const jsonLinha = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

// ---------------------------------------------------------------------------
// caminhos

function squadStreamDir(paths: Paths): string {
  return joinPath(paths, paths.configDir, 'plugins', 'cache', 'skill-squad-room', 'squad-stream')
}

function manifestoPath(paths: Paths): string {
  return joinPath(paths, paths.root, '.claude', 'agents-creator.json')
}

function claudeMdPath(paths: Paths): string {
  return joinPath(paths, paths.root, 'CLAUDE.md')
}

/** Arquivo do projeto a partir do caminho relativo à raiz (`.claude/agents/x.md`). */
function noProjeto(paths: Paths, rel: string): string {
  return joinPath(paths, paths.root, ...rel.split('/'))
}

/** Agente a partir do caminho relativo a `.claude/agents` (`revisao/x.md`). */
function naPastaDeAgentes(paths: Paths, file: string): string {
  return joinPath(paths, paths.projectDir, ...file.split('/'))
}

// ---------------------------------------------------------------------------
// leitura e validação

/** Conteúdo do arquivo, ou null se ele não existe. Erro ao ler um arquivo que existe é erro de verdade. */
async function lerSeExiste($: Dollar, path: string): Promise<string | null> {
  if (!(await $.fs.exists(path))) return null
  return $.fs.read(path)
}

type Manifesto = { ativo: string; arquivos: string[] }

/** Template ativo do projeto (`.claude/agents-creator.json`). Ausente ou inválido: nenhum. */
function lerManifesto(texto: string | null): Manifesto {
  const nenhum: Manifesto = { ativo: '', arquivos: [] }
  if (texto === null) return nenhum
  let dado: unknown
  try {
    dado = JSON.parse(texto)
  } catch {
    return nenhum
  }
  if (!isRecord(dado) || dado.formato !== 1) return nenhum
  const { ativo, arquivos } = dado
  if (typeof ativo !== 'string' || !Array.isArray(arquivos)) return nenhum
  // O arquivo pode ter vindo de um git clone: só caminhos dentro de .claude/agents entram (eles saem do disco ao trocar).
  const seguros = arquivos.filter(
    (rel): rel is string => typeof rel === 'string' && rel.startsWith(`${PASTA_AGENTES}/`) && agenteValido(rel.slice(PASTA_AGENTES.length + 1)),
  )
  return { ativo, arquivos: seguros }
}

/** Compara versões parte a parte, como números: `0.10.0` é maior que `0.2.0`. */
function compararVersoes(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** Maior versão instalada do squad-stream; '' se a pasta não existe ou não tem versão. */
async function versaoDoSquad($: Dollar, paths: Paths): Promise<string> {
  let entries
  try {
    entries = await $.fs.list(squadStreamDir(paths))
  } catch {
    return ''
  }
  let maior = ''
  for (const entry of entries) {
    if (entry.kind !== 'dir' || !VERSAO.test(entry.name)) continue
    if (maior === '' || compararVersoes(entry.name, maior) > 0) maior = entry.name
  }
  return maior
}

/** Meus templates, do mais novo para o mais antigo. Arquivo inválido é ignorado. */
async function lerBiblioteca($: Dollar, paths: Paths): Promise<LibraryItem[]> {
  const dir = pastaBiblioteca(paths)
  let entries
  try {
    entries = await $.fs.list(dir)
  } catch {
    return []
  }
  const itens: LibraryItem[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.toLowerCase().endsWith('.json')) continue
    const texto = await readText($, joinPath(paths, dir, entry.name))
    const modelo = texto === null ? null : lerModelo(texto)
    // O arquivo leva o nome do id: é assim que o template é achado depois.
    if (modelo === null || entry.name !== `${modelo.id}.json`) continue
    itens.push({
      id: modelo.id,
      title: modelo.title,
      icon: modelo.icon,
      summary: modelo.summary,
      origin: modelo.origin,
      createdAt: modelo.createdAt,
      agents: modelo.agents.map(agent => agent.file.replace(/\.md$/i, '')),
      base: modelo.base,
    })
  }
  return itens.sort((a, b) => b.createdAt - a.createdAt)
}

/** Ids já usados na biblioteca: todo .json da pasta, válido ou não (um arquivo estranho não é sobrescrito). Em minúsculas. */
async function idsDaBiblioteca($: Dollar, paths: Paths): Promise<Set<string>> {
  const ids = new Set<string>()
  const entries = await $.fs.list(pastaBiblioteca(paths)).catch(() => null)
  for (const entry of entries ?? []) {
    if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.json')) {
      ids.add(entry.name.replace(/\.json$/i, '').toLowerCase())
    }
  }
  return ids
}

// ---------------------------------------------------------------------------
// agentes do projeto

/** Agentes de .claude/agents, subpastas incluídas, pelo caminho relativo em chaveArquivo (casa sem diferenciar maiúsculas). */
async function arquivosDoProjeto($: Dollar, paths: Paths): Promise<Map<string, string>> {
  const achados = new Map<string, string>()
  const varrer = async (dir: string, prefixo: string, profundidade: number): Promise<void> => {
    const entries = await $.fs.list(dir).catch(() => null)
    if (entries === null) return
    for (const entry of entries) {
      const rel = prefixo === '' ? entry.name : `${prefixo}/${entry.name}`
      const caminho = joinPath(paths, dir, entry.name)
      let tipo: string = entry.kind
      if (entry.kind === 'other' && entry.isLink) tipo = (await $.fs.stat(caminho).catch(() => null))?.kind ?? 'other'
      if (tipo === 'file' && entry.name.toLowerCase().endsWith('.md')) {
        achados.set(chaveArquivo(rel), caminho)
      } else if (tipo === 'dir' && profundidade < 4 && !entry.name.startsWith('.')) {
        await varrer(caminho, rel, profundidade + 1)
      }
    }
  }
  await varrer(paths.projectDir, '', 0)
  return achados
}

/** Conteúdo, no projeto, de cada agente de um template. Chave: chaveArquivo(file); valor null quando o arquivo não existe. */
async function conteudosDe(
  $: Dollar,
  achados: ReadonlyMap<string, string>,
  agentes: readonly TemplateAgent[],
): Promise<Record<string, string | null>> {
  const conteudos: Record<string, string | null> = {}
  for (const agente of agentes) {
    const chave = chaveArquivo(agente.file)
    const caminho = achados.get(chave)
    conteudos[chave] = caminho === undefined ? null : await readText($, caminho)
  }
  return conteudos
}

// ---------------------------------------------------------------------------
// estado da aba

/** O que a aba Estruturas desenha. */
export async function estruturasSnapshot($: Dollar): Promise<EstruturasUi> {
  return read($, estruturasAtom)
}

export async function setEstruturas($: Dollar, patch: Partial<EstruturasUi>): Promise<void> {
  await update($, estruturasAtom, ui => ({ ...ui, ...patch }))
}

/**
 * Relê o disco: versão do squad, Meus templates, o template ativo deste projeto (detectado, se não há um), o que mudou
 * nele e as cópias do catálogo com versão nova.
 */
export async function carregarEstruturas($: Dollar): Promise<void> {
  const paths = await resolvePaths($)
  const squadVersao = await versaoDoSquad($, paths)
  const biblioteca = await lerBiblioteca($, paths)
  let manifesto = lerManifesto(await lerSeExiste($, manifestoPath(paths)).catch(() => null))
  if (manifesto.ativo === '') {
    try {
      manifesto = (await detectarUso($, paths, biblioteca)) ?? manifesto
    } catch {
      // sem gravar o manifesto, o projeto só não é marcado agora: a próxima leitura tenta de novo
    }
  }
  const avisos = await calcularMudancas($, paths, manifesto.ativo)
  const desatualizados = await calcularDesatualizados($, paths, biblioteca, squadVersao || SQUAD_VERSAO_PADRAO)
  await setEstruturas($, {
    squadVersao,
    carregado: true,
    biblioteca,
    ativo: manifesto.ativo,
    arquivosAtivos: manifesto.arquivos,
    mudancas: avisos.mudancas,
    fluxoMudou: avisos.fluxoMudou,
    desatualizados,
  })
  try {
    await carregarDependencias($)
  } catch {
    // sem a lista, a aba só não mostra o bloco "Plugins necessários"
  }
}

/** Abre a aba Estruturas e carrega o que está no disco. */
export async function abrirEstruturas($: Dollar): Promise<void> {
  await go($, 'estruturas')
  await carregarEstruturas($)
}

export async function selecionar($: Dollar, origem: 'catalogo' | 'biblioteca', id: string): Promise<void> {
  await setEstruturas($, { selecionado: id, origemSelecionado: origem, verAgente: '', verFluxo: false, confirmar: '', alvoConfirmacao: '' })
}

export async function voltar($: Dollar): Promise<void> {
  await setEstruturas($, { selecionado: '', verAgente: '', verFluxo: false, confirmar: '' })
}

// ---------------------------------------------------------------------------
// Meus templates: editar, clonar e atualizar

/** O template aberto no editor de template, lido do disco agora (o desenho chama a cada vez); null se não há nenhum. */
export async function modeloEmEdicao($: Dollar): Promise<LocalTemplate | null> {
  const ui = await estruturasSnapshot($)
  return ui.editando === '' ? null : lerTemplate($, await resolvePaths($), ui.editando)
}

/** Abre um template seu no editor de template. Template do catálogo não se edita: clone antes. */
export async function abrirEdicao($: Dollar, id: string): Promise<void> {
  const tpl = await lerTemplate($, await resolvePaths($), id)
  if (tpl === null) {
    await say($, 'error', 'Não achei esse template em Meus templates.')
    return
  }
  if (tpl.origin !== 'proprio') {
    await say($, 'warn', 'Template do catálogo não se edita. Clone para editar.')
    return
  }
  await setEstruturas($, {
    editando: tpl.id,
    edicaoTitulo: tpl.title,
    edicaoResumo: tpl.summary,
    edicaoIcone: tpl.icon,
    edicaoFluxo: tpl.claudeMd,
    edicaoSujo: false,
    aba: 'biblioteca',
    selecionado: '',
    confirmar: '',
    alvoConfirmacao: '',
  })
  await go($, 'estruturas')
}

/** Fecha o editor de template e limpa os campos. */
export async function fecharEdicao($: Dollar): Promise<void> {
  await setEstruturas($, {
    editando: '',
    edicaoTitulo: '',
    edicaoResumo: '',
    edicaoIcone: '',
    edicaoFluxo: '',
    edicaoSujo: false,
    confirmar: '',
    alvoConfirmacao: '',
  })
  // O agente pode ter sido salvo pelo editor do estúdio (hooks/actions.ts, que não relê a aba): relê Meus templates e os avisos.
  await carregarEstruturas($)
}

/** Guarda uma mudança nos campos do template em edição (título, resumo, ícone ou fluxo) e marca que não foi salva. */
export async function setEdicao(
  $: Dollar,
  patch: Partial<Pick<EstruturasUi, 'edicaoTitulo' | 'edicaoResumo' | 'edicaoIcone' | 'edicaoFluxo'>>,
): Promise<void> {
  await setEstruturas($, { ...patch, edicaoSujo: true })
}

/** Grava título, resumo, ícone e fluxo do template em edição; depois recalcula os avisos. */
export async function salvarEdicao($: Dollar): Promise<void> {
  const ui = await estruturasSnapshot($)
  const paths = await resolvePaths($)
  const tpl = ui.editando === '' ? null : await lerTemplate($, paths, ui.editando)
  if (tpl === null || tpl.origin !== 'proprio') {
    await say($, 'error', 'Não consegui salvar: esse template não está em Meus templates.')
    return
  }
  const titulo = ui.edicaoTitulo.trim()
  if (titulo === '') {
    await say($, 'error', 'Dê um nome ao template.')
    return
  }
  try {
    await gravarTemplate($, paths, {
      ...tpl,
      title: titulo,
      summary: ui.edicaoResumo.trim(),
      icon: ui.edicaoIcone.trim() || '🧩',
      claudeMd: ui.edicaoFluxo.trim(),
    })
  } catch (error) {
    await say($, 'error', `Não consegui salvar o template: ${message(error)}`)
    return
  }
  await setEstruturas($, { edicaoSujo: false })
  await carregarEstruturas($)
  const ehAtivo = (await estruturasSnapshot($)).ativo === tpl.id
  await say($, 'ok', `Template "${titulo}" salvo.${ehAtivo ? ' Para levar ao projeto, use "Aplicar o template no projeto".' : ''}`)
}

/** Tira um agente do template em edição e grava. O projeto não muda. */
export async function removerAgenteDoTemplate($: Dollar, file: string): Promise<void> {
  const paths = await resolvePaths($)
  const ui = await estruturasSnapshot($)
  const tpl = ui.editando === '' ? null : await lerTemplate($, paths, ui.editando)
  await setEstruturas($, { confirmar: '', alvoConfirmacao: '' })
  if (tpl === null || tpl.origin !== 'proprio') {
    await say($, 'error', 'Não consegui tirar o agente: esse template não está em Meus templates.')
    return
  }
  try {
    await gravarTemplate($, paths, { ...tpl, agents: tpl.agents.filter(agente => agente.file !== file) })
  } catch (error) {
    await say($, 'error', `Não consegui tirar o agente: ${message(error)}`)
    return
  }
  await carregarEstruturas($)
  await say($, 'ok', `"${file.replace(/\.md$/i, '')}" saiu do template. O projeto não mudou.`)
}

/** Abre um agente do template em edição no editor do estúdio. Salvar devolve o agente ao template, sem tocar no projeto. */
export async function editarAgenteDoTemplate($: Dollar, file: string): Promise<void> {
  const paths = await resolvePaths($)
  const ui = await estruturasSnapshot($)
  const tpl = ui.editando === '' ? null : await lerTemplate($, paths, ui.editando)
  const agente = tpl?.agents.find(item => item.file === file)
  if (tpl === null || agente === undefined || tpl.origin !== 'proprio') {
    await say($, 'error', 'Não achei esse agente no template.')
    return
  }
  await abrirRascunhoDeTemplate($, tpl.id, file, agente.content, tpl.title)
}

/** Abre um agente novo no editor do estúdio para o template em edição. */
export async function novoAgenteNoTemplate($: Dollar): Promise<void> {
  const paths = await resolvePaths($)
  const ui = await estruturasSnapshot($)
  const tpl = ui.editando === '' ? null : await lerTemplate($, paths, ui.editando)
  if (tpl === null || tpl.origin !== 'proprio') {
    await say($, 'error', 'Não consegui criar o agente: esse template não está em Meus templates.')
    return
  }
  await novoRascunhoDeTemplate($, tpl.id, tpl.title)
}

/** Começa a clonar uma estrutura do catálogo. O nome sugerido é "<título> (minha versão)". */
export async function iniciarClone($: Dollar, estruturaId: string): Promise<void> {
  const estrutura = estruturaPorId(estruturaId)
  if (!estrutura) {
    await say($, 'error', 'Essa estrutura não existe no catálogo.')
    return
  }
  await setEstruturas($, { clonando: estrutura.id, nomeClone: `${estrutura.title} (minha versão)` })
}

/** Guarda o nome digitado para a cópia. */
export async function setNomeClone($: Dollar, nome: string): Promise<void> {
  await setEstruturas($, { nomeClone: nome })
}

/** Cancela o formulário de clone. */
export async function cancelarClone($: Dollar): Promise<void> {
  await setEstruturas($, { clonando: '', nomeClone: '' })
}

/**
 * Cria a sua versão de uma estrutura do catálogo em Meus templates (origem 'proprio', base = a estrutura) e abre o editor.
 * O id sai do nome (idParaClone): "<id>-propria" se bate com uma estrutura do catálogo; "-2", "-3"… se já existe.
 */
export async function confirmarClone($: Dollar): Promise<void> {
  const ui = await estruturasSnapshot($)
  const estrutura = estruturaPorId(ui.clonando)
  const titulo = ui.nomeClone.trim()
  if (!estrutura) {
    await setEstruturas($, { clonando: '', nomeClone: '' })
    await say($, 'error', 'Essa estrutura não existe no catálogo.')
    return
  }
  if (titulo === '') {
    await say($, 'error', 'Dê um nome à sua versão.')
    return
  }
  const paths = await resolvePaths($)
  const id = idParaClone(finalSlug(titulo), new Set(ESTRUTURAS.map(item => item.id)), await idsDaBiblioteca($, paths))
  if (!ID_SEGURO.test(id)) {
    await say($, 'error', `O nome "${titulo}" não serve como nome de template.`)
    return
  }
  try {
    const agora = await $.clock.now()
    const modelo = templateDaEstrutura(estrutura, ui.squadVersao || SQUAD_VERSAO_PADRAO, agora)
    await gravarTemplate($, paths, { ...modelo, id, title: titulo, origin: 'proprio', base: estrutura.id })
  } catch (error) {
    await say($, 'error', `Não consegui criar a sua versão: ${message(error)}`)
    return
  }
  await carregarEstruturas($)
  await setEstruturas($, { clonando: '', nomeClone: '' })
  await abrirEdicao($, id)
  await say($, 'ok', `"${titulo}" criado em Meus templates. Ajuste o que quiser e salve.`)
}

/** Leva para o template ativo o que mudou no projeto: os agentes com o conteúdo do projeto e o fluxo do CLAUDE.md. Só template seu. */
export async function atualizarTemplateComProjeto($: Dollar): Promise<void> {
  const paths = await resolvePaths($)
  const ui = await estruturasSnapshot($)
  if (ui.ativo === '') {
    await say($, 'warn', 'Não há template ativo neste projeto.')
    return
  }
  const tpl = await lerTemplate($, paths, ui.ativo)
  if (tpl === null) {
    await say($, 'error', 'Não achei o template ativo em Meus templates.')
    return
  }
  if (tpl.origin !== 'proprio') {
    await say($, 'warn', 'Este template é do catálogo: salve como template seu para guardar as mudanças.')
    return
  }
  const projeto = await conteudosDe($, await arquivosDoProjeto($, paths), tpl.agents)
  // O fluxo vem do bloco deste template no CLAUDE.md, quando ele tem os marcadores; senão fica o que o template já tem.
  const claudeTexto = await readText($, claudeMdPath(paths))
  const temBloco = claudeTexto !== null && removerSecaoClaudeMd(claudeTexto, tpl.id) !== claudeTexto
  const claudeMd = claudeTexto !== null && temBloco ? normalizarEol(extrairFluxo(claudeTexto, tpl.id)) : tpl.claudeMd
  // Agente que falta no projeto fica como está no template.
  const agents = tpl.agents.map(agente => ({ file: agente.file, content: projeto[chaveArquivo(agente.file)] ?? agente.content }))
  try {
    await gravarTemplate($, paths, { ...tpl, agents, claudeMd })
  } catch (error) {
    await say($, 'error', `Não consegui atualizar o template: ${message(error)}`)
    return
  }
  await carregarEstruturas($)
  await say($, 'ok', 'O template foi atualizado com o projeto.')
}

/** Atualiza uma cópia do catálogo em Meus templates com a estrutura padrão atual (baixarDoCatalogo já recarrega). */
export async function atualizarCopia($: Dollar, id: string): Promise<void> {
  await baixarDoCatalogo($, id, false)
}

// ---------------------------------------------------------------------------
// detectar o template em uso e o que mudou nele

/**
 * Projeto sem template ativo: o primeiro template da biblioteca cujos agentes estão todos no projeto, com o mesmo conteúdo
 * (templateCasa), vira o ativo. Grava o manifesto e avisa. Template sem agentes não conta.
 */
async function detectarUso($: Dollar, paths: Paths, biblioteca: readonly LibraryItem[]): Promise<Manifesto | null> {
  const achados = await arquivosDoProjeto($, paths)
  for (const item of biblioteca) {
    const tpl = await lerTemplate($, paths, item.id)
    if (tpl === null || !templateCasa(tpl.agents, await conteudosDe($, achados, tpl.agents))) continue
    const arquivos = tpl.agents.map(agente => `${PASTA_AGENTES}/${agente.file}`)
    await $.fs.write(manifestoPath(paths), jsonLinha({ formato: 1, ativo: tpl.id, arquivos }))
    await say($, 'info', `Este projeto usa o template "${tpl.title}".`)
    return { ativo: tpl.id, arquivos }
  }
  return null
}

/** O que mudou no projeto desde o template ativo: agentes faltando ou alterados, e se o fluxo do CLAUDE.md é outro. */
async function calcularMudancas($: Dollar, paths: Paths, ativo: string): Promise<{ mudancas: MudancaAgente[]; fluxoMudou: boolean }> {
  const tpl = ativo === '' ? null : await lerTemplate($, paths, ativo)
  if (tpl === null) return { mudancas: [], fluxoMudou: false }
  const projeto = await conteudosDe($, await arquivosDoProjeto($, paths), tpl.agents)
  const fluxoAtual = extrairFluxo(await readText($, claudeMdPath(paths)), ativo)
  const mudouOFluxo = fluxoMudou(tpl.claudeMd, fluxoAtual)
  return { mudancas: mudancasDoTemplate(tpl.agents, projeto), fluxoMudou: mudouOFluxo }
}

/** Cópias do catálogo em Meus templates cuja estrutura padrão mudou (copiaDesatualizada). */
async function calcularDesatualizados($: Dollar, paths: Paths, biblioteca: readonly LibraryItem[], versao: string): Promise<string[]> {
  const desatualizados: string[] = []
  for (const item of biblioteca) {
    if (item.origin !== 'catalogo') continue
    const estrutura = estruturaPorId(item.id)
    const salvo = await lerTemplate($, paths, item.id)
    if (estrutura === undefined || salvo === null) continue
    if (copiaDesatualizada(salvo, templateDaEstrutura(estrutura, versao, 0))) desatualizados.push(item.id)
  }
  return desatualizados
}

// ---------------------------------------------------------------------------
// plugins exigidos: estado no disco e atualização pelo `claude`

/** Pasta do Claude Code com os plugins instalados e os marketplaces. */
function pluginsDir(paths: Paths): string {
  return joinPath(paths, paths.configDir, 'plugins')
}

/**
 * Roda o `claude` com esses argumentos. No Windows ele costuma ser `claude.cmd` (npm), que só roda pelo cmd.exe,
 * então `where.exe` diz antes se ele existe. Rejeita se o comando não existe ou se estoura o tempo.
 */
async function rodarClaude($: Dollar, args: string[], timeoutMs: number) {
  const paths = await resolvePaths($)
  if (!paths.isWindows) return $.process.run(['claude', ...args], { timeoutMs })
  const onde = await $.process.run(['where.exe', 'claude'], { timeoutMs: 30000 })
  if (onde.exitCode !== 0) throw new Error('o comando claude não está no PATH')
  return $.process.run(['cmd.exe', '/d', '/s', '/c', 'claude', ...args], { timeoutMs })
}

/** Estado de cada plugin exigido, lido do disco (não roda o `claude`). Abre o bloco se algum está desatualizado ou falta. */
export async function carregarDependencias($: Dollar): Promise<void> {
  const paths = await resolvePaths($)
  const instaladas = versoesInstaladas(await readText($, joinPath(paths, pluginsDir(paths), 'installed_plugins.json')))
  const conhecidos = marketplacesConhecidos(await readText($, joinPath(paths, pluginsDir(paths), 'known_marketplaces.json')))
  const dependencias: DepInfo[] = []
  for (const dep of DEPENDENCIAS) {
    const mk = conhecidos[dep.marketplace]
    const instalada = instaladas[dep.id] ?? ''
    let ultima = ''
    if (mk) {
      // A versão vem do catálogo do marketplace; se o catálogo não a traz, do plugin.json da fonte ('./pasta').
      const catalogo = entradaNoCatalogo(await readText($, joinPath(paths, mk.pasta, '.claude-plugin', 'marketplace.json')), dep.nome)
      ultima = catalogo.versao
      if (ultima === '' && catalogo.fonte.startsWith('./')) {
        const segmentos = catalogo.fonte.slice(2).split('/').filter(parte => parte !== '')
        ultima = versaoDoManifesto(await readText($, joinPath(paths, mk.pasta, ...segmentos, '.claude-plugin', 'plugin.json')))
      }
    }
    dependencias.push({
      id: dep.id,
      nome: dep.nome,
      para: dep.para,
      marketplace: dep.marketplace,
      repo: dep.repo,
      instalada,
      ultima,
      estado: estadoDe(instalada, ultima, mk?.local === true),
    })
  }
  const precisa = dependencias.some(dep => dep.estado === 'desatualizada' || dep.estado === 'faltando')
  await update($, estruturasAtom, ui => ({ ...ui, dependencias, verDeps: ui.verDeps || precisa }))
}

/** Atualiza o catálogo dos marketplaces dos plugins exigidos (os locais ficam como estão) e relê as versões. */
export async function procurarAtualizacoes($: Dollar): Promise<void> {
  if ((await estruturasSnapshot($)).verificandoDeps) return
  await setEstruturas($, { verificandoDeps: true, claudeAusente: false })
  try {
    const paths = await resolvePaths($)
    const conhecidos = marketplacesConhecidos(await readText($, joinPath(paths, pluginsDir(paths), 'known_marketplaces.json')))
    // Um marketplace por comando: `claude plugin marketplace update <nome>`.
    const nomes = [...new Set(DEPENDENCIAS.map(dep => dep.marketplace))].filter(nome => {
      const mk = conhecidos[nome]
      return mk !== undefined && !mk.local
    })
    const erros: string[] = []
    let claudeFalhou = false
    for (const nome of nomes) {
      try {
        const resultado = await rodarClaude($, ['plugin', 'marketplace', 'update', nome], 180000)
        if (resultado.exitCode !== 0) erros.push(nome)
      } catch {
        claudeFalhou = true
        break
      }
    }
    await carregarDependencias($)
    if (claudeFalhou) {
      await setEstruturas($, { claudeAusente: true })
      const comandos = nomes.map(nome => `claude plugin marketplace update ${nome}`).join('; ')
      await say($, 'warn', `Não achei o comando claude neste computador. Rode no terminal: ${comandos}`)
    } else if (erros.length > 0) {
      await say($, 'warn', `Não consegui atualizar o catálogo de ${erros.join(', ')}.`)
    } else {
      const deps = (await estruturasSnapshot($)).dependencias
      const n = deps.filter(dep => dep.estado === 'desatualizada').length
      const f = deps.filter(dep => dep.estado === 'faltando').length
      const faltam = f === 1 ? 'Falta 1 plugin para instalar: use o botão Instalar.' : `Faltam ${f} plugins para instalar: use o botão Instalar.`
      if (n > 0 && f > 0) await say($, 'warn', `Há versão nova para ${n} plugin(s). ${faltam}`)
      else if (n > 0) await say($, 'ok', `Há versão nova para ${n} plugin(s).`)
      else if (f > 0) await say($, 'warn', faltam)
      else await say($, 'ok', 'Os plugins necessários estão na versão mais nova.')
    }
  } catch (error) {
    await say($, 'error', `Não consegui verificar as atualizações: ${message(error)}`)
  } finally {
    await setEstruturas($, { verificandoDeps: false })
  }
}

/** Instala (se falta) ou atualiza (se está desatualizado) um plugin exigido. */
export async function atualizarDependencia($: Dollar, id: string): Promise<void> {
  const ui = await estruturasSnapshot($)
  const dep = ui.dependencias.find(item => item.id === id)
  const cmd = dep ? comandoDe(dep) : null
  if (!dep || cmd === null || ui.verificandoDeps) return
  const instalar = dep.estado === 'faltando'
  await setEstruturas($, { verificandoDeps: true, claudeAusente: false })
  try {
    // Só a execução do claude diz se ele está ausente: um erro depois disso (ao reler as dependências) é outro erro.
    let resultado: Awaited<ReturnType<typeof rodarClaude>>
    try {
      resultado = await rodarClaude($, cmd.slice(1), 300000)
    } catch {
      await setEstruturas($, { claudeAusente: true })
      await say($, 'warn', `Não achei o comando claude. Rode no terminal: ${cmd.join(' ')}`)
      return
    }
    if (resultado.exitCode === 0) {
      await carregarDependencias($)
      await say($, 'ok', `${dep.nome} ${instalar ? 'instalado' : 'atualizado'}. Rode /reload-plugins para carregar a versão nova.`)
    } else {
      const detalhe = (resultado.stderr || resultado.stdout).trim().slice(0, 300) || `código ${resultado.exitCode}`
      await say($, 'error', `Não consegui ${instalar ? 'instalar' : 'atualizar'} ${dep.nome}: ${detalhe}`)
    }
  } catch (error) {
    await say($, 'error', `Não consegui ${instalar ? 'instalar' : 'atualizar'} ${dep.nome}: ${message(error)}`)
  } finally {
    await setEstruturas($, { verificandoDeps: false })
  }
}

/** Instala e atualiza, em sequência, todos os plugins exigidos que faltam ou estão desatualizados. Uma mensagem no fim. */
export async function atualizarTodas($: Dollar): Promise<void> {
  const ui = await estruturasSnapshot($)
  const pendentes = ui.dependencias.flatMap(dep => {
    const cmd = comandoDe(dep)
    return cmd === null ? [] : [{ nome: dep.nome, cmd }]
  })
  if (pendentes.length === 0 || ui.verificandoDeps) return
  await setEstruturas($, { verificandoDeps: true, claudeAusente: false })
  const feitos: string[] = []
  const falharam: string[] = []
  let claudeFalhou = false
  try {
    for (const item of pendentes) {
      try {
        const resultado = await rodarClaude($, item.cmd.slice(1), 300000)
        if (resultado.exitCode === 0) feitos.push(item.nome)
        else falharam.push(item.nome)
      } catch {
        claudeFalhou = true
        break
      }
    }
    await carregarDependencias($)
    const partes: string[] = []
    if (feitos.length > 0) partes.push(`Atualizados ou instalados (${feitos.length}): ${feitos.join(', ')}. Rode /reload-plugins para carregar as versões novas.`)
    if (falharam.length > 0) partes.push(`Não consegui com ${falharam.join(', ')}.`)
    if (claudeFalhou) {
      await setEstruturas($, { claudeAusente: true })
      const restantes = pendentes.slice(feitos.length + falharam.length).map(item => item.cmd.join(' ')).join('; ')
      partes.push(`Não achei o comando claude. Rode no terminal: ${restantes}`)
    }
    await say($, claudeFalhou || falharam.length > 0 ? 'warn' : 'ok', partes.join(' '))
  } catch (error) {
    await say($, 'error', `Não consegui atualizar os plugins: ${message(error)}`)
  } finally {
    await setEstruturas($, { verificandoDeps: false })
  }
}

// ---------------------------------------------------------------------------
// conflitos

/** Nomes dos agentes do projeto que um template novo sobrescreveria: estão em `novos` e não são do template ativo (`ativos`). */
export function conflitosDe(projeto: readonly { name: string; relPath: string }[], novos: readonly string[], ativos: readonly string[]): string[] {
  return entradasEmConflito(projeto, novos, ativos).map(agent => agent.name)
}

/** A mesma regra de `conflitosDe`, devolvendo os agentes inteiros (com o caminho para ler e guardar). */
function entradasEmConflito<T extends { name: string; relPath: string }>(projeto: readonly T[], novos: readonly string[], ativos: readonly string[]): T[] {
  // Sem diferenciar maiúsculas: no Windows (e no macOS) "Revisor.md" e "revisor.md" são o mesmo arquivo.
  const nos = (lista: readonly string[], rel: string): boolean => lista.some(item => item.toLowerCase() === rel.toLowerCase())
  return projeto.filter(agent => nos(novos, agent.relPath) && !nos(ativos, agent.relPath))
}

// ---------------------------------------------------------------------------
// aplicar, tirar do projeto, baixar, salvar e apagar

function itemDaLixeira(agora: number, ordem: number, name: string, path: string, content: string): TrashItem {
  return { id: `${agora}-${ordem}`, name, scope: 'project', path, content, deletedAt: agora }
}

/** Grava o CLAUDE.md com o fim de linha que ele já tinha (CRLF ou LF); arquivo novo fica em LF. */
function comEolDe(original: string | null, texto: string): string {
  return original !== null && original.includes('\r\n') ? texto.replace(/\r?\n/g, '\r\n') : texto
}

/** Roda uma operação que pode tirar arquivos do projeto. O que já saiu entra na lixeira mesmo se ela falhar no meio. */
async function comLixeira<T>($: Dollar, operacao: (lixeira: TrashItem[]) => Promise<T>): Promise<T> {
  const lixeira: TrashItem[] = []
  try {
    return await operacao(lixeira)
  } finally {
    if (lixeira.length > 0) await pushTrash($, lixeira)
  }
}

/**
 * Manda para a lixeira o conteúdo atual de cada agente que existir e o remove do projeto. Quem já tem exatamente o
 * conteúdo que `iguais` traz para o mesmo caminho fica como está (não vai para a lixeira). Devolve quantos saíram.
 */
async function tirarDoProjeto(
  $: Dollar,
  paths: Paths,
  rels: readonly string[],
  agora: number,
  lixeira: TrashItem[],
  iguais: ReadonlyMap<string, string>,
): Promise<number> {
  let removidos = 0
  for (const rel of rels) {
    const path = noProjeto(paths, rel)
    const conteudo = await lerSeExiste($, path)
    if (conteudo === null || iguais.get(rel) === conteudo) continue
    await removeFile($, paths, path)
    lixeira.push(itemDaLixeira(agora, lixeira.length, baseName(rel).replace(/\.md$/i, ''), path, conteudo))
    removidos += 1
  }
  return removidos
}

/** Põe um template de Meus templates no projeto. O template ativo anterior sai (os agentes vão para a lixeira). */
export async function aplicarTemplate($: Dollar, id: string): Promise<void> {
  if ((await estruturasSnapshot($)).ocupado) return
  await setEstruturas($, { ocupado: true })
  try {
    await aplicarNoProjeto($, id)
  } catch (error) {
    await say($, 'error', `Não consegui aplicar o template: ${message(error)}`)
  } finally {
    await setEstruturas($, { ocupado: false })
  }
}

/** Leva o template ativo para .claude/agents e o CLAUDE.md (o que sai do projeto vai para a lixeira). */
export async function aplicarTemplateNoProjeto($: Dollar): Promise<void> {
  const ui = await estruturasSnapshot($)
  if (ui.ativo !== '') await aplicarTemplate($, ui.ativo)
}

async function aplicarNoProjeto($: Dollar, id: string): Promise<void> {
  const paths = await resolvePaths($)
  const ui = await estruturasSnapshot($)
  const modelo = await lerTemplate($, paths, id)
  if (modelo === null) {
    await say($, 'error', `Não consegui ler "${id}" em Meus templates: o arquivo sumiu ou não é um template válido.`)
    return
  }
  const catalog = await refresh($)
  const projeto = catalog.agents
    .filter(agent => agent.scope === 'project')
    .map(agent => ({ name: agent.name, relPath: `${PASTA_AGENTES}/${agent.relPath}`, path: agent.path }))
  const novos = modelo.agents.map(agent => `${PASTA_AGENTES}/${agent.file}`)
  const conteudoNovo = new Map(modelo.agents.map((agent): [string, string] => [`${PASTA_AGENTES}/${agent.file}`, agent.content]))

  // Só conta como conflito o agente cujo conteúdo atual é diferente do que o template traz.
  const conflitos: { name: string; rel: string; path: string; content: string }[] = []
  for (const agente of entradasEmConflito(projeto, novos, ui.arquivosAtivos)) {
    const atual = await lerSeExiste($, agente.path)
    if (atual === null) continue
    const doTemplate = modelo.agents.find(item => `${PASTA_AGENTES}/${item.file}`.toLowerCase() === agente.relPath.toLowerCase())
    if (doTemplate?.content === atual) continue
    conflitos.push({ name: agente.name, rel: agente.relPath, path: agente.path, content: atual })
  }
  if (conflitos.length > 0 && !ui.sobrescrever) {
    const lista = conflitos.map(item => item.name).join(', ')
    await say($, 'warn', `Já existem no projeto: ${lista}. Marque "Sobrescrever" para trocar (os atuais vão para a lixeira do estúdio).`)
    return
  }

  const agora = await $.clock.now()
  const claudePath = claudeMdPath(paths)
  // Lido antes de qualquer mudança: se não der para ler, a troca aborta sem mexer em nada.
  const claudeOriginal = await lerSeExiste($, claudePath)
  const removidos = await comLixeira($, async lixeira => {
    // 1) agentes do template ativo anterior (os que já têm o conteúdo do template novo ficam no lugar)
    const saiu = await tirarDoProjeto($, paths, ui.arquivosAtivos, agora, lixeira, conteudoNovo)
    // 2) CLAUDE.md sem a seção do template anterior
    const claudeAtual = claudeOriginal !== null && ui.ativo !== '' ? removerSecaoClaudeMd(claudeOriginal, ui.ativo) : claudeOriginal
    // 3) conflitos que vão ser sobrescritos: o conteúdo atual vai para a lixeira
    for (const conflito of conflitos) {
      lixeira.push(itemDaLixeira(agora, lixeira.length, baseName(conflito.rel).replace(/\.md$/i, ''), conflito.path, conflito.content))
    }
    // 4) agentes do template
    for (const agente of modelo.agents) {
      await $.fs.write(naPastaDeAgentes(paths, agente.file), agente.content)
    }
    // 5) fluxo do template no CLAUDE.md (ou só a remoção da seção antiga)
    if (modelo.claudeMd.trim() !== '') {
      await $.fs.write(claudePath, comEolDe(claudeOriginal, mesclarClaudeMd(claudeAtual, modelo.id, modelo.claudeMd)))
    } else if (claudeAtual !== null && claudeAtual !== claudeOriginal) {
      await $.fs.write(claudePath, comEolDe(claudeOriginal, claudeAtual))
    }
    // 6) registro do template ativo
    await $.fs.write(manifestoPath(paths), jsonLinha({ formato: 1, ativo: modelo.id, arquivos: novos }))
    return saiu
  })

  await refresh($)
  await setEstruturas($, { ativo: modelo.id, arquivosAtivos: novos, confirmar: '', alvoConfirmacao: '', sobrescrever: false })
  // Os avisos (o que mudou desde o template) são recalculados já com o projeto trocado.
  await carregarEstruturas($)
  const trocou = ui.ativo !== '' && removidos > 0 ? ' Os agentes do template anterior foram para a lixeira do estúdio.' : ''
  const fluxo = modelo.claudeMd.trim() !== '' ? ' e o fluxo no CLAUDE.md' : ''
  await say($, 'ok', `"${modelo.title}" está ativo neste projeto: ${novos.length} agentes em ${PASTA_AGENTES}${fluxo}.${trocou}`)
}

/** Tira o template ativo do projeto: os agentes vão para a lixeira e o bloco sai do CLAUDE.md. */
export async function removerDoProjeto($: Dollar): Promise<void> {
  const ui = await estruturasSnapshot($)
  if (ui.ativo === '' || ui.ocupado) return
  await setEstruturas($, { ocupado: true })
  try {
    const paths = await resolvePaths($)
    const agora = await $.clock.now()
    const claudePath = claudeMdPath(paths)
    // Lido antes de tirar os agentes: se não der para ler, a remoção aborta sem mexer em nada.
    const claude = await lerSeExiste($, claudePath)
    const removidos = await comLixeira($, async lixeira => {
      // Aqui nada fica: o template inteiro sai do projeto.
      const saiu = await tirarDoProjeto($, paths, ui.arquivosAtivos, agora, lixeira, new Map<string, string>())
      if (claude !== null) {
        const semSecao = removerSecaoClaudeMd(claude, ui.ativo)
        if (semSecao !== claude) await $.fs.write(claudePath, comEolDe(claude, semSecao))
      }
      const manifesto = manifestoPath(paths)
      if (await $.fs.exists(manifesto)) await removeFile($, paths, manifesto)
      return saiu
    })
    await refresh($)
    await setEstruturas($, { ativo: '', arquivosAtivos: [], confirmar: '', mudancas: [], fluxoMudou: false })
    await say($, 'ok', removidos > 0 ? 'O template saiu do projeto; os agentes dele estão na lixeira do estúdio.' : 'O template saiu do projeto.')
  } catch (error) {
    await say($, 'error', `Não consegui tirar o template do projeto: ${message(error)}`)
  } finally {
    await setEstruturas($, { ocupado: false })
  }
}

/** Guarda uma estrutura do catálogo em Meus templates. Com `aplicar`, também a põe no projeto. */
export async function baixarDoCatalogo($: Dollar, id: string, aplicar: boolean): Promise<void> {
  const estrutura = estruturaPorId(id)
  if (!estrutura) {
    await say($, 'error', 'Essa estrutura não existe no catálogo.')
    return
  }
  const ui = await estruturasSnapshot($)
  const tpl = templateDaEstrutura(estrutura, ui.squadVersao || SQUAD_VERSAO_PADRAO, await $.clock.now())
  if (!ID_SEGURO.test(tpl.id)) {
    await say($, 'error', `O id "${tpl.id}" não serve como nome de arquivo.`)
    return
  }
  try {
    const paths = await resolvePaths($)
    // Um template seu com este id não é trocado pelo do catálogo: o usuário renomeia ou apaga o seu antes.
    const seu = await lerTemplate($, paths, tpl.id)
    if (seu !== null && seu.origin === 'proprio') {
      await say($, 'warn', `Já existe um template seu com o id "${id}" em Meus templates. Renomeie ou apague o seu antes de baixar este.`)
      return
    }
    // Cópia do catálogo não é clone: base ''.
    await gravarTemplate($, paths, { ...tpl, base: '' })
  } catch (error) {
    await say($, 'error', `Não consegui salvar "${tpl.title}" em Meus templates: ${message(error)}`)
    return
  }
  await carregarEstruturas($)
  if (aplicar) {
    await aplicarTemplate($, tpl.id)
  } else {
    await say($, 'ok', `"${tpl.title}" foi salvo em Meus templates.`)
  }
}

/** Guarda os agentes do projeto, com o fluxo do CLAUDE.md, como um template em Meus templates, e o torna o ativo. */
export async function salvarComoTemplate($: Dollar): Promise<void> {
  const ui = await estruturasSnapshot($)
  const titulo = ui.titulo.trim()
  if (titulo === '') {
    await say($, 'error', 'Dê um nome ao template.')
    return
  }
  const catalog = await refresh($)
  const paths = catalog.paths
  const doProjeto = catalog.agents.filter(agent => agent.scope === 'project')
  if (doProjeto.length === 0) {
    await say($, 'warn', 'Não há agentes em .claude/agents para salvar.')
    return
  }
  try {
    // Se um agente não puder ser lido, a operação para: sem isso o template sairia com um agente vazio.
    const agents: { file: string; content: string }[] = []
    for (const agent of doProjeto) {
      agents.push({ file: agent.relPath, content: await $.fs.read(agent.path) })
    }
    const fluxo = extrairFluxo(await lerSeExiste($, claudeMdPath(paths)), ui.ativo)
    // Nome de estrutura do catálogo (ou de template de catálogo já salvo) não é reaproveitado: vira "<nome>-propria".
    const base = finalSlug(titulo) || 'estrutura'
    const porBase = await lerTemplate($, paths, base)
    const reservado = estruturaPorId(base) !== undefined || (porBase !== null && porBase.origin === 'catalogo')
    const id = reservado ? `${base}-propria` : base
    // Um template seu com o mesmo id é atualizado: grava por cima e mantém a data de criação e a origem (base).
    const existente = reservado ? await lerTemplate($, paths, id) : porBase
    const proprio = existente !== null && existente.origin === 'proprio' ? existente : null
    const agora = await $.clock.now()
    const tpl: LocalTemplate = {
      formato: 1,
      id,
      title: titulo,
      icon: ui.icone.trim() || '🧩',
      summary: ui.resumo.trim() || `${agents.length} agentes salvos de ${baseName(paths.root)}`,
      origin: 'proprio',
      createdAt: proprio?.createdAt ?? agora,
      agents,
      claudeMd: fluxo,
      base: proprio?.base ?? '',
    }
    await gravarTemplate($, paths, tpl)
    // O projeto passa a usar o template que acabou de ser salvo.
    await $.fs.write(manifestoPath(paths), jsonLinha({ formato: 1, ativo: id, arquivos: agents.map(agent => `${PASTA_AGENTES}/${agent.file}`) }))
    await carregarEstruturas($)
    await setEstruturas($, { titulo: '', resumo: '' })
    const acao = proprio !== null ? 'atualizado em' : 'salvo em'
    await say($, 'ok', `Template "${titulo}" ${acao} Meus templates (${agents.length} agentes${fluxo ? ' e o fluxo do CLAUDE.md' : ''}).`)
  } catch (error) {
    await say($, 'error', `Não consegui salvar o template: ${message(error)}`)
  }
}

/** Apaga um template de Meus templates. O projeto não muda. */
export async function apagarDaBiblioteca($: Dollar, id: string): Promise<void> {
  const ui = await estruturasSnapshot($)
  if (!ID_SEGURO.test(id)) {
    await say($, 'error', 'Template inválido.')
    return
  }
  try {
    const paths = await resolvePaths($)
    const arquivo = caminhoTemplate(paths, id)
    if (await $.fs.exists(arquivo)) await removeFile($, paths, arquivo)
  } catch (error) {
    await say($, 'error', `Não consegui apagar o template: ${message(error)}`)
    return
  }
  await carregarEstruturas($)
  await setEstruturas($, { confirmar: '', alvoConfirmacao: '', selecionado: ui.selecionado === id ? '' : ui.selecionado })
  await say($, 'info', 'Template apagado de Meus templates.')
}
