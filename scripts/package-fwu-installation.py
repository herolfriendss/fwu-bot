#!/usr/bin/env python3
"""Group everything needed on the VPS into livraison/FWU_INSTALLATION_COMPLETE.zip."""
import stat, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "livraison" / "FWU_INSTALLATION_COMPLETE.zip"
fwu = sorted((ROOT / "livraison").glob("FWU_2*.zip"))[-1]
files = [fwu, *[ROOT / "livraison" / "bots" / f"FWU-{b}.zip" for b in ("GUARD", "FDPDLAVOC", "SUCK-ME", "LE-FISC", "INVEST-PLUS")],
         ROOT / "DEMARRAGE_FWU.md", *sorted((ROOT / "scripts" / "installation").iterdir())]
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as archive:
    for path in files:
        info = zipfile.ZipInfo.from_file(path, f"FWU-installation/{path.name}")
        info.compress_type = zipfile.ZIP_STORED if path.suffix == ".zip" else zipfile.ZIP_DEFLATED
        info.external_attr = ((0o755 if path.suffix == ".sh" else 0o644) | stat.S_IFREG) << 16
        archive.writestr(info, path.read_bytes())
with zipfile.ZipFile(OUT) as archive:
    assert archive.testzip() is None
    print("\n".join(archive.namelist()))
print(OUT, OUT.stat().st_size)
