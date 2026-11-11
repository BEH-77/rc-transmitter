# VECTOR / RC — Arduino receiver signal generator

A local React transmitter interface sends four RC channel values over USB Serial to an Uno or Nano. The Arduino generates continuous servo style pulses for a KK V5.5 flight controller. **Remove propellers and disconnect motors for all setup and verification.** This project has not been verified on physical hardware by its authoring session.

## Requirements

- Arduino Uno or Nano with ATmega328P, USB data cable, Arduino IDE and its built in Servo library.
- Chromium based browser with Web Serial support (Chrome or Edge) on `localhost`.
- Node.js 20.19+ or 22.12+ and npm.
- Oscilloscope, logic analyzer or a second Arduino for signal measurement before connecting the KK V5.5.
- Properly regulated power for the KK V5.5 and a common ground. **Never connect main motor supply voltage directly to the KK V5.5 5 V receiver header.** Check the specific board's power wiring and voltage limits first.

No backend, cloud service or external server is used. The UI runs locally through Vite.

## Upload and run

1. Open `arduino/kk_receiver_simulator/kk_receiver_simulator.ino` in Arduino IDE. Select the Uno or Nano board and its USB port. For a Nano clone, choose the appropriate processor/bootloader. Upload the sketch. Keep the KK V5.5 disconnected for now.
2. In a terminal: `cd web && npm install && npm run dev`.
3. Open the localhost address printed by Vite in Chrome or Edge. Select **Hardware** and **Connect Arduino**, then choose the port in the browser picker. Close Arduino IDE's Serial Monitor first because only one program can own the port.
4. The Arduino may already be in `FAILSAFE` by the time the browser opens the port. Click **Reset latch**. It sends the required neutral reset command. Wait for `STATE,SAFE` and a neutral ACK.
5. First verify locked preview: move each stick and compare REQUESTED, PREVIEW TX, and PREVIEW ACK. Applied ACK must remain `1500 / 1500 / 1000 / 1500`. To enable control, **hold throttle at 1000 µs with roll, pitch and yaw at 1500**, then explicitly select **Enable joystick output** while continuing to hold the stick. Use touch with a second finger, or hold the left mouse button and use Tab/Enter to activate Enable. Wait for `STATE,ACTIVE`. Activation is refused at center throttle. Releasing/cancelling the left stick or hiding the page requests STOP before its spring return to 1500 can become an RC control command. Reset is required before enabling again. This does not arm the KK V5.5; no automatic arming gesture is generated.
6. Use **Simulation** for local UI testing without an Arduino. All simulated TX and RX log lines are marked `[SIMULATED]`; the UI never labels this as a USB connection.

The browser starts with requested `CENTER` (all four channels 1500 µs) and locked hardware `SAFE` (throttle 1000 µs, all other channels 1500 µs). Both sticks have proportional 1000–2000 µs travel and center on release. Channel reversal changes requested mapping and is available only while locked. Arrow keys operate a focused stick in 50 µs steps; releasing a key centers that stick.

While locked, current requests are sent as telemetry-only `PREVIEW` at up to 25 Hz, alongside the 50 Hz safe RC heartbeat. While STOPPED/FAILSAFE, preview diagnostics continue but RC heartbeats stop. While explicitly authorized and ACTIVE, the latest requested tuple is sent as RC at approximately 50 Hz. The bounded writer coalesces RC/preview updates; slow writes reduce the effective rate rather than creating a backlog. STOP invalidates pending ordinary frames and runs before further commands at the earliest opportunity after any in-flight write. A write already handed to USB cannot be recalled.

**Spring-centered throttle limitation:** this is a hold-to-control interface, not a conventional latched throttle transmitter. Hold minimum throttle through activation. Keep the left gesture held during active operation; releasing it locks hardware output with STOP, while the displayed requested channels still return to CENTER and are sent as PREVIEW. Right-stick release centers roll/pitch while active. UI Reset always relocks output.

The monitor separates REQUESTED, PREVIEW TX, PREVIEW ACK, CONTROL TX, and APPLIED ACK. Hardware TX is recorded only after the actual writer promise resolves. Simulation TX/RX are marked `[SIMULATED]` and never use USB. The simulator independently checks its watchdog on a timer. Preview never refreshes the control watchdog in either firmware or simulation.

