// Dependências das dependências: o que cada plugin exigido precisa além dele mesmo (skills avulsas, extensões do
// VS Code, programas e o servidor do popup). Funções puras: a leitura do disco e os comandos ficam em ../requisitos.

import type { EstadoRequisito, RequisitoInfo } from '../../types'
import { compararVersoes } from './dependencias'

export type Programa = 'node' | 'git' | 'code'
export type Plataforma = 'windows' | 'brew' | 'outro'

/** Um requisito: o que um plugin exigido precisa além dele mesmo. `de` lista os plugins (`nome@marketplace`) que o pedem. */
export type Requisito =
  | { tipo: 'skill'; id: string; nome: string; de: string[]; para: string; skill: string; plugin: string; arquivo: string }
  | { tipo: 'extensao'; id: string; nome: string; de: string[]; para: string; marketplace: string; manifesto: string }
  | { tipo: 'programa'; id: string; nome: string; de: string[]; para: string; programa: Programa; minimo: string }
  | { tipo: 'servidor'; id: string; nome: string; de: string[]; para: string; servidor: string }

/** Os 11 requisitos, na ordem da tabela. */
export const REQUISITOS: readonly Requisito[] = [
  // Skills: os painéis /sala e /revisao procuram a skill em ~/.claude/skills, não no plugin.
  { tipo: 'skill', id: 'skill:squad-stream', nome: 'skill squad-stream', de: ['squad-room-pane@skill-squad-room'], para: 'o /sala achar a sala dos agentes', skill: 'squad-stream', plugin: 'squad-stream@skill-squad-room', arquivo: 'scripts/bus.js' },
  { tipo: 'skill', id: 'skill:review-edits', nome: 'skill review-edits', de: ['diff-review-pane@skill-diff-claude-code'], para: 'o /revisao achar as edições', skill: 'review-edits', plugin: 'diff-review@skill-diff-claude-code', arquivo: 'scripts/review.js' },
  // Extensões do VS Code que os plugins trazem em dist/*.vsix: cada uma é pedida pelos plugins em `de`.
  { tipo: 'extensao', id: 'extensao:claude-request-history', nome: 'extensão Claude Request History', de: ['historico@historico-requisicoes'], para: 'o popup do histórico no VS Code', marketplace: 'historico-requisicoes', manifesto: 'vscode-extension/package.json' },
  { tipo: 'extensao', id: 'extensao:claude-review', nome: 'extensão Claude Review', de: ['diff-review@skill-diff-claude-code'], para: 'revisar as edições no VS Code', marketplace: 'skill-diff-claude-code', manifesto: 'extensions/claude-review/package.json' },
  { tipo: 'extensao', id: 'extensao:squad-room', nome: 'extensão Squad Room', de: ['squad-stream@skill-squad-room'], para: 'a sala dos agentes no VS Code', marketplace: 'skill-squad-room', manifesto: 'extensions/squad-room/package.json' },
  { tipo: 'extensao', id: 'extensao:claude-popup-perguntas', nome: 'extensão Claude Popup de Perguntas', de: ['popup-perguntas@popup-perguntas'], para: 'o popup dentro do VS Code (sem ela, ele abre no navegador)', marketplace: 'popup-perguntas', manifesto: 'vscode-extension/package.json' },
  { tipo: 'extensao', id: 'extensao:estudio-de-agentes', nome: 'extensão Estúdio de Agentes', de: ['agents-creator@agents-creator'], para: 'o ícone do estúdio na barra do VS Code', marketplace: 'agents-creator', manifesto: 'extensions/estudio-de-agentes/package.json' },
  // Programas: o Node.js roda os scripts, os hooks e o servidor do popup; o git é pedido pelo historico; o code instala as extensões.
  { tipo: 'programa', id: 'programa:node', nome: 'Node.js', de: ['historico@historico-requisicoes', 'diff-review@skill-diff-claude-code', 'squad-stream@skill-squad-room', 'popup-perguntas@popup-perguntas'], para: 'os scripts das skills, os hooks e o servidor do popup', programa: 'node', minimo: '18.0.0' },
  { tipo: 'programa', id: 'programa:git', nome: 'git', de: ['historico@historico-requisicoes'], para: 'o checkpoint git de cada pedido', programa: 'git', minimo: '' },
  { tipo: 'programa', id: 'programa:code', nome: 'VS Code (comando code)', de: [], para: 'instalar as extensões do VS Code', programa: 'code', minimo: '' },
  // Servidor MCP do popup: a ferramenta perguntar só funciona quando ele conecta.
  { tipo: 'servidor', id: 'servidor:popup-perguntas', nome: 'servidor do popup', de: ['popup-perguntas@popup-perguntas'], para: 'a ferramenta perguntar do popup', servidor: 'plugin:popup-perguntas:popup-perguntas' },
]

type Registro = Record<string, unknown>

const isRecord = (value: unknown): value is Registro => value !== null && typeof value === 'object' && !Array.isArray(value)

/** JSON lido de um texto. `undefined` se não há texto ou se o texto não é JSON. */
function lerJson(texto: string | null): unknown {
  if (texto === null) return undefined
  try {
    return JSON.parse(texto)
  } catch {
    return undefined
  }
}

