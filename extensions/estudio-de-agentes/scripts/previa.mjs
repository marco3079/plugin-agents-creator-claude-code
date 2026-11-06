// Prévia do Estúdio de Agentes, sem abrir o VS Code.
//
// Uso (dentro da pasta EXT, a da extensão):
//
//   node scripts/previa.mjs
//     Desenha as telas num projeto de exemplo e grava previa/<tela>-<lugar>-<tema>.html (28 arquivos:
//     7 telas x 2 lugares x 2 temas) e os .png ao lado. O PNG precisa de Chrome ou Edge (ou defina CHROME_PATH);
//     sem navegador, grava só os HTML.
//
//   node scripts/previa.mjs --servidor [--porta 4790] [--pasta <projeto>]
//     Serve o estúdio interativo em http://localhost:<porta>, com o mesmo cliente da webview (out/webview.js),
//     para clicar e digitar no navegador. Sem --pasta, usa o projeto de exemplo numa pasta temporária
//     (apagada ao encerrar). Ctrl+C encerra.
//
// Precisa de `npm install` em EXT (esbuild). Escreve só em previa/, out/ e out-teste/ dentro de EXT.

import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Pasta da extensão: a pasta pai de scripts/.
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const requerer = createRequire(import.meta.url)

const SAIDA_RUNTIME = path.join(EXT, 'out-teste', 'previa-runtime.mjs')
const PASTA_PREVIA = path.join(EXT, 'previa')
const WEBVIEW_JS = path.join(EXT, 'out', 'webview.js')
const CSS = path.join(EXT, 'media', 'estudio.css')

// Telas: nome do arquivo e argumento de `abrir` (como /agentes <args>). A lixeira precisa de um preparo antes.
const TELAS = [
  { nome: 'galeria', arg: null },
  { nome: 'editor', arg: 'revisor-de-codigo' },
  { nome: 'gerar', arg: 'gerar' },
  { nome: 'modelos', arg: 'modelos' },
  { nome: 'estruturas', arg: 'estruturas' },
  { nome: 'mapa', arg: 'mapa' },
  { nome: 'lixeira', arg: 'lixeira', preparar: prepararLixeira },
]

// Lugares da prévia estática, com a largura da página em px (a da barra lateral e a da aba do editor).
const LUGARES = [
  { lugar: 'lateral', largura: 360 },
  { lugar: 'aba', largura: 860 },
]

const TEMAS = ['escuro', 'claro']

// Navegadores procurados, nesta ordem, quando CHROME_PATH não está definido (mesma lista de scripts/telas/gerar-telas.mjs).
const NAVEGADORES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/microsoft-edge',
]

// Lê as opções da linha de comando. Lança erro em opção desconhecida ou mal usada.
function lerArgumentos(args) {
  const opcoes = { servidor: false, porta: 4790, pasta: null }
  for (let i = 0; i < args.length; i++) {
    const item = args[i]
    if (item === '--servidor') {
      opcoes.servidor = true
    } else if (item === '--porta') {
      opcoes.porta = Number(args[++i])
      if (!Number.isInteger(opcoes.porta) || opcoes.porta <= 0) throw new Error('--porta precisa de um número inteiro')
    } else if (item === '--pasta') {
      opcoes.pasta = args[++i]
      if (!opcoes.pasta) throw new Error('--pasta precisa de um caminho')
    } else {
      throw new Error(`opção desconhecida: ${item}`)
    }
  }
  if (opcoes.pasta && !opcoes.servidor) throw new Error('--pasta só vale com --servidor')
  return opcoes
}

// Carrega o esbuild de EXT/node_modules.
function carregarEsbuild() {
  try {
    return requerer('esbuild')
  } catch {
    throw new Error('esbuild não encontrado em EXT/node_modules; rode "npm install" dentro de EXT')
  }
}

// Empacota o runtime (o motor do estúdio, com o código do plugin) e devolve os exports criarEstudio e criarProjetoDeAmostra.
async function carregarRuntime(esbuild) {
  fs.mkdirSync(path.dirname(SAIDA_RUNTIME), { recursive: true })
  await esbuild.build({
    stdin: {
      contents: "export { criarEstudio } from './src/runtime/estudio.js'\nexport { criarProjetoDeAmostra } from './test/amostra.js'\n",
      resolveDir: EXT,
      loader: 'js',
    },
    outfile: SAIDA_RUNTIME,
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'esm',
    charset: 'utf8',
    jsx: 'transform',
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
    inject: [path.join(EXT, 'src', 'runtime', 'jsx.js')],
    alias: { 'claude-code': path.join(EXT, 'src', 'runtime', 'atomos.js') },
    banner: { js: "import { createRequire as __criarRequire } from 'node:module'; const require = __criarRequire(import.meta.url);" },
    logLevel: 'warning',
  })
  return import(pathToFileURL(SAIDA_RUNTIME).href + '?t=' + Date.now())
}

