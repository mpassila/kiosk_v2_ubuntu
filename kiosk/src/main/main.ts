/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `npm run build` or `npm run build:main`, this file is compiled to
 * `./src/main.js` using webpack. This gives us some performance wins.
 */

import 'core-js/stable';
import 'regenerator-runtime/runtime';
import path from 'path';
import { app, BrowserWindow, shell, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import log from 'electron-log';
import { resolveHtmlPath } from './util';
import { SIDE_EVENTS_DIR, LOCAL_CONFIG_PATH as LOCAL_CONFIG, LOGS_DIR, CHECKOUT_MANIFEST_PATH, CHECKOUT_HISTORY_PATH, BACKUP_FILES_PATH, BACKUP_LICENSE_PATH, BACKUP_DEVICE_PATH, BACKUP_INTEGRATIONS_PATH } from './paths';
import config from '../../config';
import { Promise } from "bluebird";
import { getLockerStatus, openLockerDoor } from './lockerService';
import { initRTDBPubSub, subscribeRTDB, publishRTDB, unsubscribeRTDB, setIntegrations, updateAuthToken, setDeviceId, updateDeviceStatusInRTDB } from './rtdbPubSub';
import { initDoorStatusWatcher, updateDoorStatusWatcherToken, stopDoorStatusWatcher, setDoorStatusMainWindow } from './doorStatusWatcher';
import {
  initRfidService,
  setMainWindow as setRfidMainWindow,
  connectRfidReader,
  disconnectRfidReader,
  readRfidTags,
  readRfidTagsBrm,
  setRfidSecurity,
  getRfidReaderInfo,
  startContinuousScan,
  stopContinuousScan,
  rfidHealthCheck,
  getRfidConnectionStatus,
  cleanupRfidService
} from './rfidService';

import fs from 'fs';
const getmac = require('getmac');

let mainWindow: BrowserWindow | null = null;

// Load localConfig.json to check for testIsOfflineMode and testmode
const localConfigPath = LOCAL_CONFIG;
let localConfig: any = { testIsOfflineMode: false, testmode: false };
try {
  if (fs.existsSync(localConfigPath)) {
    const content = fs.readFileSync(localConfigPath, 'utf8');
    localConfig = JSON.parse(content);
    console.log('MAIN: localConfig.json, testIsOfflineMode:', localConfig.testIsOfflineMode || false, ', testmode:', localConfig.testmode || false);
  }
} catch (error) {
  console.error('MAIN: loading localConfig.json:', error);
}

// Offline mode tracking - set to true when using backup data due to network failures
// Also true if testIsOfflineMode is enabled in localConfig
let isMainOperatingOffline = localConfig.testIsOfflineMode || false;
if (localConfig.testIsOfflineMode) {
  console.log('MAIN: TEST OFFLINE MODE ENABLED - will use backup files');
}

// Helper to update offline status and notify renderer
function setOfflineStatus(offline: boolean) {
  if (isMainOperatingOffline !== offline) {
    isMainOperatingOffline = offline;
    console.log(`MAIN: Operating mode changed to: ${offline ? 'OFFLINE' : 'ONLINE'}`);
    // Notify renderer of status change
    if (mainWindow) {
      mainWindow.webContents.send('offline-status-changed', offline);
    }
  }
}

global = <any> {
  SideEvent: {
    licenseId: config.license_id,
    ipsWithMac: {},
    config: Object.assign(config),
    databaseUrl: null, // Will be set when first used
  }
};

export default class AppUpdater {
  constructor() {
    log.transports.file.level = 'info';
    log.transports.file.resolvePathFn = (variables: any) =>
      path.join(LOGS_DIR, variables.fileName);
    autoUpdater.logger = log;
    autoUpdater.checkForUpdatesAndNotify();

  };
}


ipcMain.on('ipc-example', async (event, arg) => {
  const msgTemplate = (pingPong: string) => `IPC test: ${pingPong}`;
  console.log(msgTemplate(arg));
  event.reply('ipc-example', msgTemplate('pong'));
});

// IPC handler to check if main is operating in offline mode
console.log('MAIN: isMainOperatingOffline IPC handler');
ipcMain.handle('isMainOperatingOffline', () => {
  console.log(`MAIN: status check - currently ${isMainOperatingOffline ? 'OFFLINE' : 'ONLINE'}`);
  return isMainOperatingOffline;
});

ipcMain.handle('setMainOfflineMode', (_event, offline: boolean) => {
  console.log(`MAIN: Manual offline mode toggle: ${offline ? 'OFFLINE' : 'ONLINE'}`);
  setOfflineStatus(offline);
  return isMainOperatingOffline;
});

// Checkout manifest for offline Hold mode
// CHECKOUT_MANIFEST_PATH imported from paths.ts

ipcMain.handle('appendCheckoutManifest', async (_event, lockerObject: any) => {
  try {
    ensureBackupDirectoryExists();
    let manifest: any[] = [];
    if (fs.existsSync(CHECKOUT_MANIFEST_PATH)) {
      const raw = fs.readFileSync(CHECKOUT_MANIFEST_PATH, 'utf-8');
      manifest = JSON.parse(raw);
    }
    manifest.push(lockerObject);
    fs.writeFileSync(CHECKOUT_MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    console.log(`MAIN: locker object to checkoutManifest.json (total: ${manifest.length})`);
    return { success: true, count: manifest.length };
  } catch (error: any) {
    console.error('MAIN: appending to checkoutManifest.json:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('getCheckoutManifest', async () => {
  try {
    if (fs.existsSync(CHECKOUT_MANIFEST_PATH)) {
      const raw = fs.readFileSync(CHECKOUT_MANIFEST_PATH, 'utf-8');
      return JSON.parse(raw);
    }
    return [];
  } catch (error: any) {
    console.error('MAIN: reading checkoutManifest.json:', error);
    return [];
  }
});

ipcMain.handle('clearCheckoutManifest', async () => {
  try {
    ensureBackupDirectoryExists();
    fs.writeFileSync(CHECKOUT_MANIFEST_PATH, JSON.stringify([], null, 2));
    console.log('MAIN: checkoutManifest.json');
    return { success: true };
  } catch (error: any) {
    console.error('MAIN: clearing checkoutManifest.json:', error);
    return { success: false, error: error.message };
  }
});

// CHECKOUT_HISTORY_PATH imported from paths.ts

ipcMain.handle('removeFirstFromCheckoutManifest', async () => {
  try {
    ensureBackupDirectoryExists();
    if (!fs.existsSync(CHECKOUT_MANIFEST_PATH)) return { success: true, removed: null };
    const raw = fs.readFileSync(CHECKOUT_MANIFEST_PATH, 'utf-8');
    const manifest: any[] = JSON.parse(raw);
    if (manifest.length === 0) return { success: true, removed: null };
    const removed = manifest.shift();
    fs.writeFileSync(CHECKOUT_MANIFEST_PATH, JSON.stringify(manifest, null, 2));
    console.log(`MAIN: first item from checkoutManifest.json (remaining: ${manifest.length})`);
    return { success: true, removed, remaining: manifest.length };
  } catch (error: any) {
    console.error('MAIN: removing from checkoutManifest.json:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('appendCheckoutHistory', async (_event, lockerObject: any) => {
  try {
    ensureBackupDirectoryExists();
    let history: any[] = [];
    if (fs.existsSync(CHECKOUT_HISTORY_PATH)) {
      const raw = fs.readFileSync(CHECKOUT_HISTORY_PATH, 'utf-8');
      history = JSON.parse(raw);
    }
    history.push({ ...lockerObject, processedAt: new Date().toISOString() });
    fs.writeFileSync(CHECKOUT_HISTORY_PATH, JSON.stringify(history, null, 2));
    console.log(`MAIN: to checkout history (total: ${history.length})`);
    return { success: true, count: history.length };
  } catch (error: any) {
    console.error('MAIN: appending to checkout history:', error);
    return { success: false, error: error.message };
  }
});

// RTDB pub/sub replaced the old Redis pub/sub
// Message processing is now handled in rtdbPubSub.ts module

// IPC handler to initialize RTDB pub/sub with database URL and optional auth token
ipcMain.on("initRTDB", (_event, databaseUrl, authToken) => {
  console.log("MAIN: RTDB PubSub with database URL:", databaseUrl);
  if (authToken) {
    console.log("MAIN: token provided for RTDB operations");
  }

  if (!mainWindow) {
    console.error("MAIN: initialize RTDB - main window not available");
    return;
  }

  try {
    initRTDBPubSub(databaseUrl, mainWindow, authToken);
    console.log("MAIN: RTDB PubSub initialized successfully");
  } catch (error) {
    console.error("MAIN: Error initializing RTDB PubSub:", error);
  }
});

// IPC handler to set integrations data in RTDB pub/sub
ipcMain.on("setRTDBIntegrations", (_event, integrations) => {
  console.log("MAIN: integrations data in RTDB PubSub");
  console.log(`MAIN: ${Object.keys(integrations || {}).length} integrations`);

  try {
    setIntegrations(integrations);
    console.log("MAIN: Integrations data set in RTDB PubSub successfully");
  } catch (error) {
    console.error("MAIN: Error setting integrations in RTDB PubSub:", error);
  }
});

// IPC handler to update auth token in RTDB pub/sub
ipcMain.on("updateRTDBAuthToken", (_event, newToken) => {
  console.log("MAIN: auth token in RTDB PubSub");

  try {
    updateAuthToken(newToken);
    // Also update token in door status watcher
    updateDoorStatusWatcherToken(newToken);
    console.log("MAIN: token updated in RTDB PubSub successfully");
  } catch (error) {
    console.error("MAIN: updating auth token in RTDB PubSub:", error);
  }
});

// IPC handler to resize window based on device displayScreenSize
ipcMain.on("setWindowSize", (_event, width: number, height: number) => {
  console.log(`MAIN: window to ${width}x${height}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setSize(width, height);
    mainWindow.center();
    // Only auto-calculate zoom if localConfig.zoomFactor is not defined
    if (localConfig.zoomFactor == null) {
      const zoomFactor = Math.min(width / 1920, height / 1080);
      console.log(`MAIN: zoom factor: ${zoomFactor.toFixed(3)}`);
      mainWindow.webContents.setZoomFactor(zoomFactor);
    }
  }
});

// IPC handler to initialize door status watcher
ipcMain.on("initDoorStatusWatcher", (_event, databaseUrl, authToken, licenseId, deviceId, lockerIp) => {
  console.log("MAIN: door status watcher");
  console.log(`   Database URL: ${databaseUrl}`);
  console.log(`   License ID: ${licenseId}`);
  console.log(`   Device ID: ${deviceId}`);
  console.log(`   Locker IP: ${lockerIp || 'not provided'}`);

  try {
    // Set device ID in RTDB PubSub for status updates
    setDeviceId(deviceId);

    if (localConfig.testmode) {
      console.log("MAIN: testmode: Skipping real door status watcher, sending simulated data");
      // Send initial simulated status to renderer
      if (mainWindow) {
        mainWindow.webContents.send('door-status-update', {
          lockers: buildTestmodeLockers(),
          timestamp: Date.now()
        });
      }
    } else {
      initDoorStatusWatcher(databaseUrl, authToken, licenseId, deviceId, lockerIp);
    }
    console.log("MAIN: status watcher initialized successfully");
  } catch (error) {
    console.error("MAIN: initializing door status watcher:", error);
  }
});

// IPC handler to subscribe to RTDB pub/sub channel
ipcMain.on("rtdbSub", async (_event, channel, licenseId) => {
  console.log("MAIN: to RTDB channel:", channel);
  console.log("MAIN: ID:", licenseId);

  try {
    await subscribeRTDB(channel, licenseId || config.license_id);
    console.log(`MAIN: Subscribed to RTDB channel: ${channel}`);
  } catch (error) {
    console.error(`MAIN: Error subscribing to RTDB channel ${channel}:`, error);
  }
});

// IPC handler to publish to RTDB pub/sub channel
ipcMain.on("rtdbPub", async (_event, input) => {
  const message = typeof input === 'string' ? JSON.parse(input) : input;
  console.log("MAIN: to RTDB channel:", message.channel);
  console.log("MAIN: type:", message.type);

  try {
    await publishRTDB(message.channel, message, message.licenseId || config.license_id);
    console.log(`MAIN: Published to RTDB channel: ${message.channel}`);
  } catch (error) {
    console.error(`MAIN: Error publishing to RTDB channel ${message.channel}:`, error);
  }
});

// IPC handler to download files from Firebase Storage without CORS restrictions
// Main process has no CORS restrictions, so we download here and send to renderer
// MUST be registered early, before app.whenReady()
// Includes offline backup support - saves to bu_files.json and reads from backup on failure
console.log('MAIN: downloadFile IPC handler');
// BACKUP_FILES_PATH imported from paths.ts

// Helper to load backup files index
function loadBackupFilesIndex(): Record<string, { base64: string; fileName: string; savedAt: string }> {
  try {
    if (fs.existsSync(BACKUP_FILES_PATH)) {
      const content = fs.readFileSync(BACKUP_FILES_PATH, 'utf8');
      return JSON.parse(content);
    }
  } catch (error) {
    console.error('MAIN: loading backup files index:', error);
  }
  return {};
}

// Helper to ensure backup directory exists
function ensureBackupDirectoryExists(): void {
  const backupDir = SIDE_EVENTS_DIR;
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
    console.log(`MAIN: backup directory: ${backupDir}`);
  }
}

// Helper to save to backup files index
function saveToBackupFilesIndex(url: string, base64: string, fileName: string): void {
  try {
    ensureBackupDirectoryExists();
    const index = loadBackupFilesIndex();
    index[url] = { base64, fileName, savedAt: new Date().toISOString() };
    fs.writeFileSync(BACKUP_FILES_PATH, JSON.stringify(index, null, 2));
    console.log(`MAIN: Saved file backup for: ${fileName}`);
  } catch (error) {
    console.error('MAIN: saving file backup:', error);
  }
}

ipcMain.handle('downloadFile', async (_event, url: string, fileName: string) => {
  console.log(`MAIN: file: ${fileName}`);
  console.log(`MAIN: ${url}`);

  // Load backup index once for this request
  const backupIndex = loadBackupFilesIndex();

  // If testIsOfflineMode is enabled, skip network and use backup directly
  if (localConfig.testIsOfflineMode) {
    console.log(`MAIN: TEST OFFLINE MODE - skipping network, using backup`);
    if (backupIndex[url]) {
      console.log(`MAIN: Using file backup for ${fileName} (test offline mode)`);
      setOfflineStatus(true);
      return backupIndex[url].base64;
    }
    throw new Error(`Test offline mode enabled but no backup found for: ${fileName}`);
  }

  try {
    const https = require('https');
    const http = require('http');

    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;

      protocol.get(url, (response: any) => {
        if (response.statusCode !== 200) {
          console.log(`MAIN: error ${response.statusCode}, checking backup...`);
          if (backupIndex[url]) {
            console.log(`MAIN: Using backup for ${fileName}`);
            resolve(backupIndex[url].base64);
            return;
          }
          reject(new Error(`HTTP error! status: ${response.statusCode}`));
          return;
        }

        const chunks: any[] = [];

        response.on('data', (chunk: any) => {
          chunks.push(chunk);
        });

        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const base64 = buffer.toString('base64');
          console.log(`MAIN: ${fileName} (${(buffer.length / 1024).toFixed(2)} KB)`);

          // Save to backup
          saveToBackupFilesIndex(url, base64, fileName);

          resolve(base64);
        });

        response.on('error', (error: Error) => {
          console.error(`MAIN: downloading ${fileName}:`, error);
          if (backupIndex[url]) {
            console.log(`MAIN: Using backup for ${fileName} after download error`);
            resolve(backupIndex[url].base64);
            return;
          }
          reject(error);
        });
      }).on('error', (error: Error) => {
        console.error(`MAIN: error for ${fileName}:`, error);
        if (backupIndex[url]) {
          console.log(`MAIN: Using backup for ${fileName} after network error`);
          resolve(backupIndex[url].base64);
          return;
        }
        reject(error);
      });
    });
  } catch (error: any) {
    console.error(`MAIN: downloading ${fileName}:`, error);
    if (backupIndex[url]) {
      console.log(`MAIN: Using backup for ${fileName} after exception`);
      return backupIndex[url].base64;
    }
    throw error;
  }
});

// IPC handler to load license from Firebase Firestore
// Includes offline backup support - saves to bu_license.json and reads from backup on failure
console.log('MAIN: loadLicenseFromFirestore IPC handler');
// BACKUP_LICENSE_PATH imported from paths.ts

// Store the current license database URL for use by other main process functions
let currentLicenseDatabaseUrl: string | null = null;

// Helper to save license backup
function saveLicenseBackup(license: any): void {
  try {
    ensureBackupDirectoryExists();
    const backupData = { ...license, savedAt: new Date().toISOString() };
    fs.writeFileSync(BACKUP_LICENSE_PATH, JSON.stringify(backupData, null, 2));
    console.log(`MAIN: Saved license backup to ${BACKUP_LICENSE_PATH}`);
  } catch (error) {
    console.error('MAIN: saving license backup:', error);
  }
}

// Helper to load license backup
function loadLicenseBackup(): any | null {
  try {
    if (fs.existsSync(BACKUP_LICENSE_PATH)) {
      const content = fs.readFileSync(BACKUP_LICENSE_PATH, 'utf8');
      const backup = JSON.parse(content);
      console.log(`MAIN: Loaded license backup (saved at: ${backup.savedAt})`);
      return backup;
    }
  } catch (error) {
    console.error('MAIN: loading license backup:', error);
  }
  return null;
}

ipcMain.handle('loadLicenseFromFirestore', async (_event, licenseId: string, projectId: string, apiKey?: string, authToken?: string) => {
  console.log(`MAIN: license from Firestore`);
  console.log(`   License ID: ${licenseId}`);
  console.log(`   Project ID: ${projectId}`);
  console.log(`   API Key: ${apiKey ? 'provided' : 'not provided'}`);
  console.log(`   Auth Token: ${authToken ? 'provided' : 'not provided'}`);

  // If testIsOfflineMode is enabled, skip network and use backup directly
  if (localConfig.testIsOfflineMode) {
    console.log(`MAIN: TEST OFFLINE MODE - skipping network, using backup`);
    const backup = loadLicenseBackup();
    if (backup) {
      console.log(`MAIN: Using license backup (test offline mode)`);
      setOfflineStatus(true);
      return backup;
    }
    throw new Error('Test offline mode enabled but no license backup found');
  }

  try {
    const https = require('https');

    // Firestore REST API URL - use API key for public read access
    let firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/licenses/${licenseId}`;
    if (apiKey) {
      firestoreUrl += `?key=${apiKey}`;
    }
    console.log(`MAIN: license from Firestore: ${firestoreUrl.replace(apiKey || '', '***')}`);

    return new Promise((resolve, reject) => {
      const options: any = {
        headers: {}
      };

      if (authToken) {
        options.headers['Authorization'] = `Bearer ${authToken}`;
      }

      https.get(firestoreUrl, options, (response: any) => {
        if (response.statusCode !== 200) {
          console.log(`MAIN: error ${response.statusCode}, checking license backup...`);
          const backup = loadLicenseBackup();
          if (backup) {
            console.log(`MAIN: Using license backup due to HTTP error`);
            setOfflineStatus(true);
            resolve(backup);
            return;
          }
          reject(new Error(`HTTP error! status: ${response.statusCode}`));
          return;
        }

        let data = '';

        response.on('data', (chunk: any) => {
          data += chunk;
        });

        response.on('end', () => {
          try {
            const firestoreDoc = JSON.parse(data);

            if (!firestoreDoc || !firestoreDoc.fields) {
              console.error(`MAIN: License not found: ${licenseId}`);
              const backup = loadLicenseBackup();
              if (backup) {
                console.log(`MAIN: Using license backup - license not found in Firestore`);
                setOfflineStatus(true);
                resolve(backup);
                return;
              }
              reject(new Error(`License not found: ${licenseId}`));
              return;
            }

            // Parse Firestore document format to plain object
            const fields = firestoreDoc.fields;
            const license = {
              id: licenseId,
              name: fields.name?.stringValue || '',
              description: fields.description?.stringValue || '',
              address: fields.address?.stringValue || '',
              contact: fields.contact?.stringValue || '',
              email: fields.email?.stringValue || '',
              isActive: fields.isActive?.booleanValue ?? true,
              databaseUrl: fields.databaseUrl?.stringValue || '',
              applications: fields.applications?.arrayValue?.values?.map((v: any) => v.stringValue) || [],
              createdAt: fields.createdAt?.timestampValue || new Date().toISOString(),
              updatedAt: fields.updatedAt?.timestampValue || new Date().toISOString(),
            };

            console.log(`MAIN: License loaded from Firestore:`, {
              id: license.id,
              name: license.name,
              databaseUrl: license.databaseUrl,
              isActive: license.isActive
            });

            // Store the database URL for use by other main process functions
            currentLicenseDatabaseUrl = license.databaseUrl;
            console.log(`MAIN: License database URL stored: ${currentLicenseDatabaseUrl}`);

            // Save to backup after successful load
            saveLicenseBackup(license);

            // Mark as online since we successfully fetched from Firestore
            setOfflineStatus(false);

            resolve(license);
          } catch (parseError) {
            console.error('MAIN: parsing license data:', parseError);
            const backup = loadLicenseBackup();
            if (backup) {
              console.log(`MAIN: Using license backup due to parse error`);
              setOfflineStatus(true);
              resolve(backup);
              return;
            }
            reject(parseError);
          }
        });

        response.on('error', (error: Error) => {
          console.error(`MAIN: loading license:`, error);
          const backup = loadLicenseBackup();
          if (backup) {
            console.log(`MAIN: Using license backup due to response error`);
            setOfflineStatus(true);
            resolve(backup);
            return;
          }
          reject(error);
        });
      }).on('error', (error: Error) => {
        console.error(`MAIN: error:`, error);
        const backup = loadLicenseBackup();
        if (backup) {
          console.log(`MAIN: Using license backup due to network error`);
          setOfflineStatus(true);
          resolve(backup);
          return;
        }
        reject(error);
      });
    });
  } catch (error: any) {
    console.error(`MAIN: in loadLicenseFromFirestore:`, error);
    const backup = loadLicenseBackup();
    if (backup) {
      console.log(`MAIN: Using license backup due to exception`);
      setOfflineStatus(true);
      return backup;
    }
    throw error;
  }
});

// IPC handler to set license database URL (for use by main process and to inform renderer)
console.log('MAIN: setLicenseDatabaseUrl IPC handler');
ipcMain.handle('setLicenseDatabaseUrl', async (_event, licenseId: string, databaseUrl: string) => {
  console.log(`MAIN: license database URL`);
  console.log(`   License ID: ${licenseId}`);
  console.log(`   Database URL: ${databaseUrl}`);

  currentLicenseDatabaseUrl = databaseUrl;

  // Also store in global SideEvent config
  if ((global as any).SideEvent) {
    (global as any).SideEvent.databaseUrl = databaseUrl;
    (global as any).SideEvent.licenseId = licenseId;
  }

  console.log(`MAIN: License database URL configured for license: ${licenseId}`);
  return { success: true, databaseUrl };
});

// IPC handler to get current license database URL
console.log('MAIN: getLicenseDatabaseUrl IPC handler');
ipcMain.handle('getLicenseDatabaseUrl', async () => {
  return currentLicenseDatabaseUrl;
});

// IPC handler to load device from Firebase Realtime DB
// Main process loads device and sends updates to renderer
// Includes offline backup support - saves to bu_device.json and reads from backup on failure
console.log('MAIN: loadDeviceFromFirebase IPC handler');
// BACKUP_DEVICE_PATH imported from paths.ts

// Helper to save device backup
function saveDeviceBackup(device: any): void {
  try {
    ensureBackupDirectoryExists();
    const backupData = { ...device, savedAt: new Date().toISOString() };
    fs.writeFileSync(BACKUP_DEVICE_PATH, JSON.stringify(backupData, null, 2));
    console.log(`MAIN: Saved device backup to ${BACKUP_DEVICE_PATH}`);
  } catch (error) {
    console.error('MAIN: saving device backup:', error);
  }
}

// Helper to load device backup
function loadDeviceBackup(): any | null {
  try {
    if (fs.existsSync(BACKUP_DEVICE_PATH)) {
      const content = fs.readFileSync(BACKUP_DEVICE_PATH, 'utf8');
      const backup = JSON.parse(content);
      console.log(`MAIN: Loaded device backup (saved at: ${backup.savedAt})`);
      return backup;
    }
  } catch (error) {
    console.error('MAIN: loading device backup:', error);
  }
  return null;
}

ipcMain.handle('loadDeviceFromFirebase', async (_event, licenseId: string, deviceId: string, databaseUrl: string, authToken?: string) => {
  console.log(`MAIN: device from Firebase Realtime DB`);
  console.log(`   License ID: ${licenseId}`);
  console.log(`   Device ID: ${deviceId}`);
  console.log(`   Database URL: ${databaseUrl}`);
  console.log(`   Auth Token: ${authToken ? 'provided' : 'not provided'}`);

  // If testIsOfflineMode is enabled, skip network and use backup directly
  if (localConfig.testIsOfflineMode) {
    console.log(`MAIN: TEST OFFLINE MODE - skipping network, using backup`);
    const backup = loadDeviceBackup();
    if (backup) {
      console.log(`MAIN: Using device backup (test offline mode)`);
      setOfflineStatus(true);
      return backup;
    }
    throw new Error('Test offline mode enabled but no device backup found');
  }

  try {
    const https = require('https');

    // Construct Firebase Realtime DB REST API URL
    // deviceId IS the document key - fetch directly from license_{licenseId}/devices/{deviceId}
    const path = `license_${licenseId}/devices/${deviceId}`;
    const url = authToken ? `${databaseUrl}/${path}.json?auth=${authToken}` : `${databaseUrl}/${path}.json`;

    console.log(`MAIN: device directly from URL: ${databaseUrl}/${path}.json${authToken ? '?auth=***' : ''}`);

    return new Promise((resolve, reject) => {
      const req = https.get(url, (response: any) => {
        if (response.statusCode !== 200) {
          console.log(`MAIN: error ${response.statusCode}, checking device backup...`);
          const backup = loadDeviceBackup();
          if (backup) {
            console.log(`MAIN: Using device backup due to HTTP error`);
            setOfflineStatus(true);
            resolve(backup);
            return;
          }
          reject(new Error(`HTTP error! status: ${response.statusCode}`));
          return;
        }

        let data = '';

        response.on('data', (chunk: any) => {
          data += chunk;
        });

        response.on('end', () => {
          try {
            const deviceData = JSON.parse(data);

            if (!deviceData) {
              console.error(`MAIN: Device not found at path: ${path}`);
              const backup = loadDeviceBackup();
              if (backup) {
                console.log(`MAIN: Using device backup - device not found in Firebase`);
                setOfflineStatus(true);
                resolve(backup);
                return;
              }
              reject(new Error(`Device not found: ${deviceId}`));
              return;
            }

            console.log(`MAIN: Found device at key: ${deviceId}`);

            const device = {
              id: deviceId,
              deviceId: deviceId, // device.id is the only identifier
              licenseId: licenseId,
              settings: deviceData.settings || null,
              manifest: deviceData.manifest || null,
              thedoors: deviceData.thedoors || [],
              homescreen: deviceData.homescreen || null,
              posters: deviceData.posters || null,
              name: deviceData.name || null,
              mac: deviceData.mac || null,
              status: deviceData.status || null,
              createdAt: deviceData.createdAt || null,
              updatedAt: deviceData.updatedAt || null,
              enabled: deviceData.enabled !== false,
              scannedinput: deviceData.scannedinput || null
            };

            console.log(`MAIN: loaded:`, {
              deviceId: device.deviceId,
              hasManifest: !!device.manifest,
              hasGroups: !!device.manifest?.groups,
              groupsCount: device.manifest?.groups ?
                (Array.isArray(device.manifest.groups) ?
                  device.manifest.groups.length :
                  Object.keys(device.manifest.groups).length) : 0,
              doorsCount: device.thedoors?.length || 0,
              hasHomescreen: !!device.homescreen,
              homescreenEnabled: device.homescreen?.enabled
            });

            // Save to backup after successful load
            saveDeviceBackup(device);

            // Mark as online since we successfully fetched from Firebase
            setOfflineStatus(false);

            resolve(device);
          } catch (parseError) {
            console.error('MAIN: parsing device data:', parseError);
            const backup = loadDeviceBackup();
            if (backup) {
              console.log(`MAIN: Using device backup due to parse error`);
              setOfflineStatus(true);
              resolve(backup);
              return;
            }
            reject(parseError);
          }
        });

        response.on('error', (error: Error) => {
          console.error(`MAIN: loading device:`, error);
          const backup = loadDeviceBackup();
          if (backup) {
            console.log(`MAIN: Using device backup due to response error`);
            setOfflineStatus(true);
            resolve(backup);
            return;
          }
          reject(error);
        });
      }).on('error', (error: Error) => {
        console.error(`MAIN: error:`, error);
        const backup = loadDeviceBackup();
        if (backup) {
          console.log(`MAIN: Using device backup due to network error`);
          setOfflineStatus(true);
          resolve(backup);
          return;
        }
        reject(error);
      });

      // Timeout after 15 seconds — fall back to backup instead of hanging
      req.setTimeout(15000, () => {
        req.destroy();
        console.error(`MAIN: device load timed out after 15s`);
        const backup = loadDeviceBackup();
        if (backup) {
          console.log(`MAIN: Using device backup due to timeout`);
          setOfflineStatus(true);
          resolve(backup);
          return;
        }
        reject(new Error('Device load timed out'));
      });
    });
  } catch (error: any) {
    console.error(`MAIN: in loadDeviceFromFirebase:`, error);
    const backup = loadDeviceBackup();
    if (backup) {
      console.log(`MAIN: Using device backup due to exception`);
      setOfflineStatus(true);
      return backup;
    }
    throw error;
  }
});

// IPC handler to update device manifest in Firebase Realtime DB
console.log('MAIN: updateDeviceManifestInFirebase IPC handler');
ipcMain.handle('updateDeviceManifestInFirebase', async (_event, licenseId: string, deviceKey: string, manifest: any, databaseUrl: string, authToken: string) => {
  console.log(`MAIN: device manifest in Firebase Realtime DB`);
  console.log(`   License ID: ${licenseId}`);
  console.log(`   Device Key: ${deviceKey}`);
  console.log(`   Database URL: ${databaseUrl}`);

  try {
    const https = require('https');

    // Construct Firebase Realtime DB REST API URL for manifest update
    // Path: license_{licenseId}/devices/{deviceKey}/manifest
    // Add auth token as query parameter
    const path = `license_${licenseId}/devices/${deviceKey}/manifest`;
    const url = `${databaseUrl}/${path}.json?auth=${authToken}`;

    console.log(`MAIN: manifest at URL: ${databaseUrl}/${path}.json?auth=***`);

    const data = JSON.stringify(manifest);

    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length
        }
      };

      const req = https.request(options, (response: any) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP error! status: ${response.statusCode}`));
          return;
        }

        let responseData = '';

        response.on('data', (chunk: any) => {
          responseData += chunk;
        });

        response.on('end', () => {
          try {
            const result = JSON.parse(responseData);
            console.log(`MAIN: Manifest updated successfully in Firebase Realtime DB`);
            resolve(result);
          } catch (parseError) {
            console.error('MAIN: parsing response:', parseError);
            reject(parseError);
          }
        });

        response.on('error', (error: Error) => {
          console.error(`MAIN: updating manifest:`, error);
          reject(error);
        });
      });

      req.on('error', (error: Error) => {
        console.error(`MAIN: error:`, error);
        reject(error);
      });

      req.write(data);
      req.end();
    });
  } catch (error: any) {
    console.error(`MAIN: in updateDeviceManifestInFirebase:`, error);
    throw error;
  }
});

// IPC handler to update device thedoors in Firebase Realtime DB
console.log('MAIN: updateDeviceTheDoorsInFirebase IPC handler');
ipcMain.handle('updateDeviceTheDoorsInFirebase', async (_event, licenseId: string, deviceKey: string, thedoors: any, databaseUrl: string, authToken: string) => {
  console.log(`MAIN: device thedoors in Firebase Realtime DB`);
  console.log(`   License ID: ${licenseId}`);
  console.log(`   Device Key: ${deviceKey}`);
  console.log(`   Database URL: ${databaseUrl}`);

  try {
    const https = require('https');

    // Construct Firebase Realtime DB REST API URL for thedoors update
    // Path: license_{licenseId}/devices/{deviceKey}/thedoors
    // Add auth token as query parameter
    const path = `license_${licenseId}/devices/${deviceKey}/thedoors`;
    const url = `${databaseUrl}/${path}.json?auth=${authToken}`;

    console.log(`MAIN: thedoors at URL: ${databaseUrl}/${path}.json?auth=***`);

    const data = JSON.stringify(thedoors);

    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length
        }
      };

      const req = https.request(options, (response: any) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP error! status: ${response.statusCode}`));
          return;
        }

        let responseData = '';

        response.on('data', (chunk: any) => {
          responseData += chunk;
        });

        response.on('end', () => {
          try {
            const result = JSON.parse(responseData);
            console.log(`MAIN: Thedoors updated successfully in Firebase Realtime DB`);
            resolve(result);
          } catch (parseError) {
            console.error('MAIN: parsing response:', parseError);
            reject(parseError);
          }
        });

        response.on('error', (error: Error) => {
          console.error(`MAIN: updating thedoors:`, error);
          reject(error);
        });
      });

      req.on('error', (error: Error) => {
        console.error(`MAIN: error:`, error);
        reject(error);
      });

      req.write(data);
      req.end();
    });
  } catch (error: any) {
    console.error(`MAIN: in updateDeviceTheDoorsInFirebase:`, error);
    throw error;
  }
});

