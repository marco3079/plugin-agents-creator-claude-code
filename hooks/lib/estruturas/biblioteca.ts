// Meus templates (biblioteca local): pasta, caminhos, leitura e gravação dos JSON. Sem átomos: quem chama guarda o estado.

import type { EngineInterface } from 'claude-code'

import type { Paths } from '../../../types'
import { joinPath, readText } from '../files'
import type { LocalTemplate, TemplateAgent } from './tipos'

type Dollar = EngineInterface

/** Id que vira nome de arquivo: letras, números, ponto, hífen e sublinhado; nada de separador de pasta. */
export const ID_SEGURO = /^[a-z0-9][a-z0-9._-]*$/i

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

// ---------------------------------------------------------------------------
// caminhos

/** Meus templates: <configDir>/agents-creator/estruturas. */
export function pastaBiblioteca(paths: Paths): string {
  return joinPath(paths, paths.configDir, 'agents-creator', 'estruturas')
}

/** Arquivo de um template: <pasta>/<id>.json. */
export function caminhoTemplate(paths: Paths, id: string): string {
  return joinPath(paths, pastaBiblioteca(paths), `${id}.json`)
}

// ---------------------------------------------------------------------------
// leitura e validação

/** Caminho de agente seguro: `.md`, sem `..`, sem barra invertida nem caractere proibido no Windows. */
export function agenteValido(file: string): boolean {
  return /\.md$/i.test(file) && file.split('/').every(parte => parte !== '' && parte !== '.' && parte !== '..' && !/[\\:*?"<>|]/.test(parte))
}

/** Template lido do texto de um JSON; null se não for um template utilizável. JSON sem `base` vale ''. */
export function lerModelo(texto: string): LocalTemplate | null {
  let dado: unknown
  try {
    dado = JSON.parse(texto)
  } catch {
    return null
  }
  if (!isRecord(dado) || dado.formato !== 1) return null
  const { id, title, icon, summary, origin, createdAt, agents, claudeMd, base } = dado
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
    base: typeof base === 'string' ? base : '',
  }
}

/** Um template da biblioteca pelo id; null se não existe, está inválido ou é de outro id. */
export async function lerTemplate($: Dollar, paths: Paths, id: string): Promise<LocalTemplate | null> {
  if (!ID_SEGURO.test(id)) return null
  const texto = await readText($, caminhoTemplate(paths, id))
  const modelo = texto === null ? null : lerModelo(texto)
  return modelo !== null && modelo.id === id ? modelo : null
}

// ---------------------------------------------------------------------------
// gravação

/** Grava o template em <pasta>/<id>.json (JSON com 2 espaços e fim de linha). Id que não serve como nome de arquivo não grava. */
export async function gravarTemplate($: Dollar, paths: Paths, tpl: LocalTemplate): Promise<void> {
  if (!ID_SEGURO.test(tpl.id)) throw new Error(`O id "${tpl.id}" não serve como nome de arquivo.`)
  await $.fs.write(caminhoTemplate(paths, tpl.id), `${JSON.stringify(tpl, null, 2)}\n`)
}

/**
 * Troca um agente de um template próprio e grava. `fileAntigo` vazio acrescenta o agente no fim; senão a entrada
 * dele é trocada, na mesma posição (se ele já saiu do template, acrescenta no fim). Template do catálogo não muda: é preciso clonar antes.
 */
export async function gravarAgenteNoTemplate(
  $: Dollar,
  paths: Paths,
  templateId: string,
  fileAntigo: string,
  nome: string,
  conteudo: string,
): Promise<LocalTemplate> {
  const tpl = await lerTemplate($, paths, templateId)
  if (tpl === null) throw new Error(`O template "${templateId}" não está mais em Meus templates.`)
  if (tpl.origin !== 'proprio') throw new Error('Template do catálogo: clone para editar.')
  // Renomear mantém a subpasta do agente (revisao/seguranca.md vira revisao/outro.md).
  const pasta = fileAntigo.slice(0, fileAntigo.lastIndexOf('/') + 1)
  const file = `${pasta}${nome}.md`
  if (nome.trim() === '' || !agenteValido(file)) throw new Error(`O nome "${nome}" não serve como nome de arquivo de agente.`)
  // Sem diferenciar maiúsculas: no Windows e no macOS "Revisor.md" e "revisor.md" são o mesmo arquivo.
  const ocupado = tpl.agents.some(agente => agente.file !== fileAntigo && agente.file.toLowerCase() === file.toLowerCase())
  if (ocupado) throw new Error(`Já existe um agente "${nome}" neste template.`)
  const novo: TemplateAgent = { file, content: conteudo }
  // Troca a entrada de fileAntigo, na mesma posição; sem fileAntigo (ou se ele já saiu do template), acrescenta no fim.
  const posicao = fileAntigo === '' ? -1 : tpl.agents.findIndex(agente => agente.file === fileAntigo)
  const agents: TemplateAgent[] = posicao < 0 ? [...tpl.agents, novo] : tpl.agents.map((agente, indice) => (indice === posicao ? novo : agente))
  const atualizado: LocalTemplate = { ...tpl, agents }
  await gravarTemplate($, paths, atualizado)
  return atualizado
}
