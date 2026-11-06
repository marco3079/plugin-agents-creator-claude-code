# Estúdio de Agentes

Cria, edita e organiza agentes e subagentes do Claude Code (`.claude/agents` e `~/.claude/agents`) num painel na barra lateral. É o mesmo estúdio do `/agentes` do plugin agents-creator: Galeria, Editor, Modelos, Estruturas, Mapa e Lixeira.

## Como abrir

Clique no ícone **Estúdio de Agentes** na barra de atividades. No topo da vista há botões para:

- **Novo agente**;
- **Abrir numa aba do editor**;
- **Abrir /agentes no Claude Code**;
- **Atualizar**.

A vista se atualiza sozinha quando os arquivos dos agentes mudam.

## Gerar, Melhorar com IA e Testar agora

Os botões **Gerar**, **Melhorar com IA** e **Testar agora** abrem uma conversa do Claude Code com o pedido já digitado. Confira o texto e aperte Enter lá. Eles precisam da extensão Claude Code. O "Testar agora" usa a versão salva do agente.

## Instalação

A partir da raiz do repositório:

```bash
code --install-extension dist/estudio-de-agentes-0.1.0.vsix
```

Depois: `Ctrl+Shift+P` → **Developer: Reload Window**.

---

Código em https://github.com/marco3079/plugin-agents-creator-claude-code (pasta `extensions/estudio-de-agentes`).
