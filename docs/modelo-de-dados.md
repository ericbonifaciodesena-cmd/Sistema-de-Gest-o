# Modelo de dados — Comissões, Tarefas, Cobrança e CRM

Escopo desta fase: **comissões**, **tarefas**, **cobrança** e **CRM**
(negócios). O cliente da comissão e o cliente de cobrança continuam sendo
cadastros próprios, simples — só o CRM tem o conceito completo de negócio
com funil, status e histórico, no lugar do Pipedrive.

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

### Negócio (CRM)
Substitui o Pipedrive. Dois funis (`tipo`): **novo** seguro ou
**renovação** — cada um com suas próprias etapas. `estagio` é a etapa do
funil; `status` é **independente do estágio**, igual ao Pipedrive: um
negócio pode ser marcado `ganho` ou `perdido` a partir de qualquer etapa,
sem precisar mover de coluna antes.

| Campo        | Tipo          | Observação |
|--------------|---------------|------------|
| id           | uuid          | chave primária |
| titulo       | text          | título do negócio (ex: "Seguro Auto — Fulano") |
| cliente_nome | text          | pessoa vinculada ao negócio |
| email        | text          | opcional |
| telefone     | text          | opcional |
| tipo         | text          | `novo` \| `renovacao` |
| estagio      | text          | ver etapas abaixo, validado por `tipo` |
| status       | text          | `aberto` \| `ganho` \| `perdido` |
| valor        | numeric(12,2) | opcional |
| criado_em    | timestamp     | |

Etapas do funil **novo**: Pedido de cotação → Cotação Realizada → Proposta
Apresentada → Follow Up → Negócio Fechado.
Etapas do funil **renovação**: Pedido de renovação → Renovação Realizada →
Proposta Apresentada → Follow Up → Negócio Fechado.
(Um `check` no banco garante que o estágio bate com o tipo do negócio.)

### Cotação (PDF)
Arquivo de cotação anexado a um negócio. O arquivo em si fica no Storage
do Supabase (bucket privado `cotacoes`, só admin acessa); esta tabela só
guarda a referência.

| Campo        | Tipo      | Observação |
|--------------|-----------|------------|
| id           | uuid      | chave primária |
| negocio_id   | uuid (FK) | → Negócio |
| arquivo_path | text      | caminho no bucket `cotacoes` |
| nome_arquivo | text      | nome original do PDF |
| criado_em    | timestamp | |

### Atividade
Interação (ligação, e-mail, reunião, observação) por negócio, com data —
pode ser registrada pra hoje (uma nota) ou agendada pra uma data futura
(um lembrete), igual às atividades do Pipedrive.

| Campo         | Tipo      | Observação |
|---------------|-----------|------------|
| id            | uuid      | chave primária |
| negocio_id    | uuid (FK) | → Negócio |
| autor_id      | uuid (FK) | → Perfil, quem registrou |
| descricao     | text      | |
| data_agendada | date      | hoje (nota) ou uma data futura (agendada) |
| concluida     | boolean   | marca quando a atividade agendada foi feita |
| criado_em     | timestamp | |

## Relacionamentos

```
Perfil 1 ── N Tarefa                  (responsavel_id)
Vendedor 1 ── N Comissão              (vendedor_id)
Cliente de cobrança 1 ── N Parcela    (cliente_id)
Negócio 1 ── N Cotação                (negocio_id)
Negócio 1 ── N Atividade              (negocio_id)
Perfil 1 ── N Atividade               (autor_id)
```

Perfil, Vendedor, Cliente de cobrança e Negócio não se relacionam entre si
nesta fase — são cadastros de pessoas/registros com papéis totalmente
diferentes. Acesso é protegido por Row Level Security:
- **Comissões, Tarefas, Vendedores e CRM (negócios/cotações/atividades)**:
  só usuários com papel `admin` (Eric e Pedro)
- **Cobrança**: qualquer usuário autenticado, `admin` ou `cobranca`
  (inclui a Thais)

## Fora do escopo desta fase

- Ligar o CRM aos clientes de Comissão/Cobrança (hoje são cadastros
  separados) — pode fazer sentido unificar numa fase futura
- Tarefas atribuídas a vendedores/parceiros — hoje só equipe interna
- Permissões mais granulares que admin/cobranca
- Backup manual (exportar/importar `.json`) do protótipo — não é mais
  necessário, o banco real (Supabase) já tem backup automático
