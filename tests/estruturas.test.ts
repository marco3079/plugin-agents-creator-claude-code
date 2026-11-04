// As estruturas (equipes de agentes) sem painel: catálogo, papéis válidos, arquivos de agente,
// fluxo do CLAUDE.md com marcadores e templates salvos.

import { expect, test } from 'claude-code/testing'

import { emptyFields, parseAgent, validate } from '../hooks/lib/agent'
import { generationPrompt, improvementPrompt } from '../hooks/lib/ai'
import { COLORS } from '../hooks/lib/catalog'
import { CATEGORIAS, ESTRUTURAS, estruturaPorId } from '../hooks/lib/estruturas/index'
import {
  SQUAD_VERSAO_PADRAO,
  agenteMarkdown,
  busCommand,
  extrairFluxo,
  fluxoMarkdown,
  marcadorFim,
  marcadorInicio,
  mesclarClaudeMd,
  removerSecaoClaudeMd,
  revisorDe,
  templateDaEstrutura,
  tuiCommand,
} from '../hooks/lib/estruturas/protocolo'
import type { Structure, StructureRole } from '../hooks/lib/estruturas/tipos'
import { REGRA_POPUP_PRINCIPAL, REGRA_POPUP_SUBAGENTE } from '../hooks/lib/perguntas'
import { TEMPLATES } from '../hooks/lib/templates'

const IDS_ESPERADOS = ['desenvolvimento', 'juridico', 'negocios', 'iot', 'seguranca', 'suporte', 'jogos', 'conteudo', 'educacao', 'pesquisa']
const MODELOS = ['haiku', 'sonnet', 'opus', 'inherit']
const CORPO = '## Fluxo\n\nPasso 1: planejar.\nPasso 2: revisar.'
const CR = String.fromCharCode(13)

/** Cada papel do catálogo, junto da estrutura a que pertence. */
function todosOsPapeis(): { st: Structure; role: StructureRole }[] {
  return ESTRUTURAS.flatMap(st => st.roles.map(role => ({ st, role })))
}

/** O revisor de uma estrutura; a estrutura sem revisor faz o teste falhar. */
function revisorDaEstrutura(st: Structure): StructureRole {
  const revisor = revisorDe(st)
  if (!revisor) throw new Error(`a estrutura ${st.id} não tem revisor`)
  return revisor
}

test('o catálogo tem dez estruturas, com os ids esperados e únicos', async () => {
  expect(ESTRUTURAS.length).toBe(10)
  const ids = ESTRUTURAS.map(st => st.id)
  expect(new Set(ids).size).toBe(10)
  expect([...ids].sort()).toEqual([...IDS_ESPERADOS].sort())
  for (const st of ESTRUTURAS) expect(estruturaPorId(st.id)?.id).toBe(st.id)
  expect(estruturaPorId('nao-existe') ?? null).toBeNull()
})

test('nomes de agentes são únicos em todo o catálogo', async () => {
  const nomes = todosOsPapeis().map(({ role }) => role.name)
  expect(nomes.length).toBeGreaterThan(10)
  expect(new Set(nomes).size).toBe(nomes.length)
})

test('cada estrutura tem exatamente um revisor, e ele é o último papel', async () => {
  for (const st of ESTRUTURAS) {
    const revisores = st.roles.filter(role => role.kind === 'revisor')
    expect(st.roles.length).toBeGreaterThanOrEqual(2)
    expect(revisores.length).toBe(1)
    expect(st.roles[st.roles.length - 1]?.kind).toBe('revisor')
    expect(revisorDe(st)?.name).toBe(revisores[0]?.name)
  }
})

test('a categoria de cada estrutura está em CATEGORIAS', async () => {
  for (const st of ESTRUTURAS) expect(CATEGORIAS).toContain(st.category)
})

