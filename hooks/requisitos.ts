// Tela Dependências: o que cada plugin exigido precisa além dele mesmo. Lê o disco (skills avulsas, extensões do
// VS Code, dependências declaradas no plugin.json), verifica os programas e o servidor do popup, e corrige o que dá.
//
// O átomo fica aqui porque a verificação do plugin só aceita `read`/`update` sobre átomos do mesmo arquivo.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { EstadoRequisito, Paths, RequisitoInfo, RequisitosUi } from '../types'
import { go, say } from './actions'
import { atualizarTodas, carregarDependencias, estruturasSnapshot, procurarAtualizacoes } from './estruturas'
import { comandoDe, compararVersoes, DEPENDENCIAS, marketplacesConhecidos, versoesInstaladas } from './lib/dependencias'
import { dirName, joinPath, readText, resolvePaths } from './lib/files'
import {
  caminhosInstalados, comandoDoPrograma, dependenciasDoManifesto, escolherVsix, estadoDaExtensao, estadoDaSkill,
  estadoDoPrograma, estadoDoServidor, extensaoDoManifesto, extensoesInstaladas, instrucaoDoPrograma, type Plataforma,
  precisaAtencao, REQUISITOS, versaoDoTexto,
} from './lib/requisitos'

type Dollar = EngineInterface

const INICIAL: RequisitosUi = { lista: [], carregado: false, ocupado: false, verificadoEm: 0, manuais: [] }
const requisitosAtom = atom({ plugin: 'agents-creator', key: 'requisitos' } as const, INICIAL, { shape: 'requisitos-1' })

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// ---------------------------------------------------------------------------
// funções internas

/** Pasta pessoal do usuário: a mesma regra de `resolvePaths`. */
async function pastaHome($: Dollar, paths: Paths): Promise<string> {
  const perfil = await $.env.get('USERPROFILE')
  const casa = await $.env.get('HOME')
  return (paths.isWindows ? (perfil ?? casa) : (casa ?? perfil)) ?? dirName(paths.configDir)
}

/**
 * Roda um programa com esses argumentos. No Windows ele pode ser um `.cmd` (npm, instalador), que só roda pelo cmd.exe:
 * por isso `where.exe` diz antes se ele existe. Rejeita se o comando não existe ou se estoura o tempo.
 */
async function rodarPrograma($: Dollar, paths: Paths, programa: string, args: string[], timeoutMs: number) {
  if (!paths.isWindows) return $.process.run([programa, ...args], { timeoutMs })
  const onde = await $.process.run(['where.exe', programa], { timeoutMs: 30000 })
  if (onde.exitCode !== 0) throw new Error(`o comando ${programa} não está no PATH`)
  return $.process.run(['cmd.exe', '/d', '/s', '/c', programa, ...args], { timeoutMs })
}

/** Arquivos da pasta, recursivo até 4 níveis, com caminhos relativos separados por '/'. Pasta que não existe: []. */
async function listarArquivos($: Dollar, paths: Paths, pasta: string, prefixo = '', nivel = 0): Promise<string[]> {
  let entradas
  try {
    entradas = await $.fs.list(pasta)
  } catch {
    return []
  }
  const arquivos: string[] = []
  for (const entrada of entradas) {
    if (entrada.name.startsWith('.')) continue
    const caminho = joinPath(paths, pasta, entrada.name)
    const relativo = prefixo ? `${prefixo}/${entrada.name}` : entrada.name
    let tipo: string = entrada.kind
    if (entrada.kind === 'other' && entrada.isLink) tipo = (await $.fs.stat(caminho).catch(() => null))?.kind ?? 'other'
    if (tipo === 'file') arquivos.push(relativo)
    else if (tipo === 'dir' && nivel < 4) arquivos.push(...(await listarArquivos($, paths, caminho, relativo, nivel + 1)))
  }
  return arquivos.sort((a, b) => a.localeCompare(b))
}

/** Troca os itens de `lista` que têm o mesmo id de um item de `novos` e acrescenta os que não existiam. */
function mesclar(lista: RequisitoInfo[], novos: readonly RequisitoInfo[]): RequisitoInfo[] {
  const trocados = lista.map(item => novos.find(novo => novo.id === item.id) ?? item)
  const existentes = new Set(lista.map(item => item.id))
  return [...trocados, ...novos.filter(novo => !existentes.has(novo.id))]
}

