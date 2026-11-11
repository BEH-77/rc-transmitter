#include <Servo.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

// Servo uses timer interrupts, so all four outputs continue while Serial is parsed.
// Outputs: roll D3, pitch D5, throttle D6, yaw D9.
Servo rollServo, pitchServo, throttleServo, yawServo;
enum State { SAFE, ACTIVE, FAILSAFE, STOPPED };
State state = SAFE;
const unsigned long WATCHDOG_MS = 300;
unsigned long lastValidMs = 0;
char input[48];
uint8_t inputLength = 0;
bool overflow = false;
bool neutralRcSeen = false;
int applied[4] = {1500, 1500, 1000, 1500};

const char* stateName() {
  switch (state) {
    case SAFE: return "SAFE";
    case ACTIVE: return "ACTIVE";
    case FAILSAFE: return "FAILSAFE";
    default: return "STOPPED";
  }
}

void announceState() {
  Serial.print(F("STATE,"));
  Serial.println(stateName());
}

void apply(const int values[4]) {
  for (uint8_t i = 0; i < 4; ++i) applied[i] = values[i];
  rollServo.writeMicroseconds(applied[0]);
  pitchServo.writeMicroseconds(applied[1]);
  throttleServo.writeMicroseconds(applied[2]);
  yawServo.writeMicroseconds(applied[3]);
}

void safeOutputs() {
  const int safe[4] = {1500, 1500, 1000, 1500};
  apply(safe);
}

void acknowledge() {
  Serial.print(F("ACK,"));
  for (uint8_t i = 0; i < 4; ++i) {
    if (i) Serial.print(',');
    Serial.print(applied[i]);
  }
  Serial.println();
}

// Parse exactly four decimal fields without accepting signs, spaces or trailing data.
bool parseValues(const char* p, int out[4]) {
  for (uint8_t i = 0; i < 4; ++i) {
    if (*p < '0' || *p > '9') return false;
    long value = 0;
    uint8_t digits = 0;
    while (*p >= '0' && *p <= '9') {
      value = value * 10 + (*p++ - '0');
      if (++digits > 4) return false;
    }
    if (value < 1000 || value > 2000) return false;
    out[i] = (int)value;
    if (i < 3) { if (*p++ != ',') return false; }
    else if (*p != '\0') return false;
  }
  return true;
}

bool neutral(const int values[4]) {
  return values[0] == 1500 && values[1] == 1500 && values[2] == 1000 && values[3] == 1500;
}

void process(char* line) {
  // Telemetry is accepted in every state, but never touches outputs or watchdog.
  if (strncmp(line, "PREVIEW,", 8) == 0) {
    int values[4];
    if (!parseValues(line + 8, values)) { Serial.println(F("ERR,INVALID_PREVIEW")); return; }
    Serial.print(F("PREVIEW_ACK,"));
    for (uint8_t i = 0; i < 4; ++i) { if (i) Serial.print(','); Serial.print(values[i]); }
    Serial.println(); return;
  }
  if (strcmp(line, "STOP") == 0) {
    safeOutputs(); state = STOPPED; neutralRcSeen = false; announceState(); acknowledge(); return;
  }
  if (strncmp(line, "RESET,", 6) == 0) {
    int values[4];
    if (!parseValues(line + 6, values) || !neutral(values)) { Serial.println(F("ERR,RESET_REQUIRES_NEUTRAL")); return; }
    safeOutputs(); state = SAFE; neutralRcSeen = false; lastValidMs = millis(); announceState(); acknowledge(); return;
  }
  if (strcmp(line, "ENABLE") == 0) {
    if (state != SAFE || !neutralRcSeen || !neutral(applied) || (unsigned long)(millis() - lastValidMs) >= WATCHDOG_MS) {
      Serial.println(F("ERR,ENABLE_REQUIRES_FRESH_NEUTRAL")); return;
    }
    state = ACTIVE; announceState(); return;
  }
  if (strncmp(line, "RC,", 3) == 0) {
    int values[4];
    if (!parseValues(line + 3, values)) { Serial.println(F("ERR,INVALID_RC")); return; }
    if (state == STOPPED || state == FAILSAFE) { Serial.println(F("ERR,LATCHED")); return; }
    if (state == SAFE && !neutral(values)) { Serial.println(F("ERR,SAFE_REQUIRES_NEUTRAL")); return; }
    apply(values); lastValidMs = millis(); if (state == SAFE) neutralRcSeen = true; acknowledge(); return;
  }
  Serial.println(F("ERR,UNKNOWN_COMMAND"));
}

void setup() {
  // Preload throttle minimum before enabling its timer-driven pin output.
  throttleServo.writeMicroseconds(1000);
  rollServo.attach(3);
  pitchServo.attach(5);
  throttleServo.attach(6);
  yawServo.attach(9);
  safeOutputs();
  Serial.begin(115200);
  lastValidMs = millis();
  announceState();
}

void loop() {
  // Run the watchdog before parsing new input; a late message cannot revive an expired state.
  if ((state == SAFE || state == ACTIVE) && (unsigned long)(millis() - lastValidMs) >= WATCHDOG_MS) {
    safeOutputs(); state = FAILSAFE; neutralRcSeen = false; announceState(); acknowledge();
  }
  // Bound work per iteration so an unending serial stream cannot starve the watchdog.
  for (uint8_t processed = 0; processed < 32 && Serial.available() > 0; ++processed) {
    const char ch = (char)Serial.read();
    if (ch == '\n') {
      if (overflow) Serial.println(F("ERR,OVERFLOW"));
      else { input[inputLength] = '\0'; if (inputLength && input[inputLength - 1] == '\r') input[--inputLength] = '\0'; process(input); }
      inputLength = 0; overflow = false;
    } else if (!overflow) {
      if (inputLength < sizeof(input) - 1) input[inputLength++] = ch;
      else overflow = true;
    }
  }
}
