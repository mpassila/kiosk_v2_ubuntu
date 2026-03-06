/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable func-names */
/* eslint-disable @typescript-eslint/no-loop-func */
/* eslint-disable consistent-return */
/* eslint-disable no-restricted-syntax */
/* eslint-disable @typescript-eslint/no-use-before-define */
/* eslint-disable no-console */
/* eslint-disable no-param-reassign */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-shadow */

const { contextBridge, ipcRenderer, remote } = require('electron');
const fs = require('fs');
const moment = require('moment');

// Optional native modules - may not be available on all platforms
let si, cmd, getmac, SerialPort;
try { si = require('systeminformation'); } catch (e) { console.warn('PRELOAD: systeminformation not available:', e.message); }
try { cmd = require('node-cmd'); } catch (e) { console.warn('PRELOAD: node-cmd not available:', e.message); }
try { getmac = require('getmac'); } catch (e) { console.warn('PRELOAD: getmac not available:', e.message); }
try { ({ SerialPort } = require('serialport')); } catch (e) { console.warn('PRELOAD: serialport not available:', e.message); }
let serialPortData = null;
let isConnected = false;
let init = true;
let timeoutTimer;
let port;
let scanResults = {};

// Load localConfig from platform-specific SideEvents directory
// Windows: C:\SideEvents\localConfig.json
// Linux:   ~/SideEvents/localConfig.json
const os = require('os');
const pathModule = require('path');

const sideEventsDir = process.platform === 'win32'
  ? 'C:\\SideEvents'
  : pathModule.join(os.homedir(), 'SideEvents');

const defaultLocalConfig = {
  width: 1920,
  height: 1080,
  fullscreen: false,
  orientation: 'portrait',
  customStaffPin: '123456',
  deviceId: '1760724910566_xsnvrb0l5',
  licenseId: 2,
  macs: '',
  integrations: [],
  testIsOfflineMode: false,  // Set to true to simulate offline mode (uses backup files)
  testmode: false  // Set to true to simulate door operations (no real hardware)
};

let loadedLocalConfig = { ...defaultLocalConfig };
const localConfigPath = pathModule.join(sideEventsDir, 'localConfig.json');

try {
  if (fs.existsSync(localConfigPath)) {
    const fileContent = fs.readFileSync(localConfigPath, 'utf8');
    const parsedConfig = JSON.parse(fileContent);
    loadedLocalConfig = { ...defaultLocalConfig, ...parsedConfig };
    console.log('PRELOAD: Loaded localConfig from:', localConfigPath);
    console.log('PRELOAD: deviceId:', loadedLocalConfig.deviceId);
    console.log('PRELOAD: licenseId:', loadedLocalConfig.licenseId);
    console.log('PRELOAD: testmode:', loadedLocalConfig.testmode);
  } else {
    console.log('PRELOAD: localConfig.json not found at', localConfigPath, '- using defaults');
    // Create the file with defaults
    if (!fs.existsSync(sideEventsDir)) {
      fs.mkdirSync(sideEventsDir, { recursive: true });
    }
    fs.writeFileSync(localConfigPath, JSON.stringify(defaultLocalConfig, null, 2));
    console.log('PRELOAD: Created default localConfig.json at:', localConfigPath);
  }
} catch (error) {
  console.error('PRELOAD: Error loading localConfig.json:', error);
  console.log('PRELOAD: Using default config values');
}

