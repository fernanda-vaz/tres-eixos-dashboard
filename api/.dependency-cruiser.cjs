// Fitness function de fronteiras (ver docs/arquitetura.md, "Dependências entre módulos").
// Roda no CI: `npm run deps:check`. Toda regra aqui corresponde a uma decisão de arquitetura.
const base = "^src/(db|logger|pagination|sql|grams|pg-errors|retention)\\.ts$|^src/(http|outbox)/"

module.exports = {
  forbidden: [
    {
      name: "sem-ciclos",
      comment: "Módulos não podem depender uns dos outros em ciclo (Acyclic Dependencies Principle).",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "nucleo-nao-conhece-pedidos",
      comment: "Catálogo, estoque, produção, precificação e segurança não importam pedidos, fulfillment, integrações ou dashboard.",
      severity: "error",
      from: { path: "^src/(catalog|inventory|production|pricing|security)/" },
      to: { path: "^src/(orders|fulfillment|integrations|dashboard)/" },
    },
    {
      name: "pedidos-nao-conhece-fulfillment",
      comment: "Pedidos chama o fulfillment pela porta que declara (allocation-port.ts); nunca importa o módulo.",
      severity: "error",
      from: { path: "^src/orders/" },
      to: { path: "^src/(fulfillment|integrations|dashboard)/" },
    },
    {
      name: "catalogo-e-precificacao-sao-folhas",
      comment: "Catálogo, precificação e segurança não dependem de estoque nem de produção.",
      severity: "error",
      from: { path: "^src/(catalog|pricing|security)/" },
      to: { path: "^src/(inventory|production)/" },
    },
    {
      name: "repositorio-nao-conhece-http",
      comment: "Repositórios só sabem SQL: nada de erros HTTP ou validação de entrada.",
      severity: "error",
      from: { path: "-repository\\.ts$" },
      to: { path: "^src/http/" },
    },
    {
      name: "ninguem-importa-app",
      comment: "app.ts é a composição; só server.ts (e os testes) o importam.",
      severity: "error",
      from: { pathNot: "^src/server\\.ts$" },
      to: { path: "^src/app\\.ts$" },
    },
    {
      name: "infra-nao-conhece-dominio",
      comment: "db, http, outbox e afins não importam módulos de negócio.",
      severity: "error",
      from: { path: base, pathNot: "^src/outbox/routes\\.ts$" },
      to: { path: "^src/(catalog|inventory|production|orders|fulfillment|integrations|pricing|dashboard|security)/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    reporterOptions: { text: { highlightFocused: true } },
  },
}
