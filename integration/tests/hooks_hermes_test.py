"""Transport tests, plus real Hermes dispatch when run in its runtime."""

import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

INTEGRATION = Path(__file__).resolve().parents[1]


def load_adapter(path):
    spec = importlib.util.spec_from_file_location("omd_adapter_test", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class HermesFixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="omd-hermes-", dir=os.environ.get("TMPDIR"))
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.plugin = self.base / "omd"
        shutil.copytree(INTEGRATION / "adapters", self.plugin)
        self.project = self.base / "project"
        self.project.mkdir()
        (self.project / "DESIGN.md").write_text("# Design\nColor #112233\n")
        self.adapter = load_adapter(self.plugin / "__init__.py")


class HermesTransport(HermesFixture):
    def test_results_preserve_original_fields_and_findings_never_cross_calls(self):
        original = json.dumps({"success": True, "nested": {"bytes": 4}, "omd_advisory": "prior"})
        a = self.adapter.after_tool("write_file", {"path": "a.css", "content": "color:#abcdef"}, original, cwd=self.project, session_id="s1", tool_call_id="same")
        decoded = json.loads(a)
        self.assertEqual(decoded["nested"], {"bytes": 4})
        self.assertTrue(decoded["success"])
        self.assertEqual(decoded["omd_advisory"][0], "prior")
        self.assertIn("OMD WATCH", decoded["omd_advisory"][1])
        self.assertIsNone(self.adapter.after_tool("read_file", {"path": "a.css"}, original, cwd=self.project, session_id="s2", tool_call_id="same"))
        self.assertIsNone(self.adapter.after_tool("write_file", {"path": "a.css", "content": "color:#112233"}, original, cwd=self.project, session_id="s1", tool_call_id="next"))
        self.assertIsNone(self.adapter.after_tool("write_file", {"path": "b.css", "content": "color:#123456"}, original, status="error", cwd=self.project))
        text = (self.project / ".omd/preferences.md").read_text()
        self.assertIn("source_agent: hermes", text)
        self.assertEqual(text.count("```omd-meta"), 1)

    def test_missing_node_malformed_output_and_slow_child_fail_open(self):
        for child in ["console.log('not json')", "setInterval(() => {}, 1000)"]:
            (self.plugin / "hooks/bridge.cjs").write_text(child)
            started = time.monotonic()
            self.assertIsNone(self.adapter.before_turn("Design a card", True, cwd=self.project))
            self.assertLess(time.monotonic() - started, 1.6)
        with patch.dict(os.environ, {"PATH": ""}):
            self.assertIsNone(self.adapter.after_tool("write_file", {"path": "a.css", "content": "color:#abcdef"}, "{}", cwd=self.project))
        self.assertFalse((self.project / ".omd").exists())


HERMES_AVAILABLE = importlib.util.find_spec("hermes_cli") is not None


