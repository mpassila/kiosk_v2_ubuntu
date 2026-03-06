/**
 * Door Status Watcher Service
 * Polls locker device directly via HTTP for door status
 * and updates device.status in Firebase RTDB when door states change
 *
 * Status format in RTDB: { "1": {status}, "2": {status}, ... }
 * Where each status is: { doorNumber, isOpen, locked, online, alarm, updatedAt }
 */

import fs from 'fs';
import http from 'http';
import log from 'electron-log';
import { BrowserWindow } from 'electron';
import { SERVICE_CONFIG_PATH } from './paths';

interface DoorStatus {
  index: string;
  locked: boolean;
  number?: number;
  updated?: string;
  init?: boolean;
  last_access_time?: string;
}

interface ServiceConfig {
  macs?: string;
  status?: string;
  doorStatus?: {
    [macId: string]: DoorStatus[];
  };
}

// HTTP response format from locker device
interface LockerHttpResponse {
  content: {
    lockers: Array<{
      alarm: boolean;
      locked: boolean;
      number: number;
      online: boolean;
    }>;
  };
  type: string;
}

interface DeviceStatusEntry {
  doorNumber: number;
  isOpen: boolean;
  locked: boolean;
  online: boolean;
  alarm: boolean;
  updatedAt: string;
}

// Status object keyed by door number
interface AllDoorsStatus {
  [doorNumber: string]: DeviceStatusEntry;
}

let watcher: fs.FSWatcher | null = null;
let pollingInterval: NodeJS.Timeout | null = null;
let lastDoorStatus: { [key: string]: boolean } = {}; // key = "doorNumber", value = isOpen
let currentAllDoorsStatus: AllDoorsStatus = {}; // Current state of all doors
let databaseUrl: string | null = null;
let authToken: string | null = null;
let licenseId: string | null = null;
let deviceId: string | null = null;
let lockerIp: string | null = null; // IP address of locker device for direct HTTP polling
let debounceTimer: NodeJS.Timeout | null = null;

// Polling interval in milliseconds (5 seconds)
const POLLING_INTERVAL_MS = 5000;
let pollCount = 0;

// Hardware failure tracking
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 3; // Route to /ooo after 3 consecutive failures
let mainWindow: BrowserWindow | null = null;
let hardwareOfflineNotified = false; // Prevent spamming /ooo navigation
let testmode = false; // When true, return simulated data instead of polling real hardware

/**
 * Set the main window reference for IPC communication
 */
export function setDoorStatusMainWindow(win: BrowserWindow | null): void {
  mainWindow = win;
  log.info('DoorStatusWatcher: Main window reference set');
}

/**
 * Initialize the door status watcher service
 * @param dbUrl - Firebase RTDB URL
 * @param token - Auth token for RTDB
 * @param license - License ID
 * @param device - Device ID
 * @param ip - Optional locker IP address for direct HTTP polling (preferred method)
 */
export function initDoorStatusWatcher(
  dbUrl: string,
  token: string | null,
  license: string,
  device: string,
  ip?: string
): void {
  databaseUrl = dbUrl;
  authToken = token;
  licenseId = license;
  deviceId = device;
  lockerIp = ip || null;

  log.info(`DoorStatusWatcher: Initializing door status watcher`);
  log.info(`DoorStatusWatcher: Database URL: ${dbUrl}`);
  log.info(`DoorStatusWatcher: License ID: ${license}`);
  log.info(`DoorStatusWatcher: Device ID: ${device}`);
  log.info(`DoorStatusWatcher: Locker IP: ${ip || 'not provided (will use file watcher)'}`);

  if (lockerIp) {
    // Use HTTP polling (preferred method)
    log.info(`DoorStatusWatcher: Using HTTP polling mode (http://${lockerIp}:5003/data/status)`);

    // Fetch initial status
    fetchLockerStatusHttp().then(() => {
      log.info(`DoorStatusWatcher: Initial HTTP fetch complete`);
    }).catch(err => {
      log.error('DoorStatusWatcher: Initial HTTP fetch failed:', err);
    });

    // Start HTTP polling
    startHttpPolling();
  } else {
    // Fallback to file watcher mode
    if (!fs.existsSync(SERVICE_CONFIG_PATH)) {
      log.info(`DoorStatusWatcher: File not found at ${SERVICE_CONFIG_PATH} - service disabled`);
      return;
    }

    log.info(`DoorStatusWatcher: Using file watcher mode (${SERVICE_CONFIG_PATH})`);

    // Read initial state from file
    try {
      const content = fs.readFileSync(SERVICE_CONFIG_PATH, 'utf8');
      const config: ServiceConfig = JSON.parse(content);

      if (config.doorStatus) {
        currentAllDoorsStatus = buildAllDoorsStatusFromFile(config.doorStatus);

        for (const [doorNum, status] of Object.entries(currentAllDoorsStatus)) {
          lastDoorStatus[doorNum] = status.isOpen;
        }

        log.info(`DoorStatusWatcher: Initialized with ${Object.keys(currentAllDoorsStatus).length} doors`);
        updateAllDoorsStatusInRTDB();
      }
    } catch (error) {
      log.error('DoorStatusWatcher: Error reading initial state:', error);
    }

    startWatcher();
    startPolling();
  }
}

