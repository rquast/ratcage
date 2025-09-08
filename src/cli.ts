#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';

const program = new Command();

program
  .name('ratcage')
  .description('RatCage - A universal coding agent CLI wrapper')
  .version('0.0.1');

program
  .command('claude')
  .description('Run Claude Code CLI')
  .action(async () => {
    console.log(chalk.blue('Starting Claude Code...'));
    // TODO: Implement Claude Code wrapper
  });

program
  .command('config')
  .description('Configure RatCage settings')
  .action(async () => {
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'agent',
        message: 'Which agent would you like to configure?',
        choices: ['Claude Code', 'Other (coming soon)'],
      },
    ]);

    console.log(chalk.green(`Configuring ${answers.agent}...`));
    // TODO: Implement configuration
  });

program.parse();
