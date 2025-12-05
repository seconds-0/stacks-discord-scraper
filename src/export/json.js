import fs from 'fs';
import path from 'path';

/**
 * Export data to a JSON file.
 * @param {Array|Object} data - Data to export.
 * @param {string} outputPath - Path to output file.
 * @param {Object} options - Export options.
 * @param {boolean} [options.pretty=false] - Pretty print the JSON.
 * @returns {Promise<void>}
 */
export async function exportToJson(data, outputPath, options = {}) {
  const { pretty = false } = options;

  // Ensure directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Serialize data
  const jsonString = pretty
    ? JSON.stringify(data, null, 2)
    : JSON.stringify(data);

  // Write file
  fs.writeFileSync(outputPath, jsonString, 'utf-8');
}

/**
 * Export data to a JSON Lines file (one JSON object per line).
 * Useful for large datasets that need streaming.
 * @param {Array} data - Array of objects to export.
 * @param {string} outputPath - Path to output file.
 * @returns {Promise<void>}
 */
export async function exportToJsonLines(data, outputPath) {
  // Ensure directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write each object on its own line
  const lines = data.map(obj => JSON.stringify(obj)).join('\n');
  fs.writeFileSync(outputPath, lines + '\n', 'utf-8');
}

/**
 * Stream export data to a JSON Lines file.
 * @param {AsyncIterable} dataStream - Async iterable of objects.
 * @param {string} outputPath - Path to output file.
 * @returns {Promise<number>} Number of records written.
 */
export async function streamExportToJsonLines(dataStream, outputPath) {
  // Ensure directory exists
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const writeStream = fs.createWriteStream(outputPath, { flags: 'w' });
  let count = 0;

  for await (const obj of dataStream) {
    writeStream.write(JSON.stringify(obj) + '\n');
    count++;
  }

  writeStream.end();

  return new Promise((resolve, reject) => {
    writeStream.on('finish', () => resolve(count));
    writeStream.on('error', reject);
  });
}

export default {
  exportToJson,
  exportToJsonLines,
  streamExportToJsonLines,
};
