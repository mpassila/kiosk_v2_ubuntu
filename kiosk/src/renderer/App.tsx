import { useState, useRef, CSSProperties, useEffect } from 'react';
import { ConfigProvider, Layout, theme, Flex, Menu, MenuProps, Badge, Avatar, Space, Card, Row, Modal, Button, Col, QRCode} from 'antd';
import { MailOutlined, SettingOutlined } from '@ant-design/icons';
import {  Route, useLocation, Router } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import _, { indexOf, reject } from 'lodash';
import { MenuItem, getMenuItem, appTheme } from './utils/ant-helpers';
import * as style from './App.styles';

// LEGACY REST IMPORT REMOVED
// import { resetHeaders } from './state/request';
import HomeLoTPage from './pages/HomeLoT';
import HomeHoldPage from './pages/HomeHold';
import OutoforderPage from './pages/Outoforder';
import MaintenancePage from './pages/Maintenance';
import AdminPage from './pages/Admin';
import ErrorPage from './pages/Error';
import HoldReturnPage from './pages/HoldReturn';
import HoldCheckoutPage from './pages/HoldCheckout';
import HoldCheckoutOfflinePage from './pages/HoldCheckoutOffline';
import { deviceService } from './state/device-service';


import 'react-toastify/dist/ReactToastify.css';
// LEGACY REST IMPORT REMOVED
// import { request, EndPoint } from './state/request';
import { sessionIsReady, updateSessionIsReady, sessionDevice, updateDevice, persistDeviceChanges, updateSessionBackgroundImage, kioskConfig, updateKioskConfig,
  sessionDeviceId, updateSessionDeviceId, sessionLocation, updateSessionLicense, updateSessionBranch, updateSessionBarcode,
  updateSessionDoorStatus, sessionStaffModeOn,
  sessionBackgroundImage, updateShowBackgroundImage, showBackgroundImage,
  customToast,
  SEBlue,
  getTextStyle,
  sessionBranch,
  sessionLicense,
  sessionLicenseId,
  updateSessionLicenseId,
  sessionWelcomeBackgroundColor,
  updateWelcomeBackgroundColor,
  sessionWelcomeBackgroundImage,
  updateWelcomeBackgroundImage,
  updateSessionDatabaseUrl,
  persistDeviceManifestChanges} from "./state/shared";

import {Promise} from "bluebird";
import { useSignals } from "@preact/signals-react/runtime";

// Polaris API endpoint for holds list
const POLARIS_API_BASE = 'https://polarisapi-be4ekemxaa-uc.a.run.app';
import { IconContext } from "react-icons";
import { openDoor, updateDoorStatus } from './state/locker';
import { readAllTags, initRfidService, connectRfidReader, rfidItemId, onRfidTagRead } from './state/rfid';
import LibraryOfThings from './pages/LoTCheckout';
import Spinner from './components/spinner';
import LibraryOfThingsReturn from './pages/LoTReturn';
import HoldCheckout from './pages/HoldCheckout';
import LoTCheckoutPage from './pages/LoTCheckout';
import LoTReturnPage from './pages/LoTReturn';
import { toast } from 'react-toastify';
let prosessingRFID = false;
const { Sider, Content, Footer, Header } = Layout;

