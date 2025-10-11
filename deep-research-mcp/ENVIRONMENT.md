# Deep Research MCP Server - Environment Variables

This document describes the environment variables used by the Deep Research MCP server.

## Server Configuration

### `PORT` or `DEEP_RESEARCH_MCP_PORT`
- **Default**: `4100`
- **Description**: Port on which the MCP server listens

### `DEEP_RESEARCH_DISABLE_PROXY`
- **Default**: `false`
- **Values**: `true`, `false`, `1`, `0`
- **Description**: Disable HTTP proxy when making upstream API requests

## Cache Configuration

### `CACHE_ENABLED`
- **Default**: `true`
- **Values**: `true`, `false`, `1`, `0`
- **Description**: Enable/disable response caching

### `CACHE_TTL_MEMBERS`
- **Default**: `3600` (1 hour)
- **Description**: Time-to-live in seconds for cached member data

### `CACHE_TTL_BILLS`
- **Default**: `1800` (30 minutes)
- **Description**: Time-to-live in seconds for cached bills data

### `CACHE_TTL_LEGISLATION`
- **Default**: `7200` (2 hours)
- **Description**: Time-to-live in seconds for cached legislation data

### `CACHE_TTL_HANSARD`
- **Default**: `3600` (1 hour)
- **Description**: Time-to-live in seconds for cached Hansard data

### `CACHE_TTL_DATA`
- **Default**: `1800` (30 minutes)
- **Description**: Time-to-live in seconds for cached core dataset queries

## Search and Relevance Configuration

### `RELEVANCE_THRESHOLD`
- **Default**: `0.3`
- **Range**: `0.0` to `1.0`
- **Description**: Minimum relevance score for filtering search results. Results below this threshold will be filtered out when relevance filtering is enabled.

## Example Configuration

Add these to your `.env` file in the workspace root:

```bash
# Deep Research MCP Server
DEEP_RESEARCH_MCP_PORT=4100
DEEP_RESEARCH_DISABLE_PROXY=false

# Cache Configuration
CACHE_ENABLED=true
CACHE_TTL_MEMBERS=3600
CACHE_TTL_BILLS=1800
CACHE_TTL_LEGISLATION=7200
CACHE_TTL_HANSARD=3600
CACHE_TTL_DATA=1800

# Relevance Scoring
RELEVANCE_THRESHOLD=0.3
```

## Query Parameters

When making requests to the MCP server endpoints, you can also pass these query parameters:

### `enableCache`
- **Type**: boolean
- **Default**: `true`
- **Description**: Enable/disable caching for this specific request

### `fuzzyMatch`
- **Type**: boolean
- **Default**: `false`
- **Description**: Enable fuzzy matching for search terms (currently not fully implemented)

### `applyRelevance`
- **Type**: boolean
- **Default**: `false`
- **Description**: Apply relevance scoring and filtering to results

### `relevanceThreshold`
- **Type**: number (0-1)
- **Default**: from `RELEVANCE_THRESHOLD` env var
- **Description**: Override the default relevance threshold for this request

