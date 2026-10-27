"""Read-only checks for business-flow and method data gaps in a reader snapshot."""
import argparse
import json
from pathlib import Path


def inspect_business(flow, nodes, required=False):
    issues, warnings = [], []
    flow_id = flow.get('id')
    def report(message, fatal=False, **detail):
        (issues if fatal else warnings).append({'flow': flow_id, 'message': message, **detail})
    journey = flow.get('journey')
    if not isinstance(journey, dict):
        report('缺少 journey，不能展示完整入口、项目业务步骤与结果', required)
        return issues, warnings
    source = journey.get('source', {})
    missing = [key for key in ('actor', 'entry', 'input', 'purpose', 'outcome')
               if not isinstance(source.get(key), str) or not source[key].strip()]
    if missing:
        report('业务入口/结果说明缺字段：' + ', '.join(missing), required)
    steps, links = journey.get('steps', []), journey.get('links', [])
    if not isinstance(steps, list) or not steps:
        report('没有业务步骤，不能以方法清单替代完整业务链路', required)
        return issues, warnings
    if not all(isinstance(step, dict) and isinstance(step.get('id'), str) and step['id'] for step in steps):
        report('业务步骤缺有效 id', True)
        return issues, warnings
    step_ids = {step['id'] for step in steps}
    if len(step_ids) != len(steps):
        report('业务步骤 id 重复', True)
    local_ids = {node for chain in flow.get('chains', []) for node in chain.get('nodeIds', [])}
    entries = journey.get('entries', [])
    if not isinstance(entries, list):
        report('journey.entries 必须为数组', True)
        entries = []
    entry_ids = set()
    for entry in entries:
        if not isinstance(entry, dict):
            report('接口入口必须为对象', True)
            continue
        identity = entry.get('id')
        if not isinstance(identity, str) or not identity.strip() or identity in entry_ids:
            report('接口入口 id 缺失或重复', True)
        else:
            entry_ids.add(identity)
        missing = [key for key in ('title', 'entry', 'actor', 'input', 'purpose', 'outcome', 'evidence')
                   if not isinstance(entry.get(key), str) or not entry[key].strip()]
        if missing:
            report('接口入口缺说明：' + ', '.join(missing), required, entry=identity)
        ref = entry.get('implementationId')
        if not isinstance(ref, str) or ref not in local_ids or ref not in nodes or nodes[ref].get('rangeKind') != 'method':
            report('接口入口必须引用本功能已定位的方法节点', True, entry=identity)
    endpoint_ids = {ref for ref in local_ids if nodes.get(ref, {}).get('endpoint')}
    if required and len(endpoint_ids) > 1 and not entries:
        report('多个接口需要 journey.entries 分别说明入口、参数、用途和结果', True)
    for step in steps:
        fields = [key for key in ('title', 'project', 'layer', 'purpose', 'input', 'output', 'process')
                  if not isinstance(step.get(key), str) or not step[key].strip()]
        if fields:
            report('业务步骤缺说明：' + ', '.join(fields), required, step=step['id'])
        refs = step.get('implementationIds', [])
        if not isinstance(refs, list) or any(not isinstance(ref, str) or ref not in local_ids or ref not in nodes for ref in refs):
            report('业务步骤引用不属于本功能或不存在的实现节点', True, step=step['id'])
        elif not refs:
            report('业务步骤未关联已采集实现；外部边界须说明范围', step=step['id'])
    if not isinstance(links, list):
        report('journey.links 必须为数组', True)
        return issues, warnings
    connected = set()
    for index, link in enumerate(links):
        if not isinstance(link, dict) or link.get('from') not in step_ids or link.get('to') not in step_ids:
            report('业务连线引用未知步骤', True, link=index)
            continue
        connected.update((link['from'], link['to']))
        if link.get('confidence') == '确定' and not str(link.get('evidence') or '').strip():
            report('业务连线标为确定但没有证据，不能认定实际流转', link=index)
    if len(steps) > 1 and not links:
        report('多个业务步骤却没有 journey.links；方法调用边不能替代业务连线，未核实或独立路径需说明')
    elif links and step_ids - connected:
        report('存在未连接的业务步骤；请核对独立路径或采集边界', steps=sorted(step_ids - connected))
    return issues, warnings


def inspect(manifest, require_business_flow=False):
    nodes, files = manifest.get('nodes', {}), manifest.get('files', {})
    issues, warnings, flows = [], [], []
    checked = set()
    for flow in manifest.get('flows', []):
        business_issues, business_warnings = inspect_business(flow, nodes, require_business_flow)
        issues.extend(business_issues)
        warnings.extend(business_warnings)
        ids = list(dict.fromkeys(i for c in flow.get('chains', []) for i in c.get('nodeIds', [])))
        methods = [i for i in ids if nodes.get(i, {}).get('rangeKind') == 'method']
        links = [e for c in flow.get('chains', []) for e in c.get('links', [])]
        flows.append({'id': flow.get('id'), 'methods': len(methods), 'businessSteps': len((flow.get('journey') or {}).get('steps', [])), 'businessLinks': len((flow.get('journey') or {}).get('links', [])), 'methodLinks': sum(e.get('from') in methods and e.get('to') in methods for e in links)})
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
    parser.add_argument('--require-business-flow', action='store_true', help='新报告要求完整的业务入口/结果和步骤说明；旧报告转换可不启用')
    parser.add_argument('--strict', action='store_true', help='存在确定的结构缺口时以非零退出；警告仍需人工核对')
    args = parser.parse_args()
    with Path(args.manifest).open(encoding='utf-8-sig') as stream:
        result = inspect(json.load(stream), args.require_business_flow)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 1 if args.strict and result['issues'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
