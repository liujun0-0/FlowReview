import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export function readState(path) {
  const state = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { marks: {} };
  if (!state || typeof state !== 'object' || !state.marks || typeof state.marks !== 'object' || Array.isArray(state.marks)) throw new Error('阅读进度格式错误，原文件已保留');
  return { ...state, revision: Number.isSafeInteger(state.revision) ? state.revision : 0 };
}

const defaultMark = { read: false, question: false, note: '' };
const record = value => value && typeof value === 'object' && !Array.isArray(value);
export class StateError extends Error {
  constructor(message, status = 400, state) { super(message); this.status = status; this.state = state; }
}

export function applyStateChange(current, body, nodes, patch = true) {
  const changes = patch ? body?.changes : body?.marks;
  if (!record(changes)) throw new StateError('阅读标记格式错误');
  for (const [id, value] of Object.entries(changes)) {
    if (!Object.hasOwn(nodes, id) || !record(value)) throw new StateError('未知阅读节点');
    if (patch && Object.keys(value).some(field => !Object.hasOwn(defaultMark, field))) throw new StateError('未知标记字段');
    if (patch && (('note' in value && typeof value.note !== 'string') || ['read', 'question'].some(field => field in value && typeof value[field] !== 'boolean'))) throw new StateError('标记字段类型错误');
  }
  if (!patch && (body.baseRevision ?? 0) !== current.revision) throw new StateError('进度已更新，请刷新旧页面后重试', 409, current);
  const marks = patch ? { ...current.marks } : {};
  for (const [id, value] of Object.entries(changes)) {
    const existing = { ...defaultMark, ...current.marks[id] };
    if (patch) {
      for (const [field, wanted] of Object.entries(value)) {
        if (!record(body.expected?.[id]) || !Object.hasOwn(body.expected[id], field)) throw new StateError('缺少字段原值');
        if (body.expected[id][field] !== existing[field] && wanted !== existing[field]) throw new StateError('其他页面已修改同一字段；本次内容未覆盖，请保留本页内容后核对', 409, current);
      }
      marks[id] = { ...existing, ...value };
    } else marks[id] = { read: value.read === true, question: value.question === true, note: String(value.note || '') };
    if (marks[id].note.length > 10_000) throw new StateError('单条疑问不能超过 10000 字符');
  }
  return { ...current, marks, position: record(body.position) ? body.position : current.position, revision: current.revision + 1, updatedAt: new Date().toISOString() };
}

export function writeState(path, state) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
  renameSync(temporary, path);
}
