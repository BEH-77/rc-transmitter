#include <iostream>
#include "firmware_harness.h"
void send(const char* text) { feed(text); }
int main() {
  setup(); expectSafe(); assert(state == SAFE);
  assert(rollServo.pin == 3 && pitchServo.pin == 5 && throttleServo.pin == 6 && yawServo.pin == 9);
  send("RC,1500,1500,1000,1500\n"); assert(state == SAFE);
  send("RC,1700,1500,1200,1500\n"); expectSafe(); assert(Serial.outgoing.find("ERR,SAFE_REQUIRES_NEUTRAL") != std::string::npos);
  send("ENABLE\n"); assert(state == ACTIVE);
  send("RC,1700,1600,1200,1400\n");
  assert(rollServo.pulse == 1700 && pitchServo.pulse == 1600 && throttleServo.pulse == 1200 && yawServo.pulse == 1400);
  assert(Serial.outgoing.find("ACK,1700,1600,1200,1400\n") != std::string::npos);
  send("RC,999,1500,1000,1500\n"); assert(rollServo.pulse == 1700 && throttleServo.pulse == 1200);
  send("RC,1900,1500,1000,1500,EXTRA\n"); assert(rollServo.pulse == 1700);
  send("RC,1500,1500,1000,1500,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n"); assert(rollServo.pulse == 1700);
  assert(Serial.outgoing.find("ERR,OVERFLOW") != std::string::npos);
  fakeMillis = 300; loop(); assert(state == FAILSAFE); expectSafe();
  send("RC,1800,1500,1500,1500\n"); assert(state == FAILSAFE); expectSafe();
  send("RESET,1500,1500,1200,1500\n"); assert(state == FAILSAFE);
  send("RESET,1500,1500,1000,1500\n"); assert(state == SAFE); expectSafe();
  send("ENABLE\n"); assert(state == SAFE); expectSafe();
  send("RC,1500,1500,1000,1500\n");
  send("ENABLE\n"); assert(state == ACTIVE);
  send("RC,1800,1500,1300,1500\n"); assert(throttleServo.pulse == 1300);
  send("STOP\n"); assert(state == STOPPED); expectSafe();
  send("RC,1800,1500,1300,1500\n"); assert(state == STOPPED); expectSafe();
  send("RESET,1500,1500,1000,1500\n"); assert(state == SAFE); expectSafe();
  send("ENABLE\n"); assert(state == SAFE);
  // Every channel's preview is acknowledged, never applied, and never refreshes the watchdog.
  for (int channel = 0; channel < 4; ++channel) {
    int values[4] = {1500,1500,1500,1500}; values[channel] = 1750;
    std::string tuple;
    for (int i = 0; i < 4; ++i) { if (i) tuple += ","; tuple += std::to_string(values[i]); }
    const int writes = rollServo.writes + pitchServo.writes + throttleServo.writes + yawServo.writes;
    auto last = lastValidMs; auto neutralSeen = neutralRcSeen;
    Serial.outgoing.clear(); feed("PREVIEW," + tuple + "\n");
    assert(Serial.outgoing.find("PREVIEW_ACK," + tuple) != std::string::npos);
    assert(writes == rollServo.writes + pitchServo.writes + throttleServo.writes + yawServo.writes);
    expectSafe(); assert(state == SAFE && lastValidMs == last && neutralSeen == neutralRcSeen);
  }
  for (const char* invalid : {"PREVIEW,999,1500,1500,1500\n", "PREVIEW,1500,1500,1500\n", "PREVIEW,1500,1500,1500,2001\n", "PREVIEW,1500,1500,1500,1500,0\n"}) {
    Serial.outgoing.clear(); feed(invalid); expectSafe(); assert(Serial.outgoing.find("ERR,INVALID_PREVIEW") != std::string::npos);
  }
  feed("RC,1500,1500,1000,1500\n"); feed("ENABLE\n");
  feed("RC,1750,1300,1900,1600\n");
  auto last = lastValidMs;
  feed("PREVIEW,1000,1000,1000,1000\n");
  assert(state == ACTIVE && throttleServo.pulse == 1900 && lastValidMs == last);
  fakeMillis += 299; feed("PREVIEW,1750,1300,1900,1600\n"); assert(state == ACTIVE);
  fakeMillis += 1; loop(); assert(state == FAILSAFE); expectSafe();
  feed("PREVIEW,1750,1300,1900,1600\n"); assert(state == FAILSAFE); expectSafe();
  feed("STOP\n"); feed("PREVIEW,1750,1300,1900,1600\n"); assert(state == STOPPED); expectSafe();
  feed("PREVIEW,1500,1500,1500,1500,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n"); expectSafe();
  std::cout << "Firmware state tests passed\n";
}
