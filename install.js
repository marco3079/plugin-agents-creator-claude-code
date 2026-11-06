#!/usr/bin/env node
'use strict';
// Instalador do Estúdio de Agentes (plugin agents-creator) e das dependências dele. Sem dependências (só Node).
//
//   node install.js              instala ou atualiza o estúdio e os 7 plugins de que ele depende
//   node install.js --simular    só mostra o que faria, sem alterar nada (também aceita --dry-run)
//   node install.js --escopo <user|project|local>   escopo da instalação (padrão: user)
//   node install.js --ajuda      mostra esta ajuda
//
// O que faz: registra os marketplaces que faltam, atualiza o catálogo dos que vêm do GitHub e instala ou
// atualiza os 8 plugins (as 7 dependências primeiro, o estúdio por último). No fim, mostra a situação de cada um.
// O que NÃO faz: não altera settings.json, hooks nem permissões; plugins lidos de uma pasta local
// (marketplace de pasta, de quem desenvolve) ficam como estão.

const { spawnSync } = require('child_process');

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
const OPCOES = ['--simular', '--dry-run', '--escopo', '--ajuda'];
const AJUDA = [
  'Instalador do Estúdio de Agentes (plugin agents-creator) e das dependências dele.',
  '',
  '  node install.js              instala ou atualiza o estúdio e os 7 plugins de que ele depende',
  '  node install.js --simular    só mostra o que faria, sem alterar nada (também aceita --dry-run)',
  '  node install.js --escopo <user|project|local>   escopo da instalação (padrão: user)',
  '  node install.js --ajuda      mostra esta ajuda',
  '',
  'O que NÃO faz: não altera settings.json, hooks nem permissões; plugins lidos de uma pasta local (marketplace de pasta, de quem desenvolve) ficam como estão.',
];

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const dry = has('--simular') || has('--dry-run');
const log = (m) => console.log(m);
const step = (m) => log(`  ${dry ? '[simulação] ' : ''}${m}`);
const ver = (p) => (p && p.version) || '?';

function escopoEscolhido() {
  const i = args.indexOf('--escopo');
  return i >= 0 ? args[i + 1] : 'user';
}

// Devolve a mensagem de erro se houver opção desconhecida ou escopo inválido; senão null.
function erroDeArgs() {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--escopo') { i++; continue; } // o valor do --escopo é checado abaixo
    if (!OPCOES.includes(args[i])) return `opção desconhecida: ${args[i]}`;
  }
  const escopo = escopoEscolhido();
  if (!ESCOPOS.includes(escopo)) return `--escopo inválido: ${escopo || '(faltou o valor)'}; use user, project ou local`;
  return null;
}

// Roda o comando "claude". No Windows vai por shell, para achar o claude.cmd. Lá o comando vai numa linha só
// (sem array de argumentos, que o Node 24 avisa como DEP0190): os argumentos são constantes do script ou o
// escopo já validado, então juntá-los é seguro.
function run(argv) {
  const r = process.platform === 'win32'
    ? spawnSync(['claude', ...argv].join(' '), { encoding: 'utf8', shell: true })
    : spawnSync('claude', argv, { encoding: 'utf8' });
  const stdout = r.stdout || '';
  return { ok: r.status === 0, out: `${stdout}${r.stderr || ''}`.trim(), stdout };
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

function main() {
  if (has('--ajuda')) { for (const l of AJUDA) log(l); return 0; }
  const erro = erroDeArgs();
  if (erro) { log(`ERRO: ${erro}. Use --ajuda para ver as opções. Nada foi alterado.`); return 1; }
  const escopo = escopoEscolhido();

  log(`agents-creator — instalador${dry ? ' (simulação)' : ''}`);
  const cc = run(['--version']);
  if (!cc.ok) { semClaude(); return 1; }
  log(`Claude Code: ${cc.out.split(/\r?\n/)[0]}`);

  // Leituras feitas ANTES de qualquer alteração: se alguma falhar, sai sem mexer em nada.
  const listaMkts = json(['plugin', 'marketplace', 'list', '--json']);
  const listaPlugins = listaInstalados(json(['plugin', 'list', '--json']));
  if (!Array.isArray(listaMkts) || !listaPlugins) {
    log('ERRO: não consegui ler a lista de marketplaces ou de plugins (claude plugin ... --json). Nada foi alterado.');
    return 1;
  }
  const locais = new Set(listaMkts.filter((m) => m && m.source === 'directory').map((m) => m.name));
  const antes = mapaPlugins(listaPlugins, escopo);
  let erros = 0;

  log('\nMarketplaces:');
  for (const m of MARKETPLACES) {
    const atual = listaMkts.find((x) => x && x.name === m.nome);
    if (!atual) {
      step(`Adicionando o marketplace ${m.nome} (${m.repo})`);
      if (!dry) {
        const r = run(['plugin', 'marketplace', 'add', m.repo]);
        if (!r.ok) { erros++; log(`  ✖ falhou ao adicionar ${m.nome}:\n${r.out}`); }
      }
    } else if (atual.source === 'directory') {
      step(`– ${m.nome}: pasta local, fica como está`);
    } else {
      step(`Atualizando o catálogo de ${m.nome}`);
      if (!dry) {
        const r = run(['plugin', 'marketplace', 'update', m.nome]);
        if (!r.ok) { erros++; log(`  ✖ falhou ao atualizar ${m.nome}:\n${r.out}`); }
      }
    }
  }

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
    const r = run(jaTem ? ['plugin', 'update', id, '--scope', escopoDele] : ['plugin', 'install', id, '--scope', escopo]);
    if (!r.ok) { falhas.add(id); erros++; log(`  ✖ falhou: ${id}\n${r.out}`); }
  }

  if (dry) { log('\nSimulação concluída. Nada foi alterado.'); return 0; }

  // Leitura feita DEPOIS de tudo, para classificar cada plugin.
  const depoisLista = listaInstalados(json(['plugin', 'list', '--json']));
  const depois = depoisLista ? mapaPlugins(depoisLista, escopo) : null;
  const resultados = PLUGINS.map((id) => ({ id, ...situacao(id, antes, depois, falhas.has(id), locais.has(id.split('@')[1])) }));

  const largura = Math.max(...PLUGINS.map((p) => p.length));
  log(`\n  ${'Plugin'.padEnd(largura)}  Situação`);
  log(`  ${'-'.repeat(largura)}  ${'-'.repeat(40)}`);
  for (const r of resultados) log(`  ${r.id.padEnd(largura)}  ${r.texto}`);

  const cont = { instalado: 0, atualizado: 0, igual: 0, local: 0, falhou: 0 };
  for (const r of resultados) cont[r.cat]++;
  log(`\nResumo: ✔ ${cont.instalado} instalado(s) | ↑ ${cont.atualizado} atualizado(s) | – ${cont.igual} já na versão mais nova | – ${cont.local} pasta local | ✖ ${cont.falhou} com falha`);

  log('\n→ Abra uma sessão nova do Claude Code (ou rode /reload-plugins) e digite /agentes.');
  if (erros || cont.falhou) { log('Terminou com erros (veja acima).'); return 1; }
  log('Concluído.');
  return 0;
}

process.exitCode = main();
