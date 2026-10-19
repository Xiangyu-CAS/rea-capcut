#!/usr/bin/env python3
"""Lazy local MCP proxy: discovery never starts the desktop editor."""
import json
import os
from pathlib import Path
import signal
import struct
import subprocess
import sys
import threading
import uuid

ROOT = Path(__file__).resolve().parent.parent
MAX_MESSAGE = 1024 * 1024


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


def editor_html():
    """Read only the fixed UI entry from the installed app, without executing it."""
    binary = Path(command()[0]).resolve()
    resources = binary.parent.parent / 'Resources' if sys.platform == 'darwin' else binary.parent / 'resources'
    archive = resources / 'app.asar'
    if not archive.is_file():
        file = resources / 'app/dist/plugin.html'
        if file.stat().st_size > 2 * 1024 * 1024:
            raise ValueError('UI resource too large')
        return file.read_text(encoding='utf-8')
    with archive.open('rb') as f:
        prefix = f.read(8)
        if len(prefix) != 8:
            raise ValueError('Invalid app archive')
        marker, header_size = struct.unpack('<II', prefix)
        if marker != 4 or not 8 <= header_size <= 32 * 1024 * 1024:
            raise ValueError('Invalid app archive header')
        header = f.read(header_size)
        if len(header) != header_size:
            raise ValueError('Truncated app archive')
        length = struct.unpack_from('<I', header, 4)[0]
        if length > header_size - 8:
            raise ValueError('Invalid app archive metadata')
        entry = json.loads(header[8:8 + length])['files']['dist']['files']['plugin.html']
        offset, size = int(entry['offset']), int(entry['size'])
        if entry.get('unpacked') or entry.get('link') or offset < 0 or not 0 < size <= 2 * 1024 * 1024:
            raise ValueError('Invalid UI resource entry')
        if 8 + header_size + offset + size > os.fstat(f.fileno()).st_size:
            raise ValueError('Truncated UI resource')
        f.seek(8 + header_size + offset)
        return f.read(size).decode('utf-8')


class Proxy:
    def __init__(self):
        self.metadata = json.loads((ROOT / 'protocol.json').read_text(encoding='utf-8'))
        self.child = None
        self.reader = None
        self.pending = set()
        self.lock = threading.RLock()
        self.init_id = 'reacut-internal-' + uuid.uuid4().hex
        self.initialization = {}

    def send(self, value):
        with self.lock:
            sys.stdout.write(json.dumps(value, ensure_ascii=False) + '\n')
            sys.stdout.flush()

    def result(self, request, data):
        self.send({'jsonrpc': '2.0', 'id': request['id'], 'result': data})

    def error(self, identifier, message, code=-32603):
        self.send({'jsonrpc': '2.0', 'id': identifier, 'error': {'code': code, 'message': message}})

    def read_child(self):
        for line in self.child.stdout:
            try:
                value = json.loads(line)
                if not isinstance(value, dict) or value.get('jsonrpc') != '2.0' or value.get('id') == self.init_id:
                    continue
            except (ValueError, UnicodeError):
                continue
            with self.lock:
                self.pending.discard(value.get('id'))
                self.send(value)
        with self.lock:
            for identifier in self.pending:
                self.error(identifier, 'Editor exited. Reconnect the plugin; do not replay uncertain edits.')
            self.pending.clear()

    def write_child(self, value):
        self.child.stdin.write((json.dumps(value) + '\n').encode('utf-8'))
        self.child.stdin.flush()

    def forward(self, request):
        if self.child is None:
            self.child = subprocess.Popen(command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                          stderr=sys.stderr, bufsize=0)
            self.reader = threading.Thread(target=self.read_child, daemon=True)
            self.reader.start()
            self.write_child({'jsonrpc': '2.0', 'id': self.init_id, 'method': 'initialize', 'params': self.initialization})
            self.write_child({'jsonrpc': '2.0', 'method': 'notifications/initialized'})
        if self.child.poll() is not None:
            raise RuntimeError('Editor exited. Reconnect the plugin; automatic relaunch is disabled.')
        with self.lock:
            self.pending.add(request['id'])
            try:
                self.write_child(request)
            except (BrokenPipeError, OSError):
                self.pending.discard(request['id'])
                raise RuntimeError('Editor disconnected. Read its state after reconnecting before retrying edits.')

    def handle(self, request):
        if not isinstance(request, dict) or request.get('jsonrpc') != '2.0':
            self.error(None, 'Invalid request', -32600)
            return
        if 'id' not in request:
            # Discovery notifications must never launch a GUI process.
            return
        identifier = request['id']
        if not isinstance(identifier, (str, int)) or isinstance(identifier, bool):
            self.error(None, 'Invalid request ID', -32600)
            return
        method, params = request.get('method'), request.get('params') or {}
        if not isinstance(params, dict):
            self.error(identifier, 'Invalid params', -32602)
            return
        if method == 'initialize':
            self.initialization = params
            version = params.get('protocolVersion')
            if version not in ('2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'):
                version = '2025-11-25'
            self.result(request, {'protocolVersion': version, 'capabilities': {'tools': {}, 'resources': {}},
                'serverInfo': {'name': 'reacut', 'version': self.metadata['version']},
                'instructions': 'Use reacut_open to open the editor. Discovery does not start ReaCut. Read state before edits. Import only user-selected media.'})
        elif method == 'ping':
            self.result(request, {})
        elif method == 'tools/list':
            self.result(request, {'tools': self.metadata['tools']})
        elif method == 'resources/list':
            self.result(request, {'resources': [self.metadata['resource']]})
        elif method == 'resources/templates/list':
            self.result(request, {'resourceTemplates': []})
        elif method == 'resources/read':
            resource = self.metadata['resource']
            if params.get('uri') != resource['uri']:
                self.error(identifier, 'Unknown resource', -32602)
            else:
                self.result(request, {'contents': [{**resource, 'text': editor_html()}]})
        elif method == 'tools/call':
            if params.get('name') not in {t['name'] for t in self.metadata['tools']}:
                self.error(identifier, 'Unknown tool', -32602)
            else:
                self.forward(request)
        else:
            self.error(identifier, 'Method not found', -32601)

    def close(self):
        if self.child is None:
            return
        try:
            self.child.stdin.close()
        except OSError:
            pass
        try:
            self.child.wait(timeout=8)
        except subprocess.TimeoutExpired:
            self.child.terminate()
            try:
                self.child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.child.kill()
                self.child.wait()
        if self.reader:
            self.reader.join(timeout=1)


def main():
    if '--check' in sys.argv:
        print(json.dumps({'ready': True, 'executable': command()[0], 'lazy': True}))
        return
    proxy = Proxy()
    def terminate(_signum, _frame):
        raise SystemExit(0)
    signal.signal(signal.SIGTERM, terminate)
    signal.signal(signal.SIGINT, terminate)
    try:
        while True:
            line = sys.stdin.buffer.readline(MAX_MESSAGE + 1)
            if not line:
                break
            if len(line) > MAX_MESSAGE:
                proxy.error(None, 'Request too large', -32600)
                break
            try:
                request = json.loads(line)
            except (ValueError, UnicodeError):
                proxy.error(None, 'Parse error', -32700)
                continue
            try:
                proxy.handle(request)
            except Exception as error:
                proxy.error(request.get('id') if isinstance(request, dict) else None, str(error))
    finally:
        proxy.close()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(f'ReaCut plugin: {error}', file=sys.stderr)
        sys.exit(1)
