// Testes de src/runtime/handoff.js (passam pelo bundle porque importam o TS do plugin).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tipoDoPedido, textoGerar, textoMelhorar, textoTestar, AVISOS } from '../../src/runtime/handoff.js'
import { generationPrompt, improvementPrompt } from '../../../../hooks/lib/ai'
import { emptyFields } from '../../../../hooks/lib/agent'

test('tipoDoPedido reconhece geração, melhoria e outros', () => {
  assert.equal(tipoDoPedido(generationPrompt('qualquer', ['a'], ['Read']).system), 'gerar')
  assert.equal(tipoDoPedido(improvementPrompt({ ...emptyFields(), name: 'x' }).system), 'melhorar')
  assert.equal(tipoDoPedido('outro'), null)
  assert.equal(tipoDoPedido(undefined), null)
})

test('textoGerar com e sem o plugin', () => {
  assert.equal(textoGerar('  um revisor ', true), '/agentes gerar um revisor')
  const sem = textoGerar('  um revisor ', false)
  assert.ok(sem.includes('Pedido: um revisor'))
  assert.ok(sem.includes('.claude/agents/'))
})

test('textoMelhorar usa o caminho dado ou o padrão', () => {
  const campos = { ...emptyFields(), name: 'rev', description: 'd', prompt: 'p' }
  const com = textoMelhorar(campos, 'C:/p/rev.md')
  assert.ok(com.startsWith('Melhore o subagente "rev"'))
  assert.ok(com.includes('`C:/p/rev.md`'))
  assert.ok(com.includes('Agente atual:'))
  const sem = textoMelhorar(campos)
  assert.ok(sem.includes('`.claude/agents/rev.md`'))
})

test('textoMelhorar sem campos não quebra', () => {
  const texto = textoMelhorar(undefined)
  assert.ok(texto.startsWith('Melhore o subagente "agente"'))
})

test('textoTestar monta o pedido de teste', () => {
  assert.equal(textoTestar('rev', ' rode '), 'Use o subagente "rev" para esta tarefa: rode')
})

test('AVISOS tem os três textos exatos', () => {
  assert.deepEqual(Object.keys(AVISOS).sort(), ['gerar', 'melhorar', 'testar'])
  assert.equal(
    AVISOS.gerar,
    'Abri o Claude Code com o pedido já digitado. Aperte Enter lá: o rascunho abre no estúdio do Claude Code e, depois de salvo, aparece aqui na Galeria.',
  )
  assert.equal(
    AVISOS.melhorar,
    'Abri o Claude Code com o pedido de melhoria já digitado. Aperte Enter lá; quando o Claude gravar o arquivo, a Galeria atualiza sozinha.',
  )
  assert.equal(
    AVISOS.testar,
    'Abri o Claude Code com o teste já digitado. Aperte Enter lá. O Claude Code usa a versão salva do agente: salve antes de testar.',
  )
})
