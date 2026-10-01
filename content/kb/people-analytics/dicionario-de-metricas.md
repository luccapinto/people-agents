# Dicionário de Métricas de Pessoas

*Documento fictício para demonstração. Nimbus Serviços Digitais S.A. é uma empresa inventada.*

## Como usar este dicionário

Toda métrica de pessoas publicada na Nimbus tem exatamente uma definição, registrada aqui. Relatórios, painéis e respostas do assistente corporativo usam estas fórmulas; qualquer número divergente deve ser tratado como erro e reportado.

Três regras valem para todas as métricas:

1. **Período explícito**: nenhuma métrica é publicada sem o intervalo de apuração.
2. **Recorte explícito**: unidade, cargo ou senioridade precisam estar declarados.
3. **Agregação mínima**: grupos com **menos de 5 pessoas nunca são exibidos**.

## Regra de k-anonimato

O limite de agregação mínima é **k = 5**. Na prática:

- qualquer corte cujo denominador ou numerador identifique um grupo com menos de 5 pessoas é **suprimido**, e não arredondado;
- a supressão é indicada como "suprimido por agregação mínima", nunca como zero;
- **supressão secundária**: se a soma de categorias exibidas permitir deduzir um grupo suprimido, suprime-se também a segunda menor categoria;
- cruzar recortes sucessivos até isolar uma pessoa é violação de política, mesmo que cada consulta isolada pareça legítima;
- nenhuma métrica de pessoas é publicada com identificação individual fora dos processos formais de RH.

## Headcount

**Definição**: número de contratos ativos no último dia do período.

```
headcount = contagem de colaboradores com contrato ativo em D
```

- Inclui: CLT ativos, inclusive afastados e em licença.
- Exclui: estagiários sem contrato CLT, prestadores pessoa jurídica e desligados com data anterior a D.
- **Headcount médio** do período: `(headcount inicial + headcount final) / 2`. É o denominador padrão de turnover e de outras taxas.

## Turnover

**Definição**: proporção de desligamentos no período em relação ao headcount médio.

```
turnover = desligamentos no período / headcount médio do período
```

Desdobramentos:

| Métrica | Numerador |
|---|---|
| Turnover total | todos os desligamentos |
| Turnover voluntário | pedidos de demissão |
| Turnover involuntário | desligamentos por iniciativa da empresa |

- Movimentações internas **não** contam como desligamento.
- Fim de contrato de experiência conta como involuntário.
- Para anualizar um turnover mensal, multiplique por 12; para trimestral, por 4. Sempre declare se o número está anualizado.

## Absenteísmo

**Definição**: proporção de dias de ausência em relação aos dias úteis previstos.

```
absenteísmo = dias de ausência no período / dias úteis previstos no período
```

- **Entram**: faltas injustificadas, atestados médicos de até 15 dias e atrasos convertidos em dias equivalentes.
- **Não entram**: férias, feriados, licenças legais (maternidade, paternidade, casamento, luto), afastamentos previdenciários acima de 15 dias e dias de banco de horas compensados.
- Dias úteis previstos seguem o calendário de São Paulo, excluindo feriados e os dias de ponto facultativo concedidos pela empresa.

## Férias vencidas e a vencer

- **Férias vencidas**: períodos cujo **período concessivo já terminou** sem gozo. Geram pagamento em dobro (CLT, art. 137) e são indicador de risco, não de produtividade.
- **Férias a vencer**: períodos cujo concessivo termina nos **próximos 90 dias**. É o indicador operacional para planejamento.
- **Saldo de dias**: dias de direito adquiridos e ainda não gozados, somando todos os períodos aquisitivos fechados.

```
dias de saldo = soma dos dias de direito dos períodos fechados − dias já gozados − dias vendidos como abono
```

Publicação desses indicadores por time respeita a mesma regra de k = 5.

## Banco de horas

- **Saldo**: horas acumuladas, positivas ou negativas, por pessoa, limitadas a 40 horas.
- **Saldo médio do time**: média aritmética dos saldos individuais, exibida apenas para grupos com 5 pessoas ou mais.
- **Horas a vencer**: horas que completam 6 meses sem compensação nos próximos 30 dias; passado o prazo, são pagas com adicional.
- **Percentual acima do limite**: proporção de pessoas com saldo igual ou superior a 40 horas.

## Treinamentos obrigatórios

```
taxa de conclusão = pessoas com treinamento concluído / pessoas elegíveis
```

Elegíveis são os colaboradores ativos na data de corte, excluídos os afastados (cujo prazo fica suspenso). Notas individuais **nunca** são expostas; apenas status de conclusão e taxas agregadas.

## Fontes e atualização

| Métrica | Fonte | Atualização |
|---|---|---|
| Headcount, turnover | base de contratos | diária |
| Absenteísmo | sistema de ponto e atestados | diária, com fechamento mensal no 3º dia útil |
| Férias | módulo de férias | diária |
| Banco de horas | sistema de ponto | diária |
| Treinamentos | portal de desenvolvimento | diária |

Números apurados antes do fechamento mensal são provisórios e devem ser rotulados como tal.

## Perguntas frequentes

### Por que o turnover do trimestre parece tão alto?

Provavelmente porque foi anualizado. Verifique se o número está multiplicado por 4 e declare sempre a base temporal.

### Movimentação interna entra no turnover?

Não. Só contam saídas da empresa.

### Por que um recorte de time voltou suprimido?

Porque o grupo tem menos de 5 pessoas. A regra de agregação mínima vale também para você.

### Posso cruzar unidade, cargo e faixa etária para investigar um caso?

Não. Cruzamentos sucessivos que isolem indivíduos violam a política, mesmo que cada consulta pareça legítima isoladamente.

### Licença-maternidade entra no absenteísmo?

Não. Licenças legais e afastamentos previdenciários acima de 15 dias ficam fora do indicador.

### Qual denominador usar para taxas?

Headcount médio do período — média entre o headcount inicial e o final.
