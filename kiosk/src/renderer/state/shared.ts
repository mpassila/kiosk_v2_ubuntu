/* eslint-disable @typescript-eslint/no-explicit-any */
import { signal } from '@preact/signals-react'
// import { User } from '../models/user'
import config from '../../../config'
// LEGACY REST IMPORT REMOVED
// import { request, EndPoint } from './request';
import { toast, TypeOptions } from 'react-toastify';
import { useState } from 'react';

const storageFiles = localStorage.getItem('files');
config.files = storageFiles ? JSON.parse(storageFiles) : {};

const handpickMode = localStorage.getItem('handpickMode');
const isHandpickMode = signal<boolean>(handpickMode ? JSON.parse(handpickMode) : false);
const sessionError = signal<any>({ message:{}} )
const sessionLocation = signal<string>('/ooo')
const kioskConfig = signal<any>(config);
const sessionIsReady = signal<boolean>(false)
const lang = localStorage.getItem('sessionLang') || 'en' ;
const sessionLang = signal<string>(lang)
const sessionTimer = signal<number>(30)
// Device data now comes only from RTDB sync, not localStorage
const sessionDevice = signal<any>(null);
const sessionDeviceId = signal<any>(null);
const branch:any = localStorage.getItem('sessionBranch');
const sessionBranch = signal<any>( branch ? JSON.parse(branch) : null);
const license:any = localStorage.getItem('sessionLicense');
const sessionLicense = signal<any>( license ? JSON.parse(license) : null);
const backgroundImage = localStorage.getItem('backgroundImage') ;
const sessionBackgroundImage = signal<any | null>( backgroundImage ? JSON.parse(backgroundImage) : null );
const welcomeBackgroundColor = localStorage.getItem('welcomeBackgroundColor');
const sessionWelcomeBackgroundColor = signal<string | null>(welcomeBackgroundColor ? JSON.parse(welcomeBackgroundColor) : null);
const welcomeBackgroundImage = localStorage.getItem('welcomeBackgroundImage');
const sessionWelcomeBackgroundImage = signal<string | null>(welcomeBackgroundImage ? JSON.parse(welcomeBackgroundImage) : null);
const sessionBarcode = signal<string | null>(null);
const sessionUser = signal<any>();
const sessionDoorStatus = signal<any>();
const sessionWizard = signal<any>({});
const sessionStaffModeOn = signal<boolean>(false);
const sessionUserModeOn = signal<boolean>(false);
const showBackgroundImage = signal<boolean>(true);
const fontSizeStorageRead = localStorage.getItem('fontSize') ;
const fontSizeStorage = signal<number>(fontSizeStorageRead ? parseInt(fontSizeStorageRead) : 20);
const fontSize = signal<number>(fontSizeStorage.value);
const localized = signal<any>(JSON.parse(localStorage.getItem('localized') || '{}'));
const playIndex = signal<number>(0);
const libraryOfThingsGroup = signal<any>(null);
const SEBlue = signal<string>('#42A4DE');
const SEBlueWithOpasity = signal<string>('rgba(66, 164, 222, 0.3)');
const defaultSystemLang = localStorage.getItem('systemLang') || 'en';
const sessionSystemLang = signal<string>(defaultSystemLang);
// Initialize license ID from localStorage or config
const storedLicenseId = localStorage.getItem('licenseId');
let initialLicenseId: number | null = null;
const nextLockerNro = signal<number>(0)

const slideshowActive = signal<boolean>(false);

// When set to a door number, Admin.tsx will auto-open the door confirmation modal on mount
const adminAutoOpenDoor = signal<number | null>(null);

// Shared re-scan guard — prevents the same barcode being processed within the delay window
const readHistory: Record<string, number> = {};
const clearReadHistory = () => {
  for (const key in readHistory) {
    delete readHistory[key];
  }
};
const doorStatuses = signal<{ [key: number]: { open: boolean } }>({});
const itemStatuses = signal<{ [doorNumber: number]: { [itemId: string]: boolean } }>({});

const reopenCounts = signal<{ [doorNumber: number]: number }>({});

const setDoorStatuses = (statuses: { [key: number]: { open: boolean } }) => {
  doorStatuses.value = statuses;
}

const setItemStatuses = (statuses: { [doorNumber: number]: { [itemId: string]: boolean } }) => {
  itemStatuses.value = statuses;
}

const trackReopenDoor = (doorNumber: number): number => {
  const count = (reopenCounts.value[doorNumber] || 0) + 1;
  reopenCounts.value = { ...reopenCounts.value, [doorNumber]: count };
  return count;
}

