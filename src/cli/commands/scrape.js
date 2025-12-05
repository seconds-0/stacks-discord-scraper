import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import {
  createClient,
  destroyClient,
  getGuild,
  getTextChannels,
  canReadChannel,
  formatGuildData,
  formatChannelData,
} from '../../scraper/client.js';
import { fetchMessages } from '../../scraper/messages.js';
import { initDatabase, closeDatabase } from '../../storage/database.js';
import {
  upsertGuild,
  upsertChannel,
  upsertUser,
  upsertMessage,
  upsertEmbed,
  upsertAttachment,
  upsertReaction,
  updateChannelLastScraped,
  getChannelLastScrapedId,
  createSyncState,
  completeSyncState,
  failSyncState,
} from '../../storage/repositories/index.js';

export const scrapeCommand = new Command('scrape')
  .description('Scrape Discord messages')
  .option('-f, --full', 'Full scrape of all channels (ignores last scraped position)')
  .option('-i, --incremental', 'Incremental scrape (only new messages since last run)')
  .option('-c, --channel <names...>', 'Scrape specific channel(s) by name')
  .option('--limit <number>', 'Maximum messages per channel', parseInt)
  .option('--delay <ms>', 'Delay between API requests in ms', parseInt, 100)
  .option('--dry-run', 'Show what would be scraped without actually scraping')
  .action(async (options) => {
    const spinner = ora();
    let db = null;

    try {
      // Validate environment
      const token = process.env.DISCORD_BOT_TOKEN;
      const guildId = process.env.DISCORD_GUILD_ID;

      if (!token) {
        console.error(chalk.red('Error: DISCORD_BOT_TOKEN is required'));
        process.exit(1);
      }

      if (!guildId) {
        console.error(chalk.red('Error: DISCORD_GUILD_ID is required'));
        process.exit(1);
      }

      // Determine scrape mode
      const isIncremental = options.incremental || (!options.full && !options.channel);
      const mode = options.full ? 'full' : (isIncremental ? 'incremental' : 'channel');

      console.log(chalk.blue(`\nStarting ${mode} scrape...\n`));

      // Initialize database
      if (!options.dryRun) {
        spinner.start('Initializing database...');
        const dbPath = process.env.DATABASE_PATH || './data/discord.db';
        db = initDatabase(dbPath);
        spinner.succeed('Database initialized');
      }

      // Connect to Discord
      spinner.start('Connecting to Discord...');
      const client = await createClient(token);
      spinner.succeed(`Connected as ${chalk.green(client.user.tag)}`);

      // Get guild
      spinner.start('Fetching guild info...');
      const guild = await getGuild(guildId);
      spinner.succeed(`Found guild: ${chalk.green(guild.name)} (${guild.memberCount} members)`);

      // Store guild
      if (!options.dryRun) {
        upsertGuild(db, formatGuildData(guild));
      }

      // Create sync state
      let syncId = null;
      if (!options.dryRun) {
        syncId = createSyncState(db, mode, guildId);
      }

      // Get channels
      spinner.start('Fetching channels...');
      const allChannels = await getTextChannels(guild);
      spinner.succeed(`Found ${chalk.green(allChannels.size)} text channels`);

      // Filter channels if specific ones requested
      let channelsToScrape = Array.from(allChannels.values());
      if (options.channel) {
        const requestedNames = new Set(options.channel.map(n => n.toLowerCase()));
        channelsToScrape = channelsToScrape.filter(ch =>
          requestedNames.has(ch.name.toLowerCase())
        );
        console.log(chalk.yellow(`Filtering to ${channelsToScrape.length} requested channel(s)`));
      }

      // Filter to readable channels
      channelsToScrape = channelsToScrape.filter(canReadChannel);
      console.log(chalk.dim(`${channelsToScrape.length} channels are readable\n`));

      if (options.dryRun) {
        console.log(chalk.yellow('DRY RUN - Would scrape these channels:'));
        for (const channel of channelsToScrape) {
          console.log(`  - #${channel.name} (${channel.id})`);
        }
        destroyClient();
        return;
      }

      // Scrape each channel
      let totalMessages = 0;
      let totalChannels = 0;

      for (const channel of channelsToScrape) {
        // Store channel
        upsertChannel(db, formatChannelData(channel));

        // Determine starting point for incremental
        let afterId = null;
        if (isIncremental && !options.full) {
          afterId = getChannelLastScrapedId(db, channel.id);
          if (afterId) {
            console.log(chalk.dim(`  Resuming from message ${afterId}`));
          }
        }

        spinner.start(`Scraping #${channel.name}...`);

        let channelMessages = 0;
        let latestMessageId = null;

        try {
          for await (const data of fetchMessages(channel, {
            after: afterId,
            limit: options.limit,
            delay: options.delay,
          })) {
            // Store user
            upsertUser(db, data.user);

            // Store message
            upsertMessage(db, data.message);

            // Store embeds
            for (const embed of data.embeds) {
              upsertEmbed(db, embed);
            }

            // Store attachments
            for (const attachment of data.attachments) {
              upsertAttachment(db, attachment);
            }

            // Store reactions
            for (const reaction of data.reactions) {
              upsertReaction(db, reaction);
            }

            // Track latest message for incremental
            if (!latestMessageId || data.message.id > latestMessageId) {
              latestMessageId = data.message.id;
            }

            channelMessages++;

            // Update spinner every 100 messages
            if (channelMessages % 100 === 0) {
              spinner.text = `Scraping #${channel.name}... ${channelMessages} messages`;
            }
          }

          // Update last scraped position
          if (latestMessageId) {
            updateChannelLastScraped(db, channel.id, latestMessageId);
          }

          spinner.succeed(`#${channel.name}: ${chalk.green(channelMessages)} messages`);
          totalMessages += channelMessages;
          totalChannels++;

        } catch (error) {
          spinner.fail(`#${channel.name}: ${chalk.red(error.message)}`);
        }

        // Small delay between channels
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Complete sync state
      if (syncId) {
        completeSyncState(db, syncId, totalMessages);
      }

      // Summary
      console.log(chalk.green(`\n✓ Scrape complete!`));
      console.log(`  Channels: ${totalChannels}`);
      console.log(`  Messages: ${totalMessages}`);

    } catch (error) {
      spinner.fail(error.message);
      console.error(chalk.red('\nScrape failed:'), error);
      process.exit(1);
    } finally {
      destroyClient();
      if (db) closeDatabase();
    }
  });

export default scrapeCommand;
