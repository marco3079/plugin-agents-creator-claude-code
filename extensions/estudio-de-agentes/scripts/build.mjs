#!/usr/bin/env node
// Gera os bundles da extensão com esbuild.
//
// Uso (a partir da pasta da extensão):
//   node scripts/build.mjs             gera out/extension.js (cjs) e out/webview.js (iife)
//   node scripts/build.mjs --teste     também gera out-teste/*.test.mjs (testes que importam o TS do plugin)
//   node scripts/build.mjs --parcial   pula, com aviso, as entradas cujos arquivos ainda não existem
//
// Sem --parcial, arquivo faltando = mensagem com o nome do arquivo e saída com código 1.

import * as esbuild from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const EXT = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const de = (...p) => path.join(EXT, ...p)
const relativo = (arq) => path.relative(EXT, arq).split(path.sep).join('/')

const args = new Set(process.argv.slice(2))
const TESTE = args.has('--teste')
const PARCIAL = args.has('--parcial')

// Arquivos que o próprio painel precisa (o `inject` e o `alias` do bundle).
const ARQUIVOS_DO_PAINEL = [de('src/runtime/jsx.js'), de('src/runtime/atomos.js')]

// Opções comuns para o código que importa o painel (TypeScript do plugin).
const PAINEL = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  charset: 'utf8',
  jsx: 'transform',
  jsxFactory: 'h',
  jsxFragment: 'Fragment',
  inject: [de('src/runtime/jsx.js')],
  alias: { 'claude-code': de('src/runtime/atomos.js') },
  logLevel: 'warning',
}

// Extensões e índices que o esbuild tenta ao resolver um import relativo sem extensão.
const TENTATIVAS = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx', '/index.js']

// Captura `import ... from '...'`, `export ... from '...'`, `import('...')` e `import '...'`.
const RE_IMPORT = /(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s*['"]([^'"]+)['"]/gm

function arquivoExiste(arq) {
  return fs.existsSync(arq) && fs.statSync(arq).isFile()
}

// Resolve um import relativo a partir de `origem`; devolve o caminho real ou null.
function resolverImport(origem, especificador) {
  const base = path.resolve(path.dirname(origem), especificador)
  for (const fim of TENTATIVAS) {
    const candidato = base + fim
    if (arquivoExiste(candidato)) return candidato
  }
  return null
}

// Percorre o grafo de imports relativos de `entrada` e devolve os arquivos que faltam.
function arquivosQueFaltam(entrada) {
  const visitados = new Set()
  const faltam = new Set()
  const pilha = [entrada]
  while (pilha.length) {
    const arq = pilha.pop()
    if (visitados.has(arq)) continue
    visitados.add(arq)
    if (!arquivoExiste(arq)) {
      faltam.add(arq)
      continue
    }
    const texto = fs.readFileSync(arq, 'utf8')
    for (const m of texto.matchAll(RE_IMPORT)) {
      if (/^(import|export)\s+type\b/.test(m[0])) continue // `import type` some no build (só tipos)
      const especificador = m[1] || m[2] || m[3]
      if (!especificador || !especificador.startsWith('.')) continue // pacotes e 'claude-code' (alias) não são arquivos
      const achado = resolverImport(arq, especificador)
      if (achado) pilha.push(achado)
      else faltam.add(path.resolve(path.dirname(arq), especificador))
    }
  }
  return [...faltam]
}

// Confere a entrada, os arquivos extras e os imports deles. Devolve true se pode construir.
function podeConstruir(nome, entrada, extras = []) {
  const faltam = new Set()
  for (const arq of [entrada, ...extras]) {
    for (const f of arquivosQueFaltam(arq)) faltam.add(f)
  }
  if (faltam.size === 0) return true
  for (const f of faltam) {
    if (PARCIAL) {
      console.log(`pulei ${nome}: falta ${relativo(f)}`)
    } else {
      console.error(`ERRO: falta ${relativo(f)} (necessário para ${nome}).`)
      console.error('Use --parcial para pular o que ainda não existe.')
      process.exit(1)
    }
  }
  return false
}

async function construir(nome, opcoes) {
  try {
    const resultado = await esbuild.build({ ...opcoes, absWorkingDir: EXT, metafile: true, write: true })
    for (const saida of Object.keys(resultado.metafile.outputs)) {
      const kb = (fs.statSync(de(saida)).size / 1024).toFixed(1)
      console.log(`${nome}: ${saida} (${kb} KB)`)
    }
  } catch (erro) {
    console.error(`ERRO do esbuild em ${nome}: ${erro.message}`)
    process.exit(1)
  }
}

// 1) Extensão (Node, cjs) e webview (navegador, iife).
const entradaExtensao = de('src/extension.js')
if (podeConstruir('extensão (out/extension.js)', entradaExtensao, ARQUIVOS_DO_PAINEL)) {
  fs.mkdirSync(de('out'), { recursive: true })
  await construir('extensão', {
    ...PAINEL,
    entryPoints: [entradaExtensao],
    outfile: de('out/extension.js'),
    format: 'cjs',
    external: ['vscode'],
  })
}

const entradaWebview = de('src/webview/main.js')
if (podeConstruir('webview (out/webview.js)', entradaWebview)) {
  fs.mkdirSync(de('out'), { recursive: true })
  await construir('webview', {
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    charset: 'utf8',
    logLevel: 'warning',
    entryPoints: [entradaWebview],
    outfile: de('out/webview.js'),
  })
}

// 2) Testes que importam o TS do plugin (só com --teste).
if (TESTE) {
  fs.rmSync(de('out-teste'), { recursive: true, force: true })

  const pastaTestes = de('test/mod')
  const arquivosTeste = fs.existsSync(pastaTestes)
    ? fs.readdirSync(pastaTestes).filter((f) => f.endsWith('.test.js')).map((f) => path.join(pastaTestes, f))
    : []

  if (arquivosTeste.length === 0) {
    console.log('aviso: nenhum test/mod/*.test.js encontrado; pulando os testes do plugin')
  } else {
    const prontos = arquivosTeste.filter((arq) =>
      podeConstruir(`teste ${relativo(arq)}`, arq, [...ARQUIVOS_DO_PAINEL, de('test/vscode-falso.js')]),
    )
    if (prontos.length > 0) {
      fs.mkdirSync(de('out-teste'), { recursive: true })
      await construir('testes', {
        ...PAINEL,
        entryPoints: prontos,
        outdir: de('out-teste'),
        outExtension: { '.js': '.mjs' },
        format: 'esm',
        alias: { ...PAINEL.alias, vscode: de('test/vscode-falso.js') },
        banner: {
          js: "import { createRequire as __criarRequire } from 'node:module'; const require = __criarRequire(import.meta.url);",
        },
      })
    }
  }
}
