"""Business-flow checks use only local manifest metadata, never source contents."""
import copy
import unittest
import check_sequence


def fixture():
    def step(name, node):
        return dict(id=name, title=name, project='api', layer='Service', purpose='处理请求', input='请求',
                    output='结果', process='读取 → 返回', implementationIds=[node])
    nodes = {key: dict(rangeKind='class', fileId='file', annotations=[]) for key in ['a', 'b']}
    journey = dict(source=dict(actor='用户', entry='POST /read', input='id', purpose='读取记录', outcome='返回记录'),
                   steps=[step('entry', 'a'), step('result', 'b')],
                   links=[dict(**{'from': 'entry', 'to': 'result'}, confidence='确定', evidence='Api.java:3')])
    return dict(nodes=nodes, files={}, flows=[dict(id='feature', chains=[dict(nodeIds=['a', 'b'])], journey=journey)])


class BusinessFlowTests(unittest.TestCase):
    def test_complete_business_metadata_passes(self):
        result = check_sequence.inspect(fixture(), True)
        self.assertEqual(result['issues'], [])
        self.assertEqual(result['warnings'], [])
        self.assertEqual(result['flows'][0]['businessSteps'], 2)
        self.assertEqual(result['flows'][0]['businessLinks'], 1)

    def test_legacy_conversion_warns_but_new_report_requires_journey(self):
        data = fixture()
        del data['flows'][0]['journey']
        self.assertEqual(check_sequence.inspect(data)['issues'], [])
        self.assertTrue(check_sequence.inspect(data)['warnings'])
        self.assertTrue(check_sequence.inspect(data, True)['issues'])

    def test_method_links_do_not_hide_missing_business_links(self):
        data = fixture()
        flow = data['flows'][0]
        flow['journey']['links'] = []
        flow['chains'][0]['links'] = [dict(**{'from':'a', 'to':'b'}, evidence='Api.java:3')]
        self.assertTrue(any('journey.links' in w['message'] for w in check_sequence.inspect(data, True)['warnings']))

    def test_missing_source_or_step_description_is_a_new_report_gap(self):
        for field in ['entry', 'outcome']:
            data = fixture()
            data['flows'][0]['journey']['source'][field] = ''
            self.assertTrue(check_sequence.inspect(data, True)['issues'])
        data = fixture()
        data['flows'][0]['journey']['steps'][0]['process'] = ''
        self.assertTrue(check_sequence.inspect(data, True)['issues'])

    def test_broken_edges_duplicate_steps_and_foreign_implementation_are_rejected(self):
        original = fixture()
        for case in ['edge', 'duplicate', 'foreign']:
            data = copy.deepcopy(original)
            journey = data['flows'][0]['journey']
            if case == 'edge':
                journey['links'][0]['to'] = 'missing'
            elif case == 'duplicate':
                journey['steps'][1]['id'] = 'entry'
            else:
                data['nodes']['other'] = dict(rangeKind='class')
                journey['steps'][0]['implementationIds'] = ['other']
            self.assertTrue(check_sequence.inspect(data, True)['issues'], case)

    def test_evidence_and_disconnected_paths_remain_warnings_not_fabricated_edges(self):
        data = fixture()
        data['flows'][0]['journey']['links'][0]['evidence'] = ''
        result = check_sequence.inspect(data, True)
        self.assertEqual(result['issues'], [])
        self.assertTrue(result['warnings'])
        self.assertEqual(data['flows'][0]['journey']['links'][0]['evidence'], '')


class MultiEntryTests(unittest.TestCase):
    def test_entry_must_reference_local_method(self):
        data = fixture()
        entry = dict(id='read', title='读取', entry='GET /read', implementationId='a', actor='用户', input='id', purpose='读取', outcome='数据', evidence='Api.java:1', exampleGaps=dict(request='测试未采集', response='测试未采集'))
        data['flows'][0]['journey']['entries'] = [entry]
        data['nodes']['a']['rangeKind'] = 'method'
        self.assertFalse(check_sequence.inspect_business(data['flows'][0], data['nodes'], True)[0])
        entry['implementationId'] = 'foreign'
        self.assertTrue(check_sequence.inspect_business(data['flows'][0], data['nodes'], True)[0])

    def test_combined_url_text_cannot_replace_multiple_entry_metadata(self):
        data = fixture()
        data['flows'][0]['journey']['source']['entry'] = '/sample/page|filters'
        self.assertTrue(check_sequence.inspect_business(data['flows'][0], data['nodes'], True)[0])

    def test_examples_require_evidence_or_explicit_gap(self):
        data = fixture()
        data['nodes']['a']['endpoint'] = dict(method='GET', path='/read')
        flow = data['flows'][0]
        self.assertTrue(check_sequence.inspect_business(flow, data['nodes'], True)[0])
        flow['journey']['source']['exampleGaps'] = dict(request='契约缺失', response='响应包装未采集')
        self.assertFalse(check_sequence.inspect_business(flow, data['nodes'], True)[0])

    def test_multi_endpoint_new_reports_require_entries(self):
        data = fixture()
        for node in data['nodes'].values():
            node['endpoint'] = dict(method='GET', path='/sample')
        self.assertTrue(check_sequence.inspect_business(data['flows'][0], data['nodes'], True)[0])
        self.assertFalse(check_sequence.inspect_business(data['flows'][0], data['nodes'], False)[0])


if __name__ == '__main__':
    unittest.main()
