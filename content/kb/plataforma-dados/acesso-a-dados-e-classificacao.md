# Acesso a Dados e Classificação

*Documento fictício para demonstração. Nimbus Serviços Digitais S.A. é uma empresa inventada.*

## Princípios

1. **Menor privilégio**: acesso ao mínimo necessário, pelo menor tempo necessário.
2. **Acesso por grupo**, nunca por pessoa: permissões são concedidas a grupos ligados a papéis.
3. **Dono decide**: quem aprova é o dono do dado, não o time de Plataforma de Dados.
4. **Tudo registrado**: concessão, uso e revogação ficam em log de auditoria.
5. **Finalidade declarada**: não existe acesso "para o caso de precisar".

## Classificação de confidencialidade

Toda tabela registrada no catálogo **Atlas** tem exatamente uma classificação.

| Nível | Definição | Exemplos | Quem pode acessar |
|---|---|---|---|
| **Público** | pode ser divulgado fora da empresa sem dano | calendário de feriados, catálogo público de serviços | qualquer pessoa |
| **Interno** | uso interno; vazamento causa dano baixo | métricas agregadas de uso, dimensões de produto | colaboradores autenticados |
| **Confidencial** | vazamento causa dano relevante | faturamento por cliente, contratos, dados pessoais comuns | grupos aprovados pelo dono do dado |
| **Restrito** | vazamento causa dano grave ou legal | dados pessoais sensíveis, remuneração individual, credenciais | grupo nominal mínimo, acesso temporário e revisado |

Na dúvida entre dois níveis, aplica-se o **mais alto**. Reclassificação para um nível mais baixo exige aprovação do dono do dado e do time de Governança de IA.

## Dados pessoais e LGPD

Colunas que contenham dado pessoal são marcadas no Atlas com:

- a categoria (identificação, contato, financeiro, localização, saúde);
- se é **dado sensível** (LGPD, art. 5º, II);
- a **base legal** do tratamento (LGPD, art. 7º ou art. 11);
- a finalidade declarada e o prazo de retenção.

Regras operacionais:

- **Nenhum pipeline novo com dado pessoal entra em produção sem base legal registrada.** O CI bloqueia a promoção.
- Em `dev` e `stg`, dado pessoal é **anonimizado ou mascarado**; cópia de produção para ambiente de desenvolvimento é proibida.
- Dados pessoais sensíveis exigem classificação **restrito**, mascaramento por padrão e desmascaramento apenas por acesso temporário aprovado.
- Exportação de dado pessoal para fora da plataforma exige chamado aprovado e registro da finalidade.
- Relatórios agregados sobre pessoas respeitam a regra de **agregação mínima de 5**: grupos menores são suprimidos.

## Chamado DATA-ACCESS

Acesso a dados é solicitado por chamado do tipo **DATA-ACCESS**.

### O que informar

1. Tabela ou conjunto de tabelas (nome completo, com camada).
2. Tipo de acesso: leitura, leitura com desmascaramento, escrita.
3. **Finalidade de negócio**, em uma frase objetiva.
4. **Prazo**: permanente vinculado ao papel, ou temporário com data de término.
5. Grupo de destino (quando o acesso for para um papel) ou justificativa de acesso nominal.

### Fluxo

```
solicitação → triagem da Plataforma de Dados → aprovação do dono do dado
   → (restrito: aprovação adicional de Segurança da Informação)
   → provisionamento no grupo → notificação → revisão periódica
```

| Etapa | Prazo-alvo |
|---|---|
| Triagem | 1 dia útil |
| Aprovação do dono | 3 dias úteis |
| Provisionamento após aprovação | 1 dia útil |

Pedidos sem finalidade clara são devolvidos, não recusados: a devolução pede a informação faltante.

### Acesso temporário

Acesso a dado **restrito** ou com desmascaramento é sempre temporário, com prazo máximo de **30 dias**, renovável mediante nova justificativa. A expiração é automática — não depende de alguém lembrar de revogar.

## Revisão de acessos

- **Trimestral**: cada dono de dado revisa os grupos com acesso ao seu domínio e confirma ou revoga.
- **Por movimentação**: mudança de time ou de papel dispara revisão automática dos acessos do grupo de origem.
- **Por desligamento**: revogação imediata no desligamento, em todos os sistemas da plataforma.
- Acessos sem uso por **90 dias** são sinalizados no relatório de revisão e revogados por padrão.

## Uso indevido

Constituem violação, sujeitas ao Código de Conduta:

- consultar dados de colegas, clientes ou conhecidos por curiosidade;
- extrair dados para uso fora da plataforma sem aprovação;
- compartilhar resultado de consulta com dado confidencial em canais não autorizados;
- tentar reidentificar pessoas em conjuntos anonimizados;
- compartilhar credenciais ou executar consultas em nome de outra pessoa.

Consultas são registradas com identidade, horário e volume lido. Relatos de uso indevido vão para o Canal de Ética (https://etica.nimbus.example ou 0800 000 0000).

## Perguntas frequentes

### Quanto tempo leva um DATA-ACCESS?

Em geral 5 dias úteis: 1 de triagem, 3 de aprovação do dono e 1 de provisionamento.

### Quem aprova meu acesso?

O dono do dado. Para dados classificados como restrito, também o time de Segurança da Informação.

### Posso copiar uma tabela de produção para o meu ambiente de desenvolvimento?

Não. Em `dev` e `stg` usamos amostras anonimizadas ou mascaradas.

### Minha análise precisa do CPF do cliente. É possível?

Só com finalidade e base legal registradas, acesso temporário aprovado e desmascaramento específico. Na maioria dos casos, um identificador pseudonimizado resolve o problema analítico.

### Mudei de time. Meus acessos continuam?

Não automaticamente. A movimentação dispara revisão dos acessos do grupo de origem.

### O que acontece se eu consultar por curiosidade?

A consulta fica registrada e o uso indevido é tratado pelo Código de Conduta, com apuração pelo Canal de Ética.
