# Modelo de dados — Comissões, Tarefas e Cobrança

Escopo desta fase: **comissões**, **tarefas** e **cobrança**. O CRM
(clientes/negócios vindos do Pipedrive) entra em uma fase futura — por
enquanto o cliente da comissão é só um campo de texto, e o cliente de
cobrança é um cadastro próprio, simples, sem ligação com o Pipedrive
ainda.

## Entidades

### Perfil (equipe interna, com login)
Pessoas que operam o sistema: cadastram comissões e gerenciam tarefas.
Login é feito pelo Supabase Auth (e-mail/senha) — não guardamos senha
própria. `perfis` é só o complemento de exibição (nome, papel), ligado
1:1 ao usuário do Auth pelo mesmo `id`. Hoje são duas pessoas (Eric e
Pedro), mas o campo `papel` já existe para diferenciar permissões no
futuro se necessário. Um gatilho cria a linha em `perfis`
automaticamente quando alguém é cadastrado no Auth.

| Campo | Tipo | Observação |
|-------|------|------------|
| id    | uuid | mesmo id do `auth.users` (chave primária e estrangeira) |
| nome  | text | preenchido a partir do e-mail no cadastro, editável depois |
| papel | text | `admin` (por enquanto todos são admin) |

### Vendedor (parceiro, sem login)
Vendedores parceiros que recebem comissão. Não acessam o sistema — são só
um cadastro mantido pela equipe interna.

| Campo     | Tipo      | Observação |
|-----------|-----------|------------|
| id        | uuid      | chave primária |
| nome      | text      | ex: "Tanaka Schappo" |
| contato   | text      | telefone/e-mail, opcional |
| ativo     | boolean   | permite "desativar" sem apagar histórico |
| criado_em | timestamp | |

### Comissão
Uma linha por venda/cliente dentro da seção de um vendedor, igual à planilha
atual.

| Campo         | Tipo         | Observação |
|---------------|--------------|------------|
| id            | uuid         | chave primária |
| vendedor_id   | uuid (FK)    | → Vendedor |
| cliente_nome  | text         | texto livre por enquanto |
| valor         | numeric(12,2)| pode ser negativo (estornos, como na planilha) |
| situacao      | text         | `pago` \| `pendente` |
| data          | date         | |
| criado_em     | timestamp    | |

O "Total Transferido" por vendedor (soma dos pagos) é calculado por consulta,
não é um campo armazenado.

### Tarefa
Tarefas da equipe interna, com data real — o quadro semanal (Seg. a Sex.)
é uma visão que agrupa as tarefas da semana atual pelo dia da semana da
sua data. Concluir uma tarefa não a apaga; "arquivar" só marca os campos
abaixo, e o histórico é a mesma tabela filtrada por `arquivada = true`.

| Campo         | Tipo      | Observação |
|---------------|-----------|------------|
| id            | uuid      | chave primária |
| responsavel_id| uuid (FK) | → Perfil (sempre equipe interna) |
| descricao     | text      | |
| data          | date      | data da tarefa |
| concluida     | boolean   | default false |
| arquivada     | boolean   | default false |
| arquivada_em  | timestamp | nulo até ser arquivada |
| criado_em     | timestamp | |

### Cliente de cobrança
Cliente que paga em parcelas (boleto ou pix). Cadastro simples e próprio
dessa área — não é o mesmo cadastro de Vendedor nem depende do CRM.

| Campo       | Tipo | Observação |
|-------------|------|------------|
| id          | uuid | chave primária |
| nome        | text | |
| forma       | text | `Boleto` \| `Pix` |
| observacoes | text | texto livre, editável a qualquer momento |
| criado_em   | timestamp | |

### Parcela
Uma parcela de um cliente de cobrança. Todas as parcelas de um cliente são
geradas de uma vez (mensal, mesmo dia do mês, a partir da data inicial) ao
cadastrar o cliente — não há criação de parcela nova depois disso.
**Reagendar** (ex: cliente não pagou, novo boleto sai numa data diferente)
só edita o campo `data` da parcela existente, nunca cria outra.

| Campo          | Tipo          | Observação |
|----------------|---------------|------------|
| id             | uuid          | chave primária |
| cliente_id     | uuid (FK)     | → Cliente de cobrança |
| numero         | int           | 1, 2, 3... |
| valor          | numeric(12,2) | |
| data           | date          | vencimento (editável = reagendamento) |
| status         | text          | `pendente` \| `paga` |
| data_pagamento | date          | preenchida ao marcar como paga |
| criado_em      | timestamp     | |

A fila de cobrança (quem cobrar, ordenado por vencimento) é uma consulta:
para cada cliente, a parcela `pendente` de menor data. Marcar "cobrado e
pago" só muda o status dessa parcela — a próxima parcela pendente (já
existe, criada junto com as outras) aparece sozinha na fila depois.

## Relacionamentos

```
Perfil 1 ── N Tarefa                  (responsavel_id)
Vendedor 1 ── N Comissão              (vendedor_id)
Cliente de cobrança 1 ── N Parcela    (cliente_id)
```

Perfil, Vendedor e Cliente de cobrança não se relacionam entre si nesta
fase — são cadastros de pessoas com papéis totalmente diferentes (quem
opera o sistema, quem recebe comissão, quem é cobrado). Acesso é protegido
por Row Level Security: só usuários autenticados (Eric e Pedro) leem e
escrevem os dados.

## Fora do escopo desta fase

- Entidade Cliente/Negócio unificada (CRM) — hoje comissão e cobrança têm
  cada uma seu próprio jeito simples de registrar cliente, sem ligação com
  o Pipedrive ainda
- Tarefas atribuídas a vendedores/parceiros — hoje só equipe interna
- Permissões granulares por papel — hoje todo Usuário é `admin`
- Backup manual (exportar/importar `.json`) do protótipo — não é mais
  necessário, o banco real (Supabase) já tem backup automático
