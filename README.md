# SISBAR

**Sistema Integrado de Bar** para controle de vendas, estoque, usuários e gestão financeira de bebidas e produtos não alcoólicos.

O projeto foi criado para substituir registros manuais por um fluxo digital simples para o usuário e completo para a administração.

## Visão geral

O SISBAR possui duas experiências integradas:

- uma loja para consulta do catálogo, registro de retirada e acompanhamento do próprio extrato;
- um painel administrativo para gestão de vendas, recebimentos, estoque, usuários, relatórios e finanças.

A aplicação é responsiva e instalável como PWA em Android e iOS.

## Principais funcionalidades

### Loja e usuários

- catálogo por categorias e disponibilidade em estoque;
- carrinho com limite baseado na quantidade disponível;
- registro de retirada e atualização imediata do estoque;
- pagamento imediato ou lançamento para pagamento posterior;
- cadastro e autenticação por matrícula e PIN;
- perfil com nome, OM, ramal e telefone;
- extrato individual, saldo e histórico de compras;
- comprovante após a conclusão da retirada;
- instalação como aplicativo pelo navegador.

### Administração

- visão geral de vendas, recebimentos e estoque baixo;
- acompanhamento de vendas pendentes, parciais, pagas e canceladas;
- contas a receber por usuário;
- cadastro, edição, ativação e remoção controlada de produtos;
- imagens de produtos com validação e otimização;
- entrada e ajuste de estoque;
- cadastro e administração de usuários;
- venda manual pelo administrador;
- cancelamento auditável de vendas com devolução ao estoque;
- relatório mensal e exportação em CSV;
- QR Code e configurações da operação.

### Gestão financeira

- cadastro de fornecedores;
- registro de compras e custo unitário dos produtos;
- controle de despesas;
- contas pagas e pendentes;
- fluxo de caixa realizado;
- acompanhamento de faturamento;
- cálculo de lucro bruto e lucro líquido;
- histórico de lançamentos e cancelamentos.

## Tecnologias

- **Next.js 16**
- **React 19**
- **TypeScript**
- **Tailwind CSS**
- **shadcn/ui e Base UI**
- **Supabase**
  - PostgreSQL
  - Storage
  - Edge Functions
  - funções transacionais
- **Vinext e Vite**
- **Cloudflare Workers**
- **Progressive Web App**
- **Node.js Test Runner**

## Arquitetura e segurança

O frontend consome uma API central implementada como Supabase Edge Function. As ações sensíveis são validadas no servidor antes de acessar o banco.

O projeto inclui:

- sessões com tokens armazenados de forma hash no banco;
- PIN armazenado com hash;
- bloqueio temporário após tentativas inválidas;
- separação entre usuário e administrador;
- validação de autorização nas operações administrativas;
- rotinas transacionais para venda, estoque e cadastro de produtos;
- cancelamento de venda com restauração de estoque;
- registros de auditoria;
- validação de tipo e tamanho das imagens;
- uso de chave pública no frontend e chave privilegiada somente no servidor.

A chave pública do Supabase pode estar no cliente. A \`service_role\` ou qualquer chave secreta deve permanecer exclusivamente no ambiente protegido da Edge Function.

## Execução local

### Pré-requisitos

- Node.js 22.13 ou superior;
- npm;
- projeto Supabase configurado;
- Edge Function \`sisbar-api\` publicada.

### Instalação

```bash
git clone https://github.com/GTmaced01/sisbar.git
cd sisbar
npm ci
npm run dev
```

A configuração do backend está em \`supabase/\`. Credenciais privadas não devem ser adicionadas ao repositório.

## Validação

```bash
npm run lint
npm test
npm run build
```

## Estrutura principal

```text
app/
  employee-store.tsx     loja e área do usuário
  admin-dashboard.tsx    administração
  finance-dashboard.tsx  gestão financeira
components/              componentes de interface e PWA
lib/                     cliente da API e tipos
supabase/
  functions/sisbar-api/  API da aplicação
  migrations/            evolução do banco
tests/                   testes automatizados
worker/                  entrada para Cloudflare Workers
```

## PWA

O projeto inclui manifest, service worker, ícones para Android e iOS e uma interface de instalação. Em navegadores compatíveis, o SISBAR pode ser adicionado à tela inicial e executado em modo independente.

## Status

Projeto em desenvolvimento ativo. A implantação e a infraestrutura devem ser validadas antes do uso em produção.

## Autor

Desenvolvido por [Gustavo Medeiros](https://github.com/GTmaced01).

## Uso do código

Este projeto **não é open source**. O código é disponibilizado publicamente para demonstração e avaliação técnica de portfólio, sem concessão de licença para uso, modificação, redistribuição ou exploração comercial.

Contribuições externas não são aceitas no momento. Todos os direitos reservados ao autor.
