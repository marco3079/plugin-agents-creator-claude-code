// Dúvidas com o usuário: nomes e regras do popup de perguntas (plugin popup-perguntas).

/** Skill que abre o popup de perguntas. */
export const POPUP_SKILL = '/popup-perguntas:perguntar'

/** Ferramenta MCP do popup, para listas explícitas de ferramentas. */
export const POPUP_TOOL = 'mcp__plugin_popup-perguntas_popup-perguntas__perguntar'

/** Regra de quem roda como agente principal. */
export const REGRA_POPUP_PRINCIPAL = 'Dúvidas com o usuário: pergunte sempre pelo popup (`/popup-perguntas:perguntar`), com todas as dúvidas num popup só; use AskUserQuestion só se o popup não estiver disponível.'

/** Regra de subagente: devolve as dúvidas ao agente principal. */
export const REGRA_POPUP_SUBAGENTE = 'Dúvidas com o usuário: não pergunte direto nem abra o popup; devolva as dúvidas ao agente principal, que pergunta ao usuário pelo popup (`/popup-perguntas:perguntar`).'

/** Regra de quem pode rodar dos dois jeitos: como principal ou como subagente. */
export const REGRA_POPUP_GERAL = 'Dúvidas com o usuário: como agente principal, pergunte sempre pelo popup (`/popup-perguntas:perguntar`), com todas as dúvidas num popup só; como subagente, não abra o popup: devolva as dúvidas ao agente principal, que pergunta por ele.'
