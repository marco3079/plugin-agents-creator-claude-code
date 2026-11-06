// Testes do install.js: as funções puras, as tabelas e a paridade com hooks/lib/requisitos.ts e hooks/lib/dependencias.ts.
// Rode com: node --test scripts/testar-install.mjs
// Nenhum teste roda comando que altere esta máquina. Os processos filhos são "node install.js --ajuda" e, só no Windows,
// um .cmd temporário que ecoa a própria pasta (apagado no fim). Os casos de erro de argumentos saem antes de qualquer comando.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const install = require('../install.js');
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const lerDoRepo = (arquivo) => readFileSync(join(raiz, arquivo), 'utf8');
const instalador = join(raiz, 'install.js');

test('compararVersoes compara parte a parte, como número', () => {
  assert.equal(install.compararVersoes('0.10.0', '0.2.0'), 1);
  assert.equal(install.compararVersoes('16.20.0', '18.0.0'), -1);
  assert.equal(install.compararVersoes('1.2', '1.2.0'), 0);
});

test('versaoDoTexto tira a versão do texto de --version, ou devolve vazio', () => {
  assert.equal(install.versaoDoTexto('v24.1.0'), '24.1.0');
  assert.equal(install.versaoDoTexto('git version 2.45.1.windows.1'), '2.45.1');
  assert.equal(install.versaoDoTexto('1.95.3\nabc123\nx64'), '1.95.3');
  assert.equal(install.versaoDoTexto('sem número nenhum'), '');
});

test('extensoesDaLista lê publisher.nome@versão em minúsculas e ignora linha vazia ou sem @', () => {
  assert.deepEqual(install.extensoesDaLista('Marco3079.Squad-Room@0.2.1\n\nsem arroba\n'), { 'marco3079.squad-room': '0.2.1' });
});

test('escolherVsix prefere a versão, aceita nome sem versão e não confunde squad-room com squad-room-pane', () => {
  assert.equal(install.escolherVsix(['squad-room-0.1.0.vsix', 'squad-room-0.2.1.vsix'], 'squad-room', '0.2.1'), 'squad-room-0.2.1.vsix');
  assert.equal(install.escolherVsix(['claude-request-history.vsix'], 'claude-request-history', '1.3.0'), 'claude-request-history.vsix');
  assert.equal(install.escolherVsix(['squad-room-pane-0.1.0.vsix'], 'squad-room', '0.1.0'), '');
  assert.equal(install.escolherVsix([], 'squad-room', '0.2.1'), '');
});

test('estadoDoServidor: linha Connected é ok, Failed é parado, sem a linha é desconhecido', () => {
  const id = 'plugin:popup-perguntas:popup-perguntas';
  assert.equal(install.estadoDoServidor(`${id}: node x.js - √ Connected`, id), 'ok');
  assert.equal(install.estadoDoServidor(`${id}: node x.js - × Failed to connect`, id), 'parado');
  assert.equal(install.estadoDoServidor('outro:servidor: node y.js - √ Connected', id), 'desconhecido');
});

test('dependenciasDoManifesto lê strings e objetos { name, marketplace }, descarta inválidos e repetidos', () => {
  const json = JSON.stringify({ dependencies: ['a@b', { name: 'c', marketplace: 'd' }, 'a b@c', 3, {}, 'a@b', { plugin: 'e', marketplace: 'f' }] });
  assert.deepEqual(install.dependenciasDoManifesto(json), ['a@b', 'c@d', 'e@f']);
  assert.deepEqual(install.dependenciasDoManifesto('{"name":"x"}'), []);
  assert.deepEqual(install.dependenciasDoManifesto(null), []);
  assert.deepEqual(install.dependenciasDoManifesto('não é json'), []);
});

test('comandoDoPrograma: winget no Windows, brew no macOS, nada nas outras plataformas', () => {
  assert.deepEqual(install.comandoDoPrograma('git', 'windows'), ['winget', 'install', '--id', 'Git.Git', '-e', '--source', 'winget', '--accept-package-agreements', '--accept-source-agreements']);
  assert.deepEqual(install.comandoDoPrograma('code', 'brew'), ['brew', 'install', '--cask', 'visual-studio-code']);
  assert.deepEqual(install.comandoDoPrograma('node', 'brew'), ['brew', 'install', 'node']);
  assert.equal(install.comandoDoPrograma('node', 'outro'), null);
});

test('instrucaoDoPrograma dá o texto de cada programa', () => {
  assert.equal(install.instrucaoDoPrograma('git'), 'Instale o git: https://git-scm.com/downloads (no Windows: winget install Git.Git).');
  assert.equal(install.instrucaoDoPrograma('node'), 'Instale o Node.js 18 ou mais novo: https://nodejs.org (no Windows: winget install OpenJS.NodeJS.LTS).');
  assert.equal(install.instrucaoDoPrograma('code'), "Instale o VS Code e deixe o comando code no PATH: https://code.visualstudio.com (no macOS: comando \"Shell Command: Install 'code' command in PATH\").");
});

