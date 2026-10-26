"""Local Blender construction transport: installed MCP add-on or isolated CLI.

The socket is the official Blender MCP add-on's localhost transport, not a new
MCP protocol server. It executes only this repository's deterministic builder.
"""
import argparse
import json
import os
import socket
import subprocess
import sys
from pathlib import Path


def request(command, timeout=120):
    with socket.create_connection(('127.0.0.1', 9876), timeout=3) as client:
        client.settimeout(timeout)
        client.sendall(json.dumps(command).encode('utf-8'))
        buffer = b''
        while True:
            chunk = client.recv(65536)
            if not chunk:
                raise ConnectionError('Blender MCP closed the connection before responding')
            buffer += chunk
            if len(buffer) > 8 * 1024 * 1024:
                raise RuntimeError('Blender response exceeds the local bridge limit')
            try:
                value = json.loads(buffer)
            except json.JSONDecodeError:
                continue
            if value.get('status') != 'success':
                raise RuntimeError(value.get('message', 'Blender MCP request failed'))
            return value.get('result')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--scene')
    parser.add_argument('--out')
    parser.add_argument('--transport', choices=['auto', 'mcp', 'cli'], default='auto')
    parser.add_argument('--health', action='store_true')
    parser.add_argument('--skip-render', action='store_true')
    parser.add_argument('--timeout', type=int, default=300)
    args = parser.parse_args()
    if not 60 <= args.timeout <= 720:
        parser.error('--timeout must be between 60 and 720 seconds')
    available = False
    socket_connected = False
    unavailable_reason = None
    if args.transport != 'cli':
        try:
            request({'type': 'get_scene_info', 'params': {}}, timeout=8)
            socket_connected = True
            # This trusted probe only reads the session marker. An arbitrary
            # Blender MCP listener must never authorize clearing its scene.
            probe = request({'type': 'execute_code', 'params': {'code':
                'import json\nprint(json.dumps({"managed": bpy.app.driver_namespace.get("listing2living_managed_session") is True}))'}}, timeout=8)
            marker = json.loads(probe.get('result', '')) if isinstance(probe, dict) else {}
            if marker.get('managed') is not True:
                raise RuntimeError('The Blender MCP listener is not a task-owned Listing2Living session; its scene will not be modified')
            available = True
        except (OSError, RuntimeError, ConnectionError, ValueError, AttributeError) as exc:
            unavailable_reason = str(exc)
            if args.transport == 'mcp':
                raise RuntimeError('Blender MCP is not ready: ' + str(exc))
    if args.health:
        print(json.dumps({'mcpConnected': available, 'socketConnected': socket_connected,
                          'managedSession': available, 'host': '127.0.0.1', 'port': 9876,
                          'transport': 'mcp' if available else 'cli', 'reason': unavailable_reason}))
        return
    if not args.scene or not args.out:
        parser.error('--scene and --out are required for a build')
    builder = Path(__file__).with_name('build_scene.py').resolve()
    scene, out = str(Path(args.scene).resolve()), str(Path(args.out).resolve())
    build_args = ['--scene', scene, '--out', out]
    if args.skip_render:
        build_args.append('--skip-render')
    if available:
        argv = ['blender', '--'] + build_args + ['--keep-session']
        code = ('import sys, runpy\n'
                'assert bpy.app.driver_namespace.get("listing2living_managed_session") is True, "Refusing to modify an unmanaged Blender session"\n'
                f'sys.argv = {argv!r}\nrunpy.run_path({str(builder)!r}, run_name="__main__")')
        request({'type': 'execute_code', 'params': {'code': code}}, timeout=args.timeout)
        transport = 'mcp'
    else:
        exe = os.environ.get('BLENDER_PATH', r'C:\Program Files\Blender Foundation\Blender 5.0\blender.exe')
        process = subprocess.run([exe, '--background', '--python', str(builder), '--'] + build_args,
                                 capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=args.timeout)
        if process.returncode:
            raise RuntimeError('Blender CLI failed: ' + (process.stderr or process.stdout)[-1500:])
        transport = 'cli'
    report = json.loads((Path(out) / 'build-report.json').read_text(encoding='utf-8'))
    report['transport'] = transport
    (Path(out) / 'build-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'ok': True, 'transport': transport, 'sceneId': report['sceneId'],
                      'revision': report['revision'], 'elapsedSeconds': report['elapsedSeconds']}))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'ok': False, 'error': str(exc)}), file=sys.stderr)
        sys.exit(1)
