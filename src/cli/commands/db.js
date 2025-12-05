import { Command } from 'commander';
import chalk from 'chalk';
import { initDatabase, getDatabaseStats, closeDatabase } from '../../storage/database.js';

export const dbCommand = new Command('db')
  .description('Database management commands');

dbCommand
  .command('init')
  .description('Initialize the database (create tables and run migrations)')
  .action(async () => {
    try {
      const dbPath = process.env.DATABASE_PATH || './data/discord.db';
      console.log(chalk.blue(`Initializing database at ${dbPath}...`));

      const db = initDatabase(dbPath);
      console.log(chalk.green('✓ Database initialized successfully'));

      closeDatabase();
    } catch (error) {
      console.error(chalk.red('Failed to initialize database:'), error.message);
      process.exit(1);
    }
  });

dbCommand
  .command('stats')
  .description('Show database statistics')
  .action(async () => {
    try {
      const dbPath = process.env.DATABASE_PATH || './data/discord.db';
      const db = initDatabase(dbPath);

      const stats = getDatabaseStats(db);

      console.log(chalk.blue('\nDatabase Statistics\n'));
      console.log(chalk.dim('─'.repeat(40)));

      console.log(`\n${chalk.bold('Records:')}`);
      console.log(`  Guilds:      ${chalk.green(stats.guilds || 0)}`);
      console.log(`  Channels:    ${chalk.green(stats.channels || 0)}`);
      console.log(`  Users:       ${chalk.green(stats.users || 0)}`);
      console.log(`  Messages:    ${chalk.green(stats.messages || 0)}`);
      console.log(`  Embeds:      ${chalk.green(stats.embeds || 0)}`);
      console.log(`  Attachments: ${chalk.green(stats.attachments || 0)}`);
      console.log(`  Reactions:   ${chalk.green(stats.reactions || 0)}`);

      if (stats.oldestMessage || stats.newestMessage) {
        console.log(`\n${chalk.bold('Date Range:')}`);
        console.log(`  Oldest: ${stats.oldestMessage || 'N/A'}`);
        console.log(`  Newest: ${stats.newestMessage || 'N/A'}`);
      }

      console.log(`\n${chalk.bold('Storage:')}`);
      console.log(`  File size: ${stats.fileSizeMB} MB`);

      console.log('');
      closeDatabase();
    } catch (error) {
      console.error(chalk.red('Failed to get stats:'), error.message);
      process.exit(1);
    }
  });

dbCommand
  .command('path')
  .description('Show the database file path')
  .action(() => {
    const dbPath = process.env.DATABASE_PATH || './data/discord.db';
    console.log(dbPath);
  });

export default dbCommand;