/**
 * Build doors status from file config (fallback method)
 */
function buildAllDoorsStatusFromFile(doorStatusConfig: { [macId: string]: DoorStatus[] }): AllDoorsStatus {
  const allDoors: AllDoorsStatus = {};
  const now = new Date().toISOString();

  for (const [mac, doors] of Object.entries(doorStatusConfig)) {
    for (const door of doors) {
      if (door.number !== undefined) {
        const doorNum = String(door.number);
        allDoors[doorNum] = {
          doorNumber: door.number,
          isOpen: !door.locked, // locked: true means isOpen: false
          locked: door.locked,
          online: true,
          alarm: false,
          updatedAt: door.last_access_time || door.updated || now
        };
      }
    }
  }

  return allDoors;
}

/**
 * Build doors status from HTTP response (preferred method)
 */
function buildAllDoorsStatusFromHttp(response: LockerHttpResponse): AllDoorsStatus {
  const allDoors: AllDoorsStatus = {};
  const now = new Date().toISOString();

  if (response.content && response.content.lockers) {
    for (const locker of response.content.lockers) {
      const doorNum = String(locker.number);
      allDoors[doorNum] = {
        doorNumber: locker.number,
        isOpen: !locker.locked, // locked: true means isOpen: false
        locked: locker.locked,
        online: locker.online,
        alarm: locker.alarm,
        updatedAt: now
      };
    }
  }

  return allDoors;
}

/**
 * Fetch locker status via HTTP from locker device
 */
async function fetchLockerStatusHttp(): Promise<void> {
  if (!lockerIp) {
    return;
  }

  return new Promise((resolve, reject) => {
    const url = `http://${lockerIp}:5003/data/status`;

    http.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      let data = '';
      response.on('data', (chunk) => {
        data += chunk;
      });

      response.on('end', async () => {
        try {
          const jsonResponse: LockerHttpResponse = JSON.parse(data);
          const newAllDoorsStatus = buildAllDoorsStatusFromHttp(jsonResponse);
          let hasChanges = false;

          // Check for changes
          for (const [doorNum, newStatus] of Object.entries(newAllDoorsStatus)) {
            const previousIsOpen = lastDoorStatus[doorNum];

            if (previousIsOpen !== undefined && previousIsOpen !== newStatus.isOpen) {
              log.info(`DoorStatusWatcher: [HTTP] Door ${doorNum} changed: isOpen=${newStatus.isOpen} (locked=${newStatus.locked})`);
              hasChanges = true;
            }

            lastDoorStatus[doorNum] = newStatus.isOpen;
          }

          currentAllDoorsStatus = newAllDoorsStatus;
          pollCount++;

          // Relay raw locker data to renderer so it can update the doorStatus signal
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('door-status-update', {
              lockers: jsonResponse.content.lockers,
              timestamp: Date.now()
            });
          }

          // Only update RTDB if there are changes
          if (hasChanges) {
            log.info(`DoorStatusWatcher: [HTTP] Door status changed, updating RTDB`);
            await updateAllDoorsStatusInRTDB();
          }

          resolve();
        } catch (parseError) {
          log.error('DoorStatusWatcher: [HTTP] Error parsing response:', parseError);
          reject(parseError);
        }
      });

      response.on('error', (err) => {
        reject(err);
      });
    }).on('error', (err) => {
      log.error('DoorStatusWatcher: [HTTP] Request error:', err);
      reject(err);
    });
  });
}

