import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class QueryProcessor {
  private readonly logger = new Logger(QueryProcessor.name);

  /**
   * Normalize a search term by trimming, collapsing whitespace, and basic cleanup
   */
  normalizeSearchTerm(term: string): string {
    return term
      .trim()
      .replace(/\s+/g, ' ') // Collapse multiple spaces
      .replace(/[""]/g, '"') // Normalize quotes
      .replace(/['']/g, "'"); // Normalize apostrophes
  }

  /**
   * Generate variations of a search term for better matching
   * Returns array with original and variations
   */
  generateSearchVariations(term: string): string[] {
    const normalized = this.normalizeSearchTerm(term);
    const variations = [normalized];

    // If it looks like a person name (2-3 words), try reversed format
    const words = normalized.split(' ');
    if (words.length >= 2 && words.length <= 3) {
      // "Max Wilkinson" -> "Wilkinson, Max"
      const lastName = words[words.length - 1];
      const firstNames = words.slice(0, -1).join(' ');
      variations.push(`${lastName}, ${firstNames}`);
      
      // Also try without comma
      variations.push(`${lastName} ${firstNames}`);
      
      // Try just last name
      variations.push(lastName);
    }

    return variations;
  }

  /**
   * Preprocess member name for searching
   * Returns variations including reversed name format
   */
  preprocessMemberName(name: string): string[] {
    return this.generateSearchVariations(name);
  }

  /**
   * Sanitize search term for API compatibility
   * Removes or escapes characters that might break API queries
   */
  sanitizeForApi(term: string): string {
    return this.normalizeSearchTerm(term)
      .replace(/[<>]/g, '') // Remove angle brackets
      .replace(/[&]/g, 'and') // Replace ampersands
      .trim();
  }

  /**
   * Extract key terms from a longer query
   * Useful for complex queries that might benefit from simplification
   */
  extractKeyTerms(query: string): string[] {
    const normalized = this.normalizeSearchTerm(query);
    
    // Remove common stop words
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'about', 'as', 'into', 'through', 'during',
    ]);

    const words = normalized.toLowerCase().split(' ');
    const keyTerms = words.filter(word => 
      word.length > 2 && !stopWords.has(word)
    );

    return keyTerms.length > 0 ? keyTerms : [normalized];
  }

  /**
   * Determine if a search term should use fuzzy matching
   */
  shouldUseFuzzyMatch(term: string): boolean {
    // Use fuzzy matching for longer terms or terms with special characters
    return term.length > 15 || /[^a-zA-Z0-9\s-]/.test(term);
  }

  /**
   * Process legislation title for better matching
   */
  preprocessLegislationTitle(title: string): string[] {
    const normalized = this.normalizeSearchTerm(title);
    const variations = [normalized];

    // Try without common suffixes
    const suffixes = ['Act', 'Bill', 'Order', 'Regulations'];
    for (const suffix of suffixes) {
      if (normalized.endsWith(` ${suffix}`)) {
        variations.push(normalized.slice(0, -(suffix.length + 1)));
      }
    }

    // Try with year patterns
    const yearMatch = normalized.match(/(\d{4})/);
    if (yearMatch) {
      const withoutYear = normalized.replace(/\s*\d{4}\s*/, '').trim();
      if (withoutYear) {
        variations.push(withoutYear);
      }
    }

    return variations;
  }

  /**
   * Split compound search terms intelligently
   */
  splitCompoundTerm(term: string): string[] {
    const normalized = this.normalizeSearchTerm(term);
    const parts: string[] = [normalized];

    // Split on common delimiters
    const delimiters = [' and ', ' & ', ', ', '; '];
    for (const delimiter of delimiters) {
      if (normalized.toLowerCase().includes(delimiter)) {
        const split = normalized.split(new RegExp(delimiter, 'i'));
        parts.push(...split.filter(p => p.trim().length > 0));
        break;
      }
    }

    return parts;
  }
}

