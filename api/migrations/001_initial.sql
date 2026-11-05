CREATE TABLE products (
    id uuid PRIMARY KEY,
    sku varchar(64) NOT NULL UNIQUE,
    name varchar(120) NOT NULL,
    price_cents integer NOT NULL CHECK (price_cents >= 0),
    created_at timestamptz NOT NULL DEFAULT now()
);
