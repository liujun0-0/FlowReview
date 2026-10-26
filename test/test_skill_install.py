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


if __name__ == "__main__":
    unittest.main()
