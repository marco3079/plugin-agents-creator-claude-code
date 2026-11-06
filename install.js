#!/usr/bin/env node
'use strict';
// Instalador do Estúdio de Agentes (plugin agents-creator) e do que ele precisa para funcionar. Sem dependências (só Node).
//
//   node install.js                  instala ou atualiza o estúdio e os 7 plugins de que ele depende
//   node install.js --simular        só mostra o que faria, sem alterar nada (também aceita --dry-run)
//   node install.js --verificar      só mostra a situação de cada item (plugins, skills, extensões, programas, servidor)
//   node install.js --programas      também instala o Node.js, o git ou o VS Code que faltarem (winget no Windows, brew no macOS)
//   node install.js --escopo <user|project|local>   escopo da instalação (padrão: user)
//   node install.js --ajuda          mostra esta ajuda
//
// O que faz: registra os marketplaces que faltam, atualiza o catálogo dos que vêm do GitHub e instala ou atualiza os
// 8 plugins (as 7 dependências primeiro, o estúdio por último). Depois ativa os plugins desativados, instala o que os
// plugins declaram em "dependencies", copia as skills avulsas (/sala e /revisao) para ~/.claude/skills, instala as
// extensões do VS Code e confere Node.js, git, o comando code e o servidor do popup. No fim, mostra a situação de tudo.
// O que NÃO faz: não mexe em hooks nem em permissões, e não edita settings.json à mão (a ativação é o claude plugin enable).
// Plugins de pasta local (marketplace de pasta, de quem desenvolve) não são atualizados pelo catálogo.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MARKETPLACES = [
  { nome: 'historico-requisicoes', repo: 'marco3079/skill-git-claude-code' },
  { nome: 'skill-diff-claude-code', repo: 'marco3079/skill-diff-claude-code' },
  { nome: 'skill-squad-room', repo: 'marco3079/skill-squad-room' },
  { nome: 'popup-perguntas', repo: 'marco3079/skill-popup-duvida-cloude-code' },
  { nome: 'agents-creator', repo: 'marco3079/plugin-agents-creator-claude-code' },
];

// As 7 dependências vêm primeiro; o estúdio, por último.
const PLUGINS = [
  'historico@historico-requisicoes',
  'historico-painel@historico-requisicoes',
  'diff-review@skill-diff-claude-code',
  'diff-review-pane@skill-diff-claude-code',
  'squad-stream@skill-squad-room',
  'squad-room-pane@skill-squad-room',
  'popup-perguntas@popup-perguntas',
  'agents-creator@agents-creator',
];

const ESCOPOS = ['user', 'project', 'local'];
const OPCOES = ['--simular', '--dry-run', '--verificar', '--programas', '--escopo', '--ajuda'];

// Id de plugin de 2º nível (nome@marketplace): só entra se casar com esta regex, porque vai para o comando do claude.
const ID_PLUGIN = /^[a-z0-9][a-z0-9._-]*@[a-z0-9][a-z0-9._-]*$/i;

// Mesma tabela de hooks/lib/requisitos.ts: o scripts/testar-install.mjs confere que as duas batem.
const REQUISITOS = [
  // Skills avulsas: /sala e /revisao procuram em ~/.claude/skills, não no plugin; o install copia para lá.
  { tipo: 'skill', id: 'skill:squad-stream', nome: 'skill squad-stream', de: ['squad-room-pane@skill-squad-room'], para: 'o /sala achar a sala dos agentes', skill: 'squad-stream', plugin: 'squad-stream@skill-squad-room', arquivo: 'scripts/bus.js' },
  { tipo: 'skill', id: 'skill:review-edits', nome: 'skill review-edits', de: ['diff-review-pane@skill-diff-claude-code'], para: 'o /revisao achar as edições', skill: 'review-edits', plugin: 'diff-review@skill-diff-claude-code', arquivo: 'scripts/review.js' },
  // Extensões do VS Code: cada repositório traz o seu .vsix em dist/.
  { tipo: 'extensao', id: 'extensao:claude-request-history', nome: 'extensão Claude Request History', de: ['historico@historico-requisicoes'], para: 'o popup do histórico no VS Code', marketplace: 'historico-requisicoes', manifesto: 'vscode-extension/package.json' },
  { tipo: 'extensao', id: 'extensao:claude-review', nome: 'extensão Claude Review', de: ['diff-review@skill-diff-claude-code'], para: 'revisar as edições no VS Code', marketplace: 'skill-diff-claude-code', manifesto: 'extensions/claude-review/package.json' },
  { tipo: 'extensao', id: 'extensao:squad-room', nome: 'extensão Squad Room', de: ['squad-stream@skill-squad-room'], para: 'a sala dos agentes no VS Code', marketplace: 'skill-squad-room', manifesto: 'extensions/squad-room/package.json' },
  { tipo: 'extensao', id: 'extensao:claude-popup-perguntas', nome: 'extensão Claude Popup de Perguntas', de: ['popup-perguntas@popup-perguntas'], para: 'o popup dentro do VS Code (sem ela, ele abre no navegador)', marketplace: 'popup-perguntas', manifesto: 'vscode-extension/package.json' },
  { tipo: 'extensao', id: 'extensao:estudio-de-agentes', nome: 'extensão Estúdio de Agentes', de: ['agents-creator@agents-creator'], para: 'o ícone do estúdio na barra do VS Code', marketplace: 'agents-creator', manifesto: 'extensions/estudio-de-agentes/package.json' },
  // Programas: o Node.js roda os scripts, os hooks e o servidor do popup; o git faz o checkpoint; o code instala as extensões.
  { tipo: 'programa', id: 'programa:node', nome: 'Node.js', de: ['historico@historico-requisicoes', 'diff-review@skill-diff-claude-code', 'squad-stream@skill-squad-room', 'popup-perguntas@popup-perguntas'], para: 'os scripts das skills, os hooks e o servidor do popup', programa: 'node', minimo: '18.0.0' },
  { tipo: 'programa', id: 'programa:git', nome: 'git', de: ['historico@historico-requisicoes'], para: 'o checkpoint git de cada pedido', programa: 'git', minimo: '' },
  { tipo: 'programa', id: 'programa:code', nome: 'VS Code (comando code)', de: [], para: 'instalar as extensões do VS Code', programa: 'code', minimo: '' },
  // Servidor MCP do popup.
  { tipo: 'servidor', id: 'servidor:popup-perguntas', nome: 'servidor do popup', de: ['popup-perguntas@popup-perguntas'], para: 'a ferramenta perguntar do popup', servidor: 'plugin:popup-perguntas:popup-perguntas' },
];

