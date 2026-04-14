# CLAUDE.md

Notas de contexto deste repositório para quem (ou o que) for trabalhar nele.

## Visão geral

Este repositório hospeda **dois apps estáticos independentes**, publicados via GitHub Pages (`https://brunohrb.github.io/prb/`):

| App | Pasta | Descrição |
|-----|-------|-----------|
| **PRB Participação** | raiz (`index.html`) | Controle de pró-labore / financeiro da holding. |
| **Bandeira Obras** | `obras/` | Gestão de pendências e manutenção de imóveis / grandes obras. |

Os dois são HTML+JS puro servidos como página estática. Não há build step — alterar o arquivo e commitar já publica. O refresh em produção depende do GitHub Pages (pode levar 1–2 minutos) e do service worker (`sw.js` na raiz e em `obras/sw.js`) que agressivamente guarda em cache — após um deploy, usar `Ctrl+Shift+R` no desktop ou fechar/reabrir o site no celular para forçar atualização.

## Stack

- **Frontend:** HTML + JavaScript vanilla (sem framework), CSS inline/bundle.
- **Backend / Auth:** Supabase (projeto `Texnet`). Instanciado via CDN: `@supabase/supabase-js@2`.
- **Persistência:** tabelas Postgres no Supabase (RLS ativado). SQL de setup em `obras/supabase-install.sql` e patches numerados (`supabase-patch-XX.sql`).
- **Hospedagem:** GitHub Pages na branch `main`.
- **PWA:** manifest + service worker em `obras/`.

## Autenticação

Ambos os apps usam **Supabase Auth (e-mail + senha)**, mas os usuários cadastrados vivem em dois grupos distintos:

- **PRB** — usuários com e-mails "reais" (ex.: `brunohrb@gmail.com`, `paulo@texnet.com.br`, `rafael@texnet.com.br`, `financeiro@texnet.com.br`).
- **Obras** — usuários com e-mail no domínio `@bandeira.app` (ex.: `bruno@bandeira.app`, `paulo@bandeira.app`, etc.).

**Não misture os dois domínios.** Um usuário do Obras geralmente **não** está cadastrado no PRB e vice-versa. Mesmo tendo o "mesmo nome", são contas diferentes do Supabase com senhas diferentes.

### Apelidos curtos no login

Para evitar digitar o e-mail inteiro, cada app tem um **mapa de apelidos** em JS que converte o valor digitado antes de chamar `signInWithPassword`:

- PRB (`index.html`, função `login()`): mapa fixo — `bruno`, `paulo`, `rafael`, `financeiro` → e-mail real.
- Obras (`obras/js/auth.js`, função `toEmail`): acrescenta `@bandeira.app` ao que foi digitado.

Se digitado já contém `@`, o valor passa direto (permite login como e-mail completo).

### Autorização além do Supabase Auth

O PRB tem uma **segunda checagem** após o `signInWithPassword`:

```js
const { data: usuarioSistema } = await supabaseClient
  .from("usuarios").select("*").eq("id", session.user.id).maybeSingle();
if (!usuarioSistema) { alert("Usuário não autorizado."); ... }
```

Ou seja, além de existir em `auth.users`, o usuário precisa de uma linha correspondente na tabela `usuarios` (com campos como `perfil`, `socio`). Sem essa linha, o app expulsa o usuário com alerta "Usuário não autorizado".

O Obras tem um padrão parecido com a tabela `profiles`.

### Login automático / credenciais salvas

O PRB guarda `saved_email` e `saved_pass` no `localStorage` quando o checkbox **"Gravar senha"** está marcado. No carregamento, se não houver sessão Supabase ativa, tenta um login silencioso usando essas credenciais. `logout()` apaga essas chaves.

Esse padrão **prioriza conveniência sobre segurança** (senha em texto puro no navegador). É aceitável porque o app é de uso interno de uma pessoa/equipe pequena. Se o escopo aumentar, trocar por algo baseado só no refresh token do Supabase.

## Convenções / coisas a evitar

- **Nunca** commitar senhas, service-role keys, ou qualquer segredo — o repositório é **público**. Somente a `anon key` do Supabase pode aparecer no frontend (é pública por design, protegida por RLS).
- **Nunca** guardar passwords de múltiplos usuários em código (ex.: `const senhas = { bruno: "..." }`) — idem, repo é público.
- Ao trocar o mapeamento `apelido → e-mail` no PRB (`index.html`, função `login()`), confirmar que o e-mail existe em `auth.users` **E** tem linha correspondente em `usuarios`, senão a pessoa recebe "Usuário não autorizado".
- Alterações em `sw.js` podem precisar de bump de versão do cache para forçar clientes a baixarem a nova versão.
- Arquivos SQL (`obras/supabase-install.sql`, `supabase-patch-XX.sql`) são a fonte de verdade do schema do Obras — se editar tabela/policy pelo painel Supabase, refletir aqui também.

## Fluxo de alterações

- Desenvolver em uma branch (ex.: `claude/xxx`).
- Abrir PR contra `main`; merge puxa para o Pages.
- Após merge, aguardar o Pages atualizar (1–2 min) e forçar refresh no cliente (service worker).

## Reset de senha

- Pelo painel Supabase: **Authentication → Users → ... → Send password recovery** (envia e-mail) ou edita direto.
- Via SQL Editor (quando o e-mail não está acessível):

  ```sql
  UPDATE auth.users
     SET encrypted_password = crypt('NOVA_SENHA', gen_salt('bf')),
         updated_at = now()
   WHERE email = 'usuario@dominio.com';
  ```

  Após rodar, **apagar o texto do editor** para a senha não ficar visível no histórico.

- Dentro do app (PRB): aba **Configurações → "Alterar minha senha"** — usa `supabaseClient.auth.updateUser({password})` na sessão atual. Ao alterar, o `localStorage` do PRB é atualizado automaticamente para manter o login automático funcionando.

## Usuários cadastrados hoje (referência rápida)

Snapshot em 2026-04 — confirmar no painel do Supabase antes de mudanças importantes.

PRB:
- `brunohrb@gmail.com` (Bruno)
- `paulo@texnet.com.br` (Paulo) — a confirmar
- `rafael@texnet.com.br` (Rafael) — a confirmar
- `financeiro@texnet.com.br` (financeiro / Joice)

Obras:
- `bruno@bandeira.app`, `paulo@bandeira.app`, `rafael@bandeira.app`, `cassiano@bandeira.app`, `ellen@bandeira.app`, `tatiana@bandeira.app`.