const resetReopenCounts = () => {
  reopenCounts.value = {};
}

const setNextLockerNro = (nro: number) => {
  nextLockerNro.value = nro;
}

if (storedLicenseId) {
  try {
    initialLicenseId = +JSON.parse(storedLicenseId);
  } catch (e) {
    console.warn('Failed to parse stored licenseId, will use config value');
  }
}

// If no stored license ID, get it from config
if (!initialLicenseId) {
  try {
    const configModule = require('../../../config');
    initialLicenseId = configModule.default?.license_id || 2;
    localStorage.setItem('licenseId', JSON.stringify(initialLicenseId));
    // console.log('✅ Initialized licenseId from config:', initialLicenseId);
  } catch (e) {
    console.error('Failed to load license ID from config:', e);
  }
}

const sessionLicenseId = signal<any>(initialLicenseId);
const showReturnInfo = signal<boolean>(false);
const sessionSpinnerStatus = signal<string>('');

// Database URL from license (set during app initialization)
const storedDatabaseUrl = localStorage.getItem('databaseUrl');
const sessionDatabaseUrl = signal<string | null>(storedDatabaseUrl ? JSON.parse(storedDatabaseUrl) : null);

const updateSessionLicenseId = (id: any) => {
  sessionLicenseId.value = id;
  localStorage.setItem('licenseId', JSON.stringify(id));
}

const updateSessionDatabaseUrl = (url: string) => {
  sessionDatabaseUrl.value = url;
  localStorage.setItem('databaseUrl', JSON.stringify(url));
}

const updateIsHandpickMode = (status: boolean) => {
  isHandpickMode.value = status;
  localStorage.setItem('handpickMode', JSON.stringify(status));
}

const updateShowReturnInfo = (status: boolean) => {
  showReturnInfo.value = status;
}

const updateSessionSpinnerStatus = (status: string) => {
  sessionSpinnerStatus.value = status;
}

const updateSessionSystemLang = (lang: string) => {
  sessionSystemLang.value = lang;
  localStorage.setItem('systemLang', lang);
}

const updateFontSize = (size: number) => {
  fontSize.value = size;
};

const updateLocalized = (input: any) => {
  localized.value = input;
  localStorage.setItem('localized', JSON.stringify(localized.value));
}

const updatePlayIndex = (index: number) => {
  playIndex.value = index;
};

const updateFontSizeStorage = (size: number) => {
  localStorage.setItem('fontSize', size.toString());
  fontSizeStorage.value = size;
  updateFontSize(size);
};

const getTextStyle = (additionalStyles = {}, sizeOffset = 0): React.CSSProperties => ({
  lineHeight: 'normal',
  fontSize: `${fontSize.value + sizeOffset}px`,
  ...additionalStyles
});

const setImages = (images: any) => {
  images.value = images;
}
const setLibraryOfThingsGroup = (group: any) => {
  libraryOfThingsGroup.value = group;
}

const storedHotListItemIds = localStorage.getItem('hotListItemIds');
const hotListItemIds = signal<string[]>(storedHotListItemIds ? JSON.parse(storedHotListItemIds) : []);
const setHotListItemIds = (checkouts: any[]) => {
  hotListItemIds.value = checkouts;
  localStorage.setItem('hotListItemIds', JSON.stringify(checkouts));
}
const getHotListItemIds = () => {
  let hotListItemIdsRenew = signal<string[]>(storedHotListItemIds ? JSON.parse(storedHotListItemIds) : []);
  setHotListItemIds(hotListItemIdsRenew.value);
  return hotListItemIds.value;
}

const updateStorageFiles = (name: string, image: string) => {
  config.files[name] = image;
  localStorage.setItem('files', JSON.stringify(config.files));
}

