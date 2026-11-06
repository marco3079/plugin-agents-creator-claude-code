// Detecção de mudanças e cópias desatualizadas dos templates: funções puras, sem painel nem disco.

import { expect, test } from 'claude-code/testing'

import {
  chaveArquivo,
  copiaDesatualizada,
  fluxoMudou,
  idParaClone,
  mudancasDoTemplate,
  normalizarEol,
  templateCasa,
} from '../hooks/lib/estruturas/deteccao'
import type { TemplateAgent } from '../hooks/lib/estruturas/tipos'

const CR = String.fromCharCode(13)

/** Um agente do template, com o nome de arquivo e o conteúdo dados. */
function agente(file: string, content: string): TemplateAgent {
  return { file, content }
}

test('normalizarEol troca CRLF por LF e deixa o texto com LF como está', { timeoutMs: 20000 }, async () => {
  expect(normalizarEol('a' + CR + '\nb' + CR + '\n')).toBe('a\nb\n')
  expect(normalizarEol('a\nb\n')).toBe('a\nb\n')
  expect(normalizarEol('')).toBe('')
})

test('chaveArquivo ignora maiúsculas no nome do arquivo', { timeoutMs: 20000 }, async () => {
  expect(chaveArquivo('Dev-Backend.MD')).toBe('dev-backend.md')
  expect(chaveArquivo('dev-backend.md')).toBe('dev-backend.md')
})

test('mudancasDoTemplate: CRLF de um lado e LF do outro não é mudança', { timeoutMs: 20000 }, async () => {
  const doTemplate = [agente('dev.md', 'Linha 1\nLinha 2\n')]
  expect(mudancasDoTemplate(doTemplate, { 'dev.md': 'Linha 1' + CR + '\nLinha 2' + CR + '\n' })).toEqual([])
  const comCrlf = [agente('dev.md', 'Linha 1' + CR + '\nLinha 2' + CR + '\n')]
  expect(mudancasDoTemplate(comCrlf, { 'dev.md': 'Linha 1\nLinha 2\n' })).toEqual([])
})

test('mudancasDoTemplate acha o agente do projeto sem diferenciar maiúsculas no nome', { timeoutMs: 20000 }, async () => {
  // O projeto guarda a chave (minúscula); o nome no template pode vir com maiúsculas.
  const doTemplate = [agente('Dev-Backend.md', 'corpo')]
  expect(mudancasDoTemplate(doTemplate, { [chaveArquivo('DEV-backend.MD')]: 'corpo' })).toEqual([])
  expect(mudancasDoTemplate(doTemplate, { 'dev-backend.md': 'outro' })).toEqual([{ file: 'Dev-Backend.md', tipo: 'alterado' }])
  expect(mudancasDoTemplate(doTemplate, { 'outro.md': 'corpo' })).toEqual([{ file: 'Dev-Backend.md', tipo: 'faltando' }])
})

test('mudancasDoTemplate lista faltando e alterado na ordem do template, e null conta como faltando', { timeoutMs: 20000 }, async () => {
  const doTemplate = [
    agente('zeta.md', 'Z novo'),
    agente('alfa.md', 'A'),
    agente('meio.md', 'M'),
    agente('beta.md', 'B'),
  ]
  const projeto = { 'zeta.md': 'Z antigo', 'meio.md': null, 'beta.md': 'B' }
  expect(mudancasDoTemplate(doTemplate, projeto)).toEqual([
    { file: 'zeta.md', tipo: 'alterado' },
    { file: 'alfa.md', tipo: 'faltando' },
    { file: 'meio.md', tipo: 'faltando' },
  ])
})

test('templateCasa só vale com todos os agentes do template iguais no projeto', { timeoutMs: 20000 }, async () => {
  const doTemplate = [agente('a.md', 'A\n'), agente('b.md', 'B\n')]
  expect(templateCasa(doTemplate, { 'a.md': 'A' + CR + '\n', 'b.md': 'B\n' })).toBe(true)
  expect(templateCasa(doTemplate, { 'a.md': 'A\n', 'b.md': 'B mudado\n' })).toBe(false)
  expect(templateCasa(doTemplate, { 'a.md': 'A\n' })).toBe(false)
  expect(templateCasa(doTemplate, { 'a.md': 'A\n', 'b.md': null })).toBe(false)
})

