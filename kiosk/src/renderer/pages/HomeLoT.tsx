import React, { useState, useRef, useEffect, useLayoutEffect, CSSProperties } from 'react';
import { signal } from '@preact/signals-react'
import { useLocation } from 'wouter';
import { useTranslation } from 'react-i18next';
import { Row, Col, Button,Card, Modal, Avatar, Space, Badge, Spin } from 'antd';
import _ /*, { slice, toSafeInteger }*/ from 'lodash';
import { toast, ToastContainer } from 'react-toastify';
import MonthYear from '../helpers/MonthYear';
import {anyItemsAvailableADA, anyItemsAvailableNormal} from '../helpers/lockerHelpers'
import { lastILSItemLookup, cachedAdminCardBarcode } from '../helpers/adminFeedHoldsMode';
import { classifyBarcode, isStaffCard } from '../helpers/barcodeClassifier';
import { sessionDoorStatus, sessionTimer, updateSessionTimer, sessionDevice,
  sessionDeviceId, updateLocation, sessionLang, updateLang,
  sessionBranch, sessionLicense, kioskConfig, sessionError, updateSessionError,
  sessionLocation, updateSessionBarcode, sessionBarcode, updateDevice, updateSessionDoorStatus, validateItemInfo,validateIsSipOk,
  sessionWizard, setSessionWizard, persistDeviceManifestChanges, sessionStaffModeOn, updateSessionStaffModeOn,
  updateSessionUserModeOn, updateShowBackgroundImage,
  playIndex,
  updatePlayIndex,
  setLibraryOfThingsGroup,
  libraryOfThingsGroup,
  SEBlue,
  sessionUserModeOn,
  customToast,
  getImage,
  updateShowReturnInfo,
  showReturnInfo,
  sessionLicenseId,
  sessionDatabaseUrl,
  getHotListItemIds,
  FirebaseSIP2,
  setHotListItemIds,
  sessionWelcomeBackgroundColor,
  updateWelcomeBackgroundColor,
  customToast, readHistory} from "../state/shared";
import { getFirebaseAuth } from '../state/firebase-client';
import { createAddItemEvent, createReturnItemEvent, createDoorIsOpenTestFailedEvent, createCheckinTransaction } from '../state/transaction-service';
import { openDoor, anyDoorOpen, isDoorOpen } from "../state/locker";
import { updatePatron, getOrCreatePatron, trackNewPatronUsage } from '../state/firestore';

import * as style from '../App.styles';
// import { FaExternalLinkSquareAlt } from "react-icons/fa";
import { MdTouchApp, MdLanguage, MdClose, MdGroupRemove } from "react-icons/md";
import {AiOutlineClockCircle, AiOutlinePlusCircle, AiOutlineMinusCircle} from "react-icons/ai";
import Keyboard from 'react-simple-keyboard';
import 'react-simple-keyboard/build/css/index.css';
import { /*all,*/ Promise } from "bluebird";
import { useSignals } from "@preact/signals-react/runtime";
import { rfidItemId } from '../state/rfid';
import LoginKeyboard from '../components/LoginKeyboard';
import ZoomLanguageControls from '../components/ZoomLanguageControls';
import { useSlideshowReset } from '../hooks/useSlideshowReset';
import LanguageModal from '../components/LanguageModal';
import AccessibleModal from '../components/AccessibleModal';
import AdminLoginModal from '../components/AdminLoginModal';
import { fontSize, updateFontSize, getTextStyle } from "../state/shared";
import Meta from 'antd/es/card/Meta';
import { CheckOutlined, LeftSquareOutlined, RightSquareOutlined, LeftCircleOutlined, RightCircleOutlined, LeftOutlined, RightOutlined /*, LeftSquareOutlined, PlayCircleOutlined*/ } from '@ant-design/icons';
import Spinner from '../components/spinner';
// import { boolean } from 'zod';

// Polaris API endpoint
const POLARIS_API_BASE = 'https://polarisapi-be4ekemxaa-uc.a.run.app';

let runOnce = true;
let patronCooldownTime = 0; // only read, never set - always 0, but used in conditional
let languges: any = []; // typo in name (should be "languages"), but IS used
const testedOpenDoor = signal<number>(0);
const setTestedOpenDoor = (nro: number) => {
  testedOpenDoor.value = nro;
}
const splitMode = signal<boolean>(false);
const setSplitMode = (val: boolean) => {
  splitMode.value = val;
}
// Removed global countTimer - now using ref
let showKeyboardInit = true;

// Test if a specific door is still open 2s after opening — reports door_is_open_test_failed if not
async function testDoorAfterOpen(mac: string, doorNumber: number) {
  try {
    await Promise.delay(2000);
    const isOpen = await isDoorOpen(mac, doorNumber, { fresh: true });
    if (isOpen) return;
    await createDoorIsOpenTestFailedEvent({ itemIds: [], patronId: '', doorNumber, success: false, metadata: { error: `Door ${doorNumber} is not open after 2s`, doorNumber, mac } });
  } catch (err) { console.error(`testDoorAfterOpen(${doorNumber}) failed:`, err); }
}

export default function HomeLoTPage() {
  useSignals();
  updateLocation('/')
  const [holdLibraryOfThingsGroup, setHoldLibraryOfThingsGroup] = useState<boolean>(false);
  const [showHoldRequestModal, setShowHoldRequestModal] = useState<boolean>(false);
  const [holdRequestInfo, setHoldRequestInfo] = useState<{patronId: string, groupName: string, itemType?: string, itemName?: string} | null>(null);
  const [manualItemType, setManualItemType] = useState<string>('');
  const [manualItemName, setManualItemName] = useState<string>('');
  // Don't create snapshot - use sessionDevice.value directly for real-time RTDB updates
  const deviceId = sessionDeviceId.value;
  const config = kioskConfig.value;
  const branch = sessionBranch.value;
  const license = sessionLicense.value;

  // Get configured languages count from settings.langs
  const getConfiguredLangsCount = () => {
    const configuredLangs = sessionDevice.value?.settings?.langs;
    if (!configuredLangs) return 0;
    // Handle string format "en, it"
    if (typeof configuredLangs === 'string') {
      return configuredLangs.split(',').map(s => s.trim()).filter(s => s.length > 0).length;
    }
    if (Array.isArray(configuredLangs)) return configuredLangs.length;
    return Object.keys(configuredLangs).length;
  };
  const configuredLangsCount = getConfiguredLangsCount();

  // Get groups from Firebase Realtime DB device data ONLY
  // Source: config.device.manifest.groups (loaded from Firebase in App.tsx)
  const getDeviceGroups = () => {
    // Only use Firebase Realtime DB device data
    if (config.device?.manifest?.groups) {
      // Convert groups object to array if needed
      if (Array.isArray(config.device.manifest.groups)) {
        return config.device.manifest.groups;
      } else {
        // Convert groups object to array
        return Object.values(config.device.manifest.groups);
      }
    }

    // No groups found - device not loaded from Firebase yet
    console.warn('⚠️  No groups found in Firebase Realtime DB (config.device.manifest.groups)');
    console.warn('   Make sure device is loaded from Firebase before rendering HomeLoT');
    return [];
  };

  const deviceGroups = getDeviceGroups();
  // Total conditionCheck count across all groups - shown on Returns card
  const totalConditionCheckCount = deviceGroups.reduce((total: number, group: any) => {
    const lockers = group.lockers ? (Array.isArray(group.lockers) ? group.lockers : Object.values(group.lockers)) : [];
    return total + lockers.filter((l: any) => l && l.conditionCheck).length;
  }, 0);

  // Log device groups for debugging
  useEffect(() => {
    if (deviceGroups.length === 0) {
      console.error('❌ HomeLoT - No device groups found!', {
        'config.device exists': !!config.device,
        'config.device.manifest exists': !!config.device?.manifest,
        'config.device.manifest.groups exists': !!config.device?.manifest?.groups,
        'Expected path': 'config.device.manifest.groups'
      });
    } else {
      console.log('🏠 HomeLoT - Device groups loaded from Firebase Realtime DB:', {
        groupsCount: deviceGroups.length,
        source: 'Firebase Realtime DB (config.device.manifest.groups)',
        groups: deviceGroups.map((g: any) => ({ name: g.name, description: g.description }))
      });
    }
  }, [deviceGroups.length, config.device]);

  const [playMode, setPlayMode] = useState<boolean>(false);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null);
  const [slideKey, setSlideKey] = useState<number>(0);
  const [prevImage, setPrevImage] = useState<string | null>(null);
  const [showLoginScreen, setShowLoginScreen] = useState<boolean>(false);
  const { slideshowResetTrigger, triggerSlideshowReset } = useSlideshowReset();

  const [, setLocation] = useLocation();
  const { i18n, t } = useTranslation();
  const [currentLang, setCurrentLang] = useState(i18n.language); // Force re-render on language change
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const licenseId = +sessionLicenseId.value;
  const [modalOpen, setModalOpen] = useState(false);
  const [showAccessibleModal, setShowAccessibleModal] = useState(false);
  const [resetAccessibilitySettings, setResetAccessibilitySettings] = useState(false);
  const accessibilityRestoreTimerRef = useRef<NodeJS.Timeout | null>(null);
  const highContrastTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [modalConfig, setModalConfig] = useState<any>(null);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [loginKeyboardVisible, setLoginKeyboardVisible] = useState(true);
  const [layout, setLayout] = useState("default");
  const [focusOnUsername, setFocusOnUsername] = useState(true);
  const [patronPreference, setPatronPreference] = useState<string | null>(null);
  const [isADA, setIsADA] = useState<boolean>(false);
  const [emptyLockers, setEmptyLockers] = useState<number[]>([]);
  const [showAddHoldInfo, setShowAddHoldInfo] = useState<boolean>(false);
  const [selectionProtected, setSelectionProtected] = useState<boolean>(false);
  const [timer, setTimer] = useState<any>(null);
  const [moveItemToNewLocker, setMoveItemToNewLocker] = useState(false);
  const [welcomeUserDisplayName, setWelcomeUserDisplayName] = useState<string | null>(null);
  const [showDuplicateItemWarning, setShowDuplicateItemWarning] = useState<boolean>(false);
  const [duplicateItemInfo, setDuplicateItemInfo] = useState<{itemId: string, doorNumber: number, patronId: string} | null>(null);
  const [showAdminPinDialog, setShowAdminPinDialog] = useState<boolean>(false);
  const [adminPinInput, setAdminPinInput] = useState<string>('');
  const [showLoginAdminModal, setShowLoginAdminModal] = useState<boolean>(false);
  const [showCheckoutConfirmModal, setShowCheckoutConfirmModal] = useState<boolean>(false);
  const [gridPageIndex, setGridPageIndex] = useState<number>(0);
  const gridPageTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [showHoldPickupModal, setShowHoldPickupModal] = useState<boolean>(false);
  const [holdPickupInfo, setHoldPickupInfo] = useState<{groupName: string, groupIndex: number, doorNumber: string, patronId: string} | null>(null);
  const [holdPickupQueue, setHoldPickupQueue] = useState<{groupName: string, groupIndex: number, doorNumber: string, patronId: string}[]>([]);
  const [holdPickupTimer, setHoldPickupTimer] = useState<number>(20);
  const holdPickupTimerRef = useRef<NodeJS.Timeout | null>(null);
  const processingItemRef = useRef<boolean>(false);

  const handleTouchRef = useRef<NodeJS.Timeout | null>(null);
  const slideshowIdleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const slideshowInterruptedRef = useRef<boolean>(false);
  const countTimerRef = useRef<number>(30);
  const keyboard: any = useRef();
  const userRef: any = useRef(null);
  const passRef: any = useRef(null);
  const scannerInputRef = useRef<HTMLInputElement>(null);
  // const scannerDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  let forceLogin = false;
  const errorReport = sessionError.value;
  let isManualLogin = false;

  const increaseFontSize = () => {
    const result = Math.min(fontSize.value + 2, 40);
    updateFontSize(result);
  };

  const decreaseFontSize = () => {
    const result = Math.max(fontSize.value - 2, 16);
    updateFontSize(result);
  };

  const fontControlStyle: React.CSSProperties = {
    position: 'fixed',
    bottom: '62px',
    right: '20px',
    display: 'flex',
    gap: '10px',
    opacity: 0.8,
    //zIndex: 1000,
  };

  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`;
  }, [fontSize]);

  // Auto-focus scanner input when modals are closed
  useEffect(() => {
    const focusScannerInput = () => {
      // Don't steal focus when login screen, keyboard dialog or admin login modal is showing
      if (scannerInputRef.current && !showAccessibleModal && !showKeyboard && !showLoginAdminModal && !showLoginScreen) {
        scannerInputRef.current.focus();
      }
    };

    // Focus immediately on mount
    focusScannerInput();

    // Refocus when any modal closes
    const timer = setInterval(focusScannerInput, 500);

    return () => clearInterval(timer);
  }, [showAccessibleModal, showKeyboard, showLoginAdminModal, showLoginScreen]);

  // Maintain focus on login fields when login screen is showing
  useEffect(() => {
    if (!showLoginScreen) return;

    const maintainLoginFocus = () => {
      const active = document.activeElement;
      // Only refocus if focus was lost to scanner input, body, or null (not buttons/other inputs)
      const focusLostToNonInput = !active || active === document.body || active === scannerInputRef.current;
      if (!focusLostToNonInput) return;

      const target = focusOnUsername ? userRef.current : passRef.current;
      if (target) {
        target.focus();
      }
    };

    // Initial focus
    maintainLoginFocus();

    // Keep checking and maintaining focus (200ms for responsive physical keyboard)
    const timer = setInterval(maintainLoginFocus, 200);

    return () => clearInterval(timer);
  }, [showLoginScreen, focusOnUsername]);

  // Ensure focus stays on login input after every render (RTDB updates cause frequent re-renders)
  useLayoutEffect(() => {
    if (!showLoginScreen) return;
    const active = document.activeElement;
    const focusLostToNonInput = !active || active === document.body || active === scannerInputRef.current;
    if (!focusLostToNonInput) return;
    const target = focusOnUsername ? userRef.current : passRef.current;
    if (target) target.focus();
  });


  function randomIntFromInterval(min, max) {
      return Math.floor(Math.random() * (max - min + 1) + min);
  }

  function testPatron() {
      let testVlue = randomIntFromInterval(1, 2);
      return '2' + (testVlue);
  }

  function testItem() {
    let testVlue = randomIntFromInterval(0, 9);
    return '3' + (testVlue);
  }

  // Handle scanner/keyboard input with debounce
  // const handleScannerInput = (value: string) => {
  //   if (!value || value.trim() === '') return;

  //   const trimmedValue = value.trim();
  //   console.log('📟 Scanner input received:', trimmedValue);

  //   // Process the input through the existing barcode workflow
  //   updateSessionBarcode(trimmedValue);
  //   processLoginOptions(trimmedValue, '');
  //   // Clear the input for next scan
  //   if (scannerInputRef.current) {
  //     scannerInputRef.current.value = '';
  //   }
  // };

  // const onScannerInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  //   // const value = e.target.value;

  //   // // Clear existing debounce timer
  //   // if (scannerDebounceTimerRef.current) {
  //   //   clearTimeout(scannerDebounceTimerRef.current);
  //   // }

  //   // // Set new debounce timer for 1 second
  //   // scannerDebounceTimerRef.current = setTimeout(() => {
  //   //   handleScannerInput(value);
  //   // }, 1000);
  // };

  function startVideo() {
    const video: any = document.getElementById('welcomevideo');
    if (video && !sessionStaffModeOn.value) {
      video.play();
    }
  }

  function stopVideo() {
    const video: any = document.getElementById('welcomevideo');
    if (video) {
      video.pause();
    }
  }

  // Barcode processing function (used by both init and reactive watcher)
  const enableBarcodeMode = async (barcode: string) => {
    if (!barcode || barcode === '' || sessionLocation.value !== '/') {
      return;
    }
    // Block new scans while already processing an item
    if (processingItemRef.current) {
      console.log('🚫 Scan ignored - already processing an item');
      return;
    }
    // LoT barcode-to-patron mappings
    if (barcode === '20000000000001') barcode = '21';
    if (barcode === '12345678999999') barcode = '31';

    updateSessionBarcode('');
    const reScanDelay = 10;
    if (!barcode || (barcode && readHistory[barcode])) {
      if (readHistory[barcode] === 1) {
        toast.info(`Barcode was already read, please wait up to ${reScanDelay}s before re-scanning`);
        readHistory[barcode] = 2;
      }
      return;
    }
    readHistory[barcode] = 1;
    Promise.delay(reScanDelay * 1000).then(() => {
      delete readHistory[barcode];
    });

    // Check if barcode starts with *** - process as return (lotreturn)
    if (barcode.startsWith('***')) {
      const actualBarcode = barcode.substring(3); // Remove *** prefix
      console.log('🔄 Barcode starts with ***, processing as return. Item ID:', actualBarcode);

      // Add item to condition check queue for return processing
      const returnItem = {
        itemId: actualBarcode,
        doorNumber: 0,
        patronId: 'CustomReturn'
      };

      const queueStr = localStorage.getItem('conditionCheckQueue');
      const queue = queueStr ? JSON.parse(queueStr) : [];
      queue.push(returnItem);
      localStorage.setItem('conditionCheckQueue', JSON.stringify(queue));

      console.log('➕ Added *** item to return queue:', returnItem);

      setShowLoginScreen(false);
      setLocation(`/lotreturn`);
      return;
    }

    if (barcode.length && sessionLocation.value === '/') {
      const classification = await classifyBarcode(barcode, {
        branch,
        licenseId,
        device: sessionDevice.value,
        adminPin: kioskConfig.value?.adminPin,
        customStaffPin: kioskConfig.value?.device?.settings?.customStaffPin,
        adminFeedCallbacks: { setLibraryOfThingsGroup, processLoginUser },
      });
      console.log('🔍 classifyBarcode result:', classification);

      // staffCard
      if (classification === 'staffCard') {
        console.log('🔐 Staff card detected');
        processStaffCard(barcode);
        return;
      }

      // item or deviceReturn
      if (classification === 'item' || classification === 'deviceReturn') {
        // Check SIP2 circulation status — if 04 (checked out), process as return instead of add
        if (lastILSItemLookup?.circulationStatus === 4) {
          console.log('📦 Item circulation status is 04 (checked out) — looking up locker for return');

          // Search device manifest for this item
          let foundLocker: any = null;
          let foundGroupIndex = -1;
          let foundGroupName = '';
          if (sessionDevice.value?.manifest?.groups) {
            const manifestGroups = sessionDevice.value.manifest.groups;
            for (const gIdx in manifestGroups) {
              const group = manifestGroups[gIdx];
              if (!group?.lockers) continue;
              const lockers = Array.isArray(group.lockers) ? group.lockers : Object.values(group.lockers);
              for (const locker of lockers as any[]) {
                if (locker?.itemIds && locker.itemIds.includes(barcode)) {
                  foundLocker = locker;
                  foundGroupIndex = Number(gIdx);
                  foundGroupName = group.name || '';
                  break;
                }
              }
              if (foundLocker) break;
            }
          }

          // Case 1: Item found in a locker with CHECKEDOUT status → locked item return
          if (foundLocker && foundLocker.status === 'CHECKEDOUT') {
            console.log('🔄 Item found in locker with CHECKEDOUT status — routing to locked item return', {
              barcode,
              doorNumber: foundLocker.doorNumber,
              groupIndex: foundGroupIndex,
              groupName: foundGroupName,
              patronId: foundLocker.patronId
            });

            const returnItem = {
              itemId: barcode,
              groupName: foundGroupName,
              doorNumber: foundLocker.doorNumber,
              patronId: foundLocker.patronId,
              timestamp: new Date().toISOString()
            };

            const queueStr = localStorage.getItem('conditionCheckQueue');
            const queue = queueStr ? JSON.parse(queueStr) : [];
            queue.push(returnItem);
            localStorage.setItem('conditionCheckQueue', JSON.stringify(queue));

            setShowLoginScreen(false);
            setLocation(`/lotreturn`);
            endUserMode();
            return;
          }

          // Case 2: Item not found in any locker → match group by ILS title vs itemTypeProperty
          if (!foundLocker) {
            console.log('🔍 Item not in any locker — matching group by ILS title vs itemTypeProperty');
            let matchedGroupName = '';
            let matchedGroupIndex = -1;

            if (lastILSItemLookup?.title && sessionDevice.value?.config?.locker?.groups) {
              const titleLower = lastILSItemLookup.title.toLowerCase();
              const groups = sessionDevice.value.config.locker.groups;
              for (let i = 0; i < groups.length; i++) {
                const group = groups[i];
                if (group.itemTypeProperty && titleLower.includes(group.itemTypeProperty.toLowerCase())) {
                  matchedGroupName = group.name || '';
                  matchedGroupIndex = i;
                  console.log('✅ Matched group by itemTypeProperty:', group.name, 'index:', i);
                  break;
                }
              }
            }

            if (matchedGroupIndex >= 0) {
              // Check patronAllowedSizes and available empty lockers for this group
              const configGroup = sessionDevice.value?.config?.locker?.groups?.[matchedGroupIndex];
              const manifestGroup = sessionDevice.value?.manifest?.groups?.[matchedGroupIndex];
              const patronAllowedSizes = manifestGroup?.patronAllowedSizes || configGroup?.patronAllowedSizes || [];

              if (patronAllowedSizes.length === 0) {
                console.warn('⛔ Item type not eligible for patron self-return:', matchedGroupName);
                updateSessionError({ message: `Item type "${matchedGroupName}" is not eligible for self-return on this device.` });
                setLocation('/error');
                processingItemRef.current = false;
                return;
              }

              // Check if any empty locker is available with a patron-allowed size
              const thedoors = sessionDevice.value?.thedoors;
              const allGroups = sessionDevice.value?.config?.locker?.groups || [];

              // Collect all occupied door numbers across all groups
              const usedDoorNumbers = new Set<string>();
              allGroups.forEach((g: any) => {
                if (!g?.lockers) return;
                const lockersList = Array.isArray(g.lockers) ? g.lockers : Object.values(g.lockers);
                lockersList.forEach((locker: any) => {
                  if (!locker) return;
                  const hasItems = (locker.itemIds && locker.itemIds.length > 0) ||
                                   (locker.itemId && locker.itemId.length > 0);
                  if (hasItems) {
                    const doorNum = locker.doorNumber || locker.id;
                    if (doorNum) usedDoorNumbers.add(String(doorNum));
                  }
                });
              });

              // Check physical doors for an empty one with a patron-allowed size
              let hasAvailableLocker = false;
              if (thedoors) {
                const doorsList = Array.isArray(thedoors) ? thedoors : Object.values(thedoors);
                const allowedSizesLower = patronAllowedSizes.map((s: string) => String(s).toLowerCase());

                for (const door of doorsList as any[]) {
                  const doorNum = door?.doorNumber;
                  const doorSize = String(door?.size || '').toLowerCase();
                  if (doorNum && !usedDoorNumbers.has(String(doorNum)) && allowedSizesLower.includes(doorSize)) {
                    hasAvailableLocker = true;
                    break;
                  }
                }
              }

              if (!hasAvailableLocker) {
                console.warn('⚠️ No empty lockers available for return of item type:', matchedGroupName);
                updateSessionError({ message: `No available lockers to return "${matchedGroupName}" items. All lockers of the allowed sizes are currently occupied.` });
                setLocation('/error');
                processingItemRef.current = false;
                return;
              }

              console.log('🔄 Routing checked-out item to return flow via matched group:', matchedGroupName);

              const returnItem = {
                itemId: barcode,
                groupName: matchedGroupName,
                doorNumber: 0,
                patronId: 'All',
                timestamp: new Date().toISOString()
              };

              const queueStr = localStorage.getItem('conditionCheckQueue');
              const queue = queueStr ? JSON.parse(queueStr) : [];
              queue.push(returnItem);
              localStorage.setItem('conditionCheckQueue', JSON.stringify(queue));

              setShowLoginScreen(false);
              setLocation(`/lotreturn`);
              endUserMode();
              return;
            } else {
              console.warn('⚠️ Item is checked out but no matching group found on this device');
              updateSessionError({ message: `Item ${barcode} is currently checked out but could not be matched to any group on this device for return.` });
              setLocation('/error');
              processingItemRef.current = false;
              return;
            }
          }
        }

        console.log('📦 Identified as item, opening add item wizard');
        processingItemRef.current = true;
        processLoginOptions(barcode, '');
        return;
      }

      // patron
      if (classification === 'patron') {
        console.log('👤 Identified as patron');
        console.log('👤 sessionDevice.value.settings?.password:', sessionDevice.value.settings?.password);
        stopVideo();
        setUsername(barcode)
        if(sessionDevice.value.settings?.password) {
          console.log('🔑 Password required - showing keyboard');
          setShowKeyboard(true);
          changeFocus('password')
        } else {
          console.log('✅ No password required - calling processLoginUser');
          processLoginUser(barcode, '')
        }
      } else {
        console.log('❓ Unknown barcode type - classification is:', classification);
      }
    }
  };

  // Watch for barcode changes (serial scanner + RFID) - same pattern as HomeHold
  useEffect(() => {
    if (sessionBarcode.value?.length) {
      enableBarcodeMode(sessionBarcode.value);
    }
  }, [sessionBarcode.value]);

  useEffect(() => {
    if (rfidItemId.value?.length) {
      const itemId = rfidItemId.value;
      enableBarcodeMode(itemId);
      // Clear rfidItemId after use to allow re-reading the same tag
      setTimeout(() => {
        rfidItemId.value = '';
      }, 2000);
    }
  }, [rfidItemId.value]);

  // run once
  useEffect(() => {
    updateShowBackgroundImage(true);

    // scanner();

    // Clear existing languages to prevent duplicates
    languges.length = 0;

    // Load languages from Firestore localizations (primary source)
    const firestoreLocalizations = localStorage.getItem('firestoreLocalizations');
    const seenLangCodes = new Set<string>();

    if (firestoreLocalizations) {
      try {
        const allFirestore = JSON.parse(firestoreLocalizations);
        for (const docId in allFirestore) {
          const firestoreLang = allFirestore[docId];
          // Use langKey from Firestore if available, otherwise use document ID
          const langKey = firestoreLang.langKey || docId;
          if (!seenLangCodes.has(langKey)) {
            seenLangCodes.add(langKey);
            languges.push({
              key: langKey,
              lang: langKey,
              name: firestoreLang.nativeName || firestoreLang.displayName || langKey.toUpperCase(),
              icon: firestoreLang.iconUrl || `https://flagicons.lipis.dev/flags/4x3/${langKey}.svg`
            });
          }
        }
        console.log('🌐 HomeLoT: Loaded', languges.length, 'languages from Firestore');
      } catch (error) {
        console.log('⚠️  HomeLoT: Error parsing Firestore localizations', error);
      }
    }

    // Fallback: If no Firestore languages, load from old 'localized' storage
    if (languges.length === 0) {
      const localized = localStorage.getItem('localized');
      if (localized) {
        try {
          const allLocalized = JSON.parse(localized);
          for (const key in allLocalized) {
            if (!seenLangCodes.has(key)) {
              seenLangCodes.add(key);
              const data = allLocalized[key];
              languges.push(Object.assign(data.translation));
            }
          }
          console.log('🌐 HomeLoT: Loaded', languges.length, 'languages from localized fallback');
        } catch (error) {
          console.log('lang fallback is not localized', error);
        }
      }
    }

    // Build language list from settings.langs
    // Handle string, array, Firebase RTDB array (numeric keys), and object formats
    const configuredLangs = sessionDevice.value?.settings?.langs;
    if (configuredLangs) {
      let langKeys: string[] = [];
      // Handle string format "en, it" or "en,it"
      if (typeof configuredLangs === 'string') {
        langKeys = configuredLangs.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
      } else if (Array.isArray(configuredLangs)) {
        langKeys = configuredLangs;
      } else {
        const keys = Object.keys(configuredLangs);
        // Check if keys are numeric (Firebase RTDB array format)
        if (keys.length > 0 && keys.every(k => !isNaN(Number(k)))) {
          langKeys = Object.values(configuredLangs) as string[];
        } else {
          langKeys = keys;
        }
      }

      if (langKeys.length > 0) {
        // Build list from configured langs, keeping existing data or creating fallback
        const existingLangs = [...languges];
        languges.length = 0;

        langKeys.forEach((langKey: string) => {
          const existing = existingLangs.find((lang: any) => (lang.key || lang.lang) === langKey);
          if (existing) {
            languges.push(existing);
          } else {
            // Fallback for languages without localization data
            languges.push({
              key: langKey,
              lang: langKey,
              name: langKey.toUpperCase(),
              icon: `https://flagicons.lipis.dev/flags/4x3/${langKey}.svg`
            });
          }
        });
        console.log('🌐 HomeLoT: Built', languges.length, 'languages from settings.langs:', langKeys);
      }
    }
  }, []);

  // Listen for i18n language changes and force re-render
  useEffect(() => {
    const handleLanguageChanged = (lng: string) => {
      console.log('🌐 HomeLoT: i18n languageChanged event:', lng);
      setCurrentLang(lng);
    };

    i18n.on('languageChanged', handleLanguageChanged);

    return () => {
      i18n.off('languageChanged', handleLanguageChanged);
    };
  }, [i18n]);


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

  function changeFocus(input: string) {
    switch (input) {
      case 'username':
        if (keyboard.current) {
          keyboard.current.setInput(username)
        }
        setFocusOnUsername(true)
        setLoginKeyboardVisible(true)
        break;
      case 'password':
        if (keyboard.current) {
          keyboard.current.setInput(password)
        }
        setFocusOnUsername(false)
        setLoginKeyboardVisible(true)
        break;

      default:

        resetKeybard()
        setFocusOnUsername(false)
        setLoginKeyboardVisible(false)
        break;
    }
  }

  const resetKeybard = () => {
    showKeyboardInit = true;
    setShowKeyboard(false);
    countTimerRef.current = 30;
    setUsername('')
    setPassword('')
    keyboard?.current?.setInput(null);
  }

  const handleUIClick = triggerSlideshowReset;

  const handleTouch = (keepGoing = true) => {
    // Clear any existing timeout first
    if (handleTouchRef.current) {
      clearTimeout(handleTouchRef.current);
      handleTouchRef.current = null;
    }

    if (keepGoing && sessionLocation.value === '/') {
      if (showKeyboardInit) {
        stopVideo();
        showKeyboardInit = false;
        setShowKeyboard(true);
        countTimerRef.current = 30; // Reset timer when showing keyboard
        Promise.delay(200).then(() => userRef.current?.focus())
      }

      const setTimeoutId = setTimeout(() => {
        if (countTimerRef.current > 0 && sessionLocation.value === '/') {
          countTimerRef.current = countTimerRef.current - 1;
          console.log('⏱️ Login timeout countdown:', countTimerRef.current);
          handleTouch(true);
        } else {
          console.log('⏱️ Login timeout expired - closing login dialog');
          setShowLoginScreen(false);
          setLibraryOfThingsGroup(null);
          setManualItemType('');
          setManualItemName('');
          resetKeybard();
        }
      }, 1000); // Changed to 1 second for more consistent countdown

      handleTouchRef.current = setTimeoutId;

    } else {
      startVideo();
      resetKeybard();
    }
  }

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (handleTouchRef.current) {
        clearTimeout(handleTouchRef.current);
        handleTouchRef.current = null;
      }
      if (slideshowIdleTimerRef.current) {
        clearTimeout(slideshowIdleTimerRef.current);
        slideshowIdleTimerRef.current = null;
      }
    };
  }, []);

  // Auto-start slideshow carousel when idle
  const resetSlideshowIdleTimer = (isScreenClick = false) => {
    const showAsSlideshow = sessionDevice.value?.settings?.showGroupsAsSlideshow;
    if (!showAsSlideshow) return;

    if (slideshowIdleTimerRef.current) {
      clearTimeout(slideshowIdleTimerRef.current);
      slideshowIdleTimerRef.current = null;
    }

    const slideshowTimer = (sessionDevice.value?.settings?.showGroupsAsSlideshowTimer || 30) * 1000;
    const wasInterrupted = isScreenClick || slideshowInterruptedRef.current;
    if (isScreenClick) slideshowInterruptedRef.current = true;
    const delay = wasInterrupted ? slideshowTimer + 3 * slideshowTimer : slideshowTimer;

    slideshowIdleTimerRef.current = setTimeout(() => {
      if (!showLoginScreen && !playMode && !loading && !welcomeUserDisplayName) {
        setPlayMode(true);
      }
    }, delay);
  };

  // Start idle timer on mount and when returning from login/carousel
  useEffect(() => {
    if (!showLoginScreen && !playMode && !loading && !welcomeUserDisplayName) {
      resetSlideshowIdleTimer(slideshowInterruptedRef.current);
    }
    return () => {
      if (slideshowIdleTimerRef.current) {
        clearTimeout(slideshowIdleTimerRef.current);
        slideshowIdleTimerRef.current = null;
      }
    };
  }, [showLoginScreen, playMode, loading, welcomeUserDisplayName]);

  const override: CSSProperties = {
    display: 'block',
    margin: '0 auto',
    borderColor: 'blue',
  }


  function procesModalResult(decision: boolean) {
    setModalOpen(decision)
  }

  // error handling
  function openErrorView() {
    updateSessionError(errorReport)
    setLocation(`/error`);
    runOnce = true;
  }

  // workflow actions *****************************************************
