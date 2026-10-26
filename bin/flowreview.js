#!/usr/bin/env node
import { reviewMain } from './yadiff-review.js';
reviewMain().catch(error => {
  if (process.send) process.send({ error: error.message });
  console.error(error.message);
  process.exitCode = 1;
});