/** Acrescenta um comando para rodar à mão em `manuais`, sem repetir. */
async function anotarManual($: Dollar, comando: string): Promise<void> {
  await update($, requisitosAtom, ui => ({ ...ui, manuais: ui.manuais.includes(comando) ? ui.manuais : [...ui.manuais, comando] }))
}

/** Como instalar programas aqui: 'windows', 'brew' (o Homebrew responde) ou 'outro'. */
async function plataforma($: Dollar, paths: Paths): Promise<Plataforma> {
  if (paths.isWindows) return 'windows'
  try {
    const res = await rodarPrograma($, paths, 'brew', ['--version'], 30000)
    return res.exitCode === 0 ? 'brew' : 'outro'
  } catch {
    return 'outro'
  }
}

/** A parte útil da saída de um comando que falhou (o erro primeiro); sem texto, o código de saída. */
function detalheDe(res: { exitCode: number; stdout: string; stderr: string }): string {
  return (res.stderr || res.stdout).trim().slice(0, 300) || `código ${res.exitCode}`
}

/** Corrige um item sem mexer em `ocupado` (quem chama cuida disso). Devolve se deu certo e o texto para o painel. */
async function corrigir($: Dollar, item: RequisitoInfo): Promise<{ ok: boolean; texto: string }> {
  const paths = await resolvePaths($)
  const home = await pastaHome($, paths)

  if (item.tipo === 'skill') {
    const r = REQUISITOS.find(x => x.id === item.id)
    if (!r || r.tipo !== 'skill') return { ok: false, texto: 'Item desconhecido.' }
    const instalados = await readText($, joinPath(paths, paths.configDir, 'plugins', 'installed_plugins.json'))
    const origem = caminhosInstalados(instalados)[r.plugin]
    if (!origem) return { ok: false, texto: `Instale o plugin ${r.plugin.split('@')[0] ?? r.plugin} antes de copiar a skill ${r.skill}.` }
    const fonte = joinPath(paths, origem, 'skills', r.skill)
    const destino = joinPath(paths, home, '.claude', 'skills', r.skill)
    const arquivos = await listarArquivos($, paths, fonte)
    if (arquivos.length === 0) return { ok: false, texto: `A skill ${r.skill} não está na pasta do plugin.` }
    for (const rel of arquivos) {
      const texto = await readText($, joinPath(paths, fonte, ...rel.split('/')))
      if (texto === null) continue
      const caminhoDestino = joinPath(paths, destino, ...rel.split('/'))
      const atual = await readText($, caminhoDestino)
      if (atual !== texto) await $.fs.write(caminhoDestino, texto)
    }
    return { ok: true, texto: `Skill ${r.skill} copiada para ~/.claude/skills/${r.skill}.` }
  }

  if (item.tipo === 'extensao') {
    const r = REQUISITOS.find(x => x.id === item.id)
    if (!r || r.tipo !== 'extensao') return { ok: false, texto: 'Item desconhecido.' }
    const textoMarketplaces = await readText($, joinPath(paths, paths.configDir, 'plugins', 'known_marketplaces.json'))
    const mk = marketplacesConhecidos(textoMarketplaces)[r.marketplace]
    if (mk && !mk.local) {
      // o clone do marketplace pode estar velho: atualiza antes, para o manifesto e o .vsix saírem da versão nova
      try {
        await rodarPrograma($, paths, 'claude', ['plugin', 'marketplace', 'update', r.marketplace], 180000)
      } catch {
        // sem o claude, segue com o catálogo que já está no disco
      }
    }
    const man = mk ? extensaoDoManifesto(await readText($, joinPath(paths, mk.pasta, ...r.manifesto.split('/')))) : null
    if (!mk || !man) return { ok: false, texto: `Não achei a ${item.nome} no repositório do plugin.` }
    const instaladas = extensoesInstaladas(await readText($, joinPath(paths, home, '.vscode', 'extensions', 'extensions.json')))
    const versaoInstalada = instaladas[man.id]
    if (versaoInstalada !== undefined && compararVersoes(versaoInstalada, man.versao) >= 0) {
      return { ok: true, texto: `${item.nome} já está na versão ${versaoInstalada}.` }
    }
    const pastaDist = joinPath(paths, mk.pasta, 'dist')
    let nomes: string[]
    try {
      nomes = (await $.fs.list(pastaDist)).filter(entrada => entrada.kind === 'file').map(entrada => entrada.name)
    } catch {
      nomes = []
    }
    const arquivo = escolherVsix(nomes, man.nome, man.versao)
    if (arquivo === '') return { ok: false, texto: `Não achei o .vsix da ${item.nome} em ${pastaDist}.` }
    const vsix = joinPath(paths, pastaDist, arquivo)
    let res: Awaited<ReturnType<typeof rodarPrograma>>
    try {
      res = await rodarPrograma($, paths, 'code', ['--install-extension', vsix, '--force'], 300000)
    } catch {
      await anotarManual($, `code --install-extension "${vsix}" --force`)
      return { ok: false, texto: `Não achei o comando code: instale a ${item.nome} à mão (o comando está no fim da tela).` }
    }
    if (res.exitCode !== 0) return { ok: false, texto: `Não consegui instalar a ${item.nome}: ${detalheDe(res)}` }
    return { ok: true, texto: `${item.nome} instalada. No VS Code, rode Developer: Reload Window.` }
  }

  if (item.tipo === 'programa') {
    const r = REQUISITOS.find(x => x.id === item.id)
    if (!r || r.tipo !== 'programa') return { ok: false, texto: 'Item desconhecido.' }
    const argv = comandoDoPrograma(r.programa, await plataforma($, paths))
    if (argv === null) {
      await anotarManual($, instrucaoDoPrograma(r.programa))
      return { ok: false, texto: instrucaoDoPrograma(r.programa) }
    }
    const programa = argv[0] ?? r.programa
    let res: Awaited<ReturnType<typeof rodarPrograma>>
    try {
      res = await rodarPrograma($, paths, programa, argv.slice(1), 600000)
    } catch {
      await anotarManual($, argv.join(' '))
      return { ok: false, texto: `Não consegui rodar o ${programa}: rode à mão o comando do fim da tela.` }
    }
    if (res.exitCode !== 0) {
      await anotarManual($, argv.join(' '))
      return { ok: false, texto: `O ${programa} não instalou o ${item.nome}: ${detalheDe(res)}` }
    }
    return { ok: true, texto: `${item.nome} instalado. Feche e abra o Claude Code para ele entrar no PATH; depois, Verificar tudo.` }
  }

  if (item.tipo === 'plugin') {
    const id = item.id.slice('plugin:'.length)
    let res: Awaited<ReturnType<typeof rodarPrograma>>
    try {
      res = await rodarPrograma($, paths, 'claude', ['plugin', 'install', id], 300000)
    } catch {
      await anotarManual($, `claude plugin install ${id}`)
      return { ok: false, texto: 'Não achei o comando claude: rode à mão o comando do fim da tela.' }
    }
    if (res.exitCode !== 0) return { ok: false, texto: `Não consegui instalar ${item.nome}: ${detalheDe(res)}` }
    return { ok: true, texto: `${item.nome} instalado. Rode /reload-plugins para carregá-lo.` }
  }

  // servidor: o Claude Code é quem liga; não há comando para rodar
  return { ok: false, texto: 'O Claude Code liga o servidor do popup sozinho: com o Node.js instalado, rode /reload-plugins e depois Verificar tudo.' }
}

