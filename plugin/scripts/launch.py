#!/usr/bin/env python3
"""Launch the installed local editor as an MCP stdio service. No network or telemetry."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading


def command():
    configured = os.environ.get('REACUT_APP')
    config = Path.home() / '.config' / 'reacut' / 'plugin.json'
    if not configured and config.is_file():
        configured = json.loads(config.read_text()).get('app')
    candidates = [Path(configured).expanduser()] if configured else [
        Path('/Applications/ReaCut.app'), Path.home() / 'Applications/ReaCut.app']
    for candidate in candidates:
        binary = candidate / 'Contents/MacOS/ReaCut' if candidate.suffix == '.app' else candidate
        if binary.is_file() and os.access(binary, os.X_OK):
            if candidate.suffix == '.app':
                import plistlib
                with (candidate / 'Contents/Info.plist').open('rb') as f:
                    version = plistlib.load(f).get('CFBundleShortVersionString', '0')
                if tuple(int(v) for v in version.split('.')[:2]) < (0, 5):
                    raise RuntimeError('ReaCut 0.5.0 or newer is required. Install the matching DMG first.')
            return [str(binary), '--reacut-plugin']
    raise RuntimeError('Install ReaCut 0.5.0+ in /Applications, or run install-plugin.sh --app /absolute/path/ReaCut.app.')


def main():
    try:
        args = command()
        if '--check' in sys.argv:
            print(json.dumps({'ready': True, 'executable': args[0]}))
            return
        child = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=sys.stderr, bufsize=0)
        def terminate(_signum, _frame):
            if child.poll() is None:
                child.terminate()
        signal.signal(signal.SIGTERM, terminate)
        signal.signal(signal.SIGINT, terminate)
        def forward_input():
            try:
                for line in sys.stdin.buffer:
                    child.stdin.write(line)
                    child.stdin.flush()
            except (BrokenPipeError, OSError):
                pass
            finally:
                child.stdin.close()
        threading.Thread(target=forward_input, daemon=True).start()
        try:
            for line in child.stdout:
                # Electron diagnostics must never corrupt the MCP stdio stream.
                try:
                    value = json.loads(line)
                    if value.get('jsonrpc') != '2.0':
                        continue
                except (ValueError, AttributeError):
                    continue
                sys.stdout.buffer.write(line)
                sys.stdout.buffer.flush()
            child.wait()
        finally:
            if child.poll() is None:
                child.terminate()
    except Exception as error:
        print(f'ReaCut plugin: {error}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
