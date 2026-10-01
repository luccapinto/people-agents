# Entendendo o Holerite

*Documento fictício para demonstração. Nimbus Serviços Digitais S.A. é uma empresa inventada.*

## Como ler o demonstrativo

O holerite da Nimbus tem três blocos: **proventos** (o que soma), **descontos** (o que subtrai) e **bases e informativos** (valores que não entram na conta, mas aparecem para conferência, como FGTS e base de INSS). O líquido é simplesmente proventos menos descontos.

O documento fica disponível no portal do colaborador a partir do **dia 5 do mês seguinte** ao mês trabalhado. Dúvidas específicas sobre o seu cálculo vão para `folha@nimbus.example`.

## Proventos mais comuns

| Rubrica | Como é calculada |
|---|---|
| Salário base | Salário mensal contratado, proporcional aos dias trabalhados no mês |
| Horas extras 50% | Valor-hora × 1,5 × horas extras aprovadas previamente |
| DSR sobre horas extras | Total de horas extras do mês ÷ dias úteis × dias de descanso do mês |
| Férias | Remuneração proporcional aos dias de férias gozados |
| Terço de férias | 1/3 sobre a remuneração de férias (CF, art. 7º, XVII) |
| Abono pecuniário | Venda de até 1/3 do período, com o respectivo terço |
| 13º salário (parcelas) | 1ª parcela até 30/11; 2ª parcela até 20/12 |

O **valor-hora** é o salário mensal dividido por 220 (jornada de 44 horas semanais mensalizada); na Nimbus, a jornada contratual é de **8 horas por dia e 40 horas semanais**, de segunda a sexta, e o divisor aplicado é o do contrato individual registrado em folha.

O **reflexo de DSR** existe porque as horas extras aumentam a média remuneratória dos dias de descanso (Lei 605/1949, art. 7º, "a"). Ele aparece como rubrica separada logo abaixo das horas extras.

## Descontos obrigatórios

### INSS — tabela progressiva 2026

A contribuição é progressiva: cada faixa incide apenas sobre a parcela do salário que cai dentro dela.

| Faixa do salário de contribuição | Alíquota |
|---|---|
| Até R$ 1.621,00 | 7,5% |
| De R$ 1.621,01 até R$ 2.902,84 | 9% |
| De R$ 2.902,85 até R$ 4.354,27 | 12% |
| De R$ 4.354,28 até R$ 8.475,55 (teto) | 14% |

Acima do teto de R$ 8.475,55 não há contribuição adicional. O 13º salário tem INSS calculado **separadamente**, com a mesma tabela.

### IRRF — tabela mensal 2026

| Base de cálculo mensal | Alíquota | Parcela a deduzir |
|---|---|---|
| Até R$ 2.428,80 | isento | — |
| De R$ 2.428,81 até R$ 2.826,65 | 7,5% | R$ 182,16 |
| De R$ 2.826,66 até R$ 3.751,05 | 15% | R$ 394,16 |
| De R$ 3.751,06 até R$ 4.664,68 | 22,5% | R$ 675,49 |
| Acima de R$ 4.664,68 | 27,5% | R$ 908,73 |

Deduções legais mensais: **R$ 189,59 por dependente** e o INSS retido. Alternativamente, aplica-se o **desconto simplificado de R$ 607,20**, usado automaticamente quando for mais vantajoso que a soma das deduções legais.

### Redução do imposto — Lei 15.270/2025

A Lei 15.270/2025 (art. 3º-A da Lei 9.250/1995) criou uma redução aplicada **depois** do imposto calculado:

| Rendimento tributável do mês | Redução |
|---|---|
| Até R$ 5.000,00 | até R$ 312,89 — na prática o imposto fica zero |
| De R$ 5.000,01 até R$ 7.350,00 | R$ 978,62 − 0,133145 × rendimento tributável |

A redução nunca ultrapassa o imposto apurado e, pelo §3º, também se aplica à tributação exclusiva do 13º salário. Acima de R$ 7.350,00 de rendimento tributável mensal, não há redução.

### Exemplo numérico

Salário de R$ 6.000,00, um dependente, sem horas extras:

| Linha | Valor |
|---|---|
| Salário base | R$ 6.000,00 |
| INSS progressivo | R$ 641,51 |
| Base do IRRF (6.000,00 − 641,51 − 189,59) | R$ 5.168,90 |
| Imposto pela tabela (5.168,90 × 27,5% − 908,73) | R$ 512,72 |
| Redução Lei 15.270 (978,62 − 0,133145 × 6.000,00) | R$ 179,75 |
| IRRF retido | R$ 332,97 |

Neste caso, as deduções legais (R$ 831,10) superam o desconto simplificado de R$ 607,20, então a folha usa as legais. O assistente corporativo refaz essa comparação automaticamente a cada mês.

## Outros descontos

- **Plano de saúde e odontológico**: mensalidade do titular e dos dependentes, conforme o plano escolhido, mais eventual coparticipação do mês anterior.
- **Vale-transporte**: desconto de até **6% do salário base**, nos termos da Lei 7.418/1985, art. 9º, parágrafo único. Quem não usa transporte público pode cancelar o benefício.
- **Adiantamentos e empréstimos consignados**, quando contratados.
- **Previdência privada (PGBL)**, se houver contribuição por folha.
- **Faltas e atrasos** não justificados, incluindo o reflexo sobre o DSR da semana.

## Informativos

- **FGTS**: a Nimbus deposita **8% da remuneração** em conta vinculada do FGTS (Lei 8.036/1990, art. 15). O valor aparece como informativo porque não é desconto; é custo do empregador.
- **Base de INSS**, **base de FGTS** e **base de IRRF** são exibidas para conferência.
- **Salário-família**, quando aplicável pelos critérios do INSS.

## Perguntas frequentes

### Por que o desconto de INSS não é o salário inteiro vezes 14%?

Porque a tabela é progressiva desde 2020: cada alíquota incide só sobre a parcela do salário dentro da faixa. A alíquota efetiva é sempre menor que a nominal da última faixa.

### O desconto simplificado de R$ 607,20 substitui o dependente?

Sim. Ou você usa o simplificado, ou usa a soma das deduções legais (INSS + dependentes + pensão alimentícia). A folha aplica o que resultar em menos imposto.

### Recebi férias e o IRRF ficou alto. Está errado?

Normalmente não. No mês de férias a base pode somar salário, férias e terço, o que empurra o total para faixas superiores. O abono pecuniário e seu terço, por outro lado, são isentos.

### O FGTS some do meu líquido?

Não. O FGTS é depositado pela empresa em conta vinculada na Caixa e aparece no holerite apenas como informação.

### Onde vejo a base usada no meu IRRF?

No bloco de bases do holerite. O assistente corporativo também mostra a memória de cálculo mês a mês com os seus dados reais.

### Meu vale-transporte está descontando 6% mesmo em mês de férias?

O desconto é proporcional aos dias efetivamente trabalhados; em meses com férias ele cai na mesma proporção dos créditos emitidos.
