"""Open a report with the FlowReview installation paired with this skill."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess


def reader_entry(root):
    for name in ("flowreview.js", "yadiff-review.js"):
        entry = root / "bin" / name
        if entry.is_file():
            return entry
    return None


def locate_tool(explicit=None, skill_dir=None):
    override = explicit or os.environ.get("FLOWREVIEW_HOME") or os.environ.get("YADIFF_REVIEW_HOME")
    if override:
        root = Path(override).expanduser().resolve()
        if not reader_entry(root):
            raise ValueError(f"指定位置没有 FlowReview 阅读器：{root}")
        return root
    skill = Path(skill_dir) if skill_dir else Path(__file__).resolve().parents[1]
    # A skill used directly from a checkout stays paired with that checkout.
    for root in skill.resolve().parents:
        package = root / "package.json"
        if package.is_file() and reader_entry(root):
            try:
                if json.loads(package.read_text(encoding="utf-8")).get("name") == "@liujun0-0/flowreview":
                    return root
            except (OSError, ValueError):
                continue
    config = skill / ".flowreview-install.json"
    if config.is_file():
        try:
            root = Path(json.loads(config.read_text(encoding="utf-8"))["toolDir"]).resolve()
        except (OSError, ValueError, KeyError, TypeError) as exc:
            raise ValueError(f"安装记录无效，请重新安装 skill：{config}") from exc
        if reader_entry(root):
            return root
        raise ValueError(f"FlowReview 已移动或删除：{root}。请在新目录运行 tools/install_skill.py --update。")
    raise ValueError("未找到配套 FlowReview。请从项目运行 tools/install_skill.py，或传 --tool-dir / 设置 FLOWREVIEW_HOME。")


def main():
    parser = argparse.ArgumentParser(description="生成固定源码快照并打开 FlowReview")
    parser.add_argument("report", nargs="?", help="现有 review.json")
    parser.add_argument("--snapshot", help="重新打开已有快照")
    parser.add_argument("--out", help="新快照目录，不覆盖已有目录")
    parser.add_argument("--tool-dir", help="FlowReview 根目录；优先于环境变量及安装记录")
    for flag in ("build-only", "no-open", "foreground", "stop"):
        parser.add_argument("--" + flag, action="store_true")
    args = parser.parse_args()
    if not args.stop and bool(args.report) == bool(args.snapshot):
        parser.error("report 与 --snapshot 需要且只能指定一个")
    try:
        tool = locate_tool(args.tool_dir)
    except ValueError as exc:
        parser.error(str(exc))
    node = shutil.which("node")
    if not node:
        parser.error("请先安装 Node.js 并加入 PATH")
    if not args.stop and not args.build_only and not (tool / "dist" / "index.html").is_file():
        parser.error(f"阅读器尚未构建，请在 {tool} 执行 npm ci 和 npm run build")
    cmd = [node, str(reader_entry(tool))]
    for name in ("report", "snapshot", "out"):
        value = getattr(args, name)
        if value:
            cmd += ["--review" if name == "report" else "--" + name, str(Path(value).resolve())]
    for name in ("build_only", "no_open", "foreground", "stop"):
        if getattr(args, name):
            cmd.append("--" + name.replace("_", "-"))
    raise SystemExit(subprocess.run(cmd, cwd=tool).returncode)


if __name__ == "__main__":
    main()
