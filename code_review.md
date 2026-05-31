# Code Review Checklist

Review changes for:

## Security
- No API keys in frontend code
- No real .env files committed
- No authentication added unless requested
- Prompt-injection guard preserved
- Fragrance-topic guard preserved
- Rate limiting preserved
- Backend-only AI provider calls
- No raw SQL from AI output

## Correctness
- Frontend calls the correct backend URL
- Backend endpoint returns consistent JSON
- Errors are handled cleanly
- TypeScript types match API responses
- No unrelated feature changes

## Data accuracy
- Verified fragrance data is not mixed with AI-inferred labels
- AI-inferred labels are clearly stored as inferred
- No invented Mistify product names
- No fallback-only fragrance recommended as a Mistify product

## Maintainability
- Code is readable
- File names are clear
- Functions are focused
- No unnecessary dependencies
- No large rewrites without reason