# Evidências — login e limites da IA 2.4.1

Componentes e build reais, dados de formulário fictícios e respostas OpenAI simuladas. Nenhuma chave enviada pelo usuário foi utilizada. Não houve autenticação real, consumo de créditos da API ou implantação.

- `build.log`, `lint.log`, `typecheck.log`: verificações da compilação e código.
- `tests.log`: suíte completa com 164 testes, incluindo banco PostgreSQL isolado, limites da IA e metadados de espera do cliente.
- `login-checks.json`, `login-browser.log`: cinco verificações do login no build de produção local. Matriz de 12 tamanhos, foto sem percurso/botões, formulário sem rolagem nas telas comuns, erros longos, teclado e recuperação. Em tela excepcionalmente pequena, a rolagem continua disponível para alcançar os campos.
- `ai-ui-checks.json`, `ai-browser.log`: cinco verificações do assistente com API fictícia, incluindo contagem, ausência de repetição automática, preservação da pergunta e orientação de faturamento.
- `*.png`: prévias das telas, incluindo espera temporária e cota de API.

A mensagem antiga do usuário não informa a causa específica do erro 429. A nova versão diferencia os casos pelo código da resposta. Não comprova nem altera o saldo da conta OpenAI.
