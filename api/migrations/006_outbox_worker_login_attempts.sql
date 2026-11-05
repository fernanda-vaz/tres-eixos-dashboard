-- Worker do outbox: cada evento é "alugado" por um worker (locked_until) e publicado FORA de
-- transação; falhas reagendam com espera crescente (next_attempt_at).
ALTER TABLE outbox ADD COLUMN locked_until timestamptz;
ALTER TABLE outbox ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE outbox ADD COLUMN last_error varchar(500);

DROP INDEX outbox_unpublished_idx;
CREATE INDEX outbox_pending_idx ON outbox(next_attempt_at, created_at) WHERE published_at IS NULL;

-- Limite de tentativas de login persistente: vale entre reinícios e entre várias instâncias.
-- key_hash = sha256 de "ip" ou "ip|email": não guardamos e-mail nem IP em texto.
CREATE TABLE login_attempts (
    key_hash char(64) PRIMARY KEY,
    failures integer NOT NULL CHECK (failures > 0),
    window_started_at timestamptz NOT NULL
);
CREATE INDEX login_attempts_window_idx ON login_attempts(window_started_at);
