// Dependências do agents-creator: a lista dos 7 plugins, as versões instaladas, o catálogo dos marketplaces e o estado de cada um.
// Funções puras: a leitura dos arquivos e a execução do `claude` ficam em ../estruturas.

import type { EstadoDependencia } from '../../types'

/** Um plugin que o agents-creator exige. `id` é como o Claude Code o chama: `nome@marketplace`. */
export type Dependencia = { id: string; nome: string; marketplace: string; repo: string; para: string }

export const DEPENDENCIAS: readonly Dependencia[] = [
  { id: 'historico@historico-requisicoes', nome: 'historico', marketplace: 'historico-requisicoes', repo: 'marco3079/skill-git-claude-code', para: 'checkpoint git a cada pedido' },
  { id: 'historico-painel@historico-requisicoes', nome: 'historico-painel', marketplace: 'historico-requisicoes', repo: 'marco3079/skill-git-claude-code', para: 'painel do histórico' },
  { id: 'diff-review@skill-diff-claude-code', nome: 'diff-review', marketplace: 'skill-diff-claude-code', repo: 'marco3079/skill-diff-claude-code', para: 'revisar as edições' },
  { id: 'diff-review-pane@skill-diff-claude-code', nome: 'diff-review-pane', marketplace: 'skill-diff-claude-code', repo: 'marco3079/skill-diff-claude-code', para: 'painel /revisao' },
  { id: 'squad-stream@skill-squad-room', nome: 'squad-stream', marketplace: 'skill-squad-room', repo: 'marco3079/skill-squad-room', para: 'a sala dos agentes' },
  { id: 'squad-room-pane@skill-squad-room', nome: 'squad-room-pane', marketplace: 'skill-squad-room', repo: 'marco3079/skill-squad-room', para: 'painel /sala' },
  { id: 'popup-perguntas@popup-perguntas', nome: 'popup-perguntas', marketplace: 'popup-perguntas', repo: 'marco3079/skill-popup-duvida-cloude-code', para: 'perguntas pelo popup' },
]

type Registro = Record<string, unknown>

const isRecord = (value: unknown): value is Registro => value !== null && typeof value === 'object' && !Array.isArray(value)

/** JSON lido de um arquivo. `undefined` se não há texto ou se o texto não é JSON. */
function lerJson(texto: string | null): unknown {
  if (texto === null) return undefined
  try {
    return JSON.parse(texto)
  } catch {
    return undefined
  }
}

/** Uma parte da versão como número: o que não é número (ou falta) vale 0. */
function numeroDaParte(parte: string | undefined): number {
  const numero = Number.parseInt(parte ?? '', 10)
  return Number.isNaN(numero) ? 0 : numero
}

/** Compara versões parte a parte, como números: `0.10.0` é maior que `0.2.0`. Devolve -1, 0 ou 1. */
export function compararVersoes(a: string, b: string): number {
  const pa = a.split('.')
  const pb = b.split('.')
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = numeroDaParte(pa[i])
    const y = numeroDaParte(pb[i])
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/** Versão de cada plugin instalado (`installed_plugins.json`): a do escopo do usuário, senão a primeira que tiver versão. */
export function versoesInstaladas(json: string | null): Record<string, string> {
  const versoes: Record<string, string> = {}
  const raiz = lerJson(json)
  const plugins = isRecord(raiz) ? raiz.plugins : undefined
  if (!isRecord(plugins)) return versoes
  for (const [id, entradas] of Object.entries(plugins)) {
    if (!Array.isArray(entradas)) continue
    const comVersao = entradas.filter(isRecord).filter(entrada => typeof entrada.version === 'string')
    const escolhida = comVersao.find(entrada => entrada.scope === 'user') ?? comVersao[0]
    if (escolhida && typeof escolhida.version === 'string') versoes[id] = escolhida.version
  }
  return versoes
}

/** Marketplaces conhecidos (`known_marketplaces.json`): se cada um é uma pasta local e onde fica. Entrada sem pasta sai. */
export function marketplacesConhecidos(json: string | null): Record<string, { local: boolean; pasta: string }> {
  const conhecidos: Record<string, { local: boolean; pasta: string }> = {}
  const raiz = lerJson(json)
  if (!isRecord(raiz)) return conhecidos
  for (const [nome, entrada] of Object.entries(raiz)) {
    if (!isRecord(entrada) || typeof entrada.installLocation !== 'string' || entrada.installLocation.trim() === '') continue
    const origem = isRecord(entrada.source) ? entrada.source : {}
    conhecidos[nome] = { local: origem.source === 'directory', pasta: entrada.installLocation }
  }
  return conhecidos
}

/** Versão e fonte de um plugin no `marketplace.json` do catálogo. Vazias quando o plugin não está nele. */
export function entradaNoCatalogo(json: string | null, nome: string): { versao: string; fonte: string } {
  const raiz = lerJson(json)
  const lista = isRecord(raiz) ? raiz.plugins : undefined
  const entrada = Array.isArray(lista) ? lista.filter(isRecord).find(item => item.name === nome) : undefined
  if (!entrada) return { versao: '', fonte: '' }
  return {
    versao: typeof entrada.version === 'string' ? entrada.version : '',
    fonte: typeof entrada.source === 'string' ? entrada.source : '',
  }
}

/** Versão do `plugin.json` de um plugin; '' se não há. */
export function versaoDoManifesto(json: string | null): string {
  const raiz = lerJson(json)
  return isRecord(raiz) && typeof raiz.version === 'string' ? raiz.version : ''
}

/** Estado de um plugin. `instalada` e `ultima` são versões ('' = não sabemos). Pasta local não é comparada com o catálogo. */
export function estadoDe(instalada: string, ultima: string, local: boolean): EstadoDependencia {
  if (instalada === '') return 'faltando'
  if (local) return 'local'
  if (ultima === '') return 'desconhecida'
  return compararVersoes(instalada, ultima) < 0 ? 'desatualizada' : 'atual'
}

/** Comando (argv) que resolve o estado: instala o que falta, atualiza o desatualizado. Nos outros casos, nenhum. */
export function comandoDe(dep: { id: string; estado: EstadoDependencia }): string[] | null {
  if (dep.estado === 'faltando') return ['claude', 'plugin', 'install', dep.id]
  if (dep.estado === 'desatualizada') return ['claude', 'plugin', 'update', dep.id]
  return null
}
