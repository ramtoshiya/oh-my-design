"""Native Hermes events translated to the bundled advisory Node hooks."""

from collections import OrderedDict
import json
import os
from pathlib import Path
import subprocess
from threading import Lock

ROOT = Path(__file__).resolve().parent
SKILLS = (
    "omd-apply", "omd-remember", "omd-learn", "omd-feel", "omd-restraint",
    "omd-slop-audit", "omd-humanize", "omd-autopilot", "omd-harness",
    "omd-designer-review", "omd-final-qa", "omd-orchestrator",
)


def working_directory(cwd=None):
    return str(cwd or os.environ.get("TERMINAL_CWD") or os.getcwd())


def run_hook(event, payload):
    """Use one bounded subprocess per event, with no pending global state."""
    try:
        result = subprocess.run(
            ["node", str(ROOT / "hooks" / "bridge.cjs"), event],
            input=json.dumps({**payload, "host": "hermes"}), capture_output=True,
            text=True, cwd=payload["cwd"], timeout=0.9, check=True,
        )
        if len(result.stdout) > 256 * 1024:
            return None
        output = json.loads(result.stdout) if result.stdout.strip() else {}
        context = output.get("hookSpecificOutput", {}).get("additionalContext")
        return context if isinstance(context, str) and context.strip() else None
    except (OSError, ValueError, TypeError, AttributeError, subprocess.SubprocessError):
        return None


_loaded_sessions = OrderedDict()
_session_lock = Lock()


def before_turn(user_message="", is_first_turn=False, session_id="", cwd=None, **kwargs):
    directory = working_directory(cwd)
    key = (session_id, directory)
    # A resumed session has history, but still needs its first context restore
    # in this process. Bound this lifecycle cache and never store tool results.
    with _session_lock:
        restore = is_first_turn or key not in _loaded_sessions
    context = run_hook("TurnStart", {
        "cwd": directory, "prompt": user_message, "session_start": restore,
    })
    if context:
        with _session_lock:
            _loaded_sessions[key] = True
            _loaded_sessions.move_to_end(key)
            while len(_loaded_sessions) > 128:
                _loaded_sessions.popitem(last=False)
    return {"context": context} if context else None


def after_tool(tool_name="", args=None, result=None, status="", cwd=None, **kwargs):
    if status == "error" or tool_name not in {"write_file", "patch"}:
        return None
    args = args if isinstance(args, dict) else {}
    # The watcher examines inserted text only, so it runs after the real tool.
    # No pre/post buffer is needed and concurrent sessions cannot mix findings.
    context = run_hook("PostToolUse", {
        "cwd": working_directory(cwd), "tool_name": tool_name,
        "tool_input": args, "status": status,
    })
    if not context:
        return None
    if isinstance(result, str):
        try:
            decoded = json.loads(result)
        except (ValueError, TypeError):
            decoded = None
        if isinstance(decoded, dict):
            # Preserve every original field, including an existing advisory.
            existing = decoded.get("omd_advisory")
            decoded["omd_advisory"] = [existing, context] if existing is not None else context
            return json.dumps(decoded, ensure_ascii=False)
        return result + "\n\n" + context
    return None


def after_turn(cwd=None, **kwargs):
    run_hook("Stop", {"cwd": working_directory(cwd)})


def register(ctx):
    from agent.skill_utils import parse_frontmatter

    ctx.register_hook("pre_llm_call", before_turn)
    ctx.register_hook("transform_tool_result", after_tool)
    ctx.register_hook("post_llm_call", after_turn)
    for name in SKILLS:
        skill = ROOT / "skills" / name / "SKILL.md"
        if not skill.is_file():
            continue
        frontmatter, body = parse_frontmatter(skill.read_text(encoding="utf-8"))
        description = frontmatter.get("description")
        if not isinstance(description, str) or not description.strip():
            description = next((line.strip() for line in body.splitlines()
                                if line.strip() and not line.startswith("#")), name)
        ctx.register_skill(name, skill, description, frontmatter)
    ctx.register_system_prompt_section(
        "omd.roles",
        "OMD skills are registered as omd:omd-<name>, not upstream aliases. "
        "Read bundled agent role prose when a workflow requests a role. "
        "Use native delegation if available, otherwise perform the role sequentially. "
        "Use read_file, write_file, and patch instead of unsupported Read/Edit/Write names. "
        "Ask the user in ordinary conversation if no question tool is available. "
        "DESIGN.md and pending .omd/preferences.md remain project authority.",
        max_chars=1600,
    )
