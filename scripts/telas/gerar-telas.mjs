// Gera as telas do README (docs/prints/*.png) e o ícone do plugin (.claude-plugin/icon.png).
//
// Uso, de qualquer pasta:  node scripts/telas/gerar-telas.mjs
//
// Passos: acha o Chrome ou o Edge; copia o plugin para uma pasta temporária curta; roda o cenário
// (cenario.tsx) com `claude plugin test`, que imprime uma linha DUMP por tela; converte cada árvore em
// HTML (renderizar.mjs); mede cada página e tira o print em PNG 2x com fundo transparente, gravando
// primeiro na pasta temporária e copiando depois para docs/prints; gera o ícone a partir de
// docs/icon.svg; apaga a pasta temporária.
// Sem dependências npm. Precisa do comando `claude` e de Chrome ou Edge (ou defina CHROME_PATH).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { lerDumps, paginaHtml } from './renderizar.mjs'

// Raiz do repositório: duas pastas acima deste arquivo (scripts/telas/).
const RAIZ = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))

// Nomes da raiz que ficam de fora da cópia do plugin usada no teste (só no primeiro nível).
const FORA_DA_COPIA = new Set(['.git', 'docs', 'scripts', 'tests', '.claude', '.claude-review', 'CLAUDE.md', 'node_modules'])

// Telas que o cenário imprime, na ordem do README. Se alguma faltar, o script para com erro.
const TELAS_ESPERADAS = ['galeria', 'terminal-galeria', 'editor', 'editor-prompt', 'mapa', 'gerar', 'modelos']

// Navegadores procurados, nesta ordem, quando CHROME_PATH não está definido.
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

// Procura o Chrome ou o Edge instalado.
function acharNavegador() {
  const candidatos = [process.env.CHROME_PATH, ...NAVEGADORES].filter(Boolean)
  const achado = candidatos.find(caminho => fs.existsSync(caminho))
  if (!achado) throw new Error('Chrome ou Edge não encontrado; defina CHROME_PATH')
  return achado
}

// Copia a raiz do repositório para `destino`, sem as pastas e arquivos de FORA_DA_COPIA.
function copiarPlugin(destino) {
  fs.cpSync(RAIZ, destino, {
    recursive: true,
    filter: origem => {
      const relativo = path.relative(RAIZ, origem)
      return relativo === '' || !FORA_DA_COPIA.has(relativo.split(path.sep)[0])
    },
  })
}

// Últimas linhas da saída do teste, sem as linhas DUMP (cada uma tem milhares de caracteres) e com linhas longas cortadas.
function fimDaSaida(saida) {
  return saida.split(/\r?\n/).filter(linha => linha.trim() !== '' && !linha.startsWith('DUMP:')).slice(-20).map(linha => (linha.length > 300 ? linha.slice(0, 300) + '…' : linha)).join('\n')
}

