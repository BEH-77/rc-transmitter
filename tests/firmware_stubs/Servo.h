#pragma once
class Servo {
public:
  int pin = -1;
  int pulse = 0;
  int writes = 0;
  void attach(int p) { pin = p; }
  void writeMicroseconds(int value) { pulse = value; ++writes; }
};
