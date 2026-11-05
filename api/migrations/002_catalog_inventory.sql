-- Catálogo: produto ativo/inativo e garantias que antes só existiam na aplicação.
ALTER TABLE products ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE products ADD CONSTRAINT products_sku_format CHECK (sku ~ '^[A-Z0-9_-]{1,64}$');
ALTER TABLE products ADD CONSTRAINT products_name_not_blank CHECK (length(btrim(name)) > 0);

-- Filamento é outro estoque, em gramas: 500 g não são 500 produtos.
CREATE TABLE materials (
    id uuid PRIMARY KEY,
    name varchar(80) NOT NULL CHECK (length(btrim(name)) > 0),
    color varchar(60) NOT NULL CHECK (length(btrim(color)) > 0),
    physical_grams numeric(12,3) NOT NULL DEFAULT 0 CHECK (physical_grams >= 0),
    reserved_grams numeric(12,3) NOT NULL DEFAULT 0 CHECK (reserved_grams >= 0),
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT materials_reserved_le_physical CHECK (reserved_grams <= physical_grams),
    CONSTRAINT materials_name_color_unique UNIQUE (name, color)
);

-- Receita: quantos gramas de cada material uma unidade do produto consome (estimativa).
CREATE TABLE product_materials (
    product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    material_id uuid NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
    grams_per_unit numeric(12,3) NOT NULL CHECK (grams_per_unit > 0),
    PRIMARY KEY (product_id, material_id)
);
CREATE INDEX product_materials_material_idx ON product_materials(material_id);

-- Peças prontas. physical = peças na prateleira; reserved = peças comprometidas com pedidos.
CREATE TABLE inventory (
    product_id uuid PRIMARY KEY REFERENCES products(id) ON DELETE RESTRICT,
    physical integer NOT NULL DEFAULT 0 CHECK (physical >= 0),
    reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT inventory_reserved_le_physical CHECK (reserved <= physical)
);
INSERT INTO inventory (product_id) SELECT id FROM products;

-- Histórico de auditoria. operation_key única: repetir a mesma operação não altera o saldo duas vezes.
CREATE TABLE stock_movements (
    id uuid PRIMARY KEY,
    product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    kind varchar(20) NOT NULL
        CHECK (kind IN ('adjustment', 'reservation', 'release', 'shipment', 'production')),
    physical_delta integer NOT NULL DEFAULT 0,
    reserved_delta integer NOT NULL DEFAULT 0,
    reason varchar(255) NOT NULL CHECK (length(btrim(reason)) > 0),
    operation_key varchar(200) NOT NULL CONSTRAINT stock_movements_operation_key_unique UNIQUE,
    order_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT stock_movements_nonzero CHECK (physical_delta <> 0 OR reserved_delta <> 0)
);
CREATE INDEX stock_movements_product_idx ON stock_movements(product_id, created_at);

CREATE TABLE material_movements (
    id uuid PRIMARY KEY,
    material_id uuid NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
    kind varchar(20) NOT NULL CHECK (kind IN ('adjustment', 'consumption')),
    grams_delta numeric(12,3) NOT NULL CHECK (grams_delta <> 0),
    -- Consumo: o estimado pela receita e o real informado ficam separados.
    estimated_grams numeric(12,3) CHECK (estimated_grams >= 0),
    reason varchar(255) NOT NULL CHECK (length(btrim(reason)) > 0),
    production_job_id uuid,
    operation_key varchar(200) NOT NULL CONSTRAINT material_movements_operation_key_unique UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX material_movements_material_idx ON material_movements(material_id, created_at);