// Gera out/webview.js (o cliente da webview) a partir de src/webview/main.js.
async function gerarWebview(esbuild) {
  fs.mkdirSync(path.dirname(WEBVIEW_JS), { recursive: true })
  await esbuild.build({
    entryPoints: [path.join(EXT, 'src', 'webview', 'main.js')],
    outfile: WEBVIEW_JS,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    charset: 'utf8',
    logLevel: 'warning',
  })
}

// Preparo da tela da lixeira: abre o depurador, exclui um agente e confirma, para a lixeira ter conteúdo.
async function prepararLixeira(e) {
  await e.abrir('depurador')
  await e.desenhar('previa', { colunas: 60, tema: 'escuro' })
  await e.disparar('previa', { id: 'k:ed-excluir', acao: 'press' })
  await e.ocioso()
  await e.desenhar('previa', { colunas: 60, tema: 'escuro' })
  await e.disparar('previa', { id: 'k:ed-excluir-sim', acao: 'press' })
  await e.ocioso()
}

// Procura o Chrome ou o Edge instalado. Devolve null se não achar.
function acharNavegador() {
  const candidatos = [process.env.CHROME_PATH, ...NAVEGADORES].filter(Boolean)
  return candidatos.find(caminho => fs.existsSync(caminho)) ?? null
}

// Tira o print de um HTML em modo headless, com a largura da página. Lança erro se o navegador não gravar a imagem.
function tirarPrint(navegador, perfil, html, png, largura) {
  const edge = /edge/i.test(path.basename(navegador))
  fs.rmSync(png, { force: true })
  const argumentos = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${perfil}`,
    ...(edge ? ['--edge-skip-compat-layer-relaunch'] : []),
    `--window-size=${largura},2400`,
    `--screenshot=${png}`,
    pathToFileURL(html).href,
  ]
  const r = spawnSync(navegador, argumentos, { timeout: 60000, stdio: 'ignore' })
  if (r.error) throw new Error(`navegador falhou: ${r.error.message}`)
  if (!fs.existsSync(png) || fs.statSync(png).size === 0) throw new Error(`o navegador não gerou ${path.basename(png)}`)
}

// Página completa de uma tela: CSS da extensão, classe do tema e largura do lugar.
function paginaCompleta({ css, html, tema, lugar, largura }) {
  const claro = tema === 'claro'
  const classe = claro ? 'vscode-light' : 'vscode-dark'
  const fundo = claro ? '#f3f3f3' : '#181818'
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>${css}</style></head><body class="${classe}" data-lugar="${lugar}" style="background:${fundo};width:${largura}px"><div id="raiz">${html}</div></body></html>`
}

// Remove a pasta temporária. No Windows o navegador pode segurar arquivos por um instante, então tenta de novo.
function limpar(pasta) {
  try {
    fs.rmSync(pasta, { recursive: true, force: true, maxRetries: 3 })
  } catch (erro) {
    console.warn(`Aviso: não consegui apagar a pasta temporária ${pasta} (${erro.message}).`)
  }
}

// Caminho relativo a EXT, com barras normais, para a lista final.
const relativo = arquivo => path.relative(EXT, arquivo).split(path.sep).join('/')