const getImage = (file: string, name: string) => {
  // Always read from kioskConfig.value to get the latest files
  const files = kioskConfig.value.files || {};

  if (!file) {
    // No file provided, use default based on name
    switch(name) {
      case 'LIBRARY':
        return files[name] ? `data:image/*;base64, ${files[name]}` : `./lyngsoe.svg`;
      case 'MAC':
        return `./mac.jpg`;
      case 'WINDOWS':
        return `./windows.jpg`;
      case 'IPAD':
        return `./ipad.jpg`;
      case 'ANDROID':
        return `./android.jpg`;
      default:
        return `./Blue42A4DE.png`;
    }
  }

  // Parse URL to extract filename
  let filename = file;

  // Check if it's a URL (starts with http:// or https://)
  if (file.startsWith('http://') || file.startsWith('https://')) {
    try {
      const url = new URL(file);
      // Get pathname without leading slash
      const pathname = url.pathname.substring(1);

      // For Firebase Storage URLs, the path structure is: v0/b/{bucket}/o/{path}
      // We need to extract the actual file path
      if (pathname.includes('/o/')) {
        // Extract the part after '/o/'
        const pathAfterO = pathname.split('/o/')[1];
        // Decode URI component (handles %2F and other encoded characters)
        const decodedPath = decodeURIComponent(pathAfterO);
        // Get just the filename (last part after /)
        filename = decodedPath.split('/').pop() || file;
      } else {
        // Standard URL, just get the last part
        filename = pathname.split('/').pop() || file;
      }

      // Remove query parameters if present
      filename = filename.split('?')[0];

      // console.log(`🖼️  Parsed image URL:`, {
      //   original: file,
      //   parsed: filename,
      //   found: !!files[filename],
      //   totalFiles: Object.keys(files).length
      // });
    } catch (error) {
      console.error('❌ Error parsing image URL:', error);
      // Fallback to simple split
      filename = file.split('/').pop()?.split('?')[0] || file;
    }
  } else {
    // Not a URL, just extract filename from path
    filename = file.split('/').pop()?.split('?')[0] || file;
  }

  // Check if we have this file in kioskConfig
  if (files[filename]) {
    // console.log(`✅ Found image in localStorage: ${filename}`);
    return `data:image/*;base64, ${files[filename]}`;
  }

  // File not found in localStorage, try fallback based on name
  // console.warn(`⚠️  Image not found in localStorage: ${filename}, using fallback`);
  // console.warn(`   Available files (${Object.keys(files).length}): ${Object.keys(files).join(', ')}`);

  switch(name) {
    case 'LIBRARY':
      return files[name] ? `data:image/*;base64, ${files[name]}` : `./lyngsoe.svg`;
    case 'MAC':
      return `./mac.jpg`;
    case 'WINDOWS':
      return `./windows.jpg`;
    case 'IPAD':
      return `./ipad.jpg`;
    case 'ANDROID':
      return `./android.jpg`;
    default:
      return `./Blue42A4DE.png`;
  }
}

function updateShowBackgroundImage(status: boolean): void {
  showBackgroundImage.value = status;
}

function updateSessionUserModeOn(status: boolean): void {
  sessionUserModeOn.value = status;
}

function updateSessionStaffModeOn(status: boolean): void {
  sessionStaffModeOn.value = status;
}

function updateSessionDoorStatus(status: any): void {
  sessionDoorStatus.value = status;
}

function updateSessionIsReady(isReady: boolean): void {
  sessionIsReady.value = isReady;
}

async function updateSessionUser(user: string): Promise<void> {
  sessionUser.value = user;
}

async function updateSessionBarcode(barcode: string): Promise<void> {
  sessionBarcode.value = barcode;
}

async function updateSessionError(error: any): Promise<void> {
  sessionError.value = error;
}

async function updateSessionLicense(license: any): Promise<void> {
  sessionLicense.value = license;
  localStorage.setItem('sessionLicense', JSON.stringify(license))
}

async function updateSessionBranch(branch: any): Promise<void> {
  sessionBranch.value = branch;
  localStorage.setItem('sessionBranch', JSON.stringify(branch))
}

async function updateSessionDeviceId(id: string): Promise<void> {
  sessionDeviceId.value = id;
  // Device ID now synced only via RTDB, not localStorage
  console.log('📝 Updated sessionDeviceId to:', id, '(RTDB sync only)');
}

async function updateSessionTimer(newvalue: number): Promise<void> {
    sessionTimer.value = newvalue ;
}

async function updateLang(lang: string): Promise<void> {
  try {
      sessionLang.value = lang;
      localStorage.setItem('sessionLang', lang)
    }
    catch (err) {
        localStorage.clear()
    }
}

async function updateLocation(location: string): Promise<void> {
  try {
      sessionLocation.value = location;
    }
    catch (err) {
        localStorage.clear()
    }
}

async function updateDevice(device: any): Promise<void> {
  try {
      sessionDevice.value = device;
      // Device data now synced only via RTDB, not localStorage
      console.log('📝 Updated sessionDevice (RTDB sync only)');
    }
    catch (err) {
        console.error('❌ Error updating device:', err);
    }
}

