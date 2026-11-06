import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { criarMotor } from '../src/runtime/motor.js'
import { ESTADO, atom } from '../src/runtime/atomos.js'

// Cria um projeto temporário, um motor e os ganchos de teste.
function preparar(extras = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'estudio-'))
  const raiz = path.join(tmp, 'projeto')
  const home = path.join(tmp, 'home')
  fs.mkdirSync(raiz, { recursive: true })
  fs.mkdirSync(home, { recursive: true })
  const m = new Map()
  const armazenamento = {
    get: k => m.get(k),
    set: (k, v) => {
      m.set(k, v)
    },
  }
  const claude = []
  const aoHandoffs = []
  const handoff = {
    tipoDoPedido: s => (s === 'G' ? 'gerar' : s === 'M' ? 'melhorar' : null),
    textoGerar: (p, c) => `G:${p}:${c}`,
    textoMelhorar: (f, c) => `M:${f?.name}:${c}`,
    textoTestar: (n, t) => `T:${n}:${t}`,
  }
  const motor = criarMotor({
    raiz,
    env: { HOME: home, USERPROFILE: home },
    armazenamento,
    abrirNoClaude: async texto => {
      claude.push(texto)
    },
    handoff,
    aoHandoff: tipo => aoHandoffs.push(tipo),
    ...extras,
  })
  return {
    tmp,
    raiz,
    home,
    m,
    claude,
    aoHandoffs,
    motor,
    $: motor.$,
    estado: motor.estado,
    limpar: () => fs.rmSync(tmp, { recursive: true, force: true }),
  }
}

// Espera uma volta do event loop (para os handoffs agendados com setTimeout).
const umTick = () => new Promise(resolve => setTimeout(resolve, 10))

test('fs: write cria pastas, read, exists, list e stat', async () => {
  const p = preparar()
  try {
    const { $, raiz } = p
    const arq = path.join(raiz, 'a', 'b', 'x.txt')
    await $.fs.write(arq, 'oi')
    assert.equal(await $.fs.read(arq), 'oi')
    assert.equal(await $.fs.exists(arq), true)
    assert.equal(await $.fs.exists(path.join(raiz, 'nada')), false)

    const pasta = await $.fs.list(path.join(raiz, 'a'))
    assert.deepEqual(pasta.map(i => [i.name, i.kind]), [['b', 'dir']])

    const dentro = await $.fs.list(path.join(raiz, 'a', 'b'))
    const item = dentro.find(i => i.name === 'x.txt')
    assert.equal(item.kind, 'file')
    assert.equal(item.size, 2)
    assert.equal(typeof item.mtimeMs, 'number')
    assert.equal(item.isLink, false)

    const st = await $.fs.stat(arq)
    assert.equal(st.kind, 'file')
    assert.equal(st.size, 2)
    assert.equal(st.isLink, false)
    assert.equal(typeof st.realPath, 'string')

    const stDir = await $.fs.stat(path.join(raiz, 'a'))
    assert.equal(stDir.kind, 'dir')
  } finally {
    p.limpar()
  }
})

test('process.run: saída, código de saída, erro de início, tempo esgotado e env', async () => {
  const p = preparar()
  try {
    const { $ } = p
    const ok = await $.process.run([process.execPath, '-e', "process.stdout.write('oi')"])
    assert.equal(ok.exitCode, 0)
    assert.equal(ok.stdout, 'oi')

    const codigo = await $.process.run([process.execPath, '-e', 'process.exit(3)'])
    assert.equal(codigo.exitCode, 3)

    await assert.rejects($.process.run(['comando-que-nao-existe-estudio-xyz']), /não foi possível iniciar/)
    await assert.rejects(
      $.process.run([process.execPath, '-e', 'setTimeout(() => {}, 5000)'], { timeoutMs: 300 }),
      /tempo esgotado/,
    )

    const comEnv = await $.process.run(
      [process.execPath, '-e', 'process.stdout.write(process.env.ESTUDIO_TESTE)'],
      { env: { ESTUDIO_TESTE: 'valor' } },
    )
    assert.equal(comEnv.stdout, 'valor')

    await assert.rejects($.process.run([]), /argv inválido/)
  } finally {
    p.limpar()
  }
})

test('settings.read mescla user, project e local', async () => {
  const p = preparar()
  try {
    const { $, raiz, home } = p
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ a: 1, obj: { x: 1 }, lista: [1] }))
    fs.mkdirSync(path.join(raiz, '.claude'), { recursive: true })
    fs.writeFileSync(path.join(raiz, '.claude', 'settings.json'), JSON.stringify({ a: 2, obj: { y: 2 }, lista: [2] }))
    fs.writeFileSync(path.join(raiz, '.claude', 'settings.local.json'), JSON.stringify({ b: 3 }))

    assert.equal(await $.settings.read({ key: 'a' }), 2)
    assert.deepEqual(await $.settings.read({ key: 'obj' }), { x: 1, y: 2 })
    assert.deepEqual(await $.settings.read({ key: 'lista' }), [1, 2])
    assert.deepEqual(await $.settings.read({ source: 'local' }), { b: 3 })
    assert.equal(await $.settings.read({ key: 'nada' }), undefined)
  } finally {
    p.limpar()
  }
})

