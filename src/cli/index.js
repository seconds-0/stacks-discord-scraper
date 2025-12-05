#!/usr/bin/env node

import { Command } from 'commander';
import dotenv from 'dotenv';
import { scrapeCommand } from './commands/scrape.js';
import { dbCommand } from './commands/db.js';
import { exportCommand } from './commands/export.js';

// Load environment variables
dotenv.config();

const program = new Command();

program
  .name('stacks-discord')
  .description('Discord scraper and AI content pipeline for Stacks Labs marketing')
  .version('1.0.0');

// Register commands
program.addCommand(scrapeCommand);
program.addCommand(dbCommand);
program.addCommand(exportCommand);

// Parse arguments
program.parse();
