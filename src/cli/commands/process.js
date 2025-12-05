import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { initDatabase, closeDatabase } from '../../storage/database.js';
import { loadConfig } from '../../utils/config.js';
import { initLogger, logger } from '../../utils/logger.js';
import { getStageRunner, stageOrder } from '../../ai/stages/index.js';
import { estimateCost } from '../../ai/tokens.js';
import { countMessages } from '../../storage/repositories/index.js';

export const processCommand = new Command('process')
  .description('Run AI processing stages on scraped messages');

processCommand
  .command('run')
  .description('Run one or more AI processing stages')
  .option('-s, --stage <stage>', 'Stage to run (filter, categorize, summarize, extract, format)')
  .option('--all', 'Run all enabled stages in order')
  .option('-c, --channel <id>', 'Filter by channel ID')
  .option('--since <date>', 'Process messages since date (ISO 8601)')
  .option('--until <date>', 'Process messages until date (ISO 8601)')
  .option('-l, --limit <n>', 'Limit number of messages to process', parseInt)
  .option('--force', 'Reprocess already-processed messages', false)
  .option('--dry-run', 'Preview what would be processed without calling AI', false)
  .action(async (options) => {
    const spinner = ora();

    try {
      const config = loadConfig();
      initLogger(config.logging);

      const dbPath = config.database.path;
      const db = initDatabase(dbPath);

      // Determine which stages to run
      let stagesToRun = [];
      if (options.all) {
        stagesToRun = stageOrder.filter((s) => config.ai.stages[s]?.enabled);
      } else if (options.stage) {
        stagesToRun = [options.stage];
      } else {
        console.error(chalk.red('Specify --stage <name> or --all'));
        process.exit(1);
      }

      console.log(chalk.blue(`\nProcessing stages: ${stagesToRun.join(' → ')}\n`));

      if (options.dryRun) {
        console.log(chalk.yellow('DRY RUN MODE - No AI calls will be made\n'));
      }

      const totalMessages = countMessages(db);
      console.log(chalk.dim(`Total messages in database: ${totalMessages}`));

      const allResults = {};

      for (const stageName of stagesToRun) {
        spinner.start(`Running ${stageName} stage...`);

        try {
          const runner = await getStageRunner(stageName);
          const results = await runner(db, {
            channelId: options.channel,
            startDate: options.since,
            endDate: options.until,
            limit: options.limit,
            force: options.force,
            dryRun: options.dryRun,
          });

          allResults[stageName] = results;

          if (options.dryRun) {
            spinner.info(
              `${stageName}: Would process ${results.messageCount || 0} messages ` +
                `in ${results.batchCount || 0} batches (~${results.estimatedTokens || 0} tokens)`
            );
          } else {
            spinner.succeed(
              `${stageName}: Processed ${results.processed || 0} messages`
            );

            // Show stage-specific stats
            if (stageName === 'filter' && results.kept !== undefined) {
              console.log(
                chalk.dim(`   Kept: ${results.kept}, Discarded: ${results.discarded}`)
              );
            }
            if (stageName === 'categorize' && results.byTopic) {
              const topTopics = Object.entries(results.byTopic)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([t, c]) => `${t}: ${c}`)
                .join(', ');
              console.log(chalk.dim(`   Top topics: ${topTopics}`));
            }

            if (results.errors?.length > 0) {
              console.log(chalk.yellow(`   Errors: ${results.errors.length}`));
            }
          }
        } catch (error) {
          spinner.fail(`${stageName}: ${error.message}`);
          allResults[stageName] = { error: error.message };
        }
      }

      // Summary
      console.log(chalk.blue('\n─'.repeat(50)));

      if (!options.dryRun) {
        // Calculate total usage
        let totalUsage = { calls: 0, inputTokens: 0, outputTokens: 0 };
        for (const results of Object.values(allResults)) {
          if (results.usage) {
            totalUsage.calls += results.usage.calls || 0;
            totalUsage.inputTokens += results.usage.inputTokens || 0;
            totalUsage.outputTokens += results.usage.outputTokens || 0;
          }
        }

        if (totalUsage.calls > 0) {
          const cost = estimateCost(totalUsage);
          console.log(chalk.dim(`\nToken usage:`));
          console.log(chalk.dim(`  API calls: ${totalUsage.calls}`));
          console.log(chalk.dim(`  Input tokens: ${totalUsage.inputTokens}`));
          console.log(chalk.dim(`  Output tokens: ${totalUsage.outputTokens}`));
          console.log(chalk.dim(`  Estimated cost: $${cost.toFixed(4)}`));
        }
      }

      console.log(chalk.green('\n✓ Processing complete\n'));

      closeDatabase();
    } catch (error) {
      spinner.fail(error.message);
      console.error(chalk.red('Processing failed:'), error);
      process.exit(1);
    }
  });