// Modo estático: grava previa/*.html e, se achar navegador, previa/*.png.
async function modoEstatico(runtime) {
  const { criarEstudio, criarProjetoDeAmostra } = runtime
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-previa-'))
  try {
    const { raiz, env } = criarProjetoDeAmostra(base)
    const css = fs.readFileSync(CSS, 'utf8')
    const navegador = acharNavegador()
    if (navegador) console.log(`Navegador: ${navegador}`)
    else console.warn('Aviso: Chrome ou Edge não encontrado (defina CHROME_PATH). Gravo só os HTML.')

    fs.mkdirSync(PASTA_PREVIA, { recursive: true })
    const perfil = path.join(base, 'perfil')
    fs.mkdirSync(perfil)

    const htmls = []
    const pngs = []
    const falhas = []
    for (const tela of TELAS) {
      const e = criarEstudio({ raiz, env, armazenamento: new Map(), abrirNoClaude: async () => {}, temVistaAberta: () => true })
      await e.iniciar()
      if (tela.preparar) await tela.preparar(e)
      if (tela.arg) await e.abrir(tela.arg)
      await e.ocioso()

      for (const { lugar, largura } of LUGARES) {
        for (const tema of TEMAS) {
          const conteudo = lugar === 'lateral' ? largura - 28 : Math.min(780, largura - 48)
          const colunas = Math.max(30, Math.floor(conteudo / 7.4))
          const html = await e.desenhar('previa', { colunas, tema })

          const nomeArquivo = `${tela.nome}-${lugar}-${tema}`
          const arquivoHtml = path.join(PASTA_PREVIA, `${nomeArquivo}.html`)
          fs.writeFileSync(arquivoHtml, paginaCompleta({ css, html, tema, lugar, largura }))
          htmls.push(arquivoHtml)

          if (!navegador) continue
          const arquivoPng = path.join(PASTA_PREVIA, `${nomeArquivo}.png`)
          try {
            tirarPrint(navegador, perfil, arquivoHtml, arquivoPng, largura)
            pngs.push(arquivoPng)
          } catch (erro) {
            falhas.push(`${nomeArquivo}.png: ${erro.message}`)
            console.error(`Erro no print ${nomeArquivo}: ${erro.message}`)
          }
        }
      }
    }

    console.log(`Gerados: ${htmls.length} HTML e ${pngs.length} PNG em ${relativo(PASTA_PREVIA)}/`)
    for (const arquivo of [...htmls, ...pngs]) console.log(`  ${relativo(arquivo)}`)
    if (falhas.length > 0) {
      process.exitCode = 1
      console.error(`Falharam ${falhas.length} prints:\n  ${falhas.join('\n  ')}`)
    }
  } finally {
    limpar(base)
  }
}

// Página da prévia interativa. O tema e o lugar vêm da URL; o cliente é o mesmo da webview.
function paginaServidor(tema, lugar) {
  const escuro = tema !== 'claro'
  const classe = escuro ? 'vscode-dark' : 'vscode-light'
  const fundo = escuro ? '#181818' : '#f3f3f3'
  const largura = lugar === 'aba' ? 'none' : '360px'
  return (
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><link rel="stylesheet" href="/estudio.css"><title>Estúdio de Agentes (prévia)</title></head>' +
    `<body class="${classe}" data-lugar="${lugar}" style="background:${fundo};max-width:${largura}">` +
    '<div id="raiz"><div class="carregando">Carregando…</div></div>' +
    "<script>window.acquireVsCodeApi = () => ({ postMessage: m => fetch('/evento', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m) }), setState() {}, getState() {} });" +
    "const fonte = new EventSource('/eventos'); fonte.onmessage = ev => window.dispatchEvent(new MessageEvent('message', { data: JSON.parse(ev.data) }))</script>" +
    '<script src="/webview.js"></script></body></html>'
  )
}

// Lê o corpo de uma requisição POST (limite de 1 MB).
function lerCorpo(req) {
  return new Promise((ok, falha) => {
    let texto = ''
    req.setEncoding('utf8')
    req.on('data', pedaco => {
      texto += pedaco
      if (texto.length > 1024 * 1024) {
        req.destroy()
        falha(new Error('corpo grande demais'))
      }
    })
    req.on('end', () => ok(texto))
    req.on('error', falha)
  })
}

// Responde com texto e cabeçalhos sem cache.
function responder(res, status, tipo, corpo) {
  res.writeHead(status, { 'content-type': tipo, 'cache-control': 'no-store' })
  res.end(corpo)
}

