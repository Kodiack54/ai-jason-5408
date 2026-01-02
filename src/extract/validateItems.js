/**
 * Validate extracted items against strict schemas
 * Uses Ajv for JSON schema validation
 *
 * Every item MUST have:
 * - bucket (valid bucket name)
 * - content (non-empty)
 * - evidence (at least one source reference)
 */

const Ajv = require('ajv');
const { Logger } = require('../lib/logger');

const logger = new Logger('Jason:ValidateItems');
const ajv = new Ajv({ allErrors: true });

// Valid bucket names (must match Susan's BUCKET_TO_TABLE)
const VALID_BUCKETS = [
  'Bugs Open',
  'Bugs Fixed',
  'Todos',
  'Journal',
  'Work Log',
  'Ideas',
  'Decisions',
  'Lessons',
  'System Breakdown',
  'How-To Guide',
  'Schematic',
  'Reference',
  'Naming Conventions',
  'File Structure',
  'Database Patterns',
  'API Patterns',
  'Component Patterns',
  'Quirks & Gotchas',
  'Snippets',
  'Other'
];

// Base schema for all items
const baseItemSchema = {
  type: 'object',
  required: ['bucket', 'content', 'evidence'],
  properties: {
    bucket: {
      type: 'string',
      enum: VALID_BUCKETS
    },
    title: {
      type: 'string',
      minLength: 1,
      maxLength: 500
    },
    content: {
      type: 'string',
      minLength: 5,
      maxLength: 10000
    },
    priority: {
      type: 'string',
      enum: ['low', 'medium', 'high', 'critical']
    },
    evidence: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['session_id'],
        properties: {
          session_id: { type: 'string' },
          excerpt: { type: 'string', maxLength: 500 },
          location: { type: 'string' }
        }
      }
    },
    metadata: {
      type: 'object'
    }
  }
};

const validateBase = ajv.compile(baseItemSchema);

/**
 * Validate a single item
 * @returns {Object} { valid: boolean, errors: string[] }
 */
function validateItem(item) {
  const errors = [];

  // Schema validation
  if (!validateBase(item)) {
    errors.push(...(validateBase.errors || []).map(e => `${e.instancePath} ${e.message}`));
  }

  // Additional guardrails

  // Content must not be empty or just whitespace
  if (!item.content?.trim()) {
    errors.push('content is empty or whitespace only');
  }

  // Evidence must have at least one valid session_id
  if (!item.evidence?.some(e => e.session_id)) {
    errors.push('evidence must include at least one session_id');
  }

  // Title should not be garbage
  if (item.title) {
    const garbagePatterns = [
      /^\|/,
      /^\[\d+\]/,
      /^http/,
      /^\s*$/,
      /^[^a-zA-Z]*$/  // No letters at all
    ];
    if (garbagePatterns.some(p => p.test(item.title))) {
      errors.push('title appears to be garbage');
    }
  }

  // Content should not be too short for meaningful extraction
  if (item.content && item.content.length < 10) {
    errors.push('content too short to be meaningful');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validate array of items
 * @param {Array} items - Items to validate
 * @returns {Object} { valid: [], invalid: [] }
 */
function validateItems(items) {
  const valid = [];
  const invalid = [];

  for (const item of items) {
    const result = validateItem(item);

    if (result.valid) {
      valid.push(item);
    } else {
      invalid.push({
        item,
        error: result.errors.join('; ')
      });
    }
  }

  if (invalid.length > 0) {
    logger.warn(`Validation rejected ${invalid.length} items`, {
      valid: valid.length,
      invalid: invalid.length
    });
  }

  return { valid, invalid };
}

module.exports = {
  validateItems,
  validateItem,
  VALID_BUCKETS,
  baseItemSchema
};
