# Runbook de Incidentes

*Documento fictício para demonstração. Nimbus Serviços Digitais S.A. é uma empresa inventada.*

## O que é incidente

Incidente é qualquer evento que degrade ou interrompa um serviço de dados em produção: pipeline parado, tabela desatualizada além do SLA, dado incorreto publicado, consulta indisponível ou exposição indevida de dados.

Erro detectado e corrigido **antes** da publicação não é incidente — é o controle funcionando.

## Severidades

| Severidade | Critério | Resposta | Comunicação |
|---|---|---|---|
| **SEV1** | dado incorreto publicado para clientes ou áreas de decisão; exposição indevida de dados; plataforma indisponível | plantão acionado imediatamente, 24h | atualização a cada 30 minutos |
| **SEV2** | pipeline crítico parado, SLA de domínio importante estourado, painel de diretoria desatualizado | plantão acionado em horário comercial estendido (7h–22h) | atualização a cada 2 horas |
| **SEV3** | pipeline não crítico com falha, atraso sem impacto em decisão, degradação de desempenho | tratado no próximo dia útil | atualização diária |

A severidade pode ser **elevada a qualquer momento** e nunca deve ser rebaixada para evitar acionamento. Na dúvida entre dois níveis, assuma o mais alto e reclassifique depois.

Suspeita de **exposição de dados pessoais** é sempre SEV1 e exige acionamento imediato de `seguranca@nimbus.example` e `privacidade@nimbus.example`.

## Plantão

- Escala **semanal e rotativa** dentro do time de Plataforma de Dados, publicada com um mês de antecedência.
- **Primário** e **secundário**: o secundário é acionado se o primário não reconhecer o alerta em 15 minutos.
- Tempo-alvo de reconhecimento: **15 minutos** para SEV1, **1 hora** para SEV2.
- Quem está de plantão não assume trabalho planejado crítico na mesma semana.
- Plantão fora do horário de trabalho é compensado em banco de horas ou pago como hora extra, conforme acordado previamente com o gestor.
- Trocas de escala são combinadas entre as pessoas e registradas na ferramenta de plantão antes do início da semana.

## Fluxo de resposta

1. **Detectar**: alerta automático, reclamação de consumidor ou verificação de rotina.
2. **Classificar**: atribuir severidade e abrir o canal do incidente.
3. **Nomear papéis**:
   - *Comandante do incidente*: coordena, decide e comunica; não executa correção.
   - *Pessoa técnica*: investiga e aplica a correção.
   - *Comunicador*: mantém consumidores e áreas informados (em SEV1).
4. **Mitigar antes de corrigir**: pausar a publicação, reverter para o último snapshot válido, despromover a tabela ou sinalizar o painel como desatualizado. Restabelecer o serviço vem antes de entender a causa.
5. **Corrigir** a causa e reprocessar a janela afetada.
6. **Validar**: rodar os testes do domínio e reconciliar contagens com a origem.
7. **Comunicar o encerramento** com o impacto final e o que foi feito.
8. **Agendar o postmortem** em até 2 dias úteis.

## Comunicação

- **Canal dedicado** por incidente, criado na abertura e usado como linha do tempo oficial.
- **Primeira mensagem em até 15 minutos** do reconhecimento, mesmo sem diagnóstico: o que se sabe, o que está sendo feito, próxima atualização.
- Consumidores afetados são avisados **diretamente**, usando a linhagem registrada no Atlas para identificá-los.
- Em SEV1, a diretoria de Tecnologia é informada na abertura.
- Nada de diagnóstico especulativo em comunicação externa ao time: fatos, impacto e próximos passos.

### Modelo de mensagem

```
[SEV2] fct_pedidos desatualizada desde 06:00
Impacto: painel de vendas e relatórios de faturamento com dados de ontem.
Causa provável: falha na extração da fonte transacional.
Ação: reprocessamento em andamento.
Próxima atualização: 10:30.
```

## Mitigações mais comuns

| Sintoma | Primeira ação |
|---|---|
| Tabela desatualizada | verificar DAG, reexecutar tarefa idempotente da janela |
| Dado incorreto publicado | reverter para o snapshot anterior (time travel) e despromover a versão ruim |
| Falha de reconciliação | pausar a publicação, comparar contagens por partição com a origem |
| Consulta lenta generalizada | verificar arquivos pequenos e disparar compactação |
| Acesso indevido detectado | revogar o acesso, preservar os logs, acionar Segurança e Privacidade |

## Postmortem sem culpados

Todo SEV1 e SEV2 gera postmortem escrito em até **5 dias úteis**, com:

- linha do tempo factual, do primeiro sinal ao encerramento;
- impacto medido (quais consumidores, quanto tempo, quais decisões afetadas);
- causas contribuintes, em plural — incidentes raramente têm causa única;
- o que funcionou bem na resposta;
- ações corretivas com dono e prazo, registradas no backlog do time.

A cultura é **sem culpados**: a pergunta é "o que no sistema permitiu que isso acontecesse", nunca "quem errou". Nomes de pessoas não aparecem no documento; papéis, sim. Postmortem sem ação corretiva com dono e prazo é considerado incompleto e volta para revisão.

A revisão mensal de confiabilidade acompanha as ações corretivas pendentes e os alertas que não geraram ação.

## Perguntas frequentes

### Quando acionar SEV1?

Quando há dado incorreto publicado para clientes ou decisões, exposição indevida de dados ou indisponibilidade da plataforma. Na dúvida, abra como SEV1 e reclassifique depois.

### Sou o primário e não consigo resolver. O que faço?

Acione o secundário e, se necessário, escale ao gestor da área. Pedir ajuda cedo é comportamento esperado, não falha.

### Preciso achar a causa antes de comunicar?

Não. A primeira comunicação sai em até 15 minutos, mesmo sem diagnóstico.

### Quem escreve o postmortem?

O comandante do incidente, com contribuição de quem participou. O prazo é de 5 dias úteis para SEV1 e SEV2.

### O postmortem vai apontar quem causou o problema?

Não. A análise é sem culpados, centrada em causas sistêmicas, e não registra nomes de pessoas.

### Plantão fora do horário é pago?

É compensado em banco de horas ou pago como hora extra, conforme combinado previamente com o gestor.
