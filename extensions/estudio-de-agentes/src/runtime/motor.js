// Motor: implementa o `$` do Claude Code com Node, para o painel do plugin rodar no host do VS Code.
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { ESTADO, criarEstado } from './atomos.js'
import { TABELA } from './jsx.js'

const PREFIXO_STORE = 'agents-creator/'
const LIMITE_SAIDA = 4194304
const TEMPO_PADRAO = 30000
const TEMPO_MAXIMO = 600000

/**
 * Cria o `$` falso do painel.
 * @param {{ raiz: string, armazenamento: { get: Function, set: Function }, abrirNoClaude: Function,
 *   handoff: object, aoHandoff?: Function, aoRolar?: Function, temVistaAberta?: Function, env?: object }} opcoes
 * @returns {{ $: object, estado: object, pendentes: () => number }}
 */
export function criarMotor(opcoes) {
  const estado = criarEstado()
  let pendentesAgora = 0

  // Conta operações assíncronas em andamento (para `pendentes()`).
  async function contar(fn) {
    pendentesAgora++
    try {
      return await fn()
    } finally {
      pendentesAgora--
    }
  }

  // Lê uma variável de ambiente. Com `opcoes.env` no Windows, ignora maiúsculas/minúsculas.
  function lerEnv(nome) {
    const fonte = opcoes.env ?? process.env
    if (opcoes.env && process.platform === 'win32') {
      const chave = Object.keys(fonte).find(k => k.toUpperCase() === String(nome).toUpperCase())
      return chave === undefined ? undefined : fonte[chave]
    }
    return fonte[nome]
  }

  // Pasta de configuração do Claude Code (`~/.claude` ou CLAUDE_CONFIG_DIR).
  function pastaConfig() {
    const configurada = lerEnv('CLAUDE_CONFIG_DIR')
    if (configurada) return configurada
    const home = process.platform === 'win32'
      ? (lerEnv('USERPROFILE') || lerEnv('HOME'))
      : (lerEnv('HOME') || lerEnv('USERPROFILE'))
    return path.join(home || os.homedir(), '.claude')
  }

  function tipoDe(st) {
    if (st.isSymbolicLink()) return 'other'
    if (st.isDirectory()) return 'dir'
    if (st.isFile()) return 'file'
    return 'other'
  }

  function agendarHandoff(tipo) {
    setTimeout(() => opcoes.aoHandoff?.(tipo), 0)
  }

  async function lerJson(caminho) {
    try {
      const valor = JSON.parse(await fs.readFile(caminho, 'utf8'))
      return valor !== null && typeof valor === 'object' && !Array.isArray(valor) ? valor : {}
    } catch {
      return {}
    }
  }

  function ehObjeto(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v)
  }

  // Mescla de configurações: arrays concatenam, objetos mesclam recursivamente, o resto vale o de `b`.
  function mesclar(a, b) {
    const resultado = { ...a }
    for (const chave of Object.keys(b)) {
      if (chave === '__proto__') continue
      const x = a[chave]
      const y = b[chave]
      if (Array.isArray(x) && Array.isArray(y)) resultado[chave] = [...x, ...y]
      else if (ehObjeto(x) && ehObjeto(y)) resultado[chave] = mesclar(x, y)
      else resultado[chave] = y
    }
    return resultado
  }

  // Verdadeiro se o plugin agents-creator está instalado no Claude Code.
  async function pluginInstalado() {
    try {
      const json = JSON.parse(await fs.readFile(path.join(pastaConfig(), 'plugins', 'installed_plugins.json'), 'utf8'))
      const plugins = json?.plugins
      if (!plugins || typeof plugins !== 'object') return false
      return Object.keys(plugins).some(chave => chave.startsWith('agents-creator@'))
    } catch {
      return false
    }
  }

  // Coleta a saída de um processo até o limite; o excedente é descartado e marcado.
  function coletor() {
    return { partes: [], tamanho: 0, truncado: false }
  }

  function acumular(c, bloco) {
    const falta = LIMITE_SAIDA - c.tamanho
    if (falta <= 0) {
      c.truncado = true
      return
    }
    if (bloco.length > falta) {
      c.partes.push(bloco.subarray(0, falta))
      c.tamanho += falta
      c.truncado = true
    } else {
      c.partes.push(bloco)
      c.tamanho += bloco.length
    }
  }

  function executar(argv, init) {
    if (!Array.isArray(argv) || argv.length === 0 || !argv.every(a => typeof a === 'string')) {
      return Promise.reject(new Error('process.run: argv inválido'))
    }
    return new Promise((resolve, reject) => {
      const child = spawn(argv[0], argv.slice(1), {
        cwd: init.cwd ?? opcoes.raiz,
        env: { ...process.env, ...(init.env ?? {}) },
        windowsHide: true,
        shell: false,
      })
      const saidaOut = coletor()
      const saidaErr = coletor()
      const tempo = Math.min(init.timeoutMs ?? TEMPO_PADRAO, TEMPO_MAXIMO)
      let encerrado = false

      const relogio = setTimeout(() => {
        if (encerrado) return
        encerrado = true
        child.kill()
        reject(new Error(`tempo esgotado: ${argv[0]}`))
      }, tempo)

      child.stdout.on('data', bloco => acumular(saidaOut, bloco))
      child.stderr.on('data', bloco => acumular(saidaErr, bloco))
      child.stdin.on('error', () => {})
      child.on('error', erro => {
        if (encerrado) return
        encerrado = true
        clearTimeout(relogio)
        reject(new Error(`não foi possível iniciar ${argv[0]}: ${erro.message}`))
      })
      child.on('close', code => {
        if (encerrado) return
        encerrado = true
        clearTimeout(relogio)
        resolve({
          exitCode: code ?? 1,
          stdout: Buffer.concat(saidaOut.partes).toString('utf8'),
          stderr: Buffer.concat(saidaErr.partes).toString('utf8'),
          isStdoutTruncated: saidaOut.truncado,
          isStderrTruncated: saidaErr.truncado,
        })
      })

      if (typeof init.stdin === 'string') child.stdin.end(init.stdin)
      else child.stdin.end()
    })
  }

  const fsMotor = {
    read: p => contar(() => fs.readFile(p, 'utf8')),

    write: (p, texto) => contar(async () => {
      await fs.mkdir(path.dirname(p), { recursive: true })
      await fs.writeFile(p, texto, 'utf8')
    }),

    exists: p => contar(async () => {
      try {
        await fs.access(p)
        return true
      } catch {
        return false
      }
    }),

    list: (p = opcoes.raiz) => contar(async () => {
      const entradas = await fs.readdir(p, { withFileTypes: true })
      const itens = []
      for (const entrada of entradas) {
        const st = await fs.lstat(path.join(p, entrada.name))
        itens.push({
          name: entrada.name,
          kind: tipoDe(st),
          size: st.size,
          mtimeMs: st.mtimeMs,
          isLink: st.isSymbolicLink(),
        })
      }
      return itens
    }),

    stat: p => contar(async () => {
      const l = await fs.lstat(p)
      let s = l
      try {
        s = await fs.stat(p)
      } catch {
        s = l
      }
      const resultado = {
        kind: tipoDe(s),
        size: s.size,
        mtimeMs: s.mtimeMs,
        isLink: l.isSymbolicLink(),
      }
      try {
        resultado.realPath = await fs.realpath(p)
      } catch {
        // caminho real indisponível: omitido
      }
      return resultado
    }),
  }

  const settings = {
    read: args => contar(async () => {
      const fontes = new Map([
        ['user', path.join(pastaConfig(), 'settings.json')],
        ['project', path.join(opcoes.raiz, '.claude', 'settings.json')],
        ['local', path.join(opcoes.raiz, '.claude', 'settings.local.json')],
      ])
      if (args?.source) {
        return fontes.has(args.source) ? lerJson(fontes.get(args.source)) : {}
      }
      let mesclado = {}
      for (const caminho of ['user', 'project', 'local'].map(f => fontes.get(f))) {
        mesclado = mesclar(mesclado, await lerJson(caminho))
      }
      if (args?.key !== undefined) return mesclado[args.key]
      return mesclado
    }),
  }

  const processo = {
    run: (argv, init = {}) => contar(() => executar(argv, init)),
    spawn: () => Promise.reject(new Error('$.process.spawn não existe no VS Code')),
  }

  const modelo = {
    complete: pedido => contar(async () => {
      const sistema = typeof pedido?.system === 'string'
        ? pedido.system
        : Array.isArray(pedido?.system)
          ? pedido.system.map(b => b?.text).filter(t => typeof t === 'string').join('\n')
          : ''
      const tipo = opcoes.handoff.tipoDoPedido(sistema)
      if (tipo === 'gerar') {
        const gen = estado.valor('agents-creator', 'gen')
        await opcoes.abrirNoClaude(opcoes.handoff.textoGerar(String(gen?.request ?? ''), await pluginInstalado()))
        agendarHandoff('gerar')
      } else if (tipo === 'melhorar') {
        const draft = estado.valor('agents-creator', 'draft')
        await opcoes.abrirNoClaude(opcoes.handoff.textoMelhorar(draft?.fields, String(draft?.originPath ?? '')))
        agendarHandoff('melhorar')
      }
      return { isAnswered: false, reason: 'empty-reply', usage: { input_tokens: 0, output_tokens: 0 } }
    }),
    fork: () => Promise.reject(new Error('$.model.fork não existe no VS Code')),
    classify: () => Promise.reject(new Error('$.model.classify não existe no VS Code')),
  }

  const registrados = []

  const agente = {
    register: spec => {
      registrados.push(spec)
      return {}
    },
    list: () => [],
    spawn: pedido => contar(async () => {
      const nome = String(pedido?.subagentType ?? '').replace(/^agents-creator:/, '')
      await opcoes.abrirNoClaude(opcoes.handoff.textoTestar(nome, String(pedido?.prompt ?? '')))
      agendarHandoff('testar')
      return { model: '' }
    }),
  }

  const base = {
    env: {
      get: nome => lerEnv(nome),
      set: () => {
        throw new Error('$.env.set não existe no VS Code')
      },
    },
    session: {
      root: () => opcoes.raiz,
      cwd: () => opcoes.raiz,
      model: () => '',
      id: () => 'vscode',
      surface: () => 'vscode',
      surfaces: () => ['vscode'],
    },
    clock: {
      now: () => Date.now(),
      sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
      after: (ms, fn) => {
        const t = setTimeout(() => {
          try {
            fn()
          } catch {
            // erro do callback não derruba a extensão
          }
        }, ms)
        return { cancel: () => clearTimeout(t) }
      },
      every: (ms, fn) => {
        const t = setInterval(() => {
          try {
            fn()
          } catch {
            // erro do callback não derruba a extensão
          }
        }, ms)
        return { cancel: () => clearInterval(t) }
      },
    },
    fs: fsMotor,
    store: {
      get: k => contar(async () => opcoes.armazenamento.get(PREFIXO_STORE + k)),
      set: (k, v) => contar(async () => {
        await opcoes.armazenamento.set(PREFIXO_STORE + k, v)
      }),
      delete: k => contar(async () => {
        await opcoes.armazenamento.set(PREFIXO_STORE + k, undefined)
      }),
      keys: async () => [],
    },
    process: processo,
    settings,
    ui: {
      resolve: () => TABELA,
      open: async () => ({ isPlaced: true }),
      close: async () => undefined,
      panes: async () => opcoes.temVistaAberta?.()
        ? [{ id: 'agentes', title: 'Agentes', isShown: true, isFocused: false, isPlaced: true }]
        : [],
      scroll: async () => {
        opcoes.aoRolar?.()
        return {}
      },
      focus: async () => ({}),
      toast: async () => {},
      status: async () => {},
      log: async () => {},
      notice: async () => {},
      invalidate: async () => {},
      notify: async () => ({}),
      ask: async () => {
        throw new Error('$.ui.ask não existe no VS Code')
      },
    },
    model: modelo,
    agent: agente,
    tool: {
      list: () => [],
      register: () => ({}),
    },
    command: {
      list: () => [],
      register: () => ({}),
    },
  }

  base[ESTADO] = estado

  const $ = new Proxy(base, {
    get(alvo, chave) {
      if (chave in alvo) return alvo[chave]
      if (typeof chave === 'symbol' || chave === 'then') return undefined
      return new Proxy({}, {
        get(_, metodo) {
          if (metodo === 'then' || typeof metodo === 'symbol') return undefined
          return async () => {
            throw new Error(`$.${String(chave)}.${String(metodo)} não existe no VS Code`)
          }
        },
      })
    },
  })

  return { $, estado, pendentes: () => pendentesAgora }
}
