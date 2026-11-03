// Leitura e escrita de arquivos de agente: o que entra, sai igual; o que muda, muda só ali.

import { expect, test } from 'claude-code/testing'

import { agentRefs, emptyFields, parseAgent, splitList, toMarkdown, toggleTool, validate, withAgentRefs } from '../hooks/lib/agent'
import { extractJson, fieldsFromJson } from '../hooks/lib/ai'
import { isPlainSafe } from '../hooks/lib/yaml'

const REVIEWER = `---
name: code-reviewer
description: Expert code reviewer. Use immediately after writing or modifying code.
tools: Read, Grep, Glob, Bash
model: sonnet
color: blue
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "./scripts/check.sh"
---

You are a senior code reviewer.

## Steps
1. Run git diff.
`

test('lê os campos conhecidos e guarda o resto como YAML', async () => {
  const parsed = parseAgent(REVIEWER)
  expect(parsed.error).toBe('')
  expect(parsed.fields.name).toBe('code-reviewer')
  expect(parsed.fields.tools).toEqual(['Read', 'Grep', 'Glob', 'Bash'])
  expect(parsed.fields.model).toBe('sonnet')
  expect(parsed.fields.color).toBe('blue')
  expect(parsed.fields.prompt.startsWith('You are a senior code reviewer.')).toBe(true)
  expect(parsed.extra).toContain('hooks:')
  expect(parsed.extra).toContain('command: "./scripts/check.sh"')
})

test('sem mudanças, o arquivo volta idêntico', async () => {
  const parsed = parseAgent(REVIEWER)
  expect(toMarkdown(parsed.fields, parsed.extra, REVIEWER, parsed.eol)).toBe(REVIEWER)
})

test('mudar um campo altera só a linha dele e mantém hooks no lugar', async () => {
  const parsed = parseAgent(REVIEWER)
  const out = toMarkdown({ ...parsed.fields, model: 'opus' }, parsed.extra, REVIEWER, parsed.eol)
  expect(out).toBe(REVIEWER.replace('model: sonnet', 'model: opus'))
})

test('CRLF e BOM são preservados ou tolerados', async () => {
  const crlf = REVIEWER.replace(/\n/g, '\r\n')
  const parsed = parseAgent(`﻿${crlf}`)
  expect(parsed.fields.name).toBe('code-reviewer')
  expect(parsed.eol).toBe('\r\n')
  expect(toMarkdown({ ...parsed.fields, color: 'red' }, parsed.extra, crlf, parsed.eol)).toBe(crlf.replace('color: blue', 'color: red'))
})

test('aspas, blocos e listas YAML', async () => {
  const text = `---
name: "tradutor"
description: |
  Traduz documentação.
  Use quando: houver texto em inglês.
tools:
  - Read
  - Write
skills: [docs, "glossario"]
disallowedTools: ["Bash"]
background: true
maxTurns: 12
initialPrompt: 'Comece pelo README, por favor: ''agora'''
---
Corpo`
  const parsed = parseAgent(text)
  expect(parsed.fields.name).toBe('tradutor')
  expect(parsed.fields.description).toBe('Traduz documentação.\nUse quando: houver texto em inglês.')
  expect(parsed.fields.tools).toEqual(['Read', 'Write'])
  expect(parsed.fields.skills).toEqual(['docs', 'glossario'])
  expect(parsed.fields.disallowedTools).toEqual(['Bash'])
  expect(parsed.fields.background).toBe(true)
  expect(parsed.fields.maxTurns).toBe('12')
  expect(parsed.fields.initialPrompt).toBe("Comece pelo README, por favor: 'agora'")
  expect(parsed.fields.prompt).toBe('Corpo')
  // Editando a descrição de bloco, continua em bloco.
  const out = toMarkdown({ ...parsed.fields, description: 'Linha 1\nLinha 2' }, parsed.extra, text, parsed.eol)
  expect(out).toContain('description: |-\n  Linha 1\n  Linha 2\n')
  expect(out).toContain('tools:\n  - Read\n  - Write\n')
})