test('cada papel é um agente válido, com descrição, cor e modelo do catálogo, e prompt sem o protocolo', async () => {
  for (const { role } of todosOsPapeis()) {
    const erros = validate(role.fields, { scope: 'project', selfPath: '', others: [] }).filter(issue => issue.level === 'error')
    expect(erros).toEqual([])
    expect(role.fields.description.length).toBeGreaterThanOrEqual(40)
    expect(COLORS.map(cor => cor.id)).toContain(role.fields.color)
    expect(MODELOS).toContain(role.fields.model)
    expect(role.fields.prompt.includes('bus.js')).toBe(false)
    expect(role.fields.prompt.includes('BUS ')).toBe(false)
  }
})

test('o .md de cada papel volta pelo parseAgent com o mesmo nome, descrição e ferramentas', async () => {
  for (const { st, role } of todosOsPapeis()) {
    const lido = parseAgent(agenteMarkdown(role, st, SQUAD_VERSAO_PADRAO))
    expect(lido.error).toBe('')
    expect(lido.fields.name).toBe(role.name)
    expect(lido.fields.description).toBe(role.fields.description)
    expect(lido.fields.tools).toEqual(role.fields.tools)
    expect(lido.fields.prompt.includes('bus.js')).toBe(true)
  }
})

test('o executor entrega ao revisor pelo nome dele; o revisor dá o veredito APROVADO', async () => {
  for (const st of ESTRUTURAS) {
    const revisor = revisorDaEstrutura(st)
    for (const role of st.roles) {
      const md = agenteMarkdown(role, st, SQUAD_VERSAO_PADRAO)
      if (role.kind === 'executor') expect(md).toContain(`@${revisor.name} entrega pronta:`)
      else expect(md).toContain('APROVADO')
    }
  }
})

test('os comandos do squad-stream usam a versão pedida', async () => {
  expect(SQUAD_VERSAO_PADRAO).toBe('0.2.0')
  expect(busCommand('0.3.1')).toBe('node "$HOME/.claude/plugins/cache/skill-squad-room/squad-stream/0.3.1/skills/squad-stream/scripts/bus.js"')
  expect(tuiCommand('0.3.1')).toContain('/squad-stream/0.3.1/')
})

test('o fluxo do CLAUDE.md traz o título, o BUS da versão pedida, a equipe e o passo a passo do main', async () => {
  for (const st of ESTRUTURAS) {
    const fluxo = fluxoMarkdown(st, '0.3.1')
    expect(fluxo).toContain('# Fluxo da equipe: ' + st.title)
    expect(fluxo).toContain(busCommand('0.3.1'))
    for (const role of st.roles) expect(fluxo).toContain('`' + role.name + '`')
    expect(fluxo).toContain('## Passo a passo do main')
  }
})

test('mesclarClaudeMd sem texto existente devolve só o bloco, com a quebra final', async () => {
  expect(mesclarClaudeMd(null, 'juridico', CORPO)).toBe(`${marcadorInicio('juridico')}\n${CORPO}\n${marcadorFim('juridico')}\n`)
})

test('mesclarClaudeMd acrescenta o bloco ao texto existente, sem tocar no que já havia', async () => {
  expect(mesclarClaudeMd('# Meu fluxo\n\nTexto.\n', 'juridico', CORPO)).toBe(
    `# Meu fluxo\n\nTexto.\n\n${marcadorInicio('juridico')}\n${CORPO}\n${marcadorFim('juridico')}\n`,
  )
})

test('mesclarClaudeMd troca só o bloco da mesma estrutura e mantém os blocos das outras', async () => {
  const antes = mesclarClaudeMd('# Topo\n', 'juridico', 'Versão antiga.')
  expect(mesclarClaudeMd(antes, 'juridico', CORPO)).toBe(`# Topo\n\n${marcadorInicio('juridico')}\n${CORPO}\n${marcadorFim('juridico')}\n`)
  const dois = mesclarClaudeMd(mesclarClaudeMd('# Topo\n', 'iot', 'Fluxo IoT.'), 'juridico', 'Versão antiga.')
  const trocado = mesclarClaudeMd(dois, 'juridico', CORPO)
  expect(trocado).toContain('Fluxo IoT.')
  expect(trocado).toContain(CORPO)
  expect(trocado).not.toContain('Versão antiga.')
  expect(mesclarClaudeMd(trocado, 'juridico', CORPO)).toBe(trocado)
})

