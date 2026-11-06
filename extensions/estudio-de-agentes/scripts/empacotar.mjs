#!/usr/bin/env node
// Gera o pacote da extensão: REPO/dist/estudio-de-agentes-<versão>.vsix
//
// Uso (a partir da pasta da extensão, depois de `npm install`):
//   node scripts/empacotar.mjs
//
// Antes de empacotar roda `node scripts/build.mjs`. Usa o vsce de node_modules se existir,
// senão `npx --yes @vscode/vsce@3.2.1`. Apaga só os `estudio-de-agentes-*.vsix` antigos de dist/.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const EXT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const de = (...p) => path.join(EXT, ...p)
const usaShell = process.platform === 'win32'

// 1) Build antes de empacotar.
const build = spawnSync(process.execPath, [de('scripts', 'build.mjs')], { cwd: EXT, stdio: 'inherit' })
if (build.status !== 0) {
  console.error('ERRO: o build falhou; o pacote não foi gerado.')
  process.exit(build.status ?? 1)
}

// 2) Versão e pasta de destino.
const pacote = JSON.parse(fs.readFileSync(de('package.json'), 'utf8'))
const versao = pacote.version
const dist = path.resolve(EXT, '..', '..', 'dist')
fs.mkdirSync(dist, { recursive: true })
for (const arq of fs.readdirSync(dist)) {
  if (/^estudio-de-agentes-.*\.vsix$/.test(arq)) fs.rmSync(path.join(dist, arq), { force: true })
}
const saida = path.join(dist, `estudio-de-agentes-${versao}.vsix`)

// 3) vsce: local (node_modules) ou via npx.
const vsceLocal = de('node_modules', '.bin', process.platform === 'win32' ? 'vsce.cmd' : 'vsce')
const argsVsce = ['package', '--no-dependencies', '-o', usaShell ? `"${saida}"` : saida]
const resultado = fs.existsSync(vsceLocal)
  ? spawnSync(usaShell ? `"${vsceLocal}"` : vsceLocal, argsVsce, { cwd: EXT, stdio: 'inherit', shell: usaShell })
  : spawnSync('npx', ['--yes', '@vscode/vsce@3.2.1', ...argsVsce], { cwd: EXT, stdio: 'inherit', shell: usaShell })

if (resultado.error) {
  console.error(`ERRO ao executar o vsce: ${resultado.error.message}`)
  process.exit(1)
}
if (resultado.status !== 0) {
  console.error('ERRO: o vsce falhou; o pacote não foi gerado.')
  process.exit(resultado.status ?? 1)
}

// 4) Resultado.
const kb = (fs.statSync(saida).size / 1024).toFixed(1)
console.log(`pacote pronto: ${saida} (${kb} KB)`)