test('arquivo novo: ordem canônica, aspas quando precisa', async () => {
  const fields = {
    ...emptyFields(),
    name: 'revisor',
    description: 'Revisa código: qualidade e segurança',
    tools: ['Agent(pesquisador, testador)', 'Read'],
    model: 'sonnet',
    prompt: 'Você revisa.',
  }
  const out = toMarkdown(fields, '', null, '\n')
  expect(out).toBe(
    '---\nname: revisor\ndescription: "Revisa código: qualidade e segurança"\ntools: Agent(pesquisador, testador), Read\nmodel: sonnet\n---\n\nVocê revisa.\n',
  )
  const back = parseAgent(out)
  expect(back.fields.tools).toEqual(['Agent(pesquisador, testador)', 'Read'])
  expect(back.fields.description).toBe('Revisa código: qualidade e segurança')
})

test('tools vazio herda; tools: [] é nenhuma', async () => {
  expect(parseAgent('---\nname: a\ndescription: b\ntools:\n---\n').fields.tools).toBe(null)
  expect(parseAgent('---\nname: a\ndescription: b\ntools: []\n---\n').fields.tools).toEqual([])
  expect(toMarkdown({ ...emptyFields(), name: 'a', description: 'b', tools: [] }, '', null, '\n')).toContain('tools: []')
})

test('arquivo sem frontmatter vira erro legível', async () => {
  expect(parseAgent('só texto').error).toContain('frontmatter')
  expect(parseAgent('---\nname: a\n').error).toContain('fechamento')
})

test('ferramentas: vírgulas dentro de parênteses e Agent(...)', async () => {
  expect(splitList('Agent(a, b), Read, "Bash"')).toEqual(['Agent(a, b)', 'Read', 'Bash'])
  expect(agentRefs(['Read', 'Agent(a, b)'])).toEqual({ has: true, restricted: true, allowed: ['a', 'b'] })
  expect(agentRefs(['Task'])).toEqual({ has: true, restricted: false, allowed: [] })
  expect(agentRefs(['Read'])).toEqual({ has: false, restricted: false, allowed: [] })
  expect(withAgentRefs(['Read', 'Agent'], ['x'])).toEqual(['Read', 'Agent(x)'])
  expect(withAgentRefs(['Read', 'Agent(x)'], [])).toEqual(['Read', 'Agent'])
  expect(withAgentRefs(['Agent(x)', 'Read'], null)).toEqual(['Read'])
  expect(toggleTool(['Read', 'Bash(git *)'], 'Bash')).toEqual(['Read'])
  expect(toggleTool(['Read'], 'Grep')).toEqual(['Read', 'Grep'])
})

test('validação aponta o que impede salvar', async () => {
  const others = [{ name: 'revisor', scope: 'project', path: '/p/.claude/agents/revisor.md' }]
  const base = { ...emptyFields(), name: 'revisor', description: 'Revisa o código depois de cada alteração importante.' }
  const clash = validate(base, { scope: 'project', selfPath: '', others })
  expect(clash.some(issue => issue.level === 'error' && issue.text.includes('Já existe'))).toBe(true)
  const self = validate(base, { scope: 'project', selfPath: '/p/.claude/agents/revisor.md', others })
  expect(self.some(issue => issue.level === 'error')).toBe(false)
  const bad = validate({ ...base, name: 'a:b', description: '', maxTurns: 'x' }, { scope: 'user', selfPath: '', others })
  expect(bad.filter(issue => issue.level === 'error').length).toBe(3)
})

test('escalares seguros sem aspas', async () => {
  expect(isPlainSafe('Read, Grep')).toBe(true)
  expect(isPlainSafe('Use quando: algo')).toBe(false)
  expect(isPlainSafe('true')).toBe(false)
  expect(isPlainSafe('#tag')).toBe(false)
  expect(isPlainSafe('123')).toBe(false)
})

test('resposta da IA vira campos limpos', async () => {
  const data = extractJson('Claro!\n```json\n{"name":"Revisor PR","description":"Revisa PRs.","tools":["Read",3],"model":"opus","color":"roxo","prompt":"Você..."}\n```')
  expect(data).not.toBe(null)
  const fields = fieldsFromJson(data ?? {})
  expect(fields.name).toBe('revisor-pr')
  expect(fields.tools).toEqual(['Read'])
  expect(fields.model).toBe('opus')
  expect(fields.color).toBe('')
})
