import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ESTADO, atom, criarEstado, read, update } from '../src/runtime/atomos.js'

const ref = { plugin: 'p', key: 'k' }

test('atom devolve objeto congelado com ref, initial e shape quando passado', () => {
  const a = atom(ref, 1)
  assert.ok(Object.isFrozen(a))
  assert.ok(Object.isFrozen(a.ref))
  assert.deepEqual(a.ref, { plugin: 'p', key: 'k' })
  assert.equal(a.initial, 1)
  assert.equal('shape' in a, false)

  const b = atom(ref, 1, { shape: 'forma' })
  assert.equal(b.shape, 'forma')
})

test('read devolve o initial enquanto nada foi gravado; update grava e read lê o novo', async () => {
  const $ = { [ESTADO]: criarEstado() }
  const a = atom(ref, { n: 1 })
  assert.deepEqual(await read($, a), { n: 1 })

  const novo = await update($, a, (atual) => ({ n: atual.n + 1 }))
  assert.deepEqual(novo, { n: 2 })
  assert.deepEqual(await read($, a), { n: 2 })
})

test('update aceita função assíncrona', async () => {
  const $ = { [ESTADO]: criarEstado() }
  const a = atom(ref, 'a')
  const devolvido = await update($, a, async (atual) => {
    await new Promise((r) => setTimeout(r, 1))
    return atual + 'b'
  })
  assert.equal(devolvido, 'ab')
  assert.equal(await read($, a), 'ab')
})

test('cópia: mudar o objeto lido não muda o estado', async () => {
  const $ = { [ESTADO]: criarEstado() }
  const a = atom(ref, { lista: [1] })
  const lido = await read($, a)
  lido.lista.push(2)
  assert.deepEqual(await read($, a), { lista: [1] })

  await update($, a, () => ({ lista: [5] }))
  const depois = await read($, a)
  depois.lista.push(6)
  assert.deepEqual(await read($, a), { lista: [5] })
})

test('aoMudar dispara 1 vez por mudança, não dispara com valor igual e a função devolvida cancela', () => {
  const e = criarEstado()
  const a = atom(ref, 0)
  let n = 0
  const cancelar = e.aoMudar(() => {
    n += 1
  })

  e.escrever(a, 1)
  assert.equal(n, 1)
  e.escrever(a, 1)
  assert.equal(n, 1)
  e.escrever(a, 2)
  assert.equal(n, 2)

  cancelar()
  e.escrever(a, 3)
  assert.equal(n, 2)
})

test('versao cresce só quando muda; valor(plugin, key) é undefined antes e cópia depois', () => {
  const e = criarEstado()
  const a = atom(ref, 0)
  assert.equal(e.versao, 0)
  assert.equal(e.valor('p', 'k'), undefined)

  e.escrever(a, { x: 1 })
  assert.equal(e.versao, 1)
  e.escrever(a, { x: 1 })
  assert.equal(e.versao, 1)

  const v = e.valor('p', 'k')
  assert.deepEqual(v, { x: 1 })
  v.x = 9
  assert.deepEqual(e.valor('p', 'k'), { x: 1 })
})

test('read sem ESTADO rejeita com "estado ausente"', async () => {
  const a = atom(ref, 1)
  await assert.rejects(read({}, a), /estado ausente/)
  await assert.rejects(update({}, a, (x) => x), /estado ausente/)
})
