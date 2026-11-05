# Arquitetura — Almox ERP · U.C.A. v2

Next.js 16/React/TypeScript, API HTTP autenticada, Prisma 6 e PostgreSQL 16+. O destino operacional é Supabase PostgreSQL, com Supabase Auth como único provedor de identidade ativo. O cliente chama a API Next.js; não consulta tabelas operacionais pelo SDK Supabase. Não há escrita offline ou sincronização entre provedores.

## Camadas e segurança

```text
Navegador/PWA
  ├─ páginas públicas de login/recuperação
  └─ interface autenticada → API Next.js
                              ├─ Supabase Auth: identidade validada
                              ├─ User + UnitMembership: escopo/permissão
                              ├─ Zod + serviços de domínio
                              └─ Prisma → PostgreSQL do Supabase
```

`src/lib/supabase/server.ts` mantém sessão em cookies HttpOnly/SameSite, Secure sob HTTPS. `getSession()` valida identidade no Supabase, usuário interno ativo, organização/unidade ativa e vínculo correspondente ao cookie `almox_unit`. Não confia em `unitId` do formulário para conceder acesso. Permissões vêm do perfil do vínculo selecionado; uma pessoa pode ter perfis diferentes por unidade.

Mutações verificam origem HTTP e autorização no servidor. `APP_URL` define a origem principal; extras são explícitas em `APP_ALLOWED_ORIGINS`. O domínio válido do deployment Vercel pode ser reconhecido pelo ambiente da plataforma. Não há confiança em `Host` arbitrário, wildcard ou retorno externo.

Conta Supabase não concede acesso automaticamente. A associação única `User.authUserId` é criada por processo autorizado. `User.id` permanece como referência interna do histórico. `User.passwordHash`, `User.roleId` e `Session` legados são preservados, mas não autenticam nem definem permissões atuais.

A migration habilita RLS nas tabelas do ERP, revoga privilégios de `PUBLIC`, `anon` e `authenticated` e não cria policies amplas de Data API. Prisma usa credencial de servidor com privilégios apropriados fora do acesso cliente. Uma conexão administrativa não fornece autorização por usuário: o isolamento depende das verificações obrigatórias do backend, complementadas por FKs. Essa conexão e a chave `service_role` nunca vão ao navegador. A configuração efetiva do projeto remoto precisa ser verificada após implantação.

## Modelo relacional

| Grupo | Entidades e finalidade |
| --- | --- |
| Identidade/acesso | `User`, `Role`, `Permission`, `RolePermission`, `UnitMembership`: identidade associada ao usuário interno e perfil por unidade. |
| Instituições | `Organization`, `OperationalUnit`: unidade como escopo de catálogo, estoque e documentos. |
| Catálogo/físico | `Product`, `Category`, `Supplier`, `Warehouse`, `Location`, `ImageAsset`: árvore de localizações com pai opcional e níveis livres. |
| Estoque | `InventoryBalance`, `StockMovement`: saldo único produto/local e livro com antes/depois. |
| Inventário | `InventoryCount`, `InventoryCountItem`: proposta física, snapshot/versionamento e aprovação. |
| O.S./O.P. | `WorkOrder`, `OrderMaterial`, `OrderEvent`: requisição por produto/local, compromissos, consumo, devolução e eventos. |
| Compras | `PurchaseOrder`, `PurchaseOrderItem`, `Receipt`, `ReceiptItem`: pedido/recebimentos ligados às entradas. |
| Controle | `AuditLog`, `IdempotencyRecord`, `AppSettings`, `LoginAttempt`: auditoria, deduplicação, configuração e limitação de tentativas de acesso. |
| Legado | `Session` e campos antigos de autenticação: preservação sem autenticação ativa. |

UUIDs, FKs, índices e constraints são definidos no schema/migrations. Códigos internos, SKU e códigos físicos têm unicidade conforme o escopo do modelo. FKs compostas impedem relações entre unidades, e o escopo já atribuído é imutável.

`unitId` é anulável em tabelas legadas para migração conservadora. Novas operações exigem escopo; consultas mostram somente unidade autorizada. Registros antigos com `NULL` ficam em quarentena até classificação aprovada. Não são excluídos nem zerados. Consulte `MIGRATION-SUPABASE.md` para snapshots e reconciliação.

## Invariantes de estoque

`Product` não é fonte de quantidade. `InventoryBalance.quantity` representa o registrado (`Q`) por produto/localização; os materiais das ordens fornecem reservado (`R`) e aplicado pendente de baixa (`A`):

```text
Físico na localização = Q − A
Disponível para nova operação = Q − A − R
```

Reservar não soma saldo. Aplicar exige reserva e transfere `R` para `A`, sem saída definitiva. Faturar reduz `Q` e `A` juntos e gera saída vinculada ao material da ordem. A quantidade física permanece coerente: o material saiu da prateleira quando aplicado.

Saídas avulsas/transferências validam o disponível, sem consumir reservas/aplicações. Estoque negativo fica bloqueado mesmo diante de configuração legada divergente. Produtos/locais devem estar ativos e na unidade do ator. Não há conversão automática de unidade.

Custos ausentes no produto, pedido e recebimento permanecem nulos; a migration de custo opcional preserva todos os valores antigos, inclusive zero, sem inferir seu significado. Quantidades usam decimal exato com até três casas e validação de faixa. Operações críticas executam transações serializáveis com repetição limitada em conflito. Saldo, histórico, auditoria e idempotência confirmam ou revertem juntos. A chave é vinculada ao ator, unidade, operação e conteúdo; reutilização com outro conteúdo é recusada.

