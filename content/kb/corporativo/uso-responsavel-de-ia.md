# Uso Responsável de IA

*Documento fictício para demonstração. Nimbus Serviços Digitais S.A. é uma empresa inventada.*

## Escopo

Esta política trata do uso do **assistente corporativo** e de ferramentas de inteligência artificial generativa no trabalho. O treinamento **Uso Responsável de IA Generativa** (1 hora, prazo 15/11/2026) é obrigatório para todos.

A regra de fundo é simples: a IA ajuda a redigir, resumir, explicar e consultar políticas; ela **não** assume responsabilidade por decisões. A responsabilidade continua sendo de quem usa o resultado.

## Aviso de transparência

> As conversas com o assistente corporativo são registradas para segurança e qualidade, mantidas por 180 dias e só podem ser lidas individualmente por pessoas autorizadas, com justificativa registrada.

Na prática:

- **Registro**: toda conversa é armazenada, com identidade do solicitante e horário.
- **Retenção**: **180 dias**; depois disso os registros são eliminados ou anonimizados.
- **Acesso individual**: somente por pessoas autorizadas e **apenas com justificativa registrada** em log de auditoria. Seu gestor **não** tem acesso às suas conversas.
- **Uso agregado**: estatísticas de uso e de perguntas não resolvidas são analisadas de forma agregada, respeitando a regra de agregação mínima de 5 pessoas.

## O que nunca deve ser colado em uma conversa

- **Senhas, tokens, chaves de API e certificados.** Nenhum deles, em nenhum contexto.
- **Dados pessoais de clientes**: nome, CPF, endereço, telefone, e-mail, dados de pagamento.
- **Dados pessoais sensíveis** de qualquer pessoa: saúde, biometria, origem racial, religião, opinião política, vida sexual.
- **Dados pessoais de colegas** que você não precisaria ver para fazer seu trabalho.
- **Conteúdo contratual confidencial** de clientes e fornecedores sem autorização.
- **Código-fonte com segredos embutidos** ou trechos sujeitos a restrição contratual.

As políticas de prevenção à perda de dados (**DLP**) analisam o conteúdo enviado: padrões de segredo e de dado pessoal **geram aviso ou bloqueio** antes do envio ao modelo. O bloqueio não é punição — é a última barreira antes de um vazamento.

### Como pedir sem expor dados

| Em vez de | Faça |
|---|---|
| colar a lista de clientes com CPF | descrever a estrutura dos campos e pedir a lógica |
| colar o token para "ver se está certo" | colar apenas o formato esperado, sem o valor |
| colar o atestado de um colega | perguntar a regra de prazos de atestado |
| colar o contrato inteiro do cliente | citar a cláusula em abstrato, sem identificar as partes |

Para dados do seu próprio vínculo — férias, holerite, benefícios —, você **não precisa colar nada**: o assistente acessa os seus dados com a sua identidade autenticada e responde sem que você digite informação pessoal.

## Identidade e acesso

- O assistente responde **sempre na identidade de quem pergunta**. Ninguém consulta dados de outra pessoa pedindo "em nome de".
- Gestores veem do time apenas o que a política de liderança permite; o assistente aplica o mesmo limite.
- Pedidos agregados respeitam a regra de **k = 5**: grupos com menos de 5 pessoas não são exibidos.
- Tentativas de contornar esses limites — inclusive por instruções criativas dentro da conversa — são registradas e tratadas como desvio de conduta.

## Verificação das respostas

Modelos de linguagem erram com aparência de segurança. Antes de usar uma resposta:

1. Confira a **citação da fonte**: respostas sobre política apontam o documento de origem.
2. Para números com efeito financeiro ou legal, confira a **memória de cálculo** apresentada.
3. Decisões sobre pessoas, dinheiro, contratos ou segurança **não** se baseiam só em uma resposta de IA: confirme com a área responsável.
4. Conteúdo externo gerado por IA e publicado em nome da empresa precisa de revisão humana antes da publicação.

## Ferramentas externas de IA

Ferramentas públicas de IA generativa só podem ser usadas com dados **públicos ou internos não sensíveis**, e nunca com dados pessoais, de clientes ou confidenciais. Ferramentas que exijam contrato específico passam pelo time de Governança de IA antes do uso. Na dúvida, use o assistente corporativo, que opera dentro dos controles da empresa.

## Perguntas frequentes

### Minhas conversas com o assistente ficam guardadas?

Sim, por 180 dias, para segurança e qualidade. A leitura individual exige autorização e justificativa registrada.

### Meu gestor pode ler o que eu perguntei?

Não. Gestores não têm acesso a conversas. O acesso individual é restrito a pessoas autorizadas, com justificativa em log.

### Posso colar um trecho de código para pedir ajuda?

Pode, desde que sem segredos (senhas, tokens, chaves) e sem dados pessoais reais. Substitua valores sensíveis por exemplos.

### O DLP bloqueou minha mensagem. O que fazer?

Reescreva sem o dado sensível. Se acreditar que foi um falso positivo, acione `seguranca@nimbus.example` descrevendo o caso.

### Posso perguntar sobre as férias de um colega?

Não. O assistente responde apenas na sua identidade, dentro das permissões do seu papel.

### Posso usar uma ferramenta pública de IA para resumir um contrato de cliente?

Não. Contratos de clientes são confidenciais. Use o assistente corporativo e remova identificações quando possível.
