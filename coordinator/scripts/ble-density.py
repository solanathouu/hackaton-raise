#!/usr/bin/env python3
"""Capteur de densité de foule BLE — compte les appareils Bluetooth à portée.

Scanne en continu (bleak/WinRT-CoreBluetooth-BlueZ) et imprime une ligne NDJSON
par fenêtre glissante :  {"count": 23, "window_s": 30, "ts": 1720100000}
Consommé par scripts/crowd-density.js qui streame au coordinateur.

Usage : python ble-density.py [--window 30] [--interval 5]
Un smartphone ~= 1-2 adresses (rotation MAC privée) : le COUNT n'est pas un
comptage exact de personnes, c'est une JAUGE de densité — assumer tel quel.
"""

import argparse
import asyncio
import json
import sys
import time

from bleak import BleakScanner


async def main(window_s: int, interval_s: int) -> None:
    sightings: dict[str, float] = {}  # address -> last_seen (monotonic)

    def on_adv(device, _adv):
        sightings[device.address] = time.monotonic()

    scanner = BleakScanner(detection_callback=on_adv)
    await scanner.start()
    try:
        while True:
            await asyncio.sleep(interval_s)
            now = time.monotonic()
            # purge hors fenêtre
            for addr in [a for a, seen in sightings.items() if now - seen > window_s]:
                del sightings[addr]
            line = {"count": len(sightings), "window_s": window_s, "ts": int(time.time())}
            print(json.dumps(line), flush=True)
    finally:
        await scanner.stop()


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--window", type=int, default=30, help="fenêtre glissante (s)")
    p.add_argument("--interval", type=int, default=5, help="période d'émission (s)")
    args = p.parse_args()
    try:
        asyncio.run(main(args.window, args.interval))
    except KeyboardInterrupt:
        sys.exit(0)
