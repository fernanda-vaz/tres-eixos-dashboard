CREATE TABLE production_jobs (
    id uuid PRIMARY KEY,
    product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    -- Item que originou o job. Em purpose = 'stock' pode ser nulo (produção para estoque)
    -- ou guardar a origem de um job cujo pedido foi cancelado e que se decidiu concluir.
    order_item_id uuid REFERENCES order_items(id) ON DELETE RESTRICT,
    purpose varchar(10) NOT NULL CHECK (purpose IN ('order', 'stock')),
    quantity integer NOT NULL CHECK (quantity > 0),
    priority integer NOT NULL DEFAULT 0 CHECK (priority BETWEEN -100 AND 100),
    priority_reason varchar(255),
    status varchar(20) NOT NULL
        CHECK (status IN ('queued', 'printing', 'on_hold', 'done', 'cancelled')),
    hold_reason varchar(255),
    estimated_minutes integer CHECK (estimated_minutes >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    completed_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT production_jobs_purpose_coherent CHECK (purpose = 'stock' OR order_item_id IS NOT NULL),
    CONSTRAINT production_jobs_hold_reason CHECK (status <> 'on_hold' OR hold_reason IS NOT NULL)
);
-- No máximo um job em aberto por item de pedido.
CREATE UNIQUE INDEX production_jobs_open_item_unique
    ON production_jobs(order_item_id) WHERE status IN ('queued', 'printing', 'on_hold');
CREATE INDEX production_jobs_status_idx ON production_jobs(status, priority DESC, created_at);

-- Filamento reservado por um job em impressão, para devolver a quantia exata se ele for interrompido.
CREATE TABLE production_job_materials (
    job_id uuid NOT NULL REFERENCES production_jobs(id) ON DELETE RESTRICT,
    material_id uuid NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
    reserved_grams numeric(12,3) NOT NULL CHECK (reserved_grams > 0),
    PRIMARY KEY (job_id, material_id)
);

CREATE TABLE production_job_history (
    id uuid PRIMARY KEY,
    job_id uuid NOT NULL REFERENCES production_jobs(id) ON DELETE RESTRICT,
    from_status varchar(20),
    to_status varchar(20) NOT NULL,
    reason varchar(255) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX production_job_history_job_idx ON production_job_history(job_id, created_at);

ALTER TABLE material_movements
    ADD CONSTRAINT material_movements_job_fk FOREIGN KEY (production_job_id) REFERENCES production_jobs(id) ON DELETE RESTRICT;

-- Etapas internas de expedição. Não alteram o estado externo do pedido na plataforma.
CREATE TABLE shipments (
    order_id uuid PRIMARY KEY REFERENCES orders(id) ON DELETE RESTRICT,
    ready_at timestamptz,
    label_printed_at timestamptz,
    dispatched_at timestamptz,
    external_status_source varchar(40),
    updated_at timestamptz NOT NULL DEFAULT now()
);
