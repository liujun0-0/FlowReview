"""Read-only checks for missing method-sequence data in a reader snapshot."""
import argparse
import json
from pathlib import Path


def inspect(manifest):
    nodes, files = manifest.get('nodes', {}), manifest.get('files', {})
    issues, warnings, flows = [], [], []
    checked = set()
    for flow in manifest.get('flows', []):
        ids = list(dict.fromkeys(i for c in flow.get('chains', []) for i in c.get('nodeIds', [])))
        methods = [i for i in ids if nodes.get(i, {}).get('rangeKind') == 'method']
        links = [e for c in flow.get('chains', []) for e in c.get('links', [])]
        flows.append({'id': flow.get('id'), 'methods': len(methods), 'methodLinks': sum(e.get('from') in methods and e.get('to') in methods for e in links)})
        if len(methods) > 1 and not any(e.get('from') in methods and e.get('to') in methods for e in links):
            warnings.append({'flow': flow.get('id'), 'message': '多个方法但没有独立方法关系，不能声称完整调用时序'})
        for node_id in ids:
            if node_id in checked:
                continue
            checked.add(node_id)
            n = nodes.get(node_id)
            if not n:
                issues.append({'node': node_id, 'message': '报告引用不存在的阅读节点'})
                continue
            f = files.get(n.get('fileId'), {})
            annotations = n.get('annotations', [])
            if n.get('rangeKind') != 'method':
                # Class/field/object hops are legitimate. Only flag a function locator
                # when the parser actually knows a method with that exact name.
                names = {s.get('name') for index in f.get('indexes', {}).values() for s in index.get('symbols', []) if s.get('kind') == 'method'}
                funcs = {a.get('func') for a in annotations}
                missed = names & funcs
                if missed and n.get('rangeKind') != 'field':
                    issues.append({'node': node_id, 'file': f.get('path'), 'message': '方法定位落到上下文：' + ', '.join(sorted(missed))})
                continue
            if not n.get('located'):
                issues.append({'node': node_id, 'message': '方法没有可靠定位'})
            side = 'old' if n.get('side') == 'old' or n.get('changeStatus') == 'deleted' else 'new'
            if not n.get(side + 'Range'):
                issues.append({'node': node_id, 'message': '指定侧缺完整方法范围'})
            required = ['role', 'process']
            if n.get('changeStatus') in ('added', 'modified', 'deleted'):
                required += ['behavior', 'why']
                if not any(isinstance(a.get('branches'), list) for a in annotations):
                    issues.append({'node': node_id, 'message': '变化方法缺 branches 数组'})
            missing = [key for key in required if not any(isinstance(a.get(key), str) and a[key].strip() for a in annotations)]
            if missing:
                issues.append({'node': node_id, 'message': '方法说明缺字段：' + ', '.join(missing)})
            bounds = n.get(side + 'Range') or [0, 0]
            if bounds[1] - bounds[0] >= 20 and any(a.get('role') and a.get('process', '').strip() == a['role'].strip() for a in annotations):
                warnings.append({'node': node_id, 'message': '较长方法的 process 仅重复 role，请核对是否缺少执行步骤与循环分支'})
    return {'flows': flows, 'issues': issues, 'warnings': warnings, 'note': '只检查结构性缺口，不认证语义调用、业务结论、Git覆盖率或测试结果'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest')
    parser.add_argument('--strict', action='store_true', help='存在确定的结构缺口时以非零退出；警告仍需人工核对')
    args = parser.parse_args()
    with Path(args.manifest).open(encoding='utf-8-sig') as stream:
        result = inspect(json.load(stream))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if args.strict and result['issues'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
