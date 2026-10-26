#!/usr/bin/env node
import { reviewMain } from '../lib/cli/review.js';
reviewMain(process.argv.length === 2 ? ['--help'] : process.argv.slice(2)).catch(error => {
  if (process.send) process.send({ error: error.message });
  console.error(error.message); process.exitCode = 1;
});