// IPC handler to load integrations from Firebase Realtime DB
// Includes offline backup support - saves to bu_integrations.json and reads from backup on failure
console.log('MAIN: loadIntegrations IPC handler');
// BACKUP_INTEGRATIONS_PATH imported from paths.ts

// Helper to save integrations backup
function saveIntegrationsBackup(integrations: any, licenseId: string): void {
  try {
    ensureBackupDirectoryExists();
    const backupData = { integrations, licenseId, savedAt: new Date().toISOString() };
    fs.writeFileSync(BACKUP_INTEGRATIONS_PATH, JSON.stringify(backupData, null, 2));
    console.log(`MAIN: Saved integrations backup to ${BACKUP_INTEGRATIONS_PATH}`);
  } catch (error) {
    console.error('MAIN: saving integrations backup:', error);
  }
}

// Helper to load integrations backup
function loadIntegrationsBackup(): any | null {
  try {
    if (fs.existsSync(BACKUP_INTEGRATIONS_PATH)) {
      const content = fs.readFileSync(BACKUP_INTEGRATIONS_PATH, 'utf8');
      const backup = JSON.parse(content);
      console.log(`MAIN: Loaded integrations backup (saved at: ${backup.savedAt})`);
      return backup.integrations;
    }
  } catch (error) {
    console.error('MAIN: loading integrations backup:', error);
  }
  return null;
}

