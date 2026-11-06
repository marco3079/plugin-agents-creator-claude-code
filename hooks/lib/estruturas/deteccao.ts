// Detecção de mudanças entre um template e os agentes do projeto: funções puras, sem disco nem painel.

import type { MudancaAgente } from '../../../types'
import type { TemplateAgent } from './tipos'

/** Troca CRLF por LF, para comparar textos sem diferença de fim de linha. */
export function normalizarEol(texto: string): string {
  return texto.replace(/\r\n/g, '\n')
}

/** Chave de um nome de arquivo: sem diferenciar maiúsculas (Windows e macOS não diferenciam). */
export function chaveArquivo(file: string): string {
  return file.toLowerCase()
}

/**
 * Agentes do template que o projeto não tem ('faltando') ou tem diferentes ('alterado'), na ordem do template.
 * `projeto` vai de chaveArquivo(file) ao conteúdo de .claude/agents/<file>; null ou ausente = não existe.
 */
export function mudancasDoTemplate(
  agentes: readonly TemplateAgent[],
  projeto: Readonly<Record<string, string | null>>,
): MudancaAgente[] {
  const mudancas: MudancaAgente[] = []
  for (const agente of agentes) {
    const atual = projeto[chaveArquivo(agente.file)]
    if (typeof atual !== 'string') mudancas.push({ file: agente.file, tipo: 'faltando' })
    else if (normalizarEol(atual) !== normalizarEol(agente.content)) mudancas.push({ file: agente.file, tipo: 'alterado' })
  }
  return mudancas
}

/** O projeto tem todos os agentes do template, com o mesmo conteúdo. Template sem agentes não casa. */
export function templateCasa(agentes: readonly TemplateAgent[], projeto: Readonly<Record<string, string | null>>): boolean {
  return agentes.length > 0 && mudancasDoTemplate(agentes, projeto).length === 0
}

/**
 * O fluxo do CLAUDE.md do projeto difere do fluxo do template (sem fim de linha nem espaços nas bordas).
 * Template sem fluxo nunca conta como mudança.
 */
export function fluxoMudou(fluxoTemplate: string, fluxoProjeto: string): boolean {
  return fluxoTemplate.trim() !== '' && normalizarEol(fluxoProjeto).trim() !== normalizarEol(fluxoTemplate).trim()
}

/**
 * Id de uma cópia nova: o slug (ou 'estrutura', se vazio); se o slug é id do catálogo, vira '<slug>-propria'.
 * Se a biblioteca já tem esse id, acrescenta -2, -3… até achar um livre.
 */
export function idParaClone(slug: string, idsCatalogo: ReadonlySet<string>, idsBiblioteca: ReadonlySet<string>): string {
  const base = slug || 'estrutura'
  const inicial = idsCatalogo.has(base) ? `${base}-propria` : base
  if (!idsBiblioteca.has(inicial)) return inicial
  let n = 2
  while (idsBiblioteca.has(`${inicial}-${n}`)) n++
  return `${inicial}-${n}`
}

/**
 * A cópia salva difere da estrutura gerada pelo catálogo: quantidade, ordem, nome ou conteúdo dos agentes
 * (sem contar fim de linha), ou o fluxo do CLAUDE.md (sem fim de linha nem espaços nas bordas).
 */
export function copiaDesatualizada(
  salvo: { agents: readonly TemplateAgent[]; claudeMd: string },
  gerado: { agents: readonly TemplateAgent[]; claudeMd: string },
): boolean {
  const agentesIguais =
    salvo.agents.length === gerado.agents.length &&
    salvo.agents.every((agente, i) => {
      const outro = gerado.agents[i]
      return outro !== undefined && agente.file === outro.file && normalizarEol(agente.content) === normalizarEol(outro.content)
    })
  return !agentesIguais || normalizarEol(salvo.claudeMd).trim() !== normalizarEol(gerado.claudeMd).trim()
}
