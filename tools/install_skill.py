"""Install the repository-owned skill and record its paired reader location."""
import argparse
import json
from pathlib import Path
import shutil


def install(tool, skills_dir, update=False):
    tool = Path(tool).resolve()
    source = tool / "skills" / "code-change-review"
    target = Path(skills_dir).expanduser().resolve() / source.name
    if not (source / "SKILL.md").is_file() or not (tool / "bin" / "flowreview.js").is_file():
        raise ValueError("请从完整的 FlowReview 项目运行安装脚本")
    if target == source or source in target.parents or target.is_symlink():
        raise ValueError("安装目标不能是仓库源目录、其子目录或符号链接")
    marker = target / ".flowreview-install.json"
    if target.exists():
        if not update:
            raise ValueError(f"目标已存在：{target}。确认更新后使用 --update；不会自动覆盖个人 skill。")
        try:
            owned = json.loads(marker.read_text(encoding="utf-8")).get("skill") == source.name
        except (OSError, ValueError, AttributeError):
            owned = False
        if not owned:
            raise ValueError(f"目标不是此安装器管理的 skill：{target}。请先备份并移走，或选择其他 --skills-dir。")
    shutil.copytree(source, target, dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".flowreview-install.json"))
    marker.write_text(json.dumps({"skill": source.name, "toolDir": str(tool)}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return target


def main():
    parser = argparse.ArgumentParser(description="安装 FlowReview 配套 code-change-review skill")
    parser.add_argument("--skills-dir", type=Path, default=Path.home() / ".agents" / "skills",
                        help="AI 工具扫描的 skills 父目录；默认 ~/.agents/skills")
    parser.add_argument("--update", action="store_true", help="更新此安装器管理的已有副本")
    args = parser.parse_args()
    try:
        target = install(Path(__file__).resolve().parents[1], args.skills_dir, args.update)
    except ValueError as exc:
        parser.error(str(exc))
    print(f"Skill installed: {target}\n重载 AI 工具的 skill 列表后使用 code-change-review。")


if __name__ == "__main__":
    main()
