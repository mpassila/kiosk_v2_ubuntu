import { signal } from '@preact/signals-react'
import config from '../../../config'
import _ from 'lodash';
let doorToggle = 0;
const doorStatus = signal<any>([])
import { updateSessionDoorStatus, sessionDevice } from './shared'
let lastStatus = {};
let lastFetchTimestamp = 0;
const STALE_THRESHOLD_MS = 3000;

function updateDoorStatus(lockers: any[]): void {
  doorStatus.value = lockers;
  lastFetchTimestamp = Date.now();
  updateSessionDoorStatus(lockers);
}

function getDoorStatusAge(): number {
  return lastFetchTimestamp === 0 ? Infinity : Date.now() - lastFetchTimestamp;
}

async function getLockerStatus(mac: string): Promise<any> {
  try {
    const electron = (window as any).electron;
    const cachedIntegrations = localStorage.getItem('integrations');
    let ip = '';
    if (cachedIntegrations) {
      try {
        const parsed = JSON.parse(cachedIntegrations);
        const integrations = Array.isArray(parsed) ? parsed : Object.values(parsed);
        if (integrations.length > 0) {
          ip = (integrations[0] as any).ip || '';
        }
      } catch (e) { /* ignore */ }
    }

    const data = await electron.sideeventNative.getLockerStatus(mac, ip);
    const lockers = data?.content?.lockers || [];
    updateDoorStatus(lockers);
    lastStatus = data;
    return lastStatus;
  } catch (error) {
    console.error('🚪 getLockerStatus error:', error);
    return lastStatus;
  }
}

async function openDoor(doorOrMac: number | string, doorParam?: number): Promise<any> {
  // Support both signatures: openDoor(door) and legacy openDoor(mac, door)
  const door: number = typeof doorOrMac === 'number' ? doorOrMac : doorParam!;
  const electron = (window as any).electron;

  // Resolve mac + ip from integrations, fallback to device settings
  let mac = '';
  let ip = '';
  const cachedIntegrations = localStorage.getItem('integrations');
  if (cachedIntegrations) {
    try {
      const parsed = JSON.parse(cachedIntegrations);
      const integrations = Array.isArray(parsed) ? parsed : Object.values(parsed);
      if (integrations.length > 0) {
        const first = integrations[0] as any;
        mac = first.macId || first.mac || '';
        ip = first.ip || '';
      }
    } catch (e) { /* ignore */ }
  }
  if (!mac) {
    mac = sessionDevice.value?.settings?.macid || sessionDevice.value?.settings?.mac || sessionDevice.value?.config?.locker?.mac || '';
  }

  if (config.testmode) {
    console.log(`testmode: openDoor(${door}) - via IPC for simulated open/close cycle`);
    doorToggle = config.doorToggle || 15;
    await electron.sideeventNative.openLockerDoor(door, mac, '');
    return true;
  }

  const result = await electron.sideeventNative.openLockerDoor(door, mac, ip);

  // If this door has a bound partner, open it too
  try {
    const thedoors = sessionDevice.value?.thedoors;
    if (thedoors && Array.isArray(thedoors)) {
      const doorData = thedoors.find((d: any) => d.doorNumber === door);
      if (doorData?.bindWithDoor != null) {
        const slaveDoor = Number(doorData.bindWithDoor);
        const isPusatec = sessionDevice.value?.settings?.hwIntegrations?.pusatecEnabled;
        await new Promise(r => setTimeout(r, isPusatec ? 200 : 1200));
        console.log(`openDoor: also opening bound door ${slaveDoor}`);
        await electron.sideeventNative.openLockerDoor(slaveDoor, mac, ip);
      }
    }
  } catch (e) {
    console.warn('openDoor: failed to open bound door:', e);
  }

  return result;
}

async function isDoorOpen(mac: string, door: number, options?: { fresh?: boolean }): Promise<boolean> {
  if (config.testmode) {
    // Use signal data updated by simulated door-status-update IPC events
    const doorEntry = doorStatus.value.find((a: any) => +a.number === +door);
    const isOpen = doorEntry ? doorEntry.locked === false : false;
    console.log(`🧪 testmode: isDoorOpen(${door}) - ${isOpen ? 'OPEN' : 'CLOSED'}`);
    return isOpen;
  }

  // Use cached signal data when fresh is not requested and data is recent
  if (!options?.fresh && getDoorStatusAge() < STALE_THRESHOLD_MS && doorStatus.value.length > 0) {
    const doorEntry = doorStatus.value.find((a: any) => +a.number === +door);
    const isLocked = doorEntry ? doorEntry.locked !== false : true;
    const isOpen = !isLocked;
    return isOpen;
  }

  try {
    // Use main process IPC to get locker status (renderer fetch to localhost may be blocked)
    const electron = (window as any).electron;
    const cachedIntegrations = localStorage.getItem('integrations');
    let ip = '';
    if (cachedIntegrations) {
      try {
        const parsed = JSON.parse(cachedIntegrations);
        const integrations = Array.isArray(parsed) ? parsed : Object.values(parsed);
        if (integrations.length > 0) {
          ip = (integrations[0] as any).ip || '';
        }
      } catch (e) { /* ignore */ }
    }

    const data = await electron.sideeventNative.getLockerStatus(mac, ip);
    const lockers = data?.content?.lockers || [];
    updateDoorStatus(lockers);
    const doorEntry = lockers.find((a: any) => +a.number === +door);
    const isLocked = doorEntry ? doorEntry.locked !== false : true;
    const isOpen = !isLocked;
    return isOpen;
  } catch (error) {
    console.error(`🚪 isDoorOpen(${door}): IPC failed`, error);
    return true; // Assume open on error to avoid premature exit
  }
}

async function anyDoorOpen(mac: string): Promise<any> {
  if (config.testmode) {
    const anyOpen = _.find(doorStatus.value, (a: any) => !a.locked);
    console.log(`🧪 testmode: anyDoorOpen() - ${!!anyOpen}`);
    return !!anyOpen;
  }
  // Skip IPC call if signal data is fresh
  if (getDoorStatusAge() >= STALE_THRESHOLD_MS || doorStatus.value.length === 0) {
    await getLockerStatus(mac);
  }
  const anyOpen = _.find(doorStatus.value, (a) => !a.locked);
  return !!anyOpen;
}
/**
 * Get door open status from RTDB device status (single source of truth).
 * Works in both HTTP polling and file watcher modes.
 */
function getDoorOpenFromRTDB(doorNumber: number): boolean {
  const testmode = config.testmode || (window as any).electronAPI?.getLocalConfig()?.testmode;
  if (testmode) return true;

  // Primary: use doorStatus signal (updated via direct IPC from doorStatusWatcher, no RTDB roundtrip)
  if (doorStatus.value.length > 0 && getDoorStatusAge() < STALE_THRESHOLD_MS) {
    const entry = doorStatus.value.find((a: any) => a && +a.number === +doorNumber);
    if (entry) return entry.locked === false;
  }

  // Fallback: RTDB-sourced sessionDevice.status
  const statusArr = sessionDevice.value?.status;
  if (!Array.isArray(statusArr)) return false;
  const door = statusArr.find((l: any) => l && (+l.doorNumber === +doorNumber || +l.number === +doorNumber));
  if (!door) return false;
  return door.isOpen === true || door.locked === false;
}

export {
  getLockerStatus,
  openDoor,
  isDoorOpen,
  anyDoorOpen,
  updateDoorStatus,
  getDoorStatusAge,
  getDoorOpenFromRTDB
}
