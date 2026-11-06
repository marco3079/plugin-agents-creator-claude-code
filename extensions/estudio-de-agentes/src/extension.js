// Ponto de entrada da extensão: vista da barra lateral e aba do editor, que compartilham um mesmo estúdio.
import * as vscode from 'vscode'
import os from 'node:os'
import path from 'node:path'
import { criarAbridorDoClaude } from './claude.js'
import { gerarNonce, paginaDoEstudio, paginaSemPasta } from './pagina.js'
import { criarEstudio } from './runtime/estudio.js'

const VISTA = 'estudioDeAgentes.painel'
const ABA = 'estudioDeAgentes.aba'

/** Estúdio corrente, guardado só para os testes (ver `_estudioAtual`). */
let estudioAtualGlobal = null

/** @returns {object|null} o estúdio corrente, ou `null` se não há pasta de projeto */
export function _estudioAtual() {
  return estudioAtualGlobal
}

/**
 * Ativa a extensão: registra a barra lateral, a aba, os comandos e os observadores de arquivos.
 * @param {object} context contexto de extensão do VS Code
 */
export function activate(context) {
  const saida = vscode.window.createOutputChannel('Estúdio de Agentes')
  const log = t => saida.appendLine(`[${new Date().toLocaleTimeString()}] ${t}`)
  const abrirNoClaude = criarAbridorDoClaude(vscode)

  const vistas = new Map()
  let estudio = null
  let raizDoEstudio = null
  let iniciando = null
  let cancelarMudancas = null
  let observadores = []
  let painelAba = null
  let timerDesenho = null
  let timerAtualizar = null

  /** Primeira pasta do workspace com esquema `file`, ou `null`. */
  function raizAtual() {
    const pasta = (vscode.workspace.workspaceFolders ?? []).find(p => p.uri.scheme === 'file')
    return pasta ? pasta.uri.fsPath : null
  }

  /** Tema da webview: `claro` para os temas claros, senão `escuro`. */
  function tema() {
    const tipo = vscode.window.activeColorTheme.kind
    const claro = tipo === vscode.ColorThemeKind.Light || tipo === vscode.ColorThemeKind.HighContrastLight
    return claro ? 'claro' : 'escuro'
  }

  /** Envia uma mensagem a todas as vistas abertas, ignorando falhas. */
  function postarTodas(msg) {
    for (const v of vistas.values()) {
      try {
        Promise.resolve(v.webview.postMessage(msg)).catch(() => {})
      } catch {
        // vista já descartada
      }
    }
  }

  /** Cria (ou reaproveita) o estúdio da pasta atual. */
  async function garantirEstudio() {
    const raiz = raizAtual()
    if (!raiz) return null
    if (estudio && raizDoEstudio === raiz) {
      await iniciando
      return estudio
    }
    descartarEstudio()
    raizDoEstudio = raiz
    estudio = criarEstudio({
      raiz,
      armazenamento: {
        get: k => context.globalState.get(k),
        set: (k, v) => context.globalState.update(k, v),
      },
      abrirNoClaude,
      temVistaAberta: () => [...vistas.values()].some(v => v.visivel),
      aoRolar: () => postarTodas({ tipo: 'rolar' }),
    })
    estudioAtualGlobal = estudio
    cancelarMudancas = estudio.aoMudar(agendarDesenho)
    observar(raiz)
    iniciando = estudio.iniciar().catch(e => log(`erro ao iniciar: ${e?.stack ?? e}`))
    await iniciando
    return estudio
  }

  /** Descarta o estúdio atual e seus observadores de arquivos. */
  function descartarEstudio() {
    cancelarMudancas?.()
    cancelarMudancas = null
    for (const o of observadores) o.dispose()
    observadores = []
    estudio = null
    raizDoEstudio = null
    estudioAtualGlobal = null
  }

  /** Observa os arquivos dos agentes, configurações e estruturas, na pasta e na pasta de config do usuário. */
  function observar(raiz) {
    const home = os.homedir()
    const config = process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude')
    const padroes = [
      [raiz, '.claude/agents/**'],
      [raiz, '.claude/{settings.json,settings.local.json,agents-creator.json}'],
      [raiz, 'CLAUDE.md'],
      [config, 'agents/**'],
      [config, 'agents-creator/estruturas/**'],
      [config, '{settings.json,plugins/installed_plugins.json}'],
    ]
    for (const [base, padrao] of padroes) {
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(base), padrao))
      w.onDidCreate(agendarAtualizar)
      w.onDidChange(agendarAtualizar)
      w.onDidDelete(agendarAtualizar)
      observadores.push(w)
    }
  }

  /** Atualiza o estúdio 400 ms depois da última mudança de arquivo. */
  function agendarAtualizar() {
    clearTimeout(timerAtualizar)
    timerAtualizar = setTimeout(() => {
      Promise.resolve(estudio?.atualizar()).catch(e => log(`erro ao atualizar: ${e?.stack ?? e}`))
    }, 400)
  }

  /** Redesenha todas as vistas 30 ms depois do último pedido. */
  function agendarDesenho() {
    clearTimeout(timerDesenho)
    timerDesenho = setTimeout(() => {
      void desenharTodas()
    }, 30)
  }

  async function desenharTodas() {
    for (const id of [...vistas.keys()]) await desenhar(id)
  }

  /** Manda o HTML atual do estúdio para a vista `id`. */
  async function desenhar(id) {
    try {
      const v = vistas.get(id)
      if (!v || !v.pronto || !v.visivel) return
      const e = await garantirEstudio()
      if (!e) return
      const html = await e.desenhar(id, { colunas: v.colunas, tema: tema() })
      await v.webview.postMessage({ tipo: 'html', html })
    } catch (erro) {
      log(`erro ao desenhar ${id}: ${erro?.stack ?? erro}`)
    }
  }

  /** Configura a webview da vista `id`: opções, HTML e o ouvinte de mensagens. */
  function configurar(id, webview, lugar) {
    const raizExt = context.extensionUri
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(raizExt, 'out'), vscode.Uri.joinPath(raizExt, 'media')],
    }
    const estiloUri = webview.asWebviewUri(vscode.Uri.joinPath(raizExt, 'media', 'estudio.css')).toString()
    vistas.get(id)?.assinatura?.dispose()

    if (!raizAtual()) {
      webview.html = paginaSemPasta({ cspSource: webview.cspSource, estiloUri, lugar })
      vistas.set(id, { webview, lugar, colunas: 50, pronto: false, visivel: true, assinatura: null })
      return
    }

    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(raizExt, 'out', 'webview.js')).toString()
    const assinatura = webview.onDidReceiveMessage(m => void tratar(id, m))
    vistas.set(id, { webview, lugar, colunas: 50, pronto: false, visivel: true, assinatura })
    webview.html = paginaDoEstudio({ cspSource: webview.cspSource, scriptUri, estiloUri, nonce: gerarNonce(), lugar })
  }

  /** Trata uma mensagem vinda da webview `id`. */
  async function tratar(id, msg) {
    const v = vistas.get(id)
    if (!v || !msg || typeof msg !== 'object') return
    try {
      if (msg.tipo === 'pronto' || msg.tipo === 'colunas') {
        v.colunas = Number(msg.colunas) || v.colunas
        v.pronto = true
        await desenhar(id)
      } else if (msg.tipo === 'evento') {
        const e = await garantirEstudio()
        await e?.disparar(id, {
          id: String(msg.id ?? ''),
          acao: String(msg.acao ?? ''),
          valor: msg.valor === undefined ? undefined : String(msg.valor),
        })
      }
    } catch (erro) {
      log(`erro ao tratar mensagem de ${id}: ${erro?.stack ?? erro}`)
    }
  }

  // Barra lateral
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(VISTA, {
    resolveWebviewView(view) {
      configurar('lateral', view.webview, 'lateral')
      view.onDidChangeVisibility(() => {
        const v = vistas.get('lateral')
        if (v) {
          v.visivel = view.visible
          if (view.visible) void desenhar('lateral')
        }
      })
      view.onDidDispose(() => {
        vistas.get('lateral')?.assinatura?.dispose()
        vistas.delete('lateral')
        estudio?.descartar('lateral')
      })
    },
  }, { webviewOptions: { retainContextWhenHidden: true } }))

  /** Abre a aba do editor, ou só revela a que já está aberta. */
  function abrirAba() {
    if (painelAba) {
      painelAba.reveal()
      return
    }
    const raizExt = context.extensionUri
    painelAba = vscode.window.createWebviewPanel(ABA, 'Estúdio de Agentes', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(raizExt, 'out'), vscode.Uri.joinPath(raizExt, 'media')],
    })
    painelAba.iconPath = vscode.Uri.joinPath(raizExt, 'media', 'icone.png')
    configurar('aba', painelAba.webview, 'aba')
    painelAba.onDidChangeViewState(() => {
      const v = vistas.get('aba')
      if (v) {
        v.visivel = painelAba.visible
        if (painelAba.visible) void desenhar('aba')
      }
    })
    painelAba.onDidDispose(() => {
      vistas.get('aba')?.assinatura?.dispose()
      vistas.delete('aba')
      estudio?.descartar('aba')
      painelAba = null
    })
  }

  // Comandos dos botões do título
  context.subscriptions.push(
    vscode.commands.registerCommand('estudioDeAgentes.abrirEmAba', () => abrirAba()),
    vscode.commands.registerCommand('estudioDeAgentes.atualizar', async () => {
      const e = await garantirEstudio()
      await e?.atualizar()
    }),
    vscode.commands.registerCommand('estudioDeAgentes.novo', async () => {
      const e = await garantirEstudio()
      if (!e) {
        vscode.window.showInformationMessage('Abra uma pasta de projeto para criar agentes.')
        return
      }
      await e.abrir('novo')
      if (!vistas.get('lateral')?.visivel) await vscode.commands.executeCommand(`${VISTA}.focus`)
    }),
    vscode.commands.registerCommand('estudioDeAgentes.abrirNoClaude', async () => {
      await abrirNoClaude('/agentes')
    }),
    vscode.commands.registerCommand('estudioDeAgentes.focar', async () => {
      await vscode.commands.executeCommand(`${VISTA}.focus`)
    }),
  )

  // Tema e troca de pasta de projeto
  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme(() => agendarDesenho()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      descartarEstudio()
      for (const [id, v] of [...vistas]) configurar(id, v.webview, v.lugar)
    }),
  )

  context.subscriptions.push({
    dispose: () => {
      clearTimeout(timerDesenho)
      clearTimeout(timerAtualizar)
      descartarEstudio()
    },
  })
}

export function deactivate() {}
