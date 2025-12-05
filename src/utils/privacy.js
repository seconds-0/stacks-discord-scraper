/**
 * Privacy utilities for anonymizing user data.
 */

/**
 * Create a username anonymizer that maintains consistent mappings.
 * @returns {Object} Anonymizer with anonymize() and getMapping() methods
 */
export function createAnonymizer() {
  const mapping = new Map();
  let counter = 0;

  return {
    /**
     * Get anonymized version of a username.
     * @param {string} username - Original username
     * @returns {string} Anonymized username (e.g., "User_A")
     */
    anonymize: (username) => {
      if (!username) return 'User_Unknown';

      if (!mapping.has(username)) {
        counter++;
        const letter = String.fromCharCode(65 + ((counter - 1) % 26)); // A-Z
        const suffix = counter > 26 ? Math.floor((counter - 1) / 26) : '';
        mapping.set(username, `User_${letter}${suffix}`);
      }

      return mapping.get(username);
    },

    /**
     * Get the current mapping for reference.
     * @returns {Object} Username to anonymous mapping
     */
    getMapping: () => Object.fromEntries(mapping),

    /**
     * Reset the anonymizer state.
     */
    reset: () => {
      mapping.clear();
      counter = 0;
    },
  };
}

/**
 * Anonymize usernames in a batch of messages.
 * @param {Array} messages - Array of message objects
 * @param {Object} options - Options
 * @returns {Object} { messages: anonymized messages, mapping: username mapping }
 */
export function anonymizeMessages(messages, options = {}) {
  const anonymizer = createAnonymizer();

  const anonymized = messages.map((msg) => {
    const result = { ...msg };

    // Anonymize author info
    if (result.author) {
      result.author = {
        ...result.author,
        username: anonymizer.anonymize(result.author.username),
        global_name: result.author.global_name
          ? anonymizer.anonymize(result.author.global_name)
          : null,
      };
    }

    // Anonymize author_id field if present (replace with anonymous)
    if (result.author_id) {
      result.author_id = `anon_${result.author_id.slice(-4)}`;
    }

    // Optionally anonymize mentions in content
    if (options.anonymizeContent && result.content) {
      result.content = anonymizeMentions(result.content, anonymizer);
    }

    if (options.anonymizeContent && result.clean_content) {
      result.clean_content = anonymizeMentions(result.clean_content, anonymizer);
    }

    return result;
  });

  return {
    messages: anonymized,
    mapping: anonymizer.getMapping(),
  };
}

/**
 * Anonymize @mentions in message content.
 * @param {string} content - Message content
 * @param {Object} anonymizer - Anonymizer instance
 * @returns {string} Content with anonymized mentions
 */
export function anonymizeMentions(content, anonymizer) {
  if (!content) return content;

  // Match @username patterns (Discord style)
  return content.replace(/@(\w+)/g, (match, username) => {
    return `@${anonymizer.anonymize(username)}`;
  });
}

/**
 * Strip all identifying information from messages for export.
 * More aggressive than anonymizeMessages - removes IDs entirely.
 * @param {Array} messages - Array of message objects
 * @returns {Array} Stripped messages
 */
export function stripIdentifiers(messages) {
  return messages.map((msg) => {
    const { author_id, author, ...rest } = msg;

    return {
      ...rest,
      author: author
        ? {
            display_name: 'Anonymous',
            is_bot: author.is_bot,
          }
        : null,
    };
  });
}

export default {
  createAnonymizer,
  anonymizeMessages,
  anonymizeMentions,
  stripIdentifiers,
};
