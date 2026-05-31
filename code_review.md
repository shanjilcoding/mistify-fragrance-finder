# Code Review Checklist

Use this checklist before merging or publishing changes to Mistify Fragrance Finder.

The project is a fragrance recommendation system with a public customer UI, backend recommendation API, admin tools, and a PostgreSQL/Supabase catalog. The most important review question is: **does this change preserve grounded fragrance recommendations without leaking private data or turning the product into a general chatbot?**

## Review priority

Review in this order:

1. Security and secrets
2. Recommendation correctness
3. Data grounding and display accuracy
4. Frontend/backend contract
5. Admin access control
6. Verification and regression checks
7. Maintainability and scope control
8. Public documentation safety

If a change fails security or recommendation-grounding checks, stop and fix that before reviewing style or polish.

## Security

### Secrets and environment values

Confirm the change does **not** expose, log, commit, or send to the frontend:

- `DATABASE_URL`
- `GEMINI_API_KEY`
- `ADMIN_PASSWORD`
- admin bearer tokens
- webhook URLs
- API keys
- database credentials
- production hostnames/IPs that should stay private
- local private paths
- raw environment variable values

Check for accidental additions of:

- real `.env` files
- credential files
- private keys
- database dumps
- local backup files
- logs containing secrets
- screenshots showing admin settings, secrets, or deployment dashboards

Only `.env.example` files with placeholders should be tracked.

### Backend security boundaries

Confirm these controls are preserved:

- Helmet security headers
- CORS allowlist behavior
- request-size limits
- rate limiting on public recommendation requests
- Zod request validation
- safe JSON errors
- prompt-injection guard
- fragrance-topic guard
- backend-only database access
- backend-only AI provider access

Public API responses must not include:

- raw SQL errors
- stack traces
- environment details
- internal file paths
- raw prompts that expose internal policy
- admin tokens or passwords

### Logging safety

Logs may include operational metadata such as message length, recommendation count, elapsed milliseconds, and general error type.

Logs should not include:

- full user messages
- full conversation history
- database URLs
- API keys
- admin passwords
- admin tokens
- raw SQL errors with sensitive details
- private deployment details

## Recommendation correctness

### Product selection

The recommendation engine should recommend only rows grounded in the fragrance database.

Check that the change does not allow:

- AI-generated product names
- fabricated Mistify products
- fabricated product URLs
- hallucinated fragrance notes
- hallucinated ratings or vote counts
- unrelated popular fragrances as filler
- frontend-side database searching
- frontend-side full-catalog reranking

A usable fragrance row should have a non-empty `original_fragrance_name`.

Do not add stricter eligibility requirements such as requiring verified Mistify product fields unless the task explicitly asks for that. The app may recommend known catalog rows even when Mistify-specific metadata is incomplete.

### Ranking behavior

Check ranking behavior against the product rules:

- Exact note matches should be strongest.
- Close note-family matches may support fallback ranking.
- Prompt relevance should matter more than crowd/popularity signals.
- Crowd signals may reorder similarly relevant matches but should not overpower the user's requested notes, profile, season, occasion, or time of day.
- The system should prefer fewer strong matches over padding with weak filler.

For single-note prompts:

- exact note matches should appear first
- close-family matches should come after exact matches
- unrelated popular fragrances should not fill the tray

For multi-note prompts:

- exact matches for all requested notes should rank highest
- exact match for one note plus close-family support for another can be acceptable
- close-family-only support should be lower confidence
- one-note-only matches with no support for the other requested notes should be capped or excluded

### Match scores and confidence

Check that match scores are not misleading:

- Strict exact-note matches can score very high.
- Broad vibe prompts should not all show as 100% matches.
- Broad vibe prompts should have a realistic spread.
- Match tiers should align with the visible explanation.
- Confidence labels should not overpromise when data is incomplete.

### Reference and refinement behavior

For reference-style requests:

- Reference comparison should be based on known fragrance data.
- Shared notes must be exact overlaps from known note arrays.
- The UI/backend must not invent shared notes or similarity claims.
- Similarity wording should be optional when metadata is missing.

For refinement requests:

- Requests like “sweeter,” “fresher,” “more masculine,” or “office-safe” should use previous search context when available.
- If context is missing, the API should ask for clarification instead of guessing.
- Refinements must still pass prompt-injection and fragrance-topic checks.

## Data accuracy

The database separates source/verified fields from AI-inferred or derived fields.

### Source/grounded fields

Review usage of fields such as:

- `original_fragrance_name`
- `mistify_product_name`
- `mistify_product_url`
- `classification`
- `top_notes`
- `middle_notes`
- `base_notes`
- `all_notes`
- `source_status`
- `source_used`
- `source_confidence`
- `verified_on_mistify`
- `mistify_product_found`
- `notes_source_type`

These should not be overwritten with AI guesses unless a data import/review task explicitly does that and stores the values in the right inferred fields.

### AI-inferred or derived fields

Review usage of fields such as:

- `inferred_classifications`
- `inferred_seasons`
- `inferred_occasions`
- `inferred_intensity`
- `season_scores`
- `profile_scores`
- `inference_reason`
- `reviewed_by_admin`
- `searchable_text`

