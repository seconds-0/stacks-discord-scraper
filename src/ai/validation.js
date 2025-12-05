import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true });

// Schema for filter stage response
const filterResponseSchema = {
  type: 'object',
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          keep: { type: 'boolean' },
          reason: { type: 'string' },
          quality_score: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['id', 'keep'],
      },
    },
  },
  required: ['decisions'],
};

// Schema for categorize stage response
const categorizeResponseSchema = {
  type: 'object',
  properties: {
    categorizations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          primary_topic: { type: 'string' },
          secondary_topics: { type: 'array', items: { type: 'string' } },
          sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative', 'mixed'] },
          urgency: { type: 'string', enum: ['high', 'medium', 'low'] },
          marketing_relevance: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['id', 'primary_topic'],
      },
    },
  },
  required: ['categorizations'],
};

// Schema for summarize stage response
const summarizeResponseSchema = {
  type: 'object',
  properties: {
    summary: {
      type: 'object',
      properties: {
        headline: { type: 'string' },
        key_points: { type: 'array', items: { type: 'string' } },
        notable_messages: { type: 'array', items: { type: 'string' } },
        themes: { type: 'array', items: { type: 'string' } },
        sentiment_overview: { type: 'string' },
        action_items: { type: 'array', items: { type: 'string' } },
      },
      required: ['headline', 'key_points'],
    },
  },
  required: ['summary'],
};

// Schema for extract stage response
const extractResponseSchema = {
  type: 'object',
  properties: {
    extracts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          source_message_id: { type: 'string' },
          type: { type: 'string' },
          content: { type: 'string' },
          context: { type: 'string' },
          relevance_score: { type: 'number', minimum: 0, maximum: 1 },
          requires_permission: { type: 'boolean' },
        },
        required: ['id', 'content', 'type'],
      },
    },
  },
  required: ['extracts'],
};

// Compile validators
const validators = {
  filter: ajv.compile(filterResponseSchema),
  categorize: ajv.compile(categorizeResponseSchema),
  summarize: ajv.compile(summarizeResponseSchema),
  extract: ajv.compile(extractResponseSchema),
};

/**
 * Validate AI response against expected schema.
 * @param {string} stage - Processing stage name
 * @param {Object} response - AI response to validate
 * @throws {Error} If validation fails
 * @returns {Object} Validated response
 */
export function validateResponse(stage, response) {
  const validator = validators[stage];
  if (!validator) {
    throw new Error(`No validator for stage: ${stage}`);
  }

  if (!validator(response)) {
    const errors = validator.errors
      .map((e) => `${e.instancePath} ${e.message}`)
      .join('; ');
    throw new Error(`Invalid AI response for ${stage} stage: ${errors}`);
  }

  return response;
}

/**
 * Validate filter stage response.
 */
export function validateFilterResponse(response) {
  return validateResponse('filter', response);
}

/**
 * Validate categorize stage response.
 */
export function validateCategorizeResponse(response) {
  return validateResponse('categorize', response);
}

/**
 * Validate summarize stage response.
 */
export function validateSummarizeResponse(response) {
  return validateResponse('summarize', response);
}

/**
 * Validate extract stage response.
 */
export function validateExtractResponse(response) {
  return validateResponse('extract', response);
}

export default {
  validateResponse,
  validateFilterResponse,
  validateCategorizeResponse,
  validateSummarizeResponse,
  validateExtractResponse,
};