Transferências mudam origem/destino atomicamente, preservam total e não cruzam unidades. Não há endpoint para apagar/editar movimentos concluídos. Correções usam compensações ou ajuste aprovado.

## Fluxos de domínio

**Compra:** pedido → recebimento parcial/completo com documento real → entrada por item → atualização do recebido → conclusão quando totalmente atendido. Qualquer falha reverte o recebimento inteiro. A vinculação única entre item recebido e movimento evita dupla entrada. Receber acima do pendente é recusado. Pedido com recebimento não pode ser cancelado para apagar efeitos; correções exigem rastreabilidade. Custo previsto e custo efetivo informado no recebimento permanecem separados; ausência do efetivo é `NULL`.

**O.S./O.P.:** criar → requisitar produto/local → reservar → aplicar → faturar. Faturamento fica bloqueado enquanto qualquer quantidade requisitada não estiver atendida. Requer referência e `orders:invoice`; não emite documento fiscal. Consumo por material é único além da idempotência. Devolução pré-faturamento reduz aplicação; pós-faturamento cria entrada ligada à saída original e não pode exceder o consumo ainda não devolvido. Cancelamento exige devolver aplicações pendentes e libera reservas com evento/auditoria. Devolver não reabre ordem faturada automaticamente.

**Inventário:** snapshot físico → contagem → aprovação autorizada → ajuste. A comparação é com `Q − A`; o registrado aprovado é `contado + A`, preservando materiais fora da prateleira. Mudança de comprometimentos também altera a versão do saldo. Aprovação recusa snapshot obsoleto ou resultado disponível negativo.

**QR:** URL de localização → câmera/código manual → validação de formato/origem → resolução na unidade → materiais → movimentação autorizada → histórico. QR não armazena quantidade ou credencial, não concede acesso e não troca a unidade implicitamente.

## Contrato HTTP

Sucesso JSON usa `{data: ...}`; erro usa mensagem tratada e status apropriado. Datas são ISO e decimais serializados como texto. Custos/credenciais são removidos antes da resposta, inclusive em estruturas aninhadas/auditoria, conforme autorização.

| Endpoint | Finalidade |
| --- | --- |
| `POST /api/auth/login`, `/logout`, `/recover`, `/update-password` | Sessão, recuperação e senha via Supabase. |
| `GET /auth/callback`, `/auth/confirm` | Código/TokenHash e retorno interno seguro. |
| `GET /api/me`, `POST /api/unit` | Identidade, vínculos e seleção validada/auditada. |
| `GET /api/data`, `/api/search` | Dados/busca da unidade. |
| `/api/catalog/[entity]`, `/[id]` | CRUD/arquivamento autorizado de cadastros. |
| `POST /api/movements` | Entrada, saída, transferência; ajuste somente por inventário. |
| `POST /api/inventory`, `/[id]/approve` | Proposta e aprovação com permissão própria. |
| `/api/orders`, `/[id]`, `/[id]/actions` | Ordens e `REQUEST`, `RESERVE`, `RELEASE`, `APPLY`, `RETURN`, `INVOICE`, `CANCEL`. |
| `/api/purchases`, `/[id]`, `/[id]/receive`, `/[id]/cancel` | Pedido, consulta, recebimento e cancelamento permitido. |
| `GET /api/qr/[id]`, `/api/resolve` | QR autenticado e resolução. |
| `GET /api/reports`, `/api/files/[id]`; `POST /api/upload` | Relatórios/imagens no escopo autorizado. |
| `/api/settings` | Configuração da unidade; ativar negativo é recusado. |
| `GET /api/health` | HTTP/conexão PostgreSQL; não comprova Auth/SMTP. |

Schemas Zod dos serviços são a referência de payload e recusam campos não previstos. Usuários são convidados/vinculados via Supabase, sem senha local no cadastro. O backend impede remover o último administrador da unidade ou alterar/desativar o próprio perfil administrativo por essa tela.

Permissões iniciais: `catalog:write`, `stock:move`, `inventory:count`, `inventory:adjust`, `reports:read`, `costs:read`, `users:manage`, `settings:manage`, `records:delete`, `orders:read`, `orders:write`, `orders:apply`, `orders:invoice`, `purchases:read`, `purchases:write`, `purchases:receive`. A matriz está no README/seed.

## Interface e limites

A interface carrega contexto real por `/api/data`, envia ações aos serviços e atualiza após confirmação. Trocar unidade descarta contexto anterior; isso complementa a validação de cada requisição. Login usa imagens locais legítimas, com comportamento reduzido para `prefers-reduced-motion` e touch. Leitor/etiquetas são componentes separados; impressão possui CSS próprio.

CSV/Excel usam consultas autorizadas; PDF é impressão. Service worker mantém só recursos públicos/fallback; páginas/API autenticadas não são cacheadas e não há fila offline.

Catálogo/saldos ainda são carregados integralmente; histórico recente tem limites e exportação recusa mais de 50.000 linhas. Compras/ordens têm paginação no servidor. Evolua volume a partir de medidas reais, preservando escopo/transações.

Integração fiscal/financeira, transferências entre empresas, mínimos por local, conversões, lotes/séries/validade e custo automático por ordem não estão implementados. Serviços concentram as regras para expansão: integrações futuras devem chamá-los com identidade/idempotência, não escrever saldos diretamente. Migração local testada não comprova migração remota; consulte `VALIDATION.md`.
