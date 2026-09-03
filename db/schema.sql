-- Schema: comissões e tarefas
-- Ver docs/modelo-de-dados.md para o desenho completo do modelo.
--
-- Login usa o Supabase Auth (auth.users), não uma senha própria.
-- "perfis" guarda só os dados de exibição (nome, papel) de cada usuário
-- interno logado, ligados 1:1 ao auth.users.

create extension if not exists "pgcrypto";

create table perfis (
    id     uuid primary key references auth.users(id) on delete cascade,
    nome   text not null,
    papel  text not null default 'admin' check (papel in ('admin', 'cobranca'))
);

-- lê o papel do usuário logado sem disparar recursão de RLS em perfis
-- (usada dentro das próprias políticas de acesso abaixo)
create or replace function public.current_papel()
returns text
language sql
security definer
set search_path = public
as $$
  select papel from perfis where id = auth.uid();
$$;

-- cria o perfil automaticamente quando alguém é cadastrado no Auth
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.perfis (id, nome)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)));
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute procedure public.handle_new_user();

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
    responsavel_id uuid not null references perfis(id),
    descricao      text not null,
    data           date not null,
    concluida      boolean not null default false,
    arquivada      boolean not null default false,
    arquivada_em   timestamptz,
    criado_em      timestamptz not null default now()
);

create index idx_tarefas_responsavel on tarefas(responsavel_id);
create index idx_tarefas_data on tarefas(data);

-- Cobrança: cliente que paga em parcelas (boleto/pix), com parcelas
-- geradas mensalmente. Reagendar só edita a data da parcela, nunca
-- cria uma nova.
create table cobranca_clientes (
    id            uuid primary key default gen_random_uuid(),
    nome          text not null,
    forma         text not null default 'Boleto' check (forma in ('Boleto', 'Pix')),
    observacoes   text not null default '',
    criado_em     timestamptz not null default now()
);

create table parcelas (
    id              uuid primary key default gen_random_uuid(),
    cliente_id      uuid not null references cobranca_clientes(id) on delete cascade,
    numero          int not null,
    valor           numeric(12,2) not null,
    data            date not null,
    status          text not null default 'pendente' check (status in ('pendente', 'paga')),
    data_pagamento  date,
    criado_em       timestamptz not null default now()
);

create index idx_parcelas_cliente on parcelas(cliente_id);
create index idx_parcelas_data on parcelas(data);

-- CRM: negócios (dois funis — seguro novo e renovação), com cotações em
-- PDF e histórico de atividades por negócio. `estagio` é a etapa do
-- funil; `status` é independente (aberto/ganho/perdido), igual ao
-- Pipedrive — um negócio pode ser marcado ganho/perdido de qualquer
-- etapa, sem precisar mover de coluna antes.
create table negocios (
    id          uuid primary key default gen_random_uuid(),
    cliente_nome text not null,
    contato     text,
    tipo        text not null check (tipo in ('novo', 'renovacao')),
    estagio     text not null,
    status      text not null default 'aberto' check (status in ('aberto', 'ganho', 'perdido')),
    valor       numeric(12,2),
    criado_em   timestamptz not null default now(),
    constraint estagio_valido check (
        (tipo = 'novo' and estagio in ('Pedido de cotação', 'Cotação Realizada', 'Proposta Apresentada', 'Follow Up', 'Negócio Fechado'))
        or
        (tipo = 'renovacao' and estagio in ('Pedido de renovação', 'Renovação Realizada', 'Proposta Apresentada', 'Follow Up', 'Negócio Fechado'))
    )
);

create index idx_negocios_tipo on negocios(tipo);

create table cotacoes (
    id            uuid primary key default gen_random_uuid(),
    negocio_id    uuid not null references negocios(id) on delete cascade,
    arquivo_path  text not null,
    nome_arquivo  text not null,
    criado_em     timestamptz not null default now()
);

create index idx_cotacoes_negocio on cotacoes(negocio_id);

create table atividades (
    id          uuid primary key default gen_random_uuid(),
    negocio_id  uuid not null references negocios(id) on delete cascade,
    autor_id    uuid references perfis(id),
    descricao   text not null,
    criado_em   timestamptz not null default now()
);

create index idx_atividades_negocio on atividades(negocio_id);

-- bucket privado pra guardar os PDFs de cotação
insert into storage.buckets (id, name, public)
values ('cotacoes', 'cotacoes', false)
on conflict (id) do nothing;

-- RLS: comissões, tarefas e vendedores são só para `admin`. Cobrança
-- (cliente + parcelas) é para qualquer usuário logado, admin ou
-- `cobranca` — hoje isso é Eric, Pedro (admin) e Thais (cobranca).
alter table perfis enable row level security;
alter table vendedores enable row level security;
alter table comissoes enable row level security;
alter table tarefas enable row level security;
alter table cobranca_clientes enable row level security;
alter table parcelas enable row level security;

create policy "equipe interna le perfis" on perfis
    for select using (auth.uid() is not null);

create policy "admin acessa vendedores" on vendedores
    for all using (current_papel() = 'admin') with check (current_papel() = 'admin');

create policy "admin acessa comissoes" on comissoes
    for all using (current_papel() = 'admin') with check (current_papel() = 'admin');

create policy "admin acessa tarefas" on tarefas
    for all using (current_papel() = 'admin') with check (current_papel() = 'admin');

create policy "equipe interna acessa cobranca_clientes" on cobranca_clientes
    for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "equipe interna acessa parcelas" on parcelas
    for all using (auth.uid() is not null) with check (auth.uid() is not null);

alter table negocios enable row level security;
alter table cotacoes enable row level security;
alter table atividades enable row level security;

create policy "admin acessa negocios" on negocios
    for all using (current_papel() = 'admin') with check (current_papel() = 'admin');

create policy "admin acessa cotacoes" on cotacoes
    for all using (current_papel() = 'admin') with check (current_papel() = 'admin');

create policy "admin acessa atividades" on atividades
    for all using (current_papel() = 'admin') with check (current_papel() = 'admin');

create policy "admin acessa bucket cotacoes" on storage.objects
    for all using (bucket_id = 'cotacoes' and current_papel() = 'admin')
    with check (bucket_id = 'cotacoes' and current_papel() = 'admin');
