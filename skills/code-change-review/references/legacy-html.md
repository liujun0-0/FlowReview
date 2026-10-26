# 旧版单文件 HTML 与校验

仅用户明确要求单文件 HTML/离线旧版，或需要旧渲染器校验时读取。本模式不提供新版业务图与源码侧栏；校验命令不代表已经交付浏览器报告。

需要单文件 HTML、离线旧版或结构/覆盖校验时，继续使用下列原有渲染器：

```powershell
python scripts/render.py review.json --repo /path/to/repository -o review.html
python scripts/render.py review.json --repo /path/to/repository --range main...HEAD --summary
python scripts/render.py review.json --validate
python scripts/render.py review.json --repo /path/to/repository --validate --strict
python scripts/render.py examples/review.example.json --no-git -o demo.html
```

有 `repositories` 时在各项目 scope 指定范围，不传全局 `--repo/--range`。

- `--validate` 仅结构检查，不证明 Git 版本、覆盖完整或代码正确。
- `--strict` 拒绝警告、代码未定位、覆盖缺口；与 `--validate` 合用也执行 Git 核验。它不证明人工审查结论或验证结果真实。
- Git 模式实际代码替换 JSON 自带代码；未命中即显示未定位，禁止取最近 hunk。
- `--no-git` 仅离线预览，标明未核验版本与覆盖率，不能与 strict 合用。
- Git 失败、范围无效、取码期间工作区变化时退出，不输出伪成功报告。
- JSON 兼容 UTF-8 BOM；报告含源代码，按项目现有权限存放，勿擅自上传。

