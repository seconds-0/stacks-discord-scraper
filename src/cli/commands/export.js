import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { initDatabase, closeDatabase } from '../../storage/database.js';
import {
  getAllMessages,
  getChannelsByGuild,
  getGuild,
  getUser,
  getEmbedsByMessage,
  getAttachmentsByMessage,
  getReactionsByMessage,
} from '../../storage/repositories/index.js';
import { exportToJson } from '../../export/json.js';

export const exportCommand = new Command('export')
  .description('Export data in various formats');

exportCommand
  .command('messages')
  .description('Export messages to a file')
  .option('-f, --format <format>', 'Output format (json, csv)', 'json')
  .option('-o, --output <path>', 'Output file path')
  .option('-c, --channel <id>', 'Filter by channel ID')
  .option('--since <date>', 'Filter messages since date (ISO 8601)')
  .option('--until <date>', 'Filter messages until date (ISO 8601)')
  .option('--include-embeds', 'Include embed data', false)
  .option('--include-attachments', 'Include attachment data', false)
  .option('--include-reactions', 'Include reaction data', false)
  .option('--pretty', 'Pretty print JSON output', false)
  .action(async (options) => {
    const spinner = ora();

    try {
      const dbPath = process.env.DATABASE_PATH || './data/discord.db';
      const db = initDatabase(dbPath);

      spinner.start('Fetching messages...');

      // Build query options
      const queryOptions = {};
      if (options.channel) queryOptions.channelId = options.channel;
      if (options.since) queryOptions.startDate = options.since;
      if (options.until) queryOptions.endDate = options.until;

      const messages = getAllMessages(db, queryOptions);
      spinner.text = `Processing ${messages.length} messages...`;

      // Enrich messages if needed
      const enrichedMessages = messages.map(msg => {
        const result = { ...msg };

        // Add author info
        result.author = getUser(db, msg.author_id);

        if (options.includeEmbeds) {
          result.embeds = getEmbedsByMessage(db, msg.id);
        }
        if (options.includeAttachments) {
          result.attachments = getAttachmentsByMessage(db, msg.id);
        }
        if (options.includeReactions) {
          result.reactions = getReactionsByMessage(db, msg.id);
        }

        return result;
      });

      spinner.succeed(`Processed ${enrichedMessages.length} messages`);

      // Export based on format
      if (options.format === 'json') {
        const outputPath = options.output || `./exports/messages-${Date.now()}.json`;
        await exportToJson(enrichedMessages, outputPath, { pretty: options.pretty });
        console.log(chalk.green(`✓ Exported to ${outputPath}`));
      } else if (options.format === 'csv') {
        console.log(chalk.yellow('CSV export not yet implemented'));
      } else {
        console.error(chalk.red(`Unknown format: ${options.format}`));
      }

      closeDatabase();
    } catch (error) {
      spinner.fail(error.message);
      console.error(chalk.red('Export failed:'), error);
      process.exit(1);
    }
  });

exportCommand
  .command('channels')
  .description('Export channel list')
  .option('-f, --format <format>', 'Output format (json)', 'json')
  .option('-o, --output <path>', 'Output file path')
  .option('--pretty', 'Pretty print JSON output', false)
  .action(async (options) => {
    try {
      const dbPath = process.env.DATABASE_PATH || './data/discord.db';
      const db = initDatabase(dbPath);
      const guildId = process.env.DISCORD_GUILD_ID;

      if (!guildId) {
        console.error(chalk.red('DISCORD_GUILD_ID is required'));
        process.exit(1);
      }

      const channels = getChannelsByGuild(db, guildId);

      if (options.format === 'json') {
        const outputPath = options.output || `./exports/channels-${Date.now()}.json`;
        await exportToJson(channels, outputPath, { pretty: options.pretty });
        console.log(chalk.green(`✓ Exported ${channels.length} channels to ${outputPath}`));
      }

      closeDatabase();
    } catch (error) {
      console.error(chalk.red('Export failed:'), error);
      process.exit(1);
    }
  });

exportCommand
  .command('summary')
  .description('Export a summary of the scraped data')
  .option('-o, --output <path>', 'Output file path')
  .option('--pretty', 'Pretty print JSON output', true)
  .action(async (options) => {
    try {
      const dbPath = process.env.DATABASE_PATH || './data/discord.db';
      const db = initDatabase(dbPath);
      const guildId = process.env.DISCORD_GUILD_ID;

      const guild = guildId ? getGuild(db, guildId) : null;
      const channels = guildId ? getChannelsByGuild(db, guildId) : [];

      // Get message counts per channel
      const channelStats = channels.map(ch => {
        const count = db.prepare('SELECT COUNT(*) as count FROM messages WHERE channel_id = ?').get(ch.id);
        return {
          id: ch.id,
          name: ch.name,
          messageCount: count.count,
          lastScraped: ch.last_scraped_at,
        };
      }).filter(ch => ch.messageCount > 0);

      // Get date range
      const dateRange = db.prepare(`
        SELECT MIN(timestamp) as oldest, MAX(timestamp) as newest
        FROM messages
      `).get();

      // Get top users
      const topUsers = db.prepare(`
        SELECT u.username, u.global_name, COUNT(m.id) as message_count
        FROM messages m
        JOIN users u ON m.author_id = u.id
        WHERE u.is_bot = 0
        GROUP BY m.author_id
        ORDER BY message_count DESC
        LIMIT 10
      `).all();

      const summary = {
        guild: guild ? { id: guild.id, name: guild.name } : null,
        totalChannels: channelStats.length,
        totalMessages: channelStats.reduce((sum, ch) => sum + ch.messageCount, 0),
        dateRange: {
          oldest: dateRange.oldest,
          newest: dateRange.newest,
        },
        channelBreakdown: channelStats.sort((a, b) => b.messageCount - a.messageCount),
        topContributors: topUsers,
        exportedAt: new Date().toISOString(),
      };

      const outputPath = options.output || `./exports/summary-${Date.now()}.json`;
      await exportToJson(summary, outputPath, { pretty: options.pretty });
      console.log(chalk.green(`✓ Exported summary to ${outputPath}`));

      closeDatabase();
    } catch (error) {
      console.error(chalk.red('Export failed:'), error);
      process.exit(1);
    }
  });

export default exportCommand;
