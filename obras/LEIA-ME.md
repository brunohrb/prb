# Bandeira Obras — Sistema de Gestão de Manutenções

## Como configurar (passo a passo)

### 1. Supabase — Criar o banco de dados

1. Acesse [supabase.com](https://supabase.com) e entre no seu projeto
2. No menu lateral, vá em **SQL Editor**
3. Cole todo o conteúdo do arquivo `supabase-schema.sql` e clique em **Run**
4. Vá em **Storage** → clique em **New Bucket**, nome: `obras-fotos`, marque como **Public**
5. Vá em **Authentication** → **URL Configuration** e adicione o domínio do seu site no campo **Site URL**

### 2. Supabase — Pegar as credenciais

1. Vá em **Settings** → **API**
2. Copie a **Project URL** e a **anon public key**
3. Abra o arquivo `js/config.js` e substitua:
   ```
   COLE_AQUI_SUA_URL_DO_SUPABASE  →  https://xxxxx.supabase.co
   COLE_AQUI_SUA_CHAVE_ANON_DO_SUPABASE  →  eyJ...
   ```

### 3. Criar os primeiros usuários

1. No Supabase, vá em **Authentication** → **Users** → **Add User**
2. Crie os sócios e o responsável pelas obras
3. Depois no **SQL Editor**, execute para definir os perfis:
   ```sql
   UPDATE profiles SET role = 'socio', name = 'Nome do Sócio' WHERE email = 'socio@email.com';
   UPDATE profiles SET role = 'responsavel', name = 'Nome do Responsável' WHERE email = 'responsavel@email.com';
   ```

### 4. GitHub Pages — Publicar o site

1. Crie um repositório no GitHub (ex: `bandeira-obras`)
2. Faça upload de todos os arquivos desta pasta
3. Vá em **Settings** → **Pages** → Source: **main branch** → pasta **/ (root)**
4. Aguarde ~1 min e o site estará disponível em: `https://seu-usuario.github.io/bandeira-obras`

### 5. Instalar como app no celular

**Android:**
- Abra o site no Chrome
- Menu (⋮) → "Adicionar à tela inicial"

**iPhone:**
- Abra o site no Safari
- Botão de compartilhar (↑) → "Adicionar à Tela de Início"

---

## Funcionalidades

- **Sócios** podem: criar pendências, adicionar fotos, definir urgência e prazo, ver todas as pendências, receber notificações quando concluído
- **Responsável pelas Obras** pode: ver todas as pendências, marcar como "Em andamento" ou "Concluído", adicionar observações, receber notificações de novas pendências em tempo real
- **Filtros** por status, imóvel e urgência
- **Fotos** via câmera ou galeria (comprimidas automaticamente)
- **Notificações em tempo real** via Supabase Realtime
- **PWA** — funciona como app no celular, sem precisar de loja

---

## Estrutura de arquivos

```
bandeira-obras/
├── index.html          — App principal
├── manifest.json       — Configuração PWA
├── sw.js               — Service Worker (cache e notificações)
├── supabase-schema.sql — Script do banco de dados
├── LEIA-ME.md          — Este arquivo
├── assets/
│   └── logo.png
├── css/
│   └── style.css
└── js/
    ├── config.js       — ⚠️ Coloque suas credenciais aqui
    ├── auth.js         — Autenticação
    ├── properties.js   — Imóveis
    ├── requests.js     — Pendências
    ├── notifications.js — Notificações em tempo real
    └── app.js          — Controlador principal
```
