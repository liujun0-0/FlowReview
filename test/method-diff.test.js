import { test } from 'node:test';
import assert from 'node:assert/strict';
import { methodDiff } from '../lib/source-viewer/pierre/method-diff.js';
import { iterateOverDiff } from '../node_modules/@pierre/diffs/dist/utils/iterateOverDiff.js';

function validate(diff, oldText, newText) {
  assert.ok(diff?.isPartial);
  for (const style of ['unified', 'split']) {
    let count = 0;
    iterateOverDiff({ diff, diffStyle: style, callback({ deletionLine, additionLine }) {
      assert.ok(deletionLine || additionLine);
      for (const [line, values, original] of [[deletionLine, diff.deletionLines, oldText], [additionLine, diff.additionLines, newText]]) {
        if (!line) continue;
        assert.notEqual(values[line.lineIndex], undefined);
        assert.equal(values[line.lineIndex].replace(/\n$/, ''), original.replace(/\r\n/g, '\n').split('\n')[line.lineNumber - 1]);
      }
      count++;
    }});
    assert.ok(count > 0);
  }
}

test('late method diff preserves original coordinates with compact valid line indexes', () => {
  const oldLines = Array.from({ length: 350 }, (_, i) => `line ${i + 1}`);
  const newLines = [...oldLines]; newLines[4] = 'unrelated'; newLines[270] = 'changed'; newLines[330] = 'another unrelated';
  const oldText = oldLines.join('\n'), newText = newLines.join('\n');
  for (const complete of [false, true]) {
    const diff = methodDiff('A.java', oldText, newText, [265, 280], [265, 280], complete, 'test');
    validate(diff, oldText, newText);
    assert.ok(diff.hunks.every(h => h.additionStart > 200));
  }
});

test('new and deleted files, separated hunks, CRLF and no final newline remain renderable', () => {
  const oldText = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
  const newText = oldText.replace('line 10\n', 'new 10\n').replace('line 80\n', 'new 80\n').replaceAll('\n', '\r\n');
  for (const [before, after, a, b] of [[oldText,newText,[1,100],[1,100]], ['',newText,null,[1,100]], [oldText,'',[1,100],null]]) {
    validate(methodDiff('A.java',before,after,a,b,false,'test'), before, after);
  }
});


test('adjacent method changes cannot repeat the entire class in every method card', () => {
 const before='class A {\nvoid first() {\n oldCall();\n}\nvoid other() {\n oldOther();\n}\n}';
 const after=before.replace('oldCall()', 'newCall()').replace('oldOther()', 'newOther()');
 const diff=methodDiff('A.java',before,after,[2,4],[2,4],true,'isolated');
 validate(diff,before,after);
 assert.ok(!diff.additionLines.join('').includes('newOther'));
 assert.ok(!diff.deletionLines.join('').includes('oldOther'));
 assert.ok(!diff.additionLines.join('').includes('class A'));
 const added='class A {\nvoid added() {\n run();\n}\n}';
 const newMethod=methodDiff('A.java','class A {\n}',added,null,[2,4],true,'added-method');
 validate(newMethod,'class A {\n}',added);
 assert.ok(!newMethod.additionLines.join('').includes('class A'));
});
