#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 AI 产出的变更评审 JSON 渲染成一个自包含的交互式 HTML。

用法:
    python render.py review.json -o review.html            # 渲染（自动从 git 取真实代码）
    python render.py review.json -o out.html --open        # 渲染完自动打开
    python render.py review.json --repo D:\\workspace --range main..HEAD
    python render.py review.json --summary                 # 输出轻量 markdown 摘要，不生成 HTML
    python render.py review.json --validate                # 只做结构校验
    python render.py --demo -o demo.html                   # 生成示例页（离线，不调 git）

设计要点:
  - 代码块默认**从 git 原地取**（ground truth），JSON 只需给「文件 + 行号」引用。
  - 每处改动带**精力档位**（略读 / 细看）与**关注维度**（算法/状态流转/并发/事务/错误处理/边界），
    便于按「需细看」优先分配精力。
  - 支持**项目维度**：hop/orphan 带 project，跨项目时可按项目分组浏览。
  - 改动量大时，凭 verifyPlan 引导用户从「读代码」转向「行为验证」（表征/性质/影子运行等）。
  - 嵌入 <script> 的数据做了 </ 转义，杜绝 </script> 注入；读取兼容 UTF-8 BOM。
"""

import argparse
import json
import html
import sys
import webbrowser
import os
import re
import subprocess
from git_source import enrich, select_hunks

# ---------------------------------------------------------------- 常量

ENUM_TYPES = {"新增", "删除", "改签名", "改实现", "传播变更", "契约变更", "穿越未改"}
ENUM_STATUS = {"完整", "部分", "缺失"}
ENUM_TIER = {"略读", "细看"}
ENUM_FOCUS = {"算法", "状态流转", "并发", "事务", "错误处理", "边界"}
ENUM_STRAT = {"表征测试", "性质测试", "影子运行", "差分测试", "契约测试", "契约/接口测试"}
# 改动价值评估（评估「该不该改 / 改得对不对」）
ENUM_VERDICT = {"必要改动", "优化型改动", "非必要改动", "疑似误改", "待确认"}
ENUM_NECESSITY = {"必要", "可选", "非必要"}
ENUM_MATCH = {"匹配", "部分匹配", "不匹配", "看不出"}
ENUM_REASONABLE = {"合理", "勉强合理", "不合理"}
SUSPECT_VERDICTS = {"非必要改动", "疑似误改", "待确认"}

# 大改动阈值：按 meta.stat 里的增删行数 / 文件数判断
BIG_LINES = 400
BIG_FILES = 15

HUNK_RE = re.compile(r"^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@")
LOC_RE = re.compile(r"^(.*?):(\d+)\s*$")

# ---------------------------------------------------------------- 样式

CSS = """
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#f6f8fa; --panel:#fff; --border:#d8dee4; --text:#1f2328;
  --muted:#656d76; --add:#e6ffec; --add-b:#abf2bc; --del:#ffebe9; --del-b:#ffcecb;
  --nav:#1e2430; --nav2:#252c3a; --accent:#0969da; --warn:#bf8700; --danger:#cf222e;
  --ok:#1a7f37;
}
body{font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  background:var(--bg);color:var(--text);height:100vh;display:flex;flex-direction:column;overflow:hidden}

