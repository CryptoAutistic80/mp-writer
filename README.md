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
- OpenAI: `OPENAI_API_KEY` (optional in dev), `OPENAI_MODEL` (default `gpt-4o-mini`)
- Writing desk AI: `OPENAI_REFINEMENT_MODEL` (default `gpt-4o-mini`), `OPENAI_RESEARCH_MODEL` (default `o4-mini`), `RESEARCH_TIMEOUT_MS` (default `180000`)

Notes
- Backend uses `ConfigModule` and `MongooseModule.forRootAsync` with global `ValidationPipe`.
- Shared Nest modules live in `libs/nest-modules` for future features (auth, users, etc.).
- Security: `helmet` enabled and CORS configured to `APP_ORIGIN`.
- Rate limit: `@nestjs/throttler` at 60 req/min per IP.

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
- Writing sessions:
  - `POST /api/writing-sessions` — refine a new issue brief into a session.
  - `GET /api/writing-sessions` — list your most recent sessions.
  - `GET /api/writing-sessions/:id` — fetch the status and outputs for a session.
  - `POST /api/writing-sessions/:id/research` — spend one credit to run deep research and draft the letter.

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