A stalled write times out after 250 ms and retires the transport; it is never reused for subsequent commands. UI cleanup is bounded and attempts stream abort/reader cancellation/lock release/port close. A JavaScript deadline does **not** cancel a physical USB operation; late cleanup is retried if that operation settles. Arduino's independent 300 ms watchdog remains the protection when STOP cannot get through. A port with unsettled cleanup is quarantined, so late cleanup cannot close a reopened session. A driver that never settles can require physically reconnecting USB before selecting the port again.

## Wiring

| Arduino | KK V5.5 receiver input |
|---|---|
| D3 | AIL / Roll signal |
| D5 | ELE / Pitch signal |
| D6 | THR / Throttle signal |
| D9 | RUD / Yaw signal |
| GND | GND |

Connect signal pins only after measuring the output. The KK V5.5 must have its own correctly regulated supply and a shared ground with the Arduino. Do not assume its receiver header supplies safe power to or from USB. Confirm the input order, signal polarity, voltage compatibility, and arming method for **your exact KK V5.5 firmware**. The four Servo objects use timer driven pulses, so output continues independently of Serial parsing.

## Bench verification before KK connection

1. Keep the flight controller, ESCs, motors, and propellers disconnected. Power only the Arduino over USB.
2. Probe each signal pin against Arduino GND using an oscilloscope or logic analyzer. Expect a repeating servo style pulse approximately every 20 ms (Servo library scheduling may cause slight variation). At boot, measure D3 = 1500 µs, D5 = 1500 µs, D6 = 1000 µs, D9 = 1500 µs.
3. Connect the web UI and reset the latch. Verify that requested center throttle is 1500 µs but Arduino ACK and measured output stay at the safe 1000 µs. Enable joystick output only when intended; move each stick separately and compare measured high pulse width with the ACK and the channel monitor. Check both endpoints and reversal settings.
4. Press **EMERGENCY STOP** while throttle is elevated. Confirm all four measured outputs immediately return to safe widths and remain there despite joystick movement. Send RESET, then confirm output remains safe until ENABLE.
5. With output active and throttle elevated, unplug USB or stop the browser stream while keeping the Arduino independently powered. Within 300 ms of the last valid RC message, outputs should return safe and stay latched until RESET. If USB is the Arduino's only power, unplugging USB stops pulses entirely; use a separate regulated Arduino supply to test the watchdog scenario.
6. Only after these checks, connect signals and common ground to the KK V5.5, still with propellers removed. Verify the controller's displayed input channels if its firmware offers a receiver test screen. Check direction and endpoints there. An ACK confirms **what the Arduino accepted and applied**, not what the KK V5.5 actually decoded.

A second Arduino can measure high pulse duration with edge interrupts or `pulseIn()` for a basic check, but an oscilloscope or logic analyzer shows timing and jitter more clearly. Do not assume all KK V5.5 variants accept the same receiver pulse timing or input mapping.

## Serial protocol

115200 baud, newline terminated ASCII, 8N1. No JSON. Channel order is **ROLL, PITCH, THROTTLE, YAW**. Pulse widths are integer microseconds from 1000 to 2000 inclusive.

| Browser command | Meaning | Arduino response |
|---|---|---|
| `RC,1700,1500,1200,1500\n` | Apply four channels at 50 Hz while ACTIVE | `ACK,1700,1500,1200,1500` |
| `PREVIEW,1750,1300,1900,1600\n` | Telemetry in any state; no output/state/watchdog change | `PREVIEW_ACK,1750,1300,1900,1600` |
| `RC,1500,1500,1000,1500\n` | Neutral heartbeat in SAFE or ACTIVE | Neutral `ACK` |
| `ENABLE\n` | Transition SAFE → ACTIVE after a fresh neutral RC | `STATE,ACTIVE` |
| `STOP\n` | Latch STOPPED and safe outputs | `STATE,STOPPED`, neutral `ACK` |
| `RESET,1500,1500,1000,1500\n` | Clear STOPPED or FAILSAFE into SAFE | `STATE,SAFE`, neutral `ACK` |

PREVIEW uses the same strict four-field range validation as RC. Invalid preview returns `ERR,INVALID_PREVIEW`. PREVIEW_ACK reports received telemetry; ACK reports values supplied to the Servo outputs, not measured pulses. Upload the updated sketch before using preview with hardware.

