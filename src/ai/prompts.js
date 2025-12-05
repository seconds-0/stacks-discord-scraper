import fs from 'fs';
import path from 'path';

const promptCache = new Map();

/**
 * Load a prompt template from config/prompts.
 * @param {string} name - Prompt name (without .txt extension)
 * @returns {string} Prompt template content
 */
export function loadPrompt(name) {
  if (promptCache.has(name)) {
    return promptCache.get(name);
  }

  const promptPath = path.join(process.cwd(), 'config', 'prompts', `${name}.txt`);

  if (!fs.existsSync(promptPath)) {
    throw new Error(`Prompt template not found: ${promptPath}`);
  }

  const content = fs.readFileSync(promptPath, 'utf-8');
  promptCache.set(name, content);
  return content;
}

/**
 * Interpolate variables into a prompt template.
 * Variables are marked as {{VARIABLE_NAME}}.
 * @param {string} template - Prompt template
 * @param {Object} variables - Variable values
 * @returns {string} Interpolated prompt
 */
export function interpolatePrompt(template, variables) {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (key in variables) {
      const value = variables[key];
      // If value is an object/array, stringify it
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
    }
    // Keep the placeholder if no value provided
    return match;
  });
}

/**
 * Load and interpolate a prompt in one step.
 * @param {string} name - Prompt name
 * @param {Object} variables - Variable values
 * @returns {string} Ready-to-use prompt
 */
export function buildPrompt(name, variables = {}) {
  const template = loadPrompt(name);
  return interpolatePrompt(template, variables);
}

/**
 * Clear the prompt cache (useful for development/testing).
 */
export function clearPromptCache() {
  promptCache.clear();
}

/**
 * List available prompt templates.
 * @returns {Array<string>} List of prompt names (without .txt extension)
 */
export function listPrompts() {
  const promptsDir = path.join(process.cwd(), 'config', 'prompts');

  if (!fs.existsSync(promptsDir)) {
    return [];
  }

  return fs
    .readdirSync(promptsDir)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => f.replace('.txt', ''));
}

export default {
  loadPrompt,
  interpolatePrompt,
  buildPrompt,
  clearPromptCache,
  listPrompts,
};
