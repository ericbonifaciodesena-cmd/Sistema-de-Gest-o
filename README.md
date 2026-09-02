# Sistema Unificado — Comissões e Tarefas

Sistema próprio para substituir controles manuais (planilha de comissões e
quadro de tarefas no Notion) por um sistema único, com banco de dados real
e login para a equipe interna.

Escopo inicial (fase atual): **controle de comissões dos vendedores parceiros**
e **gestão de tarefas da equipe interna**. A integração com CRM
(Pipedrive) fica para uma fase posterior.

## Documentação

- [`docs/modelo-de-dados.md`](docs/modelo-de-dados.md) — entidades, campos e relacionamentos
- [`db/schema.sql`](db/schema.sql) — schema SQL (Postgres) do banco

## Stack planejada

- Banco de dados: Postgres (Supabase)
- Backend/hospedagem: a definir na próxima fase