test('mesclarClaudeMd não duplica o corpo quando o texto já o contém', async () => {
  const texto = `# Meu fluxo\n\n${CORPO}\n`
  expect(mesclarClaudeMd(texto, 'juridico', CORPO)).toBe(texto)
})

test('removerSecaoClaudeMd devolve o texto original, sem o bloco', async () => {
  const original = '# Meu fluxo\n\nTexto.\n'
  expect(removerSecaoClaudeMd(mesclarClaudeMd(original, 'juridico', CORPO), 'juridico')).toBe(original)
})

test('removerSecaoClaudeMd sem os marcadores devolve o texto igual', async () => {
  expect(removerSecaoClaudeMd('# Meu fluxo\n', 'juridico')).toBe('# Meu fluxo\n')
})

test('removerSecaoClaudeMd com só o bloco devolve texto vazio e tira só o bloco pedido', async () => {
  expect(removerSecaoClaudeMd(mesclarClaudeMd(null, 'juridico', CORPO), 'juridico')).toBe('')
  const dois = mesclarClaudeMd(mesclarClaudeMd('# Topo\n', 'iot', 'Fluxo IoT.'), 'juridico', CORPO)
  const sem = removerSecaoClaudeMd(dois, 'juridico')
  expect(sem).toContain('Fluxo IoT.')
  expect(sem).not.toContain(marcadorInicio('juridico'))
})

test('extrairFluxo: sem texto devolve vazio; com o bloco da estrutura, devolve o corpo dele', async () => {
  expect(extrairFluxo(null, 'juridico')).toBe('')
  expect(extrairFluxo(mesclarClaudeMd('# Topo\n', 'juridico', CORPO), 'juridico')).toBe(CORPO)
})

test('extrairFluxo sem o bloco pedido usa o primeiro bloco marcado; sem bloco nenhum, o texto todo', async () => {
  const texto = mesclarClaudeMd(mesclarClaudeMd('# Topo\n', 'iot', 'Fluxo IoT.'), 'juridico', CORPO)
  expect(extrairFluxo(texto, 'desenvolvimento')).toBe('Fluxo IoT.')
  expect(extrairFluxo('  # Só texto\n\nLinha.\n', 'juridico')).toBe('# Só texto\n\nLinha.')
})

test('templateDaEstrutura: formato 1, origem do catálogo, um arquivo por papel e o fluxo do main', async () => {
  for (const st of ESTRUTURAS) {
    const modelo = templateDaEstrutura(st, SQUAD_VERSAO_PADRAO, 123)
    expect(modelo.formato).toBe(1)
    expect(modelo.origin).toBe('catalogo')
    expect(modelo.id).toBe(st.id)
    expect(modelo.createdAt).toBe(123)
    expect(modelo.agents.map(agent => agent.file)).toEqual(st.roles.map(role => `${role.name}.md`))
    for (let i = 0; i < st.roles.length; i += 1) {
      const role = st.roles[i]
      if (!role) throw new Error(`papel ${i} ausente em ${st.id}`)
      expect(modelo.agents[i]?.content).toBe(agenteMarkdown(role, st, SQUAD_VERSAO_PADRAO))
    }
    expect(modelo.claudeMd).toBe(fluxoMarkdown(st, SQUAD_VERSAO_PADRAO))
  }
})