ipcMain.handle('loadIntegrations', async (_event, licenseId: string, databaseUrl?: string) => {
  console.log(`MAIN: integrations for License ID: ${licenseId}`);

  // If testIsOfflineMode is enabled, skip network and use backup directly
  if (localConfig.testIsOfflineMode) {
    console.log(`MAIN: TEST OFFLINE MODE - skipping network, using backup`);
    const backup = loadIntegrationsBackup();
    if (backup) {
      console.log(`MAIN: Using integrations backup (test offline mode)`);
      setOfflineStatus(true);
      return backup;
    }
    throw new Error('Test offline mode enabled but no integrations backup found');
  }

  try {
    const https = require('https');

    // Use provided databaseUrl or get from global
    let effectiveDatabaseUrl = databaseUrl;
    if (!effectiveDatabaseUrl) {
      effectiveDatabaseUrl = (global as any).SideEvent?.databaseUrl;
      if (!effectiveDatabaseUrl) {
        // Try backup if no database URL available
        const backup = loadIntegrationsBackup();
        if (backup) {
          console.log(`MAIN: Using integrations backup - no database URL available`);
          setOfflineStatus(true);
          return backup;
        }
        throw new Error('Database URL not provided and not found in global config');
      }
      console.log(`MAIN: cached database URL from global config`);
    } else {
      // Store for future use
      if ((global as any).SideEvent) {
        (global as any).SideEvent.databaseUrl = databaseUrl;
        console.log(`MAIN: database URL in global config for future use`);
      }
    }

    console.log(`   Database URL: ${effectiveDatabaseUrl}`);

    // Try both possible paths for integrations
    // 1. licenses/{licenseId}/integrations (plural, as mentioned by user)
    // 2. license_{licenseId}/integrations (singular with underscore, matching device path)
    const paths = [
      `licenses/${licenseId}/integrations`,
      `license_${licenseId}/integrations`
    ];

    let networkError = false;

    // Try each path in order
    for (const path of paths) {
      const url = `${effectiveDatabaseUrl}/${path}.json`;
      console.log(`MAIN: URL: ${url}`);

      try {
        const result = await new Promise<any>((resolve, reject) => {
          https.get(url, (response: any) => {
            if (response.statusCode === 404) {
              // Not found at this path, try next
              resolve(null);
              return;
            }

            if (response.statusCode !== 200) {
              reject(new Error(`HTTP error! status: ${response.statusCode}`));
              return;
            }

            let data = '';

            response.on('data', (chunk: any) => {
              data += chunk;
            });

            response.on('end', () => {
              try {
                const integrationsData = JSON.parse(data);

                if (!integrationsData || integrationsData === null) {
                  // Empty response, try next path
                  resolve(null);
                  return;
                }

                console.log(`MAIN: Found ${Object.keys(integrationsData).length} integrations at path: ${path}`);
                console.log(`MAIN: keys:`, Object.keys(integrationsData));

                resolve(integrationsData);
              } catch (parseError) {
                console.error('MAIN: parsing integrations data:', parseError);
                reject(parseError);
              }
            });

            response.on('error', (error: Error) => {
              console.error(`MAIN: loading integrations:`, error);
              reject(error);
            });
          }).on('error', (error: Error) => {
            console.error(`MAIN: error:`, error);
            networkError = true;
            reject(error);
          });
        });

        if (result) {
          // Found integrations at this path - save to backup
          saveIntegrationsBackup(result, licenseId);
          setOfflineStatus(false);
          return result;
        }
      } catch (error) {
        console.error(`MAIN: trying path ${path}:`, error);
        networkError = true;
        // Continue to next path
      }
    }

    // No integrations found at any path - check backup if network error
    if (networkError) {
      const backup = loadIntegrationsBackup();
      if (backup) {
        console.log(`MAIN: Using integrations backup due to network error`);
        setOfflineStatus(true);
        return backup;
      }
    }

    console.log('MAIN: integrations found in Firebase Realtime DB at any path');
    return {};
  } catch (error: any) {
    console.error(`MAIN: in loadIntegrations:`, error);
    // Try backup as last resort
    const backup = loadIntegrationsBackup();
    if (backup) {
      console.log(`MAIN: Using integrations backup due to exception`);
      setOfflineStatus(true);
      return backup;
    }
    throw error;
  }
});

