"""Regression for discovery without GUI launch and one child per active session."""
import json
import os
from pathlib import Path
import plistlib
import select
import signal
import struct
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
LAUNCHER = ROOT / 'plugin/scripts/launch.py'


class LazyLauncher(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='reacut-launcher-test-')
        self.root = Path(self.temp.name)
        self.bundle = self.root / 'ReaCut.app'
        executable = self.bundle / 'Contents/MacOS/ReaCut'
        executable.parent.mkdir(parents=True)
        (self.bundle / 'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleShortVersionString': '0.5.1'}))
        self.starts = self.root / 'starts'
        executable.write_text('#!' + sys.executable + '\n' + '''
import json, os, sys
from pathlib import Path
with Path(os.environ['STARTS']).open('a') as f: f.write('started\\n')
for line in sys.stdin:
 r=json.loads(line)
 if 'id' not in r: continue
 if r.get('params',{}).get('arguments',{}).get('exit'): sys.exit(2)
 print(json.dumps({'jsonrpc':'2.0','id':r['id'],'result':{'pid':os.getpid()}}),flush=True)
Path(os.environ['STARTS']+'.closed').write_text('flushed')
''')
        executable.chmod(0o755)
        # A minimal valid ASAR with the one permitted bundled resource.
        html = b'<html>bundled editor</html>'
        header = json.dumps({'files': {'dist': {'files': {'plugin.html': {'size': len(html), 'offset': '0'}}}}}).encode()
        header_pickle = struct.pack('<II', len(header) + 4, len(header)) + header
        resources = self.bundle / 'Contents/Resources'
        resources.mkdir()
        self.archive = resources / 'app.asar'
        self.archive.write_bytes(struct.pack('<II', 4, len(header_pickle)) + header_pickle + html)
        self.proc = subprocess.Popen([sys.executable, str(LAUNCHER)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, env={**os.environ, 'REACUT_APP': str(self.bundle), 'STARTS': str(self.starts)})
        self.counter = 0

    def tearDown(self):
        if self.proc.poll() is None:
            self.proc.stdin.close()
            self.proc.wait(timeout=10)
        if not self.proc.stdin.closed:
            self.proc.stdin.close()
        self.proc.stdout.close()
        self.proc.stderr.close()
        self.temp.cleanup()

    def rpc(self, method, params=None):
        self.counter += 1
        self.proc.stdin.write((json.dumps({'jsonrpc':'2.0','id':self.counter,'method':method,'params':params or {}})+'\n').encode())
        self.proc.stdin.flush()
        self.assertTrue(select.select([self.proc.stdout],[],[],5)[0], 'RPC response timeout')
        response = json.loads(self.proc.stdout.readline())
        self.assertEqual(response['id'], self.counter)
        return response

    def test_discovery_and_resource_reads_never_launch_editor(self):
        for _ in range(3):
            for method in ['initialize','ping','tools/list','resources/list','resources/templates/list']:
                self.assertIn('result', self.rpc(method))
        resource = self.rpc('resources/read', {'uri':'ui://reacut/editor-v1.html'})
        self.assertEqual(resource['result']['contents'][0]['text'], '<html>bundled editor</html>')
        self.assertIn('error',self.rpc('tools/call',{'name':'not_a_tool'}))
        self.assertFalse(self.starts.exists())

    def test_first_tool_starts_once_and_disconnect_flushes(self):
        self.rpc('initialize')
        first=self.rpc('tools/call',{'name':'reacut_state'})
        second=self.rpc('tools/call',{'name':'reacut_state'})
        self.assertEqual(first['result']['pid'],second['result']['pid'])
        self.assertEqual(self.starts.read_text(),'started\n')
        self.proc.stdin.close()
        self.assertEqual(self.proc.wait(timeout=10),0)
        self.assertEqual(Path(str(self.starts)+'.closed').read_text(),'flushed')

    def test_sigterm_flushes_child(self):
        self.rpc('tools/call',{'name':'reacut_state'})
        self.proc.send_signal(signal.SIGTERM)
        self.assertEqual(self.proc.wait(timeout=10),0)
        self.assertEqual(Path(str(self.starts)+'.closed').read_text(),'flushed')

    def test_failed_child_is_not_restarted(self):
        self.assertIn('error',self.rpc('tools/call',{'name':'reacut_state','arguments':{'exit':True}}))
        self.assertIn('error',self.rpc('tools/call',{'name':'reacut_state'}))
        self.assertEqual(self.starts.read_text(),'started\n')

    def test_malformed_resource_is_rejected_without_start(self):
        self.archive.write_bytes(b'invalid archive')
        self.assertIn('error',self.rpc('resources/read',{'uri':'ui://reacut/editor-v1.html'}))
        self.assertFalse(self.starts.exists())

    def test_missing_app_does_not_break_discovery(self):
        (self.bundle / 'Contents/MacOS/ReaCut').unlink()
        self.assertEqual(len(self.rpc('tools/list')['result']['tools']),9)
        self.assertIn('error',self.rpc('tools/call',{'name':'reacut_open'}))
        self.assertFalse(self.starts.exists())


if __name__ == '__main__': unittest.main()
