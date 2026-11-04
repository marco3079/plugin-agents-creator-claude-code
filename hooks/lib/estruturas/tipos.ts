// Tipos das estruturas (equipes de agentes) e o montador de papéis.

import type { AgentFields } from '../../../types'
import { emptyFields } from '../agent'

/** `executor` faz a tarefa; `revisor` confere as entregas e não edita os arquivos entregues. */
export type RoleKind = 'executor' | 'revisor'

/** Um papel da equipe, com os campos completos do agente. */
export type StructureRole = {
  /** Nome do agente e do arquivo (ex.: `dev-backend` vira `dev-backend.md`). */
  name: string
  /** Rótulo do papel na tela. */
  title: string
  /** Tipo do papel. */
  kind: RoleKind
  /** Quantas instâncias e nomes na sala (ex.: "até 3 · p01…p03"). */
  instances: string
  /** O que o papel entrega no `done`. */
  delivery: string
  /** Campos do agente. `fields.prompt` tem só o papel: o protocolo da sala é acrescentado pelo código. */
  fields: AgentFields
}

/** Abas do catálogo (ver CATEGORIAS em index.ts). */
export type StructureCategory = 'Desenvolvimento' | 'Jurídico' | 'Negócios' | 'Técnicas' | 'Outras'

/** Uma estrutura do catálogo: equipe de agentes com o fluxo do main. */
export type Structure = {
  /** Identificador estável (também o nome do arquivo do template local). */
  id: string
  /** Ícone da estrutura na tela. */
  icon: string
  /** Nome da estrutura na tela. */
  title: string
  /** Aba da estrutura. */
  category: StructureCategory
  /** Resumo de uma linha, para o catálogo. */
  summary: string
  /** Quando o main usa o fluxo. */
  when: string
  /** Regras de domínio, em Markdown. */
  notes: string
  /** Pré-requisitos para a estrutura funcionar. */
  requirements: readonly string[]
  /** Papéis da equipe. O último é o revisor (exatamente um papel com kind 'revisor'). */
  roles: readonly StructureRole[]
}

/** Um arquivo de agente dentro de um template. */
export type TemplateAgent = {
  /** Nome do arquivo em `.claude/agents/` (ex.: `dev-backend.md`). */
  file: string
  /** Conteúdo completo do .md (frontmatter e prompt). */
  content: string
}

/** Template salvo em ~/.claude/agents-creator/estruturas/<id>.json. */
export type LocalTemplate = {
  /** Versão do formato do arquivo (1). */
  formato: 1
  /** Identificador; também o nome do arquivo. */
  id: string
  /** Nome na tela. */
  title: string
  /** Ícone na tela. */
  icon: string
  /** Resumo de uma linha. */
  summary: string
  /** `catalogo`: veio do catálogo. `proprio`: salvo pelo usuário. */
  origin: 'catalogo' | 'proprio'
  /** Momento da criação, em milissegundos. */
  createdAt: number
  /** Um arquivo por papel. */
  agents: readonly TemplateAgent[]
  /** Corpo do fluxo para o CLAUDE.md, SEM marcadores. */
  claudeMd: string
}

/** Como o catálogo descreve um papel (entrada de `papel`). */
export type RoleSpec = {
  /** Nome do agente e do arquivo. */
  name: string
  /** Rótulo do papel na tela. */
  title: string
  /** Tipo do papel. */
  kind: RoleKind
  /** Quantas instâncias e nomes na sala (ex.: "até 3 · p01…p03"). */
  instances: string
  /** O que o papel entrega no `done`. */
  delivery: string
  /** Campos iniciais do agente; o que faltar fica vazio. */
  fields: Partial<AgentFields>
}

/** Monta o papel com todos os campos do agente (os vazios vêm de emptyFields). */
export function papel(spec: RoleSpec): StructureRole {
  return {
    name: spec.name,
    title: spec.title,
    kind: spec.kind,
    instances: spec.instances,
    delivery: spec.delivery,
    fields: { ...emptyFields(), ...spec.fields, name: spec.name },
  }
}