// Testmode: track which doors are currently simulated-open
const testmodeOpenDoors = new Set<number>();

function buildTestmodeLockers() {
  return Array.from({ length: 99 }, (_, i) => ({
    alarm: false,
    locked: !testmodeOpenDoors.has(i + 1),
    number: i + 1,
    online: true
  }));
}

// IPC handler to get locker status
console.log('MAIN: getLockerStatus IPC handler');
ipcMain.handle('getLockerStatus', async (_event, mac: string, ip?: string, licenseId?: string) => {
  console.log(`MAIN: locker status for MAC: ${mac}, IP: ${ip || 'N/A'}`);

  // In testmode, return simulated status reflecting currently open doors
  if (localConfig.testmode) {
    const openDoors = [...testmodeOpenDoors];
    console.log(`MAIN: testmode: getLockerStatus - open doors: [${openDoors.join(', ') || 'none'}]`);
    const simulatedLockers = buildTestmodeLockers();
    return {
      content: { lockers: simulatedLockers },
      type: 'status'
    };
  }

  try {
    const status = await getLockerStatus(mac, ip);
    console.log(`MAIN: Locker status retrieved successfully`);
    console.log(`MAIN: status result:`, JSON.stringify(status));

    // Update device status in RTDB after getting status
    if (status?.content?.lockers) {
      console.log(`MAIN: ${status.content.lockers.length} lockers in response`);
      const lid = licenseId || config.license_id || '2';
      await updateDeviceStatusInRTDB(status, mac, lid);
    } else {
      console.log(`MAIN: lockers found in response. Status structure:`, Object.keys(status || {}));
    }

    return status;
  } catch (error: any) {
    console.error(`MAIN: getting locker status:`, error.message || error);
    throw error;
  }
});