// ---------------------------------------------------------------------------
// estado da tela

/** O que a tela Dependências desenha: os requisitos, o estado da verificação e os comandos para rodar à mão. */
export async function requisitosSnapshot($: Dollar): Promise<RequisitosUi> {
  return read($, requisitosAtom)
}

/** Grava parte do estado da tela Dependências. */
export async function setRequisitos($: Dollar, patch: Partial<RequisitosUi>): Promise<void> {
  await update($, requisitosAtom, ui => ({ ...ui, ...patch }))
}

/** Relê o disco: skills avulsas, extensões do VS Code e dependências dos plugins. Nunca roda processo. */
export async function carregarRequisitos($: Dollar): Promise<void> {
  const paths = await resolvePaths($)
  const home = await pastaHome($, paths)
  const instalados = await readText($, joinPath(paths, paths.configDir, 'plugins', 'installed_plugins.json'))
  const conhecidos = marketplacesConhecidos(await readText($, joinPath(paths, paths.configDir, 'plugins', 'known_marketplaces.json')))
  const caminhos = caminhosInstalados(instalados)
  const versoes = versoesInstaladas(instalados)
  const anterior = (await requisitosSnapshot($)).lista
  const lista: RequisitoInfo[] = []

  // a) dependências dos plugins exigidos: o `dependencies` do plugin.json de cada um (2º nível)
  for (const dep of DEPENDENCIAS) {
    const caminho = caminhos[dep.id]
    if (!caminho) continue
    for (const d of dependenciasDoManifesto(await readText($, joinPath(paths, caminho, '.claude-plugin', 'plugin.json')))) {
      if (DEPENDENCIAS.some(item => item.id === d) || d.startsWith('agents-creator@')) continue
      const indice = lista.findIndex(item => item.id === `plugin:${d}`)
      if (indice >= 0) {
        const existente = lista[indice]
        if (existente && !existente.de.includes(dep.id)) lista[indice] = { ...existente, de: [...existente.de, dep.id] }
        continue
      }
      const versao = versoes[d] ?? ''
      lista.push({
        id: `plugin:${d}`, tipo: 'plugin', nome: d.split('@')[0] ?? d, de: [dep.id], para: `${dep.nome} precisa dele`,
        encontrada: versao, esperada: '', estado: versao ? 'ok' : 'faltando', detalhe: versao ? '' : 'não instalado',
      })
    }
  }

  // b) skills avulsas: a cópia em ~/.claude/skills é a que o /sala e o /revisao procuram
  for (const r of REQUISITOS) {
    if (r.tipo !== 'skill') continue
    const base: Omit<RequisitoInfo, 'estado' | 'detalhe'> = { id: r.id, tipo: 'skill', nome: r.nome, de: [...r.de], para: r.para, encontrada: '', esperada: '' }
    const origem = caminhos[r.plugin]
    if (!origem) {
      lista.push({ ...base, estado: 'desconhecido', detalhe: `instale o plugin ${r.plugin.split('@')[0] ?? r.plugin} primeiro` })
      continue
    }
    const pastaFonte = joinPath(paths, origem, 'skills', r.skill)
    const pastaDestino = joinPath(paths, home, '.claude', 'skills', r.skill)
    const fonte: Record<string, string> = {}
    for (const rel of await listarArquivos($, paths, pastaFonte)) {
      const texto = await readText($, joinPath(paths, pastaFonte, ...rel.split('/')))
      if (texto !== null) fonte[rel] = texto
    }
    const destino: Record<string, string | null> = {}
    for (const rel of Object.keys(fonte)) destino[rel] = await readText($, joinPath(paths, pastaDestino, ...rel.split('/')))
    if (!(r.arquivo in destino)) destino[r.arquivo] = await readText($, joinPath(paths, pastaDestino, ...r.arquivo.split('/')))
    const estado = estadoDaSkill(fonte, destino, r.arquivo)
    const detalhe = estado === 'faltando' ? `falta em ~/.claude/skills/${r.skill}`
      : estado === 'desatualizado' ? `a cópia em ~/.claude/skills/${r.skill} é diferente da do plugin`
      : estado === 'desconhecido' ? 'a skill não está na pasta do plugin'
      : ''
    lista.push({ ...base, estado, detalhe })
  }

  // c) extensões do VS Code: as que estão listadas em ~/.vscode/extensions/extensions.json
  const textoVscode = await readText($, joinPath(paths, home, '.vscode', 'extensions', 'extensions.json'))
  const temVscode = textoVscode !== null
  const instaladas = extensoesInstaladas(textoVscode)
  for (const r of REQUISITOS) {
    if (r.tipo !== 'extensao') continue
    const base: Omit<RequisitoInfo, 'estado' | 'detalhe'> = { id: r.id, tipo: 'extensao', nome: r.nome, de: [...r.de], para: r.para, encontrada: '', esperada: '' }
    const mk = conhecidos[r.marketplace]
    if (!mk) {
      lista.push({ ...base, estado: 'desconhecido', detalhe: `o marketplace ${r.marketplace} não está registrado` })
      continue
    }
    const man = extensaoDoManifesto(await readText($, joinPath(paths, mk.pasta, ...r.manifesto.split('/'))))
    if (!man) {
      lista.push({ ...base, estado: 'desconhecido', detalhe: 'não achei a extensão no repositório do plugin' })
      continue
    }
    const encontrada = instaladas[man.id] ?? ''
    const estado = estadoDaExtensao(encontrada, man.versao, temVscode)
    const detalhe = estado === 'opcional' ? 'VS Code não encontrado neste computador' : estado === 'faltando' ? 'não está instalada no VS Code' : ''
    lista.push({ ...base, encontrada, esperada: man.versao, estado, detalhe })
  }

  // d) programas e servidor: o que a última verificação achou; antes da primeira, "use Verificar tudo"
  for (const r of REQUISITOS) {
    if (r.tipo !== 'programa' && r.tipo !== 'servidor') continue
    const antes = anterior.find(item => item.id === r.id)
    if (antes) {
      lista.push(antes)
      continue
    }
    lista.push({
      id: r.id, tipo: r.tipo, nome: r.nome, de: [...r.de], para: r.para, encontrada: '',
      esperada: r.tipo === 'programa' ? r.minimo : '', estado: 'desconhecido', detalhe: 'use Verificar tudo',
    })
  }

  await update($, requisitosAtom, ui => ({ ...ui, lista, carregado: true }))
}