contextBridge.exposeInMainWorld('electronAPI', {
  // Expose localConfig to renderer process
  getLocalConfig: () => loadedLocalConfig,

  onUpdateBarcodeScanner: (callback) => ipcRenderer.on('setMyGlobalPort-listener', (_event, value) => {
    const result = value.toString('utf8');
    processBarcodeScannerResult(result.toString());
    if (!serialPortData[result]) {
      serialPortData[result] = true;
      callback(result)
    }
  }),

  onUpdateRedis: (callback) => ipcRenderer.on('redis-kiosk-listener', (_event, value) => {

    const result = value.toString('utf8');
    console.log('you are now at preload ipcRenderer.on message to "redis-kiosk-listener"... will run callback next')
    console.log(result)
    callback(result)
  }),

  onTokenRefreshNeeded: (callback) => ipcRenderer.on('rtdb-token-refresh-needed', () => {
    console.log('PRELOAD: Token refresh requested by main process');
    callback();
  }),

  onClientCommand: (callback) => ipcRenderer.on('rtdb-client-command', (_event, value) => {
    console.log('PRELOAD: Client command received from main process');
    callback(value);
  }),

  counterValue: (value) => ipcRenderer.send('counter-value', value),

  // RFID event listeners
  onRfidTagRead: (callback) => ipcRenderer.on('rfid-tag-read', (_event, value) => {
    console.log('PRELOAD: RFID tag read event received');
    callback(value);
  }),

  onRfidConnectionStatus: (callback) => ipcRenderer.on('rfid-connection-status', (_event, value) => {
    console.log('PRELOAD: RFID connection status event received:', value);
    callback(value);
  }),

  onRfidMessage: (callback) => ipcRenderer.on('rfid-message', (_event, value) => {
    console.log('PRELOAD: RFID message event received');
    callback(value);
  }),

  // Offline status change listener
  onOfflineStatusChanged: (callback) => ipcRenderer.on('offline-status-changed', (_event, isOffline) => {
    console.log('PRELOAD: Offline status changed:', isOffline ? 'OFFLINE' : 'ONLINE');
    callback(isOffline);
  }),

  // Door status update from doorStatusWatcher (main process HTTP poll)
  onDoorStatusUpdate: (callback) => ipcRenderer.on('door-status-update', (_event, data) => {
    callback(data);
  }),

  // Resize window based on device displayScreenSize
  setWindowSize: (width, height) => {
    console.log(`PRELOAD: Setting window size to ${width}x${height}`);
    ipcRenderer.send('setWindowSize', width, height);
  },

  // Locker hardware offline notification from doorStatusWatcher
  onLockerHardwareOffline: (callback) => ipcRenderer.on('locker-hardware-offline', (_event, data) => {
    console.log('PRELOAD: Locker hardware offline:', data);
    callback(data);
  }),
})

const initSerialPort = async (serialPortList) => {
  const isInit = init;

  try {
    serialPortList = JSON.parse(serialPortList) || [];
  } catch (parseError) {
    console.error('PRELOAD: Failed to parse serial port list:', parseError);
    console.log('PRELOAD: Raw data:', serialPortList);
    return;
  }

  if (!isConnected && serialPortList.length) {

    for (const item of serialPortList) {
      if (
        (process.platform === 'linux' && item.pnpId && item.pnpId.includes('Barcode')) ||
        (item && item.friendlyName && item.friendlyName.includes('Barcode Scanner')) ||
        (item && item.manufacturer && item.manufacturer.includes('Datalogic')) ||
        (item && item.manufacturer && item.manufacturer.includes('Honeywell')) ||
        (item && item.friendlyName && item.friendlyName.includes('USB Serial Device'))
      ) {

        console.log(`Pass supported HW test: ${!!item}`);
        ipcRenderer.send('setMyGlobalPort', item.path)

      }
    }
  } else {
    console.log('Not Found, check connection and Datalogic settings and restart');

  }

}

async function processBarcodeScannerResult(input) {
  console.log(`barcode ${input} @${moment().format('YYYY-MM-DD HH:mm:ss')}`);
  serialPortData = input;
  clearTimeout(timeoutTimer);
  timeoutTimer = setTimeout(() => {
    console.log('clear barcode');
    serialPortData = '';
    delete scanResults[serialPortData];
  }, 1100);
}



