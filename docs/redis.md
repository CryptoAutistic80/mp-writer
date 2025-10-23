# Redis Operations Guide

This project relies on Redis for several backend concerns:

- API rate limiting uses the Nest throttler with a Redis-backed store so limits work across every instance of the API service.
- MP postcode lookups and address lookups cache upstream responses in Redis to keep external API usage under control.
- AI runs use Redis streams and distributed locks to coordinate long-running jobs and real-time updates.

## Connection management

The shared `RedisClientService` wraps a single `ioredis` connection and exports it through Nest's dependency injection container. Each backend-api pod will therefore open exactly one long-lived connection. Size your Redis deployment so that `maxclients` comfortably exceeds `number_of_backend_replicas + 5` to leave headroom for maintenance shells or future workers. The default `maxclients` (10,000) on Redis 7 is sufficient for most environments.

Configure the connection string via the required `REDIS_URL` environment variable. The value must be a full Redis URI (e.g. `redis://localhost:6379/0`).

## Time-to-live defaults

The backend applies the following TTL policies when writing to Redis:

| Concern | Keys | TTL |
| --- | --- | --- |
| Address autocomplete & details | `addresses:suggestions:*`, `addresses:details:*` | 1 hour (3600 seconds) |
| MP lookups by postcode | `mps:lookup:*` | 24 hours (86,400 seconds) |
| Writing desk AI runs | Streams, metadata, and locks at `ai:run:*` | 5 minutes (300,000 ms) |
| API rate limits | Global throttler counters | 60 seconds per 60 requests |

## Behaviour when Redis is unavailable

Caching layers (`MpsService` and `AddressesService`) catch Redis read/write errors and fall back to live requests, so lookups continue to work without cached acceleration.

Features that need locking or throttling depend on Redis being reachable. The AI run service acquires Redis locks before starting work; if Redis is down the lock call will throw and the request will fail instead of starting a duplicate run. Likewise, the global rate limiter requires Redis; when it cannot connect the Nest throttler will bubble up errors, effectively failing requests until Redis returns. Ensure operators receive alerts when Redis is unhealthy.

## Running Redis locally

Choose any of the following approaches:

- **Docker Compose** (runs alongside MongoDB and the app services): `docker compose up redis` from the repository root uses the configuration in `docker-compose.yml` (Redis 7 with a basic health check).
- **Standalone Docker container**: `docker run --rm -p 6379:6379 redis:7` starts an ephemeral local instance; remember to set `REDIS_URL=redis://localhost:6379/0` in your environment or `.env` file.

After starting Redis, export `REDIS_URL` in your shell or copy `.env.example` to `.env` and adjust the value before launching the backend service.
