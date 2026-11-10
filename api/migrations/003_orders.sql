CREATE TABLE sales_channels (
    id uuid PRIMARY KEY,
    provider varchar(30) NOT NULL
        CHECK (provider IN ('manual', 'simulator', 'mercado_livre', 'shopee')),
    external_account varchar(120) NOT NULL,
    name varchar(120) NOT NULL,
    connection_status varchar(20) NOT NULL DEFAULT 'disconnected'
        CHECK (connection_status IN ('not_applicable', 'connected', 'disconnected', 'revoked')),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT sales_channels_provider_account_unique UNIQUE (provider, external_account)
);

-- Canais fixos do MVP: pedidos digitados no painel e o simulador (nunca um marketplace real).
INSERT INTO sales_channels (id, provider, external_account, name, connection_status) VALUES
    ('00000000-0000-4000-8000-000000000001', 'manual', 'local', 'Pedidos manuais', 'not_applicable'),
    ('00000000-0000-4000-8000-000000000002', 'simulator', 'demo', 'Simulador de marketplace', 'connected');

-- Correspondência SKU externo → produto. product_id nulo = pendência de mapeamento.
CREATE TABLE external_skus (
    id uuid PRIMARY KEY,
    channel_id uuid NOT NULL REFERENCES sales_channels(id) ON DELETE RESTRICT,
    external_sku varchar(120) NOT NULL,
    product_id uuid REFERENCES products(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT external_skus_channel_sku_unique UNIQUE (channel_id, external_sku)
);
CREATE INDEX external_skus_pending_idx ON external_skus(channel_id) WHERE product_id IS NULL;

CREATE TABLE orders (
    id uuid PRIMARY KEY,
    channel_id uuid NOT NULL REFERENCES sales_channels(id) ON DELETE RESTRICT,
    external_order_id varchar(120) NOT NULL,
    -- Estado interno (operação da loja), separado do estado informado pela plataforma.
    status varchar(20) NOT NULL
        CHECK (status IN ('pending_mapping', 'awaiting_stock', 'reserved', 'ready', 'shipped', 'cancelled')),
    external_status varchar(40),
    external_status_rank integer,
    external_updated_at timestamptz,
    ordered_at timestamptz NOT NULL,
    ship_by timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    cancelled_at timestamptz,
    cancel_reason varchar(255),
    CONSTRAINT orders_channel_external_unique UNIQUE (channel_id, external_order_id),
    CONSTRAINT orders_cancelled_coherent CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);
CREATE INDEX orders_queue_idx ON orders(status, ship_by, ordered_at, id);

CREATE TABLE order_items (
    id uuid PRIMARY KEY,
    order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    line_number integer NOT NULL CHECK (line_number > 0),
    product_id uuid REFERENCES products(id) ON DELETE RESTRICT,
    external_sku varchar(120),
    quantity integer NOT NULL CHECK (quantity > 0),
    -- Preço congelado no momento do pedido.
    unit_price_cents integer NOT NULL CHECK (unit_price_cents >= 0),
    CONSTRAINT order_items_line_unique UNIQUE (order_id, line_number),
    CONSTRAINT order_items_identified CHECK (product_id IS NOT NULL OR external_sku IS NOT NULL)
);
CREATE INDEX order_items_product_idx ON order_items(product_id);

-- Uma reserva por item: a chave única impede reservar o mesmo item duas vezes.
CREATE TABLE reservations (
    id uuid PRIMARY KEY,
    order_item_id uuid NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT
        CONSTRAINT reservations_item_unique UNIQUE,
    product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity integer NOT NULL CHECK (quantity > 0),
    status varchar(20) NOT NULL CHECK (status IN ('active', 'released', 'fulfilled')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reservations_product_active_idx ON reservations(product_id) WHERE status = 'active';

CREATE TABLE order_status_history (
    id uuid PRIMARY KEY,
    order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    from_status varchar(20),
    to_status varchar(20) NOT NULL,
    reason varchar(255) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_status_history_order_idx ON order_status_history(order_id, created_at);

-- Respostas de requisições com Idempotency-Key, para repetir o mesmo resultado sem refazer a operação.
CREATE TABLE idempotency_keys (
    scope varchar(60) NOT NULL,
    key varchar(200) NOT NULL,
    request_hash char(64) NOT NULL,
    response_status integer,
    response_body jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, key)
);

ALTER TABLE stock_movements
    ADD CONSTRAINT stock_movements_order_fk FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT;
CREATE INDEX stock_movements_order_idx ON stock_movements(order_id) WHERE order_id IS NOT NULL;