/**
 * Start HTTP polling interval for continuous status updates
 */
function startHttpPolling(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
  }

  log.info(`DoorStatusWatcher: Starting HTTP polling (every ${POLLING_INTERVAL_MS}ms to http://${lockerIp}:5003/data/status)`);

  pollingInterval = setInterval(async () => {
    try {
      await fetchLockerStatusHttp();
      // Reset failure counter on success
      if (consecutiveFailures > 0) {
        log.info(`DoorStatusWatcher: [HTTP] Poll succeeded after ${consecutiveFailures} failures`);
        consecutiveFailures = 0;
        hardwareOfflineNotified = false;
      }
    } catch (error) {
      consecutiveFailures++;
      log.warn(`DoorStatusWatcher: [HTTP] Poll failed (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}), will retry...`);

      // After threshold failures, notify renderer to route to /ooo
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && !hardwareOfflineNotified) {
        log.error(`DoorStatusWatcher: [HTTP] Hardware unreachable after ${consecutiveFailures} consecutive failures - notifying renderer`);
        hardwareOfflineNotified = true;

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('locker-hardware-offline', {
            reason: 'Hardware unreachable',
            failures: consecutiveFailures,
            ip: lockerIp
          });
        }
      }
    }
  }, POLLING_INTERVAL_MS);
}

/**
 * Update auth token for RTDB operations
 */
export function updateDoorStatusWatcherToken(newToken: string): void {
  authToken = newToken;
  log.info('DoorStatusWatcher: Auth token updated');
}

/**
 * Start the file watcher
 */
function startWatcher(): void {
  if (watcher) {
    watcher.close();
  }

  try {
    watcher = fs.watch(SERVICE_CONFIG_PATH, (eventType) => {
      if (eventType === 'change') {
        // Debounce file changes (file may be written multiple times quickly)
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          checkForDoorStatusChanges();
        }, 100);
      }
    });

    watcher.on('error', (error) => {
      log.error('DoorStatusWatcher: Watcher error:', error);
      // Try to restart watcher after 5 seconds
      setTimeout(() => {
        if (fs.existsSync(SERVICE_CONFIG_PATH)) {
          startWatcher();
        }
      }, 5000);
    });

    log.info('DoorStatusWatcher: File watcher started');
  } catch (error) {
    log.error('DoorStatusWatcher: Failed to start watcher:', error);
  }
}

/**
 * Start polling interval for continuous status updates
 * This ensures door status is read and updated even if file watcher misses changes
 */
function startPolling(): void {
  // Clear any existing polling interval
  if (pollingInterval) {
    clearInterval(pollingInterval);
  }

  log.info(`DoorStatusWatcher: Starting polling interval (every ${POLLING_INTERVAL_MS}ms)`);

  pollingInterval = setInterval(async () => {
    try {
      // Check if file exists before reading
      if (!fs.existsSync(SERVICE_CONFIG_PATH)) {
        return;
      }

      const content = fs.readFileSync(SERVICE_CONFIG_PATH, 'utf8');
      const config: ServiceConfig = JSON.parse(content);

      if (!config.doorStatus) {
        return;
      }

      // Build new status from file
      const newAllDoorsStatus = buildAllDoorsStatusFromFile(config.doorStatus);
      let hasChanges = false;

      // Check for changes
      for (const [doorNum, newStatus] of Object.entries(newAllDoorsStatus)) {
        const previousIsOpen = lastDoorStatus[doorNum];

        if (previousIsOpen !== newStatus.isOpen) {
          log.info(`DoorStatusWatcher: [Poll] Door ${doorNum} changed: isOpen=${newStatus.isOpen}`);
          hasChanges = true;
        }

        // Update tracking
        lastDoorStatus[doorNum] = newStatus.isOpen;
      }

      // Update current status
      currentAllDoorsStatus = newAllDoorsStatus;
      pollCount++;

      // Only update RTDB if there are changes
      if (hasChanges) {
        log.info(`DoorStatusWatcher: [Poll] Door status changed, updating RTDB`);
        await updateAllDoorsStatusInRTDB();
      }
    } catch (error) {
      log.error('DoorStatusWatcher: [Poll] Error during polling:', error);
    }
  }, POLLING_INTERVAL_MS);
}

