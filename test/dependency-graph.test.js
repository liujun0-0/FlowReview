import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePom,buildDependencyGraph} from '../lib/review/dependency-graph.js';
const pom=v=>`<project><groupId>g</groupId><artifactId>client</artifactId><version>${v}</version></project>`;
test('POM inheritance and properties distinguish real dependencies from managed versions',()=>{
 const source='<project><parent><groupId>g</groupId><artifactId>parent</artifactId><version>2</version></parent><artifactId>api</artifactId><properties><client.version>3</client.version></properties><dependencyManagement><dependencies><dependency><groupId>g</groupId><artifactId>client</artifactId><version>${client.version}</version></dependency></dependencies></dependencyManagement><profiles><profile><dependencies><dependency><artifactId>ignored</artifactId></dependency></dependencies></profile></profiles></project>';
 const p=parsePom(source);assert.equal(p.group,'g');assert.equal(p.version,'2');assert.equal(p.dependencies.length,1);assert.equal(p.dependencies[0].version,'3');assert.equal(p.dependencies[0].kind,'management');
 const graph=buildDependencyGraph([{id:'a',old:source.replace('>3<','>1<'),new:source},{id:'c',old:pom('1'),new:pom('3')}]);
 assert.equal(graph.edges.length,1);assert.equal(graph.edges[0].source,'a');assert.equal(graph.edges[0].target,'c');assert.equal(graph.edges[0].kind,'management');assert.equal(graph.edges[0].before,'1');assert.equal(graph.edges[0].after,'3');
});
test('a version property alone cannot imply a dependency; comments and ambiguous coordinates do not add edges',()=>{
 const source='<project><artifactId>api</artifactId><properties><client.version>3</client.version></properties><!-- <dependencies><dependency><groupId>g</groupId><artifactId>client</artifactId></dependency></dependencies> --></project>';
 assert.equal(buildDependencyGraph([{id:'a',old:source,new:source},{id:'c',old:pom('1'),new:pom('3')}]).edges.length,0);
 assert.equal(parsePom(source).properties['client.version'],'3');
 assert.throws(()=>parsePom('not xml'),/POM/);
});
