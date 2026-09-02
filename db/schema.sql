-- Schema inicial: comissões e tarefas
-- Ver docs/modelo-de-dados.md para o desenho completo do modelo.

create extension if not exists "pgcrypto";

create table usuarios (
    id          uuid primary key default gen_random_uuid(),
    nome        text not null,
    email       text not null unique,
    senha_hash  text not null,
    papel       text not null default 'admin' check (papel in ('admin')),
    criado_em   timestamptz not null default now()
);

create table vendedores (
    id          uuid primary key default gen_random_uuid(),
    nome        text not null,
    contato     text,
    ativo       boolean not null default true,
    criado_em   timestamptz not null default now()
);

create table comissoes (
    id            uuid primary key default gen_random_uuid(),
    vendedor_id   uuid not null references vendedores(id),
    cliente_nome  text not null,
    valor         numeric(12,2) not null,
    situacao      text not null default 'pendente' check (situacao in ('pago', 'pendente')),
    data          date not null,
    criado_em     timestamptz not null default now()
);

create index idx_comissoes_vendedor on comissoes(vendedor_id);

create table tarefas (
    id             uuid primary key default gen_random_uuid(),
    responsavel_id uuid not null references usuarios(id),
    descricao      text not null,
    data           date not null,
    concluida      boolean not null default false,
    arquivada      boolean not null default false,
    arquivada_em   timestamptz,
    criado_em      timestamptz not null default now()
);

create index idx_tarefas_responsavel on tarefas(responsavel_id);
create index idx_tarefas_data on tarefas(data);
