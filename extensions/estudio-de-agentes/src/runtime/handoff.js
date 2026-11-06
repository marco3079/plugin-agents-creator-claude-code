// Entrega ao Claude Code: reconhece os pedidos de IA do painel e monta o texto que vai digitado numa conversa nova.
import { generationPrompt, improvementPrompt } from '../../../../hooks/lib/ai'
import { emptyFields } from '../../../../hooks/lib/agent'

const SISTEMA_GERAR = generationPrompt('x', [], []).system
const SISTEMA_MELHORAR = improvementPrompt(emptyFields()).system

/**
 * Diz qual pedido de IA o painel fez, pelo texto de sistema.
 * @param {string} system
 * @returns {'gerar'|'melhorar'|null}
 */
export function tipoDoPedido(system) {
  const s = String(system ?? '')
  if (s === SISTEMA_GERAR || s.startsWith('Você cria subagentes')) return 'gerar'
  if (s === SISTEMA_MELHORAR || s.startsWith('Você revisa subagentes')) return 'melhorar'
  return null
}

/**
 * Texto do pedido de geração.
 * @param {string} pedido
 * @param {boolean} comPlugin
 * @returns {string}
 */
export function textoGerar(pedido, comPlugin) {
  const p = String(pedido ?? '').trim()
  if (comPlugin) return `/agentes gerar ${p}`
  return `Crie um subagente do Claude Code para o pedido abaixo e grave em .claude/agents/<nome>.md (frontmatter com name, description, tools e model; o prompt do sistema no corpo, em português).\n\nPedido: ${p}`
}

/**
 * Texto do pedido de melhoria.
 * @param {object} fields campos do agente (AgentFields)
 * @param {string} [caminho] onde gravar; sem ele usa .claude/agents/<nome>.md
 * @returns {string}
 */
export function textoMelhorar(fields, caminho) {
  const f = fields ?? emptyFields()
  const nome = f.name || 'agente'
  const onde = caminho ? caminho : `.claude/agents/${nome}.md`
  return [
    `Melhore o subagente "${nome}" do Claude Code e grave o resultado em \`${onde}\`.`,
    'Deixe a descrição mais clara sobre quando usá-lo e o prompt do sistema mais estruturado e acionável, mantendo o propósito e o idioma. No fim, resuma em uma frase o que mudou.',
    '',
    improvementPrompt(f).prompt,
  ].join('\n')
}

/**
 * Texto do teste de um agente.
 * @param {string} nome
 * @param {string} tarefa
 * @returns {string}
 */
export function textoTestar(nome, tarefa) {
  return `Use o subagente "${String(nome ?? '')}" para esta tarefa: ${String(tarefa ?? '').trim()}`
}

export const AVISOS = Object.freeze({
  gerar: 'Abri o Claude Code com o pedido já digitado. Aperte Enter lá: o rascunho abre no estúdio do Claude Code e, depois de salvo, aparece aqui na Galeria.',
  melhorar: 'Abri o Claude Code com o pedido de melhoria já digitado. Aperte Enter lá; quando o Claude gravar o arquivo, a Galeria atualiza sozinha.',
  testar: 'Abri o Claude Code com o teste já digitado. Aperte Enter lá. O Claude Code usa a versão salva do agente: salve antes de testar.',
})
