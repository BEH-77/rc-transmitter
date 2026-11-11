#!/usr/bin/env python3
"""Real Linux serial bench verification. Never sends ENABLE or active RC values.

Requires a physically isolated Uno, matching sysfs USB identity and serial number.
Results reflect received firmware reports, not physical pulse measurements.
"""
import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import select
import subprocess
import termios
import time

SAFE = '1500,1500,1000,1500'
CASES = [
    ('Center', '1500,1500,1500,1500'),
    ('Roll', '1700,1500,1500,1500'),
    ('Pitch', '1500,1300,1500,1500'),
    ('Throttle', '1500,1500,1800,1500'),
    ('Yaw', '1500,1500,1500,1600'),
    ('Combined', '1700,1300,1800,1600'),
]


def identity(port):
    name = Path(port).resolve().name
    node = (Path('/sys/class/tty') / name / 'device').resolve()
    for parent in [node, *node.parents]:
        if (parent / 'idVendor').exists():
            return {key: (parent / key).read_text().strip() if (parent / key).exists() else ''
                    for key in ('idVendor', 'idProduct', 'manufacturer', 'serial')}
    raise RuntimeError('Cannot establish USB identity from sysfs; refusing to open device')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', required=True)
    parser.add_argument('--expected-usb-serial', required=True)
    parser.add_argument('--confirm-bench-isolated', action='store_true',
                        help='Confirm KK, ESCs, motors, propellers are disconnected and other serial apps closed')
    parser.add_argument('--report', default='/tmp/rc-real-hardware-report.json')
    args = parser.parse_args()
    if not args.confirm_bench_isolated:
        parser.error('Physical bench isolation and closing all other serial applications must be confirmed')
    board = identity(args.port)
    if (board['idVendor'], board['idProduct'], board['serial']) != ('2341', '0043', args.expected_usb_serial):
        raise RuntimeError(f'Unexpected USB identity {board}; refusing to send commands')

    events, results = [], []
    fd, exclusive, ready = None, False, False
    buffer = b''
    failure = None

    def record(direction, text):
        event = {'time': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                 'direction': direction, 'text': text}
        events.append(event)
        print(event['time'], direction, text, flush=True)

    def receive(duration):
        nonlocal buffer
        lines = []
        deadline = time.monotonic() + duration
        while time.monotonic() < deadline:
            ready, _, _ = select.select([fd], [], [], max(0, deadline - time.monotonic()))
            if not ready:
                continue
            try:
                chunk = os.read(fd, 4096)
            except BlockingIOError:
                continue
            if not chunk:
                raise RuntimeError('Serial disconnected or stream ended')
            buffer += chunk
            if len(buffer) > 8192:
                raise RuntimeError('Unbounded response without line framing')
            while b'\n' in buffer:
                line, buffer = buffer.split(b'\n', 1)
                text = line.decode('ascii', errors='replace').strip()
                if text:
                    record('RX', text)
                    lines.append(text)
                    if text == 'STATE,ACTIVE':
                        raise RuntimeError('Unexpected ACTIVE state; stopping test')
                    if text.startswith('ACK,') and text != 'ACK,' + SAFE:
                        raise RuntimeError('Firmware reports unsafe applied tuple; stopping test')
        return lines

    def send(line):
        # Defense against accidentally turning the bench runner into an actuator.
        if line == 'ENABLE' or (line.startswith('RC,') and line != 'RC,' + SAFE
                               and line not in ('RC,999,1500,1000,1500', 'RC,1500,1500')):
            raise RuntimeError('Test policy prohibits active RC or ENABLE')
        data = (line + '\n').encode('ascii')
        offset = 0
        deadline = time.monotonic() + 1
        while offset < len(data):
            if time.monotonic() > deadline:
                raise RuntimeError('Serial write timeout')
            _, writable, _ = select.select([], [fd], [], 0.1)
            if writable:
                try:
                    offset += os.write(fd, data[offset:])
                except BlockingIOError:
                    pass
        record('TX', line)

    def check(name, command, expected, duration=0.07):
        send(command)
        responses = receive(duration)
        missing = [item for item in expected if item not in responses]
        passed = not missing
        results.append({'test': name, 'pass': passed, 'responses': responses, 'missing': missing})
        if missing:
            raise AssertionError(f'{name}: missing {missing}; received {responses}')

    def reset():
        check('Reset stays SAFE', 'RESET,' + SAFE, ['STATE,SAFE', 'ACK,' + SAFE])

    try:
        owner = subprocess.run(['fuser', args.port], capture_output=True, text=True, timeout=5)
        if owner.returncode == 0:
            raise RuntimeError(f'Port is already open by process(es) {owner.stdout.strip()}; close serial programs first')
        if owner.returncode != 1:
            raise RuntimeError(f'Cannot establish port ownership: {owner.stderr.strip()}')
        fd = os.open(args.port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.ioctl(fd, termios.TIOCEXCL)
        exclusive = True
        attrs = termios.tcgetattr(fd)
        attrs[0] = attrs[1] = attrs[3] = 0
        attrs[2] = termios.CLOCAL | termios.CREAD | termios.CS8
        attrs[4] = attrs[5] = termios.B115200
        attrs[6][termios.VMIN] = 0
        attrs[6][termios.VTIME] = 0
        termios.tcsetattr(fd, termios.TCSANOW, attrs)
        ready = True
        record('SYS', f'Real port {args.port}, identity {board}, 115200 8N1; ENABLE prohibited')
        receive(2.2)  # Allow bootloader/automatic USB reset, not a joystick UI delay.
        check('Initial STOP', 'STOP', ['STATE,STOPPED', 'ACK,' + SAFE])
        reset()
        check('Safe RC', 'RC,' + SAFE, ['ACK,' + SAFE])
        for name, values in CASES:
            check('Safe heartbeat', 'RC,' + SAFE, ['ACK,' + SAFE])
            check(name + ' preview', 'PREVIEW,' + values, ['PREVIEW_ACK,' + values])
            check(name + ' applied report unchanged', 'RC,' + SAFE, ['ACK,' + SAFE])

        for command, response in [
            ('INVALID', 'ERR,UNKNOWN_COMMAND'),
            ('PREVIEW,999,1500,1500,1500', 'ERR,INVALID_PREVIEW'),
            ('PREVIEW,1500,1500,2001,1500', 'ERR,INVALID_PREVIEW'),
            ('PREVIEW,1500,1500,1500', 'ERR,INVALID_PREVIEW'),
            ('RC,999,1500,1000,1500', 'ERR,INVALID_RC'),
            ('RC,1500,1500', 'ERR,INVALID_RC'),
            ('X' * 80, 'ERR,OVERFLOW'),
        ]:
            reset()
            check('Reject ' + command, command, [response])

        reset()
        # Deliberately split a line; no ACK is allowed before newline.
        os.write(fd, b'PREVIEW,1700,')
        record('TX_PARTIAL', 'PREVIEW,1700,')
        lines = receive(0.05)
        assert not any(x.startswith('PREVIEW_ACK,') for x in lines), lines
        os.write(fd, b'1300,1800,1600\n')
        record('TX_PARTIAL', '1300,1800,1600\\n')
        lines = receive(0.07)
        assert 'PREVIEW_ACK,1700,1300,1800,1600' in lines, lines
        results.append({'test': 'Fragmented command', 'pass': True, 'responses': lines})

        reset()
        check('Safe RC before watchdog', 'RC,' + SAFE, ['ACK,' + SAFE])
        watchdog_lines = []
        for _ in range(12):
            send('PREVIEW,1700,1300,1800,1600')
            watchdog_lines.extend(receive(0.05))
        assert 'STATE,FAILSAFE' in watchdog_lines and 'ACK,' + SAFE in watchdog_lines, watchdog_lines
        results.append({'test': 'Preview does not refresh watchdog; FAILSAFE at idle RC',
                        'pass': True, 'responses': watchdog_lines})
        check('Preview in FAILSAFE', 'PREVIEW,1700,1300,1800,1600', ['PREVIEW_ACK,1700,1300,1800,1600'])
        check('FAILSAFE remains latched', 'RC,' + SAFE, ['ERR,LATCHED'])
        check('Emergency STOP', 'STOP', ['STATE,STOPPED', 'ACK,' + SAFE])
        check('Preview in STOPPED', 'PREVIEW,1700,1300,1800,1600', ['PREVIEW_ACK,1700,1300,1800,1600'])
        check('STOP remains latched', 'RC,' + SAFE, ['ERR,LATCHED'])
        reset()
        check('Safe recovery heartbeat', 'RC,' + SAFE, ['ACK,' + SAFE])
    except (Exception, KeyboardInterrupt) as error:
        failure = f'{type(error).__name__}: {error}'
        results.append({'test': 'Run completion', 'pass': False, 'error': failure})
        print(failure, flush=True)
    finally:
        if fd is not None:
            if ready:
                try:
                    send('STOP')
                    final_lines = receive(0.1)
                    assert 'STATE,STOPPED' in final_lines and 'ACK,' + SAFE in final_lines, final_lines
                    results.append({'test': 'Final STOP confirmation', 'pass': True, 'responses': final_lines})
                except Exception as error:
                    failure = failure or f'Final STOP unconfirmed: {error}'
                    results.append({'test': 'Final STOP confirmation', 'pass': False, 'error': str(error)})
                    record('SYS', f'Final STOP unconfirmed: {error}; rely on independent watchdog')
            if exclusive:
                try:
                    fcntl.ioctl(fd, termios.TIOCNXCL)
                except OSError:
                    pass
            os.close(fd)
            record('SYS', 'Serial descriptor closed; browser may now request the port')
        report = {'physical_usb_attempt': fd is not None, 'board': board, 'port': args.port,
                  'results': results, 'events': events, 'pass': failure is None,
                  'pulse_measurement': 'NOT PERFORMED', 'enable_sent': False}
        Path(args.report).write_text(json.dumps(report, indent=2) + '\n')
    if failure:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
