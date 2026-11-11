#pragma once
#include <cassert>
#include <string>
#include <cstring>
#define F(x) x
inline unsigned long fakeMillis = 0;
unsigned long millis() { return fakeMillis; }
class FakeSerial {
public:
  std::string incoming, outgoing;
  void begin(int baud) { assert(baud == 115200); }
  int available() { return (int)incoming.size(); }
  int read() { char c = incoming[0]; incoming.erase(0, 1); return c; }
  void print(const char* s) { outgoing += s; }
  void print(char c) { outgoing += c; }
  void print(int v) { outgoing += std::to_string(v); }
  void println(const char* s) { outgoing += s; outgoing += '\n'; }
  void println() { outgoing += '\n'; }
} Serial;
#include "../arduino/kk_receiver_simulator/kk_receiver_simulator.ino"
inline void feed(const std::string& text) { Serial.incoming += text; while (!Serial.incoming.empty()) loop(); }
inline void expectSafe() { assert(rollServo.pulse == 1500 && pitchServo.pulse == 1500 && throttleServo.pulse == 1000 && yawServo.pulse == 1500); }