export default function App() {

  useSignals();
  const [vendorModalOpen, setVendorModalOpen] = useState(false);
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const config = kioskConfig.value;
  const IstestMode = config.testmode;
  const [, setLocation] = useHashLocation();
  const licenseId = sessionLicenseId.value;
  const [isLoT, setIsLoT] = useState(false);
  const [isHoldPickup, setIsHoldPickup] = useState(false);
  const [isDynamicLoT, setIsDynamicLoT] = useState(false);
  const [isMainOffline, setIsMainOffline] = useState(false);
  const [isManualOfflineSwitch, setIsManualOfflineSwitch] = useState(false);

  // Check main process offline status and listen for changes
  useEffect(() => {
    const electron = (window as any).electron;
    const electronAPI = (window as any).electronAPI;

    // Check initial offline status
    if (electron?.sideeventNative?.isMainOperatingOffline) {
      electron.sideeventNative.isMainOperatingOffline().then((offline: boolean) => {
        console.log('📡 Initial main process status:', offline ? 'OFFLINE' : 'ONLINE');
        setIsMainOffline(offline);
      });
    }

    // Listen for offline status changes
    if (electronAPI?.onOfflineStatusChanged) {
      electronAPI.onOfflineStatusChanged((offline: boolean) => {
        console.log('📡 Main process status changed:', offline ? 'OFFLINE' : 'ONLINE');
        setIsMainOffline(offline);
      });
    }
  }, []);

  // run on init once
  useEffect(() => {
    setLocation('/ooo');
    // reLoadDevice(); // Just initializes deviceId, doesn't load device anymore
    scanner()
    rfidScanner() // Initialize RFID scanner (WebSocket-based)
    console.log(new Date())

    localStorage.setItem('IsTestMode', IstestMode ?? false)
    if (IstestMode) {
      customToast(() => 'Test mode is enabled', 2000, 'default', 'dark');
    }
   }, [])

  // Debug: Log when device mode states change
  useEffect(() => {
    console.log('📊 Device mode states updated:', {
      isHoldPickup,
      isLoT,
      isDynamicLoT,
      sessionReady: sessionIsReady.value
    });
  }, [isHoldPickup, isLoT, isDynamicLoT, sessionIsReady.value]);


  // helper functions *****************************************************
  function numOrAlpha(input:string) {
    let result = input.replace(/[^A-Za-z0-9-_+ ]/gi, '');
    return result;
  }

  function parseBarcode(barcode:any) {
    if (!barcode || barcode === '') return barcode;

    if (barcode.toUpperCase().includes('STAFF') && barcode.trim().split(' ').length === 2) {
        const testedArr = barcode.split(' ');
        barcode = `${numOrAlpha(testedArr[0])} ${numOrAlpha(testedArr[1])}`;
        return barcode;
    } else {
        barcode = numOrAlpha(barcode);
    }

    const barcodeLength = barcode.length;
    const lastDigitPos = barcodeLength - 1;
    const isFirstNumber = !isNaN(barcode[0]);
    const isLastNumber = !isNaN(barcode[lastDigitPos]);

    if (!!barcode && !isFirstNumber) {
        if (barcode[0].toUpperCase() === 'A' && !isLastNumber) {
            return barcode.slice(1, lastDigitPos);
        }

        if (barcode[0].toUpperCase() === 'B' && !isLastNumber) {
            return barcode.slice(1, lastDigitPos);
        }

        if (barcode[0].toUpperCase() === 'C' && !isLastNumber) {
            return barcode.slice(1, lastDigitPos);
        }

        if (licenseId === 1000001) {
            if (barcode[0].toUpperCase() === 'C' && +barcode[1].toUpperCase() === 1) {
                return barcode.slice(2);
            }
        }
        // codabar only checheck
        if (barcode[0].toUpperCase() === 'R' && !isNaN(barcode[1])) {
            return barcode.slice(1);
        }

        if (barcode.slice(0, 2).toUpperCase() === 'NK') {
            return barcode.trim();
        }
    }

    return barcode.toUpperCase();
  }

  function testItem() {
    const rnd = Math.floor(Math.random() * 1000); // 0-999
    const rndStr = rnd.toString().padStart(3, '0'); // 000-999
    return '300' + rndStr; // 300000-300999
  }

  async function scanner() {

    function enableReadBarcode() {
      const thisWindow: any = window;
      thisWindow.updateBarcodeScannerResults = '';
      thisWindow.electronAPI.onUpdateBarcodeScanner(async (barcode: string) => {
        // ignore new barcode if staff or user mode is on
          barcode = parseBarcode(barcode.trim())
          updateSessionBarcode(barcode)
          // setTimeout(() => { updateSessionBarcode('') }, 200);

      })
    }
    enableReadBarcode()

    try {
      new Promise(async (resolve, reject) => {
        const thisWindow: any = window;
        const cmd = await thisWindow.electron.sideeventNative.getCMD();
        cmd.run(
          `serialport-list -f json`,
          (err: any, data: string, _stderr: any) => {
            if (err || !data || !data.trim()) {
              resolve(null);
              return;
            }

            try {
              const result: any = _.filter(
                JSON.parse(data),
                (a) => a.manufacturer && (a.manufacturer.includes('Datalogic') || a.manufacturer.includes('Honeywell'))
              );
              if (result.length) {
                // toast.info(_.first(result)?.vendorId);
                // readBarcode();
              }
              resolve(true);
            } catch (parseError) {
              console.log('Failed to parse serialport-list output:', parseError);
              resolve(null);
            }
          }
        );
      });

    } catch (error) {
      console.log(error)
    }
  };

  // RFID Scanner initialization (WebSocket-based, similar to barcode scanner)
  async function rfidScanner() {
    console.log('🔌 RFID: Initializing RFID scanner...');

    try {
      // Initialize WebSocket connection to RFID server
      const initResult = await initRfidService();
      console.log('🔌 RFID: Service init result:', initResult);

      if (initResult.success) {
        // Connect to the RFID reader hardware
        const connectResult = await connectRfidReader();
        console.log('🔌 RFID: Reader connect result:', connectResult);

        if (connectResult.success) {
          console.log('✅ RFID: Reader connected, starting tag polling...');
          // Start polling for RFID tags
          processRFID();
        } else {
          console.warn('⚠️ RFID: Reader not connected, will retry polling anyway...');
          // Still start polling - it will retry connecting
          Promise.delay(3000).then(() => processRFID());
        }
      } else {
        console.warn('⚠️ RFID: Service not available (server may not be running) — will retry on next reload');
      }
    } catch (error) {
      console.error('❌ RFID: Error initializing scanner:', error);
    }
  }

  function processRFID() {
    if (prosessingRFID) return;
    prosessingRFID = true;

    try {
      // Poll on any page - the signal update will trigger Admin.tsx useEffect
      new Promise(async (resolve, reject) => {
        try {
          const result = await readAllTags();
          const tags = result?.tags || [];

          // Log for debugging and dispatch barcode
          if (tags.length > 0) {
            console.log('📡 RFID: Read', tags.length, 'tag(s)', JSON.stringify(tags));
            tags.forEach((tag: any) => {
              const itemId = tag.parsed?.barcode || tag.parsed?.itemId || 'unknown';
              console.log('   Tag:', tag.IDD || tag.idd, '-> parsed:', JSON.stringify(tag.parsed), '-> barcode:', itemId);
            });
            // Dispatch first tag's barcode via sessionBarcode (same as serial scanner)
            const firstBarcode = tags[0]?.parsed?.barcode || tags[0]?.parsed?.itemId;
            if (firstBarcode) {
              updateSessionBarcode(firstBarcode);
            }
          }

          // Delay before next poll (fixed interval)
          const delay = 1100;
          Promise.delay(delay).then(() => {
            prosessingRFID = false;
            processRFID();
          });
          resolve(true);
        } catch (error) {
          console.error('❌ RFID: Read error:', error);
          Promise.delay(3000).then(() => {
            prosessingRFID = false;
            processRFID();
          });
          resolve(false);
        }
      });
    } catch (error) {
      console.log(error)
      Promise.delay(5000).then(() => {
        prosessingRFID = false;
        processRFID();
      });
    }
  }

  async function processRTDBMessage(data: any) {

    console.log('processRTDBMessage', data)

    switch (data.type) {
      case 'LOCKER|OPENDOOR':
        // console.log('OPENDOOR', data)
        data.data.map(async (item: any) => {
          // console.log('Locker#' + item)
          await openDoor(sessionDevice.value.config.locker.mac, item)
        });
        break;
      case 'KIOSK':
        // console.log('KIOSK', data)
        break;
      case 'REBOOT':
        // console.log('REBOOT', data)
        break;
    }
  }

  function enableRTDBListener() {
    const thisWindow: any = window;
    thisWindow.updateBarcodeScannerResults = '';

    // Listen for RTDB messages (IPC channel named 'redis-kiosk-listener' for legacy compatibility)
    thisWindow.electronAPI.onUpdateRedis((data: any) => {
      const result = JSON.parse(data);
      processRTDBMessage(result)
      // console.log('Got RTDB data', result)

    })

    // Listen for token refresh requests from main process
    thisWindow.electronAPI.onTokenRefreshNeeded(async () => {
      console.log('🔄 Token refresh requested by main process');
      try {
        const { getFirebaseAuthToken } = await import('./state/firebase-client');
        const newToken = await getFirebaseAuthToken(true);

        if (newToken) {
          console.log('✅ New auth token obtained:', newToken.substring(0, 20) + '...');
          electron.sideeventNative.updateRTDBAuthToken(newToken);
        } else {
          console.error('❌ Failed to get new auth token - user may need to re-authenticate');
        }
      } catch (error) {
        console.error('❌ Error refreshing auth token:', error);
      }
    });

    // Proactive token refresh every 45 minutes to keep token healthy
    const tokenRefreshInterval = setInterval(async () => {
      try {
        const { getFirebaseAuthToken } = await import('./state/firebase-client');
        const freshToken = await getFirebaseAuthToken(true);
        if (freshToken) {
          console.log('🔄 Proactive token refresh successful');
          electron.sideeventNative.updateRTDBAuthToken(freshToken);
        }
      } catch (e) {
        console.error('❌ Proactive token refresh failed:', e);
      }
    }, 45 * 60 * 1000); // 45 minutes

    // Also do an immediate token refresh on startup
    (async () => {
      try {
        const { getFirebaseAuthToken } = await import('./state/firebase-client');
        const freshToken = await getFirebaseAuthToken(true);
        if (freshToken) {
          console.log('🔄 Startup token refresh successful');
          electron.sideeventNative.updateRTDBAuthToken(freshToken);
        }
      } catch (e) {
        console.error('❌ Startup token refresh failed:', e);
      }
    })();

    // Listen for COMMAND-FOR-CLIENT messages forwarded from main process
    thisWindow.electronAPI.onClientCommand(async (data: string) => {
      console.log('[CMD] Client command received from main:', data);
      try {
        const message = JSON.parse(data);

        if (message.type !== 'COMMAND-FOR-CLIENT') {
          console.log('[CMD] Skipping - not COMMAND-FOR-CLIENT');
          return;
        }

        const commandValue = message.data?.command || message.data?.COMMAND;
        console.log(`[CMD] Processing command: ${commandValue}`);

        // Get integration settings from current config (read fresh to avoid stale closures)
        const currentConfig = kioskConfig.value;
        const integrations = (currentConfig as any).integrations || [];
        const integration = integrations[0];
        const baseUrl = integration?.ip || 'localhost';
        const port = 5003;

        console.log(`[CMD] Integration IP: ${baseUrl}, port: ${port}`);

        switch (commandValue) {
          case 'OPENDOOR':
            console.log(`[CMD] OPENDOOR case entered`);
            console.log(`[CMD] message.data:`, message.data);
            if (message.data?.door) {
              const doorNumber = message.data.door;
              console.log(`[CMD] OPENDOOR - door ${doorNumber}`);

              try {
                const url = `http://${baseUrl}:${port}/data/dooropen?door=${doorNumber}`;
                console.log(`[CMD] Opening door via: ${url}`);

                const response = await fetch(url);
                const result = await response.text();
                console.log(`[CMD] Door ${doorNumber} opened, response:`, result);
              } catch (error) {
                console.error(`[CMD] Failed to open door ${doorNumber}:`, error);
              }
            } else {
              console.error('[CMD] OPENDOOR missing door number in message.data');
            }
            break;

          case 'DOORSTATUS':
            try {
              const statusUrl = `http://${baseUrl}:${port}/data/doorstatus`;
              console.log(`[CMD] Fetching door status from: ${statusUrl}`);

              const response = await fetch(statusUrl);
              const statusData = await response.json();
              console.log(`[CMD] Door status:`, statusData);
            } catch (error) {
              console.error(`[CMD] Failed to get door status:`, error);
            }
            break;

          case 'REBOOT':
          case 'RELOAD':
            console.log(`[CMD] REBOOT`);
            setTimeout(() => {
              window.location.reload();
            }, 500);
            break;

          case 'NAVIGATE':
            if (message.data?.route) {
              const route = message.data.route;
              console.log(`[CMD] NAVIGATE to ${route}`);
              if (route.startsWith('/')) {
                window.location.hash = `#${route}`;
              } else {
                window.location.hash = `#/${route}`;
              }
            } else {
              console.error('[CMD] NAVIGATE missing route');
            }
            break;

          default:
            console.log(`[CMD] Unknown command: ${commandValue}`);
        }
      } catch (error) {
        console.error('[CMD] Error processing client command:', error);
      }
    });

    // Note: Device-specific subscriptions are done after RTDB is initialized
    // See the integration loading section around line 910+ for actual subscriptions

    // Example RTDB publish (commented out)
    // thisWindow.electron.sideeventNative.rtdbPub(JSON.stringify({
    //   channel: sessionDeviceId.value+'KIOSK',
    //   type: 'KIOSK',
    //   licenseId: licenseId,
    //   data: {
    //     type: 'KIOSK',
    //     channel: sessionDeviceId.value,
    //     data: 'Kiosk app and RTDB pub/sub connection is running..'
    //   }
    // }));
    // Promise.delay(10000).then(async() => {
    //   thisWindow.electron.sideeventNative.rtdbPub(JSON.stringify({
    //     channel: sessionDeviceId.value,
    //     type: 'REBOOT',
    //     data: {
    //       type: 'REBOOT',
    //       channel: sessionDeviceId.value,
    //       data: {}

    //     }
    //   }));
    // });

  }

  // Fetch Polaris holds list and cache to localStorage
  async function fetchAndCacheHoldsList() {
    try {
      const branch = sessionBranch.value;
      const currentLicenseId = sessionLicenseId.value;

      // Check if Polaris is enabled
      if (!branch?.polarisSettings?.enabled) {
        console.log('📋 Polaris not enabled, skipping holds list fetch');
        return;
      }

      // Skip for demo licenses — Polaris API has no credentials for license 1 and 2
      if (currentLicenseId === 1 || currentLicenseId === 2 || currentLicenseId === '1' || currentLicenseId === '2') {
        return;
      }

      const branchId = branch?.id;
      const logonBranchId = branch?.polarisSettings?.logonBranchId;

      if (!currentLicenseId || !branchId || !logonBranchId) {
        console.warn('📋 Missing configuration for holds list fetch:', { currentLicenseId, branchId, logonBranchId });
        return;
      }

      const url = `${POLARIS_API_BASE}/${currentLicenseId}/${branchId}/patron/holds?branch=${encodeURIComponent(logonBranchId)}&branchtype=2&requeststatus=4`;
      console.log('📋 Fetching Polaris holds list from:', url);

      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await response.json();
      console.log('📋 Polaris holds list response:', {
        status: response.status,
        recordCount: data?.RecordCount,
        rowCount: data?.RequestPicklistRows?.length
      });

      if (data?.RequestPicklistRows) {
        // Filter to simplified view format
        const simplifiedHolds = data.RequestPicklistRows.map((hold: any) => ({
          ExpirationDate: hold.ExpirationDate,
          HoldStatus: hold.HoldStatus,
          PickupBranch: hold.PickupBranch,
          BrowseTitle: hold.BrowseTitle,
          PatronID: hold.PatronID,
          PatronBarcode: hold.PatronBarcode,
          ItemBarcode: hold.ItemBarcode,
          ItemRecordID: hold.ItemRecordID,
          MaterialType: hold.MaterialType,
          ShelfLocationID: hold.ShelfLocationID,
          ShelfLocation: hold.ShelfLocation
        }));

        // Cache to localStorage
        localStorage.setItem('polarisHoldsList', JSON.stringify({
          holds: simplifiedHolds,
          fetchedAt: new Date().toISOString(),
          recordCount: data.RecordCount || simplifiedHolds.length
        }));

        console.log(`✅ Polaris holds list cached: ${simplifiedHolds.length} items`);
      } else {
        console.log('📋 No holds found in Polaris response');
        localStorage.setItem('polarisHoldsList', JSON.stringify({
          holds: [],
          fetchedAt: new Date().toISOString(),
          recordCount: 0
        }));
      }
    } catch (error) {
      console.error('❌ Error fetching Polaris holds list:', error);
    }
  }

  async function checkDoorAllocation(persistDevice: any) {
    for (const groupIndex in persistDevice.locker_manifest.groups) {
      persistDevice.locker_manifest.groups[groupIndex].reserved_locks = []
      for (const doorNumber in persistDevice.locker_manifest.groups[groupIndex].lockers) {
        if (persistDevice.locker_manifest.groups[groupIndex].lockers[doorNumber]) {
          persistDevice.locker_manifest.groups[groupIndex].reserved_locks.push(+doorNumber)
        }
      }
      persistDevice.config.locker.groups[groupIndex] = persistDevice.locker_manifest.groups[groupIndex]
      updateDevice(persistDevice);
    }
    return persistDevice;
  }

  async function authenticateFirebase(licenseId: any) {
    try {
      console.log('🔐 Authenticating with Firebase...');

      // Get Firebase authentication credentials from config
      const { getFirebaseAuthCredentials } = await import('../../config');
      const { email, password } = getFirebaseAuthCredentials(licenseId);

      // Authenticate with Firebase using license-based credentials
      const { getFirebaseAuth } = await import('./state/firebase-client');
      const { signInWithEmailAndPassword } = await import('firebase/auth');

      const auth = getFirebaseAuth();

      console.log(`   Email: ${email}`);
      console.log(`   Password: ${password.substring(0, 5)}...${password.substring(password.length - 5)}`);

      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      console.log(`✅ Authenticated as: ${userCredential.user.email}`);

      return true;
    } catch (authError: any) {
      console.error('❌ Firebase authentication failed:', authError);
      console.error('   Make sure this user exists in Firebase Console → Authentication → Users');

      // Show error toast
      customToast(
        () => (
          <div>
            <b style={{ color: 'red' }}>Firebase authentication failed</b>
            <br />
            <small>{authError.message || 'Check credentials'}</small>
          </div>
        ),
        8000,
        'default',
        'dark'
      );

      return false;
    }
  }

  async function initializePubSub(license: any, deviceDocId: string) {
    try {
      if (!license || !license.databaseUrl) {
        console.warn('⚠️  Cannot initialize pub/sub: License or databaseUrl not available');
        return;
      }

      if (!deviceDocId) {
        console.warn('⚠️  Cannot initialize pub/sub: Device document ID not available');
        return;
      }

      console.log('📡 Initializing Firebase Realtime DB pub/sub...');
      console.log('   Using device doc ID:', deviceDocId);

      const { firebasePubSubService } = await import('./state/firebase-pubsub-service');

      // Initialize with database URL from license
      firebasePubSubService.initialize(license.databaseUrl);

      // Check if pubsub path exists, create if not
      const pathExists = await firebasePubSubService.ensurePubSubPathExists(deviceDocId);
      if (pathExists) {
        console.log(`✅ Pubsub path exists or created: pubsub/${deviceDocId}`);
      }

      // Helper function to execute OPENDOOR command
      async function executeOpenDoor(doorNumber: number) {
        console.log(`[CMD] OPENDOOR - door ${doorNumber}`);

        const integrations = (config as any).integrations || [];
        const integration = integrations[0];
        const baseUrl = integration?.ip || 'localhost';
        const port = 5003;

        try {
          const url = `http://${baseUrl}:${port}/data/dooropen?door=${doorNumber}`;
          console.log(`[CMD] Opening door via: ${url}`);

          const response = await fetch(url);
          const result = await response.text();
          console.log(`[CMD] Door ${doorNumber} opened:`, result);

          await fetchAndUpdateDoorStatus(doorNumber);
          return { success: true, result };
        } catch (error) {
          console.error(`[CMD] Failed to open door ${doorNumber}:`, error);
          return { success: false, error };
        }
      }

      // Helper function to execute DOORSTATUS command
      async function executeDoorStatus() {
        console.log(`[CMD] DOORSTATUS`);

        const integrations = (config as any).integrations || [];
        const integration = integrations[0];
        const baseUrl = integration?.ip || 'localhost';
        const port = 5003;

        try {
          const statusUrl = `http://${baseUrl}:${port}/data/doorstatus`;
          console.log(`[CMD] Fetching door status from: ${statusUrl}`);

          const response = await fetch(statusUrl);
          const statusData = await response.json();
          console.log(`[CMD] Door status:`, statusData);

          return { success: true, status: statusData };
        } catch (error) {
          console.error(`[CMD] Failed to get door status:`, error);
          return { success: false, error };
        }
      }

      // Helper function to execute REBOOT command
      async function executeReboot() {
        console.log(`[CMD] REBOOT`);
        toast.info('Rebooting...');

        // Give time for toast to show
        setTimeout(() => {
          window.location.reload();
        }, 1000);

        return { success: true };
      }

      // Helper function to execute NAVIGATE command
      async function executeNavigate(route: string) {
        console.log(`[CMD] NAVIGATE to ${route}`);

        // Use window.location for navigation
        if (route.startsWith('/')) {
          window.location.hash = `#${route}`;
        } else {
          window.location.hash = `#/${route}`;
        }

        return { success: true };
      }

      // Main handler for COMMAND-FOR-CLIENT messages
      async function handleClientCommand(message: any) {
        console.log('[CMD] Received:', message);

        if (message.type !== 'COMMAND-FOR-CLIENT') {
          console.log('[CMD] Skipping - not COMMAND-FOR-CLIENT');
          return;
        }

        const commandValue = message.data?.command || message.data?.COMMAND;
        console.log(`[CMD] Processing command: ${commandValue}`);

        switch (commandValue) {
          case 'OPENDOOR':
            if (message.data?.door) {
              await executeOpenDoor(message.data.door);
            } else {
              console.error('[CMD] OPENDOOR missing door number');
            }
            break;

          case 'DOORSTATUS':
            await executeDoorStatus();
            break;

          case 'REBOOT':
          case 'RELOAD':
            await executeReboot();
            break;

          case 'NAVIGATE':
            if (message.data?.route) {
              await executeNavigate(message.data.route);
            } else {
              console.error('[CMD] NAVIGATE missing route');
            }
            break;

          case 'TOAST':
            // Show a toast notification
            const toastMsg = message.data?.message || message.title || 'Notification';
            toast.info(toastMsg);
            break;

          default:
            // Unknown command - show toast with command info
            console.log(`[CMD] Unknown command: ${commandValue}`);
            toast.dismiss();
            setTimeout(() => {
              toast(() => (<b>{commandValue || JSON.stringify(message.data)}</b>), {
                autoClose: 1000,
                style: { width: '220%', fontSize: '12px', left: '-50%' },
                theme: 'dark',
                position: 'bottom-center',
              });
            }, 200);
        }
      }

      // Expose handleClientCommand to window for IPC access
      (window as any).handleClientCommand = handleClientCommand;

      // Helper function to fetch door status and update RTDB
      async function fetchAndUpdateDoorStatus(doorNumber: number) {
        try {
          const integrations = (config as any).integrations || [];
          const integration = integrations[0];
          const baseUrl = integration?.ip || 'localhost';
          const port = 5003;
          const deviceId = config.device?.id;
          const licenseId = String(config.license_id);
          const isLocalhost = baseUrl === 'localhost' || baseUrl === '127.0.0.1';

          if (!deviceId) {
            console.error('❌ Cannot update door status: device ID not available');
            return;
          }

          const statusUrl = `http://${baseUrl}:${port}/data/doorstatus`;
          console.log(`📊 Fetching door status from: ${statusUrl}`);

          const response = await fetch(statusUrl);
          const apiStatusData = await response.json();
          console.log('📊 Door status received:', apiStatusData);

          let doorInfo: any = null;
          let mac = '';
          let hwIndex = doorNumber;

          if (isLocalhost) {
            // Localhost format: { doorStatus: [{ connected, mac, index, number, locked }] }
            const doorStatusArray = apiStatusData?.doorStatus || [];
            doorInfo = doorStatusArray.find((d: any) => d.number === doorNumber);
            mac = doorInfo?.mac || '';
            hwIndex = doorInfo?.index ? parseInt(doorInfo.index) : doorNumber;
          } else {
            // Remote IP format: { content: { lockers: [{ alarm, locked, number, online }] }, type: "status" }
            const lockersArray = apiStatusData?.content?.lockers || [];
            doorInfo = lockersArray.find((d: any) => d.number === doorNumber);
            mac = integration?.macId || integration?.mac || '';
            hwIndex = doorNumber;
          }

          // Build status data in expected format
          const statusData = {
            MAC: mac || integration?.macId || integration?.mac || '',
            doorNumber: doorNumber,
            hwIndex: hwIndex,
            integrationHwId: integration?.id || '',
            ip: baseUrl,
            isOpen: doorInfo ? !doorInfo.locked : true // locked=false means isOpen=true
          };

          console.log('📊 Status data to save:', statusData);

          // Update RTDB with door status
          const { deviceService } = await import('./state/device-service');
          await deviceService.updateDoorStatus(deviceId, statusData, licenseId);
          console.log('✅ Door status updated in RTDB');
        } catch (error) {
          console.error('❌ Failed to fetch/update door status:', error);
        }
      }

      // COMMAND-FOR-CLIENT messages are handled via IPC from main process
      // Main process subscribes to RTDB via SSE and forwards messages via 'rtdb-client-command' IPC
      // See handleClientCommand() above for the command processing logic

      console.log(`✅ Pub/sub initialized for device: ${deviceDocId}`);

    } catch (error) {
      console.error('❌ Error initializing pub/sub:', error);
    }
  }

  async function handleTestPubSubMessage() {
    try {
      const deviceDocId = config.device?.id;
      if (!deviceDocId) {
        console.error('❌ Cannot publish: Device document ID not available');
        return;
      }

      console.log('📤 Publishing test message to pubsub...');
      console.log('   Using device doc ID:', deviceDocId);

      const { firebasePubSubService } = await import('./state/firebase-pubsub-service');

      const messageId = await firebasePubSubService.publish(deviceDocId, {
        type: 'NOTIFICATION',
        title: 'Hello from kiosk!',
        data: { message: 'This is a test from the kiosk app' },
        user: 'Kiosk System'
      });

      if (messageId) {
        console.log(`✅ Test message published successfully: ${messageId}`);
      } else {
        console.error('❌ Failed to publish test message');
      }
    } catch (error) {
      console.error('❌ Error publishing test message:', error);
    }
  }

  /**
   * Process offline checkout manifest when coming back online.
   * Reads checkoutManifest.json, processes each locker one at a time:
   * - Removes the locker from the online manifest (marks items as checked out)
   * - Persists the change to Firebase
   * - Moves processed locker to historyOfCheckoutManifestLockers.json
   * - Removes it from checkoutManifest.json
   */
  async function processCheckoutManifest() {
    const electron = (window as any).electron;
    try {
      const manifest = await electron.sideeventNative.getCheckoutManifest();
      if (!manifest || manifest.length === 0) {
        console.log('📋 No offline checkout items to process');
        return;
      }

      console.log(`📋 Processing ${manifest.length} offline checkout item(s)...`);

      for (let i = 0; i < manifest.length; i++) {
        const locker = manifest[i];
        const doorNumber = locker.doorNumber;
        const itemCount = locker.itemIds?.length || 0;

        console.log(`📋 [${i + 1}/${manifest.length}] Processing Locker #${doorNumber} (${itemCount} items)`);

        try {
          // Remove the locker from the live device manifest
          const updatedDevice = JSON.parse(JSON.stringify(sessionDevice.value));
          if (updatedDevice?.manifest?.groups) {
            for (const groupKey in updatedDevice.manifest.groups) {
              const group = updatedDevice.manifest.groups[groupKey];
              if (!group.lockers) continue;

              if (Array.isArray(group.lockers)) {
                const idx = group.lockers.findIndex((l: any) => l && +l.doorNumber === +doorNumber && String(l.patronId) === String(locker.patronId));
                if (idx !== -1) {
                  group.lockers.splice(idx, 1);
                  console.log(`📋 Removed locker door #${doorNumber} from group ${groupKey}`);
                  break;
                }
              } else {
                for (const lockerKey in group.lockers) {
                  const existing = group.lockers[lockerKey];
                  if (existing && +existing.doorNumber === +doorNumber && String(existing.patronId) === String(locker.patronId)) {
                    delete group.lockers[lockerKey];
                    console.log(`📋 Removed locker door #${doorNumber} from group ${groupKey}`);
                    break;
                  }
                }
              }
            }
          }

          // Log if locker was not found in any group
          const wasFound = updatedDevice?.manifest?.groups && Object.keys(updatedDevice.manifest.groups).some((gk: string) => {
            const g = updatedDevice.manifest.groups[gk];
            if (!g.lockers) return false;
            if (Array.isArray(g.lockers)) {
              return g.lockers.findIndex((l: any) => l && +l.doorNumber === +doorNumber) === -1;
            }
            return true;
          });
          console.log(`📋 Locker #${doorNumber} patronId=${locker.patronId} removal result: checked manifest groups`);

          // Persist to Firebase
          await persistDeviceManifestChanges(updatedDevice.manifest);

          // Update local sessionDevice
          sessionDevice.value = {
            ...sessionDevice.value,
            manifest: updatedDevice.manifest
          };

          // Move to history and remove from manifest
          await electron.sideeventNative.appendCheckoutHistory(locker);
          await electron.sideeventNative.removeFirstFromCheckoutManifest();

          customToast(() => (
            <div style={{ textAlign: 'center' }}>
              <b>Locker #{doorNumber}</b><br />
              <span>{itemCount} item(s) checked-out and online manifest updated</span>
            </div>
          ), 1000, 'default', 'dark');

          console.log(`✅ [${i + 1}/${manifest.length}] Locker #${doorNumber} processed successfully`);

          // Small delay between items
          if (i < manifest.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (error) {
          console.error(`❌ Failed to process Locker #${doorNumber}:`, error);
          // Stop processing on error - remaining items stay in manifest for next retry
          break;
        }
      }

      console.log('📋 Offline checkout manifest processing complete');
    } catch (error) {
      console.error('❌ Error processing checkout manifest:', error);
    }
  }

  async function loadFiles() {
    try {
      // Sync files with Firebase Storage
      // This will download new files and delete local files not in Firebase
      console.log('🔄 Initializing file sync with Firebase Storage...');

      const { firebaseStorageService } = await import('./state/firebase-storage-service');

      // Sync files from Firebase Storage for this license
      const syncStats = await firebaseStorageService.syncFilesWithLocalStorage(String(licenseId));

      console.log('📊 Firebase Storage sync results:');
      console.log(`  ✅ Downloaded: ${syncStats.downloaded} files`);
      console.log(`  🗑️  Deleted: ${syncStats.deleted} files`);
      console.log(`  📁 Total in Firebase: ${syncStats.total} files`);

      // If no files found, run debug to try different paths
      if (syncStats.total === 0) {
        console.warn('⚠️  No files found - running debug to try different paths...');
        const debugResults = await firebaseStorageService.debugFindFiles(String(licenseId));
        const successfulPaths = debugResults.filter(r => r.success && r.itemCount > 0);

        if (successfulPaths.length > 0) {
          console.log('✅ Found files at these paths:');
          successfulPaths.forEach(p => {
            console.log(`   - ${p.path}: ${p.itemCount} files`);
          });
          console.log('💡 Update firebase-storage-service.ts to use the correct path');
        } else {
          console.error('❌ No files found in any path');
          console.error('   Check Firebase Console → Storage to verify files exist');
        }
      }

      if (syncStats.errors.length > 0) {
        console.warn(`  ⚠️  Errors: ${syncStats.errors.length}`);
        syncStats.errors.forEach(err => console.error(`    - ${err}`));
      }

      // Load files from localStorage into config
      const files = localStorage.getItem('files');
      if (files) {
        config.files = JSON.parse(files);
        console.log('✅ Files loaded into config:', Object.keys(config.files).length, 'files');
      } else {
        console.log('⚠️  No files found in localStorage after sync');
        config.files = {};
      }

      updateKioskConfig(config);

    } catch (error) {
      console.error('❌ Error during Firebase Storage sync:', error);

      // Fallback: load from localStorage if Firebase sync fails
      console.log('⚠️  Falling back to localStorage...');
      const files = localStorage.getItem('files');
      if (files) {
        config.files = JSON.parse(files);
        console.log('Files loaded from localStorage (fallback):', Object.keys(config.files).length, 'files');
      } else {
        config.files = {};
      }

      updateKioskConfig(config);

      // Show error toast
      customToast(
        () => (
          <div>
            <b style={{ color: 'red' }}>Firebase Storage sync failed</b>
            <br />
            Using cached files from localStorage
          </div>
        ),
        5000,
        'default',
        'dark'
      );
    }
  }

  useEffect(() => {
    // Load config.device from localStorage cache first (for immediate UI)
    const cachedDevice = localStorage.getItem('configDevice');
    if (cachedDevice && !config.device) {
      try {
        config.device = JSON.parse(cachedDevice);
        updateKioskConfig(config);
        console.log('✅ Loaded config.device from localStorage cache:', {
          deviceId: config.device.deviceId,
          hasGroups: !!config.device.manifest?.groups,
          groupsCount: config.device.manifest?.groups ?
            (Array.isArray(config.device.manifest.groups) ?
              config.device.manifest.groups.length :
              Object.keys(config.device.manifest.groups).length) : 0
        });
      } catch (error) {
        console.error('❌ Error loading config.device from localStorage:', error);
      }
    }

    // Always load from Firebase (will be handled by licenseId useEffect below)
    if (licenseId) {
      console.log('🔄 useEffect triggered with licenseId:', licenseId);

      // Load license data from Firebase Firestore via main process (includes databaseUrl, offline backup)
      (async () => {
        try {
          const electron = (window as any).electron;
          const projectId = 'library-456310'; // Firebase project ID
          const apiKey = 'AIzaSyDkLFi9dmDS0jEfpTd-n1gO8I-kReGO9rg'; // Firebase API key for public read

          // Try to authenticate before Firestore access (security rules require it)
          // If offline, auth will fail but we'll fall back to backup files
          console.log('🔄 Authenticating before license load...');
          let authToken = null;
          try {
            const authSuccess = await authenticateFirebase(licenseId);
            if (!authSuccess) {
              console.warn('⚠️ Authentication failed, will try backup or cached data');
            } else {
              // Get auth token for Firestore after successful authentication
              const { getFirebaseAuthToken } = await import('./state/firebase-client');
              authToken = await getFirebaseAuthToken();
              console.log('✅ Auth token obtained for Firestore');
            }
          } catch (authError) {
            console.warn('⚠️ Authentication error (possibly offline), will use backup:', authError);
            // Continue without auth token - main process will fall back to backup
          }

          // Load license via main process IPC (with offline backup support)
          const licenseData = await electron.sideeventNative.loadLicenseFromFirestore(
            String(licenseId),
            projectId,
            apiKey,
            authToken
          );

          if (!licenseData) {
            console.error('❌ License not found:', licenseId);
            return;
          }

          updateSessionLicense(licenseData);

          // If databaseUrl is still missing, construct it as fallback
          if (!licenseData.databaseUrl) {
            console.warn('⚠️  License data missing databaseUrl, using default');
            licenseData.databaseUrl = `https://library-456310-license${licenseId}-rtdb.firebaseio.com`;
          }

          // Store databaseUrl in shared state for use throughout the app
          updateSessionDatabaseUrl(licenseData.databaseUrl);
          console.log('✅ Database URL set from license:', licenseData.databaseUrl);

          // Configure license database URL in main process AND device service
          console.log('🔧 Configuring license database URL in main process...');
          await electron.sideeventNative.setLicenseDatabaseUrl(String(licenseId), licenseData.databaseUrl);
          deviceService.setLicenseDatabaseUrl(String(licenseId), licenseData.databaseUrl);
          console.log('✅ License database URL configured for license:', licenseId);

          // Note: Authentication was already done before loading license

          // Cache auth token once — reuse throughout init instead of fetching multiple times
          const { getFirebaseAuthToken } = await import('./state/firebase-client');
          const cachedAuthToken = await getFirebaseAuthToken();
          console.log('🔑 Cached auth token for init:', cachedAuthToken ? 'obtained' : 'not available');

          // Load branches and localizations in parallel (both are independent Firestore reads)
          const { loadAndCacheBranches, loadAndCacheLocalizations } = await import('./state/firestore');
          const [, firestoreLocalizations] = await Promise.all([
            loadAndCacheBranches(licenseId).catch(error => {
              console.error('❌ Error loading branches:', error);
            }),
            loadAndCacheLocalizations(licenseId).catch(error => {
              console.error('❌ Error loading localizations:', error);
              return {} as Record<string, any>;
            })
          ]);

          // Add Firestore localizations to i18n resources
          try {
            if (firestoreLocalizations && Object.keys(firestoreLocalizations).length > 0) {
              const i18nInstance = (await import('i18next')).default;
              const _ = (await import('lodash')).default;
              const { updateLocalized, localized } = await import('./state/shared');

              const defaultLang = require('./language/en.json');

              console.log('🌐 App.tsx: Adding Firestore localizations to i18n...');

              for (const docId of Object.keys(firestoreLocalizations)) {
                const firestoreLang = firestoreLocalizations[docId];
                const langKey = firestoreLang.langKey || docId;

                let localizedLang: any = {};
                try {
                  localizedLang = require(`./language/${langKey}.json`);
                } catch (e) { /* No local file */ }

                const SAAS = _.merge(
                  {},
                  defaultLang.SAAS,
                  localizedLang.SAAS || {},
                  firestoreLang.SAAS || firestoreLang.translations || {}
                );

                const translation = _.merge(
                  {},
                  defaultLang,
                  localizedLang,
                  {
                    key: langKey,
                    lang: langKey,
                    name: firestoreLang.nativeName || localizedLang.name || langKey.toUpperCase(),
                    icon: firestoreLang.iconUrl || localizedLang.icon || `https://flagicons.lipis.dev/flags/4x3/${langKey}.svg`,
                    SAAS: SAAS
                  }
                );

                i18nInstance.addResourceBundle(langKey, 'translation', translation, true, true);
                updateLocalized({...localized.value, [langKey]: {translation}});
                console.log(`🌐 Added language to i18n: ${langKey} (${firestoreLang.nativeName || langKey})`);
              }
            }
          } catch (error) {
            console.error('❌ Error processing localizations:', error);
          }

          // Load device from Firebase Realtime DB via main process (no CORS issues)
          console.log('🔄 Loading device from Firebase Realtime DB (via main process)...');
          console.log('   Device ID:', config.deviceId);
          console.log('   License ID:', licenseId);
          console.log('   Database URL:', licenseData.databaseUrl);

          const rtdbAuthToken = cachedAuthToken;
          console.log('   Auth Token:', rtdbAuthToken ? 'obtained (cached)' : 'not available');

          const firebaseDevice = await electron.sideeventNative.loadDeviceFromFirebase(
            String(licenseId),
            config.deviceId,
            licenseData.databaseUrl,
            rtdbAuthToken
          );

          if (firebaseDevice) {
            console.log('Device loaded from Firebase Realtime DB:', {
              deviceId: firebaseDevice.deviceId,
              id: firebaseDevice.id,
              isLoTLocker: firebaseDevice.isLoTLocker,
              isHoldLocker: firebaseDevice.isHoldLocker,
              hasManifest: !!firebaseDevice.manifest,
              hasGroups: !!firebaseDevice.manifest?.groups,
              groupsCount: firebaseDevice.manifest?.groups ?
                (Array.isArray(firebaseDevice.manifest.groups) ?
                  firebaseDevice.manifest.groups.length :
                  Object.keys(firebaseDevice.manifest.groups).length) : 0,
              hasHomescreen: !!firebaseDevice.homescreen,
              homescreenEnabled: firebaseDevice.homescreen?.enabled,
              allKeys: Object.keys(firebaseDevice).slice(0, 20) // Show first 20 keys
            });

            // Log Hardware Integrations status
            const hwIntegrations = firebaseDevice.settings?.hwIntegrations;
            if (hwIntegrations) {
              console.log('🔌 Hardware Integrations:', {
                rfidEnabled: hwIntegrations.rfidEnabled || false,
                barcodeEnabled: hwIntegrations.barcodeEnabled || false,
                pusatecEnabled: hwIntegrations.pusatecEnabled || false,
                packageConciergeEnabled: hwIntegrations.packageConciergeEnabled || false
              });

              // Start hardware integration health check cron job (every 10 minutes)
              const hasEnabledIntegrations = hwIntegrations.rfidEnabled || hwIntegrations.barcodeEnabled || hwIntegrations.pusatecEnabled || hwIntegrations.packageConciergeEnabled;
              if (hasEnabledIntegrations) {
                console.log('🔌 Starting hardware integration health check (every 10 mins)');

                const testHwIntegrations = () => {
                  console.log('🔌 [HW Health Check] Running hardware integration tests...');

                  if (hwIntegrations.rfidEnabled) {
                    // TODO: Add actual RFID test
                    console.log('🔌 [HW Health Check] RFID test completed');
                  }
                  if (hwIntegrations.barcodeEnabled) {
                    // TODO: Add actual barcode test
                    console.log('🔌 [HW Health Check] Barcode test completed');
                  }
                  if (hwIntegrations.pusatecEnabled) {
                    // Pusatec health check is done in door status polling (pollDoorStatus)
                    console.log('🔌 [HW Health Check] Pusatec - checked via door status polling');
                  }
                  if (hwIntegrations.packageConciergeEnabled) {
                    // Package Concierge health check is done in door status polling (pollDoorStatus)
                    console.log('🔌 [HW Health Check] Package Concierge - checked via door status polling');
                  }

                  console.log('🔌 [HW Health Check] All enabled integration tests completed');
                };

                // Run immediately on startup
                testHwIntegrations();

                // Then run every 10 minutes (600000ms)
                setInterval(testHwIntegrations, 10 * 60 * 1000);
              }
            } else {
              console.log('🔌 Hardware Integrations: Not configured');
            }

            // If device type properties are missing, fetch them directly from RTDB
            if (firebaseDevice.isLoTLocker === undefined || firebaseDevice.isHoldLocker === undefined) {
              console.warn('⚠️  Device type properties missing from loadDeviceFromFirebase response');
              console.log('🔧 Fetching device type properties directly from RTDB...');

              try {
                const { getFirebaseAuth } = await import('./state/firebase-client');
                const auth = getFirebaseAuth();
                const currentUser = auth.currentUser;

                if (currentUser) {
                  const authToken = await currentUser.getIdToken();
                  // Use firebaseDevice.id (the document key) instead of config.deviceId
                  const deviceKey = firebaseDevice.id || config.deviceId;
                  const deviceTypesUrl = `${licenseData.databaseUrl}/license_${licenseId}/devices/${deviceKey}.json?auth=${authToken}`;

                  console.log('🔍 Fetching from URL:', deviceTypesUrl.replace(authToken, 'TOKEN_HIDDEN'));

                  const response = await fetch(deviceTypesUrl);
                  const fullDevice = await response.json();

                  if (fullDevice) {
                    console.log('✅ Fetched device type properties:', {
                      isLoTLocker: fullDevice.isLoTLocker,
                      isHoldLocker: fullDevice.isHoldLocker
                    });

                    // Merge the device type properties into firebaseDevice
                    firebaseDevice.isLoTLocker = fullDevice.isLoTLocker ?? false;
                    firebaseDevice.isHoldLocker = fullDevice.isHoldLocker ?? false;
                  } else {
                    console.error('❌ Device not found at path:', `license_${licenseId}/devices/${deviceKey}`);
                    // Set defaults if device not found
                    firebaseDevice.isLoTLocker = false;
                    firebaseDevice.isHoldLocker = false;
                  }
                } else {
                  console.error('❌ Cannot fetch device types - not authenticated');
                }
              } catch (error) {
                console.error('❌ Error fetching device type properties:', error);
                // Set defaults on error
                firebaseDevice.isLoTLocker = false;
                firebaseDevice.isHoldLocker = false;
              }
            }

            // Set config.device directly from Firebase
            config.device = firebaseDevice;

            await updateKioskConfig(config);
            console.log('Updated kioskConfig with Firebase device data');
            console.log('   Device ID:', config.device.deviceId);
            console.log('   License ID:', config.device.licenseId);
            console.log('   Homescreen:', config.device.homescreen);
            console.log('   Homescreen enabled:', config.device.homescreen?.enabled);

            // Set up device modes from Firebase device
            // Map Firebase device structure to the old sessionDevice structure for compatibility
            const compatDevice = {
              ...firebaseDevice,
              config: {
                locker: {
                  mac: firebaseDevice.settings?.mac || firebaseDevice.mac || null,
                  is_holdpickup: firebaseDevice.isHoldLocker || false,
                  is_dynamic: firebaseDevice.settings?.isDynamicLoT || false,
                  is_lotlocker: firebaseDevice.isLoTLocker || false,
                  groups: firebaseDevice.manifest?.groups || [],
                  settings: firebaseDevice.settings || {}
                }
              },
              // Ensure thedoors, manifest, and settings are passed through
              thedoors: firebaseDevice.thedoors || [],
              manifest: firebaseDevice.manifest || null,
              settings: firebaseDevice.settings || null,
              enabled: firebaseDevice.enabled !== false,
              isHoldLocker: firebaseDevice.isHoldLocker || false,
              isLoTLocker: firebaseDevice.isLoTLocker || false
            };

            // Set device modes based on new device type properties
            const isHoldLockerType = compatDevice.isHoldLocker || false;
            const isLoTLockerType = compatDevice.isLoTLocker || false;

            console.log('🔧 Setting device mode states:', {
              isHoldLockerType,
              isLoTLockerType,
              isDynamic: compatDevice.config.locker.is_dynamic || false
            });

            setIsHoldPickup(isHoldLockerType);
            setIsLoT(isLoTLockerType);
            setIsDynamicLoT(isLoTLockerType && (compatDevice.config.locker.is_dynamic || false));

            console.log('✅ Device mode states set (will apply on next render)');

            // Check if device is disabled at startup
            if (compatDevice.enabled === false) {
              console.warn('⚠️ Device is disabled - routing to /ooo');
              updateDevice(compatDevice);
              setLocation('/ooo');
              updateSessionIsReady(true);
              return;
            }

            // Check offline status directly from main process (not React state which may be stale)
            const currentOfflineStatus = await electron.sideeventNative.isMainOperatingOffline();
            setIsMainOffline(currentOfflineStatus); // Update React state too

            // LoT mode requires internet for SaaS access - redirect to out of order if offline
            // Hold mode can continue offline (patron lookup will use cached data)
            if (isLoTLockerType && currentOfflineStatus) {
              console.error('❌ LoT mode requires internet access - currently offline');
              setLocation('/ooo');
              updateSessionIsReady(true);
              customToast(() => (
                <div style={{ textAlign: 'center' }}>
                  <b style={{ color: '#ff4d4f' }}>No Internet Connection</b>
                  <br />
                  <span>LoT Locker mode requires access to internet or SaaS.</span>
                  <br />
                  <span>Please check your network connection.</span>
                </div>
              ), 10000, 'default', 'dark');
              return; // Stop further initialization
            }

            if (isHoldLockerType && currentOfflineStatus) {
              if (firebaseDevice.allowOfflineMode) {
                console.warn('⚠️ Hold mode running in offline mode (allowOfflineMode enabled) - some features may be limited');
              } else {
                console.error('❌ Hold mode offline but allowOfflineMode not enabled - routing to /ooo');
                setLocation('/ooo');
                updateSessionIsReady(true);
                customToast(() => (
                  <div style={{ textAlign: 'center' }}>
                    <b style={{ color: '#ff4d4f' }}>No Internet Connection</b>
                    <br />
                    <span>Offline mode is not enabled for this device.</span>
                    <br />
                    <span>Please check your network connection.</span>
                  </div>
                ), 10000, 'default', 'dark');
                return;
              }
            }

            // Load integrations from Firestore for this device
            // Match by bindDeviceId (the Firebase key from loaded device)
            console.log('🔄 Loading integrations for device from Firestore...');
            console.log(`   Device Firebase key: ${compatDevice.id}`);
            try {
              const { loadAndCacheIntegrations } = await import('./state/firestore');

              // Load integration bound to this device by its Firebase key (device.id)
              const integrations = await loadAndCacheIntegrations(
                String(licenseId),
                compatDevice.id // This is the Firebase key like "1760724910566_xsnvrb0l5"
              );

              if (integrations && integrations.length > 0) {
                console.log('✅ Integrations loaded:', {
                  count: integrations.length,
                  integration: integrations[0]
                });

                // You can also store in config if needed for global access
                (config as any).integrations = integrations;

                // Reuse cached auth token for RTDB operations
                const authToken = cachedAuthToken;

                if (!authToken) {
                  console.error('❌ Auth token is null - user may not be authenticated');
                  throw new Error('Auth token is null - cannot initialize RTDB without authentication');
                }

                console.log('✅ Auth token (cached):', authToken.substring(0, 20) + '...');

                // Initialize RTDB pub/sub with database URL and auth token
                console.log('🔄 Initializing RTDB pub/sub...');
                electron.sideeventNative.initRTDB(licenseData.databaseUrl, authToken);

                // Convert integrations array to object format for compatibility with setRTDBIntegrations
                const integrationsObj: any = {};
                integrations.forEach(integration => {
                  integrationsObj[integration.id] = integration;
                });

                // Set integrations data in main process for IP lookup
                console.log('🔄 Setting integrations data in RTDB pub/sub...');
                electron.sideeventNative.setRTDBIntegrations(integrationsObj);

                // Subscribe to RTDB channels for each integration's macId
                console.log('🔄 Subscribing to RTDB channels for integration macIds...');
                let subscriptionCount = 0;

                // Collect all macIds and integrations data for saving to localConfig.json
                const allMacIds: string[] = [];
                const integrationsData: Array<{ip: string, mac: string}> = [];

                for (const integration of integrations) {
                  if (integration.macId) {
                    // Collect macId and integration data (no longer subscribing to macId channels)
                    allMacIds.push(integration.macId);
                    integrationsData.push({
                      ip: integration.ip || 'localhost',
                      mac: integration.macId
                    });
                  }
                }

                // Subscribe only to deviceDocId (Firebase key) - this is the main device pubsub channel
                if (compatDevice.id) {
                  console.log('📡 Subscribing to RTDB channel for deviceDocId:', compatDevice.id);
                  electron.sideeventNative.rtdbSub(compatDevice.id, String(licenseId));
                  subscriptionCount++;

                  // Get locker IP from first integration with a non-localhost IP
                  const lockerIp = integrationsData.find(i => i.ip && i.ip !== 'localhost')?.ip || null;

                  // Initialize door status watcher (polls locker via HTTP or watches file)
                  console.log('📡 Initializing door status watcher...');
                  console.log(`   Locker IP: ${lockerIp || 'not provided (will use file watcher)'}`);
                  electron.sideeventNative.initDoorStatusWatcher(
                    licenseData.databaseUrl,
                    authToken,
                    String(licenseId),
                    compatDevice.id,
                    lockerIp
                  );
                }

                console.log(`✅ Total RTDB subscriptions: ${subscriptionCount}`);

                // Save all macIds and integrations to localConfig.json at root directory
                if (allMacIds.length > 0) {
                  try {
                    // Use Electron IPC to write to localConfig.json via main process
                    const macsString = allMacIds.join(',');
                    await electron.sideeventNative.updateLocalConfigMacs(macsString, integrationsData);
                    console.log(`✅ Updated localConfig.json with ${allMacIds.length} macIds:`, macsString);
                    console.log(`✅ Updated localConfig.json with ${integrationsData.length} integrations`);
                  } catch (error) {
                    console.error('❌ Error writing macIds to localConfig.json:', error);
                  }
                }
              } else {
                console.log('ℹ️  No integrations found for this device');
                localStorage.removeItem('integrations');

                // Still init RTDB and subscribe to device pubsub channel even without integrations
                if (compatDevice.id && licenseData.databaseUrl && cachedAuthToken) {
                  try {
                    console.log('🔄 Initializing RTDB pub/sub (no integrations)...');
                    electron.sideeventNative.initRTDB(licenseData.databaseUrl, cachedAuthToken);
                    console.log('📡 Subscribing to RTDB channel for deviceDocId:', compatDevice.id);
                    electron.sideeventNative.rtdbSub(compatDevice.id, String(licenseId));
                  } catch (tokenError) {
                    console.error('❌ Error initializing RTDB without integrations:', tokenError);
                  }
                }
              }
            } catch (error) {
              console.error('❌ Error loading integrations:', error);
              // Try to use cached integrations from localStorage
              const cachedIntegrations = localStorage.getItem('integrations');
              const cachedLicenseId = localStorage.getItem('integrations_licenseId');
              if (cachedIntegrations && cachedLicenseId === String(licenseId)) {
                console.log('ℹ️  Using cached integrations from localStorage');
                const integrations = JSON.parse(cachedIntegrations);
                (config as any).integrations = integrations;

                // Initialize RTDB pub/sub even with cached data
                console.log('🔄 Initializing RTDB pub/sub with cached integrations...');

                if (cachedAuthToken) {
                  electron.sideeventNative.initRTDB(licenseData.databaseUrl, cachedAuthToken);
                } else {
                  console.warn('⚠️  No auth token available - initializing without auth (may cause 401 errors)');
                  electron.sideeventNative.initRTDB(licenseData.databaseUrl);
                }

                // Set cached integrations data in main process for IP lookup
                console.log('🔄 Setting cached integrations data in RTDB pub/sub...');
                electron.sideeventNative.setRTDBIntegrations(integrations);

                // Subscribe to RTDB channels for cached integration macIds
                console.log('🔄 Subscribing to RTDB channels for cached integration macIds...');
                let subscriptionCount = 0;

                for (const [integrationType, integration] of Object.entries(integrations)) {
                  if (integration && typeof integration === 'object') {
                    if ((integration as any).macId) {
                      const macId = (integration as any).macId;
                      console.log(`📡 Subscribing to RTDB channel for ${integrationType} macId: ${macId}`);
                      electron.sideeventNative.rtdbSub(macId, String(licenseId));
                      subscriptionCount++;
                    }

                    for (const [key, value] of Object.entries(integration)) {
                      if (value && typeof value === 'object' && (value as any).macId) {
                        const macId = (value as any).macId;
                        console.log(`📡 Subscribing to RTDB channel for ${integrationType}.${key} macId: ${macId}`);
                        electron.sideeventNative.rtdbSub(macId, String(licenseId));
                        subscriptionCount++;
                      }
                    }
                  }
                }

                // Also subscribe to device ID channel for remote commands
                if (compatDevice.id) {
                  console.log('📡 Subscribing to RTDB channel for deviceDocId (cached):', compatDevice.id);
                  electron.sideeventNative.rtdbSub(compatDevice.id, String(licenseId));
                  subscriptionCount++;
                }

                console.log(`✅ Subscribed to ${subscriptionCount} RTDB channels for cached integration macIds`);
              }
            }

            // Look up the full branch data from Firestore branches (includes polarisSettings)
            const deviceBranchId = firebaseDevice.settings?.branchId || firebaseDevice.settings?.branch;
            if (deviceBranchId) {
              console.log('🔍 Looking up branch:', deviceBranchId);

              // Load branches from localStorage (already cached from loadAndCacheBranches)
              const cachedBranches = localStorage.getItem('branches');
              if (cachedBranches) {
                try {
                  const branches = JSON.parse(cachedBranches);
                  const matchingBranch = branches.find((b: any) => b.id === deviceBranchId);

                  if (matchingBranch) {
                    console.log('✅ Found matching branch with full data:', {
                      id: matchingBranch.id,
                      name: matchingBranch.name,
                      hasPolarisSettings: !!matchingBranch.polarisSettings,
                      polarisEnabled: matchingBranch.polarisSettings?.enabled
                    });
                    updateSessionBranch(matchingBranch);
                  } else {
                    console.warn('⚠️  No matching branch found for id:', deviceBranchId);
                    // Use basic branch info from device settings as fallback
                    updateSessionBranch({
                      id: deviceBranchId,
                      branch_code: deviceBranchId,
                      name: firebaseDevice.settings?.name || 'Unknown Branch'
                    });
                  }
                } catch (parseError) {
                  console.error('❌ Error parsing cached branches:', parseError);
                }
              } else {
                console.warn('⚠️  No cached branches found, branch lookup skipped');
              }
            } else {
              console.warn('⚠️  Device has no branchId configured');
            }

            // Extract welcome background settings from device and save to signals/localStorage
            if (firebaseDevice.settings?.welcomeBackgroundColor) {
              updateWelcomeBackgroundColor(firebaseDevice.settings.welcomeBackgroundColor);
              console.log('🎨 Welcome background color:', firebaseDevice.settings.welcomeBackgroundColor);
            } else {
              // Clear if removed from device settings
              updateWelcomeBackgroundColor(null);
              console.log('🎨 Welcome background color cleared');
            }

            if (firebaseDevice.settings?.welcomeBackgroundImage) {
              // Parse filename from URL (same logic as getImage in shared.ts)
              let filename = firebaseDevice.settings.welcomeBackgroundImage;

              if (filename.startsWith('http://') || filename.startsWith('https://')) {
                try {
                  const url = new URL(filename);
                  const pathname = url.pathname.substring(1);

                  // For Firebase Storage URLs: v0/b/{bucket}/o/{path}
                  if (pathname.includes('/o/')) {
                    const pathAfterO = pathname.split('/o/')[1];
                    const decodedPath = decodeURIComponent(pathAfterO);
                    filename = decodedPath.split('/').pop() || filename;
                  } else {
                    filename = pathname.split('/').pop() || filename;
                  }

                  // Remove query parameters
                  filename = filename.split('?')[0];

                  console.log('🖼️  Parsed welcome background image URL:', {
                    original: firebaseDevice.settings.welcomeBackgroundImage,
                    parsed: filename
                  });
                } catch (error) {
                  console.error('❌ Error parsing welcome background image URL:', error);
                  filename = filename.split('/').pop()?.split('?')[0] || filename;
                }
              } else {
                // Not a URL, just extract filename
                filename = filename.split('/').pop()?.split('?')[0] || filename;
              }

              updateWelcomeBackgroundImage(filename);
              console.log('🖼️  Welcome background image filename:', filename);
            } else {
              // Clear if removed from device settings
              updateWelcomeBackgroundImage(null);
              console.log('🖼️  Welcome background image cleared');
            }

            // Update session device for compatibility with old code
            updateDevice(compatDevice);

            // Resize window based on displayScreenSize setting
            const screenSize = compatDevice?.settings?.displayScreenSize;
            if (screenSize) {
              const dims = screenSize === '10inch'
                ? { w: 1024, h: 768 }
                : { w: 1920, h: 1080 };
              console.log(`📐 Display size: ${screenSize} → ${dims.w}x${dims.h}`);
              (window as any).electronAPI?.setWindowSize?.(dims.w, dims.h);
            }

            console.log('✅ Device modes configured:', {
              isHoldLocker: isHoldLockerType,
              isLoTLocker: isLoTLockerType,
              isDynamicLoT: isLoTLockerType && (compatDevice.config.locker.is_dynamic || false),
              routeTo: isHoldLockerType ? 'HomeHold' : isLoTLockerType ? 'HomeLoT' : 'Out of Order'
            });

            // Device data now synced only via RTDB, not localStorage
            console.log('✅ Device loaded from RTDB (no localStorage caching)');
          } else {
            console.error('❌ Failed to load device from Firebase Realtime DB');
            console.error('   Device ID:', config.deviceId);
            console.error('   Make sure device exists at: license_${licenseId}/devices/{deviceKey}/settings/deviceId');
          }

          // Check if device was loaded before proceeding
          if (firebaseDevice) {
            // Then initialize pub/sub with device document ID
            await initializePubSub(licenseData, firebaseDevice.id);

            // Load cached files immediately for fast startup, then sync in background
            const cachedFiles = localStorage.getItem('files');
            if (cachedFiles) {
              config.files = JSON.parse(cachedFiles);
              updateKioskConfig(config);
              console.log('✅ Files loaded from cache:', Object.keys(config.files).length, 'files');
            }
            // Sync with Firebase Storage in background (non-blocking)
            loadFiles().catch(err => console.warn('⚠️ Background file sync failed:', err.message));

            // Check online status and set route BEFORE making session ready
            if (sessionLocation.value === '/ooo') {
              setLocation('/');
            }
          } else {
            // Device not found - redirect to out of order page
            console.warn('⚠️  Device not found, redirecting to out-of-order page');
            const donothing = sessionLocation.value === '/lot' || sessionLocation.value === '/lotreturn' || sessionLocation.value === '/device' || sessionLocation.value === '/hold';
            if (!donothing && sessionLocation.value !== '/ooo') {
              setLocation('/ooo');
            }
          }

          // Set session ready AFTER navigation is determined to avoid showing /ooo flash
          updateSessionIsReady(true);

          // Process any pending offline checkouts if online
          try {
            const electron = (window as any).electron;
            const offlineAtInit = await electron.sideeventNative.isMainOperatingOffline();
            if (!offlineAtInit) {
              processCheckoutManifest();
            }
          } catch (e) {
            console.warn('⚠️ Could not check offline status at init for manifest processing');
          }

          // Enable RTDB listener if device is ready
          enableRTDBListener();

          // Subscribe to device changes in RTDB to keep sessionDevice synchronized
          // This ensures SAAS-side changes are immediately reflected in the kiosk
          console.log('📡 Setting up global RTDB device subscription...');
          const unsubscribeDevice = deviceService.subscribeToDevice(
            config.deviceId,
            (() => {
              // Track last state to prevent unnecessary updates
              let lastStatusJson: string | null = null;
              let lastTheDoorsJson: string | null = null;
              let lastEnabled: boolean | null = null;
              let lastManifestJson: string | null = null;
              let lastSettingsJson: string | null = null;
              let lastDeviceMaintenanceJson: string | null = null;

              return (updatedDevice) => {
                if (updatedDevice) {
                  // Check if status, thedoors, enabled, manifest, settings, or deviceMaintenance actually changed before updating
                  const currentStatusJson = JSON.stringify(updatedDevice.status);
                  const currentTheDoorsJson = JSON.stringify(updatedDevice.thedoors);
                  const currentEnabled = updatedDevice.enabled ?? null;
                  const currentManifestJson = JSON.stringify(updatedDevice.manifest);
                  const currentSettingsJson = JSON.stringify(updatedDevice.settings);
                  const currentDeviceMaintenanceJson = JSON.stringify(updatedDevice.deviceMaintenance ?? null);

                  if (currentStatusJson === lastStatusJson && currentTheDoorsJson === lastTheDoorsJson && currentEnabled === lastEnabled && currentManifestJson === lastManifestJson && currentSettingsJson === lastSettingsJson && currentDeviceMaintenanceJson === lastDeviceMaintenanceJson) {
                    // Nothing changed, skip update
                    return;
                  }

                  // Log what changed
                  if (currentTheDoorsJson !== lastTheDoorsJson) {
                    console.log('📡 thedoors changed from RTDB - updating sessionDevice');
                  }
                  if (currentEnabled !== lastEnabled) {
                    console.log(`📡 enabled changed from RTDB: ${lastEnabled} → ${currentEnabled}`);
                  }
                  if (currentManifestJson !== lastManifestJson) {
                    console.log('📡 manifest changed from RTDB - updating sessionDevice');
                  }
                  if (currentSettingsJson !== lastSettingsJson) {
                    console.log('📡 settings changed from RTDB - updating sessionDevice');
                  }
                  if (currentDeviceMaintenanceJson !== lastDeviceMaintenanceJson) {
                    console.log(`📡 deviceMaintenance changed from RTDB: ${lastDeviceMaintenanceJson} → ${currentDeviceMaintenanceJson}`);
                  }

                  lastStatusJson = currentStatusJson;
                  lastTheDoorsJson = currentTheDoorsJson;
                  lastEnabled = currentEnabled;
                  lastManifestJson = currentManifestJson;
                  lastSettingsJson = currentSettingsJson;
                  lastDeviceMaintenanceJson = currentDeviceMaintenanceJson;

                  // Update config.device to keep it synchronized
                  config.device = updatedDevice;
                  updateKioskConfig(config);

                  // Map Firebase device structure to sessionDevice structure for compatibility
                  const compatDevice = {
                    ...updatedDevice,
                    config: {
                      locker: {
                        mac: updatedDevice.settings?.mac || updatedDevice.mac || null,
                        is_holdpickup: updatedDevice.isHoldLocker || false,
                        is_dynamic: updatedDevice.settings?.isDynamicLoT || false,
                        is_lotlocker: updatedDevice.isLoTLocker || false,
                        groups: updatedDevice.manifest?.groups || [],
                        settings: updatedDevice.settings || {}
                      }
                    },
                    thedoors: updatedDevice.thedoors || [],
                    manifest: updatedDevice.manifest || null,
                    settings: updatedDevice.settings || null,
                    status: updatedDevice.status || null, // Door status: { "1": { isOpen: true }, ... }
                    isHoldLocker: updatedDevice.isHoldLocker || false,
                    isLoTLocker: updatedDevice.isLoTLocker || false
                  };

                  // Log status updates for debugging
                  if (updatedDevice.status) {
                    console.log('📊 Door status from RTDB:', updatedDevice.status);
                  }

                  // Note: Do NOT update device mode flags (isHoldPickup, isLoT, isDynamicLoT) here
                  // These are set during initial device load and should not be reset on RTDB updates
                  // because isHoldLocker/isLoTLocker are not stored in RTDB - they are derived
                  // from device settings during initial load

                  // Update sessionDevice to keep it synchronized
                  updateDevice(compatDevice);
                  console.log('✅ Updated sessionDevice from RTDB subscription');

                  // Check device maintenance mode from RTDB
                  const maintenance = updatedDevice.deviceMaintenance;
                  let isInMaintenance = false;
                  if (maintenance?.maintenanceBreakOngoingNow === true) {
                    // Immediate maintenance break — works independently of schedule
                    isInMaintenance = true;
                  } else if (maintenance?.scheduledMaintenanceEnabled === true &&
                    maintenance.scheduledMaintenanceStart && maintenance.scheduledMaintenanceEnd &&
                    Date.now() >= maintenance.scheduledMaintenanceStart && Date.now() <= maintenance.scheduledMaintenanceEnd) {
                    // Within scheduled maintenance window
                    isInMaintenance = true;
                  }

                  if (isInMaintenance) {
                    console.warn(`⚠️ Device maintenance mode from RTDB (immediate: ${maintenance?.maintenanceBreakOngoingNow}, scheduled: ${maintenance?.scheduledMaintenanceEnabled}) - routing to /maintenance`);
                    setLocation('/maintenance');
                  } else if (!isInMaintenance && sessionLocation.value === '/maintenance') {
                    console.log('✅ Device maintenance ended from RTDB - routing to /');
                    setLocation('/');
                  }
                  // Check device enabled status from RTDB
                  // device.enabled=false always means /ooo, regardless of allowOfflineMode
                  else if (updatedDevice.enabled === false) {
                    console.warn('⚠️ Device enabled=false from RTDB - routing to /ooo');
                    setLocation('/ooo');
                  } else if (updatedDevice.enabled === true && sessionLocation.value === '/ooo') {
                    console.log('✅ Device enabled from RTDB - routing to /');
                    setLocation('/');
                    // Process offline checkout manifest now that we're back online
                    processCheckoutManifest();
                  }
                }
              };
            })(),
            String(licenseId)
          );

          // Store unsubscribe function for cleanup
          (window as any).__deviceUnsubscribe = unsubscribeDevice;
          console.log('✅ Global RTDB device subscription active');

        } catch (error) {
          console.error('❌ Error loading license:', error);
        }
      })();
    }

    // Cleanup function - unsubscribe from pub/sub and device when component unmounts
    return () => {
      import('./state/firebase-pubsub-service').then(({ firebasePubSubService }) => {
        firebasePubSubService.unsubscribeAll();
        console.log('🔕 Cleaned up pub/sub subscriptions');
      });

      // Cleanup device subscription
      if ((window as any).__deviceUnsubscribe) {
        (window as any).__deviceUnsubscribe();
        (window as any).__deviceUnsubscribe = null;
        console.log('🔕 Cleaned up global RTDB device subscription');
      }
    };
  }, [licenseId]);

  // Door status is now received from doorStatusWatcher (main process) via IPC.
  // This useEffect only handles: (1) listening for door-status-update, (2) hardware offline,
  // (3) health checks for RFID/barcode/pusatec/packageConcierge at a 30s interval.
  const lastHwStatusKeyRef = useRef<string>('');
  const lastHwWriteTimestampRef = useRef<number>(0);
  const HW_KEEPALIVE_INTERVAL_MS = 60000;

  useEffect(() => {
    if (!sessionIsReady.value || !sessionDevice.value) {
      return;
    }

    // Listen for door status updates relayed from doorStatusWatcher in the main process
    const handleDoorStatusUpdate = (data: any) => {
      if (data?.lockers) {
        updateDoorStatus(data.lockers);
      }
    };
    (window as any).electronAPI?.onDoorStatusUpdate?.(handleDoorStatusUpdate);

    // Listen for hardware-offline notification from doorStatusWatcher
    const handleHardwareOffline = (data: any) => {
      console.error(`📡 Hardware offline notification from main process:`, data);
      setLocation('/ooo');
    };
    (window as any).electronAPI?.onLockerHardwareOffline?.(handleHardwareOffline);

    // Health check polling — runs at 30s, no hardware IPC call.
    // Builds a separate payload for RTDB writes to avoid mutating device.settings.hwIntegrations
    // (which would cause the RTDB onValue callback to see settings as "changed" every cycle).
    const runHealthChecks = async () => {
      if (config.testmode) return;

      try {
        const device = sessionDevice.value;
        const hwIntegrations = device?.settings?.hwIntegrations;
        if (!hwIntegrations) return;

        // Resolve IP for Package Concierge check
        let ip = '';
        try {
          const stored = localStorage.getItem('integrations');
          if (stored) {
            const parsed = JSON.parse(stored);
            const integrations = Array.isArray(parsed) ? parsed : Object.values(parsed);
            if (integrations.length > 0) {
              ip = (integrations[0] as any).ip || '';
            }
          }
        } catch (e) { /* ignore */ }

        const formatHealthCheckTime = () => {
          const now = new Date();
          const pad = (n: number) => n.toString().padStart(2, '0');
          return `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        };

        // Build a snapshot for the RTDB write — do NOT mutate the live hwIntegrations object
        const hwPayload: any = { ...hwIntegrations };
        let hasEnabledIntegration = false;

        // RFID health check
        if (hwIntegrations.rfidEnabled) {
          hasEnabledIntegration = true;
          try {
            const { getRfidConnectionStatus } = await import('./state/rfid');
            const rfidStatus = await getRfidConnectionStatus();
            const isConnected = rfidStatus.wsConnected || rfidStatus.readerConnected;
            hwPayload.rfidStatus = !!isConnected;
            if (isConnected) {
              hwPayload.rfidHealthCheck = formatHealthCheckTime();
            }
          } catch (rfidError) {
            console.error('🔌 RFID health check error:', rfidError);
            hwPayload.rfidStatus = false;
          }
        }

        // Barcode health check
        if (hwIntegrations.barcodeEnabled) {
          hasEnabledIntegration = true;
          hwPayload.barcodeStatus = true;
          hwPayload.barcodeHealthCheck = formatHealthCheckTime();
        }

        // Pusatec health check
        if (hwIntegrations.pusatecEnabled) {
          hasEnabledIntegration = true;
          hwPayload.pusatecStatus = true;
          hwPayload.pusatecHealthCheck = formatHealthCheckTime();
        }

        // Package Concierge health check
        if (hwIntegrations.packageConciergeEnabled && (ip === 'localhost' || ip === '127.0.0.1')) {
          hasEnabledIntegration = true;
          hwPayload.packageConciergeStatus = true;
          hwPayload.packageConciergeHealthCheck = formatHealthCheckTime();
        }

        if (!hasEnabledIntegration) return;

        // Persist to RTDB only when status booleans change or keepalive elapsed
        const statusKey = JSON.stringify({
          rfidStatus: hwPayload.rfidStatus,
          barcodeStatus: hwPayload.barcodeStatus,
          pusatecStatus: hwPayload.pusatecStatus,
          packageConciergeStatus: hwPayload.packageConciergeStatus,
        });
        const now = Date.now();
        const statusChanged = statusKey !== lastHwStatusKeyRef.current;
        const keepaliveDue = now - lastHwWriteTimestampRef.current >= HW_KEEPALIVE_INTERVAL_MS;

        if (statusChanged || keepaliveDue) {
          lastHwStatusKeyRef.current = statusKey;
          lastHwWriteTimestampRef.current = now;
          try {
            const deviceId = device?.id || config.deviceId;
            const databaseUrl = config.realtimeDB || `https://library-456310-license${licenseId}-rtdb.firebaseio.com`;
            const path = `license_${licenseId}/devices/${deviceId}/settings/hwIntegrations`;

            const { getFirebaseAuth } = await import('./state/firebase-client');
            const auth = getFirebaseAuth();
            const currentUser = auth.currentUser;
            if (currentUser) {
              const authToken = await currentUser.getIdToken();
              const url = `${databaseUrl}/${path}.json?auth=${authToken}`;

              const response = await fetch(url, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(hwPayload)
              });

              if (!response.ok) {
                console.error(`🔌 Failed to persist hwIntegrations: ${response.status}`);
              }
            }
          } catch (persistError) {
            console.error('🔌 Error persisting hwIntegrations to RTDB:', persistError);
          }
        }
      } catch (error) {
        console.error('Health check error:', error);
      }
    };

    // Initial health check after 5 seconds, then every 30 seconds
    const initialTimeout = setTimeout(runHealthChecks, 5000);
    const interval = setInterval(runHealthChecks, 30000);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
      console.log('🔄 Health check polling stopped');
    };
  }, [sessionIsReady.value, sessionDevice.value?.id, licenseId]);

  // Device online heartbeat - update online status every 10 seconds with timestamps
  useEffect(() => {
    if (!sessionIsReady.value || !config.deviceId || !licenseId) {
      return;
    }

    const updateOnlineStatus = async () => {
      try {
        const now = new Date();
        const clientTimestamp = now.toISOString().replace('T', ' ').substring(0, 19); // YYYY-MM-DD HH:mm:ss

        // Internet connectivity test - ping the Firebase RTDB URL we actually need
        const deviceId = config.deviceId;
        const databaseUrl = config.realtimeDB || `https://library-456310-license${licenseId}-rtdb.firebaseio.com`;

        let internetTimestamp: string | null = null;
        if (navigator.onLine) {
          internetTimestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
          // Recover from offline if internet is back (and not manually switched)
          if (isMainOffline && !isManualOfflineSwitch) {
            const electron = (window as any).electron;
            if (electron?.sideeventNative?.setMainOfflineMode) {
              await electron.sideeventNative.setMainOfflineMode(false);
              setIsMainOffline(false);
              console.log('✅ Internet restored - locker set back to online mode');
            }
          }
        } else {
          // Internet not available - set locker to offline mode (only if manual switch is not active)
          if (!isManualOfflineSwitch) {
            try {
              const electron = (window as any).electron;
              if (electron?.sideeventNative?.setMainOfflineMode) {
                await electron.sideeventNative.setMainOfflineMode(true);
                setIsMainOffline(true);
                console.log('⚠️ Internet offline - locker set to offline mode');
              }
            } catch (e) {
              console.error('Failed to set offline mode:', e);
            }
          }
        }

        // Get current online data to append to history
        // Path: license_{licenseId}/online/{deviceId}
        const onlinePath = `license_${licenseId}/online/${deviceId}.json`;

        // Get Firebase auth token
        let authToken = '';
        try {
          const { getFirebaseAuthToken } = await import('./state/firebase-client');
          authToken = await getFirebaseAuthToken() || '';
        } catch {
          console.warn('Could not get Firebase auth token for online status');
        }

        const urlWithAuth = authToken ? `${databaseUrl}/${onlinePath}?auth=${authToken}` : `${databaseUrl}/${onlinePath}`;

        // Fetch current online data
        interface HistoryEntry {
          client: string;
          internet: string | null;
          note?: string;
          isRead: boolean;
        }
        let history: HistoryEntry[] = [];
        let oldClientTimestamp: string | null = null;
        let oldInternetTimestamp: string | null = null;
        try {
          const currentResponse = await fetch(urlWithAuth);
          if (currentResponse.ok) {
            const currentData = await currentResponse.json();
            oldClientTimestamp = currentData?.client || null;
            oldInternetTimestamp = currentData?.internet || null;
            if (currentData?.history && Array.isArray(currentData.history)) {
              // Keep last 10 entries
              history = currentData.history.slice(-9);
            }
          }
        } catch {
          // Start fresh if can't fetch
        }

        // Check if client or internet was offline for more than 10 minutes
        let clientNote: string | undefined = undefined;
        let internetNote: string | undefined = undefined;

        // Check client offline duration
        if (oldClientTimestamp) {
          const oldTime = new Date(oldClientTimestamp.replace(' ', 'T'));
          const newTime = new Date(clientTimestamp.replace(' ', 'T'));
          const diffMs = newTime.getTime() - oldTime.getTime();
          const diffMinutes = diffMs / (1000 * 60);

          if (diffMinutes > 10) {
            const hours = Math.floor(diffMinutes / 60);
            const minutes = Math.round(diffMinutes % 60);
            const offlineDuration = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
            clientNote = `Client resumed at ${clientTimestamp}, was offline for ${offlineDuration} (since ${oldClientTimestamp})`;
          }
        }

        // Check internet offline duration
        if (oldInternetTimestamp && internetTimestamp) {
          const oldTime = new Date(oldInternetTimestamp.replace(' ', 'T'));
          const newTime = new Date(internetTimestamp.replace(' ', 'T'));
          const diffMs = newTime.getTime() - oldTime.getTime();
          const diffMinutes = diffMs / (1000 * 60);

          if (diffMinutes > 10) {
            const hours = Math.floor(diffMinutes / 60);
            const minutes = Math.round(diffMinutes % 60);
            const offlineDuration = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
            internetNote = `Internet resumed at ${internetTimestamp}, was offline for ${offlineDuration} (since ${oldInternetTimestamp})`;
          }
        }
        // Note: Don't add note for initial connection (when oldInternetTimestamp is null)

        // Build note combining client and internet notes
        let combinedNote: string | undefined = undefined;
        if (clientNote && internetNote) {
          combinedNote = `${clientNote} | ${internetNote}`;
        } else if (clientNote) {
          combinedNote = clientNote;
        } else if (internetNote) {
          combinedNote = internetNote;
        }

        // Only add history entry if there's a note (offline gap > 10 minutes)
        if (combinedNote) {
          const historyEntry: HistoryEntry = {
            client: clientTimestamp,
            clientOld: oldClientTimestamp,
            internet: internetTimestamp || oldInternetTimestamp,
            internetOld: oldInternetTimestamp,
            isRead: false,
            note: combinedNote
          };
          history.push(historyEntry);
        }


        // Update online status with flat structure
        const deviceName = sessionDevice.value?.settings?.name || sessionDevice.value?.name || '';
        const onlineData: any = {
          name: deviceName,
          client: clientTimestamp,
          internet: internetTimestamp || oldInternetTimestamp,
          history: history
        };

        const updateResponse = await fetch(urlWithAuth, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(onlineData)
        });

        if (updateResponse.ok) {
          console.log(`💚 Online status updated: ${clientTimestamp}`);
        }
      } catch (error) {
        console.error('Online status update error:', error);
      }
    };

    // Initial update after 3 seconds
    const initialTimeout = setTimeout(updateOnlineStatus, 3000);

    // Then update every 10 seconds
    const interval = setInterval(updateOnlineStatus, 10000);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [sessionIsReady.value, licenseId]);

  useEffect(() => {
    if (!sessionDeviceId?.value) {
      // Device ID is always read from config.ts file
      const deviceIdValue = config.deviceId;
      updateSessionDeviceId((deviceIdValue).toString());
      console.log('✅ Device ID loaded from config:', deviceIdValue);
    }
    console.log('🔄 sessionDeviceId changed:', sessionDeviceId.value);
  }, [sessionDeviceId.value]);

  // Polaris holds list cron job - fetch on init and every hour
  useEffect(() => {
    // Only run if session is ready and branch is loaded
    if (!sessionIsReady.value || !sessionBranch.value) {
      return;
    }

    // Check if Polaris is enabled
    if (!sessionBranch.value?.polarisSettings?.enabled) {
      console.log('📋 Polaris not enabled, skipping holds list cron job');
      return;
    }

    // Fetch on init
    console.log('📋 Fetching Polaris holds list on init...');
    fetchAndCacheHoldsList();

    // Set up hourly interval (3600000ms = 1 hour)
    const intervalId = setInterval(() => {
      console.log('📋 Hourly cron: Fetching Polaris holds list...');
      fetchAndCacheHoldsList();
    }, 3600000); // 1 hour

    // Cleanup interval on unmount
    return () => {
      clearInterval(intervalId);
      console.log('📋 Cleaned up Polaris holds list cron job');
    };
  }, [sessionIsReady.value, sessionBranch.value?.polarisSettings?.enabled]);

  // Polaris API keep-alive — ping health endpoint every 5 minutes to prevent cold starts
  useEffect(() => {
    if (!sessionIsReady.value || !sessionBranch.value?.polarisSettings?.enabled) {
      return;
    }

    const pingPolaris = () => {
      fetch(`${POLARIS_API_BASE}/health`).then(res => {
        console.log(`🏓 Polaris keep-alive: ${res.status}`);
      }).catch(err => {
        console.warn('🏓 Polaris keep-alive failed:', err.message);
      });
    };

    pingPolaris();
    const intervalId = setInterval(pingPolaris, 300000); // 5 minutes

    return () => {
      clearInterval(intervalId);
    };
  }, [sessionIsReady.value, sessionBranch.value?.polarisSettings?.enabled]);

  // SIP2 API keep-alive — ping health endpoint every 5 minutes to prevent cold starts
  useEffect(() => {
    if (!sessionIsReady.value || !sessionBranch.value?.sip2Settings?.enabled) {
      return;
    }

    const pingSip2 = () => {
      fetch('https://sip2proxy-be4ekemxaa-uc.a.run.app/health').then(res => {
        console.log(`🏓 SIP2 keep-alive: ${res.status}`);
      }).catch(err => {
        console.warn('🏓 SIP2 keep-alive failed:', err.message);
      });
    };

    pingSip2();
    const intervalId = setInterval(pingSip2, 300000); // 5 minutes

    return () => {
      clearInterval(intervalId);
    };
  }, [sessionIsReady.value, sessionBranch.value?.sip2Settings?.enabled]);

  // Symphony API keep-alive — ping health endpoint every 5 minutes to prevent cold starts
  useEffect(() => {
    if (!sessionIsReady.value || !sessionBranch.value?.symphonySettings?.enabled) {
      return;
    }

    const pingSymphony = () => {
      fetch('https://symphonyapi-be4ekemxaa-uc.a.run.app/health').then(res => {
        console.log(`🏓 Symphony keep-alive: ${res.status}`);
      }).catch(err => {
        console.warn('🏓 Symphony keep-alive failed:', err.message);
      });
    };

    pingSymphony();
    const intervalId = setInterval(pingSymphony, 300000); // 5 minutes

    return () => {
      clearInterval(intervalId);
    };
  }, [sessionIsReady.value, sessionBranch.value?.symphonySettings?.enabled]);

  function ShowBackgrundImage() {
    const backgroundStyle: CSSProperties = {
      ...style.backgroundImage(),
      ...(sessionWelcomeBackgroundColor.value && { backgroundColor: sessionWelcomeBackgroundColor.value })
    };

    // Priority 1: If welcome background image is set from device settings
    if (sessionWelcomeBackgroundImage.value && config.files[sessionWelcomeBackgroundImage.value]) {
      return (
        <div style={backgroundStyle}>
          <img
            style={{ ...style.backgroundImage(), objectFit: 'cover' }}
            width={100}
            src={`data:image/*;base64,${config.files[sessionWelcomeBackgroundImage.value]}`}
            alt="Welcome Background"
          />
        </div>
      );
    }

    // Priority 2: Welcome background color only (no image)
    if (sessionWelcomeBackgroundColor.value) {
      return <div style={backgroundStyle} />;
    }

    // Priority 3: Default blue background
    return (
      <div style={style.backgroundImage()}>
        <img style={style.backgroundImage()} width={100} src='./Blue42A4DE.png' alt="Default Background" />
      </div>
    );
  }


  if (!sessionIsReady.value) {
    return (
      <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
        <ShowBackgrundImage />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <Spinner />
        </div>
      </div>
    )
  }

  // htmls
  const htmlMain = (

    <ConfigProvider theme={{ algorithm: [theme.compactAlgorithm], }} warning={{ strict: false }}>
      <IconContext.Provider value={{ color: "red", className: "global-class-name" }}>
        {!sessionIsReady.value ? '' :
          <Flex gap="middle" wrap="wrap">
            <Layout style={style.layoutStyle()}>
              <Layout>

                <Content style={style.contentStyle(sessionWelcomeBackgroundColor.value || undefined)}>
                  {<ShowBackgrundImage/> }

                  <Router hook={useHashLocation}>
                    <Route path="/ooo" component={OutoforderPage} />
                    <Route path="/maintenance" component={MaintenancePage} />
                    <Route path="/admin" component={AdminPage} />
                    <Route path="/error" component={ErrorPage} />


                    {isHoldPickup && <Route path="/holdcheckout" component={HoldCheckoutPage} />}
                    {isHoldPickup && <Route path="/holdcheckoutoffline" component={HoldCheckoutOfflinePage} />}
                    {isHoldPickup && <Route path="/holdreturn" component={HoldReturnPage} />}
                    {isHoldPickup && <Route path="/" component={HomeHoldPage} />}

                    {(isLoT ||isDynamicLoT)  && <Route path="/lotcheckout" component={LoTCheckoutPage} />}
                    {(isLoT ||isDynamicLoT)  && <Route path="/lotreturn" component={LoTReturnPage} />}
                    {(isLoT ||isDynamicLoT) && <Route path="/" component={HomeLoTPage} />}
                    { isDynamicLoT && <Route path="/" component={HomeLoTPage} /> }
                  </Router>

                </Content>
              </Layout>

              <Modal
                title={<span style={{color: SEBlue.value, ...getTextStyle({}, 15)}}>Locker vendor information</span>}
                centered
                footer={
                  null
                }
                open={vendorModalOpen}
                onOk={() => setVendorModalOpen(false)}
                onCancel={() => setVendorModalOpen(false)}
                afterOpenChange={(open) => {
                  if (open) {
                    setTimeout(() => setVendorModalOpen(false), 2000);
                  }
                }}
                width={'90%'}
                height={'90%'}
              >
                  <Row style={{width: '90%', margin: '0 auto'}} justify='center' align='middle' >
                    <Col span={10} offset={2} style={{color: SEBlue.value}}>
                      <h1>SideEvent - Finland</h1>
                      <p>Software and SaaS vendor</p>
                      <p>Mika Kristian Passila : mika@sideevent.com</p>
                    </Col>
                    <Col span={10} style={{color: SEBlue.value}}>
                      <QRCode value="Mika Kristian Passila @ mika@sideevent.com" />
                    </Col>
                  </Row>


              </Modal>

              {/* Version Modal */}
              <Modal
                title={null}
                centered
                footer={null}
                closable={true}
                open={versionModalOpen}
                onOk={() => setVersionModalOpen(false)}
                onCancel={() => setVersionModalOpen(false)}
                width={'50%'}
              >
                <div style={{ textAlign: 'center', padding: '40px' }}>
                  <img src='./favicon.png' alt="SideEvent" style={{ width: '80px', height: '80px', marginBottom: '20px' }} />
                  <p style={{ fontSize: '30px', color: SEBlue.value, fontWeight: 'bold', margin: 0 }}>
                    Version: {config.version}
                  </p>
                  {/* ILS Integration Info */}
                  <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    {sessionBranch.value?.sip2Settings?.enabled && (
                      <span style={{backgroundColor: '#1890ff', color: 'white', padding: '6px 16px', borderRadius: '6px', fontSize: '14px', fontWeight: 'bold'}}>SIP2</span>
                    )}
                    {sessionBranch.value?.symphonySettings?.enabled && (
                      <span style={{backgroundColor: '#52c41a', color: 'white', padding: '6px 16px', borderRadius: '6px', fontSize: '14px', fontWeight: 'bold'}}>Symphony</span>
                    )}
                    {sessionLicense.value?.applications?.includes('smart') && (
                      <span style={{backgroundColor: '#fa8c16', color: 'white', padding: '6px 16px', borderRadius: '6px', fontSize: '14px', fontWeight: 'bold'}}>SMART</span>
                    )}
                    {sessionBranch.value?.polarisSettings?.enabled && (
                      <span style={{backgroundColor: '#722ed1', color: 'white', padding: '6px 16px', borderRadius: '6px', fontSize: '14px', fontWeight: 'bold'}}>Polaris</span>
                    )}
                    {!sessionBranch.value?.sip2Settings?.enabled && !sessionBranch.value?.symphonySettings?.enabled && !sessionBranch.value?.polarisSettings?.enabled && (
                      <span style={{backgroundColor: '#999', color: 'white', padding: '6px 16px', borderRadius: '6px', fontSize: '14px', fontWeight: 'bold'}}>No ILS Integration</span>
                    )}
                  </div>

                  {/* Online/Offline Status */}
                  <div style={{ marginTop: '24px' }}>
                    <span style={{
                      backgroundColor: isMainOffline ? '#ff4d4f' : '#52c41a',
                      color: 'white',
                      padding: '6px 20px',
                      borderRadius: '12px',
                      fontSize: '16px',
                      fontWeight: 'bold',
                      boxShadow: isMainOffline ? '0 0 8px #ff4d4f' : '0 0 8px #52c41a'
                    }}>
                      {isMainOffline ? 'Offline' : 'Online'}
                    </span>
                  </div>

                  {/* Offline Mode Test Switch */}
                  {(sessionDevice.value?.allowOfflineMode || (window as any).electronAPI?.getLocalConfig()?.testIsOfflineMode) && (
                    <div style={{ marginTop: '16px' }}>
                      <span
                        onClick={async () => {
                          const electron = (window as any).electron;
                          const newState = !isMainOffline;
                          await electron.sideeventNative.setMainOfflineMode(newState);
                          setIsMainOffline(newState);
                          setIsManualOfflineSwitch(newState);
                          // Process checkout manifest when switching back to online
                          if (!newState) {
                            processCheckoutManifest();
                          }
                        }}
                        style={{
                          backgroundColor: isMainOffline ? '#52c41a' : '#ff4d4f',
                          color: 'white',
                          padding: '8px 24px',
                          borderRadius: '8px',
                          fontSize: '16px',
                          fontWeight: 'bold',
                          cursor: 'pointer',
                          userSelect: 'none',
                          display: 'inline-block',
                        }}
                      >
                        {isMainOffline ? 'Switch to Online' : 'Switch to Offline'}
                      </span>
                    </div>
                  )}
                </div>
              </Modal>

              {sessionLocation.value !== '/admin' && (
              <Footer style={style.footerStyle()}>
                  <img style={style.backgroundIcons()} src='./lyngsoe.svg' alt="Lyngsoe Inc"></img>
                  <div onClick={() => setVendorModalOpen(true)} style={{ textAlign: 'center', color: 'white', backgroundColor: 'rgba(0,0,0,0)', fontSize: '10px', cursor: 'pointer' }}> by <img style={{width: '10px', height: '10px',backgroundColor: 'white', position: 'relative', top: '2px'}} src='./favicon.png' alt="SideEvent"></img> SideEvent © {new Date().getFullYear()} @ {sessionDevice?.value?.name}</div>
                  <Space style={{float: 'right', position: 'absolute', right: '25px', bottom: '41px', cursor: 'pointer', alignItems: 'center'}} onClick={() => setVersionModalOpen(true)}>
                    {/* ILS Integration Icons */}
                    {sessionBranch.value?.sip2Settings?.enabled && (
                      <span style={{backgroundColor: '#1890ff', color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold', zIndex: 10, position: 'relative', top: '8px', right: '50px'}}>SIP2</span>
                    )}
                    {sessionBranch.value?.symphonySettings?.enabled && (
                      <span style={{backgroundColor: '#52c41a', color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold', zIndex: 10, position: 'relative', top: '8px', right: '50px'}}>Symphony</span>
                    )}
                    {sessionLicense.value?.applications?.includes('smart') && (
                      <span style={{backgroundColor: '#fa8c16', color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold', zIndex: 10, position: 'relative', top: '8px', right: '50px'}}>SMART</span>
                    )}
                    {sessionBranch.value?.polarisSettings?.enabled && (
                      <span style={{backgroundColor: '#722ed1', color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '10px', fontWeight: 'bold', zIndex: 10, position: 'relative', top: '8px', right: '50px'}}>Polaris</span>
                    )}
                    {/* Main Process Online/Offline Status Indicator */}
                    <span style={{
                      backgroundColor: isMainOffline ? '#ff4d4f' : '#52c41a',
                      color: 'white',
                      padding: '2px 10px',
                      borderRadius: '12px',
                      fontSize: '10px',
                      fontWeight: 'bold',
                      zIndex: 10,
                      position: 'relative',
                      top: '8px',
                      right: '50px',
                      boxShadow: isMainOffline ? '0 0 6px #ff4d4f' : 'none'
                    }}>
                      {isMainOffline ? 'Offline' : 'Online'}
                    </span>
                    <Badge.Ribbon color={SEBlue.value} style={{margin: '-5px -7px', opacity: 0.8 }} text={`${config.version}`}/>
                  </Space>
              </Footer>
              )}
            </Layout>
          </Flex>}
      </IconContext.Provider>
    </ConfigProvider>

  );

  return htmlMain;


}