Malformed, out of range, overflowing or disallowed messages do not change outputs. The Arduino returns `ERR,<REASON>`. The input buffer is bounded and processing is nonblocking. A valid RC line updates the watchdog. In SAFE, only neutral RC is accepted. `ENABLE` requires a neutral applied command within 300 ms. `RESET` only accepts the exact neutral tuple. After reset, output remains safe until the explicit ENABLE step.

## Safety states and limitations

- **SAFE:** neutral outputs; neutral RC keeps the 300 ms watchdog alive.
- **ACTIVE:** validated RC values are applied. If no valid RC arrives for 300 ms, the Arduino enters FAILSAFE.
- **FAILSAFE:** safe outputs latched. A fresh, exact neutral RESET is required.
- **STOPPED:** safe outputs latched after STOP. A fresh, exact neutral RESET is required.

The watchdog runs in SAFE too. It may enter FAILSAFE before a browser connects; this is expected. Browser disconnection, refresh, USB interruption, or tab suspension can stop commands. The Arduino watchdog is the independent protection if it remains powered. A browser STOP cannot help if USB is already disconnected; remove power from propulsion and use a separate physical emergency cutoff for bench work. Resetting the Arduino also starts it in SAFE, never ACTIVE. Do not rely on browser state as proof of flight controller state.

The KK V5.5's receiver format, channel order, calibration, arming gesture, and failsafe behavior depend on its firmware. This tool generates conventional servo style receiver pulses; it does not inspect the KK controller and cannot prove compatibility. It provides no wireless link, redundant receiver, certified safety system, or autonomous disarm of ESCs. Keep actual flight testing within your hardware's documented setup process.

The [Seeed KK V5.5 documentation](https://seeeddoc.github.io/KKmulticontroller/res/KKmulticontroller_v5.5.pdf) describes the AIL/ELE/THR/RUD receiver inputs and shows that flight configuration depends on loaded firmware. [MDN's Web Serial reference](https://developer.mozilla.org/en-US/docs/Web/API/Serial) documents the browser port picker and disconnect event; Web Serial requires a compatible browser and secure context, with localhost supported for local development.

## Development checks

From `web/`, run `npm test`, `npm run lint`, `npm run build`, and `npm run test:integration`. For real browser interaction tests, serve the app on port 4182, launch headless Chromium with remote debugging on port 9224, then run `CDP_PORT=9224 node tests/browser_joystick.mjs` and `CDP_PORT=9224 node tests/browser_serial.mjs` from the project root. The joystick test covers pointer capture, repeated mouse and touch drags, cancellation, reset, stop, visual positions, and transmitted values; the serial test uses a mock Web Serial port.

Firmware state tests run on a host compiler with `g++ -std=c++17 -I tests/firmware_stubs tests/firmware_test.cpp -o /tmp/rc-firmware-test && /tmp/rc-firmware-test` from the project root. This checks sketch logic with stubbed Servo and Serial objects. Arduino target compilation was not performed in this change session because Arduino CLI is unavailable. To compile for `arduino:avr:uno` and `arduino:avr:nano`, use Arduino CLI (`arduino-cli compile --fqbn arduino:avr:uno arduino/kk_receiver_simulator`). Compilation and host tests are not substitutes for physical pulse measurement.


If the environment forbids Node child-process spawning, the protocol integration test supports these equivalent direct commands from the repository root:

```bash
g++ -std=c++17 -I tests/firmware_stubs tests/firmware_bridge.cpp -o /tmp/rc-firmware-bridge
node tests/protocol_integration.mjs --input > /tmp/rc-integration-input
/tmp/rc-firmware-bridge < /tmp/rc-integration-input > /tmp/rc-integration-output
node tests/protocol_integration.mjs --verify /tmp/rc-integration-output
```

The current change session passed 25 Vitest tests, lint, TypeScript/production build, host firmware tests, and the 27-step protocol integration using the direct commands above. Chromium suites were updated and attempted, but server/Chromium/CDP socket operations returned `EPERM` in the execution environment. Their pointer, layout, React lifecycle and mocked USB browser assertions remain unverified here. No physical USB, pulse-timing or KK V5.5 test was performed.
