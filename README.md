# Bazodeal

Bazodeal is a React + Vite marketplace app connected to Supabase for auth, data, storage, and realtime updates.

## Quick start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your local env file:

   ```bash
   cp .env.example .env
   ```

3. Fill these values in `.env` from your Supabase project:

   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

4. Start the app:

   ```bash
   npm run dev
   ```

## Database setup

- Run the SQL in `src/bazodeal_schema.sql` using Supabase SQL Editor.
- Full setup notes are in `src/SETUP.md`.

## Scripts

- `npm run dev` - start local dev server
- `npm run build` - create production build
- `npm run preview` - preview production build locally
- `npm run lint` - run ESLint
