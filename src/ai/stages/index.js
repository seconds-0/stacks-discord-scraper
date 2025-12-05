export { runFilterStage } from './filter.js';
export { runCategorizeStage } from './categorize.js';
export { runSummarizeStage } from './summarize.js';
export { runExtractStage } from './extract.js';

// Map stage names to their runner functions
export const stages = {
  filter: () => import('./filter.js').then((m) => m.runFilterStage),
  categorize: () => import('./categorize.js').then((m) => m.runCategorizeStage),
  summarize: () => import('./summarize.js').then((m) => m.runSummarizeStage),
  extract: () => import('./extract.js').then((m) => m.runExtractStage),
  // Future stage:
  // format: () => import('./format.js').then(m => m.runFormatStage),
};

export const stageOrder = ['filter', 'categorize', 'summarize', 'extract', 'format'];

export async function getStageRunner(stageName) {
  const loader = stages[stageName];
  if (!loader) {
    throw new Error(`Unknown stage: ${stageName}. Available: ${Object.keys(stages).join(', ')}`);
  }
  return loader();
}

export default {
  stages,
  stageOrder,
  getStageRunner,
};