test('o fluxo e o protocolo mandam perguntar ao usuário pelo popup', async () => {
  for (const st of ESTRUTURAS) {
    expect(fluxoMarkdown(st, '0.2.0')).toContain('/popup-perguntas:perguntar')
    for (const role of st.roles.filter(item => item.kind === 'executor')) {
      const md = agenteMarkdown(role, st, '0.2.0')
      expect(md).toContain('/popup-perguntas:perguntar')
      expect(md).toContain('@main')
    }
  }
})

test('o plano vai para o usuário aprovar pelo popup, parte por parte', async () => {
  for (const st of ESTRUTURAS) {
    const fluxo = fluxoMarkdown(st, '0.2.0')
    expect(fluxo).toContain('dividido em partes')
    expect(fluxo).toContain('uma pergunta por parte (Aprovar, Ajustar ou Tirar do plano')
    expect(fluxo).toContain('Seguir só com as partes aprovadas')
  }
  const orquestrador = TEMPLATES.find(modelo => modelo.id === 'orquestrador')
  expect(orquestrador?.fields.prompt).toContain('uma pergunta por parte (Aprovar, Ajustar ou Tirar do plano')
})

test('os modelos prontos ensinam a regra do popup', async () => {
  expect(TEMPLATES.length).toBeGreaterThan(0)
  for (const modelo of TEMPLATES) expect(modelo.fields.prompt).toContain('/popup-perguntas:perguntar')
  const orquestrador = TEMPLATES.find(modelo => modelo.id === 'orquestrador')
  expect(orquestrador?.fields.tools).toContain('mcp__plugin_popup-perguntas_popup-perguntas__perguntar')
})

// Regressão: um marcador de início sem o de fim (órfão) não pode apagar o texto do usuário.
test('mesclarClaudeMd com marcador de início órfão não apaga o texto do usuário e deixa um bloco só', async () => {
  const ini = marcadorInicio('juridico')
  const orfao = `# Topo\n\n${ini}\nMinhas regras.\n\n${ini}\nVersão antiga.\n${marcadorFim('juridico')}\n`
  const novo = mesclarClaudeMd(orfao, 'juridico', CORPO)
  expect(novo).toContain('Minhas regras.')
  expect(novo).not.toContain('Versão antiga.')
  expect(novo.split(CORPO).length - 1).toBe(1)
  const duas = mesclarClaudeMd(novo, 'juridico', CORPO)
  expect(duas).toContain('Minhas regras.')
  expect(duas.split(CORPO).length - 1).toBe(1)
})

test('removerSecaoClaudeMd com marcador de início órfão tira só o bloco completo', async () => {
  const ini = marcadorInicio('juridico')
  const texto = `# Topo\n\n${ini}\nMinhas regras.\n\n${ini}\n${CORPO}\n${marcadorFim('juridico')}\n`
  const sem = removerSecaoClaudeMd(texto, 'juridico')
  expect(sem).toContain('Minhas regras.')
  expect(sem).not.toContain(CORPO)
})

test('removerSecaoClaudeMd em texto CRLF não deixa CR solto nem três quebras seguidas', async () => {
  const crlf = (texto: string): string => texto.split('\n').join(CR + '\n')
  const texto = crlf(`# Topo\n\n${marcadorInicio('juridico')}\n${CORPO}\n${marcadorFim('juridico')}\n\nFim\n`)
  const sem = removerSecaoClaudeMd(texto, 'juridico')
  expect(sem.includes(CR)).toBe(false)
  expect(sem.includes('\n\n\n')).toBe(false)
  expect(sem).toContain('Fim')
})

test('a geração e a melhoria com IA mandam terminar o prompt com a regra do popup', async () => {
  const gerar = generationPrompt('um revisor de PRs', [], []).system
  const melhorar = improvementPrompt(emptyFields()).system
  for (const texto of [gerar, melhorar]) {
    expect(texto).toContain('seção "## Dúvidas"')
    expect(texto).toContain(REGRA_POPUP_SUBAGENTE)
    expect(texto).toContain(REGRA_POPUP_PRINCIPAL)
  }
})