// Instruções por programa (os mesmos textos de hooks/lib/requisitos.ts).
const INSTRUCOES = {
  node: 'Instale o Node.js 18 ou mais novo: https://nodejs.org (no Windows: winget install OpenJS.NodeJS.LTS).',
  git: 'Instale o git: https://git-scm.com/downloads (no Windows: winget install Git.Git).',
  code: `Instale o VS Code e deixe o comando code no PATH: https://code.visualstudio.com (no macOS: comando "Shell Command: Install 'code' command in PATH").`,
};

// Pacotes de cada programa: o id do winget (Windows) e o comando do brew (macOS).
const WINGET = { node: 'OpenJS.NodeJS.LTS', git: 'Git.Git', code: 'Microsoft.VisualStudioCode' };
const BREW = {
  node: ['brew', 'install', 'node'],
  git: ['brew', 'install', 'git'],
  code: ['brew', 'install', '--cask', 'visual-studio-code'],
};

// Situação de cada requisito na tabela final. `cat` agrupa para o resumo.
const SIT = {
  ok: { cat: 'ok', texto: '✔ ok' },
  copiado: { cat: 'ok', texto: '✔ copiado' },
  instalado: { cat: 'ok', texto: '✔ instalado' },
  falta: { cat: 'falta', texto: '✖ falta' },
  parado: { cat: 'parado', texto: '✖ parado' },
  falhou: { cat: 'falhou', texto: '✖ falhou' },
  opcional: { cat: 'opcional', texto: '– opcional' },
  desconhecido: { cat: 'desconhecido', texto: '? desconhecido' },
};
// Desatualizado: com x → y quando há versões; sem, só o aviso (as skills não têm versão).
const desatualizado = (de, para) => ({
  cat: 'desatualizado',
  texto: de === undefined ? '↑ desatualizado' : `↑ desatualizado (${de} → ${para})`,
});
// Em que grupo do resumo cai cada categoria.
const GRUPO = { ok: 'emDia', desatualizado: 'desatualizado', falta: 'faltando', parado: 'faltando', falhou: 'falhou', opcional: 'opcional', desconhecido: 'desconhecido' };

const AJUDA = [
  'Instalador do Estúdio de Agentes (plugin agents-creator) e do que ele precisa para funcionar.',
  '',
  '  node install.js              instala ou atualiza o estúdio e os 7 plugins de que ele depende',
  '  node install.js --simular    só mostra o que faria, sem alterar nada (também aceita --dry-run)',
  '  node install.js --verificar  só mostra a situação de cada item (plugins, skills, extensões, programas, servidor do popup)',
  '  node install.js --programas  também instala o Node.js, o git ou o VS Code que faltarem (winget no Windows, brew no macOS)',
  '  node install.js --escopo <user|project|local>   escopo da instalação (padrão: user)',
  '  node install.js --ajuda      mostra esta ajuda',
  '',
  'Com --verificar nada é alterado, nem os marketplaces. --programas não combina com --verificar.',
  'O que NÃO faz: não mexe em hooks nem em permissões; plugins de pasta local (marketplace de pasta, de quem desenvolve) não são atualizados pelo catálogo.',
];

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const dry = has('--simular') || has('--dry-run');
const verificar = has('--verificar');
const instalarProgramas = has('--programas');
const log = (m) => console.log(m);
const step = (m) => log(`  ${dry ? '[simulação] ' : ''}${m}`);
const ver = (p) => (p && p.version) || '?';

// Falhas de comando contadas no fim (código de saída 1) e a situação de cada requisito, para a tabela.
let erros = 0;
const situacoes = new Map();
const situacaoDe = (r) => situacoes.get(r.id) || SIT.desconhecido;

function escopoEscolhido() {
  const i = args.indexOf('--escopo');
  return i >= 0 ? args[i + 1] : 'user';
}

// Devolve a mensagem de erro se houver opção desconhecida, escopo inválido ou combinação proibida; senão null.
function erroDeArgs() {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--escopo') { i++; continue; } // o valor do --escopo é checado abaixo
    if (!OPCOES.includes(args[i])) return `opção desconhecida: ${args[i]}`;
  }
  const escopo = escopoEscolhido();
  if (!ESCOPOS.includes(escopo)) return `--escopo inválido: ${escopo || '(faltou o valor)'}; use user, project ou local`;
  if (verificar && dry) return '--verificar e --simular não combinam (o --verificar já não altera nada)';
  if (verificar && instalarProgramas) return '--programas não combina com --verificar (que não instala nada)';
  return null;
}

