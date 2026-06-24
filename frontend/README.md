# Mistify Fragrance Finder Frontend

This folder contains the React/Vite frontend for Mistify Fragrance Finder.

The frontend is the customer-facing fragrance discovery experience plus a small password-protected admin interface. It does **not** talk to the database directly and it does **not** call Gemini or any AI provider directly. All recommendation, admin, database, and optional AI work goes through the backend API.

## What this frontend does

The frontend helps a user start a fragrance search in three ways:

1. **Concierge** — free-text search for prompts like `fresh citrus for summer, not too sweet`.
2. **Guided** — a structured brief builder for moods, occasions, notes, and avoids.
3. **Reference** — a similarity flow for prompts like `Bleu de Chanel, but fresher`.

After a search, the UI shows a curated recommendation tray with fragrance cards, match details, rating signals, notes, season/time guidance, filters, sorting, and refinement chips.

The frontend also includes admin pages for managing curated chips and allowed product metadata when the backend admin token is available.

## Tech stack

- React
- TypeScript
- Vite
- Regular CSS
- Browser `fetch` API for backend calls
- Browser `sessionStorage` for the temporary admin token

## Local setup

From the repository root, create the frontend environment file if you have not already:

```bash
cp frontend/.env.example frontend/.env
```

For normal local development, `frontend/.env` should contain:

```env
VITE_API_URL=http://localhost:5000/api
```

Then install and run the frontend:

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL shown in the terminal. It is usually:

```txt
http://localhost:5173/
```

The backend must also be running for real recommendations:

```bash
cd ../backend
npm run dev
```

## Environment variables

### `VITE_API_URL`

The backend API base URL used by the browser app.

Local development value:

```env
VITE_API_URL=http://localhost:5000/api
```

Hosted deployments should set this in the hosting platform environment settings. Do not hardcode production API origins in source files.

## Pages and routes

Routing is intentionally simple and lives in `src/App.tsx`.

| Path | Purpose |
| --- | --- |
| `/` | Public fragrance finder experience |
| `/admin/login` | Admin password login |
| `/admin/chips` | Admin page for curated chips and prompt chips |
| `/admin/products` | Admin page for allowed product metadata edits |

The app uses the browser path directly instead of a heavy routing framework.

## Important source files

```txt
frontend/
├── src/
│   ├── api/
│   │   ├── adminApi.ts                  # Admin login/product/chip API calls
│   │   ├── chatApi.ts                   # Recommendation request client
│   │   ├── chipApi.ts                   # Public chip and prompt-chip clients
│   │   └── recommendationOptionsApi.ts  # Guided brief option client
│   ├── components/
│   │   └── FragranceCard.tsx            # Recommendation card component
│   ├── pages/
│   │   ├── ChatPage.tsx                 # Main public fragrance finder
│   │   ├── AdminLoginPage.tsx           # Admin login screen
│   │   ├── AdminChipsPage.tsx           # Admin chip management
│   │   └── AdminProductsPage.tsx        # Admin product metadata management
│   ├── styles/
│   │   └── app.css                      # Main product UI styling
│   ├── App.tsx                          # Route switcher and admin token state
│   └── main.tsx                         # React entrypoint
├── public/                              # Static assets served by Vite
├── .env.example
├── package.json
├── vite.config.ts
└── vercel.json
```

## API clients

The frontend API clients are intentionally thin.

### Chat requests

`src/api/chatApi.ts` sends requests to:

```txt
POST /api/chat/recommend
```

The request may include:

- `message`
- recent conversation context
- last search query
- last recommendations
- curated chip ID

The response may include:

- assistant reply text
- parsed filters
- effective search query
- search mode
- reference fragrance metadata
- recommendations

The frontend should display what the backend returns. It should not search the database itself, rerank the whole catalog, or invent recommendation details.

### Public chip requests

`src/api/chipApi.ts` loads public prompt chips and curated chips. Public users can fetch active chips only.

