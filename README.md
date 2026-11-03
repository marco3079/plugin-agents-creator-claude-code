<p align="center">
  <img src="docs/logo.svg" alt="Estúdio de Agentes: crie e edite agentes e subagentes do Claude Code num painel visual" width="760">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Claude%20Code-plugin-d97757" alt="Plugin do Claude Code">
  <img src="https://img.shields.io/badge/painel-desktop%20%C2%B7%20VS%20Code%20%C2%B7%20terminal-8e4ec6" alt="Desktop, VS Code e terminal">
  <img src="https://img.shields.io/badge/licen%C3%A7a-MIT-3e63dd" alt="Licença MIT">
</p>

Plugin que cria e edita **agentes e subagentes do Claude Code** de forma visual, num painel ao lado
do chat. Nada de editar YAML na mão: você vê a galeria dos seus agentes, abre um no editor, liga e
desliga ferramentas com um clique, escolhe modelo e cor, escreve o prompt com pré-visualização e
salva. O arquivo `.md` gerado é exatamente o formato que o Claude Code lê.

## Instalação

### No app desktop do Claude (aba Code)

O comando `/plugin` não funciona no app desktop. Lá a instalação é pelo menu:

1. Clique em **+** ao lado da caixa de mensagem e escolha **Plugins**.
2. Em **Add marketplace**, informe `marco3079/plugin-agents-creator-claude-code`.
3. Clique em **Add plugin** e escolha **agents-creator**.
4. Digite `/agentes`. Se o comando não aparecer, abra uma sessão nova.

### No terminal

Dentro do Claude Code:

```
/plugin install agents-creator --marketplace marco3079/plugin-agents-creator-claude-code
```

Responda `y` para adicionar o marketplace e escolha o escopo (usuário é o padrão). Ou direto pelo
shell:

```bash
claude plugin install agents-creator --marketplace marco3079/plugin-agents-creator-claude-code
```

Instalado pelo terminal no escopo de usuário, o plugin também carrega nas sessões do app desktop.

Precisa de um Claude Code recente, com suporte a plugins de *function hooks* (os painéis ao lado do
chat); foi testado no 2.1.312.

<details>
<summary><b>Problemas na instalação</b></summary>

- **`/plugin` não está disponível**: você está no app desktop; use o menu **+ → Plugins** acima ou
  instale pelo terminal.
- **A opção `--marketplace` não é reconhecida**: o Claude Code está desatualizado. Atualize com
  `claude update` (ou atualize o app). Em versões antigas, estes dois passos instalam, mas o painel
  só funciona numa versão recente:
  ```
  /plugin marketplace add marco3079/plugin-agents-creator-claude-code
  /plugin install agents-creator@agents-creator
  ```
- **Já existe um marketplace `agents-creator`** (por exemplo, a pasta local adicionada antes):
  `/plugin marketplace remove agents-creator` e instale de novo.
- **Erro de SSH ao clonar** ("Permission denied (publickey)"): adicione pelo endereço HTTPS,
  `/plugin marketplace add https://github.com/marco3079/plugin-agents-creator-claude-code.git`.
- **"Filename too long" no Windows**: rode `git config --global core.longpaths true` e tente de novo.
- **Instalou, mas `/agentes` não aparece**: abra uma sessão nova (no terminal, `/reload-plugins`) e
  confira se o Claude Code está atualizado.

</details>

<details>
<summary><b>A partir de uma cópia local (para desenvolver)</b></summary>

```bash
claude plugin marketplace add "D:\caminho\para\plugin-agents-creator-claude-code"
```

```bash
claude plugin install agents-creator@agents-creator
```

Um marketplace de pasta é lido da própria pasta: depois de editar os arquivos, rode
`/reload-plugins`. Para uma sessão só, sem instalar: `claude --plugin-dir <pasta>`.

</details>

## Telas

