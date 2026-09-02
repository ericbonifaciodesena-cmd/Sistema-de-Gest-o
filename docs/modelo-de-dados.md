# Modelo de dados — Comissões e Tarefas

Escopo desta fase: apenas **comissões** e **tarefas**. O CRM (clientes/negócios
vindos do Pipedrive) entra em uma fase futura — por enquanto o cliente é só
um campo de texto dentro da comissão, igual ao protótipo e à planilha atual.

## Entidades

### Usuário (equipe interna, com login)
Pessoas que operam o sistema: cadastram comissões e gerenciam tarefas.
Hoje são duas pessoas (Eric e Pedro), mas o campo `papel` já existe para
diferenciar permissões no futuro se necessário.

| Campo         | Tipo      | Observação                          |
|---------------|-----------|--------------------------------------|
| id            | uuid      | chave primária                       |
| nome          | text      |                                       |
| email         | text      | único, usado no login                |
| senha_hash    | text      | nunca a senha em texto puro          |
| papel         | text      | `admin` (por enquanto todos são admin) |
| criado_em     | timestamp |                                       |

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
| responsavel_id| uuid (FK) | → Usuário (sempre equipe interna) |
| descricao     | text      | |
| data          | date      | data da tarefa |
| concluida     | boolean   | default false |
| arquivada     | boolean   | default false |
| arquivada_em  | timestamp | nulo até ser arquivada |
| criado_em     | timestamp | |

## Relacionamentos

```
Usuário 1 ── N Tarefa           (responsavel_id)
Vendedor 1 ── N Comissão        (vendedor_id)
```

Usuário e Vendedor não se relacionam diretamente nesta fase — são dois
cadastros de pessoas com papéis totalmente diferentes (quem opera o sistema
vs. quem recebe comissão).

## Fora do escopo desta fase

- Entidade Cliente/Negócio (CRM) — `cliente_nome` fica como texto até a
  integração com o Pipedrive
- Tarefas atribuídas a vendedores/parceiros — hoje só equipe interna
- Permissões granulares por papel — hoje todo Usuário é `admin`