### Guided brief options

`src/api/recommendationOptionsApi.ts` loads option groups for moods, occasions, notes, and avoids. The UI has fallback options so the brief builder can still render if the API is temporarily unavailable.

### Admin requests

`src/api/adminApi.ts` handles admin login and admin-only chip/product metadata calls. Admin requests require the backend-issued bearer token.

## UI behavior rules

When changing the public finder UI:

- Keep the three starting modes clear: Concierge, Guided, Reference.
- Keep active mode workspaces wide enough for readable input and option selection.
- Preserve backend recommendation order unless the user intentionally changes sort/filter controls.
- Do not display raw source/status/verification placeholder text to public users.
- Do not show database IDs, internal field names, SQL details, or environment values.
- Keep disabled states readable.
- Keep mobile layouts usable.
- Make errors helpful but safe.

When changing recommendation cards:

- Display only fields returned by the backend.
- Do not create fake notes, ratings, claims, or product URLs in the browser.
- Hide placeholder values such as `Not verified` or empty product metadata.
- Use `originalFragranceName` as a safe fallback when a verified Mistify display name is not available.
- Keep product links optional.

When changing Reference mode:

- Only show reference comparison details when the backend provides reference metadata.
- Shared notes must be real exact overlaps from known note arrays.
- Do not invent similarity explanations in the frontend.

## Admin UI rules

The admin UI is intentionally lightweight.

- Admin login uses `ADMIN_PASSWORD` on the backend.
- The browser stores the returned admin token in `sessionStorage`.
- The frontend must never know the raw admin password after login.
- Public users must not be able to create, edit, or delete chips or product metadata.
- Product metadata edits should stay limited to explicitly allowed fields.
- Admin UI polish is okay, but avoid adding a large auth/account system unless requested.

## Development commands

```bash
# Install dependencies
npm install

# Start local dev server
npm run dev

# Lint frontend code
npm run lint

# Build production frontend
npm run build

# Preview production build
npm run preview
```

## Verification checklist

Before considering frontend work done, run:

```bash
npm run lint
npm run build
```

Recommended manual QA:

1. Start the backend.
2. Start the frontend.
3. Open `/`.
4. Try Concierge with a prompt like `fresh citrus for summer, not too sweet`.
5. Try Guided by selecting at least one mood, occasion, note, or avoid.
6. Try Reference with a prompt like `Bleu de Chanel, but fresher`.
7. Confirm recommendation cards render without placeholder verification text.
8. Confirm sort and filter controls work.
9. Confirm off-topic/prompt-injection-like requests show a safe refusal.
10. Open `/admin/login` and log in with a local admin password.
11. Visit `/admin/chips` and `/admin/products` with safe local/demo data.
12. Check the browser console for unexpected errors.

## Common troubleshooting

### The page opens but recommendations fail

Make sure the backend is running and `VITE_API_URL` points to it:

```env
VITE_API_URL=http://localhost:5000/api
```

Then restart the frontend dev server.

### The frontend cannot connect to the backend

Check the backend CORS setting. For local development, backend `.env` should include:

```env
FRONTEND_URL=http://localhost:5173
```

If Vite starts on another port, either stop the process using `5173` or update `FRONTEND_URL` to match the actual frontend origin and restart the backend.

### Admin pages redirect back to login

The admin token is stored in `sessionStorage`. Logging out, clearing browser storage, or opening a fresh browser session can require logging in again.

### Build passes but the hosted app cannot reach the API

Check the deployment platform's frontend environment variables. `VITE_API_URL` must point to the public backend API base URL in hosted environments.

## Security reminders

Never commit:

- `.env` files
- API keys
- admin passwords
- database URLs
- backend logs with full user messages
- screenshots showing private credentials or production deployment settings

The frontend should never contain direct database credentials or AI provider keys. If a feature needs those, it belongs behind the backend API.
