#!/usr/bin/env node
// Compatibility executable and import path; implementation belongs to FlowReview.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewMain } from '../lib/cli/review.js';
export { reviewMain, parseReviewArgs } from '../lib/cli/review.js';
if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) reviewMain().catch(error => {
  if (process.send) process.send({ error: error.message });
  console.error(error.message); process.exitCode = 1;
});
