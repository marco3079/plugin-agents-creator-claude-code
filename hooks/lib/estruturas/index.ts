// Catálogo das estruturas (equipes de agentes), na ordem da aba.

import { ESTRUTURA_CONTEUDO } from './conteudo'
import { ESTRUTURA_DESENVOLVIMENTO } from './desenvolvimento'
import { ESTRUTURA_EDUCACAO } from './educacao'
import { ESTRUTURA_IOT } from './iot'
import { ESTRUTURA_JOGOS } from './jogos'
import { ESTRUTURA_JURIDICO } from './juridico'
import { ESTRUTURA_NEGOCIOS } from './negocios'
import { ESTRUTURA_PESQUISA } from './pesquisa'
import { ESTRUTURA_SEGURANCA } from './seguranca'
import { ESTRUTURA_SUPORTE } from './suporte'
import type { Structure, StructureCategory } from './tipos'

/** Estruturas do catálogo, nesta ordem. */
export const ESTRUTURAS: readonly Structure[] = [
  ESTRUTURA_DESENVOLVIMENTO,
  ESTRUTURA_JURIDICO,
  ESTRUTURA_NEGOCIOS,
  ESTRUTURA_IOT,
  ESTRUTURA_SEGURANCA,
  ESTRUTURA_SUPORTE,
  ESTRUTURA_JOGOS,
  ESTRUTURA_CONTEUDO,
  ESTRUTURA_EDUCACAO,
  ESTRUTURA_PESQUISA,
]

/** Abas do catálogo, nesta ordem. */
export const CATEGORIAS: readonly StructureCategory[] = ['Desenvolvimento', 'Jurídico', 'Negócios', 'Técnicas', 'Outras']

/** Estrutura pelo id, ou undefined se não existir. */
export function estruturaPorId(id: string): Structure | undefined {
  return ESTRUTURAS.find(estrutura => estrutura.id === id)
}
