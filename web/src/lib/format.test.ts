import assert from 'node:assert/strict'
import test from 'node:test'
import { daysUntil, initials } from './format.ts'

test('iniciais ignoram pontuação', () => {
  assert.equal(initials('Fernanda (teste)'), 'FT')
  assert.equal(initials('Ana'), 'A')
  assert.equal(initials('***'), '?')
})

test('dias até o prazo: negativo quando atrasado, null sem prazo', () => {
  const now = new Date('2026-11-04T12:00:00Z')
  assert.equal(daysUntil('2026-11-06T12:00:00Z', now), 2)
  assert.equal(daysUntil('2026-11-02T12:00:00Z', now), -2)
  assert.equal(daysUntil(null, now), null)
})
