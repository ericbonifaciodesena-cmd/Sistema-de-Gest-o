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
    papel  text not null default 'admin' check (papel in ('admin'))
);

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

-- RLS: só quem está logado (equipe interna) lê e escreve.
-- Sem login real por enquanto, o acesso é "qualquer usuário autenticado",
-- já que só Eric e Pedro terão conta.
alter table perfis enable row level security;
alter table vendedores enable row level security;
alter table comissoes enable row level security;
alter table tarefas enable row level security;

create policy "equipe interna le perfis" on perfis
    for select using (auth.uid() is not null);

create policy "equipe interna acessa vendedores" on vendedores
    for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "equipe interna acessa comissoes" on comissoes
    for all using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "equipe interna acessa tarefas" on tarefas
    for all using (auth.uid() is not null) with check (auth.uid() is not null);
