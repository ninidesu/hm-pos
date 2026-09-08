# HM POS

Standalone manager and cashier workspace for HM POS.

## Included

- Admin / Manager dashboard
- Transaction history with XLSX and PDF export
- Menu management
- Inventory management with stock adjustments
- Cashier account management
- Cashier POS with Cash / GCash / Bank Transfer payments, receipt preview, and stock visibility on menu cards
- Direct local portal account creation with username and password (no invitation, email, OTP, or Edge Function)

## Data policy

This project ships without menu, inventory, user, or transaction data. There is no runtime sample-data fallback and no seed catalog. Connect it to a separate Supabase project before signing in.

## Run locally

1. Copy `.env.example` to `.env`.
2. Add the URL and anon key for the new HM POS Supabase project.
3. Install dependencies with `npm install`.
4. Start the app with `npm run dev`.

The portal is available at `/portal`. Admins use `/admin`; cashiers use `/cashier`.

## Database

For a new Supabase project, run [`supabase/hm_pos_schema.sql`](supabase/hm_pos_schema.sql) once in the SQL Editor. The core public tables are `users`, `menu_items`, `transactions`, `stock`, and `orders`; order lines, categories, add-ons, audit history, preferences, and system settings are supporting tables.

The installer does not create benefits, delivery-area, ingredient, recipe, finished-product, or supplies tables. It also creates the RLS policies, storage buckets, and server-side cashier checkout RPC used by the app.

If the previous HM POS schema has already been run in the same Supabase project and you want to discard its data, first run [`supabase/hm_pos_reset_existing_schema.sql`](supabase/hm_pos_reset_existing_schema.sql), then run `hm_pos_schema.sql`. The reset keeps `auth.users` login accounts but permanently deletes the previous HM POS tables and data.

If the canonical schema is already installed, apply [`supabase/migrations/20260908090000_direct_portal_user_management.sql`](supabase/migrations/20260908090000_direct_portal_user_management.sql) once, then apply [`supabase/migrations/20260909100000_allow_multiple_portal_users.sql`](supabase/migrations/20260909100000_allow_multiple_portal_users.sql). If the direct portal migration was already applied, only the newer migration is needed. Users & Access creates confirmed local accounts directly with a username and password; it does not send invitations, emails, or OTPs and does not require an Edge Function.

The system supports multiple portal accounts with the `admin` and `cashier` roles. Usernames must be unique, and every account is created with a confirmed local password. Orders are walk-in only. The system stores no general customer contact details and has no delivery, pickup, cancellation, or refund workflow—completed orders can only be voided by Admin / Manager.

The historical `supabase/migrations` folder is retained for reference; do not apply it to a new HM POS project after running the canonical installer.

Receipt identity can be configured with the optional `VITE_POS_*` values in `.env`.
