// Aba Estruturas: catálogo de equipes, Meus templates (biblioteca local) e o template ativo de cada projeto.
// Roda em handlers; a aba só lê o estado (`estruturasSnapshot`). O que sai do projeto vai antes para a lixeira.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { EstruturasUi, LibraryItem, Paths, TrashItem } from '../types'
import { finalSlug } from './lib/agent'
import { baseName, joinPath, readText, removeFile, resolvePaths } from './lib/files'
import type { LocalTemplate } from './lib/estruturas/tipos'
import { SQUAD_VERSAO_PADRAO, extrairFluxo, mesclarClaudeMd, removerSecaoClaudeMd, templateDaEstrutura } from './lib/estruturas/protocolo'
import { estruturaPorId } from './lib/estruturas/index'
import { go, pushTrash, refresh, say } from './actions'

type Dollar = EngineInterface

/** Pasta dos agentes do projeto. Os caminhos do estado são relativos à raiz do projeto, com '/'. */
const PASTA_AGENTES = '.claude/agents'
/** Id que vira nome de arquivo: letras, números, ponto, hífen e sublinhado; nada de separador de pasta. */
const ID_SEGURO = /^[a-z0-9][a-z0-9._-]*$/i
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
}

const estruturasAtom = atom({ plugin: 'agents-creator', key: 'estruturas' } as const, UI_INICIAL, { shape: 'estruturas-1' })

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const jsonLinha = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

// ---------------------------------------------------------------------------
// caminhos

/** Meus templates: <configDir>/agents-creator/estruturas. */
function bibliotecaDir(paths: Paths): string {
  return joinPath(paths, paths.configDir, 'agents-creator', 'estruturas')
}

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

/** Caminho de agente seguro: `.md`, sem `..`, sem barra invertida nem caractere proibido no Windows. */
function agenteValido(file: string): boolean {
  return /\.md$/i.test(file) && file.split('/').every(parte => parte !== '' && parte !== '.' && parte !== '..' && !/[\\:*?"<>|]/.test(parte))
}

/** Template lido da biblioteca; null se o texto não for um template utilizável. */
function lerModelo(texto: string): LocalTemplate | null {
  let dado: unknown
  try {
    dado = JSON.parse(texto)
  } catch {
    return null
  }
  if (!isRecord(dado) || dado.formato !== 1) return null
  const { id, title, icon, summary, origin, createdAt, agents, claudeMd } = dado
  if (typeof id !== 'string' || !ID_SEGURO.test(id) || typeof title !== 'string' || !Array.isArray(agents)) return null
  const lista: { file: string; content: string }[] = []
  for (const agent of agents) {
    if (!isRecord(agent)) return null
    const { file, content } = agent
    if (typeof file !== 'string' || typeof content !== 'string' || !agenteValido(file)) return null
    lista.push({ file, content })
  }
  return {
    formato: 1,
    id,
    title,
    icon: typeof icon === 'string' && icon !== '' ? icon : '🧩',
    summary: typeof summary === 'string' ? summary : '',
    origin: origin === 'catalogo' ? 'catalogo' : 'proprio',
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
    agents: lista,
    claudeMd: typeof claudeMd === 'string' ? claudeMd : '',
  }
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
  const dir = bibliotecaDir(paths)
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
    })
  }
  return itens.sort((a, b) => b.createdAt - a.createdAt)
}

/** Um template de Meus templates pelo id; null se não existe, está inválido ou é de outro id. */
async function lerModeloDaBiblioteca($: Dollar, paths: Paths, id: string): Promise<LocalTemplate | null> {
  if (!ID_SEGURO.test(id)) return null
  const texto = await readText($, joinPath(paths, bibliotecaDir(paths), `${id}.json`))
  const modelo = texto === null ? null : lerModelo(texto)
  return modelo !== null && modelo.id === id ? modelo : null
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

/** Relê o disco: versão do squad, Meus templates e o template ativo deste projeto. */
export async function carregarEstruturas($: Dollar): Promise<void> {
  const paths = await resolvePaths($)
  const squadVersao = await versaoDoSquad($, paths)
  const biblioteca = await lerBiblioteca($, paths)
  const manifesto = lerManifesto(await lerSeExiste($, manifestoPath(paths)).catch(() => null))
  await setEstruturas($, { squadVersao, carregado: true, biblioteca, ativo: manifesto.ativo, arquivosAtivos: manifesto.arquivos })
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

async function aplicarNoProjeto($: Dollar, id: string): Promise<void> {
  const paths = await resolvePaths($)
  const ui = await estruturasSnapshot($)
  const modelo = await lerModeloDaBiblioteca($, paths, id)
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
    await setEstruturas($, { ativo: '', arquivosAtivos: [], confirmar: '' })
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
    const seu = await lerModeloDaBiblioteca($, paths, tpl.id)
    if (seu !== null && seu.origin === 'proprio') {
      await say($, 'warn', `Já existe um template seu com o id "${id}" em Meus templates. Renomeie ou apague o seu antes de baixar este.`)
      return
    }
    await $.fs.write(joinPath(paths, bibliotecaDir(paths), `${tpl.id}.json`), jsonLinha(tpl))
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

/** Guarda os agentes do projeto, com o fluxo do CLAUDE.md, como um template em Meus templates. */
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
    const porBase = await lerModeloDaBiblioteca($, paths, base)
    const reservado = estruturaPorId(base) !== undefined || (porBase !== null && porBase.origin === 'catalogo')
    const id = reservado ? `${base}-propria` : base
    // Um template seu com o mesmo id é atualizado: grava por cima e mantém a data de criação.
    const existente = reservado ? await lerModeloDaBiblioteca($, paths, id) : porBase
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
    }
    await $.fs.write(joinPath(paths, bibliotecaDir(paths), `${id}.json`), jsonLinha(tpl))
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
    const arquivo = joinPath(paths, bibliotecaDir(paths), `${id}.json`)
    if (await $.fs.exists(arquivo)) await removeFile($, paths, arquivo)
  } catch (error) {
    await say($, 'error', `Não consegui apagar o template: ${message(error)}`)
    return
  }
  await carregarEstruturas($)
  await setEstruturas($, { confirmar: '', alvoConfirmacao: '', selecionado: ui.selecionado === id ? '' : ui.selecionado })
  await say($, 'info', 'Template apagado de Meus templates.')
}
