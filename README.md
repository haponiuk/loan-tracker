# Loan Tracker

React/Vite застосунок для перегляду боржників, позик, повернень і рейтингу боржника.

Продакшн-архітектура:

- frontend: Vite + React
- database/API: Supabase
- hosting: Vercel
- source control: GitHub

## Локальний запуск

```bash
npm install
npm run dev
```

Frontend буде доступний на `http://localhost:5173`.

## Supabase

1. Відкрий Supabase SQL Editor.
2. Виконай SQL з `supabase/schema.sql`.
3. Додай env-змінні локально і на Vercel:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://zmusanlelrmmrurixgxf.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
```

Для переносу поточних локальних даних у Supabase потрібен service role key:

```bash
SUPABASE_DATABASE_URL=...
npm run supabase:migrate

SUPABASE_SERVICE_ROLE_KEY=...
npm run supabase:seed
```

Seed читає локальний PostgreSQL, переносить `debtors`, `loans`, `repayments` і завантажує локальні фото в Supabase Storage bucket `debtor-photos`. У Supabase всі `id` та `debtor_id` є `BIGINT`.

## Legacy Local Postgres

Локальна PostgreSQL-версія залишена тільки для резервного запуску:

```bash
npm run db:start
npm run db:migrate
npm run dev:local-api
```

## Vercel

Build command: `npm run build`

Output directory: `dist`

Environment variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