AI-inferred values should stay clearly separated from verified/source fields.

### Public display rules

Confirm public UI does not display placeholder verification values as product facts.

Hide or safely fallback from values such as:

- `Not verified`
- `Not verified on Mistify`
- `Not fully verified from Mistify page`
- `Not verified from source`
- blank product names
- blank product URLs

Display-name fallback should prefer:

1. valid non-placeholder `mistify_product_name`
2. otherwise `original_fragrance_name`

## AI/Gemini behavior

Gemini is optional and backend-only.

Confirm Gemini does not:

- choose products
- add products
- remove products
- reorder products
- invent notes
- invent ratings
- invent product URLs
- invent official claims
- query the database
- write or run SQL
- expose prompts, keys, env vars, or internal logic

Gemini may help with:

- short explanations for already-selected recommendations
- comparison wording when grounded in returned data
- validated planning behavior if explicitly requested

If Gemini is missing, invalid, rate-limited, or times out, the backend should still return deterministic recommendations and deterministic explanation text.

## Frontend/backend contract

### API URLs

Check that the frontend calls the correct backend base URL:

- Local development: `VITE_API_URL=http://localhost:5000/api`
- Hosted deployment: configured in the platform environment

Do not hardcode production-only API URLs in source files.

### Request/response shape

Confirm TypeScript types match backend responses:

- recommendation shape
- rating shape
- reference fragrance shape
- search mode values
- error response shape
- admin response shape

Frontend should handle optional/missing fields safely.

### Frontend responsibilities

Frontend may:

- collect user input
- display returned recommendations
- sort/filter already-returned recommendations for display
- show guided brief options
- show admin forms for allowed operations

Frontend must not:

- query the database directly
- call Gemini or another AI provider directly
- invent recommendation data
- perform full-catalog ranking in the browser
- expose backend secrets

## Admin review

Admin features should remain intentionally small unless a task explicitly expands them.

Review admin changes for:

- admin login requires backend validation
- admin token is required for protected API routes
- public users cannot create, edit, or delete chips or product metadata
- frontend does not expose `ADMIN_PASSWORD`
- backend does not log admin passwords or tokens
- product metadata edits are limited to allowed fields
- chip changes do not alter normal typed-search behavior unless requested

Curated chip behavior:

- public users can fetch active chips only
- curated recommendations are used only when `curatedChipId` is intentionally sent
- normal typed searches keep using the normal recommendation engine

## Validation and verification

### Docs-only changes

Run:

```bash
git diff --check
```

Also scan public docs for secret/private-looking strings before pushing.

### Frontend changes

Run:

```bash
cd frontend
npm run lint
npm run build
```

Manual QA when relevant:

1. Open the public finder.
2. Try Concierge search.
3. Try Guided brief builder.
4. Try Reference search.
5. Check sort and filters.
6. Check a refused off-topic/prompt-injection request.
7. Check browser console for errors.

### Backend TypeScript changes

Run:

```bash
cd backend
npm run build
```

Manual/API QA when relevant:

```bash
curl http://localhost:5000/

curl -X POST http://localhost:5000/api/chat/recommend \
  -H "Content-Type: application/json" \
  -d '{"message":"I want a sweet vanilla fragrance for winter"}'
```

### Recommendation-engine changes

Run:

```bash
cd backend
npm run build
npm run evaluate:recommendations
npm run regression:recommendations
```

If performance is relevant, also run:

```bash
npm run benchmark:recommendations
```

### Full-stack changes

Usually run both:

```bash
cd backend
npm run build

cd ../frontend
npm run lint
npm run build
```

Then perform manual browser QA against a running local backend and frontend.

## Maintainability

Review for:

- clear file names
- focused functions
- readable TypeScript
- no unnecessary abstractions
- no unrelated rewrites
- no new production dependencies without a clear reason
- no duplicated business rules split inconsistently across frontend and backend
- no broad auth/database/deployment changes unless requested
- no generated files or dependency folders committed

Prefer targeted changes over sweeping refactors.

If a refactor is needed, it should preserve behavior and be verified separately from feature changes when practical.

## Public documentation and portfolio safety

For README/docs/screenshots:

- setup instructions should be clear enough for beginners
- environment values should be placeholders only
- screenshots should use public/demo UI states
- docs should avoid private deployment details
- docs should avoid internal runbook details
- docs should avoid production IPs, private domains, local private paths, and credentials
- screenshots should not show browser accounts, admin secrets, terminals with paths, or real production settings

Before pushing public docs, scan for:

- real `.env` values
- API-key-like strings
- private Windows paths
- private IPs/domains
- production-only deployment notes
- unrelated private project names

## Final reviewer questions

Before approving, answer these:

1. Does the app still only help with fragrance recommendations and perfume-related questions?
2. Are recommendations still grounded in database rows?
3. Did any secret, private path, or deployment detail leak into code/docs/screenshots?
4. Are prompt-injection and fragrance-topic guards preserved?
5. Does Gemini remain optional and backend-only?
6. Does the frontend avoid direct database/AI-provider access?
7. Are admin routes still protected?
8. Were the right verification commands run?
9. Is the change tightly scoped to the task?
10. Would a beginner contributor understand the docs and setup flow?
