# UK Parliament API Endpoints Documentation

This document describes the upstream UK Parliament API endpoints used by the Deep Research MCP server.

## 1. Linked Data API (LDA)

### Base URL
`https://lda.data.parliament.uk/`

### Endpoint Pattern
`GET /{dataset}.json`

### Parameters
- `_search` (string): Search term to filter results
- `_page` (number): Page number for pagination (0-based)
- `_pageSize` (number): Number of results per page

### Available Datasets
- `commonsmembers` - Members of the House of Commons
- `lordsmembers` - Members of the House of Lords
- `commonswrittenquestions` - Written questions in Commons
- `lordswrittenquestions` - Written questions in Lords
- `edms` - Early Day Motions
- `commonsdivisions` - Commons voting divisions
- `lordsdivisions` - Lords voting divisions

### Response Format
```json
{
  "format": "linked-data-api",
  "version": "0.2",
  "result": {
    "items": [],
    "itemsPerPage": 10,
    "page": 0,
    "totalResults": 0,
    "type": "http://purl.org/linked-data/api/vocab#Page"
  }
}
```

### Example Request
```
GET https://lda.data.parliament.uk/commonsmembers.json?_search=Johnson&_pageSize=10
```

### Known Issues
- The API may return empty results even for valid MPs
- Search appears to be case-sensitive and requires exact matching
- Some member names may not be indexed properly

## 2. Bills API

### Base URL
`https://bills-api.parliament.uk/api/`

### Endpoint
`GET /Bills`

### Parameters
- `SearchTerm` (string): Bill title or content to search for
- `House` (string): Filter by house - `commons` or `lords`
- `Session` (string): Parliamentary session (e.g., "2023-24")
- `Parliament` (number): Parliament number

### Response Format
```json
{
  "items": [],
  "totalResults": 0
}
```

### Example Request
```
GET https://bills-api.parliament.uk/api/Bills?SearchTerm=Health&House=commons
```

### Known Issues
- API returns 404 errors frequently
- May require authentication or have rate limiting
- Endpoint may have been deprecated or moved

## 3. Historic Hansard API

### Base URL
`https://api.parliament.uk/historic-hansard/`

### Endpoint Pattern
`GET /{house}/{path}.json`

### Parameters
- `house` (path): Either `commons` or `lords`
- `path` (path): Date and debate path (e.g., "2019/jul/22/autism-and-learning-disability")

### Response Format
Variable depending on the specific debate/document

### Example Request
```
GET https://api.parliament.uk/historic-hansard/commons/2019/jul/22/autism-and-learning-disability.json
```

### Known Issues
- Requires exact path matching
- No search functionality - you must know the exact debate path
- Limited documentation available

## 4. Legislation API

### Base URL
`https://www.legislation.gov.uk/`

### Endpoint Pattern
`GET /{type}/data.json`

### Types
- `all` - All legislation types
- `ukpga` - UK Public General Acts
- `ukci` - UK Church Instruments
- `ukla` - UK Local Acts
- `nisi` - Northern Ireland Statutory Instruments

### Parameters
- `title` (string): Search in legislation title
- `year` (number): Filter by year

### Response Format
```json
{
  "feed": {
    "entry": []
  }
}
```

### Example Request
```
GET https://www.legislation.gov.uk/ukpga/data.json?title=Mental+Health+Act&year=1983
```

### Known Issues
- API returns 404 errors frequently
- May require specific formatting of title parameter
- Limited search capabilities

## Search Optimization Strategies

### 1. Member Name Searches
When searching for members, try multiple variations:
- Original format: "Max Wilkinson"
- Reversed format: "Wilkinson, Max"
- Last name only: "Wilkinson"

### 2. Legislation Searches
- Try without year filter first
- Remove suffixes like "Act" or "Bill"
- Try broader type (`all`) if specific type fails

### 3. Bill Searches
- Try without session/parliament filters
- Use broader search terms
- Check both houses if no results

## Error Handling

All endpoints may return:
- **404**: Endpoint not found or resource doesn't exist
- **500**: Internal server error
- **503**: Service temporarily unavailable
- **Timeout**: Request exceeded 15 seconds

The MCP server implements:
- Retry logic with exponential backoff (3 attempts)
- Caching of successful responses
- Fallback strategies for failed queries
- Detailed error logging

## Rate Limiting

The UK Parliament APIs do not publicly document rate limits. To be respectful:
- Cache successful responses
- Implement request delays if needed
- Use specific queries rather than broad searches

## Resources

- **Parliament Developer Hub**: https://developer.parliament.uk/
- **Linked Data API Documentation**: https://api.parliament.uk/
- **Legislation.gov.uk**: https://www.legislation.gov.uk/developer

## Notes

As of the last update, several of these endpoints appear to have reliability issues or may have been deprecated. The MCP server includes extensive error handling and fallback strategies to maximize data retrieval despite these challenges.

For production use, consider:
1. Monitoring endpoint availability
2. Implementing circuit breakers for consistently failing endpoints
3. Adding alternative data sources
4. Regular testing and validation of endpoint responses

