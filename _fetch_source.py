r"""
One-shot script: download distributable-harness source from Spokeo/atlas
into the current directory (agentos-harness/), stripping the
'distributable-harness/' prefix. Uses `gh api` for auth.

Run from: C:\Users\drhea\repos\Pm_html\agentos-harness\
"""

import base64
import json
import os
import subprocess
import sys
from pathlib import Path

REPO = "Spokeo/atlas"
REMOTE_PREFIX = "distributable-harness/"
LOCAL_ROOT = Path(__file__).parent

# Files/dirs to skip (already exists or not wanted)
SKIP_PREFIXES = (
    "distributable-harness/dist/",          # prebuilt wheels, regenerate locally
    "distributable-harness/.claude/",       # repo-internal claude state, not source
)
SKIP_EXACT = {
    "distributable-harness/AGENTIC-OS-DASHBOARD-SPEC.md",  # already here
}

def gh_api(path: str) -> dict | list:
    result = subprocess.run(
        ["gh", "api", path],
        capture_output=True, text=True, check=True
    )
    return json.loads(result.stdout)


def fetch_blob(path: str) -> bytes:
    """Fetch a single file's content via gh api, return raw bytes."""
    data = gh_api(f"repos/{REPO}/contents/{path}")
    if isinstance(data, dict) and data.get("encoding") == "base64":
        return base64.b64decode(data["content"])
    raise ValueError(f"Unexpected response for {path}: {data.get('encoding')}")


def get_all_blobs(tree_sha: str = "main") -> list[dict]:
    data = gh_api(f"repos/{REPO}/git/trees/{tree_sha}?recursive=1")
    return [
        item for item in data["tree"]
        if item["type"] == "blob"
        and item["path"].startswith(REMOTE_PREFIX)
        and not any(item["path"].startswith(s) for s in SKIP_PREFIXES)
        and item["path"] not in SKIP_EXACT
    ]


def main():
    print(f"Fetching file tree from {REPO}...")
    blobs = get_all_blobs()
    print(f"  {len(blobs)} files to download")

    for i, blob in enumerate(blobs, 1):
        remote_path = blob["path"]
        local_rel = remote_path[len(REMOTE_PREFIX):]   # strip prefix
        local_path = LOCAL_ROOT / local_rel

        local_path.parent.mkdir(parents=True, exist_ok=True)

        if local_path.exists():
            print(f"  [{i}/{len(blobs)}] SKIP (exists): {local_rel}")
            continue

        try:
            content = fetch_blob(remote_path)
            local_path.write_bytes(content)
            print(f"  [{i}/{len(blobs)}] OK: {local_rel}")
        except Exception as exc:
            print(f"  [{i}/{len(blobs)}] ERROR {local_rel}: {exc}", file=sys.stderr)

    print("Done.")


if __name__ == "__main__":
    main()
