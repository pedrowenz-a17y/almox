# Login mais limpo e diagnóstico de limites da IA — 2.4.1

O login mantém o vermelho U.C.A., a fotografia real e os efeitos discretos ao redor da composição. Foram removidos da foto o percurso luminoso, os três botões flutuantes, a legenda rotativa e o movimento contínuo da imagem. O formulário e a foto agora dividem a altura disponível, sem estender a página nas telas comuns.

No celular, a marca aparece em uma faixa compacta e o formulário recebe prioridade. Em telas excepcionalmente pequenas, com zoom elevado ou conteúdo de erro maior que o espaço, o acesso permanece rolável para não esconder campos. Não foi aplicado um bloqueio de rolagem global ao aplicativo. Recuperação de senha e demais páginas continuam acessíveis.

## O aviso da IA

A mensagem anterior, “A OpenAI informou limite ou cota indisponível”, era usada para qualquer erro 429 do provedor. Ela não permitia afirmar se faltavam créditos ou se era apenas excesso temporário de consultas. Agora a resposta diferencia:

| Situação                                   | Comportamento                                                                                               |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Cinco perguntas no minuto nesta instalação | Informa o limite local e o tempo restante.                                                                  |
| OpenAI informa excesso de frequência       | Usa o tempo de espera informado, com contagem antes de reenviar.                                            |
| OpenAI confirma `insufficient_quota`       | Orienta conferir faturamento, saldo e limites do projeto da API; não promete que esperar adiciona créditos. |
| Erro429 sem causa identificada             | Mantém a incerteza, sem afirmar que falta saldo.                                                            |

A pergunta digitada é preservada. Não há repetição automática da consulta nem tentativa de contornar cotas. A chave permanece somente no servidor e as mensagens internas da OpenAI não são repassadas ao usuário. A assinatura do ChatGPT e o faturamento da API são separados.

Esta correção identifica os casos corretamente, mas não adiciona créditos a uma conta da OpenAI. Confira a área de faturamento do projeto no painel da API se o novo aviso indicar cota indisponível. Use somente uma chave ativa e privada configurada no servidor; não envie valores pelo chat.

## Atualização no CMD

Extraia a nova versão em uma pasta própria e copie seu arquivo `.env` protegido para junto do `package.json`. As configurações ficam no arquivo, editado pelo Bloco de Notas. No CMD, execute somente os comandos:

```bat
npm ci
npm run build
npm start
```

Abra a origem definida em `APP_URL`, por exemplo `http://localhost:3000`, e mantenha o CMD aberto. Não houve mudança de estrutura do banco nesta revisão. Uma instalação que ainda não recebeu a versão 2.4 precisa seguir também o [guia de atualização operacional](CONTROLE-OPERACIONAL-2.4.md).

## Verificação

A compilação de produção, TypeScript, ESLint e a suíte completa de 164 testes passaram. A IA foi verificada somente com respostas simuladas, sem consumir créditos ou utilizar chaves reais. Cinco cenários de interface cobrem a espera temporária, a preservação da pergunta, a cota confirmada e o limite sem classificação. Evidências e prévias estão em [artifacts/login-ai-2.4.1](../artifacts/login-ai-2.4.1).

- [Login em computador](../artifacts/login-ai-2.4.1/login-desktop.png)
- [Login no celular](../artifacts/login-ai-2.4.1/login-mobile.png)
- [IA: espera temporária](../artifacts/login-ai-2.4.1/ia-limite-temporario.png)
- [IA: cota da API](../artifacts/login-ai-2.4.1/ia-cota-api.png)