<table>
  <tr>
    <td width="50%" valign="top"><b>Galeria</b><br>Agentes do projeto, do usuário e de plugins; quem está rodando agora e quantas vezes cada um foi usado.<br><br><img src="docs/prints/galeria.png" alt="Galeria de agentes"></td>
    <td width="50%" valign="top"><b>Editor</b><br>Prévia do agente, identidade, cor e ferramentas por categoria, com validação ao vivo.<br><br><img src="docs/prints/editor.png" alt="Editor de agente"></td>
  </tr>
  <tr>
    <td width="50%" valign="top"><b>Mapa de delegação</b><br>Quem é o agente principal e para quem ele delega; ⤷ marca os orquestradores.<br><br><img src="docs/prints/mapa.png" alt="Mapa de delegação"></td>
    <td width="50%" valign="top"><b>Gerar com IA</b><br>Descreva o agente numa frase e revise o rascunho que o Claude escreve.<br><br><img src="docs/prints/gerar.png" alt="Gerar agente com IA"></td>
  </tr>
</table>

<details>
<summary><b>Mais telas: prompt, modelos prontos e terminal</b></summary>
<br>
<table>
  <tr>
    <td width="50%" valign="top"><b>Modelo e prompt do sistema</b><br><br><img src="docs/prints/editor-prompt.png" alt="Modelo, execução e prompt do sistema"></td>
    <td width="50%" valign="top"><b>Modelos prontos</b><br><br><img src="docs/prints/modelos.png" alt="Modelos prontos de agentes"></td>
  </tr>
  <tr>
    <td colspan="2" valign="top"><b>No terminal</b>: o mesmo painel, desenhado em texto.<br><br><img src="docs/prints/terminal-galeria.png" alt="Galeria no terminal" width="560"></td>
  </tr>
</table>
</details>

<sub>As telas são geradas a partir da interface que o próprio painel desenha, com dados de exemplo; no
app, cores e botões seguem o tema do Claude Code.</sub>

## O que dá para fazer

- **Galeria** dos agentes do projeto (`.claude/agents`), do usuário (`~/.claude/agents`) e dos plugins
  instalados, em cartões com cor, modelo e ferramentas; busca e filtro por origem. Os cartões acendem
  **"em execução"** quando o Claude delega a um subagente e mostram quantas vezes cada um foi usado.
- **Editor visual**: nome, descrição, cor, modelo, esforço, modo de permissão, máximo de turnos,
  memória, segundo plano, worktree isolado; ferramentas por categoria (inclusive as de MCP da sessão),
  atalhos ("Somente leitura", "Desenvolvimento"…), ferramentas bloqueadas e os subagentes que um
  orquestrador pode chamar (`Agent(a, b)`).
- **Prompt do sistema** com pré-visualização em Markdown, estrutura sugerida e **✨ Melhorar com IA**
  (com desfazer).
- **Validação ao vivo** (nome repetido, descrição curta, campos inválidos…) e a prévia do arquivo `.md`
  que será gravado. Ao editar, só as linhas que você mudou mudam: `hooks`, `mcpServers` e outros
  campos que o editor não mostra são preservados.
- **Testar agora**: roda o rascunho como subagente desta sessão, sem salvar, e mostra a resposta.
- **Modelos prontos**: revisor de código, depurador, executor de testes, auditor de segurança,
  documentador, pesquisador, planejador, orquestrador e refatorador.
- **✨ Gerar com IA**: descreva o agente em uma frase e o Claude escreve nome, descrição, ferramentas e
  prompt para você revisar.
- **Mapa de delegação**: quem é o agente principal e para quem ele pode delegar; dá para escolher o
  agente principal do projeto ali mesmo.
- **Lixeira**: agentes excluídos pelo estúdio ficam guardados e podem ser restaurados.

## Como usar

Digite `/agentes` para abrir o painel. Atalhos:

| Comando | Abre |
|---|---|
| `/agentes` | a galeria (ou a tela em que você parou) |
| `/agentes novo` | o editor com um agente em branco |
| `/agentes gerar um revisor de PRs focado em segurança` | a geração com IA, já gerando |
| `/agentes modelos` | os modelos prontos |
| `/agentes mapa` | o mapa de delegação |
| `/agentes revisor-de-codigo` | esse agente no editor |

