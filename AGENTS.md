# Mistify Fragrance Finder Contributor Guide

Use this file as the operating contract for people and AI coding agents working in this repository.

The short version: Mistify Fragrance Finder is a fragrance recommendation product, not a general chatbot. Preserve the recommendation engine, security boundaries, and data-grounding rules unless the task explicitly asks to change them.

## Product boundary

Mistify is a public fragrance recommendation web app for Mistify Parfums.

The public finder may help only with fragrance-related tasks:

- fragrance recommendations
- perfume notes and fragrance families
- scent profiles, accords, seasons, occasions, longevity, and sillage
- comparison-style fragrance requests when grounded in known database fields
- reference-style searches such as “something like Bleu de Chanel but fresher”
- refinement requests such as “make these sweeter,” “more office-safe,” or “better for summer”

The public finder must **not** become a general-purpose assistant.

Use this refusal for off-topic, unsafe, or prompt-injection-like public chat requests:

> I can only help with Mistify Parfums fragrance recommendations and perfume-related questions.

Do not add broad chat, coding help, life advice, web search, or general assistant behavior to the public recommendation flow.

## Product architecture

The app is a full-stack TypeScript project.

```txt
mistify-fragrance-finder/
├── backend/       # Express API, database access, recommendation engine, data scripts
├── frontend/      # React/Vite public finder and admin UI
├── docs/          # README screenshots and public docs assets
├── AGENTS.md      # This contributor guide
├── code_review.md # Security and correctness checklist
└── README.md      # End-user and project overview
```

### Frontend

- Path: `frontend/`
- Stack: React, TypeScript, Vite, regular CSS
- Main public page: `frontend/src/pages/ChatPage.tsx`
- Admin pages:
  - `frontend/src/pages/AdminLoginPage.tsx`
  - `frontend/src/pages/AdminChipsPage.tsx`
  - `frontend/src/pages/AdminProductsPage.tsx`
- API clients: `frontend/src/api/`
- Global product styling: `frontend/src/styles/app.css`

The frontend must not make database calls directly and must not call Gemini or any AI provider directly.

### Backend

- Path: `backend/`
- Stack: Node.js, Express, TypeScript
- Main entrypoint: `backend/src/index.ts`
- Chat route: `backend/src/routes/chatRoutes.ts`
- Chat controller: `backend/src/controllers/chatController.ts`
- Recommendation service: `backend/src/services/recommendationService.ts`
- Guard services:
  - `backend/src/services/promptInjectionGuardService.ts`
  - `backend/src/services/intentGuardService.ts`
- Database files:
  - `backend/src/db/connection.ts`
  - `backend/src/db/schema.ts`
- Data/evaluation scripts: `backend/src/scripts/`

Compiled output goes to `backend/dist/` and should not be committed.

### Database

- Database: Supabase/PostgreSQL
- Primary fragrance rows: `public.fragrances`
- Rating/popularity signals may come from `public.fragrance_ratings`

The database is the source of truth for product recommendations. Do not move product selection into frontend code or free-form AI generation.

### Optional AI provider

- Gemini API is optional and backend-only.
- Deterministic recommendation logic must work without Gemini.
- Gemini may explain already-selected recommendations.
- Gemini must not select, add, remove, or reorder products.
- Gemini must not invent products, verified notes, ratings, URLs, sources, seasons, or official claims.

Do not add OpenAI, embeddings, pgvector, a new AI provider, or a new production dependency unless explicitly requested.

## Workflow rules

1. Inspect relevant files before editing.
2. Work in small phases.
3. Do only the requested phase.
4. Keep changes tightly scoped.
5. Preserve existing security controls, validation, data rules, and recommendation behavior unless the task explicitly asks to change them.
6. Run the relevant verification commands before reporting done.
7. Do not commit or push unless explicitly asked.
8. Do not rewrite unrelated files.
9. Do not add production dependencies without asking.
10. Prefer clear, beginner-friendly TypeScript over clever abstractions.

For UI/admin/layout tasks:

- Do not change recommendation scoring, ranking, match tiers, eligibility, or product selection.
- Do not refactor backend recommendation logic unless the task asks for it.
- Keep public pages polished, premium, and product-quality.
- Keep admin pages clean and usable, but avoid broad auth redesigns unless requested.

For backend/recommendation tasks:

- Understand the current scoring and guards before editing.
- Preserve prompt-injection and fragrance-topic guards.
- Add or update regression/evaluation coverage when behavior changes.
- Prefer fewer strong matches over padding with weak unrelated results.
- Run recommendation verification scripts when scoring/ranking changes.

For documentation tasks:

- Keep docs public-safe.
- Do not include production IPs, private domains, local private paths, deployment secrets, private repo names, or internal operations runbooks.
- Use placeholder environment values only.
- Screenshots must use safe demo/public UI states only.