const customToast = (html: Function, autoClose = 50000, type = 'default', theme = 'light') => {
  // customToast(() => (<b>Connection <span style={{color: "red"}}>error</span> on locker door module</b>), 20000, 'default', 'dark');
  toast.dismiss();
  setTimeout(() => {
    toast(() => (html()), {
      autoClose: autoClose,
      style: {
        width: '220%',
        fontSize: '22px',
        left: '-50%',
        zIndex: 999999,
      },
      theme: theme,
      position: 'bottom-center',
    });
  }, 200);
}


async function persistDeviceManifestChanges(manifest: any): Promise<void> {
  try {
      // Update manifest in Firebase Realtime DB
      const licenseId = sessionLicenseId.value;
      const deviceKey = kioskConfig.value?.device?.id;
      const databaseUrl = sessionDatabaseUrl.value;

      if (!manifest) {
        console.warn('⚠️  No manifest provided to persistDeviceManifestChanges');
        return;
      }

      if (!databaseUrl) {
        console.error('❌ Cannot update Firebase: databaseUrl not set', {
          licenseId,
          deviceKey
        });
        return;
      }

      if (licenseId && deviceKey) {
        // console.log('📤 Updating device manifest in Firebase Realtime DB:', {
        //   licenseId,
        //   deviceKey,
        //   databaseUrl,
        //   manifestKeys: Object.keys(manifest)
        // });

        try {
          // Get Firebase auth token
          const { getFirebaseAuth } = await import('./firebase-client');
          const auth = getFirebaseAuth();
          const currentUser = auth.currentUser;

          if (!currentUser) {
            throw new Error('Not authenticated with Firebase');
          }

          const authToken = await currentUser.getIdToken();

          // @ts-ignore - electron global is added by preload
          await window.electron.sideeventNative.updateDeviceManifestInFirebase(
            licenseId,
            deviceKey,
            manifest,
            databaseUrl,
            authToken
          );

          // console.log('✅ Device manifest successfully updated in Firebase Realtime DB');

          // Update both kioskConfig and sessionDevice with the new manifest to keep them in sync
          if (kioskConfig.value?.device) {
            kioskConfig.value.device.manifest = manifest;
          }

          // Also update sessionDevice to ensure all components see the changes immediately
          if (sessionDevice.value) {
            sessionDevice.value = {
              ...sessionDevice.value,
              manifest: manifest
            };
          }
        } catch (firebaseError) {
          console.error('❌ Failed to update device manifest in Firebase:', firebaseError);
          throw firebaseError;
        }
      } else {
        console.warn('⚠️  Cannot update Firebase: missing licenseId or deviceKey', {
          licenseId,
          deviceKey
        });
      }
    }
    catch (err) {
        console.error('Error in persistDeviceManifestChanges:', err);
        throw err;
    }
}

async function persistDeviceTheDoorsChanges(thedoors: any): Promise<void> {
  try {
      // Update thedoors in Firebase Realtime DB
      const licenseId = sessionLicenseId.value;
      const deviceKey = kioskConfig.value?.device?.id;
      const databaseUrl = sessionDatabaseUrl.value;

      if (!thedoors) {
        console.warn('⚠️  No thedoors provided to persistDeviceTheDoorsChanges');
        return;
      }

      if (!databaseUrl) {
        console.error('❌ Cannot update Firebase: databaseUrl not set', {
          licenseId,
          deviceKey
        });
        return;
      }

      if (licenseId && deviceKey) {
        console.log('📤 Updating device thedoors in Firebase Realtime DB:', {
          licenseId,
          deviceKey,
          doorsCount: thedoors?.length
        });

        try {
          // Get Firebase auth token
          const { getFirebaseAuth } = await import('./firebase-client');
          const auth = getFirebaseAuth();
          const currentUser = auth.currentUser;

          if (!currentUser) {
            throw new Error('Not authenticated with Firebase');
          }

          const authToken = await currentUser.getIdToken();

          // @ts-ignore - electron global is added by preload
          await window.electron.sideeventNative.updateDeviceTheDoorsInFirebase(
            licenseId,
            deviceKey,
            thedoors,
            databaseUrl,
            authToken
          );

          console.log('✅ Device thedoors successfully updated in Firebase Realtime DB');

          // Update sessionDevice to ensure all components see the changes immediately
          if (sessionDevice.value) {
            sessionDevice.value = {
              ...sessionDevice.value,
              thedoors: thedoors
            };
          }
        } catch (firebaseError) {
          console.error('❌ Failed to update device thedoors in Firebase:', firebaseError);
          throw firebaseError;
        }
      } else {
        console.warn('⚠️  Cannot update Firebase: missing licenseId or deviceKey', {
          licenseId,
          deviceKey
        });
      }
    }
    catch (err) {
        console.error('Error in persistDeviceTheDoorsChanges:', err);
        throw err;
    }
}

