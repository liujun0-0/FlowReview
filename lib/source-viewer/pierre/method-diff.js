import { parseDiffFromFile, processFile } from '@pierre/diffs';

// Reparse a genuine partial patch instead of editing interconnected renderer indexes.
export function methodDiff(path, oldText, newText, oldRange, newRange, complete, cacheKey) {
  const normalize = text => text.replace(/\r\n/g, '\n');
  // Compare only the selected method; neighboring changes must not leak into its card.
  const clip = (text, range) => range ? (normalize(text).match(/[^\n]*\n|[^\n]+$/g) || []).slice(range[0] - 1, range[1]).join('') : '';
  const source = parseDiffFromFile({ name: path, contents: clip(oldText, oldRange) }, { name: path, contents: clip(newText, newRange) }, { context: complete ? Math.max(...[oldRange, newRange].map(r => r ? r[1] - r[0] + 1 : 0), 5) : 5 });
  const hunks = source.hunks;
  if (!hunks.length) return null;
  const patch = ['--- a/source.java\n', '+++ b/source.java\n'];
  function lines(prefix, values, start, count) {
    for (let i = start; i < start + count; i++) {
      if (values[i] === undefined) throw new Error('差异行索引超出源码范围');
      const line = values[i];
      patch.push(prefix + line + (line.endsWith('\n') ? '' : '\n'));
      if (!line.endsWith('\n')) patch.push('\\ No newline at end of file\n');
    }
  }
  for (const h of hunks) {
    patch.push(`@@ -${oldRange ? h.deletionStart + oldRange[0] - 1 : 0},${h.deletionCount} +${newRange ? h.additionStart + newRange[0] - 1 : 0},${h.additionCount} @@\n`);
    for (const group of h.hunkContent) {
      if (group.type === 'context') lines(' ', source.deletionLines, group.deletionLineIndex, group.lines);
      else {
        lines('-', source.deletionLines, group.deletionLineIndex, group.deletions);
        lines('+', source.additionLines, group.additionLineIndex, group.additions);
      }
    }
  }
  const result = processFile(patch.join(''), { cacheKey, throwOnError: true });
  if (!result) throw new Error('无法解析方法差异');
  result.name = path;
  return result;
}