processCommand
  .command('status')
  .description('Show processing status for each stage')
  .action(async () => {
    try {
      const config = loadConfig();
      const dbPath = config.database.path;
      const db = initDatabase(dbPath);

      console.log(chalk.blue('\nAI Processing Status\n'));
      console.log(chalk.dim('─'.repeat(50)));

      const totalMessages = countMessages(db);
      console.log(`Total messages: ${chalk.green(totalMessages)}\n`);

      for (const stage of stageOrder) {
        const enabled = config.ai.stages[stage]?.enabled ? '✓' : '✗';
        const count = db
          .prepare('SELECT COUNT(*) as count FROM ai_processing WHERE stage = ?')
          .get(stage);

        console.log(
          `${enabled} ${stage.padEnd(12)} ${chalk.green(count.count)} processed`
        );
      }

      // Filter stats
      const filterStats = db
        .prepare(`
          SELECT
            SUM(CASE WHEN json_extract(result_json, '$.keep') = 1 THEN 1 ELSE 0 END) as kept,
            SUM(CASE WHEN json_extract(result_json, '$.keep') = 0 THEN 1 ELSE 0 END) as discarded
          FROM ai_processing WHERE stage = 'filter'
        `)
        .get();

      if (filterStats.kept || filterStats.discarded) {
        console.log(chalk.dim(`\nFilter breakdown:`));
        console.log(chalk.dim(`  Kept: ${filterStats.kept || 0}`));
        console.log(chalk.dim(`  Discarded: ${filterStats.discarded || 0}`));
      }

      console.log('');
      closeDatabase();
    } catch (error) {
      console.error(chalk.red('Failed to get status:'), error.message);
      process.exit(1);
    }
  });

processCommand
  .command('reset')
  .description('Clear AI processing results for a stage')
  .argument('<stage>', 'Stage to reset (filter, categorize, etc.)')
  .option('--confirm', 'Skip confirmation prompt')
  .action(async (stage, options) => {
    try {
      if (!stageOrder.includes(stage)) {
        console.error(chalk.red(`Unknown stage: ${stage}`));
        console.error(`Available: ${stageOrder.join(', ')}`);
        process.exit(1);
      }

      const config = loadConfig();
      const db = initDatabase(config.database.path);

      const count = db
        .prepare('SELECT COUNT(*) as count FROM ai_processing WHERE stage = ?')
        .get(stage);

      if (count.count === 0) {
        console.log(chalk.yellow(`No ${stage} results to clear`));
        closeDatabase();
        return;
      }

      if (!options.confirm) {
        console.log(
          chalk.yellow(`This will delete ${count.count} ${stage} results.`)
        );
        console.log(chalk.dim('Use --confirm to proceed'));
        closeDatabase();
        return;
      }

      db.prepare('DELETE FROM ai_processing WHERE stage = ?').run(stage);
      console.log(chalk.green(`✓ Cleared ${count.count} ${stage} results`));

      closeDatabase();
    } catch (error) {
      console.error(chalk.red('Reset failed:'), error.message);
      process.exit(1);
    }
  });

export default processCommand;
