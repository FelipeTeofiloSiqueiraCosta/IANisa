"""Consistent online SQLite copies; originals are never opened for writing."""
import hashlib
import json
import os
import sqlite3
import stat
import time
from contextlib import closing
from pathlib import Path


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def snapshot_roots(roots, target, excludes=()):
    target = Path(target).absolute()
    target.mkdir(mode=0o700, parents=True, exist_ok=False)
    excluded = [Path(p).absolute() for p in excludes] + [target]
    manifest = []
    seen = set()

    def skip(path):
        return any(path == p or p in path.parents for p in excluded)

    def walk_error(error):
        raise error

    for root in roots:
        root = Path(root).absolute()
        device = root.stat().st_dev
        for directory, dirs, files in os.walk(root, followlinks=False, onerror=walk_error):
            parent = Path(directory)
            dirs[:] = sorted(d for d in dirs if not skip(parent / d)
                             and not (parent / d).is_symlink()
                             and (parent / d).stat().st_dev == device)
            for name in sorted(files):
                source = parent / name
                if skip(source) or source in seen:
                    continue
                seen.add(source)
                try:
                    meta = source.lstat()
                    if not stat.S_ISREG(meta.st_mode) or meta.st_size < 16:
                        continue
                    with source.open('rb') as stream:
                        if stream.read(16) != b'SQLite format 3\x00':
                            continue
                except FileNotFoundError:
                    # A file that vanished before identification has no stable data to copy.
                    continue
                relative = Path('files') / source.relative_to('/')
                copy = target / relative
                copy.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                deadline = time.monotonic() + 120

                def progress(status, remaining, total):
                    if time.monotonic() > deadline:
                        raise TimeoutError(f'SQLite backup exceeded 120s: {source}')

                # as_uri quotes ?, # and spaces. Do not use immutable=1: it ignores WAL.
                with closing(sqlite3.connect(source.as_uri() + '?mode=ro', uri=True, timeout=30)) as src:
                    with closing(sqlite3.connect(copy)) as dst:
                        src.backup(dst, pages=256, progress=progress, sleep=0.05)
                        checks = [row[0] for row in dst.execute('pragma integrity_check')]
                        if checks != ['ok']:
                            raise sqlite3.DatabaseError(f'Integrity check failed for {source}')
                        dst.execute('pragma journal_mode=delete')
                copy.chmod(0o600)
                manifest.append({'source': str(source), 'copy': str(relative),
                                 'uid': meta.st_uid, 'gid': meta.st_gid,
                                 'mode': stat.S_IMODE(meta.st_mode),
                                 'sha256': sha256(copy), 'bytes': copy.stat().st_size})
    output = target / 'manifest.json'
    output.write_text(json.dumps(manifest, indent=2) + '\n')
    output.chmod(0o600)
    return manifest
