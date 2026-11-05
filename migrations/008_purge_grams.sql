-- Peças multicoloridas: filamento descartado na troca de cor (purga), por peça.
-- Custeado pelo preço médio dos filamentos da receita, ponderado pelos gramas de cada cor.
ALTER TABLE product_cost_sheets
    ADD COLUMN purge_grams numeric(12,3) NOT NULL DEFAULT 0 CHECK (purge_grams >= 0);
