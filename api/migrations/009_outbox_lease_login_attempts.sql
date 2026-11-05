-- Outbox: cada aluguel ganha um identificador. Só quem alugou pode marcar o evento como
-- publicado ou reagendá-lo; um worker com aluguel vencido não sobrescreve o trabalho de outro.
ALTER TABLE outbox ADD COLUMN lease_id uuid;
-- Sequência de gravação: eventos da mesma transação têm o mesmo created_at, então a ordem
-- real (ex.: "criado" antes de "status alterado") vem de um contador crescente.
ALTER TABLE outbox ADD COLUMN seq bigint GENERATED ALWAYS AS IDENTITY;
-- Ordem por agregado: o worker procura o evento pendente anterior do mesmo pedido.
CREATE INDEX outbox_pending_by_aggregate_idx ON outbox(aggregate_id, seq) WHERE published_at IS NULL;

-- Limite de login: passa a contar TENTATIVAS de forma atômica (antes de conferir a senha),
-- para que requisições paralelas não passem todas pela checagem antes de alguma falha contar.
ALTER TABLE login_attempts RENAME COLUMN failures TO attempts;
ALTER TABLE login_attempts RENAME CONSTRAINT login_attempts_failures_check TO login_attempts_attempts_check;