async function updateKioskConfig(config: any): Promise<void> {
  try {
      kioskConfig.value = config;
    }
    catch (err) {
        localStorage.clear()
    }
}

async function updateSessionBackgroundImage(image: any): Promise<void> {
  try {
      sessionBackgroundImage.value = image;
      localStorage.setItem('backgroundImage', JSON.stringify(image))
    }
    catch (err) {
        localStorage.clear()
    }
}

function updateWelcomeBackgroundColor(color: string | null): void {
  sessionWelcomeBackgroundColor.value = color;
  if (color) {
    localStorage.setItem('welcomeBackgroundColor', JSON.stringify(color));
  } else {
    localStorage.removeItem('welcomeBackgroundColor');
  }
}

function updateWelcomeBackgroundImage(image: string | null): void {
  sessionWelcomeBackgroundImage.value = image;
  if (image) {
    localStorage.setItem('welcomeBackgroundImage', JSON.stringify(image));
  } else {
    localStorage.removeItem('welcomeBackgroundImage');
  }
}

function validateItemInfo(input, itemId) {
      return input?.itemIdentifier && +input?.circulationStatus ? (input.itemIdentifier.toUpperCase() === itemId.toUpperCase()) : false;
}

function validateIsSipOk(sip: any) {
  return sip && sip.ok ? (sip.ok === '1' ? true : false) : false;
}

function setSessionWizard(wiz: any) {
  sessionWizard.value = wiz;
}

