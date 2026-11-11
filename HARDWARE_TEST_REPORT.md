# Real-hardware verification status

Hardware objective is **blocked, not completed**. No physical serial commands were sent, no firmware was uploaded, and no pulses were measured during this session.

## Detection

Host sysfs exposes USB device `3-6`, manufacturer `Arduino (www.arduino.cc)`, VID/PID `2341:0043`, USB serial `8573531383235161C0D0`. The locally installed Arduino AVR board definitions map that identity to Arduino Uno / ATmega328P. Its `cdc_acm` interface maps to `ttyACM0`, device number `166:0`.

The agent's restricted `/dev` has no `/dev/ttyACM0`, no `/dev/serial/by-id`, and no `/dev/bus/usb`. `lsusb` returns `unable to initialize libusb: -99`. Arduino CLI discovery returns `Cannot START_SYNC: operation not permitted`. Port ownership and host Unix permissions could not be determined: `fuser` could not open its socket and both `fuser` and `lsof` reported the missing device path. This is an execution-environment device-exposure restriction; it is not evidence that the host user needs a group change.

## Toolchain and compilation

The tools are installed outside PATH:

- `/opt/arduino-ide/resources/app/lib/backend/resources/arduino-cli` version 1.5.1
- Arduino AVR core 1.8.8 in `~/.arduino15/packages/arduino/hardware/avr/1.8.8`
- Bundled AVR GCC and avrdude in `~/.arduino15/packages/arduino/tools/`
- Servo library in `~/.arduino15/libraries/Servo`

The current sketch compiled successfully using:

```bash
/opt/arduino-ide/resources/app/lib/backend/resources/arduino-cli compile \
  --fqbn arduino:avr:uno --build-path /tmp/rc-hardware-uno-build \
  --libraries /home/beh-77/.arduino15/libraries arduino/kk_receiver_simulator
```

Uploader was not run. Compile output: 4,662 bytes flash / 32,256; 373 bytes global RAM / 2,048, leaving 1,675 bytes. This does not establish what firmware is currently on the connected board.

## Actual USB test matrix

| Case | Planned command | Actual response | Result |
|---|---|---|---|
| Center | `PREVIEW,1500,1500,1500,1500` | None: not sent | BLOCKED |
| Roll | `PREVIEW,1700,1500,1500,1500` | None: not sent | BLOCKED |
| Pitch | `PREVIEW,1500,1300,1500,1500` | None: not sent | BLOCKED |
| Throttle | `PREVIEW,1500,1500,1800,1500` | None: not sent | BLOCKED |
| Yaw | `PREVIEW,1500,1500,1500,1600` | None: not sent | BLOCKED |
| Combined | `PREVIEW,1700,1300,1800,1600` | None: not sent | BLOCKED |

Real safe RC, reset, failsafe, STOP, invalid-message, USB reset, reconnect, and browser-to-Arduino tests are also BLOCKED. No real TX/RX transcript exists for this session.

## Executed software checks

- Vitest: 25 tests passed.
- ESLint: passed.
- TypeScript and production build: passed.
- Host C++ sketch tests with stubbed Servo/Serial: passed, using `-Wall -Wextra`.
- Frontend protocol to host-compiled sketch integration: 27 steps passed through the documented file-based runner.
- Actual Uno target compilation: passed as above.
- Chromium joystick and mock-serial scripts: attempted, blocked by `connect EPERM 127.0.0.1:9224`.
- Vite server startup: attempted, blocked by `listen EPERM 127.0.0.1:4182`.
- New hardware-runner `--help` and Python syntax check: passed. The runner itself has NOT been exercised against hardware.

Host/stub tests are not physical USB tests. The source and host tests confirm preview never calls the Servo setters or refreshes the control watchdog; physical outputs still require measurement.

## Required user action on the host

First confirm: this is the intended Uno, and KK V5.5, ESCs, motors and propellers are disconnected. Close Arduino Serial Monitor, other serial terminals, and any connected browser tab. Do not click Enable during initial tests.

Run these in a normal host terminal, outside the agent's restricted environment:

```bash
cd /home/beh-77/rc-transmitter
ls -l /dev/ttyACM* /dev/ttyUSB* /dev/serial/by-id/* 2>/dev/null
cat /sys/bus/usb/devices/3-6/idVendor /sys/bus/usb/devices/3-6/idProduct /sys/bus/usb/devices/3-6/serial
stat -c '%A %U %G' /dev/ttyACM0
fuser -v /dev/ttyACM0
```

Confirm VID `2341`, PID `0043`, serial `8573531383235161C0D0`, and actual device mapping. Recheck mapping if unplugged/replugged. If it differs, stop and identify it before upload. `fuser` normally exits 1 with no output when no owner is found.

Only after physical confirmation and identity checks, compile on the host and upload with verification:

```bash
/opt/arduino-ide/resources/app/lib/backend/resources/arduino-cli compile \
  --fqbn arduino:avr:uno --build-path /tmp/rc-hardware-uno-build \
  --libraries /home/beh-77/.arduino15/libraries arduino/kk_receiver_simulator
/opt/arduino-ide/resources/app/lib/backend/resources/arduino-cli upload \
  --fqbn arduino:avr:uno --port /dev/ttyACM0 \
  --input-dir /tmp/rc-hardware-uno-build --verify --verbose
```

Require a successful uploader exit and verification output before proceeding. Do not use Nano board settings for this detected identity.

Run the real serial bench runner:

```bash
python3 tests/hardware_serial.py --port /dev/ttyACM0 \
  --expected-usb-serial 8573531383235161C0D0 \
  --confirm-bench-isolated --report /tmp/rc-real-hardware-report.json
```

The runner checks identity and existing owners, sets exclusive access and 115200 8N1, allows automatic boot/reset, tests all six previews, safe RC, malformed/range/overflow rejection, fragmented commands, watchdog expiry despite repeated previews, STOP latching, and safe RESET recovery. It never sends ENABLE or valid non-safe RC. TX is logged only after bytes are handed to the OS; actual RX is recorded separately. It attempts final STOP, closes the descriptor, and writes a timestamped JSON report. A safe ACK after a heartbeat does not prove there were no transient pulse changes; physical measurement is still required.

If actual host read/write access is denied, inspect `getfacl /dev/ttyACM0` and `id -nG`. If appropriate, a temporary device-specific ACL can be granted from the host with `sudo setfacl -m u:"$(id -un)":rw /dev/ttyACM0`; it may need renewal after reconnection. No permission changes were made by the agent. A chmod/group change cannot expose a device missing from the agent's sandbox.

## Real browser verification after the runner releases the port

1. Start `npm run dev -- --port 4182` from `web/` in the host terminal. Open `http://127.0.0.1:4182/` in Chrome/Chromium.
2. Select Hardware, click Connect Arduino, and personally select the identified Uno in the browser permission picker. No permission bypass is configured.
3. Wait for firmware state. Click Reset latch if STOPPED/FAILSAFE, then confirm safe applied ACK `1500 / 1500 / 1000 / 1500`. Leave Enable untouched.
4. Move each axis separately and both sticks simultaneously. Compare REQUESTED, PREVIEW TX, PREVIEW ACK, and actual log lines. PREVIEW_ACK must match requested values after the next telemetry update. Applied ACK must remain safe.
5. Release and repeat each stick several times. All requested channels return to 1500 and subsequent preview ACKs match center.
6. Press Emergency Stop; confirm STATE STOPPED, safe applied ACK, and continued preview diagnostics. Reset must return SAFE without enabling output.
7. Disconnect and reconnect. The browser must never authorize control automatically. Keep the direct runner closed throughout browser testing.
8. Share uploader output, `/tmp/rc-real-hardware-report.json`, and observed browser results so remaining discrepancies can be diagnosed from real evidence.

No oscilloscope/logic-analyzer connection is exposed here. D3/D5/D6/D9 pulse widths, voltage levels, common ground and KK reception remain unmeasured. Keep KK disconnected until those measurements are complete.

## Changes in this hardware-test session

Added `tests/hardware_serial.py` and this report. No application or firmware behavior was changed without hardware evidence. No packages installed, system permissions changed, device flashed, or ENABLE command sent.