contextBridge.exposeInMainWorld('electron', {
  sideeventNative: {

    getCMD() {
      return cmd;
    },

    async initSerialPort() {
      try {
        console.log('PRELOAD initSerialPort');
        // Use SerialPort.list() instead of the CLI command
        // This works in packaged apps without needing the CLI tool
        const ports = await SerialPort.list();
        console.log(`PRELOAD *****  SerialPort.list(): ${JSON.stringify(ports)}`);

        // Check if ports is empty
        if (!ports || ports.length === 0) {
          console.log('PRELOAD: No serial ports found');
          return;
        }

        try {
          // Pass as JSON string to match the existing function signature
          initSerialPort(JSON.stringify(ports));
        } catch (parseError) {
          console.error('PRELOAD: Error processing serial port data:', parseError);
        }
      } catch (error) {
        console.error('PRELOAD: SerialPort.list() error:', error);
      }
    },

    // Initialize RTDB pub/sub (must be called after license is loaded)
    initRTDB(databaseUrl, authToken) {
      console.log('PRELOAD: Initializing RTDB PubSub with database URL');
      if (authToken) {
        console.log('PRELOAD: Auth token provided for RTDB');
      }
      try {
        ipcRenderer.send('initRTDB', databaseUrl, authToken)
      } catch (error) {
        console.error('PRELOAD: Error initializing RTDB', error)
      }
    },

    // Set integrations data for RTDB pub/sub (for IP address lookup)
    setRTDBIntegrations(integrations) {
      console.log('PRELOAD: Setting integrations data in RTDB PubSub');
      try {
        ipcRenderer.send('setRTDBIntegrations', integrations)
      } catch (error) {
        console.error('PRELOAD: Error setting RTDB integrations', error)
      }
    },

    // Update auth token in RTDB pub/sub (for token refresh)
    updateRTDBAuthToken(newToken) {
      console.log('PRELOAD: Updating auth token in RTDB PubSub');
      try {
        ipcRenderer.send('updateRTDBAuthToken', newToken)
      } catch (error) {
        console.error('PRELOAD: Error updating RTDB auth token', error)
      }
    },

    // Initialize door status watcher (polls locker via HTTP or watches file)
    initDoorStatusWatcher(databaseUrl, authToken, licenseId, deviceId, lockerIp) {
      console.log('PRELOAD: Initializing door status watcher');
      console.log(`   Device ID: ${deviceId}`);
      console.log(`   Locker IP: ${lockerIp || 'not provided'}`);
      try {
        ipcRenderer.send('initDoorStatusWatcher', databaseUrl, authToken, licenseId, deviceId, lockerIp)
      } catch (error) {
        console.error('PRELOAD: Error initializing door status watcher', error)
      }
    },

    // Subscribe to RTDB pub/sub channel
    rtdbSub(channel, licenseId) {
      console.log('PRELOAD: Subscribing to RTDB channel:', channel);
      try {
        ipcRenderer.send('rtdbSub', channel, licenseId)
      } catch (error) {
        console.error('PRELOAD: Error subscribing to RTDB channel', error)
      }
    },

    // Publish to RTDB pub/sub channel
    rtdbPub(message) {
      console.log('PRELOAD: Publishing to RTDB channel');
      try {
        ipcRenderer.send('rtdbPub', message)
      } catch (error) {
        console.error('PRELOAD: Error publishing to RTDB', error)
      }
    },

    readSerialPortData() {
      try {
        const value = serialPortData;
        return value;

      } catch (error) {
        console.error('node-cmd error', error)
      }
    },

    // Run terminal command via node-cmd
    async runCommand(command) {
      return new Promise((resolve, reject) => {
        console.log(`PRELOAD: Running command: ${command}`);
        cmd.run(command, (err, data, stderr) => {
          if (err) {
            console.error(`PRELOAD: Command error:`, err);
            reject(err);
          } else {
            console.log(`PRELOAD: Command output:`, data);
            if (stderr) {
              console.warn(`PRELOAD: Command stderr:`, stderr);
            }
            resolve(data);
          }
        });
      });
    },

    // Download file from Firebase Storage via main process (no CORS restrictions)
    async downloadFile(url, fileName) {
      try {
        console.log(`PRELOAD: Requesting download for ${fileName}`);
        const base64 = await ipcRenderer.invoke('downloadFile', url, fileName);
        return base64;
      } catch (error) {
        console.error('PRELOAD: Error downloading file:', error);
        throw error;
      }
    },

    // Load license from Firestore via main process (no CORS restrictions, offline backup)
    async loadLicenseFromFirestore(licenseId, projectId, apiKey, authToken) {
      try {
        console.log(`PRELOAD: Requesting license load from Firestore`);
        console.log(`   License ID: ${licenseId}`);
        console.log(`   Project ID: ${projectId}`);
        console.log(`   API Key: ${apiKey ? 'provided' : 'not provided'}`);
        console.log(`   Auth Token: ${authToken ? 'provided' : 'not provided'}`);
        const license = await ipcRenderer.invoke('loadLicenseFromFirestore', licenseId, projectId, apiKey, authToken);
        console.log(`PRELOAD: License loaded from Firestore via main process`);
        return license;
      } catch (error) {
        console.error('PRELOAD: Error loading license from Firestore:', error);
        throw error;
      }
    },

    // Set license database URL in main process
    async setLicenseDatabaseUrl(licenseId, databaseUrl) {
      try {
        console.log(`PRELOAD: Setting license database URL`);
        console.log(`   License ID: ${licenseId}`);
        console.log(`   Database URL: ${databaseUrl}`);
        const result = await ipcRenderer.invoke('setLicenseDatabaseUrl', licenseId, databaseUrl);
        console.log(`PRELOAD: License database URL set via main process`);
        return result;
      } catch (error) {
        console.error('PRELOAD: Error setting license database URL:', error);
        throw error;
      }
    },

    // Get current license database URL from main process
    async getLicenseDatabaseUrl() {
      try {
        const databaseUrl = await ipcRenderer.invoke('getLicenseDatabaseUrl');
        return databaseUrl;
      } catch (error) {
        console.error('PRELOAD: Error getting license database URL:', error);
        return null;
      }
    },

    // Load device from Firebase Realtime DB via main process (no CORS restrictions)
    async loadDeviceFromFirebase(licenseId, deviceId, databaseUrl, authToken) {
      try {
        console.log(`PRELOAD: Requesting device load from Firebase`);
        console.log(`   License ID: ${licenseId}`);
        console.log(`   Device ID: ${deviceId}`);
        console.log(`   Auth Token: ${authToken ? 'provided' : 'not provided'}`);
        const device = await ipcRenderer.invoke('loadDeviceFromFirebase', licenseId, deviceId, databaseUrl, authToken);
        console.log(`PRELOAD: Device loaded from Firebase via main process`);
        return device;
      } catch (error) {
        console.error('PRELOAD: Error loading device from Firebase:', error);
        throw error;
      }
    },

    // Update device manifest in Firebase Realtime DB via main process
    async updateDeviceManifestInFirebase(licenseId, deviceKey, manifest, databaseUrl, authToken) {
      try {
        console.log(`PRELOAD: Requesting device manifest update in Firebase`);
        console.log(`   License ID: ${licenseId}`);
        console.log(`   Device Key: ${deviceKey}`);
        const result = await ipcRenderer.invoke('updateDeviceManifestInFirebase', licenseId, deviceKey, manifest, databaseUrl, authToken);
        console.log(`PRELOAD: Device manifest updated in Firebase via main process`);
        return result;
      } catch (error) {
        console.error('PRELOAD: Error updating device manifest in Firebase:', error);
        throw error;
      }
    },

    // Update device thedoors in Firebase Realtime DB via main process
    async updateDeviceTheDoorsInFirebase(licenseId, deviceKey, thedoors, databaseUrl, authToken) {
      try {
        console.log(`PRELOAD: Requesting device thedoors update in Firebase`);
        console.log(`   License ID: ${licenseId}`);
        console.log(`   Device Key: ${deviceKey}`);
        const result = await ipcRenderer.invoke('updateDeviceTheDoorsInFirebase', licenseId, deviceKey, thedoors, databaseUrl, authToken);
        console.log(`PRELOAD: Device thedoors updated in Firebase via main process`);
        return result;
      } catch (error) {
        console.error('PRELOAD: Error updating device thedoors in Firebase:', error);
        throw error;
      }
    },

    // Load integrations from Firebase Realtime DB via main process
    // databaseUrl is optional - if not provided, will use cached value from previous call
    async loadIntegrations(licenseId, databaseUrl) {
      try {
        console.log(`PRELOAD: Requesting integrations for License ID: ${licenseId}`);
        if (databaseUrl) {
          console.log(`PRELOAD: Using provided database URL`);
        } else {
          console.log(`PRELOAD: Using cached database URL from main process`);
        }
        const integrations = await ipcRenderer.invoke('loadIntegrations', licenseId, databaseUrl);
        console.log(`PRELOAD: Integrations loaded via main process`);
        console.log(`PRELOAD: Found ${Object.keys(integrations || {}).length} integrations`);
        return integrations;
      } catch (error) {
        console.error('PRELOAD: Error loading integrations:', error);
        throw error;
      }
    },

    // Get locker status via main process
    async getLockerStatus(mac, ip, licenseId) {
      try {
        const status = await ipcRenderer.invoke('getLockerStatus', mac, ip, licenseId);
        return status;
      } catch (error) {
        console.error('PRELOAD: Error getting locker status:', error);
        throw error;
      }
    },

    // Open locker door via main process
    async openLockerDoor(doorNumber, mac, ip) {
      try {
        console.log(`PRELOAD: Requesting to open locker door ${doorNumber} for MAC: ${mac}, IP: ${ip || 'N/A'}`);
        const result = await ipcRenderer.invoke('openLockerDoor', doorNumber, mac, ip);
        console.log(`PRELOAD: Locker door ${doorNumber} opened via main process`);
        return result;
      } catch (error) {
        console.error('PRELOAD: Error opening locker door:', error);
        throw error;
      }
    },

    // Update localConfig.json with macs property and integrations array
    async updateLocalConfigMacs(macsString, integrationsData) {
      try {
        console.log(`PRELOAD: Requesting to update localConfig.json with macs: ${macsString}`);
        console.log(`PRELOAD: Integrations data:`, integrationsData);
        const result = await ipcRenderer.invoke('updateLocalConfigMacs', macsString, integrationsData);
        console.log(`PRELOAD: localConfig.json updated via main process`);
        return result;
      } catch (error) {
        console.error('PRELOAD: Error updating localConfig.json:', error);
        throw error;
      }
    },

    // ========================================================================
    // RFID Service API
    // ========================================================================

    // Initialize RFID WebSocket service connection
    async initRfidService() {
      try {
        console.log('PRELOAD: Initializing RFID service');
        const result = await ipcRenderer.invoke('initRfidService');
        console.log('PRELOAD: RFID service init result:', result);
        return result;
      } catch (error) {
        console.error('PRELOAD: Error initializing RFID service:', error);
        throw error;
      }
    },

    // Connect to RFID reader hardware
    async connectRfidReader() {
      try {
        console.log('PRELOAD: Connecting to RFID reader');
        const result = await ipcRenderer.invoke('connectRfidReader');
        console.log('PRELOAD: RFID reader connect result:', result);
        return result;
      } catch (error) {
        console.error('PRELOAD: Error connecting to RFID reader:', error);
        throw error;
      }
    },

    // Disconnect from RFID reader hardware
    async disconnectRfidReader() {
      try {
        console.log('PRELOAD: Disconnecting from RFID reader');
        const result = await ipcRenderer.invoke('disconnectRfidReader');
        console.log('PRELOAD: RFID reader disconnect result:', result);
        return result;
      } catch (error) {
        console.error('PRELOAD: Error disconnecting from RFID reader:', error);
        throw error;
      }
    },

    // Read all RFID tags on the pad
    async readRfidTags() {
      try {
        console.log('PRELOAD: Reading RFID tags');
        const result = await ipcRenderer.invoke('readRfidTags');
        console.log('PRELOAD: RFID tags read result:', result);
        return result;
      } catch (error) {
        console.error('PRELOAD: Error reading RFID tags:', error);
        throw error;
      }
    },

    // Read RFID tags using Buffer Read Mode (for BLE/TCP modes)
    async readRfidTagsBrm(readTime = 2000) {
      try {
        console.log(`PRELOAD: Reading RFID tags (BRM, ${readTime}ms)`);
        const result = await ipcRenderer.invoke('readRfidTagsBrm', readTime);
        console.log('PRELOAD: RFID tags BRM read result:', result);
        return result;
      } catch (error) {
        console.error('PRELOAD: Error reading RFID tags (BRM):', error);
        throw error;
      }
    },

    // Set security (AFI) on RFID tags
    // security: true = AFI 7 (checked in), false = AFI 0 (checked out)
    // tagId: optional - if not provided, applies to all tags on pad
    async setRfidSecurity(security, tagId = null) {
      try {
        console.log(`PRELOAD: Setting RFID security: ${security}, tagId: ${tagId || 'all'}`);
        const result = await ipcRenderer.invoke('setRfidSecurity', security, tagId);
        console.log('PRELOAD: RFID security set result:', result);
        return result;
      } catch (error) {
        console.error('PRELOAD: Error setting RFID security:', error);
        throw error;
      }
    },

    // Get RFID reader information
    async getRfidReaderInfo() {
      try {
        console.log('PRELOAD: Getting RFID reader info');
        const result = await ipcRenderer.invoke('getRfidReaderInfo');
        console.log('PRELOAD: RFID reader info:', result);
        return result;
      } catch (error) {
        console.error('PRELOAD: Error getting RFID reader info:', error);
        throw error;
      }
    },

    // Start continuous RFID tag scanning
    async startRfidContinuousScan(interval = 1) {
      try {
        console.log(`PRELOAD: Starting continuous RFID scan (interval: ${interval}s)`);
        const result = await ipcRenderer.invoke('startRfidContinuousScan', interval);
        console.log('PRELOAD: Continuous RFID scan started:', result);
        return result;
      } catch (error) {
        console.error('PRELOAD: Error starting continuous RFID scan:', error);
        throw error;
      }
    },

    // Stop continuous RFID tag scanning
    async stopRfidContinuousScan() {
      try {
        console.log('PRELOAD: Stopping continuous RFID scan');
        const result = await ipcRenderer.invoke('stopRfidContinuousScan');
        console.log('PRELOAD: Continuous RFID scan stopped:', result);
        return result;
      } catch (error) {
        console.error('PRELOAD: Error stopping continuous RFID scan:', error);
        throw error;
      }
    },

    // RFID health check
    async rfidHealthCheck() {
      try {
        console.log('PRELOAD: RFID health check');
        const result = await ipcRenderer.invoke('rfidHealthCheck');
        console.log('PRELOAD: RFID health check result:', result);
        return result;
      } catch (error) {
        console.error('PRELOAD: Error in RFID health check:', error);
        throw error;
      }
    },

    // Get RFID connection status (sync)
    async getRfidConnectionStatus() {
      try {
        const result = await ipcRenderer.invoke('getRfidConnectionStatus');
        return result;
      } catch (error) {
        console.error('PRELOAD: Error getting RFID connection status:', error);
        throw error;
      }
    },

    // Check if main process is operating in offline mode
    async appendCheckoutManifest(lockerObject) {
      try {
        return await ipcRenderer.invoke('appendCheckoutManifest', lockerObject);
      } catch (error) {
        console.error('PRELOAD: Error appending to checkout manifest:', error);
        return { success: false, error: error.message };
      }
    },

    async getCheckoutManifest() {
      try {
        return await ipcRenderer.invoke('getCheckoutManifest');
      } catch (error) {
        console.error('PRELOAD: Error reading checkout manifest:', error);
        return [];
      }
    },

    async clearCheckoutManifest() {
      try {
        return await ipcRenderer.invoke('clearCheckoutManifest');
      } catch (error) {
        console.error('PRELOAD: Error clearing checkout manifest:', error);
        return { success: false, error: error.message };
      }
    },

    async removeFirstFromCheckoutManifest() {
      try {
        return await ipcRenderer.invoke('removeFirstFromCheckoutManifest');
      } catch (error) {
        console.error('PRELOAD: Error removing from checkout manifest:', error);
        return { success: false, error: error.message };
      }
    },

    async appendCheckoutHistory(lockerObject) {
      try {
        return await ipcRenderer.invoke('appendCheckoutHistory', lockerObject);
      } catch (error) {
        console.error('PRELOAD: Error appending to checkout history:', error);
        return { success: false, error: error.message };
      }
    },

    async setMainOfflineMode(offline) {
      try {
        return await ipcRenderer.invoke('setMainOfflineMode', offline);
      } catch (error) {
        console.error('PRELOAD: Error setting offline mode:', error);
        return false;
      }
    },

    async isMainOperatingOffline() {
      try {
        const result = await ipcRenderer.invoke('isMainOperatingOffline');
        console.log('PRELOAD: Offline status check:', result ? 'OFFLINE' : 'ONLINE');
        return result;
      } catch (error) {
        console.error('PRELOAD: Error checking offline status:', error);
        return false; // Assume online if error
      }
    },

  },
  // ipcRenderer: {
  //   myPing() {
  //     ipcRenderer.send('ipc-example', 'ping');
  //   },
  //   on(channel, func) {
  //     const validChannels = ['ipc-example'];
  //     if (validChannels.includes(channel)) {
  //       // Deliberately strip event as it includes `sender`
  //       ipcRenderer.on(channel, (event, ...args) => func(...args));
  //     }
  //   },
  //   once(channel, func) {
  //     const validChannels = ['ipc-example'];
  //     if (validChannels.includes(channel)) {
  //       // Deliberately strip event as it includes `sender`
  //       ipcRenderer.once(channel, (event, ...args) => func(...args));
  //     }
  //   },
  // },
});
