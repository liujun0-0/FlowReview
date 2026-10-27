import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


installer = module("installer", ROOT / "tools/install_skill.py")
reader = module("reader", ROOT / "skills/code-change-review/scripts/open_reader.py")


class SkillInstallTests(unittest.TestCase):
    def test_checkout_discovery_and_explicit_invalid_override(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(reader.locate_tool(skill_dir=ROOT / "skills/code-change-review"), ROOT)
            with tempfile.TemporaryDirectory() as empty:
                with self.assertRaises(ValueError):
                    reader.locate_tool(explicit=empty, skill_dir=ROOT / "skills/code-change-review")

    def test_install_update_and_moved_reader(self):
        with tempfile.TemporaryDirectory(prefix="FlowReview space ") as tmp, patch.dict(os.environ, {}, clear=True):
            skills = Path(tmp) / "agent skills"
            target = installer.install(ROOT, skills)
            self.assertEqual(reader.locate_tool(skill_dir=target), ROOT)
            with self.assertRaises(ValueError):
                installer.install(ROOT, skills)
            installer.install(ROOT, skills, update=True)
            marker = target / ".flowreview-install.json"
            marker.write_text(json.dumps({"skill": target.name, "toolDir": str(Path(tmp) / "moved")}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "移动或删除"):
                reader.locate_tool(skill_dir=target)
            self.assertEqual(reader.locate_tool(explicit=str(ROOT), skill_dir=target), ROOT)

    def test_refuses_unmanaged_skill_and_source_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            personal = Path(tmp) / "code-change-review"
            personal.mkdir()
            (personal / "SKILL.md").write_text("personal", encoding="utf-8")
            with self.assertRaises(ValueError):
                installer.install(ROOT, tmp, update=True)
            self.assertEqual((personal / "SKILL.md").read_text(encoding="utf-8"), "personal")
        with self.assertRaises(ValueError):
            installer.install(ROOT, ROOT / "skills", update=True)

    def test_update_removes_only_obsolete_managed_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = installer.install(ROOT, tmp)
            (target / 'obsolete.md').write_text('managed old file', encoding='utf-8')
            (target / 'personal.md').write_text('keep me', encoding='utf-8')
            marker = target / '.flowreview-install.json'
            metadata = json.loads(marker.read_text(encoding='utf-8'))
            metadata['managedFiles'].append('obsolete.md')
            marker.write_text(json.dumps(metadata), encoding='utf-8')
            installer.install(ROOT, tmp, update=True)
            self.assertFalse((target / 'obsolete.md').exists())
            self.assertEqual((target / 'personal.md').read_text(encoding='utf-8'), 'keep me')

    def test_failed_switch_restores_the_previous_installation(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = installer.install(ROOT, tmp)
            before = (target / 'SKILL.md').read_bytes()
            original_rename = Path.rename
            def fail_switch(path, destination):
                if path.name.startswith('.code-change-review.stage-'):
                    raise OSError('simulated switch failure')
                return original_rename(path, destination)
            with patch.object(Path, 'rename', fail_switch):
                with self.assertRaises(OSError):
                    installer.install(ROOT, tmp, update=True)
            self.assertEqual((target / 'SKILL.md').read_bytes(), before)
            self.assertEqual(reader.locate_tool(skill_dir=target), ROOT)

    def test_failed_copy_does_not_modify_the_previous_installation(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = installer.install(ROOT, tmp)
            before = (target / 'SKILL.md').read_bytes()
            with patch.object(installer.shutil, 'copytree', side_effect=OSError('simulated copy failure')):
                with self.assertRaises(OSError):
                    installer.install(ROOT, tmp, update=True)
            self.assertEqual((target / 'SKILL.md').read_bytes(), before)

    def test_interrupted_directory_switch_is_recovered_on_next_update(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = installer.install(ROOT, tmp)
            backup = target.parent / '.code-change-review.backup'
            target.rename(backup)
            restored = installer.install(ROOT, tmp, update=True)
            self.assertTrue((restored / 'SKILL.md').is_file())
            self.assertFalse(backup.exists())

    def test_transient_windows_directory_lock_is_retried(self):
        with tempfile.TemporaryDirectory() as tmp:
            original_rename = Path.rename
            attempts = []
            def transient(path, destination):
                if path.name.startswith('.code-change-review.stage-'):
                    attempts.append(path)
                    if len(attempts) == 1:
                        raise PermissionError('temporary indexer lock')
                return original_rename(path, destination)
            with patch.object(Path, 'rename', transient):
                target = installer.install(ROOT, tmp)
            self.assertTrue((target / 'SKILL.md').is_file())
            self.assertEqual(len(attempts), 2)


class WindowsInstallPermissionTests(unittest.TestCase):
    @unittest.skipUnless(os.name == 'nt', 'Windows ACL inheritance')
    def test_installed_skill_inherits_parent_acl_instead_of_owner_only_acl(self):
        import ctypes
        from ctypes import wintypes
        advapi = ctypes.WinDLL('advapi32', use_last_error=True)
        get_security = advapi.GetFileSecurityW
        get_security.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.LPVOID, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
        get_security.restype = wintypes.BOOL
        get_control = advapi.GetSecurityDescriptorControl
        get_control.argtypes = [wintypes.LPVOID, ctypes.POINTER(wintypes.WORD), ctypes.POINTER(wintypes.DWORD)]
        get_control.restype = wintypes.BOOL
        with tempfile.TemporaryDirectory(prefix='skill ACL ') as tmp:
            for update in [False, True]:
                target = installer.install(ROOT, tmp, update=update)
                for path in [target, target / 'SKILL.md', target / 'scripts' / 'open_reader.py']:
                    needed = wintypes.DWORD()
                    get_security(str(path), 4, None, 0, ctypes.byref(needed))
                    self.assertGreater(needed.value, 0)
                    buffer = ctypes.create_string_buffer(needed.value)
                    self.assertTrue(get_security(str(path), 4, buffer, len(buffer), ctypes.byref(needed)))
                    control, revision = wintypes.WORD(), wintypes.DWORD()
                    self.assertTrue(get_control(buffer, ctypes.byref(control), ctypes.byref(revision)))
                    self.assertFalse(control.value & 0x1000, str(path))  # SE_DACL_PROTECTED


if __name__ == "__main__":
    unittest.main()