// IPC handler to open locker door
console.log('MAIN: openLockerDoor IPC handler');
ipcMain.handle('openLockerDoor', async (_event, doorNumber: number, mac: string, ip?: string, licenseId?: string) => {
  console.log(`MAIN: locker door ${doorNumber} for MAC: ${mac}, IP: ${ip || 'N/A'}`);

  if (localConfig.testmode) {
    console.log(`MAIN: testmode: openLockerDoor(${doorNumber}) - simulated success`);

    // Track door as open
    testmodeOpenDoors.add(doorNumber);

    if (mainWindow && !mainWindow.isDestroyed()) {
      // Door opens immediately
      mainWindow.webContents.send('door-status-update', {
        lockers: buildTestmodeLockers(),
        timestamp: Date.now()
      });
      console.log(`MAIN: testmode: door ${doorNumber} status > OPEN (open doors: [${[...testmodeOpenDoors].join(', ')}])`);

      // Door closes after 5 seconds
      setTimeout(() => {
        testmodeOpenDoors.delete(doorNumber);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('door-status-update', {
            lockers: buildTestmodeLockers(),
            timestamp: Date.now()
          });
          console.log(`MAIN: testmode: door ${doorNumber} status > CLOSED (open doors: [${[...testmodeOpenDoors].join(', ') || 'none'}])`);
        }
      }, 5000);
    }

    return { success: true, status: null };
  }

  try {
    const result = await openLockerDoor(doorNumber, mac, ip);
    console.log(`MAIN: Locker door ${doorNumber} opened successfully`);

    // Update device status in RTDB after door opens
    if (result.status) {
      const lid = licenseId || config.license_id || '2';
      console.log(`MAIN: device status in RTDB for license: ${lid}`);
      await updateDeviceStatusInRTDB(result.status, mac, lid);
    }

    return result;
  } catch (error: any) {
    console.error(`MAIN: opening locker door:`, error);
    throw error;
  }
});

