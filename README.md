mp-writer

Project skeleton generated with Nx (Next.js + NestJS) following the instructions in `architectureSetup.md`.

Quick Start
- Install Node.js 20+ and Docker
- From the workspace root `mp-writer/`:
  - Dev: `npx nx serve backend-api` and `npx nx serve frontend`
  - Build: `npx nx build backend-api` and `npx nx build frontend`
  - Docker Compose (Mongo + API + Frontend): `docker compose up --build`

Environment
- `MONGO_URI`: defaults to `mongodb://localhost:27017/mp_writer` when not set
- `JWT_SECRET`: required for JWT issuance
- `APP_ORIGIN`: frontend origin for CORS (e.g., `http://localhost:3000`)
- Google OAuth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`
- OpenAI: `OPENAI_API_KEY` (optional in dev), `OPENAI_MODEL` (default `o4-mini-deep-research`),
  `OPENAI_DEEP_RESEARCH_TIMEOUT_MS` (optional override, default 7 minutes),
  `OPENAI_DEEP_RESEARCH_POLL_INTERVAL_MS` (optional override, default 5 seconds),
  `OPENAI_DEEP_RESEARCH_ENABLE_WEB_SEARCH` (toggle web search tool; default `true`),
  `OPENAI_DEEP_RESEARCH_WEB_SEARCH_CONTEXT_SIZE` (`small` | `medium` | `large`, default `medium`),
  `OPENAI_DEEP_RESEARCH_VECTOR_STORE_IDS` (comma-separated IDs for at most two vector stores),
  `OPENAI_DEEP_RESEARCH_ENABLE_CODE_INTERPRETER` (enable the code interpreter tool for research),
  `OPENAI_DEEP_RESEARCH_MAX_TOOL_CALLS` (positive integer cap on tool invocations during research)

Notes
- Backend uses `ConfigModule` and `MongooseModule.forRootAsync` with global `ValidationPipe`.
- Shared Nest modules live in `libs/nest-modules` for future features (auth, users, etc.).
- Security: `helmet` enabled and CORS configured to `APP_ORIGIN`.
- Rate limit: `@nestjs/throttler` at 60 req/min per IP.
- AI generation calls the OpenAI Deep Research flow (web search preview). If your account lacks access to deep research models, set `OPENAI_MODEL` to one you can use.
- Deep research configuration mirrors the tooling guidance from the OpenAI Cookbook deep research examples (web search, optional vector stores, optional code interpreter, max tool calls).

Readiness & Health
- `/api/health`: Nest Terminus endpoint reports Mongo connectivity.
- Docker Compose:
  - `mongo` has a `healthcheck` using `mongosh ping`.
  - `backend-api` waits for `mongo` healthy and has its own HTTP healthcheck.
  - `frontend` waits for `backend-api` to be healthy.

Auth & API (Backend)
- Google Sign-in: `GET /api/auth/google` then `GET /api/auth/google/callback`
- Current user: `GET /api/auth/me` (Authorization: `Bearer <token>`)
- Purchases: `GET /api/purchases`, `POST /api/purchases`, `GET /api/purchases/:id`
- OpenAI: `POST /api/ai/generate` (Authorization required)

Persisting a User's MP
- Model: separate collection `user_mps` keyed by `user` (ObjectId). See `backend-api/src/user-mp/schemas/user-mp.schema.ts`.
- Endpoints (auth required):
  - `GET /api/user/mp` — return the saved MP for the current user.
  - `PUT /api/user/mp` — upsert `{ constituency, mp }`.
  - `DELETE /api/user/mp` — clear saved MP.
- Frontend integration: `frontend/src/components/mpFetch.tsx`
  - Auto-loads saved MP on mount.
  - Saves after successful lookup.
  - “Change my MP” clears server state and returns to search.
