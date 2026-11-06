# Fluxo de trabalho do squad

O usuário fala SEMPRE com o agente principal ("main", sessão Opus 5.5). Para qualquer pedido que gere ou altere código, o main segue este fluxo.

## Hierarquia

| Papel | Agente | Modelo | Quantos | Nomes na sala |
|---|---|---|---|---|
| Principal | sessão atual | Opus 5.5 | 1 | `main` |
| Gerador de código | `.claude/agents/gerador.md` | Haiku | 10 | `g01` … `g10` |
| Revisor | `.claude/agents/revisor.md` | Sonnet | 1 | `revisor` |
| Modelador 3D (Blender) | `.claude/agents/modelador3d.md` | Sonnet | até 4 | `m01` … `m04` |
| Artista 2D (Canva) | `.claude/agents/artista-canva.md` | Sonnet | 1 | `arte` |

Assets:
- Modelos 3D vão para os modeladores (`subagent_type: "modelador3d"`). Saída em `assets/modelos/<nome>/` (`<nome>.py`, `.blend`, `.glb`, `<nome>_preview.png`). Blender: `C:/Program Files (x86)/Steam/steamapps/common/Blender/blender.exe` (5.2 LTS), sempre em `--background`.
- Artes 2D (logo, capa, ícones, menus, HUD) vão para o artista (`subagent_type: "artista-canva"`). Saída em `assets/artes/<nome>.png`. Depende do conector do Canva estar ligado.
- O mini-plano de asset traz: nome, descrição visual, dimensões (metros ou px), estilo/paleta, limite de polígonos (3D) e caminho de saída.
- O revisor valida assets abrindo a prévia/PNG (Read) e conferindo arquivos, dimensões e polígonos; para 3D, também roda o script de novo para checar que gera sem erro.
- Os modeladores e o artista entram no mesmo fluxo dos geradores (passos 4 a 9) e contam à parte do limite de 10 geradores.
- **Esquemático antes de todo modelo 3D (obrigatório)**: antes de disparar qualquer modelador, o main pede ao artista (`arte`) um esquemático do modelo — uma prancha 2D com vista frontal, lateral e superior (e, se ajudar, uma vista 3/4), cotas em metros, cores/materiais indicados por rótulo e as partes principais nomeadas. Saída em `assets/modelos/<nome>/<nome>_esquematico.png`. O revisor aprova o esquemático (passos 6–7) e só então o main dispara o modelador, colocando o caminho do esquemático no mini-plano. O revisor do modelo 3D compara a prévia com o esquemático.

Comunicação entre agentes: squad-room (skill `squad-stream`).
BUS = `node "$HOME/.claude/plugins/cache/skill-squad-room/squad-stream/0.2.0/skills/squad-stream/scripts/bus.js"`
(`$HOME` é a pasta do usuário em cada PC, no Bash e no PowerShell. Se o plugin for atualizado, troque `0.2.0` pela versão que estiver em `$HOME/.claude/plugins/cache/skill-squad-room/squad-stream/`.)

## Passo a passo do main

1. **Plano**: escrever um plano completo do pedido, dividido em partes (o que cada parte faz, os arquivos que ela toca e como verificar).
2. **Dúvidas e aprovação**: se houver qualquer dúvida, perguntar ao usuário pelo popup (`/popup-perguntas:perguntar`, ferramenta `perguntar` do plugin popup-perguntas), com todas as dúvidas num popup só. AskUserQuestion só se o popup não estiver disponível. Com o plano fechado, mostrar o plano pelo popup para o usuário aprovar, com uma pergunta por parte (Aprovar, Ajustar ou Tirar do plano, com o resumo da parte na descrição). Seguir só com as partes aprovadas; refazer as que pediram ajuste e perguntar de novo só por elas. Só avançar quando estiver tudo aprovado.
3. **Dividir**: quebrar o plano em até 10 mini-planos independentes, um por gerador. Cada mini-plano precisa ter, sem margem de erro:
   - objetivo e contexto mínimo do projeto;
   - lista exata de arquivos que o gerador pode criar/editar (dois geradores nunca no mesmo arquivo);
   - assinaturas, nomes, formatos de dados e contratos com as outras partes, escritos por extenso;
   - passos de implementação numerados;
   - critérios de aceite e comandos de verificação.
   Se o pedido não render 10 partes úteis, usar menos geradores em vez de criar partes artificiais.
4. **Sala**: `BUS init <sala> --active`, abrir o stream com `Monitor` (`BUS tail <sala> --follow --types status,note,question,answer,msg,done,edit`) e mostrar ao usuário o comando do `tui.js` para acompanhar.
5. **Disparar**: lançar os geradores em paralelo (Agent, `subagent_type: "gerador"`, em segundo plano, todos na mesma mensagem). Prompt de cada um = nome (`g01`…), sala e o mini-plano.
6. **Revisão**: a cada `done` de um gerador, mandar a entrega ao revisor (Agent `subagent_type: "revisor"` na primeira vez; depois SendMessage para o mesmo revisor) com o mini-plano original + o resumo do gerador.
7. **Veredito do revisor**:
   - APROVADO → parte concluída.
   - REPROVADO com plano de ajuste → o main analisa. Se concordar, aprova e manda o plano ao mesmo gerador (SendMessage). Se não, ajusta o plano e manda a versão ajustada ao gerador. O gerador reentrega ao revisor (volta ao passo 6).
8. **Dúvidas durante o trabalho**: perguntas dos agentes para `@main` são respondidas no grupo. Se o main não souber responder com segurança, pergunta ao usuário pelo popup. Os subagentes nunca abrem o popup: perguntam ao `@main` no grupo.
9. **Encerrar**: quando todas as partes estiverem aprovadas, `BUS end <sala>`, parar o Monitor e entregar ao usuário um resumo (o que cada gerador fez, arquivos, pendências).

Pedidos que são só perguntas ou mudanças triviais (uma linha, um texto) podem ser feitos direto pelo main, sem squad, mas avisando o usuário.
