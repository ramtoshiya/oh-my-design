"""Run the native Hermes tests with its already installed runtime."""

import json
import os
from pathlib import Path
import subprocess
import sys


def main():
    try:
        command = json.loads(subprocess.check_output(
            ["hermes", "--print-runtime-command"], text=True, timeout=20,
        ))
        code_index = command.index("-c") + 1
        entry = "runpy.run_module('hermes_cli.main', run_name='__main__', alter_sys=True)"
        if entry not in command[code_index]:
            raise ValueError("Unrecognized Hermes runtime entry point")
        command[code_index] = command[code_index].replace(
            entry,
            "sys.argv = sys.argv[1:]; runpy.run_path(sys.argv[0], run_name='__main__')",
            1,
        )
        command += [str(Path(__file__).with_name("hooks_hermes_test.py")), *(sys.argv[1:] or ["-v"])]
        return subprocess.run(command, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}).returncode
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"Cannot run native Hermes tests: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