test('store.set grava com prefixo e store.get lê de volta', async () => {
  const p = preparar()
  try {
    await p.$.store.set('x', 1)
    assert.equal(p.m.get('agents-creator/x'), 1)
    assert.equal(await p.$.store.get('x'), 1)
  } finally {
    p.limpar()
  }
})

test('model.complete gerar abre o Claude com o pedido e agenda o handoff', async () => {
  const p = preparar()
  try {
    const { $, estado, claude, aoHandoffs, home } = p
    estado.escrever(atom({ plugin: 'agents-creator', key: 'gen' }, {}), { request: 'um revisor' })

    const resposta = await $.model.complete({ system: 'G', prompt: 'p' })
    assert.equal(claude[0], 'G:um revisor:false')
    assert.equal(resposta.isAnswered, false)
    await umTick()
    assert.deepEqual(aoHandoffs, ['gerar'])

    fs.mkdirSync(path.join(home, '.claude', 'plugins'), { recursive: true })
    fs.writeFileSync(
      path.join(home, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({ plugins: { 'agents-creator@x': [{}] } }),
    )
    await $.model.complete({ system: 'G', prompt: 'p' })
    assert.equal(claude[1], 'G:um revisor:true')
  } finally {
    p.limpar()
  }
})

test('model.complete melhorar usa o rascunho; outro pedido não abre nada', async () => {
  const p = preparar()
  try {
    const { $, estado, claude } = p
    estado.escrever(atom({ plugin: 'agents-creator', key: 'draft' }, {}), {
      fields: { name: 'a' },
      originPath: '/p/a.md',
    })
    await $.model.complete({ system: 'M' })
    assert.equal(claude[0], 'M:a:/p/a.md')

    const antes = claude.length
    await $.model.complete({ system: 'outro' })
    assert.equal(claude.length, antes)
  } finally {
    p.limpar()
  }
})

test('agent.spawn abre o teste com o nome sem o prefixo', async () => {
  const p = preparar()
  try {
    const { $, claude, aoHandoffs } = p
    const resultado = await $.agent.spawn({ subagentType: 'agents-creator:x', prompt: 'faça' })
    assert.equal(resultado.deny, undefined)
    assert.equal(claude[0], 'T:x:faça')
    await umTick()
    assert.deepEqual(aoHandoffs, ['testar'])
  } finally {
    p.limpar()
  }
})

test('ui: panes depende de temVistaAberta, scroll chama aoRolar, open e resolve', async () => {
  const vista = { aberta: false }
  let rolou = 0
  const p = preparar({
    temVistaAberta: () => vista.aberta,
    aoRolar: () => {
      rolou++
    },
  })
  try {
    const { $ } = p
    assert.deepEqual(await $.ui.panes(), [])
    vista.aberta = true
    const painéis = await $.ui.panes()
    assert.equal(painéis[0].id, 'agentes')
    await $.ui.scroll({ to: 'start' })
    assert.equal(rolou, 1)
    assert.deepEqual(await $.ui.open(), { isPlaced: true })
    assert.ok($.ui.resolve().Box)
  } finally {
    p.limpar()
  }
})

test('$ desconhecido rejeita; then é undefined; ESTADO aponta para o estado', async () => {
  const p = preparar()
  try {
    const { $, estado } = p
    await assert.rejects($.http.fetch('x'), /não existe no VS Code/)
    assert.equal($.then, undefined)
    assert.equal($[ESTADO], estado)
  } finally {
    p.limpar()
  }
})

test('pendentes conta process.run em andamento', async () => {
  const p = preparar()
  try {
    const op = p.motor.$.process.run([process.execPath, '-e', 'process.stdout.write("ok")'])
    assert.ok(p.motor.pendentes() > 0)
    await op
    assert.equal(p.motor.pendentes(), 0)
  } finally {
    p.limpar()
  }
})

test('clock.after chama fn; cancel antes do prazo impede a chamada', async () => {
  const p = preparar()
  try {
    const { $ } = p
    let chamou = 0
    await new Promise(resolve => {
      $.clock.after(10, () => {
        chamou++
        resolve()
      })
    })
    assert.equal(chamou, 1)

    let depois = 0
    const t = $.clock.after(10, () => {
      depois++
    })
    t.cancel()
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(depois, 0)
  } finally {
    p.limpar()
  }
})
