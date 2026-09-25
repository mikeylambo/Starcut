#!/usr/bin/env python3
"""Best-effort bootstrap for the official img2threejs checkout."""
from __future__ import annotations
import argparse
import pathlib
import subprocess
import sys

UPSTREAM = "https://github.com/img2threejs/img2threejs.git"

def run(cmd):
    print("+", " ".join(map(str, cmd)))
    return subprocess.run(cmd, check=True)

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dest", default=".slu-tools/img2threejs")
    args = p.parse_args()
    dest = pathlib.Path(args.dest)

    if dest.exists() and (dest / "SKILL.md").exists():
        try:
            run(["git", "-C", str(dest), "pull", "--ff-only"])
        except Exception:
            print("Existing checkout found; update failed, continuing with installed copy.", file=sys.stderr)
        print(dest.resolve())
        return

    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        run(["git", "clone", "--depth", "1", UPSTREAM, str(dest)])
    except Exception as exc:
        print(
            "Could not bootstrap img2threejs with git. Use the host's GitHub/browser capability "
            "to obtain https://github.com/img2threejs/img2threejs, then rerun.",
            file=sys.stderr,
        )
        raise SystemExit(2) from exc
    print(dest.resolve())

if __name__ == "__main__":
    main()