// Firebase-based SIP2 Service
const FirebaseSIP2 = {
  /**
   * Checkout an item to a patron
   * @param itemId - The item barcode/ID to checkout
   * @param patronId - The patron barcode/ID
   * @returns Promise<{ok: number, endpoint: string, itemId: string, patronId: string}>
   */
  checkout: async (itemId: string, patronId: string) => {
    console.log('📤 FirebaseSIP2.checkout:', { itemId, patronId });

    const branch = sessionBranch.value;
    const currentLicenseId = sessionLicenseId.value;
    const branchId = branch?.id;
    const institutionId = branch?.sip2Settings?.institutionId || '';
    const hybridsipUrl = 'https://sip2proxy-be4ekemxaa-uc.a.run.app';

    // Skip for demo licenses
    if (currentLicenseId === 1 || currentLicenseId === 2) {
      console.log('📤 FirebaseSIP2.checkout: Demo mode, returning mock');
      return { ok: 1, endpoint: 'checkout', itemId, patronId, timestamp: new Date().toISOString() };
    }

    try {
      const { getFirebaseAuth } = await import('./firebase-client');
      const auth = getFirebaseAuth();
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('User not authenticated');
      const idToken = await currentUser.getIdToken();

      const response = await fetch(`${hybridsipUrl}/hybridsip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({
          licenseId: currentLicenseId,
          branchId,
          type: 'CHECKOUT',
          message: { itemId, patronId, institutionId }
        })
      });

      const data = await response.json();
      console.log('📤 FirebaseSIP2.checkout POST response:', data);

      const rtdbPath = data?.rtdbPath;
      if (!rtdbPath) throw new Error('No rtdbPath in hybridsip response');

      const { getFirebaseDatabase } = await import('./firebase-client');
      const { ref, onValue, off } = await import('firebase/database');
      const db = getFirebaseDatabase();
      const resultRef = ref(db, rtdbPath);

      const sip2Data: any = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { off(resultRef); reject(new Error('SIP2 checkout RTDB timeout (15s)')); }, 15000);
        onValue(resultRef, (snapshot) => {
          const val = snapshot.val();
          if (val?.result) {
            clearTimeout(timeout);
            off(resultRef);
            resolve(val);
          }
        });
      });

      console.log('📤 FirebaseSIP2.checkout RTDB result:', sip2Data);
      const resp = sip2Data?.result || sip2Data;
      return {
        ok: (resp.ok === true || resp.ok === 1 || resp.responseType === '12') ? 1 : 0,
        endpoint: 'checkout',
        itemIdentifier: resp.itemIdentifier || resp.AB || itemId,
        patronIdentifier: resp.patronIdentifier || resp.AA || patronId,
        titleIdentifier: resp.titleIdentifier || resp.AJ || null,
        dueDate: resp.dueDate || resp.AH || null,
        screenMessage: resp.screenMessage || resp.AF || null,
        raw: sip2Data,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      console.error('❌ FirebaseSIP2.checkout error:', error?.message || error, error);
      return {
        ok: 0,
        endpoint: 'checkout',
        itemId,
        patronId,
        screenMessage: `SIP2 checkout failed: ${error?.message || error}`,
        timestamp: new Date().toISOString()
      };
    }
  },

  /**
   * Checkin an item
   * @param itemId - The item barcode/ID to checkin
   * @returns Promise<{ok: number, endpoint: string, itemId: string}>
   */
  checkin: async (itemId: string) => {
    console.log('📥 FirebaseSIP2.checkin:', { itemId });

    const branch = sessionBranch.value;
    const currentLicenseId = sessionLicenseId.value;
    const branchId = branch?.id;
    const institutionId = branch?.sip2Settings?.institutionId || '';
    const hybridsipUrl = 'https://sip2proxy-be4ekemxaa-uc.a.run.app';

    // Skip for demo licenses
    if (currentLicenseId === 1 || currentLicenseId === 2) {
      console.log('📥 FirebaseSIP2.checkin: Demo mode, returning mock');
      return { ok: 1, endpoint: 'checkin', itemId, timestamp: new Date().toISOString() };
    }

    try {
      const { getFirebaseAuth } = await import('./firebase-client');
      const auth = getFirebaseAuth();
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('User not authenticated');
      const idToken = await currentUser.getIdToken();

      const response = await fetch(`${hybridsipUrl}/hybridsip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({
          licenseId: currentLicenseId,
          branchId,
          type: 'CHECKIN',
          message: { itemId, institutionId }
        })
      });

      const data = await response.json();
      console.log('📥 FirebaseSIP2.checkin POST response:', data);

      const rtdbPath = data?.rtdbPath;
      if (!rtdbPath) throw new Error('No rtdbPath in hybridsip response');

      const { getFirebaseDatabase } = await import('./firebase-client');
      const { ref, onValue, off } = await import('firebase/database');
      const db = getFirebaseDatabase();
      const resultRef = ref(db, rtdbPath);

      const sip2Data: any = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { off(resultRef); reject(new Error('SIP2 checkin RTDB timeout (15s)')); }, 15000);
        onValue(resultRef, (snapshot) => {
          const val = snapshot.val();
          if (val?.result) {
            clearTimeout(timeout);
            off(resultRef);
            resolve(val);
          }
        });
      });

      console.log('📥 FirebaseSIP2.checkin RTDB result:', sip2Data);
      const resp = sip2Data?.result || sip2Data;
      return {
        ok: (resp.ok === true || resp.ok === 1 || resp.responseType === '10') ? 1 : 0,
        endpoint: 'checkin',
        itemIdentifier: resp.itemIdentifier || resp.AB || itemId,
        patronIdentifier: resp.patronIdentifier || resp.CY || null,
        CY: resp.CY || resp.patronIdentifier || null,
        titleIdentifier: resp.titleIdentifier || resp.AJ || null,
        CM: resp.CM || null,
        holdExpiration: resp.CM || null,
        circulationStatus: resp.circulationStatus || null,
        raw: sip2Data,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      console.error('❌ FirebaseSIP2.checkin error:', error?.message || error, error);
      return {
        ok: 0,
        endpoint: 'checkin',
        itemId,
        screenMessage: `SIP2 checkin failed: ${error?.message || error}`,
        timestamp: new Date().toISOString()
      };
    }
  },

  /**
   * Get item information via SIP2 ITEM_INFORMATION request
   * @param itemId - The item barcode/ID
   * @returns Parsed SIP2 item info response
   */
  itemInfo: async (itemId: string) => {
    console.log('ℹ️  FirebaseSIP2.itemInfo:', { itemId });

    const branch = sessionBranch.value;
    const currentLicenseId = sessionLicenseId.value;
    const branchId = branch?.id;
    const institutionId = branch?.sip2Settings?.institutionId || '';
    const hybridsipUrl = 'https://sip2proxy-be4ekemxaa-uc.a.run.app';

    // Skip for demo licenses
    if (currentLicenseId === 1 || currentLicenseId === 2) {
      console.log('ℹ️  FirebaseSIP2.itemInfo: Demo mode, returning mock');
      return { ok: 1, endpoint: 'iteminfo', itemId, circulationStatus: 8, timestamp: new Date().toISOString() };
    }

    try {
      const { getFirebaseAuth } = await import('./firebase-client');
      const auth = getFirebaseAuth();
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('User not authenticated');
      const idToken = await currentUser.getIdToken();

      const response = await fetch(`${hybridsipUrl}/hybridsip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({
          licenseId: currentLicenseId,
          branchId,
          type: 'ITEMINFO',
          message: { itemId, institutionId }
        })
      });

      const data = await response.json();
      console.log('ℹ️  FirebaseSIP2.itemInfo POST response:', data);

      // The hybridsip endpoint returns an RTDB path — wait for the actual SIP2 result
      const rtdbPath = data?.rtdbPath;
      if (!rtdbPath) throw new Error('No rtdbPath in hybridsip response');

      const { getFirebaseDatabase } = await import('./firebase-client');
      const { ref, onValue, off } = await import('firebase/database');
      const db = getFirebaseDatabase();
      const resultRef = ref(db, rtdbPath);

      const sip2Data: any = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { off(resultRef); reject(new Error('SIP2 RTDB timeout (15s)')); }, 15000);
        onValue(resultRef, (snapshot) => {
          const val = snapshot.val();
          if (val?.result) {
            clearTimeout(timeout);
            off(resultRef);
            resolve(val);
          }
        });
      });

      console.log('ℹ️  FirebaseSIP2.itemInfo RTDB result:', sip2Data);
      const resp = sip2Data?.result || sip2Data;
      return {
        ok: (resp.responseType === '18') ? 1 : 0,
        endpoint: 'iteminfo',
        itemIdentifier: resp.itemIdentifier || resp.AB || itemId,
        titleIdentifier: resp.titleIdentifier || resp.AJ || null,
        circulationStatus: resp.circulationStatus || null,
        screenMessage: resp.screenMessage || resp.AF || null,
        holdQueueLength: resp.holdQueueLength || resp.CF || null,
        CF: resp.CF || resp.holdQueueLength || null,
        AJ: resp.AJ || resp.titleIdentifier || null,
        AB: resp.AB || resp.itemIdentifier || null,
        AF: resp.AF || resp.screenMessage || null,
        AG: resp.AG || null,
        CM: resp.CM || null,
        raw: sip2Data,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      console.error('❌ FirebaseSIP2.itemInfo error:', error?.message || error, error);
      return {
        ok: 0,
        endpoint: 'iteminfo',
        itemId,
        circulationStatus: null,
        screenMessage: `SIP2 item info failed: ${error?.message || error}`,
        AF: `SIP2 item info failed: ${error?.message || error}`,
        timestamp: new Date().toISOString()
      };
    }
  },

  /**
   * Get patron information
   * @param patronId - The patron barcode/ID
   * @returns Promise<{ok: number, endpoint: string, patronId: string}>
   */
  patronInfo: async (patronId: string) => {
    console.log('👤 FirebaseSIP2.patronInfo:', { patronId });

    const branch = sessionBranch.value;
    const currentLicenseId = sessionLicenseId.value;
    const branchId = branch?.id;
    const institutionId = branch?.sip2Settings?.institutionId || '';
    const hybridsipUrl = 'https://sip2proxy-be4ekemxaa-uc.a.run.app';

    // Skip for demo licenses
    if (currentLicenseId === 1 || currentLicenseId === 2) {
      console.log('👤 FirebaseSIP2.patronInfo: Demo mode, returning mock');
      return { ok: 1, endpoint: 'patroninfo', patronId, validPatron: 'Y', personalName: patronId, timestamp: new Date().toISOString() };
    }

    try {
      const { getFirebaseAuth } = await import('./firebase-client');
      const auth = getFirebaseAuth();
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error('User not authenticated');
      const idToken = await currentUser.getIdToken();

      const response = await fetch(`${hybridsipUrl}/hybridsip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
        body: JSON.stringify({
          licenseId: currentLicenseId,
          branchId,
          type: 'PATRONINFO',
          message: { patronId, institutionId, password: '' }
        })
      });

      const data = await response.json();
      console.log('👤 FirebaseSIP2.patronInfo POST response:', data);

      const rtdbPath = data?.rtdbPath;
      if (!rtdbPath) throw new Error('No rtdbPath in hybridsip response');

      const { getFirebaseDatabase } = await import('./firebase-client');
      const { ref, onValue, off } = await import('firebase/database');
      const db = getFirebaseDatabase();
      const resultRef = ref(db, rtdbPath);

      const sip2Data: any = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { off(resultRef); reject(new Error('SIP2 patronInfo RTDB timeout (15s)')); }, 15000);
        onValue(resultRef, (snapshot) => {
          const val = snapshot.val();
          if (val?.result) {
            clearTimeout(timeout);
            off(resultRef);
            resolve(val);
          }
        });
      });

      console.log('👤 FirebaseSIP2.patronInfo RTDB result:', sip2Data);
      const resp = sip2Data?.result || sip2Data;
      return {
        ok: (resp.ok === true || resp.ok === 1 || resp.validPatron === 'Y') ? 1 : 0,
        endpoint: 'patroninfo',
        patronIdentifier: resp.patronIdentifier || resp.AA || patronId,
        personalName: resp.personalName || resp.AE || null,
        emailAddress: resp.emailAddress || resp.BE || null,
        validPatron: resp.validPatron || resp.BL || 'N',
        screenMessage: resp.screenMessage || resp.AF || null,
        raw: sip2Data,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      console.error('❌ FirebaseSIP2.patronInfo error:', error?.message || error, error);
      return {
        ok: 0,
        endpoint: 'patroninfo',
        patronId,
        validPatron: 'N',
        screenMessage: `SIP2 patronInfo failed: ${error?.message || error}`,
        timestamp: new Date().toISOString()
      };
    }
  },

  /**
   * Place a hold on an item for a patron
   * @param itemId - The item barcode/ID
   * @param patronId - The patron barcode/ID
   * @returns Promise<{ok: number, endpoint: string, itemId: string, patronId: string}>
   */
  holdForItem: async (itemId: string, patronId: string) => {
    console.log('📌 FirebaseSIP2.holdForItem:', { itemId, patronId });

    // TODO: In future, create hold in Firebase
    // const licenseId = sessionLicenseId.value;
    // const databaseUrl = sessionDatabaseUrl.value;
    // Create at: license_{licenseId}/holds/{holdId}

    return {
      ok: 1,
      endpoint: 'holdforitem',
      itemId,
      patronId,
      timestamp: new Date().toISOString()
    };
  },

  /**
   * Get system status
   * @returns Promise<{ok: number, endpoint: string}>
   */
  status: async () => {
    console.log('🔍 FirebaseSIP2.status');

    // TODO: In future, check Firebase connection status
    // const databaseUrl = sessionDatabaseUrl.value;

    return {
      ok: 1,
      endpoint: 'status',
      online: true,
      timestamp: new Date().toISOString()
    };
  }
};