/**
 * Check for door status changes and update RTDB (file watcher callback)
 */
async function checkForDoorStatusChanges(): Promise<void> {
  try {
    const content = fs.readFileSync(SERVICE_CONFIG_PATH, 'utf8');
    const config: ServiceConfig = JSON.parse(content);

    if (!config.doorStatus) {
      return;
    }

    // Build new status from file
    const newAllDoorsStatus = buildAllDoorsStatusFromFile(config.doorStatus);
    let hasChanges = false;

    // Check for changes
    for (const [doorNum, newStatus] of Object.entries(newAllDoorsStatus)) {
      const previousIsOpen = lastDoorStatus[doorNum];

      if (previousIsOpen !== undefined && previousIsOpen !== newStatus.isOpen) {
        log.info(`DoorStatusWatcher: Door ${doorNum} changed: isOpen=${newStatus.isOpen}`);
        hasChanges = true;
      }

      // Update tracking
      lastDoorStatus[doorNum] = newStatus.isOpen;
    }

    // Update current status
    currentAllDoorsStatus = newAllDoorsStatus;

    // If any door changed, update all doors in RTDB
    if (hasChanges) {
      await updateAllDoorsStatusInRTDB();
    }

  } catch (error) {
    log.error('DoorStatusWatcher: Error checking for changes:', error);
  }
}

/**
 * Update all doors status in Firebase RTDB
 * Writes to: license_{licenseId}/devices/{deviceId}/status
 * Format: { "1": {status}, "2": {status}, ... }
 */
async function updateAllDoorsStatusInRTDB(): Promise<void> {
  if (!databaseUrl || !licenseId || !deviceId) {
    log.warn('DoorStatusWatcher: Cannot update RTDB - missing configuration');
    return;
  }

  if (Object.keys(currentAllDoorsStatus).length === 0) {
    log.warn('DoorStatusWatcher: No doors to update');
    return;
  }

  try {
    const https = require('https');

    // Path: license_{licenseId}/devices/{deviceId}/status
    const statusPath = `license_${licenseId}/devices/${deviceId}/status.json`;
    let url = `${databaseUrl}/${statusPath}`;

    if (authToken) {
      url += `?auth=${authToken}`;
    }

    const statusData = JSON.stringify(currentAllDoorsStatus);

    log.info(`DoorStatusWatcher: Updating RTDB with ${Object.keys(currentAllDoorsStatus).length} doors`);

    return new Promise((resolve) => {
      const urlObj = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(statusData),
        },
      };

      const req = https.request(options, (response: any) => {
        if (response.statusCode === 200 || response.statusCode === 201) {
          log.info(`DoorStatusWatcher: [OK] All doors status updated in RTDB`);
          resolve();
        } else {
          log.error(`DoorStatusWatcher: Failed to update status, HTTP ${response.statusCode}`);

          // Handle 401 - token may be expired
          if (response.statusCode === 401) {
            log.warn('DoorStatusWatcher: Auth token may be expired');
          }
          resolve(); // Don't reject to avoid breaking the flow
        }
      });

      req.on('error', (error: Error) => {
        log.error('DoorStatusWatcher: Request error:', error);
        resolve(); // Don't reject to avoid breaking the flow
      });

      req.write(statusData);
      req.end();
    });

  } catch (error) {
    log.error('DoorStatusWatcher: Error updating RTDB:', error);
  }
}

/**
 * Stop the door status watcher
 */
export function stopDoorStatusWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
    log.info('DoorStatusWatcher: File watcher stopped');
  }

  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    log.info('DoorStatusWatcher: Polling interval stopped');
  }

  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  lastDoorStatus = {};
  currentAllDoorsStatus = {};
  pollCount = 0;
  log.info('DoorStatusWatcher: Service fully stopped');
}
