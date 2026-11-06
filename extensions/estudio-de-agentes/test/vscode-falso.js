// Um `vscode` mínimo para os testes: registra o que a extensão pede, para inspeção.
import path from 'node:path'

export const registro = {
  provedores: new Map(),
  comandos: new Map(),
  executados: [],
  paineis: [],
  observadores: [],
  avisos: [],
  area: '',
}

/** Limpa o registro entre os testes. */
export function reiniciar() {
  registro.provedores.clear()
  registro.comandos.clear()
  registro.executados.length = 0
  registro.paineis.length = 0
  registro.observadores.length = 0
  registro.avisos.length = 0
  registro.area = ''
}

export const Uri = {
  file: p => ({ scheme: 'file', fsPath: p, path: p, toString: () => 'file:///' + p }),
  joinPath: (u, ...partes) => Uri.file(path.join(u.fsPath, ...partes)),
  parse: s => ({ toString: () => s }),
}

export class RelativePattern {
  constructor(base, pattern) {
    this.base = base
    this.pattern = pattern
  }
}

export const ColorThemeKind = { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 }
export const ViewColumn = { Active: -1, Beside: -2, One: 1 }

/** Webview falsa: guarda o HTML, o que foi postado e permite simular mensagens vindas dela. */
export function criarWebviewFalsa() {
  const w = {
    options: {},
    html: '',
    cspSource: 'vscode-webview://falso',
    postados: [],
    ouvintes: [],
    asWebviewUri: u => ({ toString: () => 'webview:' + u.fsPath }),
    postMessage: async m => {
      w.postados.push(m)
      return true
    },
    onDidReceiveMessage: f => {
      w.ouvintes.push(f)
      return {
        dispose() {
          w.ouvintes = w.ouvintes.filter(x => x !== f)
        },
      }
    },
    enviar: async m => {
      for (const f of w.ouvintes) await f(m)
    },
  }
  return w
}

/** Vista falsa (WebviewView): tem webview, visibilidade e eventos. */
export function criarVistaFalsa() {
  return {
    webview: criarWebviewFalsa(),
    visible: true,
    onDidChangeVisibility: () => ({ dispose() {} }),
    onDidDispose: () => ({ dispose() {} }),
  }
}

export const window = {
  activeColorTheme: { kind: 2 },
  createOutputChannel: () => ({ appendLine() {}, dispose() {} }),
  registerWebviewViewProvider: (id, provedor, opcoes) => {
    registro.provedores.set(id, { provedor, opcoes })
    return { dispose() {} }
  },
  createWebviewPanel: (tipo, titulo, coluna, opcoes) => {
    const p = {
      tipo,
      titulo,
      opcoes,
      webview: criarWebviewFalsa(),
      visible: true,
      iconPath: null,
      reveal() {
        p.revelado = true
      },
      onDidChangeViewState: () => ({ dispose() {} }),
      onDidDispose: () => ({ dispose() {} }),
    }
    registro.paineis.push(p)
    return p
  },
  onDidChangeActiveColorTheme: () => ({ dispose() {} }),
  showInformationMessage: async t => {
    registro.avisos.push(t)
  },
  showWarningMessage: async t => {
    registro.avisos.push(t)
  },
  showErrorMessage: async t => {
    registro.avisos.push(t)
  },
}

export const workspace = {
  workspaceFolders: [],
  createFileSystemWatcher: p => {
    const o = {
      padrao: p,
      onDidCreate() {},
      onDidChange() {},
      onDidDelete() {},
      dispose() {
        o.descartado = true
      },
    }
    registro.observadores.push(o)
    return o
  },
  onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
}

export const commands = {
  registerCommand: (id, fn) => {
    registro.comandos.set(id, fn)
    return { dispose() {} }
  },
  executeCommand: async (id, ...args) => {
    registro.executados.push([id, ...args])
    const fn = registro.comandos.get(id)
    return fn ? fn(...args) : undefined
  },
  getCommands: async () => [...registro.comandos.keys()],
}

export const env = {
  uriScheme: 'vscode',
  clipboard: {
    writeText: async t => {
      registro.area = t
    },
  },
  openExternal: async () => true,
}

export const extensions = { getExtension: () => undefined }
