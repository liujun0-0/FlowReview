"""Stage the paired skill, switch directories and roll back failed updates."""
import argparse
import json
from pathlib import Path
import shutil
import tempfile
import warnings
import time


def managed(path, name):
    try:
        config = json.loads((path / '.flowreview-install.json').read_text(encoding='utf-8'))
        return config if isinstance(config, dict) and config.get('skill') == name else None
    except (OSError, ValueError):
        return None


def remove_generated(path, parent, prefix):
    # Recursive cleanup is limited to an installer-created sibling directory.
    if path.parent.resolve() != parent.resolve() or not path.name.startswith(prefix) or path.is_symlink() or path.resolve() != parent.resolve() / path.name:
        raise ValueError('拒绝清理未验证的安装暂存目录')
    if path.exists():
        shutil.rmtree(path)


def rename_directory(source, target):
    # Windows indexers can briefly hold a freshly copied directory open.
    for attempt in range(5):
        try:
            return source.rename(target)
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.05 * (2 ** attempt))


def install(tool, skills_dir, update=False):
    tool = Path(tool).resolve()
    source = tool / 'skills' / 'code-change-review'
    target = Path(skills_dir).expanduser().resolve() / source.name
    if not (source / 'SKILL.md').is_file() or not (tool / 'bin/flowreview.js').is_file():
        raise ValueError('请从完整的 FlowReview 项目运行安装脚本')
    if target == source or source in target.parents or target.is_symlink() or target.resolve() != target.parent.resolve() / target.name:
        raise ValueError('安装目标不能是仓库源目录、其子目录或符号链接')
    prefix = f'.{source.name}.'
    backup = target.parent / (prefix + 'backup')
    if backup.exists():
        if backup.is_symlink() or backup.resolve() != backup.parent.resolve() / backup.name:
            raise ValueError('安装备份不是安全的本地目录')
        if not target.exists() and managed(backup, source.name) and not backup.is_symlink():
            rename_directory(backup, target)  # Recover an interrupted switch before proceeding.
        elif managed(backup, source.name) and managed(target, source.name):
            remove_generated(backup, target.parent, prefix)
        else:
            raise ValueError(f'发现未清理的安装备份，请先核对：{backup}')
    previous = managed(target, source.name) if target.exists() else None
    if target.exists() and not update:
        raise ValueError(f'目标已存在：{target}。确认更新后使用 --update；不会自动覆盖个人 skill。')
    if target.exists() and not previous:
        raise ValueError(f'目标不是此安装器管理的 skill：{target}。请先备份并移走，或选择其他 --skills-dir。')
    target.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=prefix + 'stage-', dir=target.parent))
    switched = False
    try:
        ignore = shutil.ignore_patterns('__pycache__', '*.pyc', '.flowreview-install.json')
        if target.exists():
            shutil.copytree(target, stage, dirs_exist_ok=True, symlinks=True, ignore=ignore)
        files = sorted(str(p.relative_to(source)).replace('\\', '/') for p in source.rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.suffix != '.pyc' and p.name != '.flowreview-install.json')
        old_files = (previous or {}).get('managedFiles', [])
        if not isinstance(old_files, list) or not all(isinstance(item, str) for item in old_files):
            raise ValueError('安装记录的受管理文件清单无效')
        for relative in old_files:
            if relative in files:
                continue
            old = stage / relative
            if not old.resolve().is_relative_to(stage.resolve()) or old.is_symlink():
                raise ValueError('安装记录包含不安全路径')
            if old.is_file():
                old.unlink()
        # Do not follow user-created symlinks while overwriting managed resources.
        for relative in files + ['.flowreview-install.json']:
            candidate = stage / relative
            if candidate.is_symlink() or not candidate.resolve().is_relative_to(stage.resolve()):
                raise ValueError('安装副本包含越界链接，请先备份并移走')
        shutil.copytree(source, stage, dirs_exist_ok=True, ignore=ignore)
        (stage / '.flowreview-install.json').write_text(json.dumps({'skill': source.name, 'toolDir': str(tool), 'managedFiles': files}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        if target.exists():
            rename_directory(target, backup)
        try:
            rename_directory(stage, target)
            switched = True
        except OSError:
            if backup.exists():
                rename_directory(backup, target)
            raise
        if backup.exists():
            try:
                remove_generated(backup, target.parent, prefix)
            except OSError:
                warnings.warn(f'新 skill 已安装；旧备份暂被占用，后续更新将重试清理：{backup}')
        return target
    finally:
        if not switched:
            remove_generated(stage, target.parent, prefix)


def main():
    parser = argparse.ArgumentParser(description='安装 FlowReview 配套 code-change-review skill')
    parser.add_argument('--skills-dir', type=Path, default=Path.home() / '.agents' / 'skills', help='AI 工具扫描的 skills 父目录；默认 ~/.agents/skills')
    parser.add_argument('--update', action='store_true', help='更新此安装器管理的已有副本')
    args = parser.parse_args()
    try:
        target = install(Path(__file__).resolve().parents[1], args.skills_dir, args.update)
    except (ValueError, OSError) as exc:
        parser.error(str(exc))
    print(f'Skill installed: {target}\n重载 AI 工具的 skill 列表后使用 code-change-review。')


if __name__ == '__main__':
    main()
