-- Calculadora de custos e preços. Dinheiro em centavos (integer); percentuais em pontos-base
-- (1% = 100 bp), para fazer as contas só com inteiros.

-- Preço pago pelo filamento, por quilo.
ALTER TABLE materials ADD COLUMN cost_per_kg_cents integer NOT NULL DEFAULT 0 CHECK (cost_per_kg_cents >= 0);

-- Configuração única da operação (uma linha). Os valores reais são preenchidos pela dona da loja.
CREATE TABLE pricing_settings (
    id boolean PRIMARY KEY DEFAULT true CHECK (id),
    energy_cents_per_kwh integer NOT NULL DEFAULT 0 CHECK (energy_cents_per_kwh >= 0),
    printer_power_watts integer NOT NULL DEFAULT 0 CHECK (printer_power_watts >= 0),
    printer_price_cents integer NOT NULL DEFAULT 0 CHECK (printer_price_cents >= 0),
    printer_lifetime_hours integer NOT NULL DEFAULT 5000 CHECK (printer_lifetime_hours > 0),
    labor_cents_per_hour integer NOT NULL DEFAULT 0 CHECK (labor_cents_per_hour >= 0),
    failure_rate_bp integer NOT NULL DEFAULT 0 CHECK (failure_rate_bp BETWEEN 0 AND 5000),
    tax_rate_bp integer NOT NULL DEFAULT 0 CHECK (tax_rate_bp BETWEEN 0 AND 5000),
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO pricing_settings (id) VALUES (true);

-- Canais de venda com suas tarifas. Começam zeradas: as taxas dos marketplaces mudam e
-- devem ser conferidas e preenchidas por quem vende.
CREATE TABLE pricing_channels (
    id uuid PRIMARY KEY,
    name varchar(60) NOT NULL CHECK (length(btrim(name)) > 0),
    fee_bp integer NOT NULL DEFAULT 0 CHECK (fee_bp BETWEEN 0 AND 9000),
    fixed_fee_cents integer NOT NULL DEFAULT 0 CHECK (fixed_fee_cents >= 0),
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pricing_channels_name_unique UNIQUE (name)
);
INSERT INTO pricing_channels (id, name) VALUES
    ('00000000-0000-4000-8000-000000000101', 'Venda direta'),
    ('00000000-0000-4000-8000-000000000102', 'Mercado Livre'),
    ('00000000-0000-4000-8000-000000000103', 'Shopee');

-- Ficha de custo de cada produto: o que não vem da receita de filamento.
CREATE TABLE product_cost_sheets (
    product_id uuid PRIMARY KEY REFERENCES products(id) ON DELETE RESTRICT,
    print_minutes integer NOT NULL DEFAULT 0 CHECK (print_minutes BETWEEN 0 AND 100000),
    labor_minutes integer NOT NULL DEFAULT 0 CHECK (labor_minutes BETWEEN 0 AND 100000),
    packaging_cents integer NOT NULL DEFAULT 0 CHECK (packaging_cents >= 0),
    extra_cents integer NOT NULL DEFAULT 0 CHECK (extra_cents >= 0),
    target_margin_bp integer NOT NULL DEFAULT 3000 CHECK (target_margin_bp BETWEEN 0 AND 9000),
    updated_at timestamptz NOT NULL DEFAULT now()
);