// Roda um comando com argumentos constantes do script (nunca texto vindo de JSON). No Windows vai por shell, para achar
// os .cmd (claude.cmd, code.cmd). Lá a linha vai numa string só (sem array de argumentos com shell, que o Node 24 avisa
// como DEP0190): os argumentos são constantes, então juntá-los é seguro.
function run(argv) {
  const r = process.platform === 'win32'
    ? spawnSync(argv.join(' '), { encoding: 'utf8', shell: true })
    : spawnSync(argv[0], argv.slice(1), { encoding: 'utf8' });
  const stdout = r.stdout || '';
  return { ok: r.status === 0, out: `${stdout}${r.stderr || ''}`.trim(), stdout };
}

// Monta a linha do cmd.exe para argv. O programa vai SEM aspas: entre aspas, o code.cmd não roda (o %~dp0 dele sai errado
// e dá 9009). Os argumentos vão entre aspas; aspa dupla ou % num argumento quebraria a linha, então são recusados.
function linhaWindows(argv) {
  const [programa, ...resto] = argv.map(String);
  if (!/^[A-Za-z0-9._-]+$/.test(programa)) throw new Error(`programa com caractere não permitido: ${programa}`);
  for (const a of resto) {
    if (/["%]/.test(a)) throw new Error(`argumento com caractere não permitido: ${a}`);
  }
  return [programa, ...resto.map((a) => `"${a}"`)].join(' ');
}

// Roda um comando cujos argumentos podem vir de dados (caminhos, ids lidos de JSON). No Windows vai pelo cmd, com a linha
// montada por linhaWindows; fora dele, sem shell. Devolve { ok, out, stdout }, como o run.
function runSeguro(argv) {
  try {
    const r = process.platform === 'win32'
      ? spawnSync('cmd.exe', ['/d', '/s', '/c', `"${linhaWindows(argv)}"`], { encoding: 'utf8', windowsVerbatimArguments: true })
      : spawnSync(argv[0], argv.slice(1), { encoding: 'utf8' });
    if (r.error) return { ok: false, out: r.error.message, stdout: '' };
    const stdout = r.stdout || '';
    return { ok: r.status === 0, out: `${stdout}${r.stderr || ''}`.trim(), stdout };
  } catch (e) {
    return { ok: false, out: e.message, stdout: '' };
  }
}

// Roda e lê o stdout como JSON. Comando com erro ou JSON inválido: null.
function json(argv) {
  const r = run(argv);
  if (!r.ok) return null;
  try { return JSON.parse(r.stdout); } catch (e) { return null; }
}

// A CLI devolve a lista de plugins como array. O plano falava em { installed: [...] }; aceita os dois formatos.
function listaInstalados(saida) {
  if (Array.isArray(saida)) return saida;
  if (saida && Array.isArray(saida.installed)) return saida.installed;
  return null;
}

// id -> entrada do plugin. Se a mesma id estiver em mais de um escopo, prefere a do escopo escolhido.
function mapaPlugins(lista, escopo) {
  const m = new Map();
  for (const p of lista) {
    if (!p || typeof p.id !== 'string') continue;
    const atual = m.get(p.id);
    if (!atual || (p.scope === escopo && atual.scope !== escopo)) m.set(p.id, p);
  }
  return m;
}

// Situação final de um plugin, comparando a lista de antes com a de depois.
function situacao(id, antes, depois, falhou, local) {
  if (falhou) return { cat: 'falhou', texto: '✖ falhou' };
  if (!depois) return { cat: 'falhou', texto: '✖ falhou (não consegui reler a lista de plugins)' };
  if (!depois.has(id)) return { cat: 'falhou', texto: '✖ falhou (não aparece na lista depois)' };
  const agora = ver(depois.get(id));
  if (!antes.has(id)) return { cat: 'instalado', texto: `✔ instalado (${agora})` };
  if (local) return { cat: 'local', texto: `– pasta local (${agora})` };
  const era = ver(antes.get(id));
  if (era !== agora) return { cat: 'atualizado', texto: `↑ atualizado de ${era} para ${agora}` };
  return { cat: 'igual', texto: `– já na versão mais nova (${agora})` };
}

function semClaude() {
  log('ERRO: não encontrei o comando "claude". Instale o Claude Code e confira se ele está no PATH.');
  log('Nada foi alterado. Se preferir, faça à mão, numa sessão do Claude Code:');
  for (const m of MARKETPLACES) log(`  /plugin marketplace add ${m.repo}`);
  log('  /plugin install agents-creator@agents-creator');
}

// JSON de um texto; undefined se não há texto ou se o texto não é JSON.
function lerJsonTexto(texto) {
  if (typeof texto !== 'string') return undefined;
  try { return JSON.parse(texto); } catch (e) { return undefined; }
}

// Conteúdo de um arquivo de texto; null se não existe ou não pode ser lido.
function lerTexto(caminho) {
  try { return fs.readFileSync(caminho, 'utf8'); } catch (e) { return null; }
}

// Conteúdo de um arquivo em bytes; null se não existe ou não pode ser lido.
function lerBytes(caminho) {
  try { return fs.readFileSync(caminho); } catch (e) { return null; }
}

// Uma parte da versão como número: o que não é número (ou falta) vale 0.
function numeroDaParte(parte) {
  const numero = Number.parseInt(parte ?? '', 10);
  return Number.isNaN(numero) ? 0 : numero;
}

// Compara versões parte a parte, como números (0.10.0 é maior que 0.2.0). Devolve -1, 0 ou 1.
function compararVersoes(a, b) {
  const pa = String(a).split('.');
  const pb = String(b).split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = numeroDaParte(pa[i]);
    const y = numeroDaParte(pb[i]);
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// Primeira versão (x.y.z, ou x.y) que aparece no texto; '' se não há nenhuma.
function versaoDoTexto(texto) {
  const m = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(texto || ''));
  if (!m) return '';
  return m[3] === undefined ? `${m[1]}.${m[2]}` : `${m[1]}.${m[2]}.${m[3]}`;
}

// Versão de cada extensão do `code --list-extensions --show-versions` (publisher.nome@versão), id em minúsculas.
function extensoesDaLista(saida) {
  const instaladas = {};
  for (const linha of String(saida || '').split(/\r?\n/)) {
    const texto = linha.trim();
    const corte = texto.lastIndexOf('@');
    if (corte === -1) continue;
    const id = texto.slice(0, corte).toLowerCase();
    const versao = texto.slice(corte + 1);
    if (id === '' || versao === '') continue;
    instaladas[id] = versao;
  }
  return instaladas;
}

// Escapa os caracteres especiais de uma expressão regular.
function escaparRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// O .vsix da extensão `nome` na versão dada. Aceita `nome.vsix` e `nome-<dígito>…vsix` (não `nome-pane-1.vsix`).
// Prefere o que tem a versão no nome; senão, o último em ordem alfabética. '' se não há nenhum.
function escolherVsix(arquivos, nome, versao) {
  const padrao = new RegExp(`^${escaparRegex(nome)}(-\\d.*)?\\.vsix$`, 'i');
  const candidatos = arquivos.filter((a) => padrao.test(a)).sort();
  if (candidatos.length === 0) return '';
  const sufixo = `-${versao}.vsix`.toLowerCase();
  const daVersao = candidatos.find((c) => c.toLowerCase().includes(sufixo));
  return daVersao !== undefined ? daVersao : candidatos[candidatos.length - 1];
}

// Estado do servidor MCP pela saída de `claude mcp list`: 'ok' se a linha dele diz Connected (e não Failed),
// 'parado' se a linha existe e não diz isso, 'desconhecido' se a linha não aparece.
function estadoDoServidor(saida, servidor) {
  const linha = String(saida || '').split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith(`${servidor}:`));
  if (linha === undefined) return 'desconhecido';
  return /\bConnected\b/.test(linha) && !linha.includes('Failed') ? 'ok' : 'parado';
}

// Id 'nome@marketplace' de um item de "dependencies": texto, ou objeto com name (ou plugin) e marketplace. Senão null.
function idDaDependencia(item) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return null;
  const nome = typeof item.name === 'string' ? item.name : typeof item.plugin === 'string' ? item.plugin : null;
  if (nome === null || typeof item.marketplace !== 'string') return null;
  return `${nome}@${item.marketplace}`;
}

