# @mp-writer/api-types

Shared TypeScript contracts and Zod schemas for the MP Writer application. This package exposes:

- `letterSchema` and supporting types describing the final structured letter format
- Request/response schemas for the AI endpoints (`followups`, `research-prompt`, `generate`, `compose`)

All schemas are authored with Zod and exported via `src/index.ts` for use in both the NestJS backend and Next.js frontend. Use the Zod validators to ensure runtime safety and derive static types with `z.infer`.
