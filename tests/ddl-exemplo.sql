-- DDL de teste
CREATE SCHEMA IF NOT EXISTS vendas;
CREATE TYPE vendas.pedido_status AS ENUM ('aberto', 'pago', 'cancelado');
CREATE TABLE clientes (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome varchar(120) NOT NULL,
    email varchar(255) NOT NULL UNIQUE,
    criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE vendas.pedidos (
    id bigint NOT NULL,
    cliente_id bigint NOT NULL REFERENCES clientes (id) ON DELETE RESTRICT,
    empresa_id bigint NOT NULL,
    status vendas.pedido_status NOT NULL DEFAULT 'aberto',
    total numeric(12,2) NOT NULL DEFAULT 0,
    data date NOT NULL,
    CONSTRAINT pk_pedidos PRIMARY KEY (id, data),
    CONSTRAINT ck_total CHECK (total >= 0)
) PARTITION BY RANGE (data);
CREATE TABLE vendas.pedidos_jan PARTITION OF vendas.pedidos FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE itens (
    pedido_id bigint NOT NULL,
    produto_id bigint NOT NULL,
    quantidade integer NOT NULL DEFAULT 1,
    data date NOT NULL
);
ALTER TABLE ONLY itens ADD CONSTRAINT itens_pk PRIMARY KEY (pedido_id, produto_id);
ALTER TABLE itens ADD CONSTRAINT fk_itens_pedido FOREIGN KEY (pedido_id, data) REFERENCES vendas.pedidos (id, data) ON DELETE CASCADE;
CREATE UNIQUE INDEX idx_clientes_nome ON clientes (lower(nome)) WHERE nome <> '';
CREATE INDEX ix_itens_prod ON itens USING btree (produto_id DESC NULLS LAST);
COMMENT ON TABLE clientes IS 'Cadastro de clientes';
COMMENT ON COLUMN clientes.nome IS 'Nome completo';
CREATE FUNCTION f_x() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;
CREATE TRIGGER tg_clientes BEFORE UPDATE ON clientes FOR EACH ROW EXECUTE FUNCTION f_x();
GRANT SELECT ON clientes TO public;