// Ids de plugin que o plugin.json declara em "dependencies": só os que casam com ID_PLUGIN, sem repetição, na ordem.
function dependenciasDoManifesto(texto) {
  const raiz = lerJsonTexto(texto);
  const lista = raiz && typeof raiz === 'object' && Array.isArray(raiz.dependencies) ? raiz.dependencies : [];
  const ids = [];
  for (const item of lista) {
    const id = idDaDependencia(item);
    if (id !== null && ID_PLUGIN.test(id) && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

// Id (publisher.nome, em minúsculas), nome e versão do package.json de uma extensão; null se falta algum deles.
function extensaoDoManifesto(texto) {
  const raiz = lerJsonTexto(texto);
  if (!raiz || typeof raiz !== 'object') return null;
  const { publisher, name, version } = raiz;
  if (![publisher, name, version].every((v) => typeof v === 'string' && v !== '')) return null;
  return { id: `${publisher}.${name}`.toLowerCase(), nome: name, versao: version };
}

// Comando de instalação do programa no winget (windows) ou no brew (brew); null nas outras plataformas.
function comandoDoPrograma(programa, plataforma) {
  if (!Object.prototype.hasOwnProperty.call(WINGET, programa)) return null;
  if (plataforma === 'windows') {
    return ['winget', 'install', '--id', WINGET[programa], '-e', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements'];
  }
  if (plataforma === 'brew') return [...BREW[programa]];
  return null;
}

// Texto que diz como instalar o programa. '' se o programa não é conhecido.
function instrucaoDoPrograma(programa) {
  return Object.prototype.hasOwnProperty.call(INSTRUCOES, programa) ? INSTRUCOES[programa] : '';
}

// Situação de um programa: 'faltando', 'desatualizado' (abaixo do mínimo) ou 'ok'.
function estadoDoPrograma(achou, encontrada, minimo) {
  if (!achou) return 'faltando';
  if (minimo !== '' && encontrada !== '' && compararVersoes(encontrada, minimo) < 0) return 'desatualizado';
  return 'ok';
}

// Versão de um plugin no catálogo do marketplace (marketplace.json); sem versão lá, a do plugin.json da fonte './pasta'.
// '' se não se sabe. Mesma regra de hooks/estruturas.ts.
function versaoDoCatalogo(id, mkts) {
  const [nome, mk] = id.split('@');
  const m = mkts.find((x) => x && x.name === mk);
  if (!m || typeof m.installLocation !== 'string') return '';
  const raiz = lerJsonTexto(lerTexto(path.join(m.installLocation, '.claude-plugin', 'marketplace.json')));
  const lista = raiz && Array.isArray(raiz.plugins) ? raiz.plugins : [];
  const entrada = lista.find((x) => x && x.name === nome);
  if (!entrada) return '';
  if (typeof entrada.version === 'string' && entrada.version !== '') return entrada.version;
  if (typeof entrada.source === 'string' && entrada.source.startsWith('./')) {
    const segmentos = entrada.source.slice(2).split('/').filter((s) => s !== '');
    const manifesto = lerJsonTexto(lerTexto(path.join(m.installLocation, ...segmentos, '.claude-plugin', 'plugin.json')));
    if (manifesto && typeof manifesto.version === 'string') return manifesto.version;
  }
  return '';
}

// Situação de um plugin no --verificar: não instalado, desativado, pasta local, versão nova no catálogo ou a versão.
function situacaoVerificada(id, lista, mkts, locais) {
  const p = lista.get(id);
  if (!p) return '✖ não instalado';
  if (p.enabled === false) return `⏸ desativado (${ver(p)})`;
  if (locais.has(id.split('@')[1])) return `– pasta local (${ver(p)})`;
  const nova = versaoDoCatalogo(id, mkts);
  if (nova !== '' && compararVersoes(ver(p), nova) < 0) return `↑ versão nova ${ver(p)} → ${nova}`;
  return `✔ ${ver(p)}`;
}

// Caminhos relativos de todos os arquivos de uma pasta, em todos os níveis, sem os nomes que começam com ponto.
function listarArquivos(pasta, base = '') {
  const achados = [];
  for (const item of fs.readdirSync(path.join(pasta, base), { withFileTypes: true })) {
    if (item.name.startsWith('.')) continue;
    const rel = path.join(base, item.name);
    if (item.isDirectory()) achados.push(...listarArquivos(pasta, rel));
    else if (item.isFile()) achados.push(rel);
  }
  return achados;
}

// Compara a skill do plugin (fonte) com a cópia avulsa (destino): 'faltando' sem o arquivo principal, 'desatualizado'
// se algum arquivo da fonte falta no destino ou tem outro conteúdo, 'ok' se tudo bate, 'desconhecido' se não dá para ler.
function estadoCopia(fonte, destino, arquivo) {
  if (!fs.existsSync(path.join(destino, arquivo))) return 'faltando';
  try {
    for (const rel of listarArquivos(fonte)) {
      const copia = lerBytes(path.join(destino, rel));
      if (copia === null || !copia.equals(fs.readFileSync(path.join(fonte, rel)))) return 'desatualizado';
    }
    return 'ok';
  } catch (e) {
    return 'desconhecido';
  }
}

// Copia a pasta da skill (sobrescreve o que mudou). Devolve o resultado no formato do run.
function copiarSkill(fonte, destino) {
  try {
    fs.cpSync(fonte, destino, { recursive: true, force: true });
    return { ok: true, out: '', stdout: '' };
  } catch (e) {
    return { ok: false, out: e.message, stdout: '' };
  }
}

// Nome do .vsix de uma extensão dentro de uma pasta ('' se não há, ou se a pasta não existe).
function vsixDaPasta(dir, nome, versao) {
  try { return escolherVsix(fs.readdirSync(dir), nome, versao); } catch (e) { return ''; }
}

// Plugins que os plugins do estúdio declaram em "dependencies" e que ainda não estão instalados, sem repetição.
function dependenciasPendentes(lista) {
  const pedidos = [];
  const vistos = new Set();
  for (const id of PLUGINS) {
    const p = lista.get(id);
    if (!p || typeof p.installPath !== 'string') continue;
    for (const dep of dependenciasDoManifesto(lerTexto(path.join(p.installPath, '.claude-plugin', 'plugin.json')))) {
      if (PLUGINS.includes(dep) || lista.has(dep) || vistos.has(dep) || !ID_PLUGIN.test(dep)) continue;
      vistos.add(dep);
      pedidos.push({ dep, id });
    }
  }
  return pedidos;
}

// Uma ação do passo. No --verificar não faz nada (devolve null); no --simular só mostra o que faria (null); no normal,
// mostra, executa e conta a falha. Devolve o resultado do comando ({ ok, out, stdout }).
function fazer(texto, executa) {
  if (verificar) return null;
  step(texto);
  if (dry) return null;
  const r = executa();
  if (!r.ok) {
    erros += 1;
    log(`  ✖ falhou: ${texto}\n${r.out}`);
  }
  return r;
}

// Detecta a plataforma para o --programas: windows (winget), brew (macOS com brew) ou outro (só a instrução).
function detectarPlataforma() {
  if (process.platform === 'win32') return 'windows';
  return run(['brew', '--version']).ok ? 'brew' : 'outro';
}

// Marketplaces: registra os que faltam e atualiza o catálogo dos que vêm do GitHub.
function etapaMarketplaces(listaMkts) {
  log('\nMarketplaces:');
  for (const m of MARKETPLACES) {
    const atual = listaMkts.find((x) => x && x.name === m.nome);
    if (!atual) {
      step(`Adicionando o marketplace ${m.nome} (${m.repo})`);
      if (!dry) {
        const r = run(['claude', 'plugin', 'marketplace', 'add', m.repo]);
        if (!r.ok) { erros++; log(`  ✖ falhou ao adicionar ${m.nome}:\n${r.out}`); }
      }
    } else if (atual.source === 'directory') {
      step(`– ${m.nome}: pasta local, fica como está`);
    } else {
      step(`Atualizando o catálogo de ${m.nome}`);
      if (!dry) {
        const r = run(['claude', 'plugin', 'marketplace', 'update', m.nome]);
        if (!r.ok) { erros++; log(`  ✖ falhou ao atualizar ${m.nome}:\n${r.out}`); }
      }
    }
  }
}

// Plugins do estúdio: instala ou atualiza cada um. Devolve os ids que falharam.
function etapaPlugins(antes, escopo, locais) {
  log('\nPlugins:');
  const falhas = new Set();
  for (const id of PLUGINS) {
    const local = locais.has(id.split('@')[1]);
    if (antes.has(id) && local) { step(`– ${id}: pasta local (${ver(antes.get(id))}), fica como está`); continue; }
    const jaTem = antes.has(id);
    // Atualiza no escopo em que o plugin já está instalado (pode não ser o --escopo escolhido).
    // ESCOPOS.find devolve uma constante da lista, nunca o texto vindo do JSON da CLI.
    const escopoDele = jaTem ? (ESCOPOS.find((s) => s === antes.get(id).scope) || escopo) : escopo;
    if (jaTem) step(`Atualizando ${id} (escopo ${escopoDele}, versão atual ${ver(antes.get(id))})`);
    else step(`Instalando ${id} (escopo ${escopo})`);
    if (dry) continue;
    const r = run(jaTem ? ['claude', 'plugin', 'update', id, '--scope', escopoDele] : ['claude', 'plugin', 'install', id, '--scope', escopo]);
    if (!r.ok) { falhas.add(id); erros++; log(`  ✖ falhou: ${id}\n${r.out}`); }
  }
  return falhas;
}

// Plugins do estúdio que estão desativados: ativa cada um, no escopo em que está instalado.
function ativarPlugins(lista, escopo) {
  log('\nPlugins ativos:');
  const desligados = PLUGINS.filter((id) => lista.has(id) && lista.get(id).enabled === false);
  if (desligados.length === 0) log('  – nenhum desativado');
  for (const id of desligados) {
    // ESCOPOS.find devolve uma constante da lista, nunca o texto vindo do JSON da CLI.
    const escopoDele = ESCOPOS.find((s) => s === lista.get(id).scope) || escopo;
    const r = fazer(`Ativando ${id}`, () => runSeguro(['claude', 'plugin', 'enable', id, '--scope', escopoDele]));
    if (r !== null && r.ok) log(`  ✔ ${id}: ativado`);
  }
}

// Dependências das dependências: instala o que os plugins do estúdio declaram em "dependencies" e ainda não está instalado.
function instalarDependencias(lista, escopo, mkts) {
  log('\nDependências dos plugins:');
  const pedidos = dependenciasPendentes(lista);
  if (pedidos.length === 0) log('  – nenhuma');
  for (const { dep, id } of pedidos) {
    const mk = dep.split('@')[1];
    if (!mkts.some((m) => m && m.name === mk)) {
      log(`  ✖ ${dep}: o marketplace ${mk} não está registrado; adicione-o com /plugin marketplace add`);
      continue;
    }
    const r = fazer(`Instalando ${dep} (pedido por ${id})`, () => runSeguro(['claude', 'plugin', 'install', dep, '--scope', escopo]));
    if (r === null) {
      if (verificar) log(`  ✖ ${dep}: não instalado (pedido por ${id})`);
    } else if (r.ok) {
      log(`  ✔ ${dep}: instalado`);
    }
  }
}

// Skills avulsas: /sala e /revisao procuram em ~/.claude/skills. Copia do plugin quando falta ou está diferente.
function skillsAvulsas(lista) {
  log('\nSkills:');
  for (const r of REQUISITOS.filter((x) => x.tipo === 'skill')) {
    const origem = lista.get(r.plugin);
    if (!origem || typeof origem.installPath !== 'string') {
      log(`  – ${r.nome}: instale o plugin ${r.plugin} primeiro`);
      situacoes.set(r.id, SIT.falta);
      continue;
    }
    const fonte = path.join(origem.installPath, 'skills', r.skill);
    const destino = path.join(os.homedir(), '.claude', 'skills', r.skill);
    if (!fs.existsSync(fonte)) {
      log(`  ✖ ${r.nome}: o plugin ${r.plugin} não traz a pasta skills/${r.skill}`);
      situacoes.set(r.id, SIT.falta);
      continue;
    }
    const estado = estadoCopia(fonte, destino, r.arquivo);
    if (estado === 'ok') {
      log(`  ✔ ${r.nome}: igual a ${destino}`);
      situacoes.set(r.id, SIT.ok);
      continue;
    }
    if (estado === 'desconhecido') {
      log(`  ? ${r.nome}: não consegui comparar com ${destino}`);
      situacoes.set(r.id, SIT.desconhecido);
      continue;
    }
    const pendente = estado === 'faltando' ? SIT.falta : desatualizado();
    const res = fazer(`Copiando a skill ${r.skill} para ${destino}`, () => copiarSkill(fonte, destino));
    if (res === null) {
      log(`  ${estado === 'faltando' ? '✖' : '↑'} ${r.nome}: ${estado === 'faltando' ? `falta em ${destino}` : `diferente de ${destino}`}`);
      situacoes.set(r.id, pendente);
    } else if (res.ok) {
      log(`  ✔ ${r.nome}: copiada para ${destino}`);
      situacoes.set(r.id, SIT.copiado);
    } else {
      situacoes.set(r.id, SIT.falhou);
    }
  }
}

// Extensões do VS Code: instala ou atualiza cada uma pelo .vsix do marketplace (pasta dist/). Sem o comando code, só avisa.
function instalarExtensoes(mkts, codeOk) {
  log('\nExtensões do VS Code:');
  const extensoes = REQUISITOS.filter((r) => r.tipo === 'extensao');
  if (!codeOk) {
    for (const r of extensoes) {
      log(`  – ${r.nome}: sem o comando code (instale o VS Code e deixe o code no PATH)`);
      situacoes.set(r.id, SIT.opcional);
    }
    return;
  }
  const instaladas = extensoesDaLista(run(['code', '--list-extensions', '--show-versions']).stdout);
  for (const r of extensoes) {
    const mk = mkts.find((m) => m && m.name === r.marketplace);
    if (!mk || typeof mk.installLocation !== 'string') {
      log(`  ✖ ${r.nome}: o marketplace ${r.marketplace} não está registrado`);
      situacoes.set(r.id, SIT.falta);
      continue;
    }
    const ext = extensaoDoManifesto(lerTexto(path.join(mk.installLocation, ...r.manifesto.split('/'))));
    if (!ext) {
      log(`  ? ${r.nome}: não consegui ler ${r.manifesto} do marketplace`);
      situacoes.set(r.id, SIT.desconhecido);
      continue;
    }
    const atual = instaladas[ext.id];
    if (atual !== undefined && compararVersoes(atual, ext.versao) >= 0) {
      log(`  – ${r.nome}: já na versão ${ext.versao}`);
      situacoes.set(r.id, SIT.ok);
      continue;
    }
    const dist = path.join(mk.installLocation, 'dist');
    const vsix = vsixDaPasta(dist, ext.nome, ext.versao);
    if (vsix === '') {
      log(`  ✖ ${r.nome}: não achei o .vsix em ${dist}`);
      situacoes.set(r.id, atual === undefined ? SIT.falta : desatualizado(atual, ext.versao));
      continue;
    }
    const res = fazer(`Instalando ${r.nome} (${ext.versao})`, () => runSeguro(['code', '--install-extension', path.join(dist, vsix), '--force']));
    if (res === null) {
      log(`  ${atual === undefined ? '✖' : '↑'} ${r.nome}: ${atual === undefined ? 'não instalada' : `instalada ${atual}, a do marketplace é ${ext.versao}`}`);
      situacoes.set(r.id, atual === undefined ? SIT.falta : desatualizado(atual, ext.versao));
    } else if (res.ok) {
      log(`  ✔ ${r.nome}: instalada (${ext.versao})`);
      situacoes.set(r.id, SIT.instalado);
    } else {
      situacoes.set(r.id, SIT.falhou);
    }
  }
}

// Node.js, git e o comando code: estão instalados e na versão mínima? Com --programas, instala o que falta ou está velho.
function conferirProgramas(codeR) {
  log('\nProgramas:');
  const gitR = run(['git', '--version']);
  const achados = {
    node: { achou: true, encontrada: process.versions.node }, // quem roda este script já existe
    git: { achou: gitR.ok, encontrada: gitR.ok ? versaoDoTexto(gitR.stdout) : '' },
    code: { achou: codeR.ok, encontrada: codeR.ok ? versaoDoTexto(codeR.stdout) : '' },
  };
  let plataforma = null;
  for (const r of REQUISITOS.filter((x) => x.tipo === 'programa')) {
    const { achou, encontrada } = achados[r.programa];
    const estado = estadoDoPrograma(achou, encontrada, r.minimo);
    if (estado === 'ok') {
      log(`  ✔ ${r.nome}${encontrada !== '' ? ` ${encontrada}` : ''}`);
      situacoes.set(r.id, SIT.ok);
      continue;
    }
    const faltando = estado === 'faltando';
    log(faltando
      ? `  ✖ ${r.nome} não encontrado: ${instrucaoDoPrograma(r.programa)}`
      : `  ✖ ${r.nome} ${encontrada} é antigo (mínimo ${r.minimo}): ${instrucaoDoPrograma(r.programa)}`);
    situacoes.set(r.id, faltando ? SIT.falta : desatualizado(encontrada, r.minimo));
    if (!instalarProgramas) continue;
    if (plataforma === null) plataforma = detectarPlataforma();
    const comando = comandoDoPrograma(r.programa, plataforma);
    if (comando === null) {
      log('    (este sistema não tem winget nem brew: instale pela instrução acima)');
      continue;
    }
    const res = fazer(`Instalando ${r.nome}: ${comando.join(' ')}`, () => runSeguro(comando));
    if (res === null) continue;
    if (res.ok) {
      log('    instalado: abra uma sessão nova do terminal para o PATH ficar certo');
      situacoes.set(r.id, SIT.instalado);
    } else {
      situacoes.set(r.id, SIT.falhou);
    }
  }
}

// Servidor do popup: confere se conecta (claude mcp list).
function servidorDoPopup() {
  log('\nServidor do popup:');
  const req = REQUISITOS.find((r) => r.tipo === 'servidor');
  const estado = estadoDoServidor(run(['claude', 'mcp', 'list']).stdout, req.servidor);
  if (estado === 'ok') {
    log('  ✔ conectado');
    situacoes.set(req.id, SIT.ok);
  } else if (estado === 'parado') {
    log('  ✖ não conectou (confira o Node.js; depois abra uma sessão nova do Claude Code)');
    situacoes.set(req.id, SIT.parado);
  } else {
    log('  ? não aparece em claude mcp list (abra uma sessão nova depois de instalar)');
    situacoes.set(req.id, SIT.desconhecido);
  }
}

// Verificação dos plugins (só no --verificar): a situação de cada um, sem alterar nada.
function tabelaVerificacao(lista, mkts, locais) {
  log('\nPlugins:');
  const largura = Math.max(...PLUGINS.map((p) => p.length));
  log(`  ${'Plugin'.padEnd(largura)}  Situação`);
  log(`  ${'-'.repeat(largura)}  ${'-'.repeat(40)}`);
  for (const id of PLUGINS) log(`  ${id.padEnd(largura)}  ${situacaoVerificada(id, lista, mkts, locais)}`);
}

// Tabela final dos plugins (antes e depois de tudo) e o resumo. Devolve as contagens.
function tabelaFinalPlugins(antes, depois, falhas, locais) {
  const resultados = PLUGINS.map((id) => ({ id, ...situacao(id, antes, depois, falhas.has(id), locais.has(id.split('@')[1])) }));
  const largura = Math.max(...PLUGINS.map((p) => p.length));
  log(`\n  ${'Plugin'.padEnd(largura)}  Situação`);
  log(`  ${'-'.repeat(largura)}  ${'-'.repeat(40)}`);
  for (const r of resultados) log(`  ${r.id.padEnd(largura)}  ${r.texto}`);

  const cont = { instalado: 0, atualizado: 0, igual: 0, local: 0, falhou: 0 };
  for (const r of resultados) cont[r.cat]++;
  log(`\nResumo: ✔ ${cont.instalado} instalado(s) | ↑ ${cont.atualizado} atualizado(s) | – ${cont.igual} já na versão mais nova | – ${cont.local} pasta local | ✖ ${cont.falhou} com falha`);
  return cont;
}

// Tabela dos requisitos (skills, extensões, programas, servidor) com a situação de cada um, e o resumo.
function tabelaRequisitos() {
  log('\nRequisitos:');
  const largura = Math.max(...REQUISITOS.map((r) => r.nome.length));
  log(`  ${'Requisito'.padEnd(largura)}  Situação`);
  log(`  ${'-'.repeat(largura)}  ${'-'.repeat(40)}`);
  const cont = { emDia: 0, desatualizado: 0, faltando: 0, falhou: 0, opcional: 0, desconhecido: 0 };
  for (const r of REQUISITOS) {
    const s = situacaoDe(r);
    log(`  ${r.nome.padEnd(largura)}  ${s.texto}`);
    cont[GRUPO[s.cat]] += 1;
  }
  log(`\nResumo dos requisitos: ✔ ${cont.emDia} em dia | ↑ ${cont.desatualizado} desatualizado(s) | ✖ ${cont.faltando} faltando ou parado | ✖ ${cont.falhou} com falha | – ${cont.opcional} opcional | ? ${cont.desconhecido} desconhecido(s)`);
}

// Algum programa ficou faltando ou abaixo do mínimo (sem --programas, ou sem winget/brew para instalar).
function faltamProgramas() {
  return REQUISITOS.some((r) => r.tipo === 'programa' && ['falta', 'desatualizado'].includes(situacaoDe(r).cat));
}

function main() {
  if (has('--ajuda')) { for (const l of AJUDA) log(l); return 0; }
  const erro = erroDeArgs();
  if (erro) { log(`ERRO: ${erro}. Use --ajuda para ver as opções. Nada foi alterado.`); return 1; }
  const escopo = escopoEscolhido();

  log(`agents-creator — ${verificar ? 'verificação (nada é alterado)' : `instalador${dry ? ' (simulação)' : ''}`}`);
  const cc = run(['claude', '--version']);
  if (!cc.ok) { semClaude(); return 1; }
  log(`Claude Code: ${cc.out.split(/\r?\n/)[0]}`);

  // Leituras feitas ANTES de qualquer alteração: se alguma falhar, sai sem mexer em nada.
  const listaMkts = json(['claude', 'plugin', 'marketplace', 'list', '--json']);
  const listaPlugins = listaInstalados(json(['claude', 'plugin', 'list', '--json']));
  if (!Array.isArray(listaMkts) || !listaPlugins) {
    log('ERRO: não consegui ler a lista de marketplaces ou de plugins (claude plugin ... --json). Nada foi alterado.');
    return 1;
  }
  const locais = new Set(listaMkts.filter((m) => m && m.source === 'directory').map((m) => m.name));
  const antes = mapaPlugins(listaPlugins, escopo);

  let falhas = new Set();
  if (!verificar) {
    etapaMarketplaces(listaMkts);
    falhas = etapaPlugins(antes, escopo, locais);
  }

  // Releitura da lista e dos marketplaces (depois das instalações): as etapas seguintes usam estas.
  const depoisLista = listaInstalados(json(['claude', 'plugin', 'list', '--json']));
  const depois = depoisLista ? mapaPlugins(depoisLista, escopo) : null;
  const lista = depois || antes;
  const mkts = json(['claude', 'plugin', 'marketplace', 'list', '--json']);
  const mktsAtuais = Array.isArray(mkts) ? mkts : listaMkts;

  if (verificar) tabelaVerificacao(lista, mktsAtuais, locais);
  else ativarPlugins(lista, escopo);
  instalarDependencias(lista, escopo, mktsAtuais);
  skillsAvulsas(lista);
  const codeR = run(['code', '--version']);
  instalarExtensoes(mktsAtuais, codeR.ok);
  conferirProgramas(codeR);
  servidorDoPopup();

  if (dry) { log('\nSimulação concluída. Nada foi alterado.'); return 0; }
  if (verificar) {
    tabelaRequisitos();
    if (faltamProgramas()) log('Faltam programas: veja acima.');
    log('Os catálogos não foram atualizados (o --verificar não altera nada): se algo aparece como faltando mas já está instalado, rode o instalador sem --verificar ou use /agentes-dependencias, que atualiza os catálogos antes de conferir.');
    log('\nVerificação concluída. Nada foi alterado.');
    return 0;
  }

  const cont = tabelaFinalPlugins(antes, depois, falhas, locais);
  tabelaRequisitos();
  log('\n→ Abra uma sessão nova do Claude Code (ou rode /reload-plugins) e digite /agentes.');
  if (faltamProgramas()) log('Faltam programas: veja acima.');
  if (erros || cont.falhou) { log('Terminou com erros (veja acima).'); return 1; }
  log('Concluído.');
  return 0;
}

if (require.main === module) process.exitCode = main();
else module.exports = { PLUGINS, MARKETPLACES, REQUISITOS, compararVersoes, versaoDoTexto, extensoesDaLista, escolherVsix, estadoDoServidor, dependenciasDoManifesto, comandoDoPrograma, instrucaoDoPrograma, linhaWindows, runSeguro };
