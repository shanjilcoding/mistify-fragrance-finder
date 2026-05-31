# Mistify Chatbot Agent Instructions

Use this file as the operating contract for AI coding agents working in this repository.

## Product boundary

Mistify is a public fragrance recommendation web app for Mistify Parfums.

The public chatbot may help only with:

- fragrance recommendations
- perfume notes and fragrance families
- scent profiles, seasons, occasions, longevity, and sillage
- comparison-style fragrance requests when grounded in known database fields

The chatbot must **not** become a general-purpose assistant.

Use this refusal for off-topic or unsafe public-chat requests:

> I can only help with Mistify Parfums fragrance recommendations and perfume-related questions.

## Stack and repo layout

Frontend:

- `frontend/` — React, TypeScript, Vite, regular CSS
- Main UI files live under `frontend/src/`
- Global app styling lives in `frontend/src/styles/app.css`

Backend:

- `backend/` — Node.js, Express, TypeScript
- Uses `dotenv`, `cors`, `helmet`, `express-rate-limit`, `zod`, `pg`, and `drizzle-orm`
- Main source files live under `backend/src/`
- Compiled output goes to `backend/dist/`

Database:

- Supabase PostgreSQL
- Primary fragrance rows are stored in `public.fragrances`
- Rating/popularity signals may come from `public.fragrance_ratings`

AI provider:

- Gemini API is optional and backend-only
- Deterministic recommendation logic must work without Gemini
- Gemini may explain already-selected recommendations, but must not select, add, remove, or reorder products

Do not add OpenAI, embeddings, pgvector, new auth systems, or new production dependencies unless explicitly requested.

## Agent workflow

1. Work in small phases. Do only the requested phase.
2. Inspect relevant files before editing.
3. Keep changes tightly scoped. Do not rewrite unrelated files.
4. Preserve existing security controls, validation, and recommendation behavior unless the task explicitly asks to change them.
5. Run the relevant verification commands before reporting done.
6. Do not commit or push unless the user explicitly asks.

For UI/admin/layout tasks:

- Do not change recommendation scoring, ranking, match tiers, eligibility, or product selection.
- Do not refactor backend recommendation logic unless the task asks for it.

For backend/recommendation tasks:

- Understand the current scoring and guards before editing.
- Add or update regression/evaluation coverage when behavior changes.
- Prefer returning fewer strong matches over padding with weak unrelated results.

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

Public API errors must return safe JSON messages.

Do not log:

- full user messages
- full conversation history
- API keys or database URLs
- admin passwords or admin tokens
- raw secrets

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
- CORS and helmet
- zod validation
- output validation where applicable

## Data rules

The fragrance database separates source data from AI-inferred or derived data.

Source/grounding fields include:

- `original_fragrance_name`
- `mistify_product_name`
- `mistify_product_url`
- `source_brand_batch`
- `classification`
- `top_notes`, `middle_notes`, `base_notes`, `all_notes`
- `source_status`, `source_used`, `source_notes`, `source_confidence`
- `verified_on_mistify`, `mistify_product_found`, `notes_source_type`

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
- Mistify product names or URLs
- official sources, facts, or claims
- ratings, vote counts, review counts, or popularity numbers

Never display placeholder verification values to public users as product names, classifications, badges, source labels, or explanation text. Placeholder values include:

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
- Close note-family matches may be fallback support.
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
- Default sort should preserve backend ranking and be labeled `Best Match`.
- Do not display source, status, verification metadata, or placeholder values in public match explanations.
- Valid classifications can be shown; placeholder classifications should be hidden.

For reference-search UI such as “something like Lafayette Street”:

- The UI may show reference comparison only when reference metadata is available.
- Reference comparison UI must not change reference matching logic.
- Shared notes may be highlighted only when they are real exact overlaps from known note arrays.
- Do not invent shared notes or similarity claims.
- Metadata added to API responses must be optional and backward-compatible.

## Coding style

- Keep code beginner-friendly, readable, and focused.
- Do not over-engineer.
- Use TypeScript types where helpful.
- Keep names clear and consistent.
- Avoid unnecessary comments inside code.
- Ask before adding new production dependencies.
- Do not rewrite unrelated files.
- Do not delete important files.
- Do not commit or push unless explicitly asked.

## Git rules

Never commit:

- `node_modules/`
- `.env` files
- build outputs such as `dist/`
- temporary scratch files
- screenshots/logs unless explicitly requested

Always check `git status` before staging.

Prefer staging specific files over `git add .`.

Do not force push or rewrite Git history.

## Verification commands

Run only the checks relevant to the files changed.

Frontend changes:

```bash
cd frontend
npm run build
npm run lint
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

Admin or full-stack changes usually need both frontend and backend builds.

## Deployment notes

Do not add or change deployment configuration unless explicitly requested.

Deployment targets, process-manager commands, production API URLs, server paths, and credentials are environment-specific and should not be hardcoded into the public repository. Keep those details in private runbooks or deployment platform settings.

Avoid printing `.env` contents or secrets while deploying.

## Response style

- Keep progress updates short.
- Do not dump routine logs unless they matter.
- In final responses, include changed files, important decisions, checks run, and any remaining risks.
- Push back when a requested change would weaken security, recommendation quality, or project scope.