Também dá para pedir em linguagem natural — *"cria um agente que revisa migrações de banco"* — e o
Claude abre o estúdio com um rascunho preenchido (ferramenta `open_agents_studio`, ensinada pela skill
`criar-agentes`). Nada é gravado até você clicar em **Criar agente**.

### No VS Code

Não há nada a mais para instalar: a extensão do Claude Code no VS Code usa a mesma configuração do
terminal e do app desktop (`~/.claude`). Com o plugin instalado no escopo de usuário, abra o painel
do Claude no VS Code e digite `/agentes`: o estúdio abre ali mesmo, no painel.

- A extensão do Claude Code precisa ser recente, com suporte a painéis de plugin (a mesma exigência
  do terminal). Atualize pela aba Extensões do VS Code.
- Se o VS Code já estava aberto durante a instalação, abra uma conversa nova no painel do Claude.
- Se você apontou o Claude do VS Code para outra pasta de configuração (`CLAUDE_CONFIG_DIR` em
  `claudeCode.environmentVariables`), instale o plugin também nessa configuração.

### Onde os arquivos ficam

- **Projeto**: `.claude/agents/<nome>.md` — vai para o git e vale para quem usar o repositório; tem
  prioridade sobre o do usuário quando os nomes coincidem.
- **Usuário**: `~/.claude/agents/<nome>.md` — vale para todos os seus projetos.
- **Plugins**: somente leitura; use **Salvar cópia** para personalizar.

O Claude Code recarrega as pastas de agentes sozinho. A exceção é a primeira vez que a pasta
`.claude/agents` é criada durante uma sessão: aí é preciso reiniciar a sessão (o estúdio avisa), ou
usar **Testar agora** enquanto isso.

O **agente principal** (escolhido no mapa ou no editor) é gravado como `"agent"` em
`.claude/settings.local.json`, que vale só para você e não entra no git. Para uma sessão só, use
`claude --agent <nome>`.

## Desenvolvimento

```
.claude-plugin/plugin.json      manifesto, ícone (icon.png) e marketplace.json
hooks/hooks.json                aponta para o módulo de hooks
hooks/register.tsx              comando /agentes, ferramenta, eventos de subagentes e o painel
hooks/actions.ts                estado da sessão e o que cada botão faz
hooks/lib/                      formato dos arquivos (YAML), varredura, IA, catálogo, SVGs, modelos
hooks/ui/                       telas: galeria, editor, modelos, geração, mapa e lixeira
skills/criar-agentes/SKILL.md   ensina o Claude a abrir o estúdio com um rascunho
types/index.d.ts                contrato dos valores de estado
tests/                          testes (formato dos arquivos e o painel em todas as superfícies)
docs/                           logo, ícone (SVG) e as telas do README
scripts/telas/                  gera de novo as telas do README e o ícone em PNG
```

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

Depois que o Claude Code carrega o plugin de uma pasta que ele vigia, os tipos da API ficam em
`.claude-plugin/types/` e `tsc -p .` faz a checagem de tipos.

### Telas do README e ícone

As imagens de `docs/prints/` e o `.claude-plugin/icon.png` saem do próprio código do painel: um cenário
com agentes de exemplo desenha cada tela pelo kit de testes do Claude Code, o resultado vira HTML e o
Chrome (ou Edge) em modo headless tira o print. Depois de mudar a interface, gere tudo de novo com:

```bash
node scripts/telas/gerar-telas.mjs
```

Precisa de Node 18+, do Claude Code (`claude` no PATH) e do Chrome ou Edge; se o navegador não for
encontrado, informe o caminho em `CHROME_PATH`. O ícone é renderizado a partir de `docs/icon.svg`.

A API de *function hooks* está em acesso antecipado e pode mudar entre versões do Claude Code.

## Licença

MIT — veja [LICENSE](LICENSE).
