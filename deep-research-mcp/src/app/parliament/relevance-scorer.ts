import { Injectable, Logger } from '@nestjs/common';

export interface ScoredResult<T> {
  data: T;
  relevanceScore: number;
  matchType: 'exact' | 'partial' | 'fuzzy' | 'none';
}

@Injectable()
export class RelevanceScorer {
  private readonly logger = new Logger(RelevanceScorer.name);
  private readonly defaultThreshold: number;

  constructor() {
    this.defaultThreshold = parseFloat(
      process.env.RELEVANCE_THRESHOLD || '0.3'
    );
  }

  /**
   * Score a single result against a search term
   */
  scoreResult<T>(result: T, searchTerm: string): ScoredResult<T> {
    const resultString = this.stringifyResult(result).toLowerCase();
    const searchLower = searchTerm.toLowerCase();
    
    let score = 0;
    let matchType: 'exact' | 'partial' | 'fuzzy' | 'none' = 'none';

    // Exact match in any field
    if (resultString.includes(searchLower)) {
      score = 1.0;
      matchType = 'exact';
    } else {
      // Check for partial word matches
      const searchWords = searchLower.split(/\s+/);
      const matchedWords = searchWords.filter(word => 
        word.length > 2 && resultString.includes(word)
      );

      if (matchedWords.length > 0) {
        score = matchedWords.length / searchWords.length;
        matchType = 'partial';
      } else {
        // Try fuzzy matching (basic implementation)
        score = this.fuzzyMatch(resultString, searchLower);
        matchType = score > 0 ? 'fuzzy' : 'none';
      }
    }

    return {
      data: result,
      relevanceScore: score,
      matchType,
    };
  }

  /**
   * Score multiple results and sort by relevance
   */
  scoreResults<T>(results: T[], searchTerm: string): ScoredResult<T>[] {
    if (!searchTerm || searchTerm.trim().length === 0) {
      // No search term, return all with neutral score
      return results.map(data => ({
        data,
        relevanceScore: 0.5,
        matchType: 'none' as const,
      }));
    }

    const scored = results.map(result => this.scoreResult(result, searchTerm));

    // Sort by relevance score (descending)
    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return scored;
  }

  /**
   * Filter results by relevance threshold
   */
  filterByThreshold<T>(
    results: ScoredResult<T>[],
    threshold?: number
  ): ScoredResult<T>[] {
    const cutoff = threshold ?? this.defaultThreshold;
    
    const filtered = results.filter(r => r.relevanceScore >= cutoff);

    this.logger.debug(
      `Filtered ${results.length} results to ${filtered.length} with threshold ${cutoff}`
    );

    return filtered;
  }

  /**
   * Score and filter in one operation
   */
  scoreAndFilter<T>(
    results: T[],
    searchTerm: string,
    threshold?: number
  ): ScoredResult<T>[] {
    const scored = this.scoreResults(results, searchTerm);
    return this.filterByThreshold(scored, threshold);
  }

  /**
   * Convert result object to searchable string
   */
  private stringifyResult(result: unknown): string {
    if (typeof result === 'string') {
      return result;
    }

    if (typeof result === 'object' && result !== null) {
      // Recursively extract string values from object
      return JSON.stringify(result);
    }

    return String(result);
  }

  /**
   * Basic fuzzy matching algorithm
   * Returns score between 0 and 1 based on character overlap
   */
  private fuzzyMatch(text: string, pattern: string): number {
    if (pattern.length === 0) return 0;
    if (text.length === 0) return 0;

    // Count matching characters (in order)
    let patternIndex = 0;
    let matches = 0;

    for (let i = 0; i < text.length && patternIndex < pattern.length; i++) {
      if (text[i] === pattern[patternIndex]) {
        matches++;
        patternIndex++;
      }
    }

    return matches / pattern.length;
  }

  /**
   * Calculate Levenshtein distance between two strings
   * Used for more sophisticated fuzzy matching
   */
  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Calculate similarity ratio between two strings
   * Returns value between 0 and 1
   */
  private similarityRatio(a: string, b: string): number {
    const distance = this.levenshteinDistance(a, b);
    const maxLength = Math.max(a.length, b.length);
    return maxLength > 0 ? 1 - distance / maxLength : 0;
  }
}

