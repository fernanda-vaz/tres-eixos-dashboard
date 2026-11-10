import assert from 'node:assert/strict'
import test from 'node:test'
import { buildHash, pageFromQuery, parseHash } from './hash.ts'

test('parseHash separa seção, id e filtros', () => {
  assert.deepEqual(parseHash('#/pedidos/abc-1?status=ready&page=2'), { path: 'pedidos', id: 'abc-1', query: { status: 'ready', page: '2' } })
  assert.deepEqual(parseHash('#/producao?color='), { path: 'producao', id: null, query: {} })
  assert.deepEqual(parseHash(''), { path: '', id: null, query: {} })
})

test('buildHash omite vazios e a primeira página; parse(build(x)) devolve x', () => {
  assert.equal(buildHash({ path: 'pedidos', query: { status: '', page: 1 } }), '#/pedidos')
  const hash = buildHash({ path: 'pedidos', id: 'abc', query: { status: 'ready', page: 3 } })
  assert.equal(hash, '#/pedidos/abc?status=ready&page=3')
  assert.deepEqual(parseHash(hash), { path: 'pedidos', id: 'abc', query: { status: 'ready', page: '3' } })
})

test('pageFromQuery nunca devolve página inválida', () => {
  assert.equal(pageFromQuery({ page: '4' }), 4)
  assert.equal(pageFromQuery({ page: '0' }), 1)
  assert.equal(pageFromQuery({ page: 'x' }), 1)
  assert.equal(pageFromQuery({}), 1)
})