// patron login
  const handleSubmit = (e: { preventDefault: () => void; }) => {
    e.preventDefault();
    runOnce = true;
    setShowKeyboard(false);
    processLoginOptions(username, password);
    setUsername('');
    setPassword('');
  };

  // staff login
  async function processStaffCard(barcode:string) {
    updateShowBackgroundImage(false);

    try {
      const staffPin = kioskConfig.value?.adminPin || '20212022';
      const customPin = kioskConfig.value?.device?.settings?.customStaffPin;

      if (barcode === staffPin || (customPin && barcode === customPin) || (cachedAdminCardBarcode && barcode.toUpperCase() === cachedAdminCardBarcode.toUpperCase())) {
        console.log('🔐 Staff PIN matched, routing to admin');
        setLocation('/admin');
        runOnce = true;
        endStaffMode();
        return;
      }

      toast.error('Unknown user, please try again or contact system admin');
    } catch (error) {
      console.error('Error processing staff card:', error);
    }

    endStaffMode();
  }

  async function loginWithCard(user: any, branchId:any) {

    const result = {
      validPatron: 'Y',
      patronIdentifier: '1234567890',
      personalName: 'John Doe',
      emailAddress: 'john.doe@example.com',
    }
      if (!(result.validPatron === 'Y' && !!result.patronIdentifier)) {
          return null;
      }
      localStorage.setItem('patronPin', user.userPin) ;
      localStorage.setItem('patron',  JSON.stringify(result)) ;
      localStorage.setItem('personalName', result.personalName || result.patronIdentifier) ;
      localStorage.setItem('user', result.emailAddress || null) ;
      localStorage.setItem('user_id', result.patronIdentifier);
      return result;

  }

  // step login
  const processLoginClicked = () => {
    // Always clear username and password when opening login dialog
    setUsername('');
    setPassword('');
    keyboard?.current?.setInput('');
    setFocusOnUsername(true);
    setLoginKeyboardVisible(true);
    showKeyboardInit = true;

    if (!welcomeUserDisplayName && (libraryOfThingsGroup.value?.name.toUpperCase() === 'RETURNS' || libraryOfThingsGroup.value?.name.toUpperCase() === 'DONATIONS')) {
      setShowLoginScreen(true);
      handleTouch(true);
      updateShowReturnInfo(true);
      exitReturnCountdownTimer(9);
      return;
    }


    if (welcomeUserDisplayName && libraryOfThingsGroup.value) {
      // now select item, return or let timer exit
      const groupName = libraryOfThingsGroup.value?.name.toUpperCase();
      if (groupName !== 'RETURNS' && groupName !== 'DONATIONS') {
        setShowCheckoutConfirmModal(true);
        return;
      } else {
        setLocation(`/lotreturn`);
      }
      exit();
      return;
    }
    setShowLoginScreen(true)
    handleTouch(true)

  }

  /**
   * ILS Login Workflow — determines which ILS to use for patron authentication
   * @returns { validPatron, patronIdentifier, personalName, emailAddress, screenMessage, ... } or null on error
   */
  async function workflowILSLogin(cardNumber: string, password: string): Promise<any> {
    const branch = sessionBranch.value;
    const isPolaris = branch?.polarisSettings?.enabled;
    const isSip2 = branch?.sip2Settings?.enabled;

    if (isPolaris) {
      const branchId = branch?.id;
      const currentLicenseId = sessionLicenseId.value;
      const requirePassword = sessionDevice.value?.settings?.password;

      // Always fetch patron basic data and blocks using barcode
      const baseUrl = `${POLARIS_API_BASE}/${currentLicenseId}/${branchId}`;
      const [basicRes, blocksRes] = await Promise.all([
        fetch(`${baseUrl}/patron/basic?patronId=${cardNumber}`, { headers: { 'Content-Type': 'application/json' } }),
        fetch(`${baseUrl}/patron/blocks?patronId=${cardNumber}`, { headers: { 'Content-Type': 'application/json' } })
      ]);

      const basicData = await basicRes.json();
      const blocksData = await blocksRes.json();
      const bd = basicData?.PatronBasicData || {};
      console.log(`🔑 workflowILSLogin: Polaris basic:`, basicData);
      console.log(`🔑 workflowILSLogin: Polaris blocks:`, blocksData);

      let authOk = false;

      if (requirePassword) {
        // Password required — do patron auth
        console.log(`🔑 workflowILSLogin: Polaris auth for barcode ${cardNumber}`);
        const url = `${POLARIS_API_BASE}/${currentLicenseId}/${branchId}/auth/patron`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ barcode: cardNumber, password: password || '' })
        });
        const authData = await response.json();
        authOk = response.ok;
        console.log(`🔑 workflowILSLogin: Polaris auth ${authOk ? 'OK' : 'FAILED'}:`, authData);
      } else {
        // No password required — auth OK if patron exists (has patronId and name)
        authOk = !!(bd.PatronID && bd.NameFirst);
        console.log(`🔑 workflowILSLogin: No password required, auth=${authOk} (PatronID=${bd.PatronID}, NameFirst=${bd.NameFirst})`);
      }

      const merged = {
        auth: authOk,
        userId: bd.PatronID || null,
        patronId: bd.Barcode || cardNumber,
        patronName: bd.NameFirst || cardNumber,
        patronEmail: bd.EmailAddress || null,
        patronPhone: bd.PhoneNumber || null,
        blocks: blocksData?.Blocks || [],
      };

      console.log(`🔑 workflowILSLogin: Polaris merged patron:`, merged);

      if (!authOk) {
        throw new Error('Polaris patron not found or authentication failed');
      }

      // Get or create patron in Firestore
      const { patron: persistPatron, patronKey } = await getOrCreatePatron(currentLicenseId, merged.patronId, {
        name: merged.patronName,
        email: merged.patronEmail,
      });

      if (patronKey) {
        await updatePatron(currentLicenseId, patronKey, { updatedAt: new Date().toISOString() });
      }

      return {
        validPatron: 'Y',
        patronIdentifier: merged.patronId,
        personalName: merged.patronName,
        emailAddress: merged.patronEmail,
        screenMessage: '',
        polarisData: merged,
        persistPatron,
        patronKey,
      };
    } else if (isSip2) {
      // SIP2 patron info
      console.log(`🔑 workflowILSLogin: SIP2 patronInfo for ${cardNumber}`);
      const result = await FirebaseSIP2.patronInfo(cardNumber);
      console.log(`🔑 workflowILSLogin: SIP2 patronInfo response:`, result);
      return result;
    } else {
      // No ILS configured
      console.error(`❌ workflowILSLogin: No ILS configured for branch`);
      throw new Error('Login not supported — no ILS (Polaris or SIP2) is configured for this branch');
    }
  }

  /**
   * ILS Checkin Workflow — check in an item via the configured ILS
   * @param itemBarcode - barcode of the item to check in
   * @returns { success, data } or throws on error
   */
  async function workflowILSCheckin(itemBarcode: string): Promise<any> {
    const branch = sessionBranch.value;
    const currentLicenseId = sessionLicenseId.value;
    const isPolaris = branch?.polarisSettings?.enabled;
    const isSip2 = branch?.sip2Settings?.enabled;
    const isSymphony = branch?.symphonySettings?.enabled;

    // Skip for license 1/2 simulation
    if (currentLicenseId === 1 || currentLicenseId === 2) {
      console.log(`📦 workflowILSCheckin: Demo checkin for license ${currentLicenseId}, item ${itemBarcode}`);
      return { success: true, demo: true, itemBarcode };
    }

    if (isPolaris) {
      const branchId = branch?.id;
      const baseUrl = `${POLARIS_API_BASE}/${currentLicenseId}/${branchId}`;

      // Step 1: Item lookup
      console.log(`📦 workflowILSCheckin: Polaris item lookup for ${itemBarcode}`);
      const lookupRes = await fetch(`${baseUrl}/items/lookup?itemBarcode=${encodeURIComponent(itemBarcode)}`, {
        headers: { 'Content-Type': 'application/json' }
      });
      const lookupData = await lookupRes.json();
      console.log(`📦 workflowILSCheckin: Polaris item lookup response:`, lookupData);

      // Step 2: Checkin
      console.log(`📦 workflowILSCheckin: Polaris checkin for item ${itemBarcode}`);
      const checkinRes = await fetch(`${baseUrl}/circulation/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemBarcode })
      });

      const checkinData = await checkinRes.json();
      console.log(`📦 workflowILSCheckin: Polaris checkin response:`, checkinData);

      if (!checkinRes.ok) {
        throw new Error(checkinData?.error || checkinData?.message || `Polaris checkin failed (HTTP ${checkinRes.status})`);
      }

      return {
        success: checkinData?.PAPIErrorCode === 0,
        title: checkinData?.Title || null,
        itemId: checkinData?.ItemBarcode || itemBarcode,
        itemStatusId: checkinData?.ItemStatusID || null,
      };
    } else if (isSip2) {
      console.log(`📦 workflowILSCheckin: SIP2 checkin for item ${itemBarcode}`);
      const result = await FirebaseSIP2.checkin(itemBarcode);
      console.log(`📦 workflowILSCheckin: SIP2 checkin response:`, result);
      return { success: +result.ok === 1, data: result };
    } else if (isSymphony) {
      console.log(`📦 workflowILSCheckin: Symphony checkin — not yet implemented`);
      return { success: true, pending: true, itemBarcode };
    } else {
      console.error(`❌ workflowILSCheckin: No ILS configured for branch`);
      throw new Error('Checkin not supported — no ILS configured for this branch');
    }
  }

  async function processLoginUser(username:string, password:string) {
    updateSessionUserModeOn(true)

    setTimeout(() => {
      setLoading(true);
    }, 50);

    let cardNumber = username;

    console.log(`🔍 processLoginUser called with cardNumber: ${cardNumber}, licenseId: ${licenseId}`);

    if (!cardNumber) {
        return;
    }


    // Step 1: ILS Login — authenticate patron via Polaris, SIP2, or error (skip for license 1/2 simulation)
    const isPolaris = sessionBranch.value?.polarisSettings?.enabled;
    const isSip2 = sessionBranch.value?.sip2Settings?.enabled;
    if ((isPolaris || isSip2) && licenseId !== 1 && licenseId !== 2) {
      try {
        const ilsResult = await workflowILSLogin(cardNumber, password);
        console.log(`🔑 ILS login result:`, ilsResult);

        const persistPatron = ilsResult.persistPatron;
        const patronKey = ilsResult.patronKey;

        // Store patron info in localStorage
        localStorage.setItem('patronId', cardNumber);
        localStorage.setItem('loginType', 'card');
        localStorage.setItem('personalName', ilsResult.personalName || cardNumber);
        localStorage.setItem('patron', JSON.stringify(persistPatron));
        localStorage.setItem('user_id', cardNumber);
        localStorage.setItem('patronPin', sessionDevice.value?.settings?.password ? password : '');
        if (patronKey) {
          localStorage.setItem('patronKey', patronKey);
        }

        runOnce = true;

        // Check if patron has items reserved in any locker — collect ALL holds
        if (!libraryOfThingsGroup.value) {
          const groups = sessionDevice.value?.manifest?.groups;
          if (groups) {
            const allPatronHolds: {groupName: string, groupIndex: number, doorNumber: string, patronId: string}[] = [];
            const groupEntries = Array.isArray(groups) ? groups.map((g: any, i: number) => [i, g]) : Object.entries(groups);
            for (const [gIdx, group] of groupEntries) {
              if (!group?.lockers) continue;
              const lockerEntries = Array.isArray(group.lockers) ? group.lockers.map((l: any, i: number) => [i, l]) : Object.entries(group.lockers);
              for (const [, locker] of lockerEntries) {
                if (locker && String(locker.patronId) === String(cardNumber) && locker.status !== 'CHECKEDOUT') {
                  const actualDoorNumber = locker.doorNumber || locker.door || '?';
                  allPatronHolds.push({ groupName: group.name, groupIndex: +gIdx, doorNumber: String(actualDoorNumber), patronId: cardNumber });
                }
              }
            }
            if (allPatronHolds.length > 0) {
              setShowLoginScreen(false);
              setLoading(false);
              setHoldPickupInfo(allPatronHolds[0]);
              setHoldPickupQueue(allPatronHolds.slice(1));
              setHoldPickupTimer(20);
              setShowHoldPickupModal(true);
              resetKeybard();
              return;
            }
          }

          // No holds — show welcome with patron name
          setLoading(false);
          setWelcomeUserDisplayName(ilsResult.personalName || cardNumber);
          setShowLoginScreen(false);
          exitLoginCountdownTimer(60);
          resetKeybard();
          return;
        }

        // Group selected — navigate to checkout or return
        const groupNameNav = libraryOfThingsGroup.value?.name.toUpperCase();
        if (groupNameNav !== 'RETURNS' && groupNameNav !== 'DONATIONS') {
          setLocation(`/lotcheckout`);
        } else {
          setLocation(`/lotreturn`);
        }
        resetKeybard();
        return;

      } catch (ilsError: any) {
        console.error(`❌ ILS login failed:`, ilsError);
        errorReport.message = ilsError?.message || 'ILS login failed';
        setLoading(false);
        openErrorView();
        return;
      }
    }

    if (licenseId === 1 || licenseId === 2) {
        // Get or create patron in Firestore
        console.log(`✅ Using simplified Firestore authentication for licenseId ${licenseId}`);
        const { patron: persistPatron, patronKey } = await getOrCreatePatron(licenseId, cardNumber, {
            keyword: '',
            email: null,
        });

        if (!persistPatron) {
            console.log(`❌ Patron ${cardNumber} could not be fetched or created in Firestore /licenses/${licenseId}/patrons`);
            errorReport.message = t('SAAS.ERROR.LOGIN_PATRONIDNOTFOUND', { patronId: cardNumber, defaultValue: 'Patron ID not found' });
            openErrorView();
            return;
        }

        console.log(`✅ Patron ${cardNumber} found in Firestore:`, persistPatron);

        // Store patron info in localStorage
        localStorage.setItem('patronId', cardNumber);
        localStorage.setItem('loginType', 'card');
        localStorage.setItem('personalName', persistPatron.name || persistPatron.patronId);
        localStorage.setItem('patron', JSON.stringify(persistPatron));
        localStorage.setItem('user_id', persistPatron.patronId);
        if (patronKey) {
          localStorage.setItem('patronKey', patronKey);
          updatePatron(licenseId, patronKey, { updatedAt: new Date().toISOString() }).catch(err => console.error('Failed to update patron updatedAt:', err));
        }

        runOnce = true;

        // Check if patron has items reserved in any locker (patronId match) — collect ALL holds
        if (!libraryOfThingsGroup.value) {
          const groups = sessionDevice.value?.manifest?.groups;
          if (groups) {
            const allPatronHolds: {groupName: string, groupIndex: number, doorNumber: string, patronId: string}[] = [];
            const groupEntries = Array.isArray(groups) ? groups.map((g: any, i: number) => [i, g]) : Object.entries(groups);
            for (const [gIdx, group] of groupEntries) {
              if (!group?.lockers) continue;
              const lockerEntries = Array.isArray(group.lockers) ? group.lockers.map((l: any, i: number) => [i, l]) : Object.entries(group.lockers);
              for (const [, locker] of lockerEntries) {
                if (locker && String(locker.patronId) === String(cardNumber) && locker.status !== 'CHECKEDOUT') {
                  const actualDoorNumber = locker.doorNumber || locker.door || '?';
                  console.log(`🎯 Patron ${cardNumber} has hold in group "${group.name}", door #${actualDoorNumber}`);
                  allPatronHolds.push({ groupName: group.name, groupIndex: +gIdx, doorNumber: String(actualDoorNumber), patronId: cardNumber });
                }
              }
            }
            if (allPatronHolds.length > 0) {
              console.log(`🎯 Patron ${cardNumber} has ${allPatronHolds.length} hold(s) total`);
              setShowLoginScreen(false);
              setLoading(false);
              setHoldPickupInfo(allPatronHolds[0]);
              setHoldPickupQueue(allPatronHolds.slice(1));
              setHoldPickupTimer(20);
              setShowHoldPickupModal(true);
              return;
            }
          }
        }

        if (!libraryOfThingsGroup.value) {
          const patronDisplayName = persistPatron.name || persistPatron.patronId || username;

          // If manual item type or name was entered, show hold request modal
          if (manualItemType || manualItemName) {
            setShowLoginScreen(false);
            setLoading(false);
            setHoldRequestInfo({
              patronId: patronDisplayName,
              groupName: manualItemType || t('SAAS.HOLD_REQUEST', { defaultValue: 'Hold Request' }),
              itemType: manualItemType || undefined,
              itemName: manualItemName || undefined
            });
            setShowHoldRequestModal(true);
            // Clear manual fields
            setManualItemType('');
            setManualItemName('');
            // Auto-close modal after 5 seconds and end user mode
            setTimeout(() => {
              setShowHoldRequestModal(false);
              setHoldRequestInfo(null);
              endUserMode();
            }, 5000);
            return;
          }

          // Otherwise, select item, return or let timer exit
          setLoading(false);
          setWelcomeUserDisplayName(persistPatron.name || persistPatron.patronId);
          setShowLoginScreen(false);
          exitLoginCountdownTimer(60);

          return;
        }

        if (holdLibraryOfThingsGroup) {
          const group = libraryOfThingsGroup.value;
          const patronDisplayName = persistPatron.name || persistPatron.patronId || username;
          // Show hold request modal after successful login
          setShowLoginScreen(false);
          setLoading(false);
          setHoldRequestInfo({ patronId: patronDisplayName, groupName: group?.name || '' });
          setShowHoldRequestModal(true);
          setHoldLibraryOfThingsGroup(false);
          // Auto-close modal after 5 seconds and end user mode
          setTimeout(() => {
            setShowHoldRequestModal(false);
            setHoldRequestInfo(null);
            endUserMode();
          }, 5000);
          return;
        }

        const groupNameNav = libraryOfThingsGroup.value?.name.toUpperCase();
        if (groupNameNav !== 'RETURNS' && groupNameNav !== 'DONATIONS') {
          setLocation(`/lotcheckout`);
        } else {
          setLocation(`/lotreturn`);
        }
    // } else if (sessionDevice.value.ldap_login) {
    //     if (testUserList.length > 0 && !!!_.find(testUserList, (a) => a === cardNumber)) {
    //         errorReport.message = 'Not supported testuser ID';
    //         openErrorView();
    //         return;
    //     }

    //     try {
    //         const ldapUser:any = await request(EndPoint.SIDEEVENT).post(`/ldap/login?`, { userId: cardNumber, password: password, deviceId: deviceId }).then(result => result.data || {});

    //         if (ldapUser) {
    //             const patron = await request(EndPoint.SIDEEVENT).post(`/${licenseId}/hybridsip/`, {
    //                   patronId: cardNumber,
    //                   patronPassword: password,
    //                   branch:  sessionDevice.value.branch.branch_code,
    //                   resource: 'sip:patroninformation',

    //                 }).then(result => result.data || {});
    //             // Get or create patron in Firestore
    //             const { patron: persistPatron, patronKey } = await getOrCreatePatron(licenseId, cardNumber, {
    //               name: name || ,
    //               keyword: '',
    //               email: patron.email !== '' ? patron.email : null,
    //               hms_disabled: true,
    //               notify_via: 'EMAIL',
    //             });

    //             const shouldUserBeBlockedDueLocker = !!_.find(persistPatron.blocks, (b) => b.active && b.deviceId === sessionDevice.value.device_id);

    //             // is this needed???
    //             if (!shouldUserBeBlockedDueLocker) {
    //                 const i = _.findIndex(persistPatron.blocks, (b: any) => b.deviceId === sessionDevice.value.device_id);
    //                 if (i !== -1)
    //                     persistPatron.blocks[i] = {
    //                         active: false,
    //                         timestamp: MonthYear.getNextHelper().timestamp,
    //                         deviceId: sessionDevice.value.device_id,
    //                     };

    //                 // Update patron in Firestore
    //                 if (patronKey) {
    //                   await updatePatron(licenseId, patronKey, persistPatron);
    //                 }
    //             }

    //             const shouldUserBeBlockedDueIls = sessionDevice.value.skip_patron_test
    //                 ? false
    //                 : patron && patron.validPatron === 'Y'
    //                 ? +patron.feeAmount > +patron.feeLimit || patron.patronStatus.includes('Y')
    //                 : true;

    //             if (shouldUserBeBlockedDueIls) {
    //                 if (patron.validPatron === 'N')
    //                     errorReport.message = '_ILS_LOGIN_ERROR_MESSAGE_REASON_BARRED';
    //                 else if (+patron.feeAmount > +patron.feeLimit)
    //                     errorReport.message = '_ILS_LOGIN_ERROR_MESSAGE_REASON_FINES';
    //                 openErrorView();

    //             } else if (shouldUserBeBlockedDueLocker) {
    //                 errorReport.message = 'ERROR_LOGIN_FAILED_BLOCKED';
    //                 openErrorView();
    //             } else if (patron && sessionDevice.value.is_locker) {
    //                 await persistDeviceChanges(device);

    //                 localStorage.setItem('patronId', cardNumber) ;
    //                 localStorage.setItem('loginType', 'card') ;
    //                 // $location.path(`/${licenseId}/locker`);
    //             }

    //         }
    //     } catch (issue) {
    //         errorReport.message = 'ERROR_LOGIN_FAILED';
    //         openErrorView();
    //     }
    } else {
        console.log(`❌ Patron login not configured for licenseId ${licenseId}. Current configuration only supports licenseId 1 and 2.`);
        toast.error(`Patron login is not supported for license ${licenseId}. Please contact support.`);
        setLoading(false);
        return;
    }
    resetKeybard()
  }

  async function processLoginOptions(barcode:string, password:string = '') {
    if (barcode === '21202000818465') {
      barcode = testItem()
    }

    // Check if barcode starts with *** - process as return (lotreturn)
    if (barcode.startsWith('***')) {
      const actualBarcode = barcode.substring(3); // Remove *** prefix
      console.log('🔄 Barcode starts with ***, processing as return. Item ID:', actualBarcode);

      // Add item to condition check queue for return processing
      const returnItem = {
        itemId: actualBarcode,
        doorNumber: 0,
        patronId: 'CustomReturn'
      };

      const queueStr = localStorage.getItem('conditionCheckQueue');
      const queue = queueStr ? JSON.parse(queueStr) : [];
      queue.push(returnItem);
      localStorage.setItem('conditionCheckQueue', JSON.stringify(queue));

      console.log('➕ Added *** item to return queue:', returnItem);

      setShowLoginScreen(false);
      setLocation(`/lotreturn`);
      return;
    }

    console.log('holdLibraryOfThingsGroup', holdLibraryOfThingsGroup);
    const classification = await classifyBarcode(barcode, {
      branch,
      licenseId,
      device: sessionDevice.value,
      adminPin: kioskConfig.value?.adminPin,
      customStaffPin: kioskConfig.value?.device?.settings?.customStaffPin,
      adminFeedCallbacks: { setLibraryOfThingsGroup, processLoginUser },
    });

    if (classification === 'staffCard') {
      processStaffCard(barcode)
    } else if (classification === 'item' || classification === 'deviceReturn') {

      // Check SIP2 circulation status — if 04 (checked out), process as return instead of add
      if (lastILSItemLookup?.circulationStatus === 4) {
        console.log('📦 [processLoginOptions] Item circulation status is 04 (checked out) — looking up locker for return');

        // Search device manifest for this item
        let cFoundLocker: any = null;
        let cFoundGroupIndex = -1;
        let cFoundGroupName = '';
        if (sessionDevice.value?.manifest?.groups) {
          const cManifestGroups = sessionDevice.value.manifest.groups;
          for (const gIdx in cManifestGroups) {
            const group = cManifestGroups[gIdx];
            if (!group?.lockers) continue;
            const lockers = Array.isArray(group.lockers) ? group.lockers : Object.values(group.lockers);
            for (const locker of lockers as any[]) {
              if (locker?.itemIds && locker.itemIds.includes(barcode)) {
                cFoundLocker = locker;
                cFoundGroupIndex = Number(gIdx);
                cFoundGroupName = group.name || '';
                break;
              }
            }
            if (cFoundLocker) break;
          }
        }

        // Case 1: Item found in a locker with CHECKEDOUT status → locked item return
        if (cFoundLocker && cFoundLocker.status === 'CHECKEDOUT') {
          console.log('🔄 [processLoginOptions] Item found in locker with CHECKEDOUT status — routing to return', {
            barcode, doorNumber: cFoundLocker.doorNumber, groupIndex: cFoundGroupIndex, groupName: cFoundGroupName
          });

          const returnItem = {
            itemId: barcode, groupName: cFoundGroupName,
            doorNumber: cFoundLocker.doorNumber, patronId: cFoundLocker.patronId,
            timestamp: new Date().toISOString()
          };
          const queueStr = localStorage.getItem('conditionCheckQueue');
          const queue = queueStr ? JSON.parse(queueStr) : [];
          queue.push(returnItem);
          localStorage.setItem('conditionCheckQueue', JSON.stringify(queue));

          setShowLoginScreen(false);
          setLocation(`/lotreturn`);
          endUserMode();
          return;
        }

        // Case 2: Item not found in any locker → match group by ILS title vs itemTypeProperty
        if (!cFoundLocker) {
          console.log('🔍 [processLoginOptions] Item not in any locker — matching group by ILS title');
          let cMatchedGroupName = '';
          let cMatchedGroupIndex = -1;

          if (lastILSItemLookup?.title && sessionDevice.value?.config?.locker?.groups) {
            const titleLower = lastILSItemLookup.title.toLowerCase();
            const groups = sessionDevice.value.config.locker.groups;
            for (let i = 0; i < groups.length; i++) {
              const group = groups[i];
              if (group.itemTypeProperty && titleLower.includes(group.itemTypeProperty.toLowerCase())) {
                cMatchedGroupName = group.name || '';
                cMatchedGroupIndex = i;
                console.log('✅ [processLoginOptions] Matched group by itemTypeProperty:', group.name, 'index:', i);
                break;
              }
            }
          }

          if (cMatchedGroupIndex >= 0) {
            const configGroup = sessionDevice.value?.config?.locker?.groups?.[cMatchedGroupIndex];
            const manifestGroup = sessionDevice.value?.manifest?.groups?.[cMatchedGroupIndex];
            const patronAllowedSizes = manifestGroup?.patronAllowedSizes || configGroup?.patronAllowedSizes || [];

            if (patronAllowedSizes.length === 0) {
              console.warn('⛔ [processLoginOptions] Item type not eligible for patron self-return:', cMatchedGroupName);
              updateSessionError({ message: `Item type "${cMatchedGroupName}" is not eligible for self-return on this device.` });
              setLocation('/error');
              processingItemRef.current = false;
              return;
            }

            // Check if any empty locker is available with a patron-allowed size
            const thedoors = sessionDevice.value?.thedoors;
            const allGroups = sessionDevice.value?.config?.locker?.groups || [];
            const usedDoorNumbers = new Set<string>();
            allGroups.forEach((g: any) => {
              if (!g?.lockers) return;
              const lockersList = Array.isArray(g.lockers) ? g.lockers : Object.values(g.lockers);
              lockersList.forEach((locker: any) => {
                if (!locker) return;
                const hasItems = (locker.itemIds && locker.itemIds.length > 0) || (locker.itemId && locker.itemId.length > 0);
                if (hasItems) {
                  const doorNum = locker.doorNumber || locker.id;
                  if (doorNum) usedDoorNumbers.add(String(doorNum));
                }
              });
            });

            let hasAvailableLocker = false;
            if (thedoors) {
              const doorsList = Array.isArray(thedoors) ? thedoors : Object.values(thedoors);
              const allowedSizesLower = patronAllowedSizes.map((s: string) => String(s).toLowerCase());
              for (const door of doorsList as any[]) {
                const doorNum = (door as any)?.doorNumber;
                const doorSize = String((door as any)?.size || '').toLowerCase();
                if (doorNum && !usedDoorNumbers.has(String(doorNum)) && allowedSizesLower.includes(doorSize)) {
                  hasAvailableLocker = true;
                  break;
                }
              }
            }

            if (!hasAvailableLocker) {
              console.warn('⚠️ [processLoginOptions] No empty lockers available for return of item type:', cMatchedGroupName);
              updateSessionError({ message: `No available lockers to return "${cMatchedGroupName}" items. All lockers of the allowed sizes are currently occupied.` });
              setLocation('/error');
              processingItemRef.current = false;
              return;
            }

            console.log('🔄 [processLoginOptions] Routing checked-out item to return flow via matched group:', cMatchedGroupName);
            const returnItem = {
              itemId: barcode, groupName: cMatchedGroupName, doorNumber: 0,
              patronId: 'All', timestamp: new Date().toISOString()
            };
            const queueStr = localStorage.getItem('conditionCheckQueue');
            const queue = queueStr ? JSON.parse(queueStr) : [];
            queue.push(returnItem);
            localStorage.setItem('conditionCheckQueue', JSON.stringify(queue));

            setShowLoginScreen(false);
            setLocation(`/lotreturn`);
            endUserMode();
            return;
          } else {
            console.warn('⚠️ [processLoginOptions] Item is checked out but no matching group found');
            updateSessionError({ message: `Item ${barcode} is currently checked out but could not be matched to any group on this device for return.` });
            setLocation('/error');
            processingItemRef.current = false;
            return;
          }
        }
      }

      // Check if item is in a permanent locker (isLockedForItemId) that is currently checked out
      // If so, route directly to return flow instead of add-item wizard
      if (sessionDevice.value?.manifest?.groups) {
        const manifestGroups = sessionDevice.value.manifest.groups;
        let lockedLocker = null;
        let lockedGroupIndex = -1;

        for (const gIdx in manifestGroups) {
          const group = manifestGroups[gIdx];
          if (!group?.lockers) continue;
          const lockers = Array.isArray(group.lockers) ? group.lockers : Object.values(group.lockers);
          for (const locker of lockers as any[]) {
            if (locker?.isLockedForItemId && locker.status === 'CHECKEDOUT' &&
                locker.itemIds && locker.itemIds.includes(barcode)) {
              lockedLocker = locker;
              lockedGroupIndex = Number(gIdx);
              break;
            }
          }
          if (lockedLocker) break;
        }

        if (lockedLocker && lockedGroupIndex >= 0) {
          console.log('🔒 Item found in permanent locker with CHECKEDOUT status — routing to return flow', {
            barcode,
            doorNumber: lockedLocker.doorNumber,
            groupIndex: lockedGroupIndex,
            patronId: lockedLocker.patronId
          });

          const group = manifestGroups[lockedGroupIndex];

          // Check patronAllowedSizes — if zero, patron self-return is not allowed for this item type
          const configGroup = sessionDevice.value?.config?.locker?.groups?.[lockedGroupIndex];
          const patronAllowedSizes = group.patronAllowedSizes || configGroup?.patronAllowedSizes || [];
          if (patronAllowedSizes.length === 0) {
            console.warn('⛔ Item type not eligible for self-return:', group.name);
            updateSessionError({ message: t('ERROR.RETURN_TO_ITEMTYPE_NOT_ALLOWED', { itemType: group.name || '' }) });
            setLocation('/error');
            processingItemRef.current = false;
            return;
          }

          // Add to condition check queue so LoTReturn finds the right locker
          const returnItem = {
            itemId: barcode,
            groupName: group.name,
            doorNumber: lockedLocker.doorNumber,
            patronId: lockedLocker.patronId,
            timestamp: new Date().toISOString()
          };

          const queueStr = localStorage.getItem('conditionCheckQueue');
          const queue = queueStr ? JSON.parse(queueStr) : [];
          queue.push(returnItem);
          localStorage.setItem('conditionCheckQueue', JSON.stringify(queue));

          setShowLoginScreen(false);
          setLocation(`/lotreturn`);
          endUserMode();
          return;
        }
      }

      // If login started from double-click with manual item type/name, find matching group for return
      if (!libraryOfThingsGroup.value && (manualItemType || manualItemName)) {
        console.log('🔍 Item ID with manual item type/name - looking for matching group');
        console.log('🔍 Searching for - itemType:', manualItemType, ', itemName:', manualItemName);

        // Find group matching by name or itemTypeProperty
        let matchingGroup = null;
        let matchingGroupIndex = -1;

        if (sessionDevice.value.config.locker.groups) {
          sessionDevice.value.config.locker.groups.forEach((group: any, index: number) => {
            const groupNameUpper = group.name?.toUpperCase() || '';
            const groupItemTypePropertyUpper = group.itemTypeProperty?.toUpperCase() || '';
            const manualItemTypeUpper = manualItemType?.toUpperCase() || '';
            const manualItemNameUpper = manualItemName?.toUpperCase() || '';

            console.log(`🔍 Checking group ${index}:`, {
              name: group.name,
              itemTypeProperty: group.itemTypeProperty,
              matchesItemType: manualItemTypeUpper && groupItemTypePropertyUpper === manualItemTypeUpper,
              matchesName: manualItemNameUpper && groupNameUpper === manualItemNameUpper
            });

            // Match by itemTypeProperty OR group name matches item name
            if ((manualItemTypeUpper && groupItemTypePropertyUpper === manualItemTypeUpper) ||
                (manualItemNameUpper && groupNameUpper === manualItemNameUpper)) {
              matchingGroup = group;
              matchingGroupIndex = index;
              console.log('✅ Found match at index:', index);
            }
          });
        }

        if (matchingGroup) {
          console.log('✅ Found matching group for return:', matchingGroup.name);

          // Set the group and process as return
          setLibraryOfThingsGroup({ name: matchingGroup.name, groupIndex: matchingGroupIndex });

          // Add item to condition check queue for return processing
          // Format expected by LoTReturn: groupName is used to find the target group
          const returnItem = {
            itemId: barcode,
            groupName: matchingGroup.name,  // Must match group name for LoTReturn to find it
            doorNumber: 0,
            patronId: 'All',  // Available for any patron to pick up
            itemType: manualItemType || matchingGroup.name,
            itemName: manualItemName || barcode,
            timestamp: new Date().toISOString(),
            conditionCheck: true  // Mark as condition check so it stays until staff processes
          };

          const queueStr = localStorage.getItem('conditionCheckQueue');
          const queue = queueStr ? JSON.parse(queueStr) : [];
          queue.push(returnItem);
          localStorage.setItem('conditionCheckQueue', JSON.stringify(queue));

          console.log('➕ Added manual return item to queue:', returnItem);

          // Clear manual fields
          setManualItemType('');
          setManualItemName('');
          setShowLoginScreen(false);
          setLocation(`/lotreturn`);
          return;
        } else {
          console.log('⚠️ No matching group found for item type:', manualItemType);
        }
      }

      // Check if barcode exists in device manifest groups
      let foundInManifest = false;
      let foundGroup = null;
      let foundLocker = null;

      if (sessionDevice.value.config.locker.groups) {
        for (let group of sessionDevice.value.config.locker.groups) {
          const locker = _.find(group.lockers, (l) => {
            return l && l.itemIds && l.itemIds.includes(barcode);
          });
          if (locker) {
            foundInManifest = true;
            foundGroup = group;
            foundLocker = locker;
            break;
          }
        }
      }

      if (getHotListItemIds().length > 0 && getHotListItemIds().find((item:any) => item?.itemId?.includes(barcode))) {
        const hotListItem = getHotListItemIds().find((item:any) => item?.itemId?.includes(barcode));
        if (hotListItem) {
          // Add item to condition check queue
          const queueStr = localStorage.getItem('conditionCheckQueue');
          const queue = queueStr ? JSON.parse(queueStr) : [];
          queue.push(hotListItem);
          localStorage.setItem('conditionCheckQueue', JSON.stringify(queue));

          console.log('➕ HomeLoT - Added item to condition check queue:', {
            addedItem: hotListItem,
            queueLength: queue.length,
            fullQueue: queue
          });

          // Keep item in hotlist - will be removed after successful return in LoTReturn
          console.log('🔥 HomeLoT - Item stays in hotlist until return is completed');

          setLocation(`/lotreturn`);
        }
        endUserMode();
        return;
      }

      if (foundInManifest) {
        // Item found in manifest - show duplicate warning dialog
        console.log('🔍 Item already in locker, showing duplicate warning dialog');

        // Find the door number for the found locker
        let doorNumber = null;
        if (sessionDevice.value.config.locker.groups) {
          for (let groupIndex = 0; groupIndex < sessionDevice.value.config.locker.groups.length; groupIndex++) {
            const group = sessionDevice.value.config.locker.groups[groupIndex];
            if (!group.lockers) continue;
            const lockerEntries = Array.isArray(group.lockers) ? group.lockers.entries() : Object.entries(group.lockers);
            for (const [key, locker] of lockerEntries) {
              if ((locker as any).itemIds && (locker as any).itemIds.includes(barcode)) {
                doorNumber = (locker as any).doorNumber || +key;
                break;
              }
            }
            if (doorNumber !== null) break;
          }
        }

        setDuplicateItemInfo({
          itemId: barcode,
          doorNumber: doorNumber || 0,
          patronId: foundLocker?.patronId || 'Unknown'
        });
        setShowDuplicateItemWarning(true);
        setLoading(true); // Keep spinner showing while duplicate warning is displayed
        setShowLoginScreen(false); // Hide login dialog
        updateSessionStaffModeOn(false); // Exit staff mode
      } else {
        // Show dialog to add new item
        const AddItemWizard = () => {
          const [patronType, setPatronType] = useState<'all' | 'custom'>('all');
          const [wizardPatronId, setWizardPatronId] = useState('All');
          const [selectedGroupIndex, setSelectedGroupIndex] = useState<number | null>(null);
          const [selectedSize, setSelectedSize] = useState<string>('');
          const [selectedDoorNumber, setSelectedDoorNumber] = useState<string>('');
          const [allDoorSizes, setAllDoorSizes] = useState<any[]>([]);
          const [availableDoorSizes, setAvailableDoorSizes] = useState<any[]>([]);
          const [physicalDoors, setPhysicalDoors] = useState<any>(null);
          const [ilsAutoMatchedGroupIndex, setIlsAutoMatchedGroupIndex] = useState<number | null>(null);

          // Auto-match group based on ILS title vs group itemTypeProperty
          useEffect(() => {
            if (lastILSItemLookup?.title && sessionDevice.value?.config?.locker?.groups) {
              const titleLower = lastILSItemLookup.title.toLowerCase();
              const groups = sessionDevice.value.config.locker.groups;
              for (let i = 0; i < groups.length; i++) {
                const group = groups[i];
                if (group.itemTypeProperty && titleLower.includes(group.itemTypeProperty.toLowerCase())) {
                  setSelectedGroupIndex(i);
                  setIlsAutoMatchedGroupIndex(i);
                  console.log('🎯 ILS auto-matched group:', group.name, 'index:', i);
                  return;
                }
              }
            }
            setIlsAutoMatchedGroupIndex(null);
          }, []);

          // Helper function to get the size of a locker from physical doors (normalized to lowercase)
          const getLockerSize = (locker: any): string | null => {
            if (!physicalDoors) return null;
            const lockerId = locker.doorNumber || locker.id;
            if (!lockerId) return null;
            const physicalDoor = physicalDoors[String(lockerId)];
            const size = physicalDoor?.size;
            return size ? String(size).toLowerCase() : null; // Normalize to lowercase
          };

          // Helper function to find an available door for a given size
          const findAvailableDoorForSize = (size: string): string | null => {
            if (!physicalDoors || !size) return null;

            // Get list of OCCUPIED door IDs (doors that actually have items)
            const usedDoorIds = new Set();
            sessionDevice.value.config.locker.groups.forEach(group => {
              if (!group.lockers) return;

              // Handle both array and object formats
              const lockersList = Array.isArray(group.lockers)
                ? group.lockers
                : Object.values(group.lockers);

              lockersList.forEach((locker: any) => {
                if (!locker) return;

                // Simple occupancy check - only care if door has items
                const hasItems = (locker.itemIds && locker.itemIds.length > 0) ||
                                (locker.itemId && locker.itemId.length > 0);

                // Door is occupied ONLY if it has items
                if (hasItems) {
                  const lockerId = locker.doorNumber || locker.id;
                  if (lockerId) {
                    usedDoorIds.add(String(lockerId));
                  }
                }
              });
            });

            // Find first unused door with matching size
            for (const [doorId, doorData] of Object.entries(physicalDoors)) {
              const doorSize = String((doorData as any).size || '').toLowerCase();
              const doorNumber = (doorData as any).doorNumber; // Physical doors use doorNumber
              const selectedSizeNormalized = String(size).toLowerCase();

              console.log(`    🚪 Checking physical door [${doorId}]:`, {
                doorNumber,
                size: doorSize,
                isOccupied: usedDoorIds.has(String(doorNumber)),
                sizeMatches: doorSize === selectedSizeNormalized
              });

              // Bind doors: only allow master (odd) doors with bindWithDoor
              if (selectedSizeNormalized === 'bind') {
                const bindWith = (doorData as any).bindWithDoor;
                if (bindWith != null && doorNumber % 2 !== 0 &&
                    !usedDoorIds.has(String(doorNumber)) &&
                    !usedDoorIds.has(String(bindWith))) {
                  console.log('✅ findAvailableDoorForSize selected bind door:', { doorId, doorNumber, bindWith });
                  return String(doorNumber);
                }
                continue;
              }

              if (!usedDoorIds.has(String(doorNumber)) && doorSize === selectedSizeNormalized) {
                console.log('✅ findAvailableDoorForSize selected door:', {
                  doorId,
                  doorNumber,
                  size: doorSize,
                  returning: String(doorNumber)
                });
                return String(doorNumber);
              }
            }

            console.log('❌ findAvailableDoorForSize: No available door found for size:', size);
            return null;
          };

          // Load all physical doors from Firebase and find available ones
          useEffect(() => {
            const loadAvailableDoors = async () => {
              console.log('🔧 Loading physical doors...');
              try {
                const licenseId = sessionLicenseId.value;
                const deviceKey = kioskConfig.value?.device?.id;
                const databaseUrl = sessionDatabaseUrl.value;

                if (!licenseId || !deviceKey || !databaseUrl) {
                  console.warn('⚠️  Cannot load doors: missing required values');
                  return;
                }

                // Get Firebase auth token
                const auth = getFirebaseAuth();
                const currentUser = auth.currentUser;
                if (!currentUser) {
                  console.error('❌ Not authenticated with Firebase');
                  return;
                }

                const authToken = await currentUser.getIdToken();
                const path = `license_${licenseId}/devices/${deviceKey}/thedoors`;
                const url = `${databaseUrl}/${path}.json?auth=${authToken}`;

                console.log('🚪 Loading all physical doors from:', url);
                const response = await fetch(url);
                if (response.ok) {
                  const allDoors: any = await response.json();
                  if (allDoors) {
                    console.log('✅ All physical doors loaded:', allDoors);

                    // Log the structure of the first door to understand the data
                    if (Object.keys(allDoors).length > 0) {
                      const firstDoorKey = Object.keys(allDoors)[0];
                      const firstDoor = allDoors[firstDoorKey];
                      console.log('🔍 Sample door structure:', {
                        key: firstDoorKey,
                        doorData: firstDoor,
                        hasDoorNumber: 'doorNumber' in firstDoor,
                        doorNumber: firstDoor.doorNumber
                      });
                    }

                    // Store physical doors for later use
                    setPhysicalDoors(allDoors);

                    // Get list of door IDs that are already assigned to lockers in manifest
                    const usedDoorNumbers = new Set();
                    sessionDevice.value.config.locker.groups.forEach(group => {
                      if (!group.lockers) return;

                      // Handle both array and object formats
                      const lockersList = Array.isArray(group.lockers)
                        ? group.lockers
                        : Object.values(group.lockers);

                      lockersList.forEach((locker: any) => {
                        if (!locker) return;

                        // Only mark as used if locker has items
                        const hasItems = (locker.itemIds && locker.itemIds.length > 0) ||
                                        (locker.itemId && locker.itemId.length > 0);

                        if (hasItems) {
                          const doorNumber = locker.doorNumber || locker.id;
                          if (doorNumber) {
                            usedDoorNumbers.add(String(doorNumber));
                          }
                        }
                      });
                    });

                    console.log('🔒 Door numbers already used in manifest:', Array.from(usedDoorNumbers));

                    // Find unused (available) doors
                    const availableDoors = [];
                    Object.entries(allDoors).forEach(([index, doorData]: [string, any]) => {
                      const doorNumber = String(doorData.doorNumber); // Physical doors use doorNumber
                      if (!usedDoorNumbers.has(doorNumber)) {
                        availableDoors.push(doorData);
                        console.log(`🆓 Available door ${doorNumber}:`, doorData);
                      }
                    });


                    // Extract unique sizes from available doors (normalize to lowercase to avoid duplicates)
                    const availableSizes = new Set();
                    availableDoors.forEach(doorData => {
                      if (doorData.size) {
                        // Normalize to lowercase to prevent duplicates like "small" and "SMALL"
                        availableSizes.add(String(doorData.size).toLowerCase());
                      }
                    });

                    console.log('📏 Available sizes from unused doors:', Array.from(availableSizes));

                    // Display labels for custom sizes
                    const customSizeLabels: { [key: string]: string } = {
                      'custom1': 'Small x 2.5',
                      'custom2': 'Small x 3',
                      'custom3': 'Small x 5',
                    };

                    // Create size objects with proper capitalization
                    const sizes = Array.from(availableSizes).map(size => ({
                      name: String(size).toLowerCase(), // Store normalized lowercase
                      label: customSizeLabels[String(size).toLowerCase()] || (String(size).charAt(0).toUpperCase() + String(size).slice(1).toLowerCase()) // Custom label or "Small", "Medium", etc.
                    }));

                    console.log('✅ Final available door sizes:', sizes);
                    setAllDoorSizes(sizes);
                  }
                } else {
                  console.error('❌ Failed to load doors:', response.status);
                }
              } catch (error) {
                console.error('❌ Error loading doors:', error);
              }
            };

            loadAvailableDoors();
          }, [selectedGroupIndex]);

          // Log lockers in selected group
          useEffect(() => {
            const selectedGroup = sessionDevice.value.config.locker.groups[selectedGroupIndex];
            if (selectedGroup && selectedGroup.lockers) {
              console.log('===== Selected Group Lockers =====');
              console.log('Group:', selectedGroup.name, 'Index:', selectedGroupIndex);

              // Handle both array and object formats
              const lockersList = Array.isArray(selectedGroup.lockers)
                ? selectedGroup.lockers
                : Object.values(selectedGroup.lockers);

              lockersList.forEach((locker: any, idx: number) => {
                console.log(`Locker ${idx}:`, {
                  id: locker.id || locker.number || locker.name,
                  doorNumber: locker.doorNumber,
                  size: locker.size,
                  sizeType: typeof locker.size,
                  isEmpty: !locker.itemIds || locker.itemIds.length === 0,
                  patronId: locker.patronId,
                  itemIds: locker.itemIds
                });
              });
              console.log('==================================');
            }
          }, [selectedGroupIndex]);

          // Set available door sizes (filtered by unused doors AND group's staffAllowedSizes)
          useEffect(() => {
            console.log('🔄 Setting availableDoorSizes from allDoorSizes:', allDoorSizes);

            // Only process if a group is selected
            if (selectedGroupIndex === null) {
              setAvailableDoorSizes([]);
              return;
            }

            // Get the selected group's allowed sizes
            const selectedGroup = sessionDevice.value.config.locker.groups[selectedGroupIndex];
            const staffAllowedSizes = selectedGroup?.staffAllowedSizes;
            const staffAllowBindDoors = selectedGroup?.staffAllowBindDoors || false;

            let filteredSizes = allDoorSizes;

            // If the group has staffAllowedSizes defined, filter by those
            if (staffAllowedSizes && Array.isArray(staffAllowedSizes) && staffAllowedSizes.length > 0) {
              console.log('🔒 Group has staffAllowedSizes:', staffAllowedSizes);

              filteredSizes = allDoorSizes.filter(sizeObj => {
                const sizeName = String(sizeObj.name).toLowerCase(); // Normalize to lowercase
                const isAllowed = staffAllowedSizes.some(allowedSize =>
                  String(allowedSize).toLowerCase() === sizeName // Normalize to lowercase for comparison
                );
                console.log(`  Door size ${sizeName} allowed: ${isAllowed}`);
                return isAllowed;
              });

              console.log('✅ Filtered door sizes based on group allowance:', filteredSizes);
            } else if (staffAllowBindDoors) {
              // If only bind doors is enabled (no regular sizes), show empty regular sizes
              filteredSizes = [];
            } else {
              console.log('ℹ️  Group has no staffAllowedSizes restriction, showing all available sizes');
            }

            // Add bind doors as a virtual size option if staffAllowBindDoors is enabled
            if (staffAllowBindDoors) {
              filteredSizes = [...filteredSizes, { name: 'bind', label: 'Bind Doors' }];
              console.log('🔗 Added Bind Doors virtual size option');
            }

            setAvailableDoorSizes(filteredSizes);

            // Clear selected size if it's no longer available
            if (selectedSize) {
              const sizeStillAvailable = filteredSizes.some(s => String(s.name) === String(selectedSize));
              if (!sizeStillAvailable) {
                console.log('⚠️ Clearing selected size because it is no longer available');
                setSelectedSize('');
              }
            }
          }, [allDoorSizes, selectedGroupIndex]);

          // Debug log available door sizes
          useEffect(() => {
            console.log('📋 availableDoorSizes state updated:', availableDoorSizes);
          }, [availableDoorSizes]);

          // Auto-select smallest available locker when group is selected
          useEffect(() => {
            if (availableDoorSizes.length > 0) {
              // Define size order from smallest to largest
              const sizeOrder = ['small', 'medium', 'large', 'xlarge', 'xxl'];

              // Find the smallest available size
              let smallestSize = null;
              for (const sizeName of sizeOrder) {
                const found = availableDoorSizes.find(s =>
                  String(s.name).toLowerCase() === sizeName.toLowerCase()
                );
                if (found) {
                  smallestSize = found.name;
                  break;
                }
              }

              // If no size matches the predefined order, just take the first one
              if (!smallestSize && availableDoorSizes.length > 0) {
                smallestSize = availableDoorSizes[0].name;
              }

              if (smallestSize) {
                console.log('🔽 Auto-selecting smallest available locker size:', smallestSize);
                setSelectedSize(smallestSize);
                // Also set the door number for the auto-selected size
                const doorNumber = findAvailableDoorForSize(smallestSize);
                setSelectedDoorNumber(doorNumber || '');
                console.log('🚪 Auto-selected door number:', doorNumber);
              }
            }
          }, [selectedGroupIndex, availableDoorSizes]);

          return (
            <div style={{
              height: 'calc(100vh - 55px)',
              width: '100%',
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: '#f5f5f5',
              overflow: 'hidden'
            }}>
              {/* Row 1: Header with info and cancel */}
              <div style={{
                padding: '16px 30px',
                backgroundColor: SEBlue.value,
                color: 'white',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexShrink: 0
              }}>
                <span style={{ fontSize: '28px', fontWeight: 'bold' }}>Add New Item to Locker</span>
                <Button
                  size='large'
                  type="default"
                  onClick={() => {
                    setModalOpen(false);
                    setModalConfig(null);
                    processingItemRef.current = false;
                  }}
                  style={{
                    padding: '20px 40px',
                    color: '#42A4DE',
                    fontSize: '24px',
                    fontWeight: 'bold',
                    height: 'auto'
                  }}
                >
                  Cancel
                </Button>
              </div>

              <div style={{ flex: 1, padding: '15px 30px', overflowY: 'auto', overflowX: 'hidden' }}>
                {/* Row 2: Item ID - pill style */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '30px'
                }}>
                  <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    backgroundColor: 'white',
                    borderRadius: '50px',
                    padding: '18px 40px',
                    border: `3px solid ${SEBlue.value}`,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                    maxWidth: '90%'
                  }}>
                    <span style={{ fontSize: '32px', fontWeight: 'bold', color: SEBlue.value, flexShrink: 0 }}>{barcode}</span>
                    {lastILSItemLookup?.title && (
                      <span style={{
                        fontSize: lastILSItemLookup.title.length > 40 ? '22px' : lastILSItemLookup.title.length > 25 ? '26px' : '32px',
                        fontWeight: 'bold',
                        color: SEBlue.value,
                        marginLeft: '16px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>{lastILSItemLookup.title}</span>
                    )}
                  </div>
                </div>

                {/* Row 3: Patron info */}
                {/* Row 4: Select Group */}
                <div style={{ marginBottom: '30px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: sessionDevice.value?.settings?.screenOrientation?.toLowerCase() === 'landscape' ? 'repeat(6, 1fr)' : 'repeat(5, 1fr)', gap: '15px', justifyItems: 'center' }}>
                    {sessionDevice.value.config.locker.groups.map((group, index) => {
                      const finalPatronId = patronType === 'all' ? 'All' : wizardPatronId;

                      const lockersList = group.lockers
                        ? (Array.isArray(group.lockers) ? group.lockers : Object.values(group.lockers))
                        : [];

                      const hasAvailableLocker = lockersList.some((locker) => {
                        const isEmpty = !locker.itemIds || locker.itemIds.length === 0;
                        const hasPatron = locker.patronId === finalPatronId;
                        const lockerSize = getLockerSize(locker);
                        const sizeMatches = !selectedSize || String(lockerSize) === String(selectedSize);

                        if (index === selectedGroupIndex) {
                          console.log('Group check - locker:', {
                            groupIndex: index,
                            lockerId: locker.id || locker.number || locker.name,
                            lockerSize,
                            lockerSizeType: typeof lockerSize,
                            selectedSize,
                            selectedSizeType: typeof selectedSize,
                            sizeMatches,
                            isEmpty
                          });
                        }

                        if (patronType === 'all' || finalPatronId === 'All') {
                          return isEmpty && sizeMatches;
                        } else {
                          return (hasPatron || isEmpty) && sizeMatches;
                        }
                      });

                      const isLandscapeWizard = sessionDevice.value?.settings?.screenOrientation?.toLowerCase() === 'landscape';
                      const gridPositions = [2, 3, 4, 2, 3, 4, 2, 3, 4];
                      const portraitGridCol = gridPositions[index % 9] || 2;
                      const portraitGridRow = Math.floor(index / 3) + 1;

                      const isIlsLocked = ilsAutoMatchedGroupIndex !== null && ilsAutoMatchedGroupIndex !== index;

                      return (
                        <Card
                          key={index}
                          hoverable={!isIlsLocked}
                          onClick={() => !isIlsLocked && setSelectedGroupIndex(index)}
                          style={{
                            width: isLandscapeWizard ? 'auto' : '240px',
                            border: selectedGroupIndex === index ? '3px solid #1890ff' : isIlsLocked ? '2px solid #e5e7eb' : '2px solid #d9d9d9',
                            backgroundColor: selectedGroupIndex === index ? '#e6f7ff' : isIlsLocked ? '#f3f4f6' : 'white',
                            cursor: isIlsLocked ? 'not-allowed' : 'pointer',
                            opacity: isIlsLocked ? 0.5 : (hasAvailableLocker ? 1 : 0.5),
                            ...(isLandscapeWizard ? {} : { gridColumn: portraitGridCol, gridRow: portraitGridRow })
                          }}
                        >
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '10px' }}>
                              {group.name}
                            </div>
                            {group.image && (
                              <img
                                src={getImage(group.image, group.name)}
                                alt={group.name}
                                style={{ width: '100%', height: '120px', objectFit: 'cover', borderRadius: '4px', opacity: 1 }}
                              />
                            )}
                            <div style={{ marginTop: '10px' }}>
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                </div>

                {/* Row 5: Select Door Size */}
                {availableDoorSizes.length > 0 && (
                  <div style={{ marginBottom: '30px' }}>
                    <label style={{ fontSize: '28px', fontWeight: 'bold', marginBottom: '25px', display: 'block', textAlign: 'center', color: SEBlue.value }}>
                      Select Door Size:
                    </label>
                    <div style={{ display: 'flex', gap: '15px', justifyContent: 'center' }}>
                      {availableDoorSizes.map((sizeObj) => {
                        const sizeName = sizeObj.name || sizeObj;
                        const sizeLabel = sizeObj.label || sizeName;
                        const doorNumber = findAvailableDoorForSize(sizeName);

                        return (
                          <Card
                            key={sizeName}
                            hoverable
                            onClick={() => {
                              console.log('Selected door size:', sizeName, 'Type:', typeof sizeName);
                              setSelectedSize(sizeName);
                              setSelectedDoorNumber(doorNumber || '');
                            }}
                            style={{
                              flex: '1',
                              maxWidth: '200px',
                              border: selectedSize === sizeName ? '3px solid #1890ff' : '2px solid #d9d9d9',
                              backgroundColor: selectedSize === sizeName ? '#e6f7ff' : 'white',
                              cursor: 'pointer'
                            }}
                          >
                            <div style={{ textAlign: 'center', padding: '15px 10px' }}>
                              <div style={{ fontSize: '20px', fontWeight: 'bold', textTransform: 'capitalize' }}>
                                {sizeLabel}
                              </div>
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  </div>
                )}

              </div>

              {/* Fixed bottom: Add item > Door button */}
              <div style={{
                padding: '15px 30px',
                flexShrink: 0,
                backgroundColor: '#f5f5f5',
                borderTop: '1px solid #e0e0e0'
              }}>
                <Card
                  hoverable={!!(selectedSize && selectedDoorNumber && selectedGroupIndex !== null)}
                  onClick={async () => {
                    if (!selectedSize || !selectedDoorNumber || selectedGroupIndex === null) {
                      return;
                    }

                    // Check if item is already in a locker before proceeding
                    const isDuplicate = await isItemIdAlradyInLocker(barcode);
                    if (isDuplicate) {
                      return;
                    }

                    const selectedGroup = sessionDevice.value.config.locker.groups[selectedGroupIndex];
                    const finalPatronId = patronType === 'all' ? 'All' : wizardPatronId;

                    if (!finalPatronId || (patronType === 'custom' && !wizardPatronId.trim())) {
                      customToast(() => 'Please enter a Patron ID', 3000, 'error', 'dark');
                      return;
                    }

                    // Find an available door with the selected size
                    let availableDoor = null;
                    if (physicalDoors) {
                      const usedDoorIds = new Set();
                      sessionDevice.value.config.locker.groups.forEach(group => {
                        if (!group.lockers) return;
                        const lockersList = Array.isArray(group.lockers) ? group.lockers : Object.values(group.lockers);
                        lockersList.forEach((locker: any) => {
                          if (!locker) return;
                          const hasItems = (locker.itemIds && locker.itemIds.length > 0) || (locker.itemId && locker.itemId.length > 0);
                          if (hasItems) {
                            const lockerId = locker.doorNumber || locker.id;
                            if (lockerId) usedDoorIds.add(String(lockerId));
                          }
                        });
                      });

                      for (const [doorId, doorData] of Object.entries(physicalDoors)) {
                        const doorSize = String((doorData as any).size || '').toLowerCase();
                        const selectedSizeNormalized = String(selectedSize).toLowerCase();
                        const doorNumber = (doorData as any).doorNumber;

                        // Bind doors: only allow master (odd) doors with bindWithDoor
                        if (selectedSizeNormalized === 'bind') {
                          const bindWith = (doorData as any).bindWithDoor;
                          if (bindWith != null && doorNumber % 2 !== 0 &&
                              !usedDoorIds.has(String(doorNumber)) &&
                              !usedDoorIds.has(String(bindWith))) {
                            availableDoor = { ...(doorData as object) };
                            break;
                          }
                          continue;
                        }

                        if (!usedDoorIds.has(String(doorNumber)) && doorSize === selectedSizeNormalized) {
                          availableDoor = { ...(doorData as object) };
                          break;
                        }
                      }
                    }

                    if (!availableDoor) {
                      customToast(() => 'No available door with the selected size', 3000, 'error', 'dark');
                      return;
                    }

                    console.log('✅ Selected door for new item:', availableDoor);

                    const finalPatronIdVal = patronType === 'all' ? 'All' : wizardPatronId;
                    console.log(`📦 LoT Wizard: Creating NEW locker at door #${availableDoor.doorNumber} for patron "${finalPatronIdVal}", item "${barcode}"`);
                    const actualDoorNumber = availableDoor.doorNumber;
                    const newLocker: any = {
                      doorNumber: actualDoorNumber,
                      itemIds: [barcode],
                      patronId: finalPatronIdVal,
                      size: availableDoor.size,
                      timestamp: Date.now(),
                      enabled: true,
                      available: false,
                      empty: false,
                      conditionCheck: false
                    };

                    if (sessionDevice.value?.settings?.enforceReturnCheck && !selectedGroup.ignoreEnforceReturnCheck) {
                      newLocker.enforceReturnCheck = true;
                    }

                    console.log('📝 Creating new locker entry:', {
                      doorNumber: newLocker.doorNumber,
                      itemIds: newLocker.itemIds,
                      patronId: newLocker.patronId,
                      size: newLocker.size,
                      availableDoorData: availableDoor
                    });

                    // Add to selected group
                    if (!selectedGroup.lockers) {
                      selectedGroup.lockers = [];
                    }
                    selectedGroup.lockers.push(newLocker);

                    // Persist changes
                    await persistDeviceManifestChanges(sessionDevice.value.manifest);

                    // Open the door using integrations
                    const cachedIntegrations = localStorage.getItem('integrations');
                    let integrations: any[] = [];
                    if (cachedIntegrations) {
                      try {
                        const integrationsObj = JSON.parse(cachedIntegrations);
                        integrations = Array.isArray(integrationsObj) ? integrationsObj : Object.values(integrationsObj);
                      } catch (error) {
                        console.error('Error parsing integrations:', error);
                      }
                    }

                    // Find bound slave door
                    const thedoorsHomeLot = sessionDevice.value?.thedoors;
                    const homeLotDoorData = thedoorsHomeLot && Array.isArray(thedoorsHomeLot)
                      ? thedoorsHomeLot.find((d: any) => d.doorNumber === newLocker.doorNumber)
                      : null;
                    const boundSlaveHomeLot = homeLotDoorData?.bindWithDoor != null ? Number(homeLotDoorData.bindWithDoor) : null;
                    const isPusatecHomeLot = sessionDevice.value?.settings?.hwIntegrations?.pusatecEnabled;

                    if (integrations.length > 0) {
                      const integration = integrations[0];
                      const mac = integration.macId || integration.mac;
                      const ip = integration.ip;
                      console.log(`🚪 Opening door ${newLocker.doorNumber} using integration MAC: ${mac}, IP: ${ip}`);
                      try {
                        const electron = (window as any).electron;
                        await electron.sideeventNative.openLockerDoor(newLocker.doorNumber, mac, ip);
                        if (boundSlaveHomeLot != null) {
                          await new Promise(r => setTimeout(r, isPusatecHomeLot ? 200 : 1200));
                          console.log(`🚪 Opening bound door ${boundSlaveHomeLot}`);
                          await electron.sideeventNative.openLockerDoor(boundSlaveHomeLot, mac, ip);
                        }
                        testDoorAfterOpen(mac, newLocker.doorNumber);
                      } catch (error) {
                        console.error(`Error opening door ${newLocker.doorNumber}:`, error);
                      }
                    } else {
                      openDoor(sessionDevice.value.settings.macid, newLocker.doorNumber);
                      testDoorAfterOpen(sessionDevice.value.settings.macid, newLocker.doorNumber);
                    }

                    // Create add_item transaction
                    try {
                      await createAddItemEvent({
                        itemIds: [barcode],
                        patronId: finalPatronIdVal,
                        doorNumber: newLocker.doorNumber,
                        groupName: selectedGroup?.name || '',
                        success: true
                      });
                    } catch (txErr) {
                      console.error('❌ Failed to create add_item transaction:', txErr);
                    }

                    // Track new patron usage (fire-and-forget)
                    if (finalPatronIdVal && finalPatronIdVal !== 'All') {
                      const pKey = localStorage.getItem('patronKey');
                      const lid = sessionLicenseId.value;
                      const did = sessionDevice.value?.id || kioskConfig.value?.deviceId || '';
                      if (pKey && lid && did) {
                        trackNewPatronUsage(lid, pKey, did, finalPatronIdVal, [barcode], newLocker.doorNumber, selectedGroup?.name);
                      }
                    }

                    // ILS Checkin — check in the item after adding to locker
                    try {
                      const checkinResult = await workflowILSCheckin(barcode);
                      console.log(`📦 ILS checkin result for ${barcode}:`, checkinResult);

                      // Create checkin transaction
                      try {
                        await createCheckinTransaction({
                          itemIds: [barcode],
                          patronId: finalPatronIdVal,
                          doorNumber: newLocker.doorNumber,
                          groupName: selectedGroup?.name || '',
                          success: checkinResult?.success === true,
                          metadata: {
                            title: checkinResult?.title || null,
                            itemStatusId: checkinResult?.itemStatusId || null,
                            ilsType: sessionBranch.value?.polarisSettings?.enabled ? 'polaris' : sessionBranch.value?.sip2Settings?.enabled ? 'sip2' : 'unknown',
                          }
                        });
                      } catch (txErr: any) {
                        console.error('❌ Failed to create checkin transaction:', txErr);
                      }
                    } catch (checkinErr: any) {
                      console.error(`❌ ILS checkin failed for ${barcode}:`, checkinErr);
                    }

                    customToast(() => `Item added to door ${newLocker.doorNumber} successfully`, 3000, 'success', 'dark');
                    endUserMode();
                    setModalOpen(false);
                    setModalConfig(null);
                    processingItemRef.current = false;
                  }}
                  style={{
                    width: '100%',
                    minHeight: '100px',
                    backgroundColor: selectedSize && selectedDoorNumber && selectedGroupIndex !== null ? '#52c41a' : '#d9d9d9',
                    borderColor: selectedSize && selectedDoorNumber && selectedGroupIndex !== null ? '#52c41a' : '#d9d9d9',
                    cursor: selectedSize && selectedDoorNumber && selectedGroupIndex !== null ? 'pointer' : 'not-allowed',
                    opacity: selectedSize && selectedDoorNumber && selectedGroupIndex !== null ? 1 : 0.6,
                    transition: 'all 0.3s ease'
                  }}
                  bodyStyle={{
                    padding: '30px',
                    textAlign: 'center'
                  }}
                >
                  <div style={{
                    fontSize: '28px',
                    fontWeight: 'bold',
                    color: 'white',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '12px'
                  }}>
                    {selectedDoorNumber && selectedGroupIndex !== null ? (
                      <>
                        <span>Add item</span>
                        <RightSquareOutlined style={{ fontSize: '32px' }} />
                        <span>Door {selectedDoorNumber}</span>
                      </>
                    ) : (
                      'Select group and door size'
                    )}
                  </div>
                </Card>
              </div>
            </div>
          );
        };

        const dialogConfig = {
          title: ' ',
          fullScreen: true,
          content: <AddItemWizard />
        };

        setModalConfig(dialogConfig);
        setModalOpen(true);
        setShowLoginScreen(false); // Hide login dialog when wizard opens
        updateSessionStaffModeOn(false); // Exit staff mode
      }

    } else if (classification === 'patron') {
      if (sessionDevice.value.settings?.password) {
        processLoginUser(barcode, password)
      } else {
        processLoginUser(barcode, '')

      }
    }
    setLoading(false)

  }

  const onChangeUsername = (input: string) => {
    setUsername(input);
    countTimerRef.current = 30; // Reset timer on keyboard input
  };
  const onChangePassword = (input: string) => {
    setPassword(input);
    countTimerRef.current = 30; // Reset timer on keyboard input
  };
  const onKeyPress = (button: any) => {
    console.log("Button pressed", button);
    countTimerRef.current = 30; // Reset timer on key press

    // Ignore empty button clicks
    if (button.startsWith("{empty")) return;

    /**
     * If you want to handle the shift and caps lock buttons
     */
    if (button === "{shift}" || button === "{lock}") handleShift();
    if (button === "{special}") setLayout("special");
    if (button === "{abc}") setLayout("default");
  };
  const onChangeUsernameInput = (event: any) => {
    countTimerRef.current = 30; // Reset timer on input change
    const input = event.target.value;
    setUsername(input);
    if (keyboard.current) {
      keyboard.current.setInput(input);
    }
    Promise.delay(100).then(() => userRef.current?.focus())

  };
  const onChangePassworkInput = (event: any) => {
    countTimerRef.current = 30; // Reset timer on input change
    const input = event.target.value;
    setPassword(input);
    if (keyboard.current) {
      keyboard.current.setInput(input);
    }
    Promise.delay(100).then(() => passRef.current?.focus())
  };
  const handleShift = () => {
    const newLayoutName = layout === "default" ? "shift" : "default";
    setLayout(newLayoutName);
    if (focusOnUsername) {
      Promise.delay(50).then(() => userRef.current?.focus())
    } else {
      Promise.delay(50).then(() => passRef.current?.focus())
    }

  };
  const onDoubleClickHandler = () => {
    // Show admin login modal with PIN enforcement (like HomeHold.tsx)
    setShowLoginAdminModal(true);
  };

  const scannerSimulation = () => {
    setShowLoginScreen(true)
    setLoginKeyboardVisible(true)
    setLibraryOfThingsGroup(null)
  };

  const isLandscapeLogin = sessionDevice.value?.settings?.screenOrientation?.toLowerCase() === 'landscape';
  const stylelogin: React.CSSProperties = {
    zIndex: 1,
    opacity: '0.9',
    position: 'absolute',
    top: '50px',
    left: '50px',
    right: '50px',
    width: 'auto',
    marginLeft: 0,
    marginRight: 0,
    ...(isLandscapeLogin && loginKeyboardVisible
      ? { bottom: '390px', overflow: 'auto' }
      : { height: '60%' })
  };
  const style2: React.CSSProperties = { zIndex: 1, };
  const stylePage: React.CSSProperties = {
      overflow: 'auto',
      height: '100%'
  };
  const [color] = useState('#ffffff');

  const lang = sessionLang.value;



  const changeLanguage = async (langKey: string) => {
    console.log('🌐 HomeLoT: Changing language to:', langKey);

    // Change i18n language
    await i18n.changeLanguage(langKey);

    // Save language to localStorage and shared state
    updateLang(langKey);
    localStorage.setItem('sessionLang', langKey);

    // Update local state to force re-render
    setCurrentLang(langKey);
  };

  async function isItemIdAlradyInLocker(testedItemId:string) {
    console.log('🔍 Checking if item already in locker:', {
      testedItemId,
      type: typeof testedItemId,
      value: testedItemId
    });

    // Log the entire device data structure for debugging
    console.log('📊 Full sessionDevice.value.config.locker.groups:', JSON.stringify(sessionDevice.value.config.locker.groups, null, 2));

    if (sessionDevice.value.config.locker.groups) {
        for (let groupIndex = 0; groupIndex < sessionDevice.value.config.locker.groups.length; groupIndex++) {
            const group = sessionDevice.value.config.locker.groups[groupIndex];
            console.log(`  📦 Checking group ${groupIndex}:`, group?.name);
            console.log(`  📦 Group ${groupIndex} lockers:`, JSON.stringify(group.lockers, null, 2));

            if (!group.lockers) {
              console.log(`    ⚠️  Group ${groupIndex} has no lockers`);
              continue;
            }

            // Check both itemId (string) and itemIds (array) formats
            const key = _.findKey(group.lockers, (a, lockerKey) => {
              // Skip if locker is undefined, null, or not an object
              if (!a || typeof a !== 'object') {
                console.log(`    ⚠️  Locker ${lockerKey} is null/undefined/invalid:`, a);
                return false;
              }

              console.log(`    🔍 Checking locker ${lockerKey}:`, {
                lockerObject: a,
                hasItemIds: !!a.itemIds,
                hasItemId: !!a.itemId,
                itemIds: a.itemIds,
                itemId: a.itemId,
                isEmpty: !a.itemIds && !a.itemId
              });

              // Skip if locker has no items at all
              if (!a.itemIds && !a.itemId) {
                console.log(`    ⏭️  Locker ${lockerKey} has no items, skipping`);
                return false;
              }

              // Handle itemIds array format (new format)
              if (a.itemIds && Array.isArray(a.itemIds)) {
                // Skip empty arrays
                if (a.itemIds.length === 0) {
                  console.log(`    ⏭️  Locker ${lockerKey} has empty itemIds array, skipping`);
                  return false;
                }
                // Normalize all to strings for comparison
                const normalizedItems = a.itemIds.map((id: any) => String(id).trim());
                const normalizedTest = String(testedItemId).trim();
                const found = normalizedItems.includes(normalizedTest);

                console.log(`      📋 itemIds array check:`, {
                  original: a.itemIds,
                  normalized: normalizedItems,
                  lookingFor: normalizedTest,
                  found: found
                });

                if (found) {
                  console.log(`    ✅ MATCH FOUND in itemIds array!`);
                }
                return found;
              }

              // Handle itemId string format (old format - comma-separated)
              if (a.itemId && typeof a.itemId === 'string') {
                // Split by comma and check for exact match (not substring)
                const itemIdsInString = a.itemId.split(',').map(id => String(id).trim());
                const normalizedTest = String(testedItemId).trim();
                const found = itemIdsInString.includes(normalizedTest);

                console.log(`      📋 itemId string check:`, {
                  original: a.itemId,
                  split: itemIdsInString,
                  lookingFor: normalizedTest,
                  found: found
                });

                if (found) {
                  console.log(`    ✅ MATCH FOUND in itemId string!`);
                }
                return found;
              }

              console.log(`      ❌ No itemId/itemIds in this locker`);
              return false;
            });

            if (key) {
                console.log(`  ✅ Found duplicate item in locker ${key}`);
                const locker = group.lockers[key];

                // Show warning dialog instead of automatically opening door
                setDuplicateItemInfo({
                  itemId: testedItemId,
                  doorNumber: +key,
                  patronId: locker.patronId || 'Unknown'
                });
                setShowDuplicateItemWarning(true);
                setShowLoginScreen(false); // Hide login dialog
                updateSessionStaffModeOn(false); // Exit staff mode

                return true;
            }
        }
    }

    console.log('  ❌ Item not found in any locker');
    return false;
  }

  function getNextLockeID(isADA = false) {
    const next = _.first(getFreeLockerIDs(isADA));
    return next;

  }

  function getAvailableCountPerSize(preference = 'ANY') {
    let takenLocks: any[] = [];
    for (let group of sessionDevice.value.config.locker.groups) {
        group.reserved_locks.map((a:any) => takenLocks.push(a));
    }

    let result = sessionDevice.value.config.locker.sizelist?.filter((door) => door.size < 4);
    if (preference === 'ANY') {
        result = _.filter(result, (a) => a.preference === undefined || a.preference === 0 || a.preference === 1 || a.preference === 2);
    } else if (preference === 'TOP2') {
        result = _.filter(result, (a) => a.preference === 0 || a.preference === 2);
    } else if (preference === 'BOTTOM2') {
        result = _.filter(result, (a) => a.preference === 0 || a.preference === 1);
    } else if (preference === 'ADA') {
        result = _.filter(result, (a) => a.ada);
    }

    let finalResult: any[] = [];
    if (result) {
        result.map((b: any) => {
            if (!_.find(takenLocks, (lock: any) => b.lock === lock)) {
                finalResult.push(b.lock);
            }
        });
    }
    return finalResult;
  }

  function getFreeLockerIDs(isADA = false) {
    let allLocks = patronPreference ? getAvailableCountPerSize(patronPreference) : getAvailableCountPerSize();

    for (let i in sessionDevice.value.config.locker['groups']) {
        const group = sessionDevice.value.config.locker['groups'][i];
        group.reserved_locks.map((lockId) => {
            allLocks = _.filter(allLocks, (a) => a !== lockId);
        });
    }

    if (isADA && sessionDevice.value.config.locker.sizelist?.length) {
        let prioOrderForAllAda = _.filter(sessionDevice.value.config.locker.sizelist, (a) => a.ada);
        let prioOrderForAll = _.orderBy(prioOrderForAllAda, (a) => a.prio);
        let finalAllLockers: any[] = [];
        prioOrderForAll.map((a: any) => {
            if (_.findKey(allLocks, (key) => key === a.lock)) {
                finalAllLockers.push(a.lock);
            }
        });
        return finalAllLockers;
    } else if (sessionDevice.value.config.locker.sizelist?.length) {
        const prioOrderForAll = _.orderBy(sessionDevice.value.config.locker.sizelist, (a) => a.prio);
        let finalAllLockers: any[] = [];
        prioOrderForAll.map((a: any) => {
            if (
                _.findKey(allLocks, (key) => {
                    // console.log(key);
                    return key === a.lock && !a.ada;
                })
            ) {
                finalAllLockers.push(a.lock);
            }
        });
        prioOrderForAll.map((a) => {
            if (_.findKey(allLocks, (key) => key === a.lock && a.ada)) {
                finalAllLockers.push(a.lock);
            }
        });
        return finalAllLockers;
    } else {
        return allLocks;
    }
  }

  function filterSelecedSize(size = 0, isAda = false) {
    const testEmptyLockers = getFreeLockerIDs(isAda);
    setEmptyLockers(testEmptyLockers);
    let useableNonAdaLocks: any[] = [];
    let useableAdaLocks: any[] = [];
    testEmptyLockers.map((doorNro: any) => {
        if (sessionDevice.value.config.locker.adalist.find((a) => a.number === doorNro)) {
            useableAdaLocks.push(doorNro);
        } else {
            useableNonAdaLocks.push(doorNro);
        }
    });

    let pontentialEmptyRightSizeLockers: any[] = [];

    if (isAda) {
        if (sessionDevice.value.config.locker.sizelist) {
            pontentialEmptyRightSizeLockers = sessionDevice.value.config.locker.sizelist
                .filter((a) => _.find(useableAdaLocks, (adaDoor) => adaDoor === a.lock))
                .filter((a) => a.size < 4);
        }
    } else {
        if (sessionDevice.value.config.locker.sizelist) {
            const useableAnyLock = useableNonAdaLocks.concat(useableAdaLocks);
            pontentialEmptyRightSizeLockers = sessionDevice.value.config.locker.sizelist
                .filter((a) => _.find(useableAnyLock, (door) => door === a.lock))
                .filter((a) => a.size < 4);
        }
    }

    // find size
    return pontentialEmptyRightSizeLockers.filter((a) => a.size >= size);
  }

  function patronHasAllreadyHold(patronId: string, holdExpirationDate?: any): number {
    // Check if patron has hold items in the locker using Firebase RTDB manifest structure
    if (!sessionDevice.value.manifest?.groups) {
      console.log(`📦 patronHasAllreadyHold: No manifest groups found`);
      return 0;
    }

    let foundDoorNumber = 0;
    let latestTimestamp = 0;

    // Iterate through manifest groups to find patron's hold items
    for (const groupKey in sessionDevice.value.manifest.groups) {
      const group = sessionDevice.value.manifest.groups[groupKey];

      if (group.lockers) {
        const lockerList = Array.isArray(group.lockers) ? group.lockers : Object.values(group.lockers);
        for (const locker of lockerList) {
          // Skip null entries
          if (!locker || !(locker as any).patronId) {
            continue;
          }

          // Skip lockers that are checked out — they are not hold items
          if ((locker as any).status === 'CHECKEDOUT') {
            continue;
          }

          // Check if this locker belongs to the patron
          if ((locker as any).patronId === patronId) {
            // If holdExpirationDate is specified, match it
            if (holdExpirationDate !== undefined && holdExpirationDate !== null) {
              if ((locker as any).holdExpirationDate === holdExpirationDate) {
                // Return the most recent locker if multiple exist
                if ((locker as any).timestamp > latestTimestamp) {
                  foundDoorNumber = (locker as any).doorNumber;
                  latestTimestamp = (locker as any).timestamp;
                }
              }
            } else {
              // No expiration date filter - return the most recent locker
              if ((locker as any).timestamp > latestTimestamp) {
                foundDoorNumber = (locker as any).doorNumber;
                latestTimestamp = (locker as any).timestamp;
              }
            }
          }
        }
      }
    }

    if (foundDoorNumber > 0) {
      console.log(`📦 patronHasAllreadyHold: Patron ${patronId} has hold items in door #${foundDoorNumber}`);
    }

    return foundDoorNumber;
  }

  async function exit() {
    updateSessionUserModeOn(false);
    setUsername('');
    setPassword('');
  }


  async function endStaffMode() {
    if (false) {
      try {
        if (testedOpenDoor.value > 0 && (sessionLocation.value === '/')) {
          await anyDoorOpen(sessionDevice.value.config.locker.mac).then((doorsStillOpen) => {
          if (doorsStillOpen) {
              setTimeout(() => toast.error(t('ERROR.DOOR_LEFT_OPEN')), 100);
            }
          });
        }

      } catch (error) {

      }
    }
    setHoldLibraryOfThingsGroup(false);

    setShowKeyboard(false);
    resetKeybard();
    updateSessionStaffModeOn(false);
    setSplitMode(false);
    setTestedOpenDoor(0);
    setLoading(false);
    exit()

  }

  async function endUserMode() {
    setHoldLibraryOfThingsGroup(false);
    setWelcomeUserDisplayName('');
    updateShowReturnInfo(false);
    setShowLoginScreen(false);
    endStaffMode()
    processingItemRef.current = false;
  }

  // Check for remaining hold pickup queue on mount (after returning from checkout)
  useEffect(() => {
    const queueStr = localStorage.getItem('holdPickupQueue');
    if (queueStr) {
      try {
        const queue = JSON.parse(queueStr);
        if (Array.isArray(queue) && queue.length > 0) {
          console.log(`📦 Returning from checkout — ${queue.length} hold(s) remaining in queue`);
          localStorage.removeItem('holdPickupQueue');
          const next = queue[0];
          const remaining = queue.slice(1);
          setHoldPickupInfo(next);
          setHoldPickupQueue(remaining);
          setHoldPickupTimer(20);
          setShowHoldPickupModal(true);
        }
      } catch (e) {
        localStorage.removeItem('holdPickupQueue');
      }
    }
  }, []);

  // Hold pickup modal countdown timer
  useEffect(() => {
    if (showHoldPickupModal) {
      holdPickupTimerRef.current = setInterval(() => {
        setHoldPickupTimer((prev) => {
          if (prev <= 1) {
            if (holdPickupTimerRef.current) clearInterval(holdPickupTimerRef.current);
            localStorage.removeItem('holdPickupQueue');
            setShowHoldPickupModal(false);
            setHoldPickupInfo(null);
            setHoldPickupQueue([]);
            endUserMode();
            return 20;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (holdPickupTimerRef.current) {
        clearInterval(holdPickupTimerRef.current);
        holdPickupTimerRef.current = null;
      }
    }
    return () => {
      if (holdPickupTimerRef.current) clearInterval(holdPickupTimerRef.current);
    };
  }, [showHoldPickupModal]);

  function exitLoginCountdownTimer(timerval?) {
    if (!sessionUserModeOn.value) {
      updateSessionTimer(0);
      return;
    }
    updateSessionTimer(timerval);
    if (sessionLocation.value !== '/') {
      return;
    }
    if (sessionTimer.value > 0) {
      return Promise.delay(1000).then(() => {
        if (sessionTimer.value > 0 && sessionLocation.value === '/') {
          const timerval = sessionTimer.value - 1;
          return exitLoginCountdownTimer(timerval);
        } else {
          endUserMode();
        }
      });

    }
    endUserMode();
  }
  function exitReturnCountdownTimer(timerval?) {
    if (!showReturnInfo.value) {
      updateSessionTimer(0);
      return;
    }
    updateSessionTimer(timerval);
    if (sessionLocation.value !== '/') {
      return;
    }
    if (sessionTimer.value > 0) {
      return Promise.delay(1000).then(() => {
        if (sessionTimer.value > 0 && sessionLocation.value === '/') {
          const timerval = sessionTimer.value - 1;
          return exitReturnCountdownTimer(timerval);
        } else {
          endUserMode();
        }
      });

    }
    endUserMode();
  }

  function getLoginImage() {
    const groupName = libraryOfThingsGroup.value?.name.toUpperCase();
    if (groupName === 'RETURNS' || groupName === 'DONATIONS') {
      return <span>
      <style>{`
        @keyframes depositItemLogin {
          0% {
            transform: translateY(-20px);
            opacity: 0.5;
          }
          50% {
            opacity: 1;
          }
          100% {
            transform: translateY(40px);
            opacity: 0.3;
          }
        }
        .animated-item-login {
          animation: depositItemLogin 2s ease-in-out infinite;
          transform-origin: center;
        }
        @keyframes arrowPulseLogin {
          0%, 100% {
            opacity: 0.6;
          }
          50% {
            opacity: 1;
          }
        }
        .animated-arrow-login {
          animation: arrowPulseLogin 2s ease-in-out infinite;
        }
      `}</style>
      <svg style={{marginTop: '15px', display: 'block', margin: '15px auto 0'}} width={isLandscapeLogin ? "240" : "480"} height={isLandscapeLogin ? "240" : "480"} viewBox="0 0 160 160" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="lockerGradientLogin" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style={{stopColor: '#FFFFFF', stopOpacity: 0.95}} />
            <stop offset="100%" style={{stopColor: '#E0E0E0', stopOpacity: 0.95}} />
          </linearGradient>
          <linearGradient id="itemGradientLogin" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style={{stopColor: '#42A4DE', stopOpacity: 1}} />
            <stop offset="100%" style={{stopColor: '#2E7DB3', stopOpacity: 1}} />
          </linearGradient>
          <filter id="shadowLogin" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="3"/>
            <feOffset dx="2" dy="3" result="offsetblur"/>
            <feComponentTransfer>
              <feFuncA type="linear" slope="0.4"/>
            </feComponentTransfer>
            <feMerge>
              <feMergeNode/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>

        {/* Multi-Locker Shelf */}
        <g filter="url(#shadowLogin)">
          <rect x="28" y="90" width="104" height="54" rx="3" fill="url(#lockerGradientLogin)" stroke="#888" strokeWidth="1.5"/>
          <path d="M 132 90 L 140 84 L 140 138 L 132 144 Z" fill="#C0C0C0" stroke="#888" strokeWidth="1"/>
          <path d="M 28 90 L 36 84 L 140 84 L 132 90 Z" fill="#E8E8E8" stroke="#888" strokeWidth="1"/>
          <rect x="32" y="94" width="23" height="22" rx="2" fill="#FAFAFA" stroke="#AAA" strokeWidth="1"/>
          <rect x="57" y="94" width="23" height="22" rx="2" fill="#FAFAFA" stroke="#AAA" strokeWidth="1"/>
          <rect x="82" y="94" width="23" height="22" rx="2" fill="#FAFAFA" stroke="#AAA" strokeWidth="1"/>
          <rect x="107" y="94" width="23" height="22" rx="2" fill="#FAFAFA" stroke="#AAA" strokeWidth="1"/>
          <rect x="32" y="118" width="23" height="22" rx="2" fill="#FAFAFA" stroke="#AAA" strokeWidth="1"/>
          <rect x="57" y="118" width="23" height="22" rx="2" fill="#FAFAFA" stroke="#AAA" strokeWidth="1"/>
          <rect x="82" y="118" width="23" height="22" rx="2" fill="#FAFAFA" stroke="#AAA" strokeWidth="1"/>
          <rect x="107" y="118" width="23" height="22" rx="2" fill="#FAFAFA" stroke="#AAA" strokeWidth="1"/>
          <rect x="32" y="94" width="23" height="3" fill="#DDD" opacity="0.5"/>
          <rect x="57" y="94" width="23" height="3" fill="#DDD" opacity="0.5"/>
          <rect x="82" y="94" width="23" height="3" fill="#DDD" opacity="0.5"/>
          <rect x="107" y="94" width="23" height="3" fill="#DDD" opacity="0.5"/>
          <rect x="32" y="118" width="23" height="3" fill="#DDD" opacity="0.5"/>
          <rect x="57" y="118" width="23" height="3" fill="#DDD" opacity="0.5"/>
          <rect x="82" y="118" width="23" height="3" fill="#DDD" opacity="0.5"/>
          <rect x="107" y="118" width="23" height="3" fill="#DDD" opacity="0.5"/>
        </g>

        {/* Animated Item */}
        <g filter="url(#shadowLogin)" className="animated-item-login">
          <path d="M 68 48 L 68 68 L 88 80 L 108 68 L 108 48 L 88 36 Z" fill="url(#itemGradientLogin)" stroke="#1E5F8A" strokeWidth="1.5"/>
          <path d="M 68 48 L 88 36 L 108 48 L 88 60 Z" fill="#5BB8ED" stroke="#1E5F8A" strokeWidth="1"/>
          <path d="M 108 48 L 108 68 L 88 80 L 88 60 Z" fill="#2E7DB3" stroke="#1E5F8A" strokeWidth="1"/>
          <circle cx="80" cy="52" r="6" fill="#FFFFFF" fillOpacity="0.4"/>
        </g>

        {/* Animated Arrow */}
        <g className="animated-arrow-login">
          <line x1="88" y1="89" x2="88" y2="105" stroke="#42A4DE" strokeWidth="5" strokeLinecap="round"/>
          <path d="M 88 105 L 80 97 L 96 97 Z" fill="#42A4DE" stroke="#2E7DB3" strokeWidth="1.5"/>
          <line x1="88" y1="89" x2="88" y2="105" stroke="#5BB8ED" strokeWidth="2.5" strokeLinecap="round" opacity="0.5"/>
        </g>
      </svg>
      </span>
    }

    if (libraryOfThingsGroup.value) {
      // Get group from Firebase Realtime DB
      const group = deviceGroups[libraryOfThingsGroup.value.groupIndex];
      return <img  style={{
        maxWidth: '100%', height: isLandscapeLogin ? (fontSize.value > 20 ? '200px' : '250px') : (fontSize.value > 20 ? '400px' : '500px'), objectFit: 'contain', margin: 'auto', display: 'block', padding: '10px' }} alt="example" src={getImage(group?.image, libraryOfThingsGroup.value.name)} />;
    }

    return <img  style={{ width: isLandscapeLogin ? '200px' : '400px', height: 'auto', margin: 'auto', padding: '10px 10px 10px 10px' }} alt="example" src={getImage('./LIBRARY.png', 'LIBRARY')} />;
  }




  useEffect(() => {
    function nextPlayIndex() {
      clearTimeout(timer);
      const id = setTimeout(() => {
        const currentGroup: any = deviceGroups[playIndex.value];
        setPrevImage(getImage(currentGroup?.image, currentGroup?.name));
        setSlideDirection('left');
        setSlideKey(prev => prev + 1);
        if (playIndex.value < deviceGroups.length - 1) {
          updatePlayIndex(playIndex.value + 1);
        } else {
          updatePlayIndex(0);
        }
      }, 15000);
      setTimer(id);
    }
    if (playMode) {
      nextPlayIndex();
    } else {
      clearTimeout(timer);
      setTimer(null);
    }
  }, [playIndex.value, playMode]);

  // Grid page carousel auto-advance (10s)
  const limitPerPage = sessionDevice.value?.settings?.limitGroupCardsPerPage || 0;
  useEffect(() => {
    if (gridPageTimerRef.current) clearInterval(gridPageTimerRef.current);
    if (!limitPerPage || playMode || showLoginScreen) return;

    // RETURNS card is on every page, so group cards get (limitPerPage - 1) slots per page
    const groupsPerPage = Math.max(limitPerPage - 1, 1);
    const totalPages = Math.ceil(deviceGroups.length / groupsPerPage);
    if (totalPages <= 1) return;

    gridPageTimerRef.current = setInterval(() => {
      setGridPageIndex(prev => (prev + 1) % totalPages);
    }, 10000);

    return () => {
      if (gridPageTimerRef.current) clearInterval(gridPageTimerRef.current);
    };
  }, [limitPerPage, deviceGroups.length, playMode, showLoginScreen]);

  const anyGroupItemAvailable = (inputGroups:any) => {
    let availableLockers = false
    if (!inputGroups?.lockers) return false;
    for (let i = 0; i < inputGroups.lockers.length; i++) {
      const locker = inputGroups.lockers[i];
      if (!locker.empty && locker.enabled && !!locker.itemId && !locker.conditionCheck && (!locker.patronId || locker.patronId === 'All')) {
        availableLockers = true
        break
      }
    }
    return availableLockers;
  }

  // HTMLs ****

  if (loading) {
    return <Spinner></Spinner>
  }

  const htmlRenderLang = languges.map((input:any) => {
    const isSelectedLang = lang === input.lang;
    const selectedStyle: React.CSSProperties = {
      border: isSelectedLang ? '10x solid' : '',
      padding: isSelectedLang ? '5px' : '',
      boxShadow: isSelectedLang ? '1px 1px 1px 1px rgb(0 0 0 / 50%), 0 1px 6px -1px rgb(0 0 0 / 2%), 0 2px 4px 0 rgb(0 0 0 / 4%' : '',
    };

    return (
        <Col key={input.key} span={20} offset={2} >
          <Card style={selectedStyle} onClick={() => {changeLanguage(input.lang); setTimeout(() => procesModalResult(false), 300)}}>
            <Avatar shape="square" style={{marginRight: '20px', marginTop: '-15px' }} size={40} src={input.icon} />
            {isSelectedLang ? <CheckOutlined size={20} style={{ color: '#42A4DE', marginRight: '10px'}} /> : ''}
            <span style={{color: '#42A4DE', ...getTextStyle({}, 15)}}>{input.name}</span>
          </Card>
        </Col>
    )
  });

  const htmlShowThingsGrid = () => {
    return (<>
      <div onClick={() => handleTouch(false)} style={style.getEmptyBackground()}></div>


        {/* Admin access button - top left (hidden, double-click to access) */}
        <button style={{ position: 'fixed', left: '25px', top: '25px', opacity: '0.005', zIndex: 200 }} onDoubleClick={onDoubleClickHandler}>
          <MdLanguage size={80} />
        </button>

        {welcomeUserDisplayName &&
        <Button type="primary" size="large" style={{
            ...getTextStyle({}, 15),
            color: 'white',
            height: '50px',
            width: '150px',
            backgroundColor: 'red',
            padding: 'auto',
            position: 'fixed', right: '5%', top: '25px', zIndex: 200
           }} onClick={() => {
          setWelcomeUserDisplayName(null);
          endUserMode();
        }}>
          {t('SAAS.LOT_OUT', {patronId: welcomeUserDisplayName} )}
        </Button>
        }

        {/* Scanner simulation / Login button - top right (hidden, double-click to access) */}
        <button style={{ position: 'fixed', right: '5px', top: '5px', opacity: '0.0005', zIndex: 200 }} onDoubleClick={scannerSimulation}>
          <MdLanguage size={100} />
        </button>

        <Row justify="start">
          <Col span={24}>
            <div
              style={{ color: 'white', backgroundColor: 'rgba(0,0,0,0.0)' }} >
              <h2 style={getTextStyle({marginBottom: '-20px', zIndex: 200}, 20)}>
                { !welcomeUserDisplayName ?
                  (<span style={{cursor: 'pointer', textShadow: '0 0 10px rgba(66, 164, 222, 1)', position: 'relative', zIndex: 999, top: '-15px' }} onClick={() => {
                    setPlayMode(true)
                  }}>{t('SAAS.WELCOME_TO_LOT')}</span>)
                  :
                  (<span style={{cursor: 'pointer'}} onClick={() => {
                    setWelcomeUserDisplayName(null);
                    endUserMode();
                  }}>
                    {<span dangerouslySetInnerHTML={{__html: t('SAAS.WELCOME_TO_LOT_LOGIN', {name: welcomeUserDisplayName})}} />}
                  </span>)
                }
              </h2>
            </div>
          </Col>
        </Row>

        <style>{`
          @keyframes depositItemCard {
            0% {
              transform: translateY(-15px);
              opacity: 0.5;
            }
            50% {
              opacity: 1;
            }
            100% {
              transform: translateY(30px);
              opacity: 0.3;
            }
          }
          .animated-item-card {
            animation: depositItemCard 2s ease-in-out infinite;
            transform-origin: center;
          }
          .animated-arrow-card {
            animation: arrowPulse 2s ease-in-out infinite;
          }
        `}</style>

        {/* Grid page swipe + navigation for paginated mode */}
        {(() => {
          // When paginated, RETURNS card appears on every page, so group cards get (limitPerPage - 1) slots per page
          const groupsPerPage = limitPerPage > 0 ? Math.max(limitPerPage - 1, 1) : 0;
          const totalPages = limitPerPage > 0 ? Math.ceil(deviceGroups.length / groupsPerPage) : 1;
          const isPaginated = limitPerPage > 0 && totalPages > 1;
          // Compute colSpan based on orientation and cards visible
          const visibleCount = isPaginated ? limitPerPage : deviceGroups.length;
          const screenOrientationVal = sessionDevice.value?.settings?.screenOrientation;
          const isLandscape = screenOrientationVal?.toLowerCase() === 'landscape';

          // Portrait: 2 per row — Landscape: 4 cols per row, fill rows first, expand cols only when needed
          let colSpan: number;
          if (isLandscape) {
            const totalCards = isPaginated ? limitPerPage : deviceGroups.length + 1; // +1 for returns
            const minCols = 4;
            const maxRows = 3;
            // Fill rows first with 4 cols, only expand cols beyond 3 rows
            const neededRows = Math.ceil(totalCards / minCols);
            const cardsPerRow = neededRows <= maxRows ? minCols : Math.ceil(totalCards / maxRows);
            colSpan = Math.max(Math.floor(24 / cardsPerRow), 2);
          } else {
            // Portrait: min 2 cols per row, fill rows first, max 4 rows, no max for cols
            const totalCards = isPaginated ? limitPerPage : deviceGroups.length + 1;
            const minCols = 2;
            const maxRows = 4;
            const neededRows = Math.ceil(totalCards / minCols);
            const cardsPerRow = neededRows <= maxRows ? minCols : Math.ceil(totalCards / maxRows);
            colSpan = Math.floor(24 / cardsPerRow) || 1;
          }
          // Orientation-aware image/SVG sizing
          const svgSize = isLandscape ? 160 : (visibleCount <= 3 ? 480 : visibleCount <= 5 ? 320 : 160);
          const imgHeight = isLandscape
            ? (fontSize.value > 20 ? '180px' : '200px')
            : (visibleCount <= 3 ? (fontSize.value > 20 ? '540px' : '600px') : visibleCount <= 5 ? (fontSize.value > 20 ? '360px' : '400px') : (fontSize.value > 20 ? '180px' : '200px'));
          // Unavailable overlay sizing
          const overlayTop = isLandscape ? '55px' : (visibleCount > 3 ? '55px' : '75px');
          const overlayLeft = isLandscape ? '-160px' : (visibleCount > 3 ? '-160px' : '-150px');
          const overlayWidth = isLandscape ? '480px' : (visibleCount > 3 ? '480px' : '560px');
          const overlayPadding = isLandscape ? '8px 0' : (visibleCount > 3 ? '8px 0' : '14px 0');
          const overlayFontSize = isLandscape ? '22px' : (visibleCount > 3 ? '22px' : '36px');

          // Build RETURNS card separately so it appears on every page
          let returnsCard: React.ReactNode = null;
          // Build group card elements
          const groupCards: React.ReactNode[] = [];

          // RETURNS card (appears on every page)
          returnsCard = (
          <Col key="returns" span={colSpan} style={{ marginTop: '20px' }} onClick={() => {
            setLibraryOfThingsGroup({name: 'RETURNS', groupIndex: null})
            processLoginClicked()
          }}>
            <Card hoverable
              style={{
                  ...getTextStyle({}, 5), height: '110%', marginTop: '20px', backgroundSize: 'cover', backgroundPosition: 'center',
                'boxShadow': '1px 1px 1px 1px rgb(0 0 0 / 50%), 0 1px 6px -1px rgb(0 0 0 / 2%), 0 2px 4px 0 rgb(0 0 0 / 4%)',
                position: 'relative'
              }}
              cover={
                <svg style={{marginTop: '15px'}} width={svgSize} height={svgSize} viewBox="0 0 160 160" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <linearGradient id="bgGradientCard" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" style={{stopColor: '#42A4DE', stopOpacity: 1}} />
                      <stop offset="100%" style={{stopColor: '#2E7DB3', stopOpacity: 1}} />
                    </linearGradient>
                    <linearGradient id="lockerGradientCard" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" style={{stopColor: '#FFFFFF', stopOpacity: 0.95}} />
                      <stop offset="100%" style={{stopColor: '#E0E0E0', stopOpacity: 0.95}} />
                    </linearGradient>
                    <linearGradient id="itemGradientCard" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" style={{stopColor: '#42A4DE', stopOpacity: 1}} />
                      <stop offset="100%" style={{stopColor: '#2E7DB3', stopOpacity: 1}} />
                    </linearGradient>
                    <radialGradient id="highlightGradientCard" cx="30%" cy="30%">
                      <stop offset="0%" style={{stopColor: '#FFFFFF', stopOpacity: 0.3}} />
                      <stop offset="100%" style={{stopColor: '#FFFFFF', stopOpacity: 0}} />
                    </radialGradient>
                    <filter id="shadowCard" x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur in="SourceAlpha" stdDeviation="3"/>
                      <feOffset dx="2" dy="3" result="offsetblur"/>
                      <feComponentTransfer>
                        <feFuncA type="linear" slope="0.4"/>
                      </feComponentTransfer>
                      <feMerge>
                        <feMergeNode/>
                        <feMergeNode in="SourceGraphic"/>
                      </feMerge>
                    </filter>
                  </defs>

                  {/* Multi-Locker Shelf */}
                  <g filter="url(#shadowCard)">
                    {/* Main locker frame - 3D effect */}
                    <rect x="28" y="90" width="104" height="54" rx="3" fill="url(#lockerGradientCard)" stroke="#888" strokeWidth="1.5"/>
                    {/* Right side 3D edge */}
                    <path d="M 132 90 L 140 84 L 140 138 L 132 144 Z" fill="#C0C0C0" stroke="#888" strokeWidth="1"/>
                    {/* Top 3D edge */}
                    <path d="M 28 90 L 36 84 L 140 84 L 132 90 Z" fill="#E8E8E8" stroke="#888" strokeWidth="1"/>

                    {/* Grid of locker compartments - 4 columns x 2 rows */}
                    {/* Row 1 */}
                    <rect x="32" y="94" width="23" height="22" rx="2" fill="#FAFAFA" stroke="#AAA" strokeWidth="1"/>
                    <rect x="57" y="94" width="23" height="22" rx="2" fill="#FAFAFA" stroke="#AAA" strokeWidth="1"/>
                    <rect x="82" y="94" width="23" height="22" rx="2" fill="#FAFAFA" stroke="#AAA" strokeWidth="1"/>
                    <rect x="107" y="94" width="23" height="22" rx="2" fill="#FAFAFA" stroke="#AAA" strokeWidth="1"/>
                    {/* Row 2 */}
                    <rect x="32" y="118" width="23" height="22" rx="2" fill="#FAFAFA" stroke="#AAA" strokeWidth="1"/>
                    <rect x="57" y="118" width="23" height="22" rx="2" fill="#FAFAFA" stroke="#AAA" strokeWidth="1"/>
                    <rect x="82" y="118" width="23" height="22" rx="2" fill="#FAFAFA" stroke="#AAA" strokeWidth="1"/>
                    <rect x="107" y="118" width="23" height="22" rx="2" fill="#FAFAFA" stroke="#AAA" strokeWidth="1"/>

                    {/* Subtle inner shadows for depth */}
                    <rect x="32" y="94" width="23" height="3" fill="#DDD" opacity="0.5"/>
                    <rect x="57" y="94" width="23" height="3" fill="#DDD" opacity="0.5"/>
                    <rect x="82" y="94" width="23" height="3" fill="#DDD" opacity="0.5"/>
                    <rect x="107" y="94" width="23" height="3" fill="#DDD" opacity="0.5"/>
                    <rect x="32" y="118" width="23" height="3" fill="#DDD" opacity="0.5"/>
                    <rect x="57" y="118" width="23" height="3" fill="#DDD" opacity="0.5"/>
                    <rect x="82" y="118" width="23" height="3" fill="#DDD" opacity="0.5"/>
                    <rect x="107" y="118" width="23" height="3" fill="#DDD" opacity="0.5"/>
                  </g>

                  {/* Animated Item */}
                  <g filter="url(#shadowCard)" className="animated-item-card">
                    <path d="M 68 48 L 68 68 L 88 80 L 108 68 L 108 48 L 88 36 Z" fill="url(#itemGradientCard)" stroke="#1E5F8A" strokeWidth="1.5"/>
                    <path d="M 68 48 L 88 36 L 108 48 L 88 60 Z" fill="#5BB8ED" stroke="#1E5F8A" strokeWidth="1"/>
                    <path d="M 108 48 L 108 68 L 88 80 L 88 60 Z" fill="#2E7DB3" stroke="#1E5F8A" strokeWidth="1"/>
                    <circle cx="80" cy="52" r="6" fill="#FFFFFF" fillOpacity="0.4"/>
                  </g>

                  {/* Animated Arrow */}
                  <g className="animated-arrow-card">
                    <line x1="88" y1="89" x2="88" y2="105" stroke="#42A4DE" strokeWidth="5" strokeLinecap="round"/>
                    <path d="M 88 105 L 80 97 L 96 97 Z" fill="#42A4DE" stroke="#2E7DB3" strokeWidth="1.5"/>
                    <line x1="88" y1="89" x2="88" y2="105" stroke="#5BB8ED" strokeWidth="2.5" strokeLinecap="round" opacity="0.5"/>
                  </g>
                </svg>}
            >
              <Meta
                style={{
                  marginTop: '20px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  color: '#42A4DE',
                  position: 'absolute',
                  backgroundColor: 'rgba(255,255,255,0.8)',
                  bottom: '10px',
                  width: '90%',
                  textAlign: 'center',
                  // boxShadow: '1px 1px 1px 1px rgb(0 0 0 / 50%), 0 1px 6px -1px rgb(0 0 0 / 2%), 0 2px 4px 0 rgb(0 0 0 / 4%'
                }}
                title={<span style={{...getTextStyle({}, 10), color: '#42A4DE'}}>{'returns'.toUpperCase()}</span>}
                description={<span style={{...getTextStyle({},2), color: '#42A4DE'}}>{t('SAAS.LOT.RETURN_DESCRIPTION')}</span>}
              />
              {totalConditionCheckCount > 0 && (
                <div style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 3 }}>
                  <Badge count={totalConditionCheckCount} title="" style={{ backgroundColor: SEBlue.value, fontSize: '16px', fontWeight: 'bold', padding: '0 4px', height: '24px', lineHeight: '24px', borderRadius: '12px' }} />
                </div>
              )}
            </Card>
          </Col>
          );

          // GROUPS FROM FIREBASE REALTIME DB
          deviceGroups.forEach((group:any, key:any) => {


            const isDonations = group.name?.toUpperCase() === 'DONATIONS';
            const anyNormal = anyItemsAvailableNormal(sessionDevice.value, key);
            const anyADA = anyItemsAvailableADA(sessionDevice.value, key);
            const any = anyNormal || anyADA;
            // Calculate the count of items in this group
            const lockersArray = group.lockers ? (Array.isArray(group.lockers) ? group.lockers : Object.values(group.lockers)) : [];
            const itemCount = lockersArray.length;
            // Count lockers with conditionCheck enabled
            const conditionCheckCount = lockersArray.filter((l: any) => l && l.conditionCheck).length;
            // Count available items (patronId 'All' or unset, has items, not conditionCheck)
            const availableItemCount = lockersArray.filter((l: any) => l && l.itemIds && l.itemIds.length && (!l.patronId || l.patronId === 'All') && !l.conditionCheck).length;

            // DONATIONS always shows as normal card (like Returns), no availability check, no hold
            groupCards.push((any || isDonations) ?
            // at least one available (or DONATIONS), show the group
              (
              <Col key={key} span={colSpan} style={{ marginTop: '20px' }} onClick={() => {
                // DONATIONS uses same action as Returns (groupIndex: null)
                setLibraryOfThingsGroup({name: group.name, groupIndex: isDonations ? null : key})
                processLoginClicked()
              }}>
                <Card hoverable
                  style={{ ...getTextStyle({}, 5), height: '110%', marginTop: '20px', backgroundSize: 'cover', backgroundPosition: 'center', 'boxShadow': '1px 1px 1px 1px rgb(0 0 0 / 50%), 0 1px 6px -1px rgb(0 0 0 / 2%), 0 2px 4px 0 rgb(0 0 0 / 4%', position: 'relative'}}
                  cover={isDonations && !group.image ?
                    <svg style={{marginTop: '15px'}} width={svgSize} height={svgSize} viewBox="0 0 160 160" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <defs>
                        <linearGradient id="lockerGradientDonations" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" style={{stopColor: '#FFFFFF', stopOpacity: 0.95}} />
                          <stop offset="100%" style={{stopColor: '#E0E0E0', stopOpacity: 0.95}} />
                        </linearGradient>
                        <linearGradient id="itemGradientDonations" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" style={{stopColor: '#42A4DE', stopOpacity: 1}} />
                          <stop offset="100%" style={{stopColor: '#2E7DB3', stopOpacity: 1}} />
                        </linearGradient>
                        <filter id="shadowDonations" x="-50%" y="-50%" width="200%" height="200%">
                          <feGaussianBlur in="SourceAlpha" stdDeviation="3"/>
                          <feOffset dx="2" dy="3" result="offsetblur"/>
                          <feComponentTransfer>
                            <feFuncA type="linear" slope="0.4"/>
                          </feComponentTransfer>
                          <feMerge>
                            <feMergeNode/>
                            <feMergeNode in="SourceGraphic"/>
                          </feMerge>
                        </filter>
                      </defs>
                      <g filter="url(#shadowDonations)">
                        <rect x="28" y="90" width="104" height="54" rx="3" fill="url(#lockerGradientDonations)" stroke="#888" strokeWidth="1.5"/>
                        <path d="M 132 90 L 140 84 L 140 138 L 132 144 Z" fill="#C0C0C0" stroke="#888" strokeWidth="1"/>
                        <path d="M 28 90 L 36 84 L 140 84 L 132 90 Z" fill="#E8E8E8" stroke="#888" strokeWidth="1"/>
                        <rect x="32" y="94" width="23" height="22" rx="2" fill="#FAFAFA" stroke="#AAA" strokeWidth="1"/>
                        <rect x="57" y="94" width="23" height="22" rx="2" fill="#FAFAFA" stroke="#AAA" strokeWidth="1"/>
                        <rect x="82" y="94" width="23" height="22" rx="2" fill="#FAFAFA" stroke="#AAA" strokeWidth="1"/>
                        <rect x="107" y="94" width="23" height="22" rx="2" fill="#FAFAFA" stroke="#AAA" strokeWidth="1"/>
                        <rect x="32" y="118" width="23" height="22" rx="2" fill="#FAFAFA" stroke="#AAA" strokeWidth="1"/>
                        <rect x="57" y="118" width="23" height="22" rx="2" fill="#FAFAFA" stroke="#AAA" strokeWidth="1"/>
                        <rect x="82" y="118" width="23" height="22" rx="2" fill="#FAFAFA" stroke="#AAA" strokeWidth="1"/>
                        <rect x="107" y="118" width="23" height="22" rx="2" fill="#FAFAFA" stroke="#AAA" strokeWidth="1"/>
                        <rect x="32" y="94" width="23" height="3" fill="#DDD" opacity="0.5"/>
                        <rect x="57" y="94" width="23" height="3" fill="#DDD" opacity="0.5"/>
                        <rect x="82" y="94" width="23" height="3" fill="#DDD" opacity="0.5"/>
                        <rect x="107" y="94" width="23" height="3" fill="#DDD" opacity="0.5"/>
                        <rect x="32" y="118" width="23" height="3" fill="#DDD" opacity="0.5"/>
                        <rect x="57" y="118" width="23" height="3" fill="#DDD" opacity="0.5"/>
                        <rect x="82" y="118" width="23" height="3" fill="#DDD" opacity="0.5"/>
                        <rect x="107" y="118" width="23" height="3" fill="#DDD" opacity="0.5"/>
                      </g>
                      <g filter="url(#shadowDonations)" className="animated-item-card">
                        <path d="M 68 48 L 68 68 L 88 80 L 108 68 L 108 48 L 88 36 Z" fill="url(#itemGradientDonations)" stroke="#1E5F8A" strokeWidth="1.5"/>
                        <path d="M 68 48 L 88 36 L 108 48 L 88 60 Z" fill="#5BB8ED" stroke="#1E5F8A" strokeWidth="1"/>
                        <path d="M 108 48 L 108 68 L 88 80 L 88 60 Z" fill="#2E7DB3" stroke="#1E5F8A" strokeWidth="1"/>
                        <circle cx="80" cy="52" r="6" fill="#FFFFFF" fillOpacity="0.4"/>
                      </g>
                      <g className="animated-arrow-card">
                        <line x1="88" y1="89" x2="88" y2="105" stroke="#42A4DE" strokeWidth="5" strokeLinecap="round"/>
                        <path d="M 88 105 L 80 97 L 96 97 Z" fill="#42A4DE" stroke="#2E7DB3" strokeWidth="1.5"/>
                        <line x1="88" y1="89" x2="88" y2="105" stroke="#5BB8ED" strokeWidth="2.5" strokeLinecap="round" opacity="0.5"/>
                      </g>
                    </svg>
                    : <img style={{ maxWidth: '100%', height: imgHeight, objectFit: 'contain', margin: 'auto', display: 'block', padding: '10px' }} alt="example" src={getImage(group.image, group.name)} />}
                >

                  <Meta
                    style={{
                      left: '50%',
                      transform: 'translateX(-50%)',
                      color: '#42A4DE',
                      position: 'absolute',
                      backgroundColor: 'rgba(255,255,255,0.8)',
                      bottom: '10px',
                      width: '90%',
                      textAlign: 'center',
                      // boxShadow: '1px 1px 1px 1px rgb(0 0 0 / 50%), 0 1px 6px -1px rgb(0 0 0 / 2%), 0 2px 4px 0 rgb(0 0 0 / 4%'
                    }}
                    title={<span style={{color: '#42A4DE', ...getTextStyle({}, 10)}}>{group.name.toUpperCase()}</span>}
                    description={<span style={{color: '#42A4DE', ...getTextStyle({}, 0)}}>{group.description}</span>}
                  />
                  {availableItemCount > 0 && (
                    <div style={{ position: 'absolute', top: '8px', left: '8px', zIndex: 3 }}>
                      <Badge count={availableItemCount} title="" style={{ backgroundColor: SEBlue.value, fontSize: '16px', fontWeight: 'bold', padding: '0 4px', height: '24px', lineHeight: '24px', borderRadius: '12px' }} />
                    </div>
                  )}
                  {conditionCheckCount > 0 && (
                    <div style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 3 }}>
                      <Badge count={conditionCheckCount} title="" style={{ backgroundColor: SEBlue.value, fontSize: '16px', fontWeight: 'bold', padding: '0 4px', height: '24px', lineHeight: '24px', borderRadius: '12px' }} />
                    </div>
                  )}
                </Card>
              </Col>
            )

            :
            // all taken — show hold card only if group.allowHolds, otherwise just "checked out"
            (<Col key={key} span={colSpan} style={{ marginTop: '20px' }} onClick={() => {
              if (!group.allowHolds) return; // No hold action if group doesn't allow holds
              // If patron is already authenticated, show hold request modal directly
              if (welcomeUserDisplayName) {
                setHoldRequestInfo({ patronId: welcomeUserDisplayName, groupName: group.name });
                setShowHoldRequestModal(true);
                // Auto-close modal after 5 seconds
                setTimeout(() => {
                  setShowHoldRequestModal(false);
                  setHoldRequestInfo(null);
                }, 5000);
                return;
              }
              // Otherwise, login first then show hold request modal
              setLibraryOfThingsGroup({name: group.name, groupIndex: key})
              setHoldLibraryOfThingsGroup(true)
              processLoginClicked()
            }}>

              <Card hoverable={!!group.allowHolds}
                style={{ ...getTextStyle({}, 5), height: '110%', marginTop: '20px', backgroundSize: 'cover', backgroundPosition: 'center', 'boxShadow': '1px 1px 1px 1px rgb(0 0 0 / 50%), 0 1px 6px -1px rgb(0 0 0 / 2%), 0 2px 4px 0 rgb(0 0 0 / 4%', position: 'relative', overflow: 'hidden', cursor: group.allowHolds ? 'pointer' : 'default'}}
                cover={<img  style={{ maxWidth: '100%', height: imgHeight, objectFit: 'contain', margin: 'auto', display: 'block', padding: '10px', opacity: 0.35, filter: 'grayscale(80%)' }} alt="example" src={getImage(group.image, group.name)} />}
              >
                <div style={{
                  position: 'absolute',
                  top: overlayTop,
                  left: overlayLeft,
                  width: overlayWidth,
                  padding: overlayPadding,
                  backgroundColor: group.allowHolds
                    ? (sessionDevice.value?.settings?.welcomeBackgroundColor || SEBlue.value)
                    : '#888',
                  color: 'white',
                  fontSize: overlayFontSize,
                  fontWeight: 'bold',
                  textAlign: 'center',
                  lineHeight: '1.3',
                  transform: 'rotate(-45deg)',
                  zIndex: 2,
                  boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                }}>
                  {t('SAAS.CHECKED_OUT')}
                  {group.allowHolds && (<>
                    <br />
                    {t('SAAS.CLICK_TO_PLACE_HOLD', { defaultValue: 'Click to place a hold' })}
                  </>)}
                </div>



                <Meta
                  style={{
                    left: '50%',
                    transform: 'translateX(-50%)',
                    position: 'absolute',
                    backgroundColor: 'rgba(255,255,255,1)',
                    bottom: '10px',
                    width: '90%',
                    textAlign: 'center',
                    opacity: 0.5,
                    // boxShadow: '1px 1px 1px 1px rgb(0 0 0 / 50%), 0 1px 6px -1px rgb(0 0 0 / 2%), 0 2px 4px 0 rgb(0 0 0 / 4%'
                  }}
                  title={<span style={{color: '#42A4DE', ...getTextStyle({}, 10)}}>{group.name.toUpperCase()}</span>}
                  description={<span style={{color: '#42A4DE', ...getTextStyle({}, 0)}}>{group.description}</span>} />

                  {availableItemCount > 0 && (
                    <div style={{ position: 'absolute', top: '8px', left: '8px', zIndex: 3 }}>
                      <Badge count={availableItemCount} title="" style={{ backgroundColor: SEBlue.value, fontSize: '16px', fontWeight: 'bold', padding: '0 4px', height: '24px', lineHeight: '24px', borderRadius: '12px' }} />
                    </div>
                  )}
                  {conditionCheckCount > 0 && (
                    <div style={{ position: 'absolute', top: '8px', right: '8px', zIndex: 3 }}>
                      <Badge count={conditionCheckCount} title="" style={{ backgroundColor: SEBlue.value, fontSize: '16px', fontWeight: 'bold', padding: '0 4px', height: '24px', lineHeight: '24px', borderRadius: '12px' }} />
                    </div>
                  )}

              </Card>
            </Col>)
          );
          });

          // Pagination: RETURNS card appears on every page, group cards are paginated
          const pageCards: React.ReactNode[] = isPaginated
            ? [returnsCard, ...groupCards.slice(gridPageIndex * groupsPerPage, (gridPageIndex + 1) * groupsPerPage)]
            : [returnsCard, ...groupCards];

          const cardsPerRow = Math.floor(24 / colSpan);

          // Ensure minimum rows by padding with empty placeholders (landscape: 2 rows, portrait: 1 row)
          const minRows = 2;
          const minCards = minRows * cardsPerRow;
          while (pageCards.length < minCards) {
            pageCards.push(
              <Col key={`empty-${pageCards.length}`} span={colSpan} style={{ marginTop: '20px', visibility: 'hidden' }}>
                <Card style={{ ...getTextStyle({}, 5), height: '110%', marginTop: '20px', opacity: 0 }} />
              </Col>
            );
          }

          // Always use full page card count for consistent sizing across all pages
          const numRows = isPaginated ? Math.max(Math.ceil(limitPerPage / cardsPerRow), 2) : Math.max(Math.ceil(pageCards.length / cardsPerRow), 2);

          return (
            <>
              {numRows > 0 && (
                <style>{`
                  .landscape-fullheight-grid {
                    position: relative;
                    height: calc(100vh - ${isLandscape ? (numRows >= 3 ? 290 : 215) : (numRows >= 4 ? 420 : numRows >= 3 ? 350 : 280)}px);
                    display: flex;
                    flex-direction: column;
                  }
                  .landscape-fullheight-grid .ant-row {
                    flex: 1;
                    align-content: flex-start;
                    min-height: 0;
                  }
                  .landscape-fullheight-grid .ant-col {
                    display: flex !important;
                    height: calc(100% / ${numRows});
                    max-height: calc(100% / ${numRows});
                    padding: 10px;
                    margin-top: 0 !important;
                  }
                  .landscape-fullheight-grid .ant-card {
                    width: 100%;
                    height: 100% !important;
                    display: flex;
                    flex-direction: column;
                    margin-top: 0 !important;
                    overflow: hidden;
                  }
                  .landscape-fullheight-grid .ant-card-cover {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    overflow: hidden;
                    min-height: 0;
                  }
                  .landscape-fullheight-grid .ant-card-cover img {
                    max-height: 100%;
                    height: auto !important;
                    width: auto;
                    max-width: 100%;
                    object-fit: contain;
                  }
                  .landscape-fullheight-grid .ant-card-cover svg {
                    max-height: 100%;
                    max-width: 100%;
                  }
                  .landscape-fullheight-grid .ant-card-body {
                    flex-shrink: 0;
                    min-height: 50px;
                    padding: 16px 24px;
                  }
                `}</style>
              )}
              <div className={'landscape-fullheight-grid'} style={{paddingLeft: '60px', paddingRight: '40px', marginTop: '20px'}}
                onTouchStart={(e) => {
                  if (!isPaginated) return;
                  const touch = e.touches[0];
                  (e.currentTarget as any)._touchStartX = touch.clientX;
                }}
                onTouchEnd={(e) => {
                  if (!isPaginated) return;
                  const startX = (e.currentTarget as any)._touchStartX;
                  const endX = e.changedTouches[0].clientX;
                  const diff = startX - endX;
                  if (Math.abs(diff) > 50) {
                    if (gridPageTimerRef.current) clearInterval(gridPageTimerRef.current);
                    if (diff > 0) {
                      setGridPageIndex((gridPageIndex + 1) % totalPages);
                    } else {
                      setGridPageIndex((gridPageIndex - 1 + totalPages) % totalPages);
                    }
                  }
                }}
              >
                <Row justify="start" gutter={[20, 20]} style={{width: '100%'}}>
                  {pageCards}
                </Row>
                {isPaginated && totalPages > 1 && (
                  <div style={{textAlign: 'center', padding: '10px 0'}}>
                    {Array.from({length: totalPages}, (_, i) => (
                      <span key={i} onClick={() => {
                        setGridPageIndex(i);
                        if (gridPageTimerRef.current) clearInterval(gridPageTimerRef.current);
                      }} style={{
                        display: 'inline-block',
                        width: '16px',
                        height: '16px',
                        borderRadius: '50%',
                        margin: '0 8px',
                        backgroundColor: i === gridPageIndex ? (sessionDevice.value?.settings?.welcomeBackgroundColor || SEBlue.value) : 'rgba(255,255,255,0.4)',
                        cursor: 'pointer',
                        transition: 'background-color 0.3s ease',
                        border: i === gridPageIndex ? '2px solid white' : '2px solid transparent',
                      }} />
                    ))}
                  </div>
                )}
                {isPaginated && (
                  <>
                    <Avatar onClick={() => {
                      setGridPageIndex((gridPageIndex - 1 + totalPages) % totalPages);
                      if (gridPageTimerRef.current) clearInterval(gridPageTimerRef.current);
                    }} style={{ position: 'absolute', top: '50%', left: '0.5%', transform: 'translateY(-50%)', zIndex: 200, color: sessionDevice.value?.settings?.welcomeBackgroundColor || SEBlue.value, backgroundColor: 'rgba(255,255,255,0.8)', boxShadow: `0 0 15px ${sessionDevice.value?.settings?.welcomeBackgroundColor || SEBlue.value}, 0 4px 10px rgba(0,0,0,0.3)`}} size={80} icon={<LeftOutlined />} />
                    <Avatar onClick={() => {
                      setGridPageIndex((gridPageIndex + 1) % totalPages);
                      if (gridPageTimerRef.current) clearInterval(gridPageTimerRef.current);
                    }} style={{ position: 'absolute', top: '50%', right: '0.5%', transform: 'translateY(-50%)', zIndex: 200, color: sessionDevice.value?.settings?.welcomeBackgroundColor || SEBlue.value, backgroundColor: 'rgba(255,255,255,0.8)', boxShadow: `0 0 15px ${sessionDevice.value?.settings?.welcomeBackgroundColor || SEBlue.value}, 0 4px 10px rgba(0,0,0,0.3)`}} size={80} icon={<RightOutlined />} />
                  </>
                )}
              </div>
            </>
          );
        })()}
    </>);
  }

  const htmlShowLoginScreen = () => {
    return (<>
      <div onClick={() => {
        if (handleTouchRef.current) {
          clearTimeout(handleTouchRef.current);
          handleTouchRef.current = null;
        }
        countTimerRef.current = 30;
        setShowLoginScreen(false)
        setLibraryOfThingsGroup(null)
        setManualItemType('')
        setManualItemName('')
      }} style={style.getEmptyBackground()}></div>
      <form onSubmit={handleSubmit} style={
        stylelogin
        }>
        <style>{`
          .login-input-seblue::placeholder {
            color: ${SEBlue.value};
            opacity: 0.6;
          }
        `}</style>
        <Card variant="borderless" onClick={(e: React.MouseEvent) => {
            handleTouch(true);
            const target = e.target as HTMLElement;
            if (target.tagName !== 'INPUT') {
              setLoginKeyboardVisible(false);
            }
          }}
          style={{ boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3), 0 2px 8px rgba(0, 0, 0, 0.15)' }}
          hoverable
          cover={isLandscapeLogin ? undefined : getLoginImage()}
          >
          {/* Landscape: tiny thumbnail + info in a row */}
          {isLandscapeLogin ? (
            <Row align="middle" style={{ marginBottom: '10px' }}>
              <Col flex="160px">
                <div style={{ width: '150px', height: '150px', overflow: 'hidden', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <style>{`.login-thumb img, .login-thumb svg { width: 150px !important; height: 150px !important; max-width: 150px !important; max-height: 150px !important; object-fit: contain; padding: 0 !important; margin: 0 !important; }`}</style>
                  <span className="login-thumb">{getLoginImage()}</span>
                </div>
              </Col>
              <Col flex="auto" style={{ paddingLeft: '20px' }}>
                <div
                  style={{
                    ...getTextStyle({ color: SEBlue.value, fontStyle: 'italic' }, 11),
                    textAlign: 'left',
                    lineHeight: '1.4'
                  }}
                  dangerouslySetInnerHTML={{
                    __html: libraryOfThingsGroup.value
                      ? t(sessionDevice.value?.settings?.password ? 'SAAS.LOT.LOGIN_AND_CHECKOUT_INFO_PASSWORD' : 'SAAS.LOT.LOGIN_AND_CHECKOUT_INFO', {
                          groupName: libraryOfThingsGroup.value.name
                        })
                      : t(sessionDevice.value?.settings?.password ? 'SAAS.LOT.LOGIN_TO_CHECKOUT_INFO_PASSWORD' : 'SAAS.LOT.LOGIN_TO_CHECKOUT_INFO')
                  }}
                />
              </Col>
            </Row>
          ) : (
            <Row style={{ marginBottom: '15px' }}>
              <Col span={24}>
                <div
                  style={{
                    ...getTextStyle({ color: SEBlue.value, fontStyle: 'italic' }, 11),
                    textAlign: 'center',
                    lineHeight: '1.5'
                  }}
                  dangerouslySetInnerHTML={{
                    __html: libraryOfThingsGroup.value
                      ? t(sessionDevice.value?.settings?.password ? 'SAAS.LOT.LOGIN_AND_CHECKOUT_INFO_PASSWORD' : 'SAAS.LOT.LOGIN_AND_CHECKOUT_INFO', {
                          groupName: libraryOfThingsGroup.value.name
                        })
                      : t(sessionDevice.value?.settings?.password ? 'SAAS.LOT.LOGIN_TO_CHECKOUT_INFO_PASSWORD' : 'SAAS.LOT.LOGIN_TO_CHECKOUT_INFO')
                  }}
                />
              </Col>
            </Row>
          )}

          <Row style={{ opacity: '0.8' }}>
            <Col span={24}>
              <input
                autoFocus={!!libraryOfThingsGroup.value}
                ref={userRef}
                placeholder={t('SAAS.USERNAME_PLACEHOLDER', { defaultValue: ' username / patron' })}
                style={{ width: '100%', height: '70px', ...getTextStyle({ color: SEBlue.value }, 20), padding: '10px 15px' }}
                className="login-input-seblue"
                type="text"
                id="username"
                name="username"
                onClick={() => changeFocus('username')}
                value={username}
                onChange={onChangeUsernameInput}
                required />
            </Col>
          </Row>
          {(sessionDevice.value.settings?.password) && (
            <Row justify="center">
              <Col span={24} style={{ 'marginTop': '20px' }}>
                <input
                  ref={passRef}
                  placeholder='  password / PIN'
                  style={{ width: '100%', height: '70px', ...getTextStyle({ color: SEBlue.value }, 20), padding: '10px 15px' }}
                  className="login-input-seblue"
                  type="password"
                  id="password"
                  name="password"
                  onClick={() => changeFocus('password')}
                  value={password}
                  onChange={onChangePassworkInput}
                   />
              </Col>
            </Row>
          )}

          {/* Show item type input when login is not started from a group — demo licenses only */}
          {!libraryOfThingsGroup.value && (licenseId === 1 || licenseId === 2) && (
            <>
              <Row justify="center">
                <Col span={24} style={{ 'marginTop': '20px' }}>
                  <input
                    placeholder={t('SAAS.ITEM_TYPE_PLACEHOLDER', { defaultValue: ' Item Type (optional)' })}
                    style={{ width: '100%', height: '70px', ...getTextStyle({ color: SEBlue.value }, 20), padding: '10px 15px' }}
                    className="login-input-seblue"
                    type="text"
                    value={manualItemType}
                    onChange={(e) => setManualItemType(e.target.value)}
                  />
                </Col>
              </Row>
            </>
          )}

          <Row justify="center">
            <Col span={12}><Button size='large' style={{ 'marginTop': '20px', padding: '40px 60px', color: '#42A4DE', fontSize: '32px', fontWeight: 'bold', height: 'auto' }} type="default" onClick={() => {
              if (handleTouchRef.current) {
                clearTimeout(handleTouchRef.current);
                handleTouchRef.current = null;
              }
              countTimerRef.current = 30;
              setShowLoginScreen(false)
              setLibraryOfThingsGroup(null)
              setManualItemType('')
              setManualItemName('')
            }}> Exit </Button></Col>
            <Col span={12}><Button size='large'
              disabled={(sessionDevice.value.settings?.password) ? (username.length === 0 || password.length === 0) : username.length === 0}
              style={{ 'marginTop': '20px', padding: '40px 60px', color: 'white', backgroundColor: '#42A4DE', fontSize: '32px', fontWeight: 'bold', height: 'auto' }} type="primary" htmlType="submit"> Login </Button></Col>
          </Row>
        </Card>
      </form>
      {loginKeyboardVisible && (
        <LoginKeyboard
          ref={keyboard}
          layoutName={layout}
          onChange={focusOnUsername ? onChangeUsername : onChangePassword}
          onKeyPress={onKeyPress}
          compact={isLandscapeLogin}
          customLayout={sessionDevice.value?.settings?.customKeyboard
            ? (focusOnUsername
              ? sessionDevice.value?.settings?.customKeyboardUser
              : sessionDevice.value?.settings?.customKeyboardPassword) || undefined
            : undefined}
        />
      )}
    </>);
  }
  const htmlShowReturnInfo = () => {
    const isDonationsDialog = libraryOfThingsGroup.value?.name.toUpperCase() === 'DONATIONS';
    // Find the DONATIONS group to check for waiver text
    const donationsGroup = isDonationsDialog ? deviceGroups.find((g: any) => g.name?.toUpperCase() === 'DONATIONS') : null;
    const donationsWaiverText = donationsGroup?.waiverText || donationsGroup?.waiver;

    const getDonationsInstructions = () => {
      if (donationsWaiverText) {
        return donationsWaiverText;
      }
      return 'To donate, scan your library card, click donate and a door will open for the donation items.';
    };

    return (<>
    <div onClick={() => {
        setShowLoginScreen(false)
        setLibraryOfThingsGroup(null)
        updateShowReturnInfo(false)
      }} style={style.getEmptyBackground()}></div>
      <form onSubmit={(e) => e.preventDefault()} style={{...stylelogin, left: '50px', right: '50px', width: 'auto'}}>
        <Card variant="borderless"
          style={{ boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3), 0 2px 8px rgba(0, 0, 0, 0.15)' }}
          hoverable
          cover={getLoginImage()}
        >

          {/* Return info message */}
          <Row style={{ marginBottom: '15px' }}>
            <Col span={24}>
              <div
                style={{
                  ...getTextStyle({ color: SEBlue.value, fontWeight: 'bold' }, 20),
                  textAlign: 'center',
                  lineHeight: '1.5',
                  padding: '20px'
                }}
              >
                {isDonationsDialog ?
                  <span dangerouslySetInnerHTML={{__html: getDonationsInstructions()}} />
                  :
                  welcomeUserDisplayName ?
                    <span dangerouslySetInnerHTML={{__html: t('SAAS.LOT.RETURN_INSTRUCTIONS_TO_USER', {patronId: welcomeUserDisplayName})}} />
                    :
                    <span dangerouslySetInnerHTML={{__html: t('SAAS.LOT.RETURN_INSTRUCTIONS')}} />
                }
              </div>
            </Col>
          </Row>
          <Row justify="center">
            <Col span={24} style={{ textAlign: 'center' }}>
              <Button size='large' style={{ 'marginTop': '20px', padding: '40px 60px', color: '#42A4DE', fontSize: '32px', fontWeight: 'bold', height: 'auto' }} type="default" onClick={() => {
                setShowLoginScreen(false)
                updateShowReturnInfo(false)
                setLibraryOfThingsGroup(null)
              }}> Exit </Button>
            </Col>
          </Row>
        </Card>
      </form>

    </>);
  }


  const htmlShowPlayMode = () => {
    // Get group from Firebase Realtime DB
    const group: any = deviceGroups[playIndex.value];
    const testAnyGroupItemAvailable = anyGroupItemAvailable(group);
    const playSelectItem = () => {
      clearTimeout(timer);
      const isDonations = group.name.toUpperCase() === 'DONATIONS';
      setLibraryOfThingsGroup({name: group.name, groupIndex: isDonations ? null : playIndex.value});
      processLoginClicked();
      setPlayMode(false);
    };

    return (<>
      <div style={{
          position: 'fixed',
          top: '2px',
          left: '2px',
          right: '2px',
          bottom: '2px',
          zIndex: 9999,
          backgroundColor: '#ffffff',
          display: 'flex',
          flexDirection: 'column',
        }}>
            {/* Entire card area - tap selects the item */}
            <div
              onClick={() => playSelectItem()}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', cursor: 'pointer', minHeight: 0 }}>
              {/* Image area - fills space above title card, vertically centered */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}
                onTouchStart={(e) => {
                  const touch = e.touches[0];
                  (e.currentTarget as any)._touchStartX = touch.clientX;
                }}
                onTouchEnd={(e) => {
                  const startX = (e.currentTarget as any)._touchStartX;
                  const endX = e.changedTouches[0].clientX;
                  const diff = startX - endX;
                  if (Math.abs(diff) > 50) {
                    clearTimeout(timer);
                    setPrevImage(getImage(group?.image, group?.name));
                    if (diff > 0) {
                      // Swipe left -> next
                      setSlideDirection('left');
                      setSlideKey(prev => prev + 1);
                      if (playIndex.value < deviceGroups.length - 1) {
                        updatePlayIndex(playIndex.value + 1);
                      } else {
                        updatePlayIndex(0);
                      }
                    } else {
                      // Swipe right -> prev
                      setSlideDirection('right');
                      setSlideKey(prev => prev + 1);
                      if (playIndex.value > 0) {
                        updatePlayIndex(playIndex.value - 1);
                      } else {
                        updatePlayIndex(deviceGroups.length - 1);
                      }
                    }
                  }
                }}
              >
                {/* Old image leaving */}
                {prevImage && slideDirection && (
                  <img key={`prev-${slideKey}`} style={{
                    position: 'absolute', maxWidth: '90%', maxHeight: '90%', objectFit: 'contain',
                    animation: `slide-out-${slideDirection} 0.4s ease-in forwards`,
                  }} alt="" src={prevImage} />
                )}
                {/* New image entering */}
                <img key={slideKey} style={{
                  maxWidth: '90%', maxHeight: '90%', objectFit: 'contain',
                  animation: slideDirection ? `slide-in-${slideDirection} 0.4s ease-out` : undefined,
                }} alt="example" src={getImage(group?.image, group?.name)} />
                <style>{`
                  @keyframes slide-in-left {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                  }
                  @keyframes slide-in-right {
                    from { transform: translateX(-100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                  }
                  @keyframes slide-out-left {
                    from { transform: translateX(0); opacity: 1; }
                    to { transform: translateX(-100%); opacity: 0; }
                  }
                  @keyframes slide-out-right {
                    from { transform: translateX(0); opacity: 1; }
                    to { transform: translateX(100%); opacity: 0; }
                  }
                `}</style>
                <Avatar onClick={(e) => {
                  e.stopPropagation();
                  clearTimeout(timer);
                  setPrevImage(getImage(group?.image, group?.name));
                  setSlideDirection('right');
                  setSlideKey(prev => prev + 1);
                  if (playIndex.value > 0) {
                    updatePlayIndex(playIndex.value - 1);
                  } else {
                    updatePlayIndex(deviceGroups.length - 1);
                  }
                }} style={{ position: 'absolute', top: '50%', left: '0.5%', transform: 'translateY(-50%)', zIndex: 200, color: sessionDevice.value?.settings?.welcomeBackgroundColor || SEBlue.value, backgroundColor: 'rgba(255,255,255,0.8)', boxShadow: `0 0 15px ${sessionDevice.value?.settings?.welcomeBackgroundColor || SEBlue.value}, 0 4px 10px rgba(0,0,0,0.3)`}} size={80} icon={<LeftOutlined />} />
                <Avatar onClick={(e) => {
                  e.stopPropagation();
                  clearTimeout(timer);
                  setPrevImage(getImage(group?.image, group?.name));
                  setSlideDirection('left');
                  setSlideKey(prev => prev + 1);
                  if (playIndex.value < deviceGroups.length - 1) {
                    updatePlayIndex(playIndex.value + 1);
                  } else {
                    updatePlayIndex(0);
                  }
                }} style={{ position: 'absolute', top: '50%', right: '0.5%', transform: 'translateY(-50%)', zIndex: 200, color: sessionDevice.value?.settings?.welcomeBackgroundColor || SEBlue.value, backgroundColor: 'rgba(255,255,255,0.8)', boxShadow: `0 0 15px ${sessionDevice.value?.settings?.welcomeBackgroundColor || SEBlue.value}, 0 4px 10px rgba(0,0,0,0.3)`}} size={80} icon={<RightOutlined />} />
              </div>

              {/* Title card at bottom */}
              <div style={{
                backgroundColor: '#ffffff',
                textAlign: 'center',
                padding: '30px 40px',
                margin: '0 3%',
                marginBottom: '5%',
                borderRadius: '8px',
                cursor: 'pointer',
                boxShadow: `0 0 20px ${sessionDevice.value?.settings?.welcomeBackgroundColor || SEBlue.value}, 0 0 40px ${sessionDevice.value?.settings?.welcomeBackgroundColor || SEBlue.value}40`
              }}>
                <div style={{color: '#42A4DE', fontWeight: 'bold', ...getTextStyle({}, 35)}}>{group.name.toUpperCase()}</div>
                <div style={{color: '#42A4DE', fontWeight: 600, ...getTextStyle({}, 20), marginTop: '10px'}}>{group.description}</div>
              </div>
            </div>

      </div>
    </>);
  }

  const htmlMain = () => {
    return (
      <>
        <div className="sweet-loading" style={stylePage} onClick={() => { resetSlideshowIdleTimer(true); handleUIClick(); }}>
          {/* Hidden input for scanner/keyboard input */}
          <input
            ref={scannerInputRef}
            type="text"
            // onChange={onScannerInputChange}
            onKeyDown={(e) => {
              // Handle Enter key for immediate processing (scanner behavior)
              // if (e.key === 'Enter') {
              //   e.preventDefault();
              //   if (scannerDebounceTimerRef.current) {
              //     clearTimeout(scannerDebounceTimerRef.current);
              //   }
              //   handleScannerInput(e.currentTarget.value);
              // }
            }}
            style={{
              position: 'absolute',
              left: '-9999px',
              width: '1px',
              height: '1px',
              opacity: 0
            }}
            aria-hidden="true"
            tabIndex={-1}
          />

          { !showLoginScreen  && (loading ? '' : playMode ? htmlShowPlayMode() : htmlShowThingsGrid())}
          { showLoginScreen && !showReturnInfo.value && htmlShowLoginScreen()}
          { showReturnInfo.value && showLoginScreen && htmlShowReturnInfo()}




          {/* Guide text at bottom */}
          {!showLoginScreen && !playMode && !loading && (
            <div style={{
              position: 'fixed',
              bottom: '80px',
              left: '15%',
              right: 'calc(15% + 20px)',
              textAlign: 'center',
              color: 'white',
              textShadow: '0 0 10px rgba(66, 164, 222, 1)',
              ...getTextStyle({}, 10)
            }}>
              <style>{`
                @keyframes lot-guide-pulse {
                  from { transform: scale(1); }
                  to { transform: scale(1.03); }
                }
              `}</style>
              <span style={{ display: 'inline-block', animation: 'lot-guide-pulse 1s ease-in-out infinite alternate' }} dangerouslySetInnerHTML={{__html: t('SAAS.LOT.GUIDE')}} />
            </div>
          )}

          {!showLoginScreen && !modalOpen && (
            <ZoomLanguageControls
              languages={languges}
              showLanguageButton={configuredLangsCount > 1}
              showAccessibleModeButton={false}
              showSlideshowButton={!sessionDevice.value?.settings?.showGroupsAsSlideshow}
              showTimer={!!welcomeUserDisplayName}
              timer={sessionTimer.value}
              onTimerClick={() => {
                setWelcomeUserDisplayName(null);
                endUserMode();
              }}
              deviceId={deviceId || sessionDevice.value?.id}
              licenseId={licenseId?.toString()}
              resetSlideshowTrigger={slideshowResetTrigger}
              onLanguageClick={() => setModalOpen(true)}
              onAccessibleModeClick={() => setShowAccessibleModal(true)}
              onZoomIn={increaseFontSize}
              onZoomOut={decreaseFontSize}
            />
          )}
        </div>

        <LanguageModal
          open={modalOpen}
          onClose={() => procesModalResult(false)}
          languages={languges}
          currentLanguage={currentLang}
          onLanguageChange={changeLanguage}
          title={t("Change session language")}
          modalConfig={modalConfig}
        />

        <AccessibleModal
          open={showAccessibleModal}
          onClose={() => setShowAccessibleModal(false)}
          title={t("Accessibility Settings") || "Accessibility Settings"}
          device={sessionDevice.value}
          onDeviceUpdate={(updatedDevice) => {
            updateDevice(updatedDevice);
          }}
          onHighContrastChange={(enabled) => {
            // Clear any existing high contrast timer
            if (highContrastTimerRef.current) {
              clearTimeout(highContrastTimerRef.current);
              highContrastTimerRef.current = null;
            }
            if (enabled) {
              // Store original color before changing
              const originalColor = sessionWelcomeBackgroundColor.value || sessionDevice.value?.settings?.welcomeBackgroundColor || '#f97316';
              console.log('🎨 High Contrast enabled - setting background to black, original was:', originalColor);
              // Set background to black immediately
              updateWelcomeBackgroundColor('black');
              // Start 90s timer to restore background colors
              highContrastTimerRef.current = setTimeout(() => {
                console.log('⏱️ 90s passed - restoring background color to:', originalColor);
                updateWelcomeBackgroundColor(originalColor);
                setResetAccessibilitySettings(true);
              }, 90000);
            } else {
              // Restore original color when disabled
              const originalColor = sessionDevice.value?.settings?.welcomeBackgroundColor || '#f97316';
              console.log('🎨 High Contrast disabled - restoring background to:', originalColor);
              updateWelcomeBackgroundColor(originalColor);
            }
          }}
          onSettingsChange={() => {
            // Clear any existing timer
            if (accessibilityRestoreTimerRef.current) {
              clearTimeout(accessibilityRestoreTimerRef.current);
            }
            // Reset the reset flag
            setResetAccessibilitySettings(false);
            // Start 30s timer to restore defaults
            accessibilityRestoreTimerRef.current = setTimeout(() => {
              console.log('⏱️ 30s passed without login - restoring accessibility settings');
              // Restore device color
              const restoredDevice = {
                ...sessionDevice.value,
                welcomeBackgroundColor: sessionDevice.value.setting?.originalColor || sessionDevice.value.welcomeBackgroundColor,
                setting: {
                  ...sessionDevice.value.setting,
                  color: sessionDevice.value.setting?.originalColor || 'default'
                }
              };
              updateDevice(restoredDevice);
              // Trigger reset in modal
              setResetAccessibilitySettings(true);
            }, 30000);
          }}
          resetSettings={resetAccessibilitySettings}
        />

        {/* Admin Login Modal with PIN enforcement */}
        <AdminLoginModal
          open={showLoginAdminModal}
          onClose={() => setShowLoginAdminModal(false)}
          onSuccess={() => {
            setShowLoginAdminModal(false);
            setLocation('/admin');
          }}
          customStaffPin={config.customStaffPin}
        />

        {/* Hold Request Modal - auto-closes after 5 seconds */}
        <Modal
          open={showHoldRequestModal}
          onCancel={() => {
            setShowHoldRequestModal(false);
            setHoldRequestInfo(null);
          }}
          footer={null}
          centered
          width={500}
          closable={true}
        >
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <h2 style={{ color: '#42A4DE', marginBottom: '20px', ...getTextStyle({}, 15) }}>
              {t('SAAS.HOLD_REQUESTED', { defaultValue: 'Hold Requested' })}
            </h2>
            <p style={{ fontSize: '18px', marginBottom: '15px', ...getTextStyle({}, 10) }}>
              {t('SAAS.HOLD_REQUEST_MESSAGE', {
                patronId: holdRequestInfo?.patronId,
                groupName: holdRequestInfo?.groupName,
                defaultValue: `Patron ${holdRequestInfo?.patronId} requested a hold for ${holdRequestInfo?.groupName}.`
              })}
            </p>
            {(holdRequestInfo?.itemType || holdRequestInfo?.itemName) && (
              <p style={{ fontSize: '16px', marginBottom: '15px', ...getTextStyle({}, 8) }}>
                {holdRequestInfo?.itemType && <span><strong>{t('SAAS.ITEM_TYPE', { defaultValue: 'Item Type' })}:</strong> {holdRequestInfo.itemType}</span>}
                {holdRequestInfo?.itemType && holdRequestInfo?.itemName && <span> &bull; </span>}
                {holdRequestInfo?.itemName && <span><strong>{t('SAAS.ITEM_NAME', { defaultValue: 'Item Name' })}:</strong> {holdRequestInfo.itemName}</span>}
              </p>
            )}
            <p style={{ fontSize: '16px', color: '#666', ...getTextStyle({}, 5) }}>
              {t('SAAS.HOLD_REQUEST_SENT', { defaultValue: 'Request sent to library system.' })}
            </p>
          </div>
        </Modal>

        {/* Checkout Confirmation Modal */}
        <Modal
          open={showCheckoutConfirmModal}
          onCancel={() => {
            setShowCheckoutConfirmModal(false);
            setLibraryOfThingsGroup(null);
          }}
          footer={null}
          centered
          width="80%"
          closable={false}
        >
          <div style={{ textAlign: 'center', padding: '20px' }}>
            {libraryOfThingsGroup.value && (() => {
              const group = deviceGroups[libraryOfThingsGroup.value.groupIndex];
              return group?.image ? (
                <img
                  style={{ maxWidth: '100%', height: fontSize.value > 20 ? '300px' : '400px', objectFit: 'contain', margin: '0 auto 20px', display: 'block' }}
                  alt={libraryOfThingsGroup.value.name}
                  src={getImage(group.image, libraryOfThingsGroup.value.name)}
                />
              ) : null;
            })()}
            <h2 style={{ ...getTextStyle({}, 15), color: SEBlue.value, marginBottom: '20px' }}>
              {t('SAAS.LOT.CHECKOUT_CONFIRM_TITLE', { defaultValue: 'Confirm Checkout' })}
            </h2>
            <p style={{ ...getTextStyle({}, 10), color: '#333', marginBottom: '40px', lineHeight: '1.5' }}>
              {t('SAAS.LOT.CHECKOUT_CONFIRM_MESSAGE', {
                groupName: libraryOfThingsGroup.value?.name || '',
                defaultValue: `You are about to checkout ${libraryOfThingsGroup.value?.name || 'this item'}. Confirm to continue or cancel to select something else.`
              })}
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '40px' }}>
              <Button
                size="large"
                style={{ flex: 1, maxWidth: '300px', height: 'auto', padding: '30px 20px', fontSize: '28px', fontWeight: 'bold', color: SEBlue.value }}
                onClick={() => {
                  setShowCheckoutConfirmModal(false);
                  setLibraryOfThingsGroup(null);
                }}
              >
                {t('SAAS.CANCEL', { defaultValue: 'Cancel' })}
              </Button>
              <Button
                type="primary"
                size="large"
                style={{ flex: 1, maxWidth: '300px', height: 'auto', padding: '30px 20px', fontSize: '28px', fontWeight: 'bold', backgroundColor: SEBlue.value, borderColor: SEBlue.value }}
                onClick={() => {
                  setShowCheckoutConfirmModal(false);
                  setLocation('/lotcheckout');
                  exit();
                }}
              >
                {t('SAAS.CONFIRM', { defaultValue: 'Confirm' })}
              </Button>
            </div>
          </div>
        </Modal>

        {/* Hold Pickup Confirmation Modal */}
        <Modal
          open={showHoldPickupModal}
          onCancel={() => {
            setShowHoldPickupModal(false);
            setHoldPickupInfo(null);
            endUserMode();
          }}
          footer={null}
          centered
          width="calc(100vw - 40px)"
          closable={false}
          styles={{ body: { padding: '40px' } }}
        >
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <h2 style={{ color: SEBlue.value, marginBottom: '30px', fontSize: '48px', fontWeight: 'bold' }}>
              {holdPickupQueue.length > 0
                ? `You have ${holdPickupQueue.length + 1} holds waiting`
                : 'You have a hold waiting'
              } <span style={{ fontSize: '36px', color: '#999' }}>({holdPickupTimer}s)</span>
            </h2>
            <p style={{ fontSize: '36px', marginBottom: '20px', lineHeight: '1.4' }}>
              Your hold from <b>{holdPickupInfo?.groupName}</b> is ready for pickup at door <b>#{holdPickupInfo?.doorNumber}</b>.
            </p>
            {holdPickupQueue.length > 0 && (
              <p style={{ fontSize: '28px', marginBottom: '15px', color: '#faad14', fontWeight: 'bold' }}>
                Doors will be opened one at a time. After this checkout, the next hold will follow.
              </p>
            )}
            <p style={{ fontSize: '32px', marginBottom: '40px', color: '#666' }}>
              Click continue to proceed with the hold checkout.
            </p>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '20px' }}>
              <Button
                size="large"
                style={{ flex: 1, height: 'auto', padding: '30px 20px', fontSize: '28px' }}
                onClick={() => {
                  localStorage.removeItem('holdPickupQueue');
                  setShowHoldPickupModal(false);
                  setHoldPickupInfo(null);
                  setHoldPickupQueue([]);
                  endUserMode();
                }}
              >
                Cancel
              </Button>
              <Button
                danger
                size="large"
                style={{ flex: 1, height: 'auto', padding: '30px 20px', fontSize: '28px' }}
                onClick={async () => {
                  if (holdPickupInfo) {
                    // Change locker patronId from patron to 'All'
                    const groups = sessionDevice.value?.manifest?.groups;
                    if (groups) {
                      const groupEntries = Array.isArray(groups) ? groups.map((g: any, i: number) => [i, g]) : Object.entries(groups);
                      for (const [, group] of groupEntries) {
                        if (!group?.lockers) continue;
                        const lockerEntries = Array.isArray(group.lockers) ? group.lockers.entries ? [...group.lockers.entries()] : Object.entries(group.lockers) : Object.entries(group.lockers);
                        for (const [, locker] of lockerEntries) {
                          if (locker && locker.patronId === holdPickupInfo.patronId && String(locker.doorNumber || locker.door) === holdPickupInfo.doorNumber) {
                            locker.patronId = 'All';
                            console.log(`🔓 Hold cancelled: door #${locker.doorNumber} patronId set to 'All'`);
                            break;
                          }
                        }
                      }
                      await persistDeviceManifestChanges(sessionDevice.value.manifest);
                      customToast(() => (<b>Hold cancelled</b>), 2000, 'default', 'dark');
                    }
                  }
                  localStorage.removeItem('holdPickupQueue');
                  setShowHoldPickupModal(false);
                  setHoldPickupInfo(null);
                  setHoldPickupQueue([]);
                  endUserMode();
                }}
              >
                Cancel my hold
              </Button>
              <Button
                type="primary"
                size="large"
                style={{ flex: 1, height: 'auto', padding: '30px 20px', fontSize: '28px', backgroundColor: '#52c41a', borderColor: '#52c41a' }}
                onClick={() => {
                  if (holdPickupInfo) {
                    // Save remaining holds queue for after this checkout completes
                    if (holdPickupQueue.length > 0) {
                      localStorage.setItem('holdPickupQueue', JSON.stringify(holdPickupQueue));
                      console.log(`📦 Saved ${holdPickupQueue.length} remaining hold(s) to queue`);
                    } else {
                      localStorage.removeItem('holdPickupQueue');
                    }
                    setShowHoldPickupModal(false);
                    setHoldPickupInfo(null);
                    setHoldPickupQueue([]);
                    setLibraryOfThingsGroup({ name: holdPickupInfo.groupName, groupIndex: holdPickupInfo.groupIndex });
                    setTimeout(() => {
                      setLocation('/lotcheckout');
                    }, 100);
                  }
                }}
              >
                Continue
              </Button>
            </div>
          </div>
        </Modal>

        {/* Duplicate Item Warning Dialog */}
        <Modal
          open={showDuplicateItemWarning}
          onCancel={() => {
            setShowDuplicateItemWarning(false);
            setDuplicateItemInfo(null);
            setLoading(false);
            processingItemRef.current = false;
          }}
          footer={null}
          width="100%"
          style={{ top: 0, maxWidth: '100%', paddingBottom: 0 }}
          styles={{ body: { height: '100vh', padding: 0, backgroundColor: 'white' } }}
          centered
        >
          <div style={{
            padding: '60px 40px',
            textAlign: 'center',
            backgroundColor: 'white',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center'
          }}>
            <div style={{ fontSize: '48px', fontWeight: 'bold', color: '#ff6b6b', marginBottom: '40px' }}>
              ⚠️ Item Already in Locker
            </div>
            <div style={{ fontSize: '32px', marginBottom: '60px', lineHeight: '1.8' }}>
              <p>Item ID: <strong>{duplicateItemInfo?.itemId}</strong></p>
              <p>Door Number: <strong>#{duplicateItemInfo?.doorNumber}</strong></p>
              <p>Patron: <strong>{duplicateItemInfo?.patronId}</strong></p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '25px', width: '80%', maxWidth: '800px' }}>
              <Button
                type="primary"
                size="large"
                onClick={() => {
                  setShowDuplicateItemWarning(false);
                  setAdminPinInput(''); // Clear PIN input
                  if (keyboard.current) {
                    keyboard.current.clearInput(); // Clear keyboard
                  }
                  setShowAdminPinDialog(true);
                  processingItemRef.current = false;
                  // Keep loading true while PIN dialog is shown
                }}
                style={{ fontSize: '28px', height: '100px', backgroundColor: '#1890ff', fontWeight: 'bold' }}
              >
                Re-open Door (Requires Admin PIN)
              </Button>
              <Button
                size="large"
                onClick={() => {
                  setShowDuplicateItemWarning(false);
                  setDuplicateItemInfo(null);
                  setLoading(false);
                  processingItemRef.current = false;
                  // User can scan/enter a new itemId
                  toast.info('Please scan or enter a different item ID');
                }}
                style={{ fontSize: '28px', height: '100px', fontWeight: 'bold' }}
              >
                Change Item ID
              </Button>
              <Button
                danger
                size="large"
                onClick={() => {
                  setShowDuplicateItemWarning(false);
                  setDuplicateItemInfo(null);
                  setLoading(false);
                  processingItemRef.current = false;
                }}
                style={{ fontSize: '28px', height: '100px', fontWeight: 'bold' }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </Modal>

        {/* Admin PIN Dialog */}
        <Modal
          open={showAdminPinDialog}
          onCancel={() => {
            setShowAdminPinDialog(false);
            setAdminPinInput('');
            setLoading(false);
          }}
          footer={null}
          width="100%"
          style={{ top: 0, maxWidth: '100%', paddingBottom: 0 }}
          styles={{ body: { height: '100vh', padding: 0, backgroundColor: 'white' } }}
          closeIcon={null}
        >
          <div style={{
            padding: '60px 40px',
            backgroundColor: 'white',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center'
          }}>
            <div style={{ fontSize: '48px', fontWeight: 'bold', color: '#1890ff', marginBottom: '40px' }}>
              🔐 Enter Admin PIN
            </div>

            <div style={{ marginBottom: '40px', width: '80%', maxWidth: '800px' }}>
              <input
                type="text"
                value={adminPinInput}
                readOnly
                placeholder="Enter PIN"
                style={{
                  fontSize: '48px',
                  padding: '30px',
                  width: '100%',
                  textAlign: 'center',
                  border: '3px solid #1890ff',
                  borderRadius: '8px',
                  backgroundColor: '#f5f5f5',
                  letterSpacing: '10px'
                }}
              />
            </div>

            {/* On-screen Keyboard */}
            <div style={{ width: '80%', maxWidth: '800px', marginBottom: '40px' }}>
              <Keyboard
                keyboardRef={r => (keyboard.current = r)}
                layoutName="default"
                onChange={(input) => {
                  console.log('Keyboard input:', input);
                  setAdminPinInput(input);
                }}
                layout={{
                  default: ["1 2 3", "4 5 6", "7 8 9", "{bksp} 0"]
                }}
                display={{
                  "{bksp}": "⌫ Delete"
                }}
                theme="hg-theme-default hg-layout-numeric"
                buttonTheme={[
                  {
                    class: "hg-red",
                    buttons: "{bksp}"
                  }
                ]}
              />
            </div>

            <div style={{ display: 'flex', gap: '25px', width: '80%', maxWidth: '800px' }}>
              <Button
                type="primary"
                onClick={() => {
                  const configPin = kioskConfig.value?.adminPin || '20212022';
                  console.log('🔐 PIN Check - Entered:', adminPinInput, 'Expected:', configPin);

                  if (adminPinInput === configPin) {
                    console.log('✅ PIN Correct!');

                    // Re-open the door
                    if (duplicateItemInfo) {
                      const doorNum = duplicateItemInfo.doorNumber;
                      const itemId = duplicateItemInfo.itemId;

                      // Show custom toast
                      customToast(
                        () => (
                          <div style={{ textAlign: 'center' }}>
                            <b style={{ color: SEBlue.value }}>✅ PIN Correct!</b>
                            <br />
                            <span>Door {doorNum} is opening for item {itemId}</span>
                          </div>
                        ),
                        3000,
                        'default',
                        'dark'
                      );

                      console.log(`🚪 Opening door ${doorNum} for item ${itemId}`);
                      openDoor(sessionDevice.value.config.locker.mac, doorNum);
                      testDoorAfterOpen(sessionDevice.value.config.locker.mac, doorNum);

                      // Create return_item event
                      try {
                        createReturnItemEvent({
                          itemIds: [itemId],
                          patronId: duplicateItemInfo.patronId || '',
                          doorNumber: doorNum,
                          success: true
                        });
                      } catch (txErr) {
                        console.error('❌ Failed to create return_item event:', txErr);
                      }

                      setDuplicateItemInfo(null);
                    }

                    setShowAdminPinDialog(false);
                    setAdminPinInput('');
                    setLoading(false);
                    if (keyboard.current) {
                      keyboard.current.clearInput();
                    }
                  } else {
                    console.log('❌ PIN Incorrect');

                    // Show error toast
                    customToast(
                      () => (
                        <div style={{ textAlign: 'center' }}>
                          <b style={{ color: 'red' }}>❌ Incorrect PIN</b>
                          <br />
                          <span>Please try again</span>
                        </div>
                      ),
                      2000,
                      'default',
                      'dark'
                    );

                    setAdminPinInput('');
                    if (keyboard.current) {
                      keyboard.current.clearInput();
                    }
                    // Keep loading true for incorrect PIN so user can try again
                  }
                }}
                style={{ fontSize: '28px', height: '100px', flex: 1, fontWeight: 'bold' }}
              >
                Confirm PIN
              </Button>
              <Button
                danger
                onClick={() => {
                  setShowAdminPinDialog(false);
                  setAdminPinInput('');
                  setLoading(false);
                  if (keyboard.current) {
                    keyboard.current.clearInput();
                  }
                }}
                style={{ fontSize: '28px', height: '100px', flex: 1, fontWeight: 'bold' }}
              >
                Cancel
              </Button>
            </div>
          </div>
        </Modal>

        <ToastContainer
            style={style2}
            position="top-center"
            autoClose={2000}
            hideProgressBar
            newestOnTop={false}
            closeOnClick
            rtl={false}
            pauseOnFocusLoss={false}
            draggable={false}
            pauseOnHover={false}
            theme="light">

        </ToastContainer>
      </>
    );
  }

  return htmlMain();
}