/* ── 顶栏 ── */
header{background:var(--nav);color:#fff;padding:12px 20px;display:flex;align-items:center;gap:20px;flex-shrink:0}
header h1{font-size:16px;font-weight:600}
header .meta{font-size:12px;color:#9aa4b2}
header .meta .big{color:#ffb454;font-weight:600}
.chips{display:flex;gap:8px;margin-left:auto;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.chip{background:var(--nav2);border:1px solid #39414f;border-radius:20px;padding:4px 12px;
  font-size:12px;cursor:pointer;transition:.15s;white-space:nowrap}
.chip:hover{background:#2f3746}
.chip.on{background:var(--accent);border-color:var(--accent);color:#fff}
.chip.bad{border-color:#6e2b2b;background:#3a2020}
.chip.bad:hover{background:#4a2828}
.chip.deep{border-color:#6e2b2b;background:#3a2020}
.chip.deep:hover{background:#4a2828}
.chip.deep.on{background:var(--danger);border-color:var(--danger)}

/* ── 主体三栏 ── */
main{flex:1;display:flex;min-height:0}

/* 左：树 */
nav{width:290px;flex-shrink:0;background:var(--panel);border-right:1px solid var(--border);
  overflow-y:auto;padding:10px 0}
nav .grp{font-size:11px;color:var(--muted);padding:12px 16px 6px;letter-spacing:.5px;font-weight:600}
.node{padding:7px 16px 7px 14px;cursor:pointer;border-left:3px solid transparent;font-size:13px;
  display:flex;align-items:center;gap:7px}
.node:hover{background:var(--bg)}
.node.on{background:#ddf4ff;border-left-color:var(--accent);font-weight:600}
.node .dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.node .fn{color:var(--muted);font-size:11px;font-family:ui-monospace,monospace;margin-left:auto;
  overflow:hidden;text-overflow:ellipsis;max-width:110px}
.node .tw{transition:.15s;font-size:10px;color:var(--muted);width:10px}
.sub{display:none}
.sub.open{display:block}
.sub .node{padding-left:28px;font-size:12.5px}
.sub .sub .node{padding-left:44px;font-size:12px}

/* 中：代码 */
section#code{flex:1;overflow-y:auto;padding:18px 22px;min-width:0}
.hop{background:var(--panel);border:1px solid var(--border);border-radius:8px;
  margin-bottom:16px;overflow:hidden;scroll-margin:16px}
.hop.on{border-color:var(--accent);box-shadow:0 0 0 3px rgba(9,105,218,.12)}
.hd{padding:10px 14px;border-bottom:1px solid var(--border);display:flex;align-items:center;
  gap:9px;cursor:pointer;background:#fbfcfd;flex-wrap:wrap}
.hd:hover{background:#f3f5f7}
.hd .loc{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--accent)}
.hd .fname{font-family:ui-monospace,monospace;font-weight:600}
.badge{font-size:11px;padding:2px 8px;border-radius:11px;font-weight:600;white-space:nowrap}
.b-new{background:#dafbe1;color:var(--ok)}
.b-del{background:#ffe3e0;color:var(--danger)}
.b-sig{background:#fff1c9;color:#8a6100}
.b-impl{background:#ffd8d0;color:#a1211a;border:1px solid #f5b3aa}
.b-spread{background:#eaeef2;color:var(--muted)}
.b-pass{background:#f0f0f0;color:#888}
.b-contract{background:#e6d9ff;color:#5b3ba8}
.badge.t-skim{background:#eef1f4;color:#5c6670}
.badge.t-deep{background:#ffe0e0;color:#a1211a;border:1px solid #f3b0b0}
.badge.v-ok{background:#dafbe1;color:var(--ok)}
.badge.v-opt{background:#e7f0fb;color:var(--accent)}
.badge.v-warn{background:#fff1c9;color:#8a6100}
.badge.v-bad{background:#ffe3e0;color:var(--danger);border:1px solid #f5b3aa}
.fchip{font-size:10px;padding:1px 6px;border-radius:8px;background:#eef4ff;color:#3b6ea5;border:1px solid #cfe0f5}
.pchip{font-size:10px;padding:1px 6px;border-radius:8px;background:#eef7ee;color:#2f7d32;border:1px solid #cfe6cf}
.schip{font-size:10px;padding:1px 6px;border-radius:8px;background:#f3ecff;color:#5b3ba8;border:1px solid #ddd0f5}
.conf{font-size:10px;padding:1px 6px;border-radius:8px;background:#eee;color:#777}
.conf.guess{background:#fff4d6;color:#8a6100}
.why-mini{color:var(--muted);font-size:12px;font-style:italic;margin-left:2px}

pre{overflow-x:auto;font:12.5px/1.75 ui-monospace,SFMono-Regular,Menlo,monospace;background:#fff}
.ln{display:flex;white-space:pre}
.ln:hover{background:#fffdf5}
.ln .n{width:52px;flex-shrink:0;text-align:right;padding-right:10px;color:#9198a1;
  user-select:none;background:#fafbfc;border-right:1px solid #eef0f2}
.ln .m{width:16px;flex-shrink:0;text-align:center;color:#9198a1;user-select:none}
.ln .c{padding:0 12px;flex:1}
.ln.add{background:var(--add)}
.ln.add .m{color:#127a2e;background:var(--add-b)}
.ln.del{background:var(--del)}
.ln.del .m{color:#a1211a;background:var(--del-b)}
.hd-ctx{background:#fafbfc;color:#8c959f;font-size:11px;padding:4px 14px;border-bottom:1px solid #eef0f2}

/* 右：说明 */
aside{width:360px;flex-shrink:0;background:var(--panel);border-left:1px solid var(--border);
  overflow-y:auto;padding:18px}
aside h3{font-size:15px;margin-bottom:4px;line-height:1.4}
aside .path{font:11.5px ui-monospace,monospace;color:var(--muted);margin-bottom:14px;word-break:break-all}
.fld{margin-bottom:14px;padding-bottom:14px;border-bottom:1px dashed #eaeef2}
.fld:last-child{border:0}
.fld .lb{font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.6px;margin-bottom:5px;
  display:flex;align-items:center;gap:6px}
.fld .lb .ic{width:15px;height:15px;border-radius:4px;display:grid;place-items:center;
  font-size:10px;color:#fff;background:var(--accent)}
.fld .lb.w{color:#a1211a}.fld .lb.w .ic{background:#a1211a}
.fld .lb.y{color:#8a6100}.fld .lb.y .ic{background:var(--warn)}
.fld .lb.g{color:var(--ok)}.fld .lb.g .ic{background:var(--ok)}
.fld .tx{font-size:13px;line-height:1.68;color:#31363c}
.fld code{background:#f0f2f4;padding:1px 5px;border-radius:4px;font-size:12px;
  font-family:ui-monospace,monospace}
pre.cmd{background:#1e2430;color:#e6edf3;padding:11px 13px;border-radius:7px;overflow-x:auto;
  font:12px ui-monospace,monospace;margin-top:6px}
.empty{color:var(--muted);text-align:center;padding:60px 20px;font-size:13px}

/* 右侧：AI 互动按钮 */
.acts{display:flex;gap:7px;margin-top:16px;padding-top:14px;border-top:1px solid var(--border)}
.act{flex:1;padding:8px 6px;border:1px solid var(--border);border-radius:7px;background:#fff;
  cursor:pointer;font-size:12px;text-align:center;transition:.15s;line-height:1.35}
.act:hover{background:#ddf4ff;border-color:var(--accent);color:var(--accent)}
.act b{display:block;font-size:13px}
.act span{font-size:10.5px;color:var(--muted)}
.act:hover span{color:var(--accent)}

/* 弹窗 */
.mask{position:fixed;inset:0;background:rgba(15,20,28,.5);display:none;place-items:center;z-index:99}
.mask.open{display:grid}
.modal{background:#fff;border-radius:11px;width:min(780px,93vw);max-height:88vh;
  display:flex;flex-direction:column;box-shadow:0 16px 48px rgba(0,0,0,.32)}
.modal .mh{padding:13px 18px;border-bottom:1px solid var(--border);display:flex;
  align-items:center;gap:10px;font-weight:600;font-size:14px}
.modal .mh .x{margin-left:auto;cursor:pointer;color:var(--muted);font-size:19px;line-height:1}
.modal .mh .x:hover{color:var(--danger)}
.modal .mb{padding:14px 18px;overflow-y:auto;flex:1}
.modal .mf{padding:12px 18px;border-top:1px solid var(--border);display:flex;
  gap:10px;align-items:center;flex-wrap:wrap}
textarea{width:100%;min-height:320px;font:12px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace;
  border:1px solid var(--border);border-radius:7px;padding:12px;resize:vertical;color:#1f2328}
textarea:focus{outline:none;border-color:var(--accent)}
.btn{padding:7px 16px;border-radius:7px;border:1px solid var(--border);background:#fff;
  cursor:pointer;font-size:13px}
.btn:hover{background:#f3f5f7}
.btn.pri{background:var(--accent);color:#fff;border-color:var(--accent)}
.btn.pri:hover{filter:brightness(1.08)}
.btn.ok{background:var(--ok);color:#fff;border-color:var(--ok)}
select{padding:6px 10px;border-radius:7px;border:1px solid var(--border);font-size:12.5px;background:#fff}
.tip{font-size:11.5px;color:var(--muted);line-height:1.5}
.fmtline{opacity:.35}

/* 底部清单 */
.lists{background:var(--panel);border-top:1px solid var(--border);max-height:0;overflow:hidden;
  transition:.25s;flex-shrink:0}
.lists.open{max-height:48vh;overflow-y:auto}
.lists .in{padding:16px 22px;display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}
.lists h4{font-size:13px;margin-bottom:9px;color:var(--text)}
.lists h4 .n{color:var(--muted);font-weight:400}
.lists table{width:100%;border-collapse:collapse;font-size:12.5px}
.lists td,.lists th{border:1px solid var(--border);padding:6px 9px;text-align:left;vertical-align:top}
.lists th{background:#f6f8fa;font-weight:600}
.tr{color:var(--muted);font-size:12px}
.hint{background:#fff8e6;border:1px solid #f0dca0;border-radius:7px;padding:9px 11px;font-size:12px;color:#7a5b00;line-height:1.6}
"""

JS = r"""
var D = window.__DATA__;
var cur = null;
var state = { filter:'all', groupBy:'flow', hideFmt:false };

function esc(s){return (s==null?'':String(s)).replace(/[&<>'"]/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c];});}

function riskColor(r){
  if(!r) return '#c9d1d9';
  if(r.indexOf('高')===0) return '#cf222e';
  if(r.indexOf('中')===0) return '#bf8700';
  if(r.indexOf('低')===0) return '#1a7f37';
  return '#8c959f';
}
var BADGE = {'新增':'b-new','删除':'b-del','改签名':'b-sig','改实现':'b-impl',
             '传播变更':'b-spread','穿越未改':'b-pass','契约变更':'b-contract'};
var TIER = {'略读':'t-skim','细看':'t-deep'};
var VERDICT = {'必要改动':'v-ok','优化型改动':'v-opt','非必要改动':'v-warn','疑似误改':'v-bad'};

/* ---------- 纯格式变更识别 ---------- */
function markAllFmt(){
  fmtCount = 0;
  function norm(l){ return (l.c||'').replace(/\s+/g,''); }
  function flag(l){ if(l && !l.fmt){ l.fmt=1; fmtCount++; } }
  function mark(code){
    if(!code||!code.length) return;
    var i;
    for(i=0;i<code.length-1;i++){
      var a=code[i], b=code[i+1];
      if((a.t==='-'&&b.t==='+')||(a.t==='+'&&b.t==='-')){
        var na=norm(a);
        if(na && na===norm(b)){ flag(a); flag(b); }
      }
    }
    i=0;
    while(i<code.length){
      if(code[i].t!=='-'){ i++; continue; }
      var j=i, neg=[], pos=[];
      while(j<code.length && code[j].t==='-'){ neg.push(code[j]); j++; }
      var k0=j;
      while(k0<code.length && code[k0].t==='+'){ pos.push(code[k0]); k0++; }
      if(neg.length && pos.length && neg.map(norm).join('\n')===pos.map(norm).join('\n')){
        neg.concat(pos).forEach(flag);
      }
      i = neg.length ? k0 : i+1;
    }
  }
  (D.flowPoints||[]).forEach(function(fp){
    (fp.chains||[]).forEach(function(ch){
      (ch.hops||[]).forEach(function(h){ mark(h.code); });
    });
  });
  (D.orphans||[]).forEach(function(o){ mark(o.code); });
}
var fmtCount = 0;

/* ---------- 通用筛选 ---------- */
function isSuspect(h){ return h.verdict==='非必要改动' || h.verdict==='疑似误改' || h.verdict==='待确认'; }
function passHop(h){
  if(state.filter==='impl' && h.type!=='改实现') return false;
  if(state.filter==='deep' && h.tier==='略读' && h.verdict!=='待确认') return false;
  if(state.filter==='suspect' && !isSuspect(h)) return false;
  return true;
}
function passOrphan(o){
  if(state.filter==='impl') return false;
  if(state.filter==='deep' && o.tier==='略读') return false;
  return true;   /* 孤儿变更本身即「不在需求里」，suspect 过滤下保留 */
}
function allHops(){
  var r=[];
  (D.flowPoints||[]).forEach(function(fp){(fp.chains||[]).forEach(function(ch){(ch.hops||[]).forEach(function(h){ r.push({h:h,fp:fp,ch:ch}); });});});
  return r;
}
function projects(){
  var set={};
  allHops().forEach(function(x){ if(x.h.project) set[x.h.project]=1; });
  (D.orphans||[]).forEach(function(o){ if(o.project) set[o.project]=1; });
  return Object.keys(set);
}

/* ---------- 左侧树 ---------- */
function nodeHop(h){
  return '<div class="node" data-hop="'+esc(h.id)+'">'+
    '<span class="tw"></span>'+
    '<span class="dot" style="background:'+riskColor(h.risk)+'"></span>'+
    '<span>'+esc(h.func||h.file)+'</span>'+
    '<span class="fn">'+esc(h.type)+'</span></div>';
}
function chainNode(title, fnLabel, hops){
  return '<div class="node" data-tg="c">'+'<span class="tw">▾</span>'+
         '<span class="dot" style="background:#0969da"></span>'+
         '<span>'+esc(title)+'</span>'+
         (fnLabel?'<span class="fn">'+esc(fnLabel)+'</span>':'')+'</div>'+
         '<div class="sub open">'+hops+'</div>';
}
function buildFlowTree(){
  var s = '<div class="grp">功能点 / 调用链 / 逐跳</div>';
  (D.flowPoints||[]).forEach(function(fp){
    var badge = fp.status==='完整' ? '<span class="badge b-new">✓</span>'
              : fp.status==='部分' ? '<span class="badge b-sig">◐</span>'
              : '<span class="badge b-del">✗</span>';
    var chains = (fp.chains||[]).map(function(c){
      var hops = (c.hops||[]).filter(passHop).map(nodeHop).join('');
      if(!hops) return '';
      return chainNode(c.name, '', hops);
    }).join('');
    if(!chains && state.filter!=='all') return;
    s += '<div class="node" data-tg="f">'+'<span class="tw">▾</span>'+badge+
         '<span>'+esc(fp.title)+'</span></div><div class="sub open">'+chains+'</div>';
  });
  return s;
}
function orphanNode(o, i){
  return '<div class="node" data-hop="orphan-'+i+'">'+
    '<span class="dot" style="background:#bf8700"></span>'+
    '<span>⚠ '+esc(o.location||o.file)+'</span></div>';
}
function buildProjectTree(){
  var ps = projects(), s = '<div class="grp">项目 / 调用链 / 逐跳</div>';
  ps.forEach(function(p){
    var inner='';
    (D.flowPoints||[]).forEach(function(fp){
      (fp.chains||[]).forEach(function(ch){
        var hops=(ch.hops||[]).filter(function(h){return h.project===p && passHop(h);}).map(nodeHop).join('');
        if(!hops) return;
        inner += chainNode(ch.name, fp.title, hops);
      });
    });
    (D.orphans||[]).forEach(function(o,i){
      if(o.project===p && passOrphan(o)) inner += orphanNode(o,i);
    });
    if(inner) s += '<div class="node" data-tg="p">'+'<span class="tw">▾</span>'+
      '<span class="pchip">'+esc(p)+'</span></div><div class="sub open">'+inner+'</div>';
  });
  return s || '<div class="empty" style="padding:30px">没有标注 project 的改动</div>';
}
function buildTree(){
  var n = document.getElementById('tree');
  var projectView = (state.groupBy==='project' && projects().length>1);
  var s = projectView ? buildProjectTree() : buildFlowTree();
  var orph = '';
  (D.orphans||[]).forEach(function(o,i){
    if(!passOrphan(o)) return;
    if(projectView && o.project) return;   /* 已在对应项目下归类 */
    orph += orphanNode(o,i);
  });
  if(orph) s += '<div class="grp">孤儿变更</div>'+orph;
  n.innerHTML = s;
  n.querySelectorAll('[data-tg]').forEach(function(el){
    var sub = el.nextElementSibling;
    el.onclick = function(e){
      e.stopPropagation();
      sub.classList.toggle('open');
      el.querySelector('.tw').textContent = sub.classList.contains('open')?'▾':'▸';
    };
  });
  n.querySelectorAll('[data-hop]').forEach(function(el){
    el.onclick = function(e){ e.stopPropagation(); show(el.dataset.hop); };
  });
}

/* ---------- 中间代码 ---------- */
function codeLines(code, hideFmt){
  var vis = (code||[]).filter(function(l){ return !(hideFmt && l.fmt); });
  if(!vis.length) return null;
  var s = '<pre>';
  vis.forEach(function(l){
    var cls = l.t==='+'?'add':(l.t==='-'?'del':'');
    s += '<div class="ln '+cls+'"><span class="n">'+(l.n==null?'':l.n)+'</span>'+
         '<span class="m">'+(l.t==='+'?'+':(l.t==='-'?'−':' '))+'</span>'+
         '<span class="c">'+esc(l.c)+'</span></div>';
  });
  return s + '</pre>';
}
function hopHeader(h){
  var focus=(h.focus||[]).map(function(f){return '<span class="fchip">'+esc(f)+'</span>';}).join('');
  return '<div class="hd" data-go="'+esc(h.id)+'">'+
    '<span class="loc">'+esc(h.file)+':'+(h.line||'')+'</span>'+
    '<span class="fname">'+esc(h.func||'')+'</span>'+
    '<span class="badge '+(BADGE[h.type]||'b-spread')+'">'+esc(h.type)+'</span>'+
    (h.verdict?'<span class="badge '+(VERDICT[h.verdict]||'')+'">'+esc(h.verdict)+'</span>':'')+
    (h.tier?'<span class="badge '+(TIER[h.tier]||'t-skim')+'">'+esc(h.tier)+'</span>':'')+
    (h.risk?'<span class="badge" style="background:#fff;color:'+riskColor(h.risk)+
      ';border:1px solid '+riskColor(h.risk)+'">风险 '+esc(h.risk)+'</span>':'')+
    (h.project?'<span class="pchip">'+esc(h.project)+'</span>':'')+focus+
    (h.confidence!=='确定' || !h.evidence?'<span class="conf guess">推测</span>':'<span class="conf">已验证</span>')+
    (h.why?'<span class="why-mini">— '+esc(h.why.slice(0,36))+(h.why.length>36?'…':'')+'</span>':'')+
    '</div>';
}
function buildCode(){
  var c = document.getElementById('code');
  var s = '';
  (D.flowPoints||[]).forEach(function(fp){
    (fp.chains||[]).forEach(function(ch){
      var hops=(ch.hops||[]).filter(passHop);
      if(!hops.length) return;
      s += '<div class="hd-ctx">▸ '+esc(fp.title)+' ｜ '+esc(ch.name)+
           (ch.sideEffect?'　└ 终点副作用：'+esc(ch.sideEffect):'')+'</div>';
      hops.forEach(function(h){
        s += '<div class="hop" id="hop-'+esc(h.id)+'">'+hopHeader(h);
        var block = h.code && h.code.length ? codeLines(h.code, state.hideFmt) : null;
        if(h.codeStatus) s += '<div class="hint">'+esc(h.codeStatus)+'</div>';
        if(block) s += block;
        else if(h.code && h.code.length) s += '<div class="empty" style="padding:22px">全部为疑似纯格式变更（已隐藏）</div>';
        else s += '<div class="empty" style="padding:22px">未取得代码：不能据此判断本次未改动</div>';
        s += '</div>';
      });
    });
  });
  (D.orphans||[]).forEach(function(o,i){
    if(!passOrphan(o)) return;
    s += '<div class="hop" id="hop-orphan-'+i+'">'+
         '<div class="hd" data-go="orphan-'+i+'"><span class="loc">'+esc(o.location||o.file)+'</span>'+
         (o.tier?'<span class="badge '+(TIER[o.tier]||'t-skim')+'">'+esc(o.tier)+'</span>':'')+
         (o.project?'<span class="pchip">'+esc(o.project)+'</span>':'')+
         '<span class="badge b-impl">孤儿变更</span></div>';
    var block = o.code && o.code.length ? codeLines(o.code, state.hideFmt) : null;
    if(o.codeStatus) s += '<div class="hint">'+esc(o.codeStatus)+'</div>';
    if(block) s += block;
    else s += '<div class="empty">未取得代码，请核对定位</div>';
    s += '</div>';
  });
  if(!s) s = '<div class="empty">当前过滤条件下没有内容</div>';
  c.innerHTML = s;
  c.querySelectorAll('[data-go]').forEach(function(el){
    el.onclick = function(){ show(el.dataset.go); };
  });
}

/* ---------- 右侧说明 ---------- */
function findHop(id){
  for(var i=0;i<D.flowPoints.length;i++){
    var fp=D.flowPoints[i];
    for(var j=0;j<(fp.chains||[]).length;j++){
      var ch=fp.chains[j];
      for(var k=0;k<(ch.hops||[]).length;k++){
        if(ch.hops[k].id===id) return {hop:ch.hops[k],fp:fp,chain:ch};
      }
    }
  }
  return null;
}
function show(id){
  cur = id;
  document.querySelectorAll('.node.on').forEach(function(e){e.classList.remove('on');});
  var nd = document.querySelector('.node[data-hop="'+id.replace(/"/g,'')+'"]');
  if(nd){
    nd.classList.add('on');
    var p = nd.parentElement;
    while(p && p.id!=='tree'){ if(p.classList.contains('sub')) p.classList.add('open'); p=p.parentElement; }
  }
  document.querySelectorAll('.hop.on').forEach(function(e){e.classList.remove('on');});
  var el = document.getElementById('hop-'+id);
  if(el){ el.classList.add('on'); el.scrollIntoView({behavior:'smooth',block:'start'}); }

  var a = document.getElementById('aside');
  if(id.indexOf('orphan')===0){
    var o = D.orphans[+id.split('-')[1]];
    if(!o) return;
    a.innerHTML = '<h3>⚠ 孤儿变更</h3><div class="path">'+esc(o.location)+
      (o.project?'　['+esc(o.project)+']':'')+'</div>'+
      fld('w','!','它做了什么',o.what)+
      fld('y','?','为什么会出现',o.reason)+
      fld('g','→','建议',o.suggestion)+
      actsHtml(id, false);
    bindActs();
    return;
  }
  var r = findHop(id);
  if(!r) return;
  var h=r.hop, fp=r.fp, ch=r.chain;
  var s = '<h3>'+esc(h.func||h.file)+'</h3>'+
    '<div class="path">'+esc(fp.title)+' › '+esc(ch.name)+'<br>'+esc(h.file)+':'+(h.line||'')+'</div>'+
    '<div style="margin-bottom:14px">'+
      '<span class="badge '+(BADGE[h.type]||'b-spread')+'">'+esc(h.type)+'</span> '+
      (h.verdict?'<span class="badge '+(VERDICT[h.verdict]||'')+'">'+esc(h.verdict)+'</span> ':'')+
      (h.tier?'<span class="badge '+(TIER[h.tier]||'t-skim')+'">'+esc(h.tier)+'</span> ':'')+
      (h.risk?'<span class="badge" style="background:#fff;color:'+riskColor(h.risk)+
        ';border:1px solid '+riskColor(h.risk)+'">风险 '+esc(h.risk)+'</span> ':'')+
      (h.project?'<span class="pchip">'+esc(h.project)+'</span> ':'')+
      (h.confidence!=='确定' || !h.evidence?'<span class="conf guess">链路为推测</span>':
        '<span class="conf">链路已检索验证</span>')+
    '</div>'+
    fld('','◆','属于哪个功能点', '<b>'+esc(fp.title)+'</b>'+
        (fp.requirement?'<br><span class="tr">需求原文：'+esc(fp.requirement)+'</span>':''), false, true)+
    (h.role?fld('','☰','方法整体作用（它在这套系统里干什么）', h.role):'')+
    fld('g','?','为什么改（对应需求哪一条）', h.why)+
    fld('','Δ','改了什么 / 行为变化', h.behavior)+
    (evalText(h)?fld('y','⚖','改动评估（必要 / 合理 / 是否与表述匹配）', evalText(h), false, true):'')+
    (h.counterfactual?fld('w','↺','不改会怎样', h.counterfactual):'')+
    (h.focus&&h.focus.length?fld('y','⌖','关注维度（细看重点）', h.focus.join(' / ')):'')+
    (ch.sideEffect?fld('y','⚑','这条链的终点副作用', ch.sideEffect):'')+
    fld('w','!','可能的漏洞 / 风险', h.risk_detail)+
    fld('y','✓','验证计划（不代表已执行）', h.verify, true)+
    fld('y','✓','验证状态', (h.verifyStatus||'未执行')+(h.verifyResult?'\n'+h.verifyResult:'')+(h.verifyEvidence?'\n'+h.verifyEvidence:''))+
    (h.assessmentReason?fld('w','?','待确认原因',h.assessmentReason):'')+
    (h.evidence?fld('','↗','调用链证据',h.evidence):'')+
    (h.deeper?fld('','↳','继续深挖', h.deeper):'')+
    actsHtml(id, !!h.deeper);
  a.innerHTML = s;
  bindActs();
}
function evalText(h){
  var parts=[];
  if(h.necessity) parts.push('必要性：<b>'+esc(h.necessity)+'</b>');
  if(h.reasonableness) parts.push('合理性：<b>'+esc(h.reasonableness)+'</b>');
  if(h.match) parts.push('与需求/表述：<b>'+esc(h.match)+'</b>');
  if(h.verdict) parts.push('总体判定：<b>'+esc(h.verdict)+'</b>');
  return parts.join('　｜　');
}
function actsHtml(id, hasDig){
  return '<div class="acts">'+
    '<div class="act" data-ai="ask" data-id="'+esc(id)+'"><b>💬 追问</b><span>到底有没有问题</span></div>'+
    '<div class="act" data-ai="fix" data-id="'+esc(id)+'"><b>🔧 让 AI 修</b><span>只修复已确认问题所需的最小范围</span></div>'+
    (hasDig?'<div class="act" data-ai="dig" data-id="'+esc(id)+'"><b>↳ 深挖</b><span>往下追调用</span></div>':'')+
    '</div>';
}
var AI_TITLE = {ask:'追问这一处', fix:'修复这一处', dig:'向下深挖', batch:'批量追问所有存疑点'};
var AI_TIP = {
  ask:'自带完整上下文（需求原文＋整条调用链＋这段代码＋已记录疑点），可直接粘到任何 AI 对话框。',
  fix:'约束了「只修复已确认问题所需的最小范围、不顺手重构、不需要改就直说」，避免 AI 为了改而改。',
  dig:'让 AI 顺着这一跳往下追 2–3 层调用，并专门找「本次没改但依赖了被改动假设」的节点。',
  batch:'把全部孤儿变更、改实现清单、无法确认项打包成一次提问。'
};
function bindActs(){
  document.querySelectorAll('.act[data-ai]').forEach(function(el){
    el.onclick = function(){
      var m = el.dataset.ai, id = el.dataset.id;
      openModal(AI_TITLE[m], buildPrompt(m, id), AI_TIP[m]);
    };
  });
}
function fld(k,ic,lb,tx,cmd,rich){
  if(!tx) return '';
  return '<div class="fld"><div class="lb '+k+'"><span class="ic">'+ic+'</span>'+lb+'</div>'+
         (cmd?'<pre class="cmd">'+esc(tx)+'</pre>'
             :'<div class="tx">'+(rich?String(tx):esc(tx)).replace(/\\n|\n/g,'<br>')+'</div>')+'</div>';
}

/* ================= AI 互动：生成自包含上下文包 ================= */
var TOOLS = {
  paste:     function(t){ return t; },
  claude:    function(t){ return "claude <<'PROMPT_EOF'\n"+t+"\nPROMPT_EOF"; },
  codebuddy: function(t){ return "codebuddy -p <<'PROMPT_EOF'\n"+t+"\nPROMPT_EOF"; },
  aider:     function(t){ return "aider --message <<'PROMPT_EOF'\n"+t+"\nPROMPT_EOF"; }
};
function pad(n,w){ var s=String(n==null?'':n); while(s.length<w) s=' '+s; return s; }
function codeBlock(code){
  if(!code||!code.length) return '（本次无代码变更）';
  return '```\n' + code.map(function(l){
    return pad(l.n,5) + ' ' + (l.t==='+'?'+':(l.t==='-'?'-':' ')) + ' ' + l.c;
  }).join('\n') + '\n```';
}
function ctxHead(h, fp, ch){
  var s = '## 本次改动的背景\n\n';
  s += '- 需求 / 修改说明：' + (fp.requirement || (D.meta&&D.meta.title) || '（未提供）') + '\n';
  s += '- 所属功能点：' + fp.title + '\n';
  if(h.project) s += '- 所属项目：' + h.project + '\n';
  s += '- 代码来源：' + (h.codeStatus||'未提供 Git 证据') + '\n';
  s += '- 验证状态：' + (h.verifyStatus||'未执行') + '\n';
  (D.sourceSnapshots||[]).forEach(function(x){
    s += '- 版本证据：' + x.project + ' ' + x.base + ' → ' + (x.head||'工作区') + '，diff SHA256 ' + x.diffSha256 + '\n';
  });
  s += '- 调用链：' + ch.name + '\n';
  if(ch.sideEffect) s += '- 这条链的终点副作用：' + ch.sideEffect + '\n';
  s += '\n## 这条调用链上的每一跳\n\n';
  (ch.hops||[]).forEach(function(x){
    s += '- `' + (x.project?('['+x.project+'] '):'') + x.file + ':' + (x.line||'') + '` **' + x.func + '** ｜ ' + x.type +
         (x.tier ? ' ｜ 精力:' + x.tier : '') +
         (x.risk ? ' ｜ 风险' + x.risk : '') +
         (x.behavior ? ' ｜ ' + x.behavior : '') +
         (x.id===h.id ? '  ← **我正在看这一处**' : '') + '\n';
  });
  s += '\n## 我正在看的这一处\n\n';
  s += '- 位置：`' + h.file + ':' + (h.line||'') + '`\n';
  s += '- 函数：**' + (h.func||'') + '**\n';
  s += '- 变更类型：' + h.type + '\n';
  if(h.tier) s += '- 精力档位：' + h.tier + '\n';
  if(h.focus&&h.focus.length) s += '- 关注维度：' + h.focus.join('、') + '\n';
  if(h.risk)     s += '- 风险等级：' + h.risk + '\n';
  if(h.role)     s += '- 方法整体作用：' + h.role + '\n';
  if(h.why)      s += '- 记录的改动原因：' + h.why + '\n';
  if(h.behavior) s += '- 记录的行为变化：' + h.behavior + '\n';
  if(h.necessity) s += '- 必要性：' + h.necessity + '\n';
  if(h.reasonableness) s += '- 合理性：' + h.reasonableness + '\n';
  if(h.match)    s += '- 与需求/表述是否匹配：' + h.match + '\n';
  if(h.counterfactual) s += '- 不改会怎样：' + h.counterfactual + '\n';
  if(h.verdict)  s += '- 我的总体判定：' + h.verdict + '\n';
  s += '\n## 这段代码（+ 新增，- 删除，行号为改动后）\n\n' + codeBlock(h.code) + '\n';
  return s;
}
function buildPrompt(mode, id){
  if(mode==='batch'){
    var s = '我在 review 一次 AI 生成的改动，下面是我自己判断不了或有疑问的点，请逐条回答。\n\n';
    s += '## 背景\n\n- 改动：' + ((D.meta&&D.meta.title)||'') + '（' + ((D.meta&&D.meta.range)||'') + '）\n\n';
    if((D.orphans||[]).length){
      s += '## 一、孤儿变更（不在需求里的改动）\n\n';
      D.orphans.forEach(function(o,i){
        s += (i+1) + '. `' + o.location + '`\n   - 做了什么：' + (o.what||'') +
             '\n   - 我推测的原因：' + (o.reason||'') + '\n   - 我的建议：' + (o.suggestion||'') + '\n';
      });
      s += '\n';
    }
    if((D.implChanges||[]).length){
      s += '## 二、「改实现」清单（签名没变但逻辑变了）\n\n';
      D.implChanges.forEach(function(o,i){
        s += (i+1) + '. `' + o.location + '` — ' + (o.change||'') + ' ｜ 影响：' + (o.impact||'') + '\n';
      });
      s += '\n';
    }
    if((D.unknowns||[]).length){
      s += '## 三、我无法确认的\n\n';
      D.unknowns.forEach(function(o,i){
        s += (i+1) + '. ' + (o.what||'') + '（原因：' + (o.reason||'') + '）\n';
      });
      s += '\n';
    }
    if((D.verifyPlan||[]).length){
      s += '## 四、计划的行为验证\n\n';
      D.verifyPlan.forEach(function(v,i){
        s += (i+1) + '. [' + (v.strategy||'') + '] ' + (v.target||'') + '：' + (v.how||'') + '\n';
      });
      s += '\n';
    }
    s += '## 请对每一条给出\n\n' +
         '1. 是真问题还是我多虑了？给出依据\n' +
         '2. 如果是真问题：触发条件是什么，会怎么炸\n' +
         '3. 按三档分类：**必须现在处理 / 可以以后处理 / 其实没问题**\n\n' +
         '不要为了显得周全而编造问题。没问题就直说没问题。';
    return s;
  }
  if(id.indexOf('orphan')===0){
    var o = D.orphans[+id.split('-')[1]];
    if(!o) return '';
    var s2 = '我在 review 一次改动，发现一处「孤儿变更」——它不在本次需求里，请帮我判断该怎么处理。\n\n';
    s2 += '- 本次需求：' + ((D.meta&&D.meta.title)||'') + '\n';
    s2 += '- 位置：`' + o.location + '`\n';
    s2 += '- 它做了什么：' + (o.what||'') + '\n';
    s2 += '- 我推测的出现原因：' + (o.reason||'') + '\n';
    s2 += '- 我的初步建议：' + (o.suggestion||'') + '\n\n';
    s2 += '## 代码\n\n' + codeBlock(o.code) + '\n\n';
    s2 += '## 请回答\n\n' +
          '1. 它和本次需求到底有没有关系？\n' +
          '2. **如果我删掉它，会破坏什么？** 请列出所有引用点（不要猜，说清楚需要看哪些文件才能确认）\n' +
          '3. 给一句明确建议：保留 / 删除 / 单独提 PR\n';
    return s2;
  }
  var r = findHop(id); if(!r) return '';
  var h=r.hop, fp=r.fp, ch=r.chain, head = ctxHead(h, fp, ch);
  if(mode==='ask'){
    return '你是一位严格的资深工程师，帮我把关一处 AI 生成的代码改动。\n\n' + head +
      (h.risk_detail ? '\n## 我记录的疑点\n\n' + h.risk_detail + '\n' : '') +
      '\n## 请回答（具体，指到行号）\n\n' +
      '1. 这段改动是否完整覆盖了需求里对应的那一条？有没有漏掉的部分？\n' +
      '2. 我记录的疑点是否成立？成立的话，给出**触发条件**——什么输入、什么时序、什么状态下会出问题\n' +
      '3. 有哪些我没列出的风险？重点看：并发、事务边界、失败路径与回滚、幂等性、边界值（空/0/上限/超时）\n' +
      '4. 这处改动**有必要吗**？不改（或删掉）会发生什么——是回到旧的正确行为，还是会出 bug？请分「必须改 / 可改可不改 / 不该改」给结论\n' +
      '5. 代码实际改动，和它声称的目的（上面的「为什么改」/ 需求）**是否一致**？有没有夹带、顺手重构、言行不一？\n' +
      '6. 如果是你写，你会怎么改？给出具体代码\n\n' +
      '**不要为了显得周全而编造问题。** 某条没问题就直说没问题。如果你判断不了，明说"我需要看 XX 才能确认"。';
  }
  if(mode==='fix'){
    return '你是一位资深工程师，请修复下面这一处改动的问题。\n\n' + head +
      '\n## 问题\n\n' + (h.risk_detail || '（未记录已确认问题，请先核实；无问题则不修改）') + '\n' +
      '\n## 硬性要求\n\n' +
      '1. **只修复已确认问题所需的最小范围**，涉及上下游一致性时先说明必要文件与依据，不要顺手重构，不要改格式，不要加无关注释\n' +
      '2. 改完用三段说明：改了什么 / 为什么这么改 / 是否引入新的风险\n' +
      '3. **如果这个问题其实不需要改，直接说明理由，不要为了改而改**\n' +
      '4. 给出改动后的完整代码\n';
  }
  if(mode==='dig'){
    return '我要沿着这条调用链继续往下挖。\n\n' + head +
      (h.deeper ? '\n## 已知线索\n\n' + h.deeper + '\n' : '') +
      '\n## 请帮我查清\n\n' +
      '1. 这个函数内部又调用了谁？列出往下 2–3 层的调用关系。**不要猜**——说清楚你需要读哪些文件才能确认\n' +
      '2. 这条链路上还有哪些函数**本次没改、但依赖了被改动的假设**？\n' +
      '3. 这条链最终落到什么外部状态（DB 写入 / 外部调用 / 发消息 / 缓存）？副作用是否可逆、是否幂等？\n' +
      '4. 列出你认为**最需要人工确认的 3 个点**，并说明为什么机器判不了\n';
  }
  return '';
}

/* ---------- 弹窗 ---------- */
function openModal(title, raw, tip){
  document.getElementById('mTitle').textContent = title;
  window.__RAW__ = raw;
  document.getElementById('mTip').textContent = tip || '';
  applyTool();
  document.getElementById('mask').classList.add('open');
}
function applyTool(){
  var t = document.getElementById('mTool').value;
  var out = TOOLS[t](window.__RAW__ || '');
  document.getElementById('mText').value = out;
  document.getElementById('mStat').textContent = out.length + ' 字符';
}
function copyText(){
  var ta = document.getElementById('mText');
  ta.focus(); ta.select();
  try{ ta.setSelectionRange(0, 999999); }catch(e){}
  var done = false;
  try{ done = document.execCommand('copy'); }catch(e){}
  if(!done && navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(ta.value).then(function(){
      document.getElementById('mStat').textContent = '已复制到剪贴板';
    });
    return;
  }
  document.getElementById('mStat').textContent = done ? '已复制到剪贴板' : '请手动 Ctrl+C';
}
function saveMd(){
  var name = ((D.meta&&D.meta.title)||'review') + '-' + (document.getElementById('mTitle').textContent||'ask') + '.md';
  var blob = new Blob([document.getElementById('mText').value], {type:'text/markdown'});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 2000);
}

/* ---------- 底部清单 ---------- */
function buildLists(){
  var L = document.getElementById('lists');
  var panels = [];
  function tbl(head, rows, emptyMsg){
    if(!rows.length) return '<div class="tr">'+(emptyMsg||'无')+'</div>';
    return '<table><tr>'+head.map(function(h){return '<th>'+h+'</th>';}).join('')+'</tr>'+
      rows.map(function(r){return '<tr>'+r.map(function(c){return '<td>'+c+'</td>';}).join('')+'</tr>';}).join('')+
      '</table>';
  }
  /* ① 改动价值评估（该不该改 / 改得对不对） */
  var all = allHops();
  var cnt = {};
  all.forEach(function(x){ if(x.h.verdict) cnt[x.h.verdict]=(cnt[x.h.verdict]||0)+1; });
  var cntStr = ['必要改动','优化型改动','非必要改动','疑似误改','待确认'].filter(function(k){return cnt[k];})
    .map(function(k){ return k+' '+cnt[k]; }).join(' ｜ ');
  var vrows = all.filter(function(x){return x.h.verdict;}).map(function(x){
    var h=x.h;
    return ['`'+esc(h.file)+':'+(h.line||'')+'`',
            '<span class="badge '+(VERDICT[h.verdict]||'')+'">'+esc(h.verdict)+'</span>',
            esc(h.necessity||''), esc(h.match||''), esc(h.reasonableness||'')];
  });
  panels.push('<div><h4>① 改动价值评估</h4>'+
    (cntStr?'<div class="tr" style="margin-bottom:6px">'+cntStr+'</div>':'')+
    tbl(['位置','判定','必要性','与表述','合理性'], vrows, '未做价值判定')+'</div>');
  /* ② 需细看 · 精力分配（含维度） */
  var deep = all.filter(function(x){return x.h.tier==='细看';});
  panels.push('<div><h4>② 需细看 · 精力分配 <span class="n">('+deep.length+')</span></h4>'+
    tbl(['位置','函数','维度'], deep.map(function(x){
      return ['`'+esc(x.h.file)+':'+(x.h.line||'')+'`', esc(x.h.func||''), (x.h.focus||[]).map(esc).join(' ')];
    }), '没有标为「细看」的改动')+'</div>');
  /* ③ 孤儿变更 */
  panels.push('<div><h4>③ 孤儿变更 <span class="n">('+((D.orphans||[]).length)+')</span></h4>'+
    tbl(['位置','做了什么','建议'], (D.orphans||[]).map(function(o){
      return ['`'+esc(o.location||o.file)+'`', esc(o.what), esc(o.suggestion)];
    }), '无')+'</div>');
  /* ④ 改实现 */
  panels.push('<div><h4>④ 「改实现」高亮 <span class="n">('+((D.implChanges||[]).length)+')</span></h4>'+
    tbl(['位置','改了什么','影响谁'], (D.implChanges||[]).map(function(o){
      return ['`'+esc(o.location)+'`', esc(o.change), esc(o.impact)];
    }), '无')+'</div>');
  /* ⑤ 行为验证建议 */
  var vp = D.verifyPlan||[];
  var vbody;
  if(vp.length){
    vbody = tbl(['策略','目标','怎么做','为什么'], vp.map(function(v){
      return ['<span class="schip">'+esc(v.strategy)+'</span>', esc(v.target), esc(v.how), esc(v.why)];
    }));
  } else if(D.meta && D.meta.bigChange){
    vbody = '<div class="hint">这是<b>大改动</b>，建议把重心从「逐行读代码」转向<b>行为验证</b>：<br>'+
            '表征测试 → 锁住既有行为；性质测试 → 覆盖不变量/边界；影子运行 → 线上旁路比对。<br>'+
            '（请在 JSON 顶层补 <code>verifyPlan</code>）</div>';
  } else {
    vbody = '<div class="tr">无</div>';
  }
  panels.push('<div><h4>⑤ 行为验证建议</h4>'+vbody+'</div>');
  /* ⑥ 无法确认 */
  panels.push('<div><h4>⑥ 我无法确认 <span class="n">('+((D.unknowns||[]).length)+')</span></h4>'+
    tbl(['判断不了什么','为什么','怎么确认'], (D.unknowns||[]).map(function(o){
      return [esc(o.what), esc(o.reason), esc(o.how)];
    }), '无')+'</div>');
  panels.push('<div><h4>⑦ 机械覆盖检查（已展示不代表已审查）</h4>'+tbl(['项目','文件','状态','未覆盖 hunk / 排除理由'],(D.coverage||[]).map(function(x){return [esc(x.project),esc(x.file),esc(x.status),esc((x.missingHunks||[]).join(','))+' '+esc(x.reason)];}),'未执行 Git 覆盖检查')+'</div>');
  panels.push('<div><h4>⑧ 版本证据</h4>'+tbl(['项目','模式','基点','目标','diff SHA256'],(D.sourceSnapshots||[]).map(function(x){return [esc(x.project),esc(x.mode),esc(x.base),esc(x.head||'工作区快照'),esc(x.diffSha256)];}),'离线预览，无 Git 版本证据')+'</div>');
  L.querySelector('.in').innerHTML = panels.join('');
}

/* ---------- 过滤 / 分组 ---------- */
function setFilter(f){
  state.filter = f;
  document.querySelectorAll('.chip[data-f]').forEach(function(c){
    c.classList.toggle('on', c.dataset.f===f);
  });
  buildTree(); buildCode();
  if(cur) show(cur);
}
function setGroup(g){
  state.groupBy = g;
  var b = document.getElementById('btnGroup');
  if(b){ b.classList.toggle('on', g==='project'); b.textContent = (g==='project'?'按功能点':'按项目分组'); }
  buildTree();
  if(cur) show(cur);
}
document.querySelectorAll('.chip[data-f]').forEach(function(c){
  c.onclick = function(){ setFilter(c.dataset.f); };
});
document.getElementById('btnLists').onclick = function(){
  document.getElementById('lists').classList.toggle('open');
};
var btnGroup = document.getElementById('btnGroup');
if(btnGroup) btnGroup.onclick = function(){ setGroup(state.groupBy==='project'?'flow':'project'); };
var btnFmt = document.getElementById('btnFmt');
if(btnFmt){
  btnFmt.onclick = function(){
    state.hideFmt = !state.hideFmt;
    btnFmt.classList.toggle('on', state.hideFmt);
    buildCode();
    if(cur) show(cur);
  };
}
var btnBatch = document.getElementById('btnBatch');
if(btnBatch) btnBatch.onclick = function(){ openModal(AI_TITLE.batch, buildPrompt('batch',''), AI_TIP.batch); };

document.getElementById('mTool').onchange = applyTool;
document.getElementById('mCopy').onclick  = copyText;
document.getElementById('mFile').onclick  = saveMd;
document.getElementById('mClose').onclick = function(){ document.getElementById('mask').classList.remove('open'); };
document.getElementById('mask').onclick = function(e){ if(e.target.id==='mask') this.classList.remove('open'); };
document.addEventListener('keydown', function(e){ if(e.key==='Escape') document.getElementById('mask').classList.remove('open'); });

markAllFmt();
buildTree(); buildCode(); buildLists();
setFilter('all');
var bf = document.getElementById('btnFmt');
if(bf) bf.textContent = '隐藏格式变更 (' + fmtCount + ')';
var first = document.querySelector('.node[data-hop]');
if(first) show(first.dataset.hop);
"""

# ---------------------------------------------------------------- 校验

def validate(data):
    """Validate report structure; semantic confidence still needs evidence."""
    errors, warnings = [], []
    if not isinstance(data, dict):
        return ["根节点必须是对象"], []
    def required(obj, keys, path):
        for key in keys:
            if not isinstance(obj.get(key), str) or not obj[key].strip():
                errors.append(f"{path}.{key} 必须是非空字符串")
    def array(obj, key, path):
        value = obj.get(key, [])
        if not isinstance(value, list):
            errors.append(f"{path}.{key} 必须是数组")
            return []
        return value
    def enum(obj, key, values, path, needed=True):
        value = obj.get(key)
        if not isinstance(value, str) or value not in values:
            if needed or value is not None:
                errors.append(f"{path}.{key} 必须取自 {sorted(values)}")
    meta = data.get('meta')
    if not isinstance(meta, dict):
        errors.append('缺少 meta 对象')
    else:
        required(meta, ['title'], 'meta')
        stats = meta.get('stats')
        if stats is not None and (not isinstance(stats, dict) or any(
            type(stats.get(k)) is not int or stats[k] < 0 for k in ('files', 'added', 'removed'))):
            errors.append('meta.stats 必须包含非负整数 files/added/removed')
    repos = data.get('repositories', {})
    if not isinstance(repos, dict):
        errors.append('repositories 必须是 project → {path, scope} 对象'); repos = {}
    for project, config in repos.items():
        if not isinstance(config, dict):
            errors.append(f'repositories.{project} 必须是对象'); continue
        required(config, ['path'], 'repositories.' + project)
        scope = config.get('scope', {})
        if not isinstance(scope, dict):
            errors.append(f'repositories.{project}.scope 必须是对象'); continue
        enum(scope, 'mode', {'worktree', 'commit', 'range', 'branch'}, f'repositories.{project}.scope')
        if scope.get('mode') in ('range', 'branch'):
            required(scope, ['base', 'head'], f'repositories.{project}.scope')
        if scope.get('mode') == 'commit':
            required(scope, ['commit'], f'repositories.{project}.scope')
    seen, projects, nodes = set(), set(), []
    fps = array(data, 'flowPoints', 'root')
    orphans = array(data, 'orphans', 'root')
    if not fps and not orphans:
        errors.append('flowPoints 和 orphans 不能同时为空')
    for i, fp in enumerate(fps):
        path = f'flowPoints[{i}]'
        if not isinstance(fp, dict):
            errors.append(path + ' 必须是对象'); continue
        required(fp, ['id', 'title', 'requirement'], path)
        enum(fp, 'status', ENUM_STATUS, path)
        for j, chain in enumerate(array(fp, 'chains', path)):
            cp = f'{path}.chains[{j}]'
            if not isinstance(chain, dict):
                errors.append(cp + ' 必须是对象'); continue
            required(chain, ['id', 'name', 'sideEffect'], cp)
            hops = array(chain, 'hops', cp)
            if not hops:
                errors.append(cp + '.hops 不能为空')
            for k, hop in enumerate(hops):
                hp = f'{cp}.hops[{k}]'
                if not isinstance(hop, dict):
                    errors.append(hp + ' 必须是对象'); continue
                nodes.append((hop, hp))
                required(hop, ['id', 'file', 'why', 'risk_detail', 'verify'], hp)
                hid = hop.get('id')
                if isinstance(hid, str):
                    if not re.fullmatch(r'[A-Za-z0-9_-]+', hid) or hid.startswith('orphan') or hid in seen:
                        errors.append(hp + '.id 重复、保留或包含不支持的字符')
                    seen.add(hid)
                for key, values in [('type', ENUM_TYPES), ('tier', ENUM_TIER),
                                    ('risk', {'高', '中', '低'}), ('confidence', {'确定', '猜'})]:
                    enum(hop, key, values, hp)
                for key, values in [('necessity', ENUM_NECESSITY), ('match', ENUM_MATCH),
                                    ('reasonableness', ENUM_REASONABLE), ('verdict', ENUM_VERDICT),
                                    ('side', {'old', 'new'})]:
                    enum(hop, key, values, hp, False)
                if type(hop.get('line')) is not int or hop['line'] < 1:
                    errors.append(hp + '.line 必须是正整数')
                for focus in array(hop, 'focus', hp):
                    if not isinstance(focus, str) or focus not in ENUM_FOCUS:
                        errors.append(hp + '.focus 存在未知维度')
                if hop.get('tier') == '细看':
                    required(hop, ['role'], hp)
                    if hop.get('type') != '穿越未改':
                        required(hop, ['verdict', 'counterfactual'], hp)
                if hop.get('verdict') == '待确认':
                    required(hop, ['assessmentReason'], hp)
                if hop.get('confidence') == '确定' and not hop.get('evidence'):
                    warnings.append(hp + ' 标记确定但无 evidence，不能据此认定链路已验证')
    for i, orphan in enumerate(orphans):
        path = f'orphans[{i}]'
        if not isinstance(orphan, dict):
            errors.append(path + ' 必须是对象'); continue
        nodes.append((orphan, path))
        required(orphan, ['what', 'reason', 'suggestion', 'tier'], path)
        enum(orphan, 'tier', ENUM_TIER, path)
        if not (isinstance(orphan.get('file'), str) and type(orphan.get('line')) is int and orphan['line'] > 0):
            if not isinstance(orphan.get('location'), str) or not re.match(r'^.+:[1-9][0-9]*$', orphan['location']):
                errors.append(path + ' 需要 file/line 或 location=file:line')
    for node, path in nodes:
        project = node.get('project')
        if project is not None and not isinstance(project, str):
            errors.append(path + '.project 必须是字符串')
        elif project:
            projects.add(project)
        if repos and (not isinstance(project, str) or project not in repos):
            errors.append(path + '.project 没有 repositories 映射')
        code = node.get('code')
        if code is not None:
            if not isinstance(code, list):
                errors.append(path + '.code 必须是数组')
            else:
                for row in code:
                    if not isinstance(row, dict) or row.get('t') not in ('+', '-', ' ') or type(row.get('n')) is not int or not isinstance(row.get('c'), str):
                        errors.append(path + '.code 行必须包含 t/n/c')
        enum(node, 'verifyStatus', {'未执行', '通过', '失败', '受阻'}, path, False)
        if node.get('verifyStatus') in ('通过', '失败'):
            required(node, ['verifyResult', 'verifyEvidence'], path)
    if len(projects) > 1 and not repos:
        warnings.append('跨项目未配置 repositories：只允许 --no-git 离线预览，真实取码会拒绝')
    for key, fields in [('unknowns', ['what', 'reason', 'how']),
                        ('verifyPlan', ['strategy', 'target', 'how', 'why']),
                        ('implChanges', ['location', 'change', 'impact']),
                        ('exclusions', ['file', 'reason'])]:
        for i, item in enumerate(array(data, key, 'root')):
            path = f'{key}[{i}]'
            if not isinstance(item, dict):
                errors.append(path + ' 必须是对象'); continue
            required(item, fields, path)
            if key == 'exclusions' and repos and (not isinstance(item.get('project'), str) or item.get('project') not in repos):
                errors.append(path + '.project 没有 repositories 映射')
    if is_big_change(data) and not data.get('verifyPlan'):
        errors.append('大改动必须提供 verifyPlan')
    return errors, warnings


# ---------------------------------------------------------------- git 取码

def parse_hunks(diff_text):
    hunks, cur = [], None
    old_ln = new_ln = 0
    for raw in diff_text.splitlines():
        if raw.startswith("diff --git") or raw.startswith("index "):
            if cur:
                hunks.append(cur); cur = None
            continue
        m = HUNK_RE.match(raw)
        if m:
            if cur:
                hunks.append(cur)
            old_ln = int(m.group(1)); new_ln = int(m.group(2))
            cur = {"old_start": old_ln, "new_start": new_ln, "lines": []}
            continue
        if cur is None or raw.startswith("\\"):
            continue
        tag, content = raw[:1], raw[1:]
        if tag == "+":
            cur["lines"].append({"t": "+", "n": new_ln, "c": content}); new_ln += 1
        elif tag == "-":
            cur["lines"].append({"t": "-", "n": old_ln, "c": content}); old_ln += 1
        elif tag == " ":
            cur["lines"].append({"t": " ", "n": new_ln, "c": content}); old_ln += 1; new_ln += 1
    if cur:
        hunks.append(cur)
    return hunks


def pick_hunks(hunks, line, side="new"):
    return select_hunks(hunks, line, side)


# ---------------------------------------------------------------- 大改动判定

def is_big_change(data):
    meta = data.get("meta", {}) or {}
    stats = meta.get('stats')
    if isinstance(stats, dict) and all(type(stats.get(k)) is int for k in ('added', 'removed', 'files')):
        return stats.get('added', 0) + stats.get('removed', 0) >= BIG_LINES or stats.get('files', 0) >= BIG_FILES
    stat = str(meta.get("stat", ""))
    added = removed = files = 0
    m = re.search(r"\+\s*(\d+)", stat)
    if m:
        added = int(m.group(1))
    m = re.search(r"-\s*(\d+)", stat)
    if m:
        removed = int(m.group(1))
    m = re.search(r"(\d+)\s*(?:个)?\s*文件", stat)
    if m:
        files = int(m.group(1))
    if not files:
        m = re.search(r"(\d+) files? changed", stat)
        files = int(m.group(1)) if m else 0
    if not added and not removed:
        a = re.search(r"(\d+) insertions?", stat)
        d = re.search(r"(\d+) deletions?", stat)
        added, removed = int(a.group(1)) if a else 0, int(d.group(1)) if d else 0
    return (added + removed) >= BIG_LINES or files >= BIG_FILES


# ---------------------------------------------------------------- 渲染

def safe_json(data):
    return (json.dumps(data, ensure_ascii=False)
            .replace("</", "<\\/")
            .replace("\u2028", "\\u2028")
            .replace("\u2029", "\\u2029"))


def render(data):
    meta = data.get("meta", {})
    fps = data.get("flowPoints", []) or []
    n_chain = sum(len(f.get("chains", [])) for f in fps)
    n_orphan = len(data.get("orphans", []) or [])
    n_unknown = len(data.get("unknowns", []) or [])
    n_deep = sum(1 for fp in fps for ch in (fp.get("chains") or [])
                 for h in (ch.get("hops") or []) if h.get("tier") != "略读" or h.get("verdict") == "待确认")
    n_suspect = sum(1 for fp in fps for ch in (fp.get("chains") or [])
                    for h in (ch.get("hops") or []) if h.get("verdict") in SUSPECT_VERDICTS)
    n_proj = len({h.get("project") for fp in fps for ch in (fp.get("chains") or [])
                  for h in (ch.get("hops") or []) if h.get("project")})
    big = is_big_change(data)
    data.setdefault("meta", {})["bigChange"] = big

    chips = (
        '<div class="chip on" data-f="all">全部</div>'
        '<div class="chip deep" data-f="deep">只看需细看 ' + str(n_deep) + '</div>'
        '<div class="chip bad" data-f="suspect">只看可疑 ' + str(n_suspect) + '</div>'
        '<div class="chip" data-f="impl">只看「改实现」</div>'
        '<div class="chip" id="btnFmt">隐藏格式变更</div>'
        '<div class="chip" id="btnBatch">💬 批量追问</div>'
        + ('<div class="chip" id="btnGroup">按项目分组</div>' if n_proj > 1 else '')
        + '<div class="chip' + (' bad' if n_orphan else '') + '" id="btnLists">'
        '孤儿 ' + str(n_orphan) + ' ｜ 存疑 ' + str(n_unknown) + ' ▾</div>'
    )

    meta_line = ('__R__ · __S__ · __NC__ 条调用链'.replace('__R__', html.escape(str(meta.get("range", ""))))
                 .replace('__S__', html.escape(str(meta.get("stat", ""))))
                 .replace('__NC__', str(n_chain)))
    missing = sum(row['status'] == '未覆盖' for row in data.get('coverage', []))
    meta_line += ' · ' + ('未覆盖 %d 个文件（见底部）' % missing if data.get('sourceSnapshots') else '离线预览：未核验版本及覆盖率')
    meta_line += ' · 必要性判断不代表正确性；验证默认未执行'
    if big:
        meta_line += ' · <span class="big">大改动 → 建议优先行为验证</span>'

    page = """<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>变更评审 · __T__</title><style>__CSS__</style></head><body>
<header>
  <h1>__T__</h1>
  <div class="meta">__META__</div>
  <div class="chips">__CHIPS__</div>
</header>
<main>
  <nav id="tree"></nav>
  <section id="code"></section>
  <aside id="aside"></aside>
</main>
<div class="lists" id="lists"><div class="in"></div></div>
<div class="mask" id="mask">
  <div class="modal">
    <div class="mh"><span id="mTitle">追问</span><span class="x" id="mClose">×</span></div>
    <div class="mb">
      <textarea id="mText" spellcheck="false"></textarea>
      <div class="tip" style="margin-top:8px" id="mTip"></div>
    </div>
    <div class="mf">
      <select id="mTool">
        <option value="paste">粘贴到对话框（网页 / IDE Chat）</option>
        <option value="claude">Claude Code — 生成终端命令</option>
        <option value="codebuddy">CodeBuddy CLI — 生成终端命令</option>
        <option value="aider">Aider — 生成终端命令</option>
      </select>
      <button class="btn pri" id="mCopy">复制</button>
      <button class="btn" id="mFile">存成 .md</button>
      <span class="tip" id="mStat"></span>
    </div>
  </div>
</div>
<script>window.__DATA__=__D__;</script>
<script>__JS__</script>
</body></html>"""

    page = page.replace("__T__", html.escape(str(meta.get("title", "变更评审"))))
    page = page.replace("__META__", meta_line)
    page = page.replace("__CHIPS__", chips)
    page = page.replace("__CSS__", CSS)
    page = page.replace("__JS__", JS)
    page = page.replace("__D__", safe_json(data))
    return page


# ---------------------------------------------------------------- markdown 摘要

def summary_md(data):
    meta = data.get("meta", {})
    fps = data.get("flowPoints", []) or []
    out = []
    out.append("# 变更评审：" + str(meta.get("title", "")))
    out.append("")
    out.append("- 范围：`%s`" % meta.get("range", ""))
    out.append("- 规模：%s" % meta.get("stat", ""))
    out.append('- 必要性不代表正确性；未记录验证结果的项均为未执行。')
    for snap in data.get('sourceSnapshots', []):
        out.append(f"- 版本：{snap['project']} {snap['mode']} {snap['base']} → {snap['head'] or '工作区'}；diff SHA256 {snap['diffSha256']}")
    if not data.get('sourceSnapshots'):
        out.append('- 离线预览：未核验版本及覆盖率。')
    for row in data.get('coverage', []):
        out.append(f"- 覆盖：{row['project']} {row['file']} {row['status']}；未覆盖 hunk={row['missingHunks']} {row['reason']}")
    n_deep = sum(1 for fp in fps for ch in (fp.get("chains") or [])
                 for h in (ch.get("hops") or []) if h.get("tier") != "略读" or h.get("verdict") == "待确认")
    out.append("- 功能点 %d ｜ 调用链 %d ｜ 需细看 %d ｜ 孤儿 %d ｜ 存疑 %d"
               % (len(fps), sum(len(f.get("chains", [])) for f in fps), n_deep,
                  len(data.get("orphans", []) or []), len(data.get("unknowns", []) or [])))
    if is_big_change(data):
        out.append("- **大改动 → 建议重心从「读代码」转向「行为验证」（见文末 verifyPlan）**")
    out.append("")

    for fp in fps:
        out.append("## %s（%s）" % (fp.get("title", ""), fp.get("status", "")))
        if fp.get("requirement"):
            out.append("> 需求：%s" % fp["requirement"])
        for ch in (fp.get("chains") or []):
            out.append("")
            out.append("### 链：%s" % ch.get("name", ""))
            if ch.get("sideEffect"):
                out.append("终点副作用：%s" % ch["sideEffect"])
            out.append("")
            out.append("| 位置 | 函数 | 类型 | 判定 | 精力 | 维度 | 风险 | 置信度 |")
            out.append("|---|---|---|---|---|---|---|---|")
            for h in (ch.get("hops") or []):
                loc = ("[%s] %s" % (h["project"], h.get("file", ""))) if h.get("project") else h.get("file", "")
                out.append("| `%s:%s` | %s | %s | %s | %s | %s | %s | %s |" % (
                    loc, h.get("line", ""), h.get("func", ""), h.get("type", ""),
                    h.get("verdict", ""), h.get("tier", ""), "/".join(h.get("focus", []) or []),
                    h.get("risk", ""), h.get("confidence", "")))
            for h in (ch.get("hops") or []):
                if h.get("risk_detail"):
                    out.append("")
                    out.append("- **%s** 风险：%s" % (h.get("func", ""), h["risk_detail"]))
                if h.get("why"):
                    out.append("  - 为什么改：%s" % h["why"])
                out.append("  - 代码来源：%s" % h.get('codeStatus', '未提供 Git 证据'))
                out.append("  - 验证计划：%s；状态：%s" % (h.get('verify', ''), h.get('verifyStatus', '未执行')))
                if h.get('verifyResult'):
                    out.append("  - 验证结果：%s；证据：%s" % (h['verifyResult'], h.get('verifyEvidence', '')))
                if h.get('assessmentReason'):
                    out.append("  - 待确认原因：%s" % h['assessmentReason'])
        out.append("")

    orph = data.get("orphans", []) or []
    if orph:
        out.append("## 孤儿变更")
        out.append("")
        out.append("| 位置 | 做了什么 | 建议 |")
        out.append("|---|---|---|")
        for o in orph:
            out.append("| `%s` | %s | %s |" % (o.get("location", ""), o.get("what", ""), o.get("suggestion", "")))
        out.append("")

    impl = data.get("implChanges", []) or []
    if impl:
        out.append("## 「改实现」高亮（签名没变逻辑变了）")
        out.append("")
        out.append("| 位置 | 改了什么 | 影响谁 |")
        out.append("|---|---|---|")
        for o in impl:
            out.append("| `%s` | %s | %s |" % (o.get("location", ""), o.get("change", ""), o.get("impact", "")))
        out.append("")

    valued = [(fp.get("title", ""), ch.get("name", ""), h) for fp in fps
              for ch in (fp.get("chains") or []) for h in (ch.get("hops") or []) if h.get("verdict")]
    if valued:
        out.append("## 改动价值评估（该不该改 / 改得对不对）")
        out.append("")
        out.append("| 位置 | 判定 | 必要性 | 与表述 | 合理性 | 不改会怎样 |")
        out.append("|---|---|---|---|---|---|")
        for _fpt, _chn, h in valued:
            loc = ("[%s] %s" % (h["project"], h.get("file", ""))) if h.get("project") else h.get("file", "")
            out.append("| `%s:%s` | %s | %s | %s | %s | %s |" % (
                loc, h.get("line", ""), h.get("verdict", ""), h.get("necessity", ""),
                h.get("match", ""), h.get("reasonableness", ""), h.get("counterfactual", "")))
        out.append("")

    vp = data.get("verifyPlan", []) or []
    if vp:
        out.append("## 行为验证建议")
        out.append("")
        out.append("| 策略 | 目标 | 怎么做 | 为什么 |")
        out.append("|---|---|---|---|")
        for v in vp:
            out.append("| %s | %s | %s | %s |" % (v.get("strategy", ""), v.get("target", ""), v.get("how", ""), v.get("why", "")))
        out.append("")

    unk = data.get("unknowns", []) or []
    if unk:
        out.append("## 我无法确认（必须你去看）")
        out.append("")
        out.append("| 判断不了什么 | 为什么 | 怎么确认 |")
        out.append("|---|---|---|")
        for o in unk:
            out.append("| %s | %s | %s |" % (o.get("what", ""), o.get("reason", ""), o.get("how", "")))
        out.append("")
    return "\n".join(out)


# ---------------------------------------------------------------- 示例数据

DEMO = {
    "meta": {
        "title": "订单超时自动取消（跨 2 服务）",
        "range": "main..feat/order-timeout-cancel",
        "stat": "14 个文件，+623 / -118 行"
    },
    "flowPoints": [
        {
            "id": "FP-1", "title": "FP-1 超时订单自动取消", "status": "完整",
            "requirement": "订单创建 15 分钟未支付则自动取消，以创建时间为准，不要用支付倒计时",
            "chains": [
                {
                    "id": "C1", "name": "cron(order-job) → ScanTimeoutOrders → CancelOrder(order-svc) → UpdateStatus(order-svc)",
                    "sideEffect": "UPDATE orders.status；写 order_status_log",
                    "hops": [
                        {
                            "id": "h1", "project": "order-job", "file": "job/order_timeout.go", "line": 23,
                            "func": "ScanTimeoutOrders", "type": "新增", "tier": "细看",
                            "focus": ["边界"], "risk": "中", "confidence": "猜",
                            "why": "对应需求第 1 条：需要一个定时入口来触发取消",
                            "behavior": "新增定时任务，每分钟扫一次超时未支付订单，批量取消",
                            "role": "订单超时治理的入口：周期性找出超时未支付的订单并触发取消，是整条「超时取消」链路的起点。",
                            "necessity": "必要", "match": "匹配", "reasonableness": "合理",
                            "counterfactual": "不改则超时订单永远停留在未支付状态，需人工/其它任务兜底。",
                            "verdict": "必要改动",
                            "risk_detail": "扫表未见分页，订单表数据量大时可能一次性加载过多导致 OOM；需确认线上表规模",
                            "verify": "grep -rn \"ScanTimeoutOrders\" --include=*.go\n查线上 orders 表行数，决定是否要分页",
                            "deeper": "定时任务与业务服务同进程还是独立？独立部署时需确认是否存在多实例重复执行",
                            "code": [
                                {"t": " ", "n": 20, "c": "func init() {"},
                                {"t": "+", "n": 21, "c": "    cron.Every(1).Minutes().Do(ScanTimeoutOrders)"},
                                {"t": " ", "n": 22, "c": "}"},
                                {"t": " ", "n": 23, "c": ""},
                                {"t": "+", "n": 24, "c": "func ScanTimeoutOrders() {"},
                                {"t": "+", "n": 25, "c": "    orders, _ := repo.ListUnpaid(time.Now().Add(-15 * time.Minute))"},
                                {"t": "+", "n": 26, "c": "    for _, o := range orders {"},
                                {"t": "+", "n": 27, "c": "        svc.CancelOrder(o.ID, \"timeout\")"},
                                {"t": "+", "n": 28, "c": "    }"},
                                {"t": "+", "n": 29, "c": "}"}
                            ]
                        },
                        {
                            "id": "h2", "project": "order-svc", "file": "svc/order.go", "line": 88,
                            "func": "CancelOrder", "type": "改实现", "tier": "细看",
                            "focus": ["状态流转", "错误处理", "边界"], "risk": "高", "confidence": "猜",
                            "why": "为了复用给定时任务调用，删掉了原本的归属校验（原校验依赖 HTTP 上下文）",
                            "behavior": "签名未变，但删除了「校验 order.UserID == ctx.UserID」这段逻辑",
                            "role": "订单取消的唯一入口：所有取消请求（HTTP 接口、定时任务）最终都走到这里，负责校验可取消性并落状态。",
                            "necessity": "非必要", "match": "不匹配", "reasonableness": "不合理",
                            "counterfactual": "保留校验则定时任务无 ctx 会一直被拒；正确解法是把校验改成内部调用可跳过，而不是直接删除。",
                            "verdict": "疑似误改",
                            "risk_detail": "原本 HTTP 接口调用时有上游鉴权兜底；现在定时任务直接调用，少了一层校验，存在越权取消他人订单的风险",
                            "verify": "rg -n \"CancelOrder\" --type go   # 确认调用方\n构造他人 order_id，看定时任务能否取消 → 暴露越权",
                            "deeper": "确认是真的要删除校验，还是应把校验改成可选入参",
                            "code": [
                                {"t": " ", "n": 85, "c": "func CancelOrder(orderID int64, reason string) error {"},
                                {"t": "-", "n": 86, "c": "    if o.UserID != ctx.UserID {"},
                                {"t": "-", "n": 87, "c": "        return ErrForbidden"},
                                {"t": "-", "n": 88, "c": "    }"},
                                {"t": " ", "n": 89, "c": "    o, err := repo.Get(orderID)"},
                                {"t": " ", "n": 90, "c": "    if err != nil { return err }"}
                            ]
                        },
                        {
                            "id": "h3", "project": "order-svc", "file": "svc/order.go", "line": 142,
                            "func": "checkCancelable", "type": "穿越未改", "tier": "细看",
                            "focus": ["状态流转", "边界"], "risk": "中", "confidence": "猜",
                            "why": "本次没有改它，但它在这条链上，假设可能被上游变更打破",
                            "behavior": "无改动",
                            "role": "取消前的守卫：判断一个订单当前状态是否允许被取消，是状态机的一道校验（本次未改，但在链上）。",
                            "risk_detail": "内部假设 status 只能是 PENDING / PAID 两种，未考虑本次可能引入的中间态 CANCELING",
                            "verify": "打开 types/order.go 确认 status 枚举是否含新中间态",
                            "deeper": "如果引入中间态，这里会直接放过非法状态转换",
                            "code": [
                                {"t": " ", "n": 140, "c": "func checkCancelable(o *Order) bool {"},
                                {"t": " ", "n": 141, "c": "    return o.Status == PENDING || o.Status == PAID"},
                                {"t": " ", "n": 142, "c": "}"}
                            ]
                        },
                        {
                            "id": "h4", "project": "order-svc", "file": "repo/order.go", "line": 203,
                            "func": "UpdateStatus", "type": "改签名", "tier": "略读",
                            "risk": "中", "confidence": "猜",
                            "why": "对应需求第 2 条：取消原因要落库，便于后续对账",
                            "behavior": "新增 reason 参数，写入 cancel_reason 字段",
                            "role": "订单状态落库的统一写入口，所有状态变更都经它写 orders.status。",
                            "necessity": "必要", "match": "匹配", "reasonableness": "合理",
                            "counterfactual": "不加 reason 则取消原因无据可查，对账/客服追溯只能靠猜。",
                            "verdict": "必要改动",
                            "risk_detail": "所有调用方都要跟随改签名；需确认没有遗漏的调用点（可能有 RPC 调用方在仓库外）",
                            "verify": "rg -n \"UpdateStatus\" --type go\n全局搜 RPC 定义，确认是否有外部服务依赖旧签名",
                            "deeper": "如果这是对外暴露的 RPC 方法，改签名属于破坏性变更",
                            "code": [
                                {"t": "-", "n": 203, "c": "func UpdateStatus(id int64, status Status) error {"},
                                {"t": "+", "n": 203, "c": "func UpdateStatus(id int64, status Status, reason string) error {"},
                                {"t": " ", "n": 204, "c": "    return db.Exec(`UPDATE orders SET status=?`, status)"},
                                {"t": "+", "n": 205, "c": "    // reason 落库"},
                                {"t": "+", "n": 206, "c": "    return db.Exec(`UPDATE orders SET status=?, cancel_reason=?`, status, reason)"}
                            ]
                        }
                    ]
                }
            ]
        },
        {
            "id": "FP-2", "title": "FP-2 取消后释放库存", "status": "部分",
            "requirement": "取消成功后释放已占用的库存",
            "chains": [
                {
                    "id": "C2", "name": "CancelOrder(order-svc) → ReleaseInventory → IncrStock",
                    "sideEffect": "UPDATE sku_stock；写 stock_flow 流水",
                    "hops": [
                        {
                            "id": "h5", "project": "order-svc", "file": "svc/inventory.go", "line": 67,
                            "func": "ReleaseInventory", "type": "新增", "tier": "略读",
                            "risk": "中", "confidence": "猜",
                            "why": "对应需求：取消后需要把占用的库存还回去",
                            "behavior": "按 sku 逐个释放库存",
                            "role": "库存归还的执行者：把取消订单占用的库存加回去，是「取消」对库存侧的副作用出口。",
                            "necessity": "必要", "match": "部分匹配", "reasonableness": "勉强合理",
                            "counterfactual": "不释放则取消后库存永久被占用，越卖越少。",
                            "verdict": "必要改动",
                            "risk_detail": "只处理了普通商品，套餐/组合商品的子 sku 未释放 → 库存只多不少，且不会报错",
                            "verify": "造一个套餐订单取消，看子 sku 库存是否回滚",
                            "deeper": "套餐的 sku 结构在 order_item 表里是用 parent_id 关联的，本次完全没有处理",
                            "code": [
                                {"t": "+", "n": 65, "c": "func ReleaseInventory(items []OrderItem) error {"},
                                {"t": "+", "n": 66, "c": "    for _, it := range items {"},
                                {"t": "+", "n": 67, "c": "        if err := repo.IncrStock(it.SkuID, it.Quantity); err != nil {"},
                                {"t": "+", "n": 68, "c": "            return err"},
                                {"t": "+", "n": 69, "c": "        }"},
                                {"t": "+", "n": 70, "c": "    }"},
                                {"t": "+", "n": 71, "c": "    return nil"},
                                {"t": "+", "n": 72, "c": "}"}
                            ]
                        },
                        {
                            "id": "h6", "project": "order-svc", "file": "repo/stock.go", "line": 31,
                            "func": "IncrStock", "type": "改实现", "tier": "细看",
                            "focus": ["并发", "事务"], "risk": "高", "confidence": "猜",
                            "why": "看不出意图 —— 可能是有意的性能优化，也可能是误删。必须确认",
                            "behavior": "去掉了 SELECT ... FOR UPDATE 行锁",
                            "role": "库存增减的底层原子操作：所有库存变动（下单扣减、取消归还、后台调拨）都复用它。",
                            "necessity": "非必要", "match": "不匹配", "reasonableness": "不合理",
                            "counterfactual": "去掉行锁后并发读写同一 sku 会丢失更新，库存只多不少且不报错；这是典型的并发回归。",
                            "verdict": "疑似误改",
                            "risk_detail": "定时任务每分钟批量跑，多个订单并发释放同一 sku 时会丢失更新。编译和测试都不会报错，是典型的并发 bug",
                            "verify": "go test ./svc/inventory -run TestConcurrentRelease -race\n压测：同一 sku 起 50 个取消任务，看最终 stock 是否正确",
                            "deeper": "这个函数不只本次链路在用，所有库存增减路径都会受影响",
                            "code": [
                                {"t": " ", "n": 29, "c": "func IncrStock(skuID int64, delta int) error {"},
                                {"t": "-", "n": 30, "c": "    row := db.QueryRow(`SELECT stock FROM sku_stock"},
                                {"t": "-", "n": 31, "c": "        WHERE sku_id=? FOR UPDATE`, skuID)"},
                                {"t": "+", "n": 30, "c": "    row := db.QueryRow(`SELECT stock FROM sku_stock WHERE sku_id=?`, skuID)"},
                                {"t": " ", "n": 32, "c": "    ..."},
                                {"t": " ", "n": 33, "c": "}"}
                            ]
                        }
                    ]
                }
            ]
        },
        {
            "id": "FP-3", "title": "FP-3 取消后通知用户", "status": "缺失",
            "requirement": "取消后短信通知用户",
            "chains": []
        }
    ],
    "orphans": [
        {
            "project": "user-svc", "tier": "细看",
            "location": "user/svc/notify.go:88",
            "what": "新增短信通知调用",
            "reason": "疑似 AI 从 FP-3 联想补充，但没有接进任何调用链",
            "suggestion": "要么接进 FP-3，要么删除（现在是死代码）",
            "code": [
                {"t": "+", "n": 86, "c": "func NotifyCancel(userID int64, orderNo string) {"},
                {"t": "+", "n": 87, "c": "    phone := getPhone(userID)"},
                {"t": "+", "n": 88, "c": "    sms.Send(phone, \"订单\"+orderNo+\"已取消\")"},
                {"t": "+", "n": 89, "c": "}"}
            ]
        },
        {
            "project": "order-svc", "tier": "略读",
            "location": "svc/order.go:31",
            "what": "重构了 buildOrderVO 的字段拼装",
            "reason": "与本次需求无关，纯顺手重构",
            "suggestion": "删除，单独提 PR（它会把 diff 撑大，增加你的 review 负担）",
            "code": [
                {"t": "-", "n": 31, "c": "    vo.Name = o.Name"},
                {"t": "-", "n": 32, "c": "    vo.Price = o.Price"},
                {"t": "+", "n": 31, "c": "    vo = buildVO(o)"},
                {"t": "-", "n": 34, "c": "    vo.Tags    =    o.Tags"},
                {"t": "+", "n": 34, "c": "    vo.Tags = o.Tags"},
                {"t": "-", "n": 35, "c": "    vo.Desc  =  o.Desc  "},
                {"t": "+", "n": 35, "c": "    vo.Desc = o.Desc"}
            ]
        },
        {
            "project": "order-svc", "tier": "略读",
            "location": "db/migrate/007_add_index.sql:1",
            "what": "给 orders.created_at 加索引",
            "reason": "合理但不在需求里（扫表确实需要）",
            "suggestion": "保留，但要在 PR 里说明",
            "code": [
                {"t": "+", "n": 1, "c": "CREATE INDEX idx_orders_created ON orders(created_at);"}
            ]
        }
    ],
    "implChanges": [
        {"location": "svc/order.go:88", "change": "删除订单归属校验", "impact": "HTTP 取消接口（原本靠上游鉴权兜底）"},
        {"location": "repo/stock.go:31", "change": "去掉 FOR UPDATE 行锁", "impact": "所有库存增减路径，不止本次改动"}
    ],
    "verifyPlan": [
        {"strategy": "性质测试", "target": "IncrStock 并发放开", "how": "并发 N 次增减同一 sku，断言最终库存 = 初始 + Σdelta",
         "why": "去掉行锁后，丢失更新是确定性可复现的，性质断言比逐个 case 更有效"},
        {"strategy": "表征测试", "target": "CancelOrder", "how": "对既有取消场景录制输入/输出，重构前后逐字节比对",
         "why": "删除归属校验后行为已漂移，先用表征测试把现状锁死，再决定是否恢复校验"},
        {"strategy": "影子运行", "target": "订单超时扫描任务", "how": "在线上旁路跑一遍扫描（只记日志、不真取消），比对命中集合与耗时",
         "why": "扫表性能与命中范围只有真实数据量才能验证，避免直接上线引发 OOM"}
    ],
    "unknowns": [
        {"what": "CancelOrder 是否被仓库外服务调用", "reason": "可能是内部 RPC 被其他服务引用", "how": "全局搜 + 问原作者"},
        {"what": "checkCancelable 的 status 枚举是否含新中间态", "reason": "枚举定义在另一个模块，我读得不完整", "how": "打开 types/order.go 确认"},
        {"what": "去掉 FOR UPDATE 是有意优化还是误删", "reason": "diff 里看不出意图", "how": "必须问 AI 或原作者"},
        {"what": "扫表数据量级", "reason": "取决于线上订单表规模", "how": "查线上表行数，决定是否要分页"},
        {"what": "短信通道是否已有幂等/限流", "reason": "在 user 模块，超出本次变更范围", "how": "确认后再决定是否接 FP-3"}
    ]
}


# ---------------------------------------------------------------- main

def load_json(path):
    with open(path, encoding="utf-8-sig") as f:   # 兼容 Windows 的 UTF-8 BOM
        return json.load(f)


def main():
    ap = argparse.ArgumentParser(description="把变更评审 JSON 渲染成交互式 HTML")
    ap.add_argument("json", nargs="?", help="评审 JSON 文件")
    ap.add_argument("-o", "--out", default="review.html", help="输出 HTML 路径")
    ap.add_argument("--demo", action="store_true", help="生成示例页（离线）")
    ap.add_argument("--open", action="store_true", help="渲染完自动打开")
    ap.add_argument("--summary", action="store_true", help="输出轻量 markdown 摘要到 stdout，不写 HTML")
    ap.add_argument("--validate", action="store_true", help="只做结构校验")
    ap.add_argument("--repo", default=None, help="git 仓库路径（默认当前目录）")
    ap.add_argument("--range", dest="rng", default=None, help="git diff 范围，如 main..HEAD（默认取 meta.range，空则用 HEAD）")
    ap.add_argument("--strict", action="store_true", help="拒绝警告、取码未定位、覆盖缺口或离线预览（与 --validate 合用时也查 Git）")
    ap.add_argument("--no-git", action="store_true", help="不从 git 取代码，只用 JSON 里自带的 code[]")
    a = ap.parse_args()

    if a.demo:
        data = DEMO
    elif a.json:
        try:
            data = load_json(a.json)
        except FileNotFoundError:
            ap.error("找不到文件：" + a.json)
        except json.JSONDecodeError as e:
            ap.error("JSON 解析失败（%s）。提示：若模型输出带 markdown 代码围栏，请先去掉 ```json 包裹。" % e)
    else:
        ap.error("给一个 JSON 文件，或用 --demo")

    errs, warns = validate(data)
    for w in warns:
        print("警告：" + w, file=sys.stderr)
    if errs:
        print("结构校验未通过，共 %d 处问题：" % len(errs), file=sys.stderr)
        for e in errs:
            print("  - " + e, file=sys.stderr)
        sys.exit(1)
    if a.strict and warns:
        ap.error('严格模式拒绝上述警告')
    if a.validate and not a.strict:
        print('结构校验通过（未检查 Git 版本、取码或覆盖率）。')
        return
    if a.strict and (a.no_git or a.demo):
        ap.error('严格模式需要 Git 证据，不能使用 --no-git 或 --demo')
    if not a.no_git and not a.demo:
        projects = {h.get('project') for fp in data.get('flowPoints', []) for ch in fp.get('chains', []) for h in ch.get('hops', []) if h.get('project')}
        projects.update(o['project'] for o in data.get('orphans', []) if o.get('project'))
        if len(projects) > 1 and not data.get('repositories'):
            ap.error('跨项目取码需要 repositories 映射；离线示例请使用 --no-git')
        if data.get('repositories') and (a.repo or a.rng is not None):
            ap.error('repositories 已配置时请在各项目 scope 指定范围，不接受全局 --repo/--range')
        try:
            filled = enrich(data, a.repo or os.getcwd(),
                            a.rng if a.rng is not None else data.get('meta', {}).get('range', ''), parse_hunks)
        except (ValueError, OSError, subprocess.TimeoutExpired, KeyError) as exc:
            ap.error('Git 证据收集失败：' + str(exc))
        print(f'Git 精确取码：{filled} 处；覆盖检查仅证明 diff 已展示，不代表已审查。', file=sys.stderr)
        errs, _ = validate(data)
        if errs:
            ap.error('Git 实际统计校验失败：' + '；'.join(errs))
        nodes = [h for fp in data.get('flowPoints', []) for ch in fp.get('chains', []) for h in ch.get('hops', [])] + data.get('orphans', [])
        missing = [r for r in data['coverage'] if r['status'] == '未覆盖']
        unlocated = [h for h in nodes if not h.get('code')]
        if missing or unlocated:
            print(f'警告：{len(missing)} 个文件存在未覆盖内容，{len(unlocated)} 处代码未定位。', file=sys.stderr)
            if a.strict:
                ap.error('严格模式拒绝覆盖缺口或代码未定位')
    else:
        # Never retain stale Git claims when rendering user-supplied offline code.
        data.pop('sourceSnapshots', None)
        data.pop('coverage', None)
        for orphan in data.get('orphans', []):
            orphan['codeStatus'] = '离线自带代码：未核验 Git 版本'
        for fp in data.get('flowPoints', []):
            for ch in fp.get('chains', []):
                for hop in ch.get('hops', []):
                    hop['codeStatus'] = '离线自带代码：未核验 Git 版本'
    if a.validate:
        print('结构、Git 定位和机械覆盖检查通过；不代表代码正确或测试已通过。')
        return

    if a.summary:
        sys.stdout.write(summary_md(data))
        return

    out = os.path.abspath(a.out)
    with open(out, "w", encoding="utf-8") as f:
        f.write(render(data))
    print("已生成: " + out)
    if a.open:
        webbrowser.open("file://" + out)


if __name__ == "__main__":
    main()
