# Changelog

## Unreleased

### Added
- Implemented GPT-powered follow-up question generation endpoint in the backend, including DTO validation and Nest controller wiring.
- Added deep-research job enrichment to include answers from generated follow-up questions before dispatching to the o4-mini-deep-research model.
- Introduced GPT-5 based HTML-to-JSON transformation endpoint with schema validation, error handling, and optional credit handling placeholder.
- Published shared structured letter schema and API contracts via `libs/api-types` for consistent frontend/backend typing.
- Created React Query hooks for follow-up generation and letter transformation requests in the writing desk client.
- Extended the writing desk workflow to orchestrate follow-up collection, deep research polling, transformation requests, and structured letter rendering.
- Added provider wiring updates required for React Query usage in the frontend app shell.

### Changed
- Updated deep-research prompts to return plain text letters, deferring formatting and link handling to the transformation step.
- Reworked the writing desk UI and copy behaviour to operate on plain text letters while keeping structured JSON output intact.

### Notes
- Transformation endpoint currently returns parsed JSON and surfaces validation errors for retry handling.
- Credit consumption for transformation calls remains configurable pending product decision.
- URL sanitisation will be migrated from regex-based handling to structured reference parsing as part of the letter schema work.