/** Um id de plugin: `nome@marketplace`, só com letras, números, ponto, traço e sublinhado. */
const ID_DE_PLUGIN = /^[a-z0-9][a-z0-9._-]*@[a-z0-9][a-z0-9._-]*$/i

/** Caminho instalado de cada plugin (`installed_plugins.json`): o do escopo user; sem ele, o primeiro que tiver um. */
export function caminhosInstalados(json: string | null): Record<string, string> {
  const caminhos: Record<string, string> = {}
  const raiz = lerJson(json)
  const plugins = isRecord(raiz) ? raiz.plugins : undefined
  if (!isRecord(plugins)) return caminhos
  for (const [id, entradas] of Object.entries(plugins)) {
    if (!Array.isArray(entradas)) continue
    const comCaminho = entradas.filter(isRecord).filter(entrada => typeof entrada.installPath === 'string' && entrada.installPath !== '')
    const escolhida = comCaminho.find(entrada => entrada.scope === 'user') ?? comCaminho[0]
    if (escolhida && typeof escolhida.installPath === 'string') caminhos[id] = escolhida.installPath
  }
  return caminhos
}

/** O `nome@marketplace` de um item de `dependencies`: texto, ou `{ name, marketplace }`. null se o item não tem essa forma. */
function idDaDependencia(item: unknown): string | null {
  if (typeof item === 'string') return item
  if (!isRecord(item) || typeof item.marketplace !== 'string') return null
  const nome = typeof item.name === 'string' ? item.name : item.plugin
  return typeof nome === 'string' ? `${nome}@${item.marketplace}` : null
}

/** Ids `nome@marketplace` que o plugin.json pede em `dependencies`, na ordem e sem repetir. */
export function dependenciasDoManifesto(json: string | null): string[] {
  const raiz = lerJson(json)
  const lista = isRecord(raiz) ? raiz.dependencies : undefined
  if (!Array.isArray(lista)) return []
  const ids: string[] = []
  for (const item of lista) {
    const id = idDaDependencia(item)
    if (id !== null && ID_DE_PLUGIN.test(id) && !ids.includes(id)) ids.push(id)
  }
  return ids
}

/** Versão de cada extensão instalada (`extensions.json` do VS Code): id em minúsculas → versão. */
export function extensoesInstaladas(json: string | null): Record<string, string> {
  const versoes: Record<string, string> = {}
  const lista = lerJson(json)
  if (!Array.isArray(lista)) return versoes
  for (const item of lista.filter(isRecord)) {
    const identifier = isRecord(item.identifier) ? item.identifier : undefined
    const id = identifier && typeof identifier.id === 'string' ? identifier.id : ''
    if (id === '' || typeof item.version !== 'string' || item.version === '') continue
    versoes[id.toLowerCase()] = item.version
  }
  return versoes
}

/** Versão de cada extensão listada pelo `code --list-extensions --show-versions` (`publisher.nome@versao`), id em minúsculas. */
export function extensoesDaLista(saida: string): Record<string, string> {
  const versoes: Record<string, string> = {}
  for (const linha of saida.split(/\r?\n/).map(texto => texto.trim())) {
    const arroba = linha.lastIndexOf('@')
    if (arroba === -1) continue
    const id = linha.slice(0, arroba).toLowerCase()
    const versao = linha.slice(arroba + 1)
    if (id === '' || versao === '') continue
    versoes[id] = versao
  }
  return versoes
}

/** Id (`publisher.nome`, em minúsculas), nome e versão do package.json de uma extensão; null se falta algum deles. */
export function extensaoDoManifesto(json: string | null): { id: string; nome: string; versao: string } | null {
  const raiz = lerJson(json)
  if (!isRecord(raiz)) return null
  const { publisher, name, version } = raiz
  if (typeof publisher !== 'string' || typeof name !== 'string' || typeof version !== 'string') return null
  if (publisher === '' || name === '' || version === '') return null
  return { id: `${publisher}.${name}`.toLowerCase(), nome: name, versao: version }
}

const SUFIXO_VSIX = '.vsix'

/** Se o arquivo é da extensão `nome` (em minúsculas): `nome.vsix` ou `nome-<dígito>…vsix`. `nome-pane-1.vsix` não é. */
function ehVsixDaExtensao(arquivo: string, nome: string): boolean {
  const minusculo = arquivo.toLowerCase()
  if (!minusculo.endsWith(SUFIXO_VSIX)) return false
  const semSufixo = minusculo.slice(0, -SUFIXO_VSIX.length)
  if (semSufixo === nome) return true
  return semSufixo.startsWith(`${nome}-`) && /\d/.test(semSufixo.charAt(nome.length + 1))
}

/** O .vsix da extensão `nome` na versão dada; sem ele, o último em ordem alfabética. '' se não há nenhum. */
export function escolherVsix(arquivos: readonly string[], nome: string, versao: string): string {
  const alvo = nome.toLowerCase()
  const candidatos = arquivos.filter(arquivo => ehVsixDaExtensao(arquivo, alvo))
  const sufixoDaVersao = `-${versao}${SUFIXO_VSIX}`.toLowerCase()
  const daVersao = candidatos.find(arquivo => arquivo.toLowerCase().includes(sufixoDaVersao))
  if (daVersao !== undefined) return daVersao
  const ordenados = [...candidatos].sort()
  return ordenados[ordenados.length - 1] ?? ''
}