// IPC handler to update localConfig.json with macs property and integrations array
console.log('MAIN: updateLocalConfigMacs IPC handler');
ipcMain.handle('updateLocalConfigMacs', async (_event, macsString: string, integrationsData: Array<{ip: string, mac: string}>) => {
  console.log(`MAIN: localConfig.json with macs: ${macsString}`);
  console.log(`MAIN: data:`, integrationsData);

  try {
    const fs = require('fs');
    const path = require('path');

    // Path to localConfig.json - uses platform-specific SideEvents directory
    const localConfigPath = LOCAL_CONFIG;

    console.log(`MAIN: path: ${localConfigPath}`);

    // Read existing localConfig.json
    let localConfig: any = {};
    if (fs.existsSync(localConfigPath)) {
      const fileContent = fs.readFileSync(localConfigPath, 'utf8');
      localConfig = JSON.parse(fileContent);
      console.log(`MAIN: existing localConfig.json:`, localConfig);
    } else {
      console.log(`MAIN: does not exist at ${localConfigPath}, creating new one`);
      // Ensure directory exists
      const dir = path.dirname(localConfigPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`MAIN: directory ${dir}`);
      }
      // Set default values for new config
      localConfig.customStaffPin = "123456";
      localConfig.deviceId = "1760724910566_xsnvrb0l5";
      localConfig.licenseId = 2;
    }

    // Update macs property with comma-separated string of all macIds
    localConfig.macs = macsString;

    // Update integrations array with IP and MAC data
    localConfig.integrations = integrationsData;

    // Write back to file with pretty formatting
    fs.writeFileSync(localConfigPath, JSON.stringify(localConfig, null, 2));
    console.log(`MAIN: Updated localConfig.json with macs:`, macsString);
    console.log(`MAIN: Updated localConfig.json with ${integrationsData.length} integrations`);

    return { success: true, macs: macsString, integrations: integrationsData };
  } catch (error: any) {
    console.error(`MAIN: updating localConfig.json:`, error);
    throw error;
  }
});