test('linhaWindows deixa o programa sem aspas, põe os outros argumentos entre aspas e recusa aspas duplas e %', () => {
  assert.equal(install.linhaWindows(['code', '--install-extension', 'C:\\a b\\x.vsix', '--force']), 'code "--install-extension" "C:\\a b\\x.vsix" "--force"');
  assert.throws(() => install.linhaWindows(['x', 'a"b']), /argumento com caractere não permitido/);
  assert.throws(() => install.linhaWindows(['x', '%PATH%']), /argumento com caractere não permitido/);
  assert.throws(() => install.linhaWindows(['a b', 'c']), /programa com caractere não permitido/);
  assert.throws(() => install.linhaWindows(['a&b', 'c']), /programa com caractere não permitido/);
});

test('runSeguro acha o .cmd no PATH com o programa sem aspas (regressão do %~dp0 do code.cmd)', (t) => {
  if (process.platform !== 'win32') return t.skip('só no Windows: o que está em jogo é o cmd.exe e o .cmd do PATH');
  const pasta = mkdtempSync(join(tmpdir(), 'eco-agentes-'));
  const pathOriginal = process.env.PATH;
  try {
    // O .cmd só mostra a pasta onde está. Com o programa entre aspas, o cmd acha o .cmd, mas o %~dp0 vira a pasta atual;
    // com o programa sem aspas, a saída traz a pasta dele.
    writeFileSync(join(pasta, 'eco-agentes.cmd'), '@echo %~dp0\r\n');
    process.env.PATH = pathOriginal ? `${pasta};${pathOriginal}` : pasta;
    const r = install.runSeguro(['eco-agentes', 'x y']);
    assert.equal(r.ok, true, r.out);
    assert.ok(r.out.includes(pasta), `a saída devia trazer a pasta do .cmd (${pasta}); veio: ${r.out}`);
  } finally {
    if (pathOriginal === undefined) delete process.env.PATH;
    else process.env.PATH = pathOriginal;
    rmSync(pasta, { recursive: true, force: true });
  }
});

test('REQUISITOS tem os 11 itens, ids únicos, na ordem skill, extensão, programa, servidor', () => {
  const R = install.REQUISITOS;
  assert.equal(R.length, 11);
  assert.equal(new Set(R.map((r) => r.id)).size, 11);
  assert.deepEqual(R.map((r) => r.tipo), ['skill', 'skill', 'extensao', 'extensao', 'extensao', 'extensao', 'extensao', 'programa', 'programa', 'programa', 'servidor']);
  const squad = R.find((r) => r.id === 'skill:squad-stream');
  assert.equal(squad.arquivo, 'scripts/bus.js');
  assert.equal(squad.plugin, 'squad-stream@skill-squad-room');
});

test('PLUGINS tem 8 plugins, com o agents-creator por último', () => {
  assert.equal(install.PLUGINS.length, 8);
  assert.equal(install.PLUGINS[7], 'agents-creator@agents-creator');
});

test('os ids de REQUISITOS batem, na ordem, com os de hooks/lib/requisitos.ts', () => {
  const ids = [...lerDoRepo('hooks/lib/requisitos.ts').matchAll(/id: '([a-z]+:[^']+)'/g)].map((m) => m[1]);
  assert.equal(ids.length, 11);
  assert.deepEqual(install.REQUISITOS.map((r) => r.id), ids);
});

test('os nomes de REQUISITOS batem, na ordem, com os de hooks/lib/requisitos.ts', () => {
  const nomes = [...lerDoRepo('hooks/lib/requisitos.ts').matchAll(/nome: '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(install.REQUISITOS.map((r) => r.nome), nomes);
});

test('os plugins do estúdio (sem o agents-creator) batem, na ordem, com DEPENDENCIAS de hooks/lib/dependencias.ts', () => {
  const ids = [...lerDoRepo('hooks/lib/dependencias.ts').matchAll(/id: '([^']+@[^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(install.PLUGINS.filter((id) => id !== 'agents-creator@agents-creator'), ids);
});

test('node install.js --ajuda sai com 0 e cita --verificar e --programas', () => {
  const r = spawnSync(process.execPath, [instalador, '--ajuda'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--verificar/);
  assert.match(r.stdout, /--programas/);
});

test('combinações inválidas de argumentos saem com 1 antes de rodar qualquer comando', () => {
  for (const combo of [['--verificar', '--simular'], ['--verificar', '--programas'], ['--opcao-que-nao-existe']]) {
    const r = spawnSync(process.execPath, [instalador, ...combo], { encoding: 'utf8' });
    assert.equal(r.status, 1, combo.join(' '));
    assert.match(r.stdout, /ERRO/);
  }
});
