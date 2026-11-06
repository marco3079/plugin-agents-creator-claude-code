# Instalação (para o Claude)

Instruções para o Claude: quando o usuário pedir para instalar este repositório, siga estes passos.

Antes de rodar qualquer comando, diga ao usuário o que vai ser alterado: os 7 plugins de dependência
(`historico`, `historico-painel`, `diff-review`, `diff-review-pane`, `squad-stream`,
`squad-room-pane` e `popup-perguntas`), o plugin `agents-creator` e os marketplaces que faltarem,
tudo no escopo do usuário, em `~/.claude`. Peça o OK pelo popup (`/popup-perguntas:perguntar`); se
o popup ainda não estiver instalado, use AskUserQuestion. Só prossiga depois que ele concordar.

## 1. Pré-requisitos

- Node.js 18 ou superior: `node --version`
- git: `git --version`
- Claude Code recente, com suporte a plugins de *function hooks* (os painéis ao lado do chat); foi
  testado no 2.1.312: `claude --version`

Se faltar algum, peça ao usuário para instalar antes de continuar.

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

- **Marketplaces**: adiciona os que faltam e atualiza o catálogo dos que vêm do GitHub; os de pasta
  local ficam como estão.
- **Plugins**: instala os que faltam, atualiza os que têm versão nova e deixa como está os que já
  estão na versão mais nova ou vêm de uma pasta local.

Ao final, mostra uma tabela: ✔ instalado, ↑ atualizado, – já na versão mais nova, – pasta local e
✖ falhou.

## 4. Flags

| Flag | O que faz |
|------|-----------|
| `--simular` (ou `--dry-run`) | Só mostra o que faria, sem alterar nada |
| `--escopo <escopo>` | Onde instalar: `user` (padrão, `~/.claude`), `project` ou `local` |
| `--ajuda` | Mostra a ajuda |

## 5. Depois de instalar

1. Peça ao usuário para rodar `/reload-plugins` no Claude Code, ou para abrir uma sessão nova.
2. Confira com `claude plugin list`: `agents-creator` deve aparecer habilitado.
3. Teste: peça ao usuário para rodar `/agentes estruturas`. A aba Estruturas deve abrir.
4. No VS Code, se ele já estava aberto durante a instalação, peça para abrir uma conversa nova no
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