test('template vazio não casa, nem com o projeto vazio', { timeoutMs: 20000 }, async () => {
  expect(templateCasa([], {})).toBe(false)
  expect(templateCasa([], { 'a.md': 'A' })).toBe(false)
  expect(mudancasDoTemplate([], { 'a.md': 'A' })).toEqual([])
})

test('fluxo vazio no template nunca conta como mudança', { timeoutMs: 20000 }, async () => {
  expect(fluxoMudou('', '## Fluxo\n\nPasso 1.')).toBe(false)
  expect(fluxoMudou('  ' + CR + '\n', 'qualquer coisa')).toBe(false)
  expect(fluxoMudou('', '')).toBe(false)
})

test('fluxoMudou ignora fim de linha e espaços nas bordas, mas pega texto diferente ou vazio', { timeoutMs: 20000 }, async () => {
  expect(fluxoMudou('## Fluxo\nPasso 1.', '## Fluxo' + CR + '\nPasso 1.' + CR + '\n')).toBe(false)
  expect(fluxoMudou('## Fluxo\nPasso 1.\n', '  ## Fluxo\nPasso 1.  ')).toBe(false)
  expect(fluxoMudou('## Fluxo\nPasso 1.', '## Fluxo\nPasso 2.')).toBe(true)
  expect(fluxoMudou('## Fluxo\nPasso 1.', '')).toBe(true)
})

test('idParaClone usa o slug quando não há colisão', { timeoutMs: 20000 }, async () => {
  expect(idParaClone('meu-jogo', new Set(['jogos']), new Set(['outro']))).toBe('meu-jogo')
})

test('idParaClone com slug vazio usa "estrutura", com -propria ou -2 quando já existe', { timeoutMs: 20000 }, async () => {
  expect(idParaClone('', new Set<string>(), new Set<string>())).toBe('estrutura')
  expect(idParaClone('', new Set(['estrutura']), new Set<string>())).toBe('estrutura-propria')
  expect(idParaClone('', new Set<string>(), new Set(['estrutura']))).toBe('estrutura-2')
})

test('idParaClone põe -propria quando o id é de uma estrutura do catálogo', { timeoutMs: 20000 }, async () => {
  expect(idParaClone('jogos', new Set(['jogos']), new Set<string>())).toBe('jogos-propria')
})

test('idParaClone acrescenta -2, -3… quando a biblioteca já tem o id', { timeoutMs: 20000 }, async () => {
  expect(idParaClone('meu', new Set<string>(), new Set(['meu']))).toBe('meu-2')
  expect(idParaClone('meu', new Set<string>(), new Set(['meu', 'meu-2']))).toBe('meu-3')
  expect(idParaClone('meu', new Set<string>(), new Set(['meu', 'meu-3']))).toBe('meu-2')
})

test('idParaClone com catálogo e biblioteca: jogos-propria, depois -2 e -3', { timeoutMs: 20000 }, async () => {
  expect(idParaClone('jogos', new Set(['jogos']), new Set(['jogos-propria']))).toBe('jogos-propria-2')
  expect(idParaClone('jogos', new Set(['jogos']), new Set(['jogos-propria', 'jogos-propria-2']))).toBe('jogos-propria-3')
})

test('copiaDesatualizada é falso quando a cópia é igual à estrutura gerada', { timeoutMs: 20000 }, async () => {
  const salvo = { agents: [agente('a.md', 'A\n'), agente('b.md', 'B\n')], claudeMd: '## Fluxo\nPasso 1.' }
  const gerado = { agents: [agente('a.md', 'A\n'), agente('b.md', 'B\n')], claudeMd: '## Fluxo\nPasso 1.' }
  expect(copiaDesatualizada(salvo, gerado)).toBe(false)
})