// Roda o cenário dentro da cópia do plugin e devolve as telas ({ nome, arvore }) que ele imprimiu.
function rodarCenario(plugin) {
  const opcoes = { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  // No Windows o `claude` é um .cmd: precisa de shell, com o caminho entre aspas.
  const r = process.platform === 'win32'
    ? spawnSync(`claude plugin test "${plugin}"`, { ...opcoes, shell: true })
    : spawnSync('claude', ['plugin', 'test', plugin], opcoes)
  if (r.error) throw new Error(`não consegui rodar "claude plugin test": ${r.error.message}`)
  const saida = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
  const telas = lerDumps(saida)
  if (telas.length === 0) throw new Error(`o kit de testes não imprimiu nenhuma tela. Últimas linhas da saída:\n${fimDaSaida(saida)}`)
  const faltam = TELAS_ESPERADAS.filter(nome => !telas.some(tela => tela.nome === nome))
  if (faltam.length > 0) throw new Error(`faltou tela no dump do cenário: ${faltam.join(', ')} (claude plugin test terminou com código ${r.status}). Últimas linhas da saída:\n${fimDaSaida(saida)}`)
  if (r.status !== 0) console.warn(`Aviso: claude plugin test terminou com código ${r.status}, mas todas as telas saíram. Últimas linhas da saída:\n${fimDaSaida(saida)}`)
  return telas
}

// Mede a página: o título "H=<altura>;W=<largura>", escrito no load, aparece no --dump-dom.
function medirPagina(navegador, comuns, url, nome) {
  const r = spawnSync(navegador, [...comuns, '--window-size=1200,4000', '--virtual-time-budget=3000', '--dump-dom', url], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const medida = /H=(\d+);W=(\d+)/.exec(r.stdout ?? '')
  if (!medida) throw new Error(`não consegui medir a tela ${nome}`)
  return { altura: Number(medida[1]), largura: Number(medida[2]) }
}

// Roda o navegador gravando o PNG na pasta temporária e só então copia para `destino`.
// A imagem nunca é a de uma execução anterior, e uma cópia que falha (arquivo somente leitura
// ou travado pelo OneDrive) vira erro com a mensagem do sistema.
function tirarPrint(navegador, argumentos, url, temporario, destino) {
  spawnSync(navegador, [...argumentos, '--screenshot=' + temporario, url])
  if (!fs.existsSync(temporario) || fs.statSync(temporario).size === 0) throw new Error(`o navegador não gerou a imagem ${path.basename(destino)}`)
  try {
    fs.copyFileSync(temporario, destino)
  } catch (erro) {
    throw new Error(`não consegui gravar ${destino}: ${erro.message}`)
  }
}

// Tamanho de um arquivo em KB (0 se ele não existe).
const kb = arquivo => (fs.existsSync(arquivo) ? Math.round(fs.statSync(arquivo).size / 1024) : 0)

// Faz o trabalho dentro da pasta temporária `tmp` e devolve quantas telas foram geradas.
function gerar(tmp) {
  const plugin = path.join(tmp, 'p')
  const paginas = path.join(tmp, 'html')
  const perfil = path.join(tmp, 'perfil')
  const pastaPng = path.join(tmp, 'png')
  fs.mkdirSync(paginas)
  fs.mkdirSync(perfil)
  fs.mkdirSync(pastaPng)

  // Acha o navegador e monta os argumentos antes de copiar o plugin, para o erro sair em segundos.
  const navegador = acharNavegador()
  console.log(`Navegador: ${navegador}`)
  // O Edge do Windows se reabre por uma camada de compatibilidade e o primeiro processo sai na hora, sem devolver o DOM
  // nem esperar o print; esta opção desliga isso. O Chrome não precisa dela.
  const opcaoEdge = /edge/i.test(path.basename(navegador)) ? ['--edge-skip-compat-layer-relaunch'] : []
  const comuns = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--user-data-dir=' + perfil, '--default-background-color=00000000', '--log-level=3', ...opcaoEdge]

  console.log('Copiando o plugin para a pasta temporária...')
  copiarPlugin(plugin)
  fs.mkdirSync(path.join(plugin, 'tests'))
  fs.copyFileSync(path.join(RAIZ, 'scripts', 'telas', 'cenario.tsx'), path.join(plugin, 'tests', 'zz-telas.test.tsx'))

  console.log('Rodando o cenário com claude plugin test (pode levar de 1 a 3 minutos)...')
  const telas = rodarCenario(plugin)

  const pastaPrints = path.join(RAIZ, 'docs', 'prints')
  for (const { nome, arvore } of telas) {
    const arquivoHtml = path.join(paginas, `${nome}.html`)
    fs.writeFileSync(arquivoHtml, paginaHtml(nome, arvore))
    const url = pathToFileURL(arquivoHtml).href
    const { altura, largura } = medirPagina(navegador, comuns, url, nome)
    const destino = path.join(pastaPrints, `${nome}.png`)
    tirarPrint(navegador, [...comuns, '--window-size=' + largura + ',' + altura, '--force-device-scale-factor=2', '--virtual-time-budget=3000'], url, path.join(pastaPng, `${nome}.png`), destino)
    console.log(`${nome}: ${largura}x${altura} -> ${kb(destino)} KB`)
  }

  // Ícone: docs/icon.svg num quadrado de 1024 px, com fundo transparente.
  const icone = path.join(RAIZ, '.claude-plugin', 'icon.png')
  tirarPrint(navegador, [...comuns, '--window-size=1024,1024'], pathToFileURL(path.join(RAIZ, 'docs', 'icon.svg')).href, path.join(pastaPng, 'icon.png'), icone)
  console.log(`ícone: 1024x1024 -> ${kb(icone)} KB`)

  // Confere que todas as imagens de destino existem e não estão vazias.
  const esperadas = [...telas.map(tela => path.join(pastaPrints, `${tela.nome}.png`)), icone]
  const ruins = esperadas.filter(arquivo => !fs.existsSync(arquivo) || fs.statSync(arquivo).size === 0)
  if (ruins.length > 0) throw new Error(`imagens não geradas: ${ruins.join(', ')}`)
  return telas.length
}

// Apaga a pasta temporária. O Chrome pode segurar arquivos por um instante no Windows, então tenta de novo.
function limpar(tmp) {
  try {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 })
  } catch (erro) {
    console.warn(`Aviso: não consegui apagar a pasta temporária ${tmp} (${erro.message}).`)
  }
}

function principal() {
  console.log('Gera as telas do README (docs/prints) e o ícone (.claude-plugin/icon.png) a partir do cenário do plugin e do Chrome headless.')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'telas-'))
  try {
    const total = gerar(tmp)
    console.log(`Pronto: ${total} telas e o ícone gerados.`)
  } finally {
    limpar(tmp)
  }
}

try {
  principal()
} catch (erro) {
  console.error(`Erro: ${erro.message}`)
  process.exitCode = 1
}