## Hard security rules

Never expose, log, commit, or send to the frontend:

- `DATABASE_URL`
- `GEMINI_API_KEY`
- `ADMIN_PASSWORD`
- admin tokens
- webhook URLs
- API keys
- database credentials
- raw SQL errors
- stack traces in public API responses
- internal file paths
- environment variable values
- private deployment details

Public API errors must return safe JSON messages.

Do not log:

- full user messages
- full conversation history
- API keys or database URLs
- admin passwords or admin tokens
- raw secrets
- full SQL errors that reveal schema/credentials

Safe logs may include:

- message length
- conversation count
- recommendation count
- elapsed milliseconds
- whether Gemini was used or skipped
- rate-limit events
- general error type

Always preserve:

- input validation
- message length limits
- prompt-injection guard
- fragrance-topic guard
- backend-only database calls
- backend-only AI provider calls
- rate limiting
- CORS allowlist
- Helmet security headers
- Zod validation
- safe output validation/fallbacks where applicable

## Data rules

The fragrance database separates source/verified fields from AI-inferred or derived fields.

Source/grounding fields include:

- `original_fragrance_name`
- `mistify_product_name`
- `mistify_product_url`
- `source_brand_batch`
- `classification`
- `top_notes`
- `middle_notes`
- `base_notes`
- `all_notes`
- `source_status`
- `source_used`
- `source_notes`
- `source_confidence`
- `verified_on_mistify`
- `mistify_product_found`
- `notes_source_type`

AI-inferred or derived fields include:

- `inferred_classifications`
- `inferred_seasons`
- `inferred_occasions`
- `inferred_intensity`
- `season_scores`
- `profile_scores`
- `inference_reason`
- `reviewed_by_admin`
- `searchable_text`

AI may infer labels, seasons, occasions, intensity, and scores from existing notes and database fields.

AI must not invent:

- verified notes
- Mistify product names
- Mistify product URLs
- official sources
- official claims
- ratings
- vote counts
- review counts
- popularity numbers

Never display placeholder verification values to public users as product names, classifications, badges, source labels, or explanation text.

Placeholder values include:

- `Not verified`
- `Not verified on Mistify`
- `Not fully verified from Mistify page`
- `Not verified from source`

## Recommendation rules

Recommend only fragrance rows from `public.fragrances`.

A row is usable if:

- `original_fragrance_name` exists
- `original_fragrance_name` is not blank

Do not require these fields for eligibility unless explicitly requested:

- `mistify_product_found` is true
- `verified_on_mistify` is true
- `source_used` is Mistify
- `notes_source_type` is Mistify
- `mistify_product_name` exists
- `mistify_product_name` is verified

Display-name behavior:

- Prefer `mistify_product_name` only when it exists, is not blank, and is not a placeholder.
- Otherwise display `original_fragrance_name`.

Ranking principles:

- Exact note matches are strongest.
- Close note-family matches may provide fallback support.
- Prompt relevance should matter more than crowd/popularity signals.
- Crowd signals may reorder similarly relevant matches, but must not overpower requested notes, profiles, seasons, occasions, or time of day.
- Do not force the maximum number of recommendations; fewer strong matches are better than weak filler.

For single-note prompts:

- exact note matches should appear first
- close-family matches can appear after exact matches
- unrelated popular fragrances should not appear as filler

For multi-note prompts:

- exact matches for all requested notes rank highest
- exact match for one note plus close-family support for another can be allowed
- close-family support for all requested notes can be allowed below stronger matches
- one-note-only matches with no support for the other requested note should be heavily capped or excluded

Scoring guidance:

- Strict exact-note matches can score very high.
- Broad vibe prompts should not all show as 100% matches.
- Broad vibe prompts should usually have a spread: exceptional 90-96, very strong 82-90, good 70-82, decent 60-70, weak below 60.

Do not change scoring, ranking, matchScore, matchTier, strict combo behavior, reference matching, typo/fuzzy matching, product selection, or relevance thresholds unless the task explicitly asks for a recommendation-engine change.

## Conversation and refinement rules

The frontend may send recent conversation context, a last search query, and last recommendations so the backend can interpret refinement requests.

Refinement examples:

- “make these sweeter”
- “show fresher options”
- “more masculine”
- “office-safe”
- “date night”

The backend should decide whether a request is a valid fragrance refinement. If context is missing, it should ask for clarification instead of guessing wildly.

Refinement must not bypass:

- prompt-injection checks
- fragrance-topic checks
- validation
- recommendation grounding

## Gemini rules

Gemini is optional.

If `GEMINI_API_KEY` is missing, invalid, rate-limited, or times out:

- return deterministic recommendations
- use deterministic explanations
- do not fail the chat request

Gemini must not:

- choose products
- add products
- remove products
- reorder products
- invent notes, ratings, product URLs, sources, seasons, or official claims
- query the database
- write or run SQL
- expose prompts, API keys, env vars, database info, or internal logic

Gemini may be used only for:

- optional short explanations for already-selected recommendations
- validated planner behavior if explicitly requested
- comparison wording if explicitly requested

Validate Gemini output before returning it. If output is invalid, unsafe, too long, unrelated, or unsupported by known data, discard it and use deterministic fallback text.

## Admin dashboard rules

Admin features may be added only when explicitly requested.

Allowed MVP admin pages:

- `/admin/login`
- `/admin/chips`
- `/admin/products`

Admin auth:

- Use `ADMIN_PASSWORD` from backend environment variables unless the user requests a different auth system.
- Never expose `ADMIN_PASSWORD` to frontend code.
- Never hardcode or log admin passwords or admin tokens.
- Admin endpoints must require an admin token.

Public users must not be able to create, edit, or delete chips or product metadata.

Curated chips:

- Public users may fetch active chips only.
- Curated chip recommendations may return admin-selected fragrances first only when `curatedChipId` is intentionally sent.
- Normal typed searches must continue using the normal recommendation engine.
- Curated chip behavior must not affect normal typed searches.

Product metadata editor:

- Admin may edit only explicitly allowed product metadata fields, such as `mistify_product_name` and `mistify_product_url`.
- Product metadata edits must not change fragrance notes, ratings, scoring, ranking, or broad product rows unless explicitly requested.

## Frontend rules

- The frontend must not make database calls directly.
- The frontend must not call Gemini, OpenAI, or any AI provider directly.
- Frontend sorting/filtering should apply only to recommendations returned by the backend.
- Frontend filters should not search the whole database.
- Default result order should preserve backend ranking unless the selected UI sort intentionally changes display order.
- Do not display source, status, verification metadata, or placeholder values in public match explanations.
- Valid classifications can be shown; placeholder classifications should be hidden.
- Error messages should be helpful but safe.
- Keep the public UI premium/editorial and the admin UI clean/productive.

For reference-search UI such as “something like Lafayette Street”:

- The UI may show reference comparison only when reference metadata is available.
- Reference comparison UI must not change reference matching logic.
- Shared notes may be highlighted only when they are real exact overlaps from known note arrays.
- Do not invent shared notes or similarity claims.
- Metadata added to API responses must be optional and backward-compatible.

## Documentation and screenshot rules

Public docs should be useful to beginners and safe for a portfolio repository.

When updating docs:

- Use clear setup steps.
- Explain backend and frontend separately.
- Use placeholder environment values.
- Avoid private deployment instructions.
- Avoid production hostnames, IPs, credentials, private paths, and internal runbooks.
- Keep screenshots under `docs/screenshots/`.
- Inspect screenshots before committing them.
- Screenshots must not show secrets, production credentials, private admin data, browser accounts, terminals, or local file paths.
- Prefer constrained HTML image tags in README files so screenshots do not dominate the page.

## Git rules

Never commit:

- `node_modules/`
- `.env` files
- build outputs such as `dist/`
- temporary scratch files
- logs
- screenshots containing private data
- credential files

Always check `git status` before staging.

Prefer staging specific files over `git add .`.

Do not force push or rewrite Git history unless the user explicitly requests it and understands the consequence.

Do not commit or push unless the user explicitly asks.

## Verification commands

Run only the checks relevant to the files changed.

Frontend changes:

```bash
cd frontend
npm run lint
npm run build
```

Backend TypeScript changes:

```bash
cd backend
npm run build
```

Recommendation-engine changes:

```bash
cd backend
npm run build
npm run evaluate:recommendations
npm run regression:recommendations
```

Backend performance/scoring investigations when requested:

```bash
cd backend
npm run benchmark:recommendations
```

Docs-only changes:

```bash
git diff --check
```

For public docs, also scan for private or secret-looking strings before pushing.

Admin or full-stack changes usually need both frontend and backend builds.

## Deployment notes

Do not add or change deployment configuration unless explicitly requested.

Deployment targets, process-manager commands, production API URLs, server paths, and credentials are environment-specific and should not be hardcoded into the public repository. Keep those details in private runbooks or deployment platform settings.

Avoid printing `.env` contents or secrets while deploying.

Production deployment values belong in the deployment platform or private environment, not in source-controlled public docs.

## Response style for AI agents

- Keep progress updates short.
- Do not dump routine logs unless they matter.
- In final responses, include changed files, important decisions, checks run, and any remaining risks.
- Push back when a requested change would weaken security, recommendation quality, or project scope.