/**
 * "Verificar tudo": atualiza os catálogos dos plugins exigidos, verifica os programas e o servidor do popup, relê o disco
 * e diz no toast o que precisa de atenção.
 */
export async function verificarTudo($: Dollar): Promise<void> {
  if ((await requisitosSnapshot($)).ocupado) return
  await setRequisitos($, { ocupado: true, manuais: [] })
  try {
    await procurarAtualizacoes($)
    const paths = await resolvePaths($)
    // O catálogo do próprio estúdio traz o manifesto da extensão Estúdio de Agentes.
    const conhecidos = marketplacesConhecidos(await readText($, joinPath(paths, paths.configDir, 'plugins', 'known_marketplaces.json')))
    const loja = conhecidos['agents-creator']
    if (loja && !loja.local) {
      try {
        await rodarPrograma($, paths, 'claude', ['plugin', 'marketplace', 'update', 'agents-creator'], 180000)
      } catch {
        // sem o claude, a verificação segue com o catálogo que já está no disco
      }
    }
    const home = await pastaHome($, paths)
    const temVscode = (await readText($, joinPath(paths, home, '.vscode', 'extensions', 'extensions.json'))) !== null
    const novos: RequisitoInfo[] = []

    for (const r of REQUISITOS) {
      if (r.tipo !== 'programa') continue
      let achou = false
      let encontrada = ''
      try {
        const res = await rodarPrograma($, paths, r.programa, ['--version'], 30000)
        achou = res.exitCode === 0
        encontrada = achou ? versaoDoTexto(`${res.stdout}\n${res.stderr}`) : ''
      } catch {
        achou = false
      }
      let estado = estadoDoPrograma(achou, encontrada, r.minimo)
      if (r.programa === 'code' && estado === 'faltando' && !temVscode) estado = 'opcional'
      const detalhe = estado === 'faltando' || estado === 'desatualizado' ? instrucaoDoPrograma(r.programa)
        : estado === 'opcional' ? 'só faz falta para quem usa o VS Code'
        : ''
      novos.push({ id: r.id, tipo: 'programa', nome: r.nome, de: [...r.de], para: r.para, encontrada, esperada: r.minimo, estado, detalhe })
    }

    for (const r of REQUISITOS) {
      if (r.tipo !== 'servidor') continue
      let estado: EstadoRequisito = 'desconhecido'
      let detalhe = ''
      try {
        const res = await rodarPrograma($, paths, 'claude', ['mcp', 'list'], 120000)
        estado = estadoDoServidor(res.stdout, r.servidor)
      } catch {
        detalhe = 'não consegui rodar claude mcp list'
      }
      if (detalhe === '') {
        detalhe = estado === 'parado' ? 'não conectou: confira o Node.js e rode /reload-plugins'
          : estado === 'desconhecido' ? 'não aparece em claude mcp list: o plugin está ativo? Rode /reload-plugins'
          : ''
      }
      novos.push({ id: r.id, tipo: 'servidor', nome: r.nome, de: [...r.de], para: r.para, encontrada: '', esperada: '', estado, detalhe })
    }

    await update($, requisitosAtom, ui => ({ ...ui, lista: mesclar(ui.lista, novos) }))
    await carregarRequisitos($)
    await setRequisitos($, { verificadoEm: await $.clock.now() })

    const plugins = (await estruturasSnapshot($)).dependencias
      .filter(dep => dep.estado === 'faltando' || dep.estado === 'desatualizada' || dep.estado === 'desativada').length
    const pendentes = (await requisitosSnapshot($)).lista.filter(r => precisaAtencao(r.estado) || (r.tipo === 'servidor' && r.estado === 'desconhecido'))
    const reqs = pendentes.length
    if (plugins === 0 && reqs === 0) {
      await say($, 'ok', 'Tudo certo: os plugins do estúdio e o que eles precisam estão instalados, rodando e atualizados.')
    } else {
      const partes: string[] = []
      if (plugins > 0) partes.push(plugins === 1 ? '1 plugin' : `${plugins} plugins`)
      if (reqs > 0) partes.push(reqs === 1 ? '1 requisito' : `${reqs} requisitos`)
      const soServidor = plugins === 0 && pendentes.every(r => r.tipo === 'servidor')
      const fim = soServidor ? 'O servidor do popup não respondeu: confira o Node.js, rode /reload-plugins e depois Verificar tudo.' : 'Use Corrigir tudo ou o botão de cada um.'
      await say($, 'warn', `Precisam de atenção: ${partes.join(' e ')}. ${fim}`)
    }
  } catch (error) {
    await say($, 'error', `Não consegui verificar as dependências: ${message(error)}`)
  } finally {
    await setRequisitos($, { ocupado: false })
  }
}