/** Versão (`x.y.z`, ou `x.y`) da primeira ocorrência no texto; '' se não há nenhuma. */
export function versaoDoTexto(texto: string): string {
  const achado = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(texto)
  if (achado === null) return ''
  const [, maior, menor, correcao] = achado
  return correcao === undefined ? `${maior}.${menor}` : `${maior}.${menor}.${correcao}`
}

/** Estado de um servidor MCP pela saída de `claude mcp list`: 'ok' se a linha dele diz Connected, 'parado' se não diz. */
export function estadoDoServidor(saida: string, servidor: string): 'ok' | 'parado' | 'desconhecido' {
  const linha = saida.split(/\r?\n/).map(texto => texto.trim()).find(texto => texto.startsWith(`${servidor}:`))
  if (linha === undefined) return 'desconhecido'
  return /\bConnected\b/.test(linha) && !linha.includes('Failed') ? 'ok' : 'parado'
}

/** Estado de uma extensão: 'opcional' sem o VS Code; 'faltando' se não está instalada; 'desatualizado' se abaixo da esperada. */
export function estadoDaExtensao(encontrada: string, esperada: string, temVscode: boolean): EstadoRequisito {
  if (!temVscode) return 'opcional'
  if (encontrada === '') return 'faltando'
  if (esperada !== '' && compararVersoes(encontrada, esperada) < 0) return 'desatualizado'
  return 'ok'
}

/** Estado de um programa: 'faltando' se não achou; 'desatualizado' se a versão está abaixo do mínimo. */
export function estadoDoPrograma(achou: boolean, encontrada: string, minimo: string): EstadoRequisito {
  if (!achou) return 'faltando'
  if (minimo !== '' && encontrada !== '' && compararVersoes(encontrada, minimo) < 0) return 'desatualizado'
  return 'ok'
}

/** Estado de uma skill avulsa: a cópia em `destino` (arquivo → conteúdo, ou null se falta) contra a de `fonte` (o plugin). */
export function estadoDaSkill(fonte: Readonly<Record<string, string>>, destino: Readonly<Record<string, string | null>>, arquivo: string): EstadoRequisito {
  const chaves = Object.keys(fonte)
  if (chaves.length === 0) return 'desconhecido'
  const copia = destino[arquivo]
  if (copia === undefined || copia === null) return 'faltando'
  return chaves.some(chave => destino[chave] !== fonte[chave]) ? 'desatualizado' : 'ok'
}

/** Comando (argv) que instala o programa pelo gerenciador da plataforma; null se a plataforma não tem um. */
export function comandoDoPrograma(programa: Programa, plataforma: Plataforma): string[] | null {
  if (plataforma === 'windows') {
    const id = { node: 'OpenJS.NodeJS.LTS', git: 'Git.Git', code: 'Microsoft.VisualStudioCode' }[programa]
    return ['winget', 'install', '--id', id, '-e', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements']
  }
  if (plataforma === 'brew') {
    if (programa === 'node') return ['brew', 'install', 'node']
    if (programa === 'git') return ['brew', 'install', 'git']
    return ['brew', 'install', '--cask', 'visual-studio-code']
  }
  return null
}

const INSTRUCOES: Record<Programa, string> = {
  node: 'Instale o Node.js 18 ou mais novo: https://nodejs.org (no Windows: winget install OpenJS.NodeJS.LTS).',
  git: 'Instale o git: https://git-scm.com/downloads (no Windows: winget install Git.Git).',
  code: `Instale o VS Code e deixe o comando code no PATH: https://code.visualstudio.com (no macOS: comando "Shell Command: Install 'code' command in PATH").`,
}

/** O texto que diz ao usuário como instalar o programa à mão. */
export function instrucaoDoPrograma(programa: Programa): string {
  return INSTRUCOES[programa]
}

/** Estados que pedem ação: faltando, desatualizado e parado. Os outros (ok, opcional, desconhecido) não. */
export function precisaAtencao(estado: EstadoRequisito): boolean {
  return estado === 'faltando' || estado === 'desatualizado' || estado === 'parado'
}

/** Resumo para o toast, como `2 faltando, 1 desatualizado`; '' quando nada precisa de atenção. */
export function resumoRequisitos(lista: readonly RequisitoInfo[]): string {
  const contar = (estado: EstadoRequisito): number => lista.filter(item => item.estado === estado).length
  const faltando = contar('faltando')
  const desatualizados = contar('desatualizado')
  const parados = contar('parado')
  const partes: string[] = []
  if (faltando > 0) partes.push(`${faltando} faltando`)
  if (desatualizados > 0) partes.push(desatualizados === 1 ? '1 desatualizado' : `${desatualizados} desatualizados`)
  if (parados > 0) partes.push(parados === 1 ? '1 parado' : `${parados} parados`)
  return partes.join(', ')
}
