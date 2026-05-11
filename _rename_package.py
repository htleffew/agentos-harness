r"""
Step 0b: Rename distributable_harness → agentos_harness throughout the codebase.
- Rename src/distributable_harness/ → src/agentos_harness/
- Update all internal imports
- Update pyproject.toml (name, version, entry point)
- Update any string references in source files

Run from: C:\Users\drhea\repos\Pm_html\agentos-harness\
"""

import os
import shutil
from pathlib import Path

ROOT = Path(__file__).parent
SRC_OLD = ROOT / "src" / "distributable_harness"
SRC_NEW = ROOT / "src" / "agentos_harness"

OLD_PKG = "distributable_harness"
NEW_PKG = "agentos_harness"
OLD_NAME = "distributable-harness"
NEW_NAME = "agentos-harness"
NEW_VERSION = "0.7.0"

# ── 1. Rename the source directory ───────────────────────────────────────────

if SRC_OLD.exists() and not SRC_NEW.exists():
    shutil.copytree(SRC_OLD, SRC_NEW)
    shutil.rmtree(SRC_OLD)
    print(f"Renamed {SRC_OLD.name} → {SRC_NEW.name}")
elif SRC_NEW.exists():
    print(f"  {SRC_NEW.name} already exists, skipping rename")
else:
    print(f"ERROR: {SRC_OLD} not found", flush=True)

# ── 2. Update imports inside the new package ─────────────────────────────────

py_files = list(SRC_NEW.rglob("*.py"))
# Also update test files
py_files += list((ROOT / "tests").rglob("*.py"))

changed = 0
for f in py_files:
    text = f.read_text(encoding="utf-8")
    new_text = text.replace(
        f"from {OLD_PKG}", f"from {NEW_PKG}"
    ).replace(
        f"import {OLD_PKG}", f"import {NEW_PKG}"
    ).replace(
        f"from .{OLD_PKG}", f"from .{NEW_PKG}"  # shouldn't exist but safety
    )
    # Also replace string references like "distributable_harness" in test assertions
    new_text = new_text.replace(
        f'"{OLD_PKG}"', f'"{NEW_PKG}"'
    ).replace(
        f"'{OLD_PKG}'", f"'{NEW_PKG}'"
    )
    if new_text != text:
        f.write_text(new_text, encoding="utf-8")
        changed += 1
        print(f"  Updated imports: {f.relative_to(ROOT)}")

print(f"Updated imports in {changed} files")

# ── 3. Update pyproject.toml ─────────────────────────────────────────────────

pyproject = ROOT / "pyproject.toml"
text = pyproject.read_text(encoding="utf-8")

text = text.replace(
    f'name = "{OLD_NAME}"', f'name = "{NEW_NAME}"'
).replace(
    f'version = "0.6.3"', f'version = "{NEW_VERSION}"'
).replace(
    f'"distributable_harness"', f'"{NEW_PKG}"'
).replace(
    f'harness = "{OLD_PKG}.cli:main"', f'harness = "{NEW_PKG}.cli:main"'
).replace(
    # Update description
    "Local developer harness analyzer, core-profile generator, and dashboard.",
    "Local developer harness (agentos-harness v2): analyzer, generator, and agentic-OS dashboard.",
)

pyproject.write_text(text, encoding="utf-8")
print("Updated pyproject.toml")

# ── 4. Update PACKAGE_NAME constant in config.py ─────────────────────────────

config_py = SRC_NEW / "config.py"
if config_py.exists():
    text = config_py.read_text(encoding="utf-8")
    new_text = text.replace(
        f'PACKAGE_NAME = "{OLD_NAME}"',
        f'PACKAGE_NAME = "{NEW_NAME}"',
    ).replace(
        f"PACKAGE_NAME = '{OLD_NAME}'",
        f"PACKAGE_NAME = '{NEW_NAME}'",
    )
    if new_text != text:
        config_py.write_text(new_text, encoding="utf-8")
        print("Updated PACKAGE_NAME in config.py")

print("\nDone. Next: pip uninstall distributable-harness && pip install -e .")
