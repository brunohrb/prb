# Bandeira Obras — Sistema de Gestão de Manutenções + Financeiro

## Como configurar

### 1. Banco de dados (mesmo projeto do /prb)

O app usa o **mesmo projeto Supabase do PRB** porém num schema próprio (`obras`)
para não misturar tabelas com o sistema financeiro do PRB.

1. Entre em: https://supabase.com/dashboard/project/xuwwgprchhfshrqdhuqn/sql
2. Abra o **SQL Editor**, cole o conteúdo de `supabase-install.sql` e clique **Run**
3. Vá em **Settings → API → "Exposed schemas"** e **adicione `obras`**
   (deixe: `public, graphql_public, obras`)
4. Pronto — tabelas, RLS, realtime, storage e os 6 usuários estão criados

### 2. Usuários já criados pelo install

| Usuário   | Senha      | Papel        |
|-----------|------------|--------------|
| bruno     | 04958346   | socio        |
| paulo     | 186207     | socio        |
| rafael    | 174707     | socio        |
| cassiano  | 123456     | socio        |
| ellen     | 04958346   | responsavel  |
| tatiana   | 186207     | responsavel  |

> Para mudar o papel de alguém:
> ```sql
> UPDATE obras.profiles SET role = 'responsavel' WHERE email = 'bruno@bandeira.app';
> ```

### 3. GitHub Pages — publicar o site

1. `git push` da branch
2. Settings → Pages → Source: branch `main` → pasta `/obras`

---

## Funcionalidades

### Gestão de manutenções
- **Sócios** criam pendências, adicionam fotos, definem urgência/prazo
- **Responsável pelas Obras** altera status (pendente → em andamento → concluído)
- Filtros por status, imóvel, urgência
- Grandes Obras (projetos) para obras maiores

### 💰 Sistema Financeiro (novo)
- **Responsáveis** lançam os gastos diários direcionando para o pró-labore correto:
  - 👤 **Sócio** — notifica apenas o sócio escolhido
  - 👪 **Família** — notifica TODOS os sócios
  - 🏗️ **Obra** — notifica TODOS os sócios
- Categorias: 🧱 Material, 🔧 Serviço, 👷 Mão-de-obra, 📦 Outros
- **Pagamento da Semana**: agrupa por prestador (pedreiro, pintor...), soma o total
  aberto e tem campo pra salvar a chave **PIX** e marcar a semana como paga
- **Notificações roxas** para distinguir visualmente das notificações do
  sistema F do PRB (que usa azul)

---

## Estrutura de arquivos

```
obras/
├── index.html            — App principal (todas as views)
├── manifest.json         — PWA
├── sw.js                 — Service Worker
├── supabase-install.sql  — SQL único de instalação (schema `obras`)
├── LEIA-ME.md            — Este arquivo
├── assets/               — logo.png
├── css/style.css         — Estilos
└── js/
    ├── config.js         — URL Supabase + schema `obras`
    ├── auth.js           — Autenticação (usuário simples, biometria)
    ├── properties.js     — Imóveis
    ├── projects.js       — Grandes Obras
    ├── requests.js       — Pendências
    ├── finance.js        — 💰 Gastos + lista semanal de prestadores
    ├── notifications.js  — Notificações (com tipos de gasto)
    └── app.js            — Controlador principal e navegação
```