// Modo servidor: um estúdio só (vista 'navegador') servido por HTTP, com eventos em SSE para o desenho.
async function modoServidor(runtime, esbuild, opcoes) {
  const { criarEstudio, criarProjetoDeAmostra } = runtime
  let base = null
  let raiz
  let env
  if (opcoes.pasta) {
    raiz = path.resolve(opcoes.pasta)
    if (!fs.existsSync(raiz)) throw new Error(`pasta não existe: ${raiz}`)
    env = process.env
  } else {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-previa-'))
    const amostra = criarProjetoDeAmostra(base)
    raiz = amostra.raiz
    env = amostra.env
  }

  await gerarWebview(esbuild)
  const css = fs.readFileSync(CSS, 'utf8')

  const clientes = new Set()
  let colunas = 60
  let tema = 'escuro'
  let agendado = null

  // Manda uma linha SSE para todos os navegadores abertos.
  const enviar = dados => {
    const linha = `data: ${JSON.stringify(dados)}\n\n`
    for (const cliente of clientes) cliente.write(linha)
  }

  const e = criarEstudio({
    raiz,
    env,
    armazenamento: new Map(),
    abrirNoClaude: async texto => console.log('[abrirNoClaude]', texto),
    temVistaAberta: () => true,
    aoRolar: () => enviar({ tipo: 'rolar' }),
  })
  await e.iniciar()

  const desenharEEnviar = async () => {
    const html = await e.desenhar('navegador', { colunas, tema })
    enviar({ tipo: 'html', html })
  }

  // Quando o estado muda, redesenha depois de 30 ms (agrupa as mudanças seguidas).
  const agendar = () => {
    clearTimeout(agendado)
    agendado = setTimeout(() => {
      desenharEEnviar().catch(erro => console.error('Erro ao desenhar:', erro))
    }, 30)
  }
  e.aoMudar(agendar)

  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        tema = url.searchParams.get('tema') === 'claro' ? 'claro' : 'escuro'
        const lugar = url.searchParams.get('lugar') === 'aba' ? 'aba' : 'lateral'
        return responder(res, 200, 'text/html; charset=utf-8', paginaServidor(tema, lugar))
      }
      if (req.method === 'GET' && url.pathname === '/webview.js') {
        return responder(res, 200, 'application/javascript; charset=utf-8', fs.readFileSync(WEBVIEW_JS))
      }
      if (req.method === 'GET' && url.pathname === '/estudio.css') {
        return responder(res, 200, 'text/css; charset=utf-8', css)
      }
      if (req.method === 'GET' && url.pathname === '/eventos') {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' })
        res.flushHeaders()
        clientes.add(res)
        req.on('close', () => clientes.delete(res))
        return
      }
      if (req.method === 'POST' && url.pathname === '/evento') {
        const mensagem = JSON.parse(await lerCorpo(req))
        if (mensagem.tipo === 'pronto' || mensagem.tipo === 'colunas') {
          if (Number.isFinite(mensagem.colunas) && mensagem.colunas > 0) colunas = Math.floor(mensagem.colunas)
          await desenharEEnviar()
          return responder(res, 204, 'text/plain', '')
        }
        if (mensagem.tipo === 'evento') {
          await e.disparar('navegador', { id: mensagem.id, acao: mensagem.acao, valor: mensagem.valor })
          return responder(res, 204, 'text/plain', '')
        }
        return responder(res, 400, 'text/plain; charset=utf-8', 'tipo de mensagem desconhecido')
      }
      return responder(res, 404, 'text/plain; charset=utf-8', 'não encontrado')
    } catch (erro) {
      console.error('Erro na requisição', req.method, url.pathname, erro)
      if (!res.headersSent) responder(res, 500, 'text/plain; charset=utf-8', 'erro no servidor')
      else res.end()
    }
  })

  await new Promise((ok, falha) => {
    servidor.once('error', falha)
    servidor.listen(opcoes.porta, '127.0.0.1', ok)
  })

  console.log(`Prévia interativa: http://localhost:${opcoes.porta}/?tema=escuro&lugar=lateral`)
  console.log(`Prévia interativa (aba): http://localhost:${opcoes.porta}/?tema=escuro&lugar=aba`)
  console.log('Ctrl+C encerra.')

  const encerrar = () => {
    for (const cliente of clientes) cliente.end()
    servidor.close()
    if (base) limpar(base)
    process.exit(0)
  }
  process.on('SIGINT', encerrar)
  process.on('SIGTERM', encerrar)
}

async function principal() {
  const opcoes = lerArgumentos(process.argv.slice(2))
  const esbuild = carregarEsbuild()
  const runtime = await carregarRuntime(esbuild)
  if (opcoes.servidor) await modoServidor(runtime, esbuild, opcoes)
  else await modoEstatico(runtime)
}

try {
  await principal()
} catch (erro) {
  console.error(`Erro: ${erro.message}`)
  process.exitCode = 1
}