ipcMain.on("setMyGlobalPort", (_event, myGlobalVariableValue) => {
  console.log("Init setMyGlobalPort defined, open port ", myGlobalVariableValue);

  const { SerialPort } = require('serialport');
  const port = new SerialPort({ path: myGlobalVariableValue, baudRate: 57600, autoOpen: false, endOnClose: true });
  port.open();

  port.on('open', function () {
    console.log("setMyGlobalPort connected");
  });

  port.on('close', function () {
    console.log("setMyGlobalPort close");
  });

  port.on('error', async function () {
    console.log("setMyGlobalPort error");
  });

  port.on('data', function (data:any) {
    const result = data.toString('utf8');
    console.log("setMyGlobalPort data", result);
    mainWindow?.webContents.send('setMyGlobalPort-listener', result.toString())
  });
});

// ============================================================================
// RFID Service IPC Handlers
// ============================================================================

// Initialize RFID WebSocket service
ipcMain.handle('initRfidService', async () => {
  console.log('MAIN: RFID service');
  return await initRfidService();
});

// Connect to RFID reader
ipcMain.handle('connectRfidReader', async () => {
  console.log('MAIN: to RFID reader');
  return await connectRfidReader();
});

// Disconnect from RFID reader
ipcMain.handle('disconnectRfidReader', async () => {
  console.log('MAIN: from RFID reader');
  return await disconnectRfidReader();
});