@unittest.skipUnless(HERMES_AVAILABLE, "run in the Hermes runtime for real plugin dispatch")
class HermesDispatch(HermesFixture):

    def setUp(self):
        super().setUp()
        home = self.base / "home"
        home.mkdir()
        plugin = home / "plugins/omd"
        plugin.parent.mkdir()
        shutil.move(self.plugin, plugin)
        self.plugin = plugin
        # Included and excluded skills coexist to test registration admission.
        for name, source in {
            "omd-remember": '---\nname: omd-remember\ndescription: "Capture explicit corrections"\ndisable-model-invocation: true\nmetadata:\n  internal: true\n---\n# Remember\nCapture the preference.\n',
            "omd-harness": '# Harness\nDiscover the project with user approval.\n',
            "omd-init": '---\nname: omd-init\ndescription: excluded\n---\nExcluded\n',
            "omd-kr-writer": '---\nname: omd-kr-writer\ndescription: Korean writing with voice presets\nuser-invocable: true\n---\n# Korean writer\nWrite Korean prose.\n',
            "omd-humanize": '---\nname: omd-humanize\ndescription: excluded\n---\nExcluded\n',
        }.items():
            target = plugin / "skills" / name / "SKILL.md"
            target.parent.mkdir(parents=True)
            target.write_text(source)
        (home / "config.yaml").write_text('plugins:\n  enabled: [omd]\n  hook_callback_timeout: 1.2\n')
        env = patch.dict(os.environ, {"HERMES_HOME": str(home), "TERMINAL_CWD": str(self.project), "HERMES_TEST_MODE": "1"})
        env.start()
        self.addCleanup(env.stop)
        import hermes_cli.plugins as hermes_plugins

        hermes_plugins._plugin_manager = hermes_plugins.PluginManager()
        hermes_plugins.discover_plugins(force=True)
        self.manager = hermes_plugins.get_plugin_manager()
        import tools.file_tools  # Register the real write and patch handlers.

    def dispatch(self, name, args, call="call"):
        import model_tools

        return json.loads(model_tools.handle_function_call(name, args, session_id="session", tool_call_id=call))

    def test_real_registration_frontmatter_context_and_writes(self):
        from hermes_cli.lifecycle import invoke_hook
        skills = {item["name"]: item for item in self.manager.list_plugin_skill_metadata()}
        self.assertIn("omd:omd-remember", skills)
        self.assertIn("omd:omd-harness", skills)
        self.assertNotIn("omd:omd-init", skills)
        self.assertIn("omd:omd-kr-writer", skills)
        self.assertNotIn("omd:omd-humanize", skills)
        metadata = skills["omd:omd-remember"]["frontmatter"]
        self.assertIs(metadata["disable-model-invocation"], True)
        self.assertEqual(metadata["metadata"], {"internal": True})
        self.assertEqual(skills["omd:omd-harness"]["description"], "Discover the project with user approval.")
        context = invoke_hook("pre_llm_call", user_message="Design a card", is_first_turn=False, session_id="resumed")
        self.assertTrue(any("DESIGN.md" in item.get("context", "") for item in context if isinstance(item, dict)))
        self.assertTrue(any(isinstance(item, dict) and "OMD project authority" in item.get("context", "") for item in invoke_hook("pre_llm_call", user_message="", is_first_turn=False, session_id="another")))
        self.assertFalse(any(isinstance(item, dict) and "OMD project authority" in item.get("context", "") for item in invoke_hook("pre_llm_call", user_message="", is_first_turn=False, session_id="resumed")))
        target = self.project / "actual.css"
        result = self.dispatch("write_file", {"path": str(target), "content": "color:#abcdef"})
        self.assertEqual(target.read_text(), "color:#abcdef")
        self.assertIn("OMD WATCH", result["omd_advisory"])
        self.assertTrue(result["verified"])
        replaced = self.dispatch("patch", {"path": str(target), "old_string": "#abcdef", "new_string": "#fedcba"}, "replace")
        self.assertEqual(target.read_text(), "color:#fedcba")
        self.assertIn("OMD WATCH", replaced["omd_advisory"])
        added = self.project / "v4a.css"
        result = self.dispatch("patch", {"mode": "patch", "patch": f"*** Begin Patch\n*** Add File: {added}\n+color:#123456\n*** End Patch"}, "v4a")
        self.assertEqual(added.read_text().strip(), "color:#123456")
        self.assertIn("OMD WATCH", result["omd_advisory"])
        invoke_hook("post_llm_call", session_id="s")
        self.assertFalse((self.project / ".omd/foldin-proposal.json").exists())

    def test_real_writes_survive_stalled_checker_and_clean_calls_do_not_warn(self):
        target = self.project / "clean.css"
        clean = self.dispatch("write_file", {"path": str(target), "content": "color:#112233"})
        self.assertNotIn("omd_advisory", clean)
        for index, source in enumerate(["setInterval(() => {}, 1000)", "console.log('malformed')"]):
            (self.plugin / "hooks/bridge.cjs").write_text(source)
            name = self.project / f"failure{index}.css"
            started = time.monotonic()
            output = self.dispatch("write_file", {"path": str(name), "content": "color:#abcdef"}, str(index))
            self.assertEqual(name.read_text(), "color:#abcdef")
            self.assertTrue(output["verified"])
            self.assertNotIn("omd_advisory", output)
            self.assertLess(time.monotonic() - started, 2.5)


if __name__ == "__main__":
    unittest.main()
