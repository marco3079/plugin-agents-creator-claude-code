---
name: criar-agentes
description: Cria, edita e visualiza agentes e subagentes do Claude Code (.claude/agents e ~/.claude/agents) pelo Estúdio de Agentes, um painel visual ao lado do chat. Use quando o usuário pedir para criar, editar, revisar, testar, organizar ou visualizar agentes/subagentes, montar um agente orquestrador, ou perguntar como escrever um bom agente.
---

# Estúdio de Agentes

O plugin `agents-creator` abre um painel ao lado do chat com a galeria de agentes, um editor visual
(com pré-visualização do arquivo, validação e "Testar agora"), modelos prontos, geração com IA,
o mapa de delegação e uma lixeira. O usuário também abre o painel digitando `/agentes`.

## Como usar

- **Criar a partir do pedido do usuário:** chame a ferramenta `open_agents_studio` deste plugin
  (`mcp__agents-creator__open_agents_studio`; se ela aparecer só pelo nome, carregue o esquema antes)
  com `draft` = `{ name, description, prompt, tools?, model?, color?, permissionMode?, effort?, maxTurns?, skills?, memory?, scope? }`.
  O painel abre com o rascunho e o usuário revisa e salva. **Não grave o arquivo você mesmo** depois disso.
- **Abrir um agente existente:** `agent: "<nome>"`.
- **Mostrar uma tela:** `view: "mapa" | "modelos" | "gerar" | "lista" | "lixeira"`.
- Sem a ferramenta (por exemplo em `claude -p`), escreva o arquivo diretamente no formato abaixo
  e sugira `/agentes` para revisar visualmente.

## Formato do arquivo

`.claude/agents/<nome>.md` (projeto, tem prioridade) ou `~/.claude/agents/<nome>.md` (usuário):

```markdown
---
name: revisor-de-codigo
description: Revisor de código. Use logo depois de alterar código para revisar qualidade e segurança.
tools: Read, Grep, Glob, Bash
model: sonnet
color: blue
---

Você é um revisor de código sênior...
```

| Campo | Valores |
|---|---|
| `name` (obrigatório) | minúsculas e hífens, sem `:` |
| `description` (obrigatório) | quando o Claude deve delegar; gatilhos claros |
| `tools` | lista separada por vírgulas; omitido = herda todas. `Agent(a, b)` restringe quais subagentes ele chama quando roda como principal |
| `disallowedTools` | ferramentas removidas do que ele herdaria |
| `model` | `sonnet`, `opus`, `haiku`, `fable`, `inherit` ou um ID completo |
| `color` | `red`, `blue`, `green`, `yellow`, `purple`, `orange`, `pink`, `cyan` |
| `permissionMode` | `default`, `acceptEdits`, `plan`, `auto`, `dontAsk`, `bypassPermissions` |
| `effort` | `low`, `medium`, `high`, `xhigh`, `max` |
| outros | `maxTurns`, `skills`, `memory` (`user`/`project`/`local`), `background`, `isolation: worktree`, `omitClaudeMd`, `initialPrompt`, `mcpServers`, `hooks` |

O corpo do arquivo é o prompt do sistema do agente.

## Boas práticas

- Uma responsabilidade por agente; a descrição diz *quando* usar ("Use logo depois de…", "Use ao encontrar…").
- O mínimo de ferramentas necessário: revisores e auditores só leem.
- Prompt com papel, processo passo a passo, regras e formato da resposta.
- O subagente não vê a conversa: o pedido de delegação precisa ser completo.
- Para um time de agentes, crie um orquestrador com `tools: Agent(especialista-a, especialista-b), Read`
  e rode-o como principal (`claude --agent orquestrador` ou o mapa do estúdio).
- Dúvidas com o usuário: o agente principal pergunta pelo popup (`/popup-perguntas:perguntar`, plugin popup-perguntas), com todas as dúvidas num popup só; subagentes não abrem o popup: devolvem as dúvidas ao principal.
