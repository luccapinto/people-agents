# Padrões de dbt e Airflow

*Documento fictício para demonstração. Nimbus Serviços Digitais S.A. é uma empresa inventada.*

## Convenções de nomes no dbt

| Prefixo | Camada | Propósito |
|---|---|---|
| `stg_` | staging | uma fonte, um modelo: renomeia, tipa e limpa, sem join |
| `int_` | intermediário | lógica reutilizável, joins e regras intermediárias; não é consumido fora do projeto |
| `fct_` | fato | eventos e transações, com granularidade declarada no nome ou na descrição |
| `dim_` | dimensão | entidades descritivas, com chave substituta estável |

Regras de nomenclatura:

- minúsculas com `_`, sem acento e sem abreviação obscura;
- `stg_<fonte>__<objeto>` (duplo underscore separando fonte e objeto), por exemplo `stg_faturamento__pedidos`;
- `fct_<processo>` e `dim_<entidade>`, por exemplo `fct_pedidos`, `dim_cliente`;
- colunas de data terminam em `_data` ou `_em`; booleanos começam com `eh_` ou `tem_`;
- valores monetários com sufixo de moeda, por exemplo `valor_brl`.

## Estrutura do projeto

```
models/
  staging/<fonte>/      stg_*.sql + _fonte__sources.yml + _fonte__models.yml
  intermediate/<domínio>/ int_*.sql
  marts/<domínio>/      fct_*.sql, dim_*.sql
macros/
tests/
```

Materialização padrão: `view` em staging, `ephemeral` ou `table` em intermediário, `incremental` em fatos grandes e `table` em dimensões.

## Testes obrigatórios

Nenhum modelo entra em produção sem testes. O mínimo exigido:

| Tipo de modelo | Testes obrigatórios |
|---|---|
| Todos | `not_null` e `unique` na chave primária |
| `stg_` | contagem de linhas comparada à fonte (teste de reconciliação) |
| `fct_` | `relationships` para cada chave estrangeira de dimensão |
| `dim_` | `unique` na chave natural e na substituta |
| Modelos com domínio fechado | `accepted_values` |
| Modelos incrementais | teste de ausência de duplicidade na janela reprocessada |

Além disso:

- toda coluna precisa de **descrição** no YAML; o CI falha com cobertura de documentação abaixo de 90%;
- `dbt build` roda em `stg` a cada PR, com `--select state:modified+` para rodar o que mudou e seus descendentes;
- testes de severidade `warn` precisam de justificativa escrita no PR; o padrão é `error`.

## Revisão de PR

Todo pull request precisa de:

1. **Um aprovador** do time de Plataforma de Dados; **dois** quando o modelo for de camada ouro ou tocar dado classificado como confidencial ou restrito.
2. **Descrição** com motivo da mudança, impacto em consumidores e plano de reprocessamento quando aplicável.
3. **CI verde**: lint de SQL, `dbt build` em `stg`, testes e verificação de documentação.
4. **Linhagem revisada**: o autor confere no Atlas quem consome o modelo alterado e avisa os donos afetados.
5. **Sem credenciais** no código: segredos vêm do cofre, nunca de variáveis no repositório.

Mudança que quebra contrato (remoção ou renomeação de coluna em ouro) exige aviso aos consumidores com **10 dias úteis** de antecedência e período de convivência das duas versões.

## Padrões de DAG no Airflow

Toda DAG declara, obrigatoriamente:

| Parâmetro | Regra |
|---|---|
| `owner` | time dono, nunca pessoa — por exemplo, `plataforma-dados` |
| `retries` | 2 por padrão, com `retry_delay` de 5 minutos e backoff exponencial |
| `sla` | prazo de conclusão da tarefa crítica, alinhado ao SLA registrado no Atlas |
| `start_date` | data fixa, nunca dinâmica |
| `catchup` | `False`, salvo backfill intencional e documentado |
| `max_active_runs` | 1 para pipelines de carga |
| `tags` | domínio, camada e criticidade |
| `on_failure_callback` | notificação no canal do time e, para pipelines críticos, acionamento do plantão |

Convenções adicionais:

- nome da DAG: `<domínio>_<camada>_<frequência>`, por exemplo `faturamento_ouro_diario`;
- tarefas **idempotentes**: reexecutar a mesma data produz o mesmo resultado;
- sem lógica de negócio em Python dentro da DAG — a transformação mora no dbt, a DAG orquestra;
- sensores com `timeout` sempre definido; sensor sem timeout é falha de revisão;
- **backfill** em janelas de no máximo 7 dias por execução, fora do horário de pico, avisado no canal do time.

## Alertas

| Evento | Destino | Urgência |
|---|---|---|
| Falha de tarefa não crítica | canal do time | próximo dia útil |
| Falha de pipeline crítico | canal do time + plantão | imediata |
| Estouro de SLA | canal do time + dono do dado | mesmo dia |
| Divergência de reconciliação acima de 0,5% | canal do time | mesmo dia |
| Teste `error` em produção | bloqueio da publicação + canal do time | imediata |

Alerta que ninguém age é ruído: alertas sem ação por 30 dias são revisados e removidos ou corrigidos na revisão mensal de observabilidade.

## Perguntas frequentes

### Posso fazer join dentro de um modelo `stg_`?

Não. Staging é um para um com a fonte. Joins vão para `int_` ou para os modelos de mart.

### Qual a diferença entre `int_` e `fct_`?

`int_` é lógica intermediária reutilizável, não exposta a consumidores. `fct_` é modelo final, documentado e consumível.

### Preciso de quantos aprovadores no PR?

Um para modelos de staging e intermediários; dois para camada ouro ou dados confidenciais e restritos.

### Posso usar `owner` com meu nome na DAG?

Não. O `owner` é sempre o time, para que o plantão funcione independentemente de férias e movimentações.

### Como faço backfill de 3 meses?

Em janelas de até 7 dias por execução, fora do horário de pico, com aviso prévio no canal do time.

### Um teste está falhando por um caso de negócio legítimo. O que faço?

Ajuste o teste para refletir a regra real e documente o motivo no PR. Rebaixar para `warn` exige justificativa escrita.
