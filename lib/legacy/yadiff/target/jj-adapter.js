import { runCommand, runCommandSync, trySync } from './run.js';

/**
 * @param {string} repo
 * @param {string[]} args
 */
function runJjSync(repo, args) {
  return runCommandSync('jj', ['--no-pager', '--color', 'never', ...args], repo);
}

/**
 * @param {string} repo
 * @param {string[]} args
 */
function runJj(repo, args) {
  return runCommand('jj', ['--no-pager', '--color', 'never', ...args], repo);
}

/**
 * Find the jj root at or above the given path, or undefined.
 */
export function findJjRoot(repo) {
  return trySync(() => runJjSync(repo, ['root']));
}

/**
 * Create a jj-backed target object.
 *
 * @param {{ target?: string, mode?: string }} args
 * @param {string} repoRoot
 */
export function createJjTarget(args, repoRoot) {
  const commits = resolveJjCommits(repoRoot, args);

  return {
    source: 'jj',
    repoRoot,

    getPatch() {
      return runJj(repoRoot, ['diff', '--git', '-r', args.target ?? '@']);
    },

    getCommits() {
      return commits;
    },

    getCommitPatch(commitId) {
      return runJj(repoRoot, ['diff', '--git', '-r', commitId]);
    },

    getHead() {
      return trySync(() => runJjSync(repoRoot, ['log', '-r', '@', '--no-graph', '-T', 'commit_id.short()'])) ?? 'unknown';
    },

    getStatus() {
      return { status: 'ready', source: 'jj' };
    },

    getFileContents(file) {
      return getJjFileContents(repoRoot, args.target ?? '@', file);
    },
  };
}

async function getJjFileContents(repoRoot, revision, file) {
  const oldPath = file.prevName ?? file.name;
  const newPath = file.name;
  const oldContents = file.type === 'new'
    ? ''
    : await readJjFile(repoRoot, `parents(${revision})`, oldPath);
  const newContents = file.type === 'deleted'
    ? ''
    : await readJjFile(repoRoot, revision, newPath);

  if (oldContents == null || newContents == null) {
    return undefined;
  }

  return {
    oldFile: {
      name: oldPath,
      contents: oldContents,
      cacheKey: `jj:${revision}:old:${file.prevObjectId ?? oldPath}`,
    },
    newFile: {
      name: newPath,
      contents: newContents,
      cacheKey: `jj:${revision}:new:${file.newObjectId ?? newPath}`,
    },
  };
}

async function readJjFile(repoRoot, revision, path) {
  if (path == null || path === '/dev/null') {
    return undefined;
  }
  try {
    return await runJj(repoRoot, ['file', 'show', '-r', revision, '--', path]);
  } catch {
    return undefined;
  }
}

function resolveJjCommits(repoRoot, args) {
  if (args.mode != null) return [];
  const target = args.target ?? '@';

  const logOutput = trySync(() => runJjSync(repoRoot, [
    'log', '-r', target, '--no-graph',
    '-T', 'change_id ++ "\t" ++ change_id.short(8) ++ "\t" ++ description.first_line() ++ "\n"',
  ]));
  if (!logOutput) return [];

  const lines = logOutput.split('\n').filter(Boolean);
  if (lines.length <= 1) return [];

  return lines.reverse().map((line) => {
    const [id, shortId, message] = line.split('\t');
    return { id, shortId: shortId ?? id.slice(0, 12), message: message ?? '' };
  });
}