// Read all RFID tags
ipcMain.handle('readRfidTags', async () => {
  console.log('MAIN: RFID tags');
  return await readRfidTags();
});

// Read RFID tags using BRM (Buffer Read Mode)
ipcMain.handle('readRfidTagsBrm', async (_event, readTime: number = 2000) => {
  console.log(`MAIN: RFID tags (BRM, ${readTime}ms)`);
  return await readRfidTagsBrm(readTime);
});

// Set RFID security (AFI)
ipcMain.handle('setRfidSecurity', async (_event, security: boolean, tagId?: string) => {
  console.log(`MAIN: RFID security: ${security}, tagId: ${tagId || 'all'}`);
  return await setRfidSecurity(security, tagId);
});

// Get RFID reader info
ipcMain.handle('getRfidReaderInfo', async () => {
  console.log('MAIN: RFID reader info');
  return await getRfidReaderInfo();
});

// Start continuous RFID scanning
ipcMain.handle('startRfidContinuousScan', async (_event, interval: number = 1) => {
  console.log(`MAIN: continuous RFID scan (interval: ${interval}s)`);
  return await startContinuousScan(interval);
});

// Stop continuous RFID scanning
ipcMain.handle('stopRfidContinuousScan', async () => {
  console.log('MAIN: continuous RFID scan');
  return await stopContinuousScan();
});

// RFID health check
ipcMain.handle('rfidHealthCheck', async () => {
  console.log('MAIN: health check');
  return await rfidHealthCheck();
});

// Get RFID connection status
ipcMain.handle('getRfidConnectionStatus', () => {
  return getRfidConnectionStatus();
});

// ============================================================================

if (process.env.NODE_ENV === 'production') {
  const sourceMapSupport = require('source-map-support');
  sourceMapSupport.install();
}

const isDevelopment = process.env.NODE_ENV === 'development' || process.env.DEBUG_PROD === 'true';
const createWindow = async () => {
  const RESOURCES_PATH = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');

  const getAssetPath = (...paths: string[]): string => {
    return path.join(RESOURCES_PATH, ...paths);
  };

  // Use cached localConfig (already loaded at startup) for window dimensions
  let windowWidth = localConfig.width || 1920;
  let windowHeight = localConfig.height || 1080;
  let windowFullscreen = localConfig.fullscreen !== undefined ? localConfig.fullscreen : true;
  const windowOrientation = localConfig.orientation || 'landscape';

  // Swap width/height for portrait mode
  if (windowOrientation === 'portrait' && windowWidth > windowHeight) {
    [windowWidth, windowHeight] = [windowHeight, windowWidth];
  }

  // Create localConfig.json with defaults if it doesn't exist
  if (!fs.existsSync(localConfigPath)) {
    try {
      const dir = path.dirname(localConfigPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const defaultConfig = {
        width: 1920, height: 1080, fullscreen: true, orientation: "landscape",
        customStaffPin: "123456", deviceId: "1760724910566_xsnvrb0l5",
        licenseId: 2, testmode: false, testIsOfflineMode: false
      };
      fs.writeFileSync(localConfigPath, JSON.stringify(defaultConfig, null, 2));
      console.log(`MAIN: localConfig.json with default dimensions`);
    } catch (error) {
      console.error('MAIN: creating default localConfig.json:', error);
    }
  }

  console.log(`MAIN: config: ${windowWidth}x${windowHeight}, fullscreen: ${windowFullscreen}, orientation: ${windowOrientation}`);

  mainWindow = new BrowserWindow({
    show: false,
    width: windowWidth,
    height: windowHeight,
    fullscreen: windowFullscreen,
    autoHideMenuBar: true,
    // icon: getAssetPath('lyngsoe.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false, // Disable web security to allow Firebase Storage downloads (no CORS)
    },
  });

  mainWindow.loadURL(resolveHtmlPath('index.html'));

  // Apply zoomFactor from localConfig if defined
  if (localConfig.zoomFactor != null) {
    mainWindow.webContents.on('did-finish-load', () => {
      console.log(`MAIN: zoomFactor from localConfig: ${localConfig.zoomFactor}`);
      mainWindow!.webContents.setZoomFactor(localConfig.zoomFactor);
    });
  }

  // Initialize RTDB PubSub when license data is available
  // This will be called from renderer after license is loaded
  console.log('MAIN: window created, waiting for RTDB initialization from renderer');

  // Set main window reference for RFID service
  setRfidMainWindow(mainWindow);
  setDoorStatusMainWindow(mainWindow);

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      // Apply fullscreen if configured in localConfig.json
      if (windowFullscreen) {
        mainWindow.maximize();
        mainWindow.setFullScreen(true);
        mainWindow.setAlwaysOnTop(true);
      } else {
        mainWindow.setAlwaysOnTop(isDevelopment ? false : true);
      }
      mainWindow.show();
    }

    // Open DevTools if --devtools flag, DEVTOOLS env, or localConfig.kioskDebug is set
    if (process.argv.includes('--devtools') || process.env.DEVTOOLS || localConfig.kioskDebug) {
      mainWindow.webContents.openDevTools({ mode: 'bottom' });
    }
  });

  // Open urls in the user's browser
  mainWindow.webContents.on('new-window', (event, url) => {
    event.preventDefault();
    shell.openExternal(url);
  });

  // Remove this if your app does not use auto updates
  // eslint-disable-next-line
  new AppUpdater();
};

/**
 * Add event listeners...
 */

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Disable web security for Firebase Storage CORS (development & production)
app.commandLine.appendSwitch('disable-web-security');
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');

app
  .whenReady()
  .then(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const myProcess: any = process.env;
    myProcess.ELECTRON_DISABLE_SECURITY_WARNINGS = true;
    createWindow();
    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (mainWindow === null) createWindow();
    });
  })
  .catch(console.log);
