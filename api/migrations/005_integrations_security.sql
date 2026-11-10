-- Eventos recebidos de provedores. A chave única descarta entregas repetidas do mesmo evento.
CREATE TABLE integration_events (
    id uuid PRIMARY KEY,
    channel_id uuid NOT NULL REFERENCES sales_channels(id) ON DELETE RESTRICT,
    event_id varchar(200) NOT NULL,
    event_type varchar(60) NOT NULL,
    -- Payload mínimo: identificadores e status, sem dados pessoais do comprador.
    payload jsonb NOT NULL,
    status varchar(20) NOT NULL CHECK (status IN ('pending', 'processed', 'failed', 'ignored')),
    attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error varchar(500),
    received_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    CONSTRAINT integration_events_unique UNIQUE (channel_id, event_id)
);
CREATE INDEX integration_events_failed_idx ON integration_events(received_at) WHERE status = 'failed';

-- Ponto de retomada da importação paginada: só avança depois que a página foi gravada.
CREATE TABLE import_cursors (
    channel_id uuid PRIMARY KEY REFERENCES sales_channels(id) ON DELETE RESTRICT,
    cursor text,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Eventos a publicar, gravados na mesma transação da mudança que os originou.
CREATE TABLE outbox (
    id uuid PRIMARY KEY,
    topic varchar(80) NOT NULL,
    aggregate_id uuid NOT NULL,
    payload jsonb NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz
);
CREATE INDEX outbox_unpublished_idx ON outbox(created_at) WHERE published_at IS NULL;

CREATE TABLE users (
    id uuid PRIMARY KEY,
    email varchar(254) NOT NULL,
    name varchar(120) NOT NULL CHECK (length(btrim(name)) > 0),
    password_hash text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

-- Armazenamento persistente de sessões usado pelo connect-pg-simple (schema da biblioteca).
CREATE TABLE user_sessions (
    sid varchar NOT NULL PRIMARY KEY,
    sess json NOT NULL,
    expire timestamp(6) NOT NULL
);
CREATE INDEX user_sessions_expire_idx ON user_sessions(expire);
