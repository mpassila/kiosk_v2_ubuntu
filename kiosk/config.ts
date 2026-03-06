"use strict";

// Default local config values - used if file doesn't exist
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
  testmode: false
};

// Load localConfig from c:\SideEvents\localConfig.json
// This path is used for both prod and dev mode
let localConfig: any = { ...defaultLocalConfig };

// Renderer process: use window.electronAPI.getLocalConfig() exposed via preload
// The preload script loads from C:\SideEvents\localConfig.json and exposes it
try {
  if (typeof window !== 'undefined') {
    const electronAPI = (window as any).electronAPI;
    if (electronAPI && electronAPI.getLocalConfig) {
      const loadedConfig = electronAPI.getLocalConfig();
      localConfig = { ...defaultLocalConfig, ...loadedConfig };
      console.log('✅ Loaded localConfig from preload via electronAPI');
      console.log('   deviceId:', localConfig.deviceId);
      console.log('   licenseId:', localConfig.licenseId);
      console.log('   testmode:', localConfig.testmode);
    } else {
      console.log('⚠️ electronAPI.getLocalConfig not available - using defaults');
    }
  }
} catch (error) {
  console.error('❌ Error getting localConfig from electronAPI:', error);
  console.log('⚠️ Using default config values');
}

const combinedConfig = Object.assign({
      testmode: localConfig.testmode || false, // Test mode - simulates door operations (from localConfig.json)
      license_id: localConfig.licenseId || 2, // Firebase Firestore document ID for the license
      license: null, // Will be populated by loadLicenseFromFirebase()
      realtimeDB: null, // Firebase Realtime Database URL from license
      device: null, // Will be populated by loadDeviceFromFirebase()
      files:{},
      version: '2.0.2 RC1',
      doorToggle: 15,
      adminPin: '20212022', // Admin PIN for re-opening doors
      // Firebase Authentication credentials (generated based on license_id)
      firebase: {
        auth: {
          email: '', // Will be populated by getFirebaseAuthCredentials()
          password: '' // Will be populated by getFirebaseAuthCredentials()
        }
      }
    },
    localConfig
);

/**
 * Get Firebase Authentication credentials based on license ID
 * Generates email and password for Firebase Auth
 * @param licenseId License ID (defaults to config.license_id)
 * @returns Object with email and password
 */
export function getFirebaseAuthCredentials(licenseId?: number | string): { email: string; password: string } {
  const effectiveLicenseId = licenseId || combinedConfig.license_id;
  const email = `admin+license${effectiveLicenseId}@sideevent.com`;
  const password = `@Anacortes#License${effectiveLicenseId}!`;

  // Update config with generated credentials
  combinedConfig.firebase.auth.email = email;
  combinedConfig.firebase.auth.password = password;

  return { email, password };
}

// Note: License loading is now handled via main process IPC (loadLicenseFromFirestore)
// with offline backup support in bu_license.json

/**
 * Load device data from Firebase Realtime Database
 * Fetches device from path: settings/{deviceId}
 * IMPORTANT: Only call this from the renderer process, not from main process
 */
export async function loadDeviceFromFirebase(deviceId?: string) {
  try {
    // Lazy load the device service
    const { deviceService } = await import('./src/renderer/state/device-service');

    const effectiveDeviceId = deviceId || combinedConfig.deviceId;
    console.log('🔄 Loading device from Firebase Realtime DB (settings path):', effectiveDeviceId);

    // First try to load from settings/{deviceId} path
    const device = await deviceService.getDeviceByIdFromSettings(effectiveDeviceId);

    if (device) {
      combinedConfig.device = device;
      console.log('✅ Device loaded from Firebase settings:', device.settings?.name || effectiveDeviceId);
      console.log('   Device enabled:', device.enabled);
      console.log('   Device status:', device.status);
      console.log('   License ID:', device.licenseId);
      return device;
    } else {
      console.error('❌ Device not found in Firebase settings path');
      return null;
    }
  } catch (error) {
    console.error('❌ Error loading device from Firebase:', error);
    return null;
  }
}

export default combinedConfig;



