#include <iostream>
#include <sstream>
#include "firmware_harness.h"
int main() {
  setup();
  Serial.outgoing.clear();
  std::string inputLine;
  int step = 0;
  while (std::getline(std::cin, inputLine)) {
    std::istringstream in(inputLine);
    unsigned long time;
    if (!(in >> time)) return 2;
    std::string command;
    if (!(in >> command)) return 2;
    fakeMillis = time;
    loop();
    feed(command + "\n");
    std::istringstream responses(Serial.outgoing);
    std::string response;
    while (std::getline(responses, response)) std::cout << "RX," << step << ',' << response << '\n';
    Serial.outgoing.clear();
    std::cout << "STEP," << step << ',' << stateName() << ',' << rollServo.pin << ':' << rollServo.pulse << ',' << pitchServo.pin << ':' << pitchServo.pulse << ',' << throttleServo.pin << ':' << throttleServo.pulse << ',' << yawServo.pin << ':' << yawServo.pulse << '\n';
    ++step;
  }
}