/** Corrige um requisito pelo botão dele (copia a skill, instala a extensão, o programa ou o plugin) e diz o resultado. */
export async function corrigirRequisito($: Dollar, id: string): Promise<void> {
  const ui = await requisitosSnapshot($)
  const item = ui.lista.find(x => x.id === id)
  if (!item || ui.ocupado) return
  await setRequisitos($, { ocupado: true })
  try {
    const r = await corrigir($, item)
    await carregarRequisitos($)
    await say($, r.ok ? 'ok' : 'warn', r.texto)
  } catch (error) {
    await say($, 'error', `Não consegui corrigir ${item.nome}: ${message(error)}`)
  } finally {
    await setRequisitos($, { ocupado: false })
  }
}

/**
 * "Corrigir tudo": instala, atualiza e ativa os plugins exigidos, copia as skills e instala as extensões que faltam.
 * Não instala programa (git, Node.js, VS Code): esses só pelo botão de cada um.
 */
export async function corrigirTudo($: Dollar): Promise<void> {
  if ((await requisitosSnapshot($)).ocupado) return
  const pluginsPendentes = (await estruturasSnapshot($)).dependencias.filter(dep => comandoDe(dep) !== null).length
  await atualizarTodas($)
  await carregarRequisitos($)
  await setRequisitos($, { ocupado: true })
  try {
    const alvos = (await requisitosSnapshot($)).lista.filter(item =>
      (item.tipo === 'plugin' || item.tipo === 'skill' || item.tipo === 'extensao') && (item.estado === 'faltando' || item.estado === 'desatualizado'))
    const feitos: string[] = []
    const falhas: string[] = []
    let recarregar = pluginsPendentes > 0
    for (const alvo of alvos) {
      const r = await corrigir($, alvo)
      if (r.ok) {
        feitos.push(alvo.nome)
        if (alvo.tipo === 'plugin') recarregar = true
      } else {
        falhas.push(alvo.nome)
      }
    }
    await carregarRequisitos($)
    const programas = (await requisitosSnapshot($)).lista
      .filter(item => item.tipo === 'programa' && precisaAtencao(item.estado))
      .map(item => item.nome)
    const partes: string[] = []
    if (recarregar) partes.push('Rode /reload-plugins para carregar os plugins instalados, atualizados ou ativados.')
    if (feitos.length > 0) partes.push(`Feito: ${feitos.join(', ')}.`)
    if (falhas.length > 0) partes.push(`Não consegui: ${falhas.join(', ')} (veja os comandos no fim da tela).`)
    if (programas.length > 0) partes.push(`Falta instalar: ${programas.join(', ')}. Use o botão Instalar de cada um.`)
    if (partes.length === 0) partes.push('Nada a corrigir.')
    await say($, falhas.length > 0 || programas.length > 0 ? 'warn' : 'ok', partes.join(' '))
  } catch (error) {
    await say($, 'error', `Não consegui corrigir as dependências: ${message(error)}`)
  } finally {
    await setRequisitos($, { ocupado: false })
  }
}

/** Abre a tela Dependências e relê o disco (plugins exigidos e requisitos). Não verifica: isso é o "Verificar tudo". */
export async function abrirDependencias($: Dollar): Promise<void> {
  await go($, 'dependencias')
  await carregarDependencias($)
  await carregarRequisitos($)
}
