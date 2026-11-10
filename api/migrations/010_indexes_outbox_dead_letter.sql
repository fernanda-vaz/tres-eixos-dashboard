-- Produção em aberto por produto: usado pela listagem de estoque (soma por linha) e pelo cálculo
-- de falta na alocação. Até aqui só existia índice por status, que não ajuda a filtrar por produto.
CREATE INDEX production_jobs_product_open_idx ON production_jobs(product_id) WHERE status IN ('queued', 'printing');

-- Outbox: o tipo do agregado passa a ser explícito (antes um consumidor tinha de inferir pelo tópico)
-- e eventos que esgotam as tentativas vão para a "dead-letter" (dead_at) em vez de serem reagendados
-- para sempre. Um evento morto continua bloqueando os seguintes do mesmo agregado, de propósito:
-- a ordem é preservada e a loja decide (GET /outbox/dead, POST /outbox/:id/retry).
ALTER TABLE outbox ADD COLUMN aggregate_type varchar(40);
UPDATE outbox SET aggregate_type = CASE WHEN topic LIKE 'order.%' THEN 'order' ELSE 'production_job' END;
ALTER TABLE outbox ALTER COLUMN aggregate_type SET NOT NULL;
ALTER TABLE outbox ADD CONSTRAINT outbox_aggregate_type_check CHECK (aggregate_type IN ('order', 'production_job'));
ALTER TABLE outbox ADD COLUMN dead_at timestamptz;
CREATE INDEX outbox_dead_idx ON outbox(dead_at) WHERE dead_at IS NOT NULL;