test('copiaDesatualizada é verdadeiro com os agentes em outra ordem', { timeoutMs: 20000 }, async () => {
  const salvo = { agents: [agente('b.md', 'B\n'), agente('a.md', 'A\n')], claudeMd: '' }
  const gerado = { agents: [agente('a.md', 'A\n'), agente('b.md', 'B\n')], claudeMd: '' }
  expect(copiaDesatualizada(salvo, gerado)).toBe(true)
})

test('copiaDesatualizada é verdadeiro com o conteúdo de um agente diferente', { timeoutMs: 20000 }, async () => {
  const salvo = { agents: [agente('a.md', 'A editado\n'), agente('b.md', 'B\n')], claudeMd: '' }
  const gerado = { agents: [agente('a.md', 'A\n'), agente('b.md', 'B\n')], claudeMd: '' }
  expect(copiaDesatualizada(salvo, gerado)).toBe(true)
})

test('copiaDesatualizada é verdadeiro com o claudeMd diferente', { timeoutMs: 20000 }, async () => {
  const salvo = { agents: [agente('a.md', 'A\n')], claudeMd: '## Fluxo\nOutro passo.' }
  const gerado = { agents: [agente('a.md', 'A\n')], claudeMd: '## Fluxo\nPasso 1.' }
  expect(copiaDesatualizada(salvo, gerado)).toBe(true)
})

test('copiaDesatualizada é verdadeiro com quantidade ou nome de arquivo de agente diferente', { timeoutMs: 20000 }, async () => {
  const gerado = { agents: [agente('a.md', 'A\n'), agente('b.md', 'B\n')], claudeMd: '' }
  expect(copiaDesatualizada({ agents: [agente('a.md', 'A\n')], claudeMd: '' }, gerado)).toBe(true)
  expect(copiaDesatualizada({ agents: [agente('a.md', 'A\n'), agente('c.md', 'B\n')], claudeMd: '' }, gerado)).toBe(true)
})

test('copiaDesatualizada é falso com CRLF de um lado e espaços nas bordas do claudeMd', { timeoutMs: 20000 }, async () => {
  const salvo = { agents: [agente('a.md', 'A' + CR + '\nlinha' + CR + '\n')], claudeMd: '## Fluxo' + CR + '\nPasso 1.' + CR + '\n' }
  const gerado = { agents: [agente('a.md', 'A\nlinha\n')], claudeMd: '## Fluxo\nPasso 1.' }
  expect(copiaDesatualizada(salvo, gerado)).toBe(false)
  expect(copiaDesatualizada({ agents: [], claudeMd: 'x\n\n' }, { agents: [], claudeMd: 'x' })).toBe(false)
})

test('idParaClone pula uma sequência de sufixos ocupados até achar o livre', { timeoutMs: 20000 }, async () => {
  expect(idParaClone('meu', new Set<string>(), new Set(['meu', 'meu-2', 'meu-3']))).toBe('meu-4')
  expect(idParaClone('jogos', new Set(['jogos']), new Set(['jogos-propria', 'jogos-propria-2', 'jogos-propria-3']))).toBe('jogos-propria-4')
})

test('fluxoMudou ignora CRLF também no fluxo do template', { timeoutMs: 20000 }, async () => {
  expect(fluxoMudou('## Fluxo' + CR + '\nPasso 1.' + CR + '\n', '## Fluxo\nPasso 1.')).toBe(false)
})

test('copiaDesatualizada compara o nome do arquivo de forma exata e o conteúdo sem aparar o fim', { timeoutMs: 20000 }, async () => {
  const gerado = { agents: [agente('a.md', 'A\n')], claudeMd: '' }
  expect(copiaDesatualizada({ agents: [agente('A.md', 'A\n')], claudeMd: '' }, gerado)).toBe(true)
  expect(copiaDesatualizada({ agents: [agente('a.md', 'A')], claudeMd: '' }, gerado)).toBe(true)
})

test('normalizarEol deixa um CR solto como está', { timeoutMs: 20000 }, async () => {
  expect(normalizarEol('a' + CR + 'b')).toBe('a' + CR + 'b')
})
