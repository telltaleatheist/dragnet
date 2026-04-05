import { Logger } from '@nestjs/common';

/**
 * Extract JSON from an AI response that may contain extra text, markdown fences,
 * <notes> tags, or other non-JSON content.
 *
 * Strategies (in order):
 * 1. Strip <notes>...</notes> blocks (model explanations)
 * 2. Strip markdown code fences
 * 3. Find JSON via bracket/brace balancing
 * 4. Repair common JSON issues (trailing commas, unquoted keys, truncation)
 */

/** Strip <notes> blocks that models may use for explanations */
function stripNotes(text: string): string {
  return text.replace(/<notes>[\s\S]*?<\/notes>/gi, '').trim();
}

/** Strip markdown code fences */
function stripFences(text: string): string {
  if (!text.includes('```')) return text;
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match) return match[1].trim();
  return text.split('\n').filter((l) => !l.trim().startsWith('```')).join('\n').trim();
}

/** Find a balanced JSON structure (object or array) via bracket counting */
function extractBalancedJson(text: string): string | null {
  // Find the first [ or { — that's where JSON starts
  const firstArray = text.indexOf('[');
  const firstObject = text.indexOf('{');

  let start: number;
  let openChar: string;
  let closeChar: string;

  if (firstArray === -1 && firstObject === -1) return null;
  if (firstArray === -1) {
    start = firstObject;
    openChar = '{';
    closeChar = '}';
  } else if (firstObject === -1) {
    start = firstArray;
    openChar = '[';
    closeChar = ']';
  } else {
    // Use whichever comes first
    if (firstArray < firstObject) {
      start = firstArray;
      openChar = '[';
      closeChar = ']';
    } else {
      start = firstObject;
      openChar = '{';
      closeChar = '}';
    }
  }

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === '\\') {
      escape = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === openChar || (openChar === '[' && ch === '{') || (openChar === '{' && ch === '[')) {
      // Count all bracket types
    }

    if (ch === '[' || ch === '{') depth++;
    if (ch === ']' || ch === '}') depth--;

    if (depth === 0) {
      return text.substring(start, i + 1);
    }
  }

  // If we ran out of text, return what we have (truncated response)
  return text.substring(start);
}

/** Fix common JSON issues from AI responses */
function repairJson(json: string): string {
  let fixed = json;

  // Fix double-nested braces in arrays: [{ { "id":... } }] → [{ "id":... }]
  // Common with smaller models that wrap array items in extra braces.
  fixed = fixed.replace(/\[\s*\{\s*\{/g, '[{');
  fixed = fixed.replace(/,\s*\{\s*\{/g, ',{');
  fixed = fixed.replace(/\}\s*\}\s*,/g, '},');
  fixed = fixed.replace(/\}\s*\}\s*\]/g, '}]');

  // Fix trailing commas before closing braces/brackets
  fixed = fixed.replace(/,\s*([\]}])/g, '$1');

  // Fix unquoted keys (simple cases)
  fixed = fixed.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');

  // Fix single quotes to double quotes for keys
  fixed = fixed.replace(/'(\w+)'(\s*:)/g, '"$1"$2');

  // Remove control characters (keep newlines, tabs)
  fixed = fixed.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Fix truncated strings — close unclosed quotes and brackets
  const quoteCount = (fixed.match(/(?<!\\)"/g) || []).length;
  if (quoteCount % 2 !== 0) {
    fixed += '"';
    const openBraces = (fixed.match(/\{/g) || []).length;
    const closeBraces = (fixed.match(/\}/g) || []).length;
    for (let i = 0; i < openBraces - closeBraces; i++) fixed += '}';
    const openBrackets = (fixed.match(/\[/g) || []).length;
    const closeBrackets = (fixed.match(/\]/g) || []).length;
    for (let i = 0; i < openBrackets - closeBrackets; i++) fixed += ']';
  }

  return fixed;
}

/**
 * Safely parse a JSON response from an AI model.
 * Handles markdown fences, <notes> blocks, extra text, truncated output,
 * and common JSON formatting issues from smaller models.
 *
 * Returns parsed value or null if all strategies fail.
 */
export function safeJsonParse<T>(response: string, logger?: Logger): T | null {
  if (!response?.trim()) return null;

  // Step 1: Strip notes and fences
  let cleaned = stripNotes(response);
  cleaned = stripFences(cleaned);

  // Step 2: Try direct parse
  try {
    return JSON.parse(cleaned.trim()) as T;
  } catch {
    // continue to fallbacks
  }

  // Step 3: Extract balanced JSON structure
  const extracted = extractBalancedJson(cleaned);
  if (!extracted) {
    logger?.warn('No JSON structure found in AI response');
    logger?.debug(`Raw response: ${response.slice(0, 300)}`);
    return null;
  }

  // Step 4: Try parsing the extracted JSON
  try {
    return JSON.parse(extracted) as T;
  } catch {
    // continue to repair
  }

  // Step 5: Repair and retry
  try {
    const repaired = repairJson(extracted);
    return JSON.parse(repaired) as T;
  } catch (err) {
    logger?.error(`All JSON parse strategies failed: ${(err as Error).message}`);
    logger?.debug(`Extracted JSON: ${extracted.slice(0, 300)}`);
    return null;
  }
}
