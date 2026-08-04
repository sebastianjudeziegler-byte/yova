# YOVA database

The migrations in `migrations/` are the source of truth for the first cloud database. They create product data for profiles, plans, sessions, materials metadata, attempts, and an event history for cautious observed personalization. The second migration adds an authenticated transaction that saves a generated learning item, plan, and all plan sessions together.

Nothing in this folder contains a live password or API secret. When a Supabase project is created, its public URL and publishable key go in `.env.local`, which is intentionally ignored.

The important safety rule is Row Level Security (RLS): every read and write must match the signed-in user's ID. The browser never receives a service-role key.

The application is not connected to a live Supabase project yet. Do not describe browser-only account entry as real authentication until the project URL, publishable key, migrations, and auth callback flow are active and tested.
