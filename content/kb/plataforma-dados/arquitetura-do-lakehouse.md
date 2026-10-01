# Arquitetura do Lakehouse

*Documento fictício para demonstração. Nimbus Serviços Digitais S.A. é uma empresa inventada.*

## Visão geral

A plataforma analítica da Nimbus é um lakehouse em três camadas, com armazenamento em objeto, tabelas no formato **Apache Iceberg** e catálogo central. O nome interno da plataforma é **Cumulus**; o catálogo de dados e linhagem chama-se **Atlas**; a camada de consulta interativa é o **Mirante**.

```
fontes → ingestão (Correnteza) → bronze → prata → ouro → consumo (Mirante, BI, APIs)
                                     ↑                ↑
                                  Atlas (catálogo, linhagem, classificação)
```

## Camadas

### Bronze — dados crus

- Cópia fiel da fonte, sem regra de negócio, append-only.
- Particionamento por data de ingestão (`dt_ingestao`).
- Colunas técnicas obrigatórias: `_ingested_at`, `_source`, `_batch_id`, `_is_deleted`.
- Retenção: 90 dias para eventos de alto volume; 5 anos para fontes transacionais.
- Ninguém consome bronze diretamente em produto ou relatório. Acesso de leitura é restrito ao time de Plataforma de Dados e à engenharia da fonte.

### Prata — dados limpos e conformados

- Tipagem explícita, deduplicação por chave de negócio, padronização de domínios e fuso horário (tudo em `America/Sao_Paulo`, armazenado em UTC).
- Aplicação de **mascaramento** e **tokenização** de dados pessoais conforme a classificação registrada no Atlas.
- Chaves substitutas estáveis, geradas por hash determinístico da chave natural.
- É a camada que a maior parte dos times de engenharia consome.

### Ouro — modelos de consumo

- Modelagem dimensional: fatos e dimensões prontos para análise.
- Métricas de negócio com definição única, alinhada aos dicionários de métricas das áreas.
- Agregações pré-calculadas para os painéis de maior uso.
- É a camada exposta a BI, a produtos de dados e ao assistente corporativo.

## Formato e armazenamento

Todas as tabelas gerenciadas usam **Iceberg**, o que nos dá:

| Recurso | Uso prático na plataforma |
|---|---|
| Evolução de esquema | adicionar coluna sem reprocessar histórico |
| Evolução de partição | mudar granularidade sem reescrever tabela |
| Snapshots e time travel | consultar o estado de uma tabela em data anterior |
| Compactação de arquivos | reduzir arquivos pequenos gerados por micro-lotes |
| Transações ACID | leitura consistente durante escrita |

Convenções operacionais:

- **Compactação** semanal para tabelas com ingestão de alta frequência.
- **Expiração de snapshots** com 30 dias de retenção; tabelas com exigência regulatória têm retenção específica registrada no Atlas.
- **Particionamento**: por data de evento nas tabelas de fato; dimensões pequenas sem partição.
- Arquivos-alvo de 128 MB a 512 MB. Arquivos pequenos são o problema de desempenho número um da plataforma.

## Catálogo Atlas

Toda tabela registrada no Atlas precisa ter:

1. **Dono** (time, não pessoa) e time de plantão responsável.
2. **Descrição** da tabela e de cada coluna.
3. **Classificação** de confidencialidade: público, interno, confidencial ou restrito.
4. **Marcação de dado pessoal**, com a base legal LGPD correspondente quando houver.
5. **SLA de atualização** e janela esperada de disponibilidade.
6. **Linhagem**, capturada automaticamente a partir das execuções de dbt e Airflow.

Tabela sem dono e sem classificação **não é promovida para prata**. O pipeline de promoção falha explicitamente nesse caso.

## Ingestão (Correnteza)

- **Batch**: extrações incrementais por coluna de atualização ou CDC, orquestradas no Airflow.
- **Streaming**: eventos de produto em tópicos, consumidos em micro-lotes de 5 minutos para bronze.
- **Arquivos de terceiros**: área de aterrissagem com validação de esquema antes da promoção para bronze.
- Toda ingestão registra contagem de linhas na origem e no destino; divergência acima de 0,5% abre alerta automático.

## Consumo

- **Mirante**: consulta interativa SQL, com limite de varredura por consulta e cobrança interna por volume lido.
- **BI**: conectado exclusivamente à camada ouro.
- **Produtos de dados e APIs**: leem ouro ou materializações dedicadas, nunca prata diretamente.
- **Exportações**: qualquer saída de dados para fora da plataforma exige chamado DATA-ACCESS aprovado.

## Ambientes

| Ambiente | Uso | Dados |
|---|---|---|
| `dev` | desenvolvimento individual | amostra anonimizada |
| `stg` | validação de pipeline e revisão de PR | amostra anonimizada ou subconjunto mascarado |
| `prd` | produção | dados reais, acesso controlado |

Promoção entre ambientes acontece somente por pipeline de CI, nunca por execução manual.

## Perguntas frequentes

### Posso consultar a camada bronze para investigar um bug?

Apenas o time de Plataforma de Dados e a engenharia da fonte têm leitura em bronze. Para investigação pontual, abra chamado descrevendo o caso.

### Por que minha consulta no Mirante está lenta?

Na maioria dos casos, por excesso de arquivos pequenos ou por falta de filtro de partição. Filtre pela coluna de partição e verifique se a tabela tem compactação configurada.

### Posso adicionar uma coluna sem reprocessar o histórico?

Sim. O Iceberg suporta evolução de esquema; a coluna nova aparece nula no histórico.

### Até quando consigo fazer time travel?

Por padrão, 30 dias de snapshots. Tabelas com retenção regulatória específica estão documentadas no Atlas.

### Criei uma tabela e ela não foi promovida para prata. Por quê?

Provavelmente falta dono ou classificação no Atlas. O pipeline falha explicitamente nesse caso.

### Posso ler prata direto do meu serviço em produção?

Não. Serviços consomem ouro ou materializações dedicadas, para que a modelagem interna possa evoluir sem quebrar consumidores.