export {
  updateSessionUserModeOn,
  sessionUserModeOn,
  updateSessionStaffModeOn,
  sessionStaffModeOn,
  persistDeviceManifestChanges,
  persistDeviceTheDoorsChanges,
  kioskConfig,
  updateKioskConfig,
  sessionIsReady,
  updateSessionIsReady,
  sessionLang,
  updateLang,
  sessionDevice,
  updateDevice,
  sessionTimer,
  updateSessionTimer,
  sessionBackgroundImage,
  updateSessionBackgroundImage,
  sessionWelcomeBackgroundColor,
  updateWelcomeBackgroundColor,
  sessionWelcomeBackgroundImage,
  updateWelcomeBackgroundImage,
  sessionDeviceId,
  updateSessionDeviceId,
  updateLocation,
  sessionLocation,
  sessionBranch,
  updateSessionBranch,
  sessionLicense,
  updateSessionLicense,
  sessionError,
  updateSessionError,
  sessionBarcode,
  updateSessionBarcode,
  sessionUser,
  updateSessionUser,
  sessionDoorStatus,
  updateSessionDoorStatus,
  validateItemInfo,
  validateIsSipOk,
  sessionWizard,
  setSessionWizard,
  updateShowBackgroundImage,
  showBackgroundImage,
  fontSize,
  updateFontSize,
  updateFontSizeStorage,
  fontSizeStorage,
  getTextStyle,
  playIndex,
  updatePlayIndex,
  libraryOfThingsGroup,
  setLibraryOfThingsGroup,
  SEBlue,
  SEBlueWithOpasity,
  customToast,
  getImage,
  updateStorageFiles,
  localized,
  updateLocalized,
  sessionSystemLang,
  updateSessionSystemLang,
  showReturnInfo,
  updateShowReturnInfo,
  updateIsHandpickMode,
  isHandpickMode,
  sessionLicenseId,
  updateSessionLicenseId,
  sessionDatabaseUrl,
  updateSessionDatabaseUrl,
  FirebaseSIP2,
  hotListItemIds,
  setHotListItemIds,
  getHotListItemIds,
  sessionSpinnerStatus,
  updateSessionSpinnerStatus,
  nextLockerNro,
  setNextLockerNro,
  doorStatuses,
  setDoorStatuses,
  itemStatuses,
  setItemStatuses,
  reopenCounts,
  trackReopenDoor,
  resetReopenCounts,
  slideshowActive,
  readHistory,
  clearReadHistory,
  adminAutoOpenDoor,
}
