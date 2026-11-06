# Instalação (para o Claude)

Instruções para o Claude: quando o usuário pedir para instalar este repositório, siga estes passos.

Antes de rodar qualquer comando, diga ao usuário o que vai ser alterado:

- os 7 plugins de dependência (`historico`, `historico-painel`, `diff-review`, `diff-review-pane`, `squad-stream`, `squad-room-pane` e `popup-perguntas`), o plugin `agents-creator` e os marketplaces que faltarem, tudo no escopo do usuário, em `~/.claude`. Plugin desativado é ativado, e o que os plugins declaram como dependência também é instalado;
- as skills `squad-stream` e `review-edits`, copiadas para `~/.claude/skills` (o /sala e o /revisao procuram lá). Arquivo diferente é sobrescrito, e nada é apagado;
- as extensões do VS Code de cada plugin, instaladas ou atualizadas quando o comando `code` está no PATH;
- programas (Node.js, git, VS Code): nada é instalado, a não ser com `--programas`.

Peça o OK pelo popup (`/popup-perguntas:perguntar`); se o popup ainda não estiver instalado, use AskUserQuestion. Só prossiga depois que ele concordar.

## 1. Pré-requisitos

- Node.js 18 ou superior: `node --version`
- git: `git --version`
- Claude Code recente, com suporte a plugins de *function hooks* (os painéis ao lado do chat); foi
  testado no 2.1.312: `claude --version`
- VS Code com o comando `code` no PATH, para instalar as extensões do estúdio (opcional): `code --version`

Se faltar algum dos obrigatórios, peça ao usuário para instalar antes de continuar.

## 2. Comando principal

Clone ou atualize o repositório em `~/.claude-agents-creator/repo` e rode o instalador em modo de
simulação. Mostre a saída ao usuário e só então rode o instalador de verdade.

No Git Bash (Windows), no macOS ou no Linux, rode:

```bash
if [ -d "$HOME/.claude-agents-creator/repo/.git" ]; then
  git -C "$HOME/.claude-agents-creator/repo" pull
else
  git clone https://github.com/marco3079/plugin-agents-creator-claude-code.git "$HOME/.claude-agents-creator/repo"
fi
node "$HOME/.claude-agents-creator/repo/install.js" --simular
```

Depois de mostrar a simulação ao usuário, rode:

```bash
node "$HOME/.claude-agents-creator/repo/install.js"
```

No PowerShell do Windows, os blocos equivalentes são:

```powershell
$repo = "$env:USERPROFILE\.claude-agents-creator\repo"
if (Test-Path "$repo\.git") { git -C $repo pull } else { git clone https://github.com/marco3079/plugin-agents-creator-claude-code.git $repo }
node "$repo\install.js" --simular
```

```powershell
node "$env:USERPROFILE\.claude-agents-creator\repo\install.js"
```

Se a simulação mostrar algo que não foi combinado com o usuário, pare e pergunte antes de instalar.

## 3. O que o instalador faz

- registra os marketplaces que faltam e instala ou atualiza o estúdio e os 7 plugins, no escopo do usuário (`~/.claude`);
- atualiza o catálogo dos marketplaces que vêm do GitHub;
- ativa os plugins que estiverem desativados;
- instala o que esses plugins declaram como dependência;
- copia as skills squad-stream e review-edits para `~/.claude/skills` (o /sala e o /revisao procuram lá); arquivo diferente é sobrescrito, e nada é apagado;
- instala ou atualiza as extensões do VS Code de cada plugin, quando o comando `code` está no PATH;
- confere Node.js 18+, git e o VS Code: nada é instalado, a não ser com `--programas`;
- confere se o servidor do popup conecta.

O que já está na versão mais nova, ou vem de uma pasta local, fica como está.

Ao final, mostra uma tabela dos plugins: ✔ instalado, ↑ atualizado, – já na versão mais nova, – pasta local e
✖ falhou. Depois, uma tabela dos requisitos (skills, extensões, programas e o servidor do popup).

## 4. Flags

| Flag | O que faz |
|------|-----------|
| `--simular` (ou `--dry-run`) | Só mostra o que faria, sem alterar nada |
| `--escopo <escopo>` | Onde instalar: `user` (padrão, `~/.claude`), `project` ou `local` |
| `--verificar` | Só mostra a situação de cada item (plugins, skills, extensões, programas e o servidor do popup). Não altera nada, nem os marketplaces; por isso avisa, no fim, que os catálogos não foram atualizados (algo que aparece como faltando pode já estar instalado numa versão mais nova). Não combina com `--simular` nem com `--programas`; o script sai com erro e não faz nada |
| `--programas` | Também instala o Node.js, o git ou o VS Code que faltarem (winget no Windows, brew no macOS) |
| `--ajuda` | Mostra a ajuda |

## 5. Depois de instalar

1. Peça ao usuário para rodar `/reload-plugins` no Claude Code, ou para abrir uma sessão nova.
2. Peça ao usuário para rodar `/agentes-dependencias`. A tela Dependências mostra se os plugins, as skills, as extensões do VS Code, os programas e o servidor do popup estão instalados, rodando e atualizados.
3. Confira com `claude plugin list`: `agents-creator` deve aparecer habilitado.
4. Teste: peça ao usuário para rodar `/agentes estruturas`. A aba Estruturas deve abrir.
5. No VS Code, se ele já estava aberto durante a instalação, peça para abrir uma conversa nova no
   painel do Claude.

## 6. Problemas comuns

- **`claude` não está no PATH**: o instalador não encontra o comando `claude`. Peça ao usuário para
  rodar, no Claude Code, `/plugin marketplace add marco3079/<repo>` para cada um dos 5 repositórios
  (`skill-git-claude-code`, `skill-diff-claude-code`, `skill-squad-room`,
  `skill-popup-duvida-cloude-code` e `plugin-agents-creator-claude-code`) e, por fim,
  `/plugin install agents-creator@agents-creator`.
- **`Dependency "…" is not installed`**: rode o instalador de novo (seção 2), que instala as
  dependências que faltam, e depois `/reload-plugins`.
- **Erro de SSH ao clonar** (`Permission denied (publickey)`): defina a variável
  `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` e rode de novo. No bash, use
  `export CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1`; no PowerShell, use
  `$env:CLAUDE_CODE_PLUGIN_PREFER_HTTPS = "1"`.
- **"Filename too long" no Windows**: rode `git config --global core.longpaths true` e tente
  de novo.
- **`/sala` ou `/revisao` não acham a sala ou as edições**: rode o instalador de novo (seção 2), ou peça ao usuário para clicar em **Copiar** na tela Dependências.
- **O popup não abre**: confira o Node.js e se o servidor do popup aparece como `Connected` em `claude mcp list`.
- **Plugin desativado**: peça ao usuário para clicar em **Ativar** na tela Dependências, ou rode `claude plugin enable <id>`.
- **Faltou git ou Node.js**: peça ao usuário para clicar em **Instalar** na tela Dependências, ou rode o comando do programa: no Windows, `winget install Git.Git` e `winget install OpenJS.NodeJS.LTS`; no macOS, `brew install git` e `brew install node`. O instalador com `--programas` faz o mesmo para o git, o VS Code ou um Node.js antigo, mas precisa do Node.js para rodar. Depois, feche e abra o Claude Code, para o PATH valer.
- **`/agentes` não aparece**: falta uma dependência. Rode o instalador com `--verificar` (o comando da seção 2, com a flag no fim) para ver o que falta; depois, rode-o sem flag.
