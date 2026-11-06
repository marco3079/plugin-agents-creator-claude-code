// Projeto de exemplo para os testes do estúdio: imita o cenário dos prints (`REPO/scripts/telas/cenario.tsx`).
import fs from 'node:fs'
import path from 'node:path'
import { toMarkdown } from '../../../hooks/lib/agent'
import { TEMPLATES } from '../../../hooks/lib/templates'

/**
 * Cria o projeto `minha-api` com agentes de exemplo dentro de `base`.
 * @param {string} base - pasta temporária onde criar tudo
 * @returns {{ raiz: string, home: string, env: Record<string, string> }}
 */
export function criarProjetoDeAmostra(base) {
  const raiz = path.join(base, 'minha-api')
  const home = path.join(base, 'home')
  const config = path.join(home, '.claude')
  const env = { HOME: home, USERPROFILE: home }

  /** Markdown de um agente a partir de um modelo pronto; `nome` troca o nome do agente. */
  function agente(id, nome) {
    const t = TEMPLATES.find(x => x.id === id)
    if (!t) throw new Error(`modelo "${id}" não existe em TEMPLATES`)
    return toMarkdown({ ...t.fields, ...(nome ? { name: nome } : {}) }, '', null, '\n')
  }

  /** Grava um arquivo criando as pastas necessárias. */
  function gravar(arquivo, conteudo) {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true })
    fs.writeFileSync(arquivo, conteudo)
  }

  // Agentes do projeto
  gravar(path.join(raiz, '.claude', 'agents', 'revisor-de-codigo.md'), agente('revisor'))
  gravar(path.join(raiz, '.claude', 'agents', 'depurador.md'), agente('depurador'))
  gravar(path.join(raiz, '.claude', 'agents', 'executor-de-testes.md'), agente('testes'))
  gravar(path.join(raiz, '.claude', 'agents', 'orquestrador.md'), agente('orquestrador'))

  // Agentes do usuário
  gravar(path.join(config, 'agents', 'pesquisador.md'), agente('pesquisador'))
  gravar(path.join(config, 'agents', 'documentador.md'), agente('documentador'))

  // Plugin de exemplo instalado (escopo do usuário)
  const install = path.join(config, 'plugins', 'cache', 'exemplo', 'qa-kit', '1.0.0')
  gravar(path.join(install, 'agents', 'auditor.md'), agente('seguranca', 'auditor'))
  gravar(
    path.join(config, 'plugins', 'installed_plugins.json'),
    JSON.stringify(
      {
        version: 2,
        plugins: { 'qa-kit@exemplo': [{ scope: 'user', installPath: install, version: '1.0.0' }] },
      },
      null,
      2,
    ),
  )
  gravar(path.join(config, 'settings.json'), JSON.stringify({ enabledPlugins: { 'qa-kit@exemplo': true } }, null, 2))

  return { raiz, home, env }
}
