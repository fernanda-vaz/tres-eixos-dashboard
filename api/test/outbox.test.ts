import assert from "node:assert/strict"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import test from "node:test"
import { signWebhook, WebhookPublisher } from "../src/outbox/publishers.js"
import { retryDelaySeconds } from "../src/outbox/retry-policy.js"
import { needsRehash } from "../src/security/password.js"

test("backoff do outbox cresce até 15 minutos", () => {
  assert.equal(retryDelaySeconds(1), 2)
  assert.equal(retryDelaySeconds(3), 8)
  assert.equal(retryDelaySeconds(20), 900)
})

test("webhook assinado: HMAC do timestamp e do corpo, verificável pelo receptor", async () => {
  const received: { headers: Record<string, string | string[] | undefined>; body: string }[] = []
  const server = createServer((req, res) => {
    let body = ""
    req.on("data", (chunk) => (body += chunk))
    req.on("end", () => {
      received.push({ headers: req.headers, body })
      res.statusCode = received.length === 1 ? 200 : 500
      res.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address() as AddressInfo
  try {
    const publisher = new WebhookPublisher(`http://127.0.0.1:${port}/eventos`, "segredo-compartilhado", 1000)
    const event = { id: "evt-1", topic: "order.created", aggregateType: "order", aggregateId: "o-1", payload: { a: 1 }, createdAt: new Date(0), attempts: 0 }
    await publisher.publish(event)
    const [first] = received
    const timestamp = first.headers["x-signature-timestamp"] as string
    assert.match(timestamp, /^\d+$/)
    assert.equal(first.headers["x-signature-256"], signWebhook("segredo-compartilhado", timestamp, first.body))
    assert.notEqual(first.headers["x-signature-256"], signWebhook("outro-segredo", timestamp, first.body))
    assert.equal(first.headers["idempotency-key"], "evt-1")
    assert.equal(JSON.parse(first.body).aggregateType, "order")
    await assert.rejects(publisher.publish(event), /Webhook respondeu 500/)
  } finally {
    server.close()
  }
})

test("senha: hash com parâmetros antigos pede rehash", () => {
  assert.equal(needsRehash("scrypt$16384$8$1$c2FsdA==$aGFzaA=="), true)
  assert.equal(needsRehash("scrypt$32768$8$3$c2FsdA==$aGFzaA=="), false)
  assert.equal(needsRehash("formato-invalido"), true)
})
