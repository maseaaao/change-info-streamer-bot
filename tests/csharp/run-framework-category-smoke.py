"""Compile/run backend smoke with installed .NET Framework, isolated in Hermes scratch."""
import os
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
scratch = Path(os.environ["TMPDIR"]) / "category-search-verify"
scratch.mkdir(parents=True, exist_ok=True)
framework = Path(os.environ.get("WINDIR", "C:/Windows")) / "Microsoft.NET/Framework64/v4.0.30319"
compiler = framework / "csc.exe"
if not compiler.is_file():
    raise SystemExit("Installed .NET Framework compiler is unavailable; smoke was not run.")

files = ["category-search-policy.cs", "category-search-service.cs", "category-search-transport.cs"]
for name in files:
    shutil.copyfile(root / "streamerbot" / name, scratch / name)
shutil.copyfile(root / "tests/csharp/FrameworkCategorySmoke.cs", scratch / "FrameworkCategorySmoke.cs")
reference = "/r:" + str(framework / "System.Net.Http.dll")
commands = [
    [str(compiler), "/nologo", "/target:library", "/out:backend.dll", reference, *files],
    [str(compiler), "/nologo", "/target:exe", "/out:smoke.exe", "/r:backend.dll", reference, "FrameworkCategorySmoke.cs"],
    [str(scratch / "smoke.exe")],
]
for command in commands:
    result = subprocess.run(command, cwd=scratch, capture_output=True)
    for output in (result.stdout, result.stderr):
        if output:
            print(output.decode("cp866", errors="replace").strip())
    if result.returncode:
        raise SystemExit(result.returncode)
print("Framework compilation and smoke execution exit: 0 (scratch only; no live app/data changes).")
