import React, { useState, useRef, useEffect, CSSProperties, useCallback } from 'react';
import { effect, computed } from '@preact/signals-react'
import { signal } from '@preact/signals-react'

import { useLocation } from 'wouter';
import { useTranslation } from 'react-i18next';
import { Row, Col, Button,Card, Modal, Avatar, Space, Badge, Spin, Input } from 'antd';
import _, { result, over, slice, toSafeInteger } from 'lodash';
import { ToastContainer } from 'react-toastify';
import { classifyBarcode } from '../helpers/barcodeClassifier';
import { cachedAdminCardBarcode, lastILSItemLookup } from '../helpers/adminFeedHoldsMode';
import * as ProcessHoldItemInHelpers from '../helpers/processHoldItemIn';
import { getNextHoldModeDoorNro, filterSelectedSize, getAvailableDoorsWithSizes } from '../helpers/getNextHoldModeDoorNro';
import { sessionDoorStatus, sessionTimer, updateSessionTimer, sessionDevice, sessionBackgroundImage,
  sessionDeviceId, updateLocation, sessionLang, updateLang,
  sessionBranch, sessionLicense, sessionLicenseId, kioskConfig, sessionError, updateSessionError,
  sessionLocation, updateSessionBarcode, sessionBarcode, updateDevice, updateSessionDoorStatus, sessionIsReady,validateItemInfo,validateIsSipOk,
  sessionWizard, setSessionWizard, persistDeviceManifestChanges, persistDeviceTheDoorsChanges, sessionStaffModeOn, updateSessionStaffModeOn,
  updateSessionUserModeOn, sessionUserModeOn, updateShowBackgroundImage,
  SEBlue,
  customToast,
  SEBlueWithOpasity,
  localized,
  sessionSystemLang, slideshowActive, readHistory, adminAutoOpenDoor,
  sessionWelcomeBackgroundColor, sessionWelcomeBackgroundImage} from "../state/shared";
import { getLockerStatus, isDoorOpen, openDoor, anyDoorOpen, getDoorOpenFromRTDB } from "../state/locker";
import config from '../../../config';
import { createCheckinTransaction } from '../state/transaction-service';

import * as style from '../App.styles';
import { MdTouchApp, MdLanguage, MdClose, MdDoorFront } from "react-icons/md";
import {AiOutlineClockCircle, AiOutlinePlusCircle, AiOutlineMinusCircle} from "react-icons/ai";
import 'react-simple-keyboard/build/css/index.css';
import { Promise } from "bluebird";
import { useSignals } from "@preact/signals-react/runtime";
import { rfidItemId } from 'renderer/state/rfid';
import { fontSize, updateFontSize, getTextStyle } from "../state/shared";
import Spinner from 'renderer/components/spinner';
import LoginKeyboard from 'renderer/components/LoginKeyboard';
import AdminLoginModal from 'renderer/components/AdminLoginModal';
import ZoomLanguageControls from 'renderer/components/ZoomLanguageControls';
import { useSlideshowReset } from 'renderer/hooks/useSlideshowReset';
import LanguageModal from 'renderer/components/LanguageModal';
import AccessibleModal from 'renderer/components/AccessibleModal';
import ItemAlreadyInLockerModal from 'renderer/components/ItemAlreadyInLockerModal';
import ErrorModal from 'renderer/components/ErrorModal';
import { CheckOutlined } from '@ant-design/icons';
let patronCooldownTime = 0;
let testUserList:any = [];


import moment = require('moment');
import { getOrCreatePatron, updatePatron, trackNewPatronUsage } from 'renderer/state/firestore';
import { FirebaseSIP2 } from '../state/shared';
import { patronLatestLocker } from '../helpers/lockerHelpers';
import { hasAnyEmptyLockers } from '../helpers/processHoldItemIn';
import { getLicenseDatabase } from '../state/firebase-client';
import { ref, get, push, set } from 'firebase/database';

// Polaris API endpoint
const POLARIS_API_BASE = 'https://polarisapi-be4ekemxaa-uc.a.run.app';
const nextLockerNro = signal<number>(0)
const setNextLockerNro = (nro: number) => {
  nextLockerNro.value = nro;
}
const testedOpenDoor = signal<number>(null);
const setTestedOpenDoor = (nro: number) => {
  testedOpenDoor.value = nro;
}
const splitMode = signal<boolean>(false);
const setSplitMode = (val: boolean) => {
  splitMode.value = val;
}
// Removed global timer - now using ref
let showKeyboardInit = true;


export default function HomeHoldPage() {
  useSignals();
  updateLocation('/')
  const allLanguages = localized.value;
  // Filter languages based on settings.langs from device
  // Handle array, Firebase RTDB array (numeric keys), and object formats
  const configuredLangs = sessionDevice.value?.settings?.langs;
  const getLangKeys = (): string[] | null => {
    if (!configuredLangs) return null;
    // Handle string format "en, it" or "en,it"
    if (typeof configuredLangs === 'string') {
      return configuredLangs.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
    }
    if (Array.isArray(configuredLangs)) return configuredLangs;
    const keys = Object.keys(configuredLangs);
    if (keys.length === 0) return null;
    // Check if keys are numeric (Firebase RTDB array format)
    if (keys.every(k => !isNaN(Number(k)))) {
      return Object.values(configuredLangs) as string[];
    }
    return keys;
  };
  const langKeys = getLangKeys();

  // Build language list from configured langs, with fallback for missing localization data
  const languges = langKeys && langKeys.length > 0
    ? langKeys.reduce((result: any, langKey: string) => {
        if (allLanguages[langKey]) {
          result[langKey] = allLanguages[langKey];
        } else {
          // Fallback for languages without localization data
          result[langKey] = {
            translation: {
              name: langKey.toUpperCase(),
              icon: `https://flagicons.lipis.dev/flags/4x3/${langKey}.svg`
            }
          };
        }
        return result;
      }, {})
    : allLanguages;
  const lang = sessionLang.value;
  const systemLang = sessionSystemLang.value;
  const config = kioskConfig.value;
  const deviceId = sessionDeviceId.value;
  const branch = sessionBranch.value;
  const license = sessionLicense.value;
  const licenseId = sessionLicenseId.value;
  // Don't create snapshot - use sessionDevice.value directly for real-time RTDB updates
  const [sessionExistingItemsCount, setSessionExistingItemsCount] = useState<number>(0);
  const [, setLocation] = useLocation();
  const { i18n, t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [showAdminLoginKeyboard, setShowAdminLoginKeyboard] = useState(false);
  const [showLoginAdminModal, setShowLoginAdminModal] = useState(false);
  const [showAccessibilityModal, setShowAccessibilityModal] = useState(false);
  const [resetAccessibilitySettings, setResetAccessibilitySettings] = useState(false);
  const accessibilityRestoreTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [showItemAlreadyInLockerModal, setShowItemAlreadyInLockerModal] = useState(false);
  const [alreadyInLockerItemId, setAlreadyInLockerItemId] = useState<string>('');
  const [alreadyInLockerDoorNumber, setAlreadyInLockerDoorNumber] = useState<number>(0);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorModalConfig, setErrorModalConfig] = useState<{
    severity: 'error' | 'warning' | 'info' | 'success';
    title: string;
    body: string;
    footer?: string;
    timer?: number;
  }>({
    severity: 'error',
    title: 'Error',
    body: '',
    footer: '',
    timer: 5
  });
  const { slideshowResetTrigger, triggerSlideshowReset } = useSlideshowReset();

  const [layout, setLayout] = useState("default");
  const [focusOnUsername, setFocusOnUsername] = useState(true);
  const [patronPreference, setPatronPreference] = useState<string>(null);
  const [isADA, setIsADA] = useState<boolean>(false);
  const [oldLockerNro, setOldLockerNro] = useState<number>(0);
  const [showWelcomeModal, setShowWelcomeModal] = useState<boolean>(false);
  const [welcomePatronKey, setWelcomePatronKey] = useState<string>('');
  const [welcomeCountdown, setWelcomeCountdown] = useState<number>(30);
  const welcomeTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [emptyLockers, setEmptyLockers] = useState<number[]>([]);
  const [showAddHoldInfo, setShowAddHoldInfo] = useState<boolean>(false);
  const [selectionProtected, setSelectionProtected] = useState<boolean>(false);
  const [moveItemToNewLocker, setMoveItemToNewLocker] = useState<boolean>(false);
  const [showAddHoldInfoSizeOptions, setShowAddHoldInfoSizeOptions] = useState<boolean>(false);
  const [allAvailableDoorsWithSizes, setAllAvailableDoorsWithSizes] = useState<any>({
    normal: [],
    ada: [],
  });
  const [showDoorButtons, setShowDoorButtons] = useState<boolean>(false);
  const [overflowSuccessInfo, setOverflowSuccessInfo] = useState<{shelfLabel: string, deviceName: string} | null>(null);
  const [reopenClicked, setReopenClicked] = useState<number>(0);
  const handleTouchRef = useRef<NodeJS.Timeout | null>(null);
  const timerRef = useRef<number>(30);
  const handleExitCountdownTimerRef = useRef(null);
  const keyboard: any = useRef();
  const userRef: any = useRef(null);
  const passRef: any = useRef(null);
  const scannerInputRef = useRef<HTMLInputElement>(null);
  const scannerDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  let forceLogin = false;
  const errorReport = sessionError.value;



  const increaseFontSize = () => {
    const result = Math.min(fontSize.value + 2, 40);
    updateFontSize(result);
  };

  const decreaseFontSize = () => {
    const result = Math.max(fontSize.value - 2, 16);
    updateFontSize(result);
  };

  const handleUIClick = triggerSlideshowReset;

  const fontControlStyle: React.CSSProperties = {
    position: 'fixed',
    top: '20px',
    //bottom: '62px',
    right: '20px',
    display: 'flex',
    gap: '10px',
    opacity: 0.8,
    zIndex: 1000,
  };

  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`;
  }, [fontSize]);

  // Auto-focus scanner input on mount and refocus when modals close
  useEffect(() => {
    const focusScannerInput = () => {
      if (scannerInputRef.current && !showKeyboard && !showAdminLoginKeyboard && !showLoginAdminModal && !showAccessibilityModal && !showItemAlreadyInLockerModal && !showErrorModal) {
        scannerInputRef.current.focus();
      }
    };

    // Focus immediately on mount
    focusScannerInput();

    // Refocus when any modal closes
    const timer = setInterval(focusScannerInput, 500);

    return () => clearInterval(timer);
  }, [showKeyboard, showAdminLoginKeyboard, showLoginAdminModal, showAccessibilityModal, showItemAlreadyInLockerModal, showErrorModal]);

  // Pause/resume background video when login keyboard opens/closes
  useEffect(() => {
    if (showKeyboard) {
      stopVideo();
    } else {
      startVideo();
    }
  }, [showKeyboard]);

  // Handle scanner/keyboard input with debounce
  const handleScannerInput = (value: string) => {
    if (!value || value.trim() === '') return;

    const trimmedValue = value.trim();
    console.log('📟 Scanner input received:', trimmedValue);

    // Process the input through the existing barcode workflow
    // This triggers the useEffect at line 296 which calls enableBarcodeMode
    updateSessionBarcode(trimmedValue);

    // Clear the input for next scan
    if (scannerInputRef.current) {
      scannerInputRef.current.value = '';
    }
  };

  const onScannerInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;

    // Clear existing debounce timer
    if (scannerDebounceTimerRef.current) {
      clearTimeout(scannerDebounceTimerRef.current);
    }

    // Set new debounce timer for 1 second
    scannerDebounceTimerRef.current = setTimeout(() => {
      handleScannerInput(value);
    }, 1000);
  };


  function randomIntFromInterval(min, max) {
      return Math.floor(Math.random() * (max - min + 1) + min);
  }

  function testPatron() {
      let testVlue = randomIntFromInterval(1, 5);
      return '2' + (testVlue);
  }

  function testItem() {
    let testVlue = randomIntFromInterval(0, 9);
    return '3' + (testVlue);
  }

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

  const enableBarcodeMode = async (barcode: string) => {


    if (!barcode || barcode === '' || sessionLocation.value !== '/') {
      return;
    }

    updateSessionBarcode('');
    const reScanDelay = 10;
    if (!barcode || (barcode && readHistory[barcode])) {
      if (readHistory[barcode] === 1) {
        customToast(() => (<b>Barcode was already read, please wait up to {reScanDelay}s before re-scanning</b>), 3000, 'default', 'dark');
        readHistory[barcode] = 2;
      }
      return;
    }
    readHistory[barcode] = 1;
    Promise.delay(reScanDelay * 1000).then(() => {
      delete readHistory[barcode];
    });

    if (barcode.length && sessionLocation.value === '/') {
      handleTouch(false);
      setLoading(true);

      const classification = await classifyBarcode(barcode, {
        branch,
        licenseId,
        device: sessionDevice.value,
        adminPin: kioskConfig.value?.adminPin,
        customStaffPin: kioskConfig.value?.device?.settings?.customStaffPin,
        checkOffline: true,
      });

      // staffCard
      if (classification === 'staffCard') {
        setLoading(false);
        processStaffCard(barcode);
        return;
      }
      // blocked by offline mode
      if (classification === 'blocked') {
        setLoading(false);
        customToast(() => <div style={{ textAlign: 'center' }}><b>Offline mode</b><br /><span>Adding hold items is not available while offline</span></div>, 4000, 'warning', 'dark');
        return;
      }
      // is item — keep spinner on until wizard opens (processHoldItem manages loading state)
      if (classification === 'item' || classification === 'deviceReturn') {
        processHoldItem(barcode);
      }
      // is patron — keep loading spinner on through processLoginOptions
      else if (classification === 'patron') {
        stopVideo();
        setUsername(barcode)
        processLoginOptions(barcode, '')
      } else {
        setLoading(false);
      }
    }

  };

  useEffect(() => {
    updateShowBackgroundImage(true);
    clearUserSessionData();
 }, []);

  // Welcome modal countdown — auto-select "any" after 30s
  useEffect(() => {
    if (showWelcomeModal) {
      setWelcomeCountdown(30);
      welcomeTimerRef.current = setInterval(() => {
        setWelcomeCountdown(prev => {
          if (prev <= 1) {
            if (welcomeTimerRef.current) clearInterval(welcomeTimerRef.current);
            handleWelcomePreferenceSelect('any');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (welcomeTimerRef.current) {
        clearInterval(welcomeTimerRef.current);
        welcomeTimerRef.current = null;
      }
    }
    return () => {
      if (welcomeTimerRef.current) clearInterval(welcomeTimerRef.current);
    };
  }, [showWelcomeModal]);

  // Debug: track loading and testedOpenDoor changes
  useEffect(() => {
    console.log(`🔍 HomeHold render state - loading: ${loading}, testedOpenDoor: ${testedOpenDoor.value}`);
  }, [loading, testedOpenDoor.value]);

  // Door close detection is handled inside exitCountdownTimer (checks every 1s)

  useEffect(() => {
    // Ignore barcode scans when staff wizard is open
    if (sessionStaffModeOn.value) return;
    if (sessionBarcode.value?.length) {
      enableBarcodeMode(sessionBarcode.value);
    }
  }, [sessionBarcode.value]);

  useEffect(() => {
    // Ignore RFID scans when staff wizard is open
    if (sessionStaffModeOn.value) {
      // Still clear the rfidItemId to prevent it from triggering later
      if (rfidItemId.value?.length) {
        rfidItemId.value = '';
      }
      return;
    }
    if (rfidItemId.value?.length) {
      const itemId = rfidItemId.value;
      enableBarcodeMode(itemId);
      // Clear rfidItemId after use to allow re-reading the same tag
      setTimeout(() => {
        rfidItemId.value = '';
      }, 2000);
    }
  }, [rfidItemId.value]);

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

        keyboard.current.setInput(username)
        setFocusOnUsername(true)
        break;
      case 'password':
        keyboard.current.setInput(password)
        setFocusOnUsername(false)
        break;

      default:

        resetKeybard()
        setFocusOnUsername(false)
        break;
    }
  }

  const resetKeybard = () => {
    showKeyboardInit = true;
    setShowKeyboard(false);
    timerRef.current = 30;
    setUsername('')
    setPassword('')
    keyboard?.current?.setInput(null);
  }

  useEffect(() => {
    if (keyboard.current) {
      keyboard.current.setOptions({
        style: {
          fontSize: '30px'
        }
      });
    }
  }, [keyboard]);

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
        timerRef.current = 30; // Reset timer when showing keyboard
        Promise.delay(200).then(() => userRef.current?.focus())
      }

      handleTouchRef.current = setTimeout(() => {
        // If staff wizard or user session started, clear the login timer silently
        if (sessionStaffModeOn.value || sessionUserModeOn.value) {
          handleTouchRef.current = null;
          return;
        }

        console.log('⏱️ Login timeout countdown:', timerRef.current);

        if (timerRef.current > 0 && sessionLocation.value === '/') {
          timerRef.current = timerRef.current - 1;
          handleTouch(true);
        } else {
          console.log('⏱️ Login timeout expired - resetting keyboard');
          resetKeybard();
        }

      }, 1000);

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
    };
  }, []);

  // Track when a door is opened — for door close detection grace period
  useEffect(() => {
    if (testedOpenDoor.value !== null) {
      doorOpenedAtRef.current = Date.now();
      console.log(`🚪 doorOpenedAtRef set: door ${testedOpenDoor.value}`);
    }
  }, [testedOpenDoor.value]);

  // Show door buttons immediately when default locker screen is shown
  useEffect(() => {
    if (testedOpenDoor.value !== null && !splitMode.value) {
      setShowDoorButtons(true);
    }
    return () => {};
  }, [testedOpenDoor.value, splitMode.value]);

  const override: CSSProperties = {
    display: 'block',
    margin: '0 auto',
    borderColor: 'blue',
  }


  function procesModalResult(decision: boolean) {
    setModalOpen(decision)
  }

  async function processStaffCard(barcode:string) {
    updateShowBackgroundImage(false);

    const staffPin = kioskConfig.value?.adminPin || '20212022';
    const customPin = kioskConfig.value?.device?.settings?.customStaffPin;
    const localPin = (window as any).electronAPI?.getLocalConfig()?.customStaffPin;

    const upper = barcode.toUpperCase();
    if (upper === staffPin.toUpperCase() || (customPin && upper === customPin.toUpperCase()) || (localPin && upper === localPin.toUpperCase()) || (cachedAdminCardBarcode && upper === cachedAdminCardBarcode.toUpperCase())) {
      setLocation('/admin');
      endStaffMode();
      return;
    }

    // Check scannedinput staffcard rule (case-insensitive)
    const scannedinput = sessionDevice.value?.scannedinput || kioskConfig.value?.device?.scannedinput;
    if (scannedinput?.staffcardEnabled && scannedinput?.staffcardRule) {
      const rule = scannedinput.staffcardRule;
      const ruleType = Array.isArray(scannedinput.staffcardRuleType) ? scannedinput.staffcardRuleType[0] : scannedinput.staffcardRuleType;
      try {
        let pattern = rule;
        if (ruleType === 'startsWith') pattern = `^${rule}`;
        else if (ruleType === 'endsWith') pattern = `${rule}$`;
        else if (ruleType === 'exact') pattern = `^${rule}$`;
        if (new RegExp(pattern, 'i').test(barcode)) {
          setLocation('/admin');
          endStaffMode();
          return;
        }
      } catch (e) { /* invalid regex, fall through */ }
    }

    customToast(() => (<b>Unknown user, please try again or contact system admin</b>), 3000, 'default', 'dark');
    endStaffMode();
  }

  function openErrorView(customTime = 4000, message?:string, severity: 'error' | 'warning' | 'info' | 'success' = 'error', title?: string) {
    setErrorModalConfig({
      severity: severity,
      title: title || 'Error',
      body: message || errorReport.message,
      footer: 'Please try again or contact staff for assistance',
      timer: Math.ceil(customTime / 1000) // Convert milliseconds to seconds
    });
    setShowErrorModal(true);
  }

  function openInfoView(message:string) {
    customToast(() => (<b style={{color: SEBlue.value}}>Info {message}</b>), 3000, 'default');
  }

  // LEGACY REST CALL REMOVED - loginWithCard function
  // async function loginWithCard(user: any, branchId:any) {
  //   if (+user.licenseId === 104 || +user.licenseId === 112) {
  //     return await request(EndPoint.SIDEEVENT).post(`${user.licenseId}/hybridsip`, {
  //       resource: 'sip:status',
  //       branch: branchId,
  //       config: { branch: branchId }, }).then(result => result.data);
  //   }
  //   return await request(EndPoint.SIDEEVENT).post(`${user.licenseId}/hybridsip`,
  //   {
  //    patronId: user.userId,
  //    patronPassword: user.userPin,
  //    resource: 'sip:patroninformation'
  //   })
  //   .then((result:any) => {
  //     const sipPatronInfo = result.data || null;
  //     if (!(sipPatronInfo.validPatron === 'Y' && !!sipPatronInfo.patronIdentifier)) {
  //       return {
  //         ok: false,
  //         message:  ' (' + user.userId + ') ' + sipPatronInfo.screenMessage || ' login failed, please try again or contact library staff'
  //       }
  //     }
  //     localStorage.setItem('patronPin', user.userPin) ;
  //     localStorage.setItem('patron',  JSON.stringify({...sipPatronInfo, identifier: sipPatronInfo.patronIdentifier})) ;
  //     localStorage.setItem('personalName', sipPatronInfo.personalName || sipPatronInfo.patronIdentifier) ;
  //     localStorage.setItem('user', sipPatronInfo.emailAddress || null) ;
  //     localStorage.setItem('user_id', sipPatronInfo.patronIdentifier);
  //     result.data.ok = true;
  //     return result.data;
  //   });
  // }

  // LEGACY REST CALL REMOVED - processLoginUser function
  // This function previously handled patron authentication via REST API calls including:
  // - Device updates, patron authentication (license 7, LDAP, SIP2)
  // - Patron blocks checking, cooldown management
  // - Patron data persistence via REST API

  // Old processLoginUser code removed (330+ lines of REST API calls)

  /**
   * ILS Login Workflow — determines which ILS to use for patron authentication
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
      console.log(`🔑 workflowILSLogin: SIP2 patronInfo for ${cardNumber}`);
      const sip2LicenseId = sessionLicenseId.value;
      const result = await FirebaseSIP2.patronInfo(cardNumber);
      console.log(`🔑 workflowILSLogin: SIP2 patronInfo response:`, result);

      // Check if patron is valid
      if (result?.validPatron === 'N' || +result?.ok === 0) {
        const msg = result?.screenMessage || 'Invalid patron';
        console.error(`❌ workflowILSLogin: SIP2 invalid patron — ${msg}`);
        throw new Error(msg);
      }

      // Get or create patron in Firestore
      const { patron: persistPatron, patronKey } = await getOrCreatePatron(sip2LicenseId, cardNumber, {
        patronId: cardNumber,
        name: result?.personalName || cardNumber,
        keyword: '',
        email: result?.emailAddress || null,
      });

      if (patronKey) {
        await updatePatron(sip2LicenseId, patronKey, { updatedAt: new Date().toISOString() });
      }

      return {
        validPatron: 'Y',
        patronIdentifier: cardNumber,
        personalName: result?.personalName || cardNumber,
        emailAddress: result?.emailAddress || null,
        screenMessage: '',
        persistPatron,
        patronKey,
      };
    } else {
      console.error(`❌ workflowILSLogin: No ILS configured for branch`);
      throw new Error('Login not supported — no ILS (Polaris or SIP2) is configured for this branch');
    }
  }

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

  async function workflowILSItemInfo(itemBarcode: string): Promise<any> {
    const branch = sessionBranch.value;
    const currentLicenseId = sessionLicenseId.value;
    const isPolaris = branch?.polarisSettings?.enabled;
    const isSip2 = branch?.sip2Settings?.enabled;
    const isSymphony = branch?.symphonySettings?.enabled;

    // Skip for license 1/2 simulation
    if (currentLicenseId === 1 || currentLicenseId === 2) {
      console.log(`ℹ️ workflowILSItemInfo: Demo itemInfo for license ${currentLicenseId}, item ${itemBarcode}`);
      return { success: true, demo: true, itemBarcode };
    }

    if (isPolaris) {
      const branchId = branch?.id;
      const baseUrl = `${POLARIS_API_BASE}/${currentLicenseId}/${branchId}`;

      console.log(`ℹ️ workflowILSItemInfo: Polaris item lookup for ${itemBarcode}`);
      const lookupRes = await fetch(`${baseUrl}/items/lookup?itemBarcode=${encodeURIComponent(itemBarcode)}`, {
        headers: { 'Content-Type': 'application/json' }
      });
      const lookupData = await lookupRes.json();
      console.log(`ℹ️ workflowILSItemInfo: Polaris item lookup response:`, lookupData);

      if (!lookupRes.ok) {
        throw new Error(lookupData?.error || lookupData?.message || `Polaris item lookup failed (HTTP ${lookupRes.status})`);
      }

      return {
        success: true,
        title: lookupData?.Title || lookupData?.BibliographicRecordXML?.Title || null,
        itemId: lookupData?.Barcode || itemBarcode,
        circulationStatus: lookupData?.CircStatusID || null,
        raw: lookupData,
      };
    } else if (isSip2) {
      console.log(`ℹ️ workflowILSItemInfo: SIP2 itemInfo for ${itemBarcode}`);
      const result = await FirebaseSIP2.itemInfo(itemBarcode);
      console.log(`ℹ️ workflowILSItemInfo: SIP2 itemInfo response:`, result);
      return { success: +result.ok === 1, data: result };
    } else if (isSymphony) {
      console.log(`ℹ️ workflowILSItemInfo: Symphony itemInfo — not yet implemented`);
      return { success: true, pending: true, itemBarcode };
    } else {
      console.error(`❌ workflowILSItemInfo: No ILS configured for branch`);
      throw new Error('Item info not supported — no ILS configured for this branch');
    }
  }

  // TODO: Set to true when ready to enable ILS checkin + verify for production
  const ENABLE_ILS_CHECKIN = true;

  async function workflowILSProcessHold(itemBarcode: string, patronBarcode: string): Promise<any> {
    const branch = sessionBranch.value;
    const currentLicenseId = sessionLicenseId.value;
    const isPolaris = branch?.polarisSettings?.enabled;
    const isSip2 = branch?.sip2Settings?.enabled;

    const isDemoLicense = currentLicenseId === 1 || currentLicenseId === 2;

    if (isDemoLicense) {
      console.log(`📦 workflowILSProcessHold: Demo mode for license ${currentLicenseId}, item ${itemBarcode}, patron ${patronBarcode}`);
      createCheckinTransaction({ itemIds: [itemBarcode], patronId: patronBarcode, doorNumber: '', success: true, metadata: { demo: true } }).catch(e => console.error('Transaction error:', e));
      return { success: true, demo: true, itemBarcode, patronBarcode };
    }

    // Step 1: Get item info from ILS
    let itemInfo: any = null;
    try {
      itemInfo = await workflowILSItemInfo(itemBarcode);
      console.log(`📦 workflowILSProcessHold: itemInfo result:`, itemInfo);
    } catch (err) {
      console.error(`❌ workflowILSProcessHold: itemInfo failed:`, err);
    }

    if (!itemInfo || !itemInfo.success) {
      createCheckinTransaction({ itemIds: [itemBarcode], patronId: patronBarcode, doorNumber: '', success: false, metadata: { error: 'item_not_found' } }).catch(e => console.error('Transaction error:', e));
      updateSessionError({ message: 'Item could not be found' });
      setLocation('/error');
      return { success: false, error: 'item_not_found' };
    }

    // Step 1b: Check circulation status — block if item is checked out (status 4)
    let circulationStatus: number | null = null;
    if (isPolaris) {
      circulationStatus = itemInfo.circulationStatus ?? null;
    } else if (isSip2) {
      circulationStatus = itemInfo.data?.circulationStatus ? +itemInfo.data.circulationStatus : null;
    }
    console.log(`📦 workflowILSProcessHold: circulationStatus=${circulationStatus}`);

    if (circulationStatus === 4) {
      createCheckinTransaction({ itemIds: [itemBarcode], patronId: patronBarcode, doorNumber: '', success: false, metadata: { error: 'item_checked_out', circulationStatus } }).catch(e => console.error('Transaction error:', e));
      updateSessionError({ message: 'Item is currently checked out, and returns are not allowed' });
      setLocation('/error');
      return { success: false, error: 'item_checked_out' };
    }

    // Step 1B: Overflow check — if locker is full + SIP2 + overflow enabled, do checkin to get patronId and check for existing locker
    if (isSip2 && branch?.sip2OverflowSettingEnabled && branch?.sip2OverflowSettings?.enabled) {
      const nextDoor = getNextHoldModeDoorNro(sessionDevice.value);
      if (nextDoor === undefined) {
        console.log(`📦 workflowILSProcessHold: Locker full + SIP2 overflow enabled — doing SIP2 checkin to get patronId`);

        let overflowCheckinResult: any = null;
        try {
          overflowCheckinResult = await workflowILSCheckin(itemBarcode);
          console.log(`📦 workflowILSProcessHold: overflow SIP2 checkin result:`, overflowCheckinResult);
        } catch (err) {
          console.error(`❌ workflowILSProcessHold: overflow SIP2 checkin failed:`, err);
          createCheckinTransaction({ itemIds: [itemBarcode], patronId: patronBarcode, doorNumber: '', success: false, metadata: { error: 'overflow_checkin_failed', message: String(err) } }).catch(e => console.error('Transaction error:', e));
          updateSessionError({ message: 'Check-in failed during overflow check' });
          setLocation('/error');
          return { success: false, error: 'overflow_checkin_failed' };
        }

        if (!overflowCheckinResult || !overflowCheckinResult.success) {
          createCheckinTransaction({ itemIds: [itemBarcode], patronId: patronBarcode, doorNumber: '', success: false, metadata: { error: 'overflow_checkin_failed' } }).catch(e => console.error('Transaction error:', e));
          updateSessionError({ message: 'Check-in failed during overflow check' });
          setLocation('/error');
          return { success: false, error: 'overflow_checkin_failed' };
        }

        // Extract patronId from SIP2 checkin response
        const overflowPatronId = overflowCheckinResult.data?.CY || overflowCheckinResult.data?.patronIdentifier || null;
        console.log(`📦 workflowILSProcessHold: overflow patronId=${overflowPatronId}`);

        if (overflowPatronId) {
          const useSmartConsolidation = sessionDevice.value?.settings?.useSmartConsolidation;
          let existingDoor: number | boolean = 0;

          if (useSmartConsolidation) {
            // Smart consolidation: any locker of this patron will do (most recent by timestamp)
            existingDoor = patronLatestLocker(sessionDevice.value, overflowPatronId);
            console.log(`📦 workflowILSProcessHold: overflow smart consolidation — patron ${overflowPatronId} latest locker=${existingDoor}`);
          } else {
            // Strict mode: patron must have a locker with the same hold expiration date
            const overflowHoldExpiration = overflowCheckinResult.data?.CM || overflowCheckinResult.data?.holdExpiration || null;
            console.log(`📦 workflowILSProcessHold: overflow hold expiration from checkin=${overflowHoldExpiration}`);

            if (overflowHoldExpiration) {
              existingDoor = patronHasAllreadyHoldWithExpiration(overflowPatronId, overflowHoldExpiration);
              console.log(`📦 workflowILSProcessHold: overflow strict match — patron ${overflowPatronId} locker with same expiration=${existingDoor}`);
            } else {
              // No expiration date in checkin response — fall back to patron-only match
              existingDoor = patronHasAllreadyHold(overflowPatronId);
              console.log(`📦 workflowILSProcessHold: overflow no expiration in checkin — patron ${overflowPatronId} any locker=${existingDoor}`);
            }
          }

          if (existingDoor) {
            console.log(`📦 workflowILSProcessHold: overflow — patron has existing locker #${existingDoor}, proceeding`);
          } else {
            createCheckinTransaction({ itemIds: [itemBarcode], patronId: overflowPatronId, doorNumber: '', success: false, metadata: { error: 'locker_full_no_existing', overflow: true } }).catch(e => console.error('Transaction error:', e));
            updateSessionError({ message: 'All lockers are full and patron has no existing locker' });
            setLocation('/error');
            return { success: false, error: 'locker_full_no_existing' };
          }
        } else {
          createCheckinTransaction({ itemIds: [itemBarcode], patronId: patronBarcode, doorNumber: '', success: false, metadata: { error: 'locker_full_no_patron', overflow: true } }).catch(e => console.error('Transaction error:', e));
          updateSessionError({ message: 'All lockers are full' });
          setLocation('/error');
          return { success: false, error: 'locker_full_no_patron' };
        }
      }
    }

    // Step 2: Check if item has holds — extract patronId + holdExpiration
    let hasHold = false;
    let holdPatronId: string | null = null;
    let holdExpiration: string | null = null;
    let holdTitle: string | null = null;

    if (isPolaris) {
      // Polaris: check hold pull list for this item
      try {
        const branchId = branch?.id;
        const logonBranchId = branch?.polarisSettings?.logonBranchId;
        const url = `${POLARIS_API_BASE}/${currentLicenseId}/${branchId}/patron/holds?branch=${encodeURIComponent(logonBranchId)}&branchtype=2&requeststatus=6`;
        console.log(`📦 workflowILSProcessHold: Polaris hold pull list check for ${itemBarcode}`);
        const res = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
        const data = await res.json();
        console.log(`📦 workflowILSProcessHold: Polaris hold pull list response:`, data);

        const holdsList = data?.RequestPicklistRows || data?.HoldRequestsGetResult?.RequestPicklistRows || [];
        if (Array.isArray(holdsList) && holdsList.length > 0) {
          const match = holdsList.find((hold: any) => {
            const barcode = hold.ItemBarcode || hold.itemBarcode || hold.Barcode || hold.barcode || '';
            return barcode === itemBarcode;
          });
          if (match) {
            hasHold = true;
            holdPatronId = match.PatronBarcode || match.patronBarcode || String(match.PatronID || '') || null;
            holdTitle = match.BrowseTitle || match.Title || match.title || match.BibliographicRecordTitle || null;
            // Parse Polaris /Date(...)/ format for expiration
            const rawExpDate = match.ExpirationDate || match.expirationDate || match.PickupByDate || match.pickupByDate || null;
            if (rawExpDate && typeof rawExpDate === 'string') {
              const dateMatch = rawExpDate.match(/\/Date\((\d+)([+-]\d+)?\)\//);
              if (dateMatch) {
                holdExpiration = new Date(parseInt(dateMatch[1])).toISOString();
              } else {
                holdExpiration = rawExpDate;
              }
            }
            console.log(`📦 workflowILSProcessHold: Polaris hold found — patron=${holdPatronId}, title=${holdTitle}, exp=${holdExpiration}`);
          }
        }
      } catch (err) {
        console.error(`❌ workflowILSProcessHold: Polaris hold pull list check failed:`, err);
      }
    } else if (isSip2) {
      // SIP2: check holdQueueLength / CF from itemInfo
      const holdQueue = itemInfo.data?.holdQueueLength || itemInfo.data?.CF;
      hasHold = holdQueue && +holdQueue > 0;
      if (hasHold) {
        holdPatronId = itemInfo.data?.patronIdentifier || itemInfo.data?.AA || null;
        holdTitle = itemInfo.data?.titleIdentifier || itemInfo.data?.AJ || null;
        holdExpiration = itemInfo.data?.CM || itemInfo.data?.holdExpiration || null;
      }
    }
    console.log(`📦 workflowILSProcessHold: hasHold=${hasHold}, patronId=${holdPatronId}, exp=${holdExpiration}`);

    if (!hasHold) {
      createCheckinTransaction({ itemIds: [itemBarcode], patronId: patronBarcode, doorNumber: '', success: false, metadata: { error: 'no_hold' } }).catch(e => console.error('Transaction error:', e));
      updateSessionError({ message: "Item doesn't have a hold" });
      setLocation('/error');
      return { success: false, error: 'no_hold' };
    }

    // Step 3 + 4: Check-in + verify (controlled by ENABLE_ILS_CHECKIN flag)
    let checkinResult: any = null;

    if (ENABLE_ILS_CHECKIN) {
      // Step 3: Check-in the item — SIP2 collects patronId from the response
      try {
        checkinResult = await workflowILSCheckin(itemBarcode);
        console.log(`📦 workflowILSProcessHold: checkin result:`, checkinResult);
      } catch (err) {
        console.error(`❌ workflowILSProcessHold: checkin failed:`, err);
        createCheckinTransaction({ itemIds: [itemBarcode], patronId: holdPatronId || patronBarcode, doorNumber: '', success: false, metadata: { error: 'checkin_failed', message: String(err) } }).catch(e => console.error('Transaction error:', e));
        updateSessionError({ message: 'Check-in failed, please try again' });
        setLocation('/error');
        return { success: false, error: 'checkin_failed' };
      }

      if (!checkinResult || !checkinResult.success) {
        createCheckinTransaction({ itemIds: [itemBarcode], patronId: holdPatronId || patronBarcode, doorNumber: '', success: false, metadata: { error: 'checkin_failed' } }).catch(e => console.error('Transaction error:', e));
        updateSessionError({ message: 'Check-in failed, please try again' });
        setLocation('/error');
        return { success: false, error: 'checkin_failed' };
      }

      // SIP2: extract patronId and CM from checkin response
      if (isSip2 && checkinResult.data) {
        const checkinPatron = checkinResult.data?.CY || checkinResult.data?.patronIdentifier || null;
        if (checkinPatron) {
          holdPatronId = checkinPatron;
          console.log(`📦 workflowILSProcessHold: SIP2 checkin patronId=${holdPatronId}`);
        }
        // Read CM (hold expiration) from checkin if not already set
        if (!holdExpiration) {
          const checkinCM = checkinResult.data?.CM || null;
          if (checkinCM) {
            holdExpiration = checkinCM;
            console.log(`📦 workflowILSProcessHold: holdExpiration from checkin CM=${checkinCM}`);
          }
        }
      }

      // Step 4: Re-check item info to verify checkin changed circulation status to 8 (hold available for pickup)
      let verifyInfo: any = null;
      try {
        verifyInfo = await workflowILSItemInfo(itemBarcode);
        console.log(`📦 workflowILSProcessHold: post-checkin verify result:`, verifyInfo);
      } catch (err) {
        console.error(`❌ workflowILSProcessHold: post-checkin verify failed:`, err);
      }

      let verifyCircStatus: number | null = null;
      if (verifyInfo?.success) {
        if (isPolaris) {
          verifyCircStatus = verifyInfo.circulationStatus ?? null;
        } else if (isSip2) {
          verifyCircStatus = verifyInfo.data?.circulationStatus ? +verifyInfo.data.circulationStatus : null;
          // Read CM (hold expiration) from the verify ITEMINFO — this is where ILS sets it after checkin
          const verifyCM = verifyInfo.data?.CM || null;
          if (verifyCM) {
            holdExpiration = verifyCM;
            console.log(`📦 workflowILSProcessHold: holdExpiration updated from verify CM=${verifyCM}`);
          }
        }
      }
      console.log(`📦 workflowILSProcessHold: post-checkin circulationStatus=${verifyCircStatus}`);

      if (verifyCircStatus !== 8 && verifyCircStatus !== 1) {
        createCheckinTransaction({ itemIds: [itemBarcode], patronId: holdPatronId || patronBarcode, doorNumber: '', success: false, metadata: { error: 'checkin_status_not_8', circulationStatus: verifyCircStatus } }).catch(e => console.error('Transaction error:', e));
        updateSessionError({ message: 'Check-in did not change item status to available for pickup' });
        setLocation('/error');
        return { success: false, error: 'checkin_status_not_8', circulationStatus: verifyCircStatus };
      }
    } else {
      customToast(() => (<b>Would do check-in but skipped during demo</b>), 3000, 'default', 'dark');
      console.log(`📦 workflowILSProcessHold: check-in skipped (ENABLE_ILS_CHECKIN=false) — would checkin ${itemBarcode} for patron ${holdPatronId || patronBarcode}`);
    }

    // All steps passed — create success transaction
    createCheckinTransaction({ itemIds: [itemBarcode], patronId: holdPatronId || patronBarcode, doorNumber: '', success: true, metadata: { holdTitle, holdExpiration } })
      .then(id => console.log(`✅ Checkin transaction created: ${id}`))
      .catch(e => console.error('❌ Checkin transaction FAILED:', e));

    // Track new patron usage (fire-and-forget)
    const effectivePatronId = holdPatronId || patronBarcode;
    if (effectivePatronId) {
      const pKey = localStorage.getItem('patronKey');
      const lid = sessionLicenseId.value;
      const did = sessionDevice.value?.id || kioskConfig.value?.deviceId || '';
      if (pKey && lid && did) {
        trackNewPatronUsage(lid, pKey, did, effectivePatronId, [itemBarcode], '');
      }
    }

    return { success: true, itemBarcode, patronBarcode, holdPatronId, holdExpiration, holdTitle, itemInfo, checkinResult, hasHold };
  }

  // Map sideevent adaLevel to kiosk patronPreference format
  function mapAdaLevelToKiosk(adaLevel: string): string {
    switch (adaLevel) {
      case 'ada': return 'ADA';
      case 'low': return 'BOTTOM2';
      case 'high': return 'TOP2';
      case 'any': return 'ANY';
      default: return 'ANY';
    }
  }

  // After login, check welcomeUserMode and handle preference flow
  const welcomeHandledRef = useRef<boolean>(false);
  function handlePostLogin(patronKey: string) {
    const welcomeEnabled = sessionDevice.value?.settings?.welcomeUserMode === true;
    if (!welcomeEnabled) {
      setLocation('/holdcheckout');
      return;
    }

    // Guard: don't re-trigger if already handled or modal is showing
    if (welcomeHandledRef.current) return;

    // Check if patron already has a preference for this device
    try {
      const patronStr = localStorage.getItem('patron');
      const patron = patronStr ? JSON.parse(patronStr) : null;
      const currentDeviceId = sessionDeviceId.value || kioskConfig.value?.device?.id;

      if (patron?.preferences && Array.isArray(patron.preferences)) {
        const existingPref = patron.preferences.find((p: any) => p.deviceId === currentDeviceId);
        if (existingPref) {
          // Returning patron — use saved preference
          const kioskPref = mapAdaLevelToKiosk(existingPref.adaLevel);
          setPatronPreference(kioskPref);
          setLocation('/holdcheckout');
          return;
        }
      }
    } catch (e) {
      console.error('Error checking patron preferences:', e);
    }

    // No preference found — show welcome modal
    welcomeHandledRef.current = true;
    setWelcomePatronKey(patronKey);
    setShowWelcomeModal(true);
    setLoading(false);
  }

  // Handle welcome preference selection
  async function handleWelcomePreferenceSelect(adaLevel: 'ada' | 'low' | 'high' | 'any') {
    try {
      const currentDeviceId = sessionDeviceId.value || kioskConfig.value?.device?.id;
      const deviceName = sessionDevice.value?.settings?.name || sessionDevice.value?.name || '';

      const newPref = {
        deviceId: currentDeviceId,
        deviceName: deviceName,
        adaLevel: adaLevel,
      };

      // Read current patron, append preference
      const patronStr = localStorage.getItem('patron');
      const patron = patronStr ? JSON.parse(patronStr) : {};
      const preferences = Array.isArray(patron.preferences) ? [...patron.preferences] : [];
      preferences.push(newPref);
      patron.preferences = preferences;

      // Save to localStorage
      localStorage.setItem('patron', JSON.stringify(patron));

      // Save to Firestore
      if (welcomePatronKey && licenseId) {
        updatePatron(licenseId, welcomePatronKey, { preferences } as any).catch(err =>
          console.error('Failed to save patron preference:', err)
        );
      }

      // Map and set kiosk preference
      const kioskPref = mapAdaLevelToKiosk(adaLevel);
      setPatronPreference(kioskPref);

      setLoading(true);
      setShowWelcomeModal(false);
      setLocation('/holdcheckout');
    } catch (err) {
      console.error('Error saving welcome preference:', err);
      setShowWelcomeModal(false);
      setLocation('/holdcheckout');
    }
  }

  async function processLoginUser(username:string, password:string) {
    updateSessionUserModeOn(true)
    setLoading(true);

    let cardNumber = username;

    if (!cardNumber) {
        return;
    }

    // Offline mode: check if barcode matches a patronId in the manifest
    const electron = (window as any).electron;
    const isOffline = await electron.sideeventNative.isMainOperatingOffline();
    if (isOffline && sessionDevice.value?.allowOfflineMode) {
        localStorage.setItem('patronId', cardNumber);
        localStorage.setItem('loginType', 'card');
        setLocation(`/holdcheckoutoffline`);
        return;
    } else if (isOffline && !sessionDevice.value?.allowOfflineMode) {
        customToast(() => (<b>Offline mode is not enabled for this device</b>), 5000, 'default', 'dark');
        setLoading(false);
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

        handlePostLogin(patronKey || '');
        return;

      } catch (ilsError: any) {
        console.error(`❌ ILS login failed:`, ilsError);
        openErrorView(4000, ilsError?.message || 'ILS login failed');
        setLoading(false);
        return;
      }
    }

    if (licenseId === 1 || licenseId === 2) {
        // Get or create patron in Firestore
        const { patron: persistPatron, patronKey } = await getOrCreatePatron(licenseId, cardNumber, {
            patronId: cardNumber,
            keyword: '',
            email: null,
        });

        if (!persistPatron) {
            customToast(() => (<b>Patron ID {cardNumber} is not supported</b>), 5000, 'default', 'dark');
            setLoading(false);
            resetKeybard();
            return;
        }

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

        handlePostLogin(patronKey || '');
        return;

    } else {
        console.log(`❌ Patron login not configured for licenseId ${licenseId}. Current configuration only supports licenseId 1 and 2.`);
        customToast(() => (<b>Patron login is not supported for license {licenseId}. Please contact support.</b>), 5000, 'default', 'dark');
        setLoading(false);
        return;

    }
  }
  async function processLoginOptions(barcode:string, password:string = '') {
    if (barcode === '21202000818465') {
      barcode = testItem()
    }
    handleTouch(false);
    setLoading(true);

    const classification = await classifyBarcode(barcode, {
      branch,
      licenseId,
      device: sessionDevice.value,
      adminPin: kioskConfig.value?.adminPin,
      customStaffPin: kioskConfig.value?.device?.settings?.customStaffPin,
      checkOffline: true,
    });

    setLoading(false);

    if (classification === 'blocked') {
      customToast(() => <div style={{ textAlign: 'center' }}><b>Offline mode</b><br /><span>Adding hold items is not available while offline</span></div>, 4000, 'warning', 'dark');
      return;
    } else if (classification === 'staffCard') {
      processStaffCard(barcode)
    } else if (classification === 'item' || classification === 'deviceReturn') {
      processHoldItem(barcode);
    } else {
      if (sessionDevice.value.settings?.password) {
        processLoginUser(barcode, password)
      } else {
        processLoginUser(barcode, '')
      }
    }
  }

  const handleSubmit = (e: { preventDefault: () => void; }) => {
    e.preventDefault();
    setShowKeyboard(false);
    processLoginOptions(username, password);
    setUsername('');
    setPassword('');
  };

  const onChangeUsername = (input: string) => {
    setUsername(input);
    Promise.delay(100).then(() => userRef.current?.focus())
  };
  const onChangePassword = (input: string) => {
    setPassword(input);
    Promise.delay(100).then(() => passRef.current?.focus())
  };
  const onKeyPress = (button: any) => {
    console.log("Button pressed", button);
    timerRef.current = 30; // Reset timer on key press

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
    timerRef.current = 30; // Reset timer on input change
    const input = event.target.value;
    setUsername(input);
    keyboard.current.setInput(input);
    Promise.delay(100).then(() => userRef.current?.focus())

  };
  const onChangePassworkInput = (event: any) => {
    timerRef.current = 30; // Reset timer on input change
    const input = event.target.value;
    setPassword(input);
    keyboard.current.setInput(input);
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

    if (false && sessionDevice.value.name.toUpperCase().includes('DEMO LOCKER') && ( sessionDevice.value.name.toUpperCase().includes('LOT') || sessionDevice.value.name.toUpperCase().includes('HOLD'))) {
      setLocation('/admin')
    } else {
      setShowAdminLoginKeyboard(true);
      setShowLoginAdminModal(true);
      return;
    }
  };

  const stylelogin: React.CSSProperties = {
    zIndex: 1,
    backgroundColor: SEBlueWithOpasity.value,
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    width: 'min(80%, 700px)',
    left: 0,
    right: 0,
    marginLeft: 'auto',
    marginRight: 'auto'
  };
  const style2: React.CSSProperties = { zIndex: 1, ...getTextStyle({}, 15), color: SEBlue.value };
  const stylePage: React.CSSProperties = { overflow: 'auto', height: '100%' };
  const [color] = useState('#ffffff');




  const langRevertTimerRef = useRef<NodeJS.Timeout | null>(null);
  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
    updateLang(lng);

    // Clear any existing revert timer
    if (langRevertTimerRef.current) {
      clearTimeout(langRevertTimerRef.current);
      langRevertTimerRef.current = null;
    }

    // If changed to a non-default language, revert after 90s
    if (lng !== systemLang) {
      langRevertTimerRef.current = setTimeout(() => {
        i18n.changeLanguage(systemLang);
        updateLang(systemLang);
        langRevertTimerRef.current = null;
      }, 60000);
    }
  };

  async function isItemIdAlradyInLocker(testedItemId:string) {
    // Check sessionDevice.value.manifest.groups for the item ID
    if (sessionDevice.value.manifest?.groups) {
        for (let groupKey in sessionDevice.value.manifest.groups) {
            const group = sessionDevice.value.manifest.groups[groupKey];

            // Search through all lockers in this group
            if (group.lockers) {
                const doorNumberFoundAtLockerObject = _.find(group.lockers, (locker: any) => {
                    // Check if locker has itemIds array and it includes the tested ID
                    if (locker && locker.itemIds && Array.isArray(locker.itemIds) && locker.itemIds.some(id => id === testedItemId)) {
                        return locker
                    }
                    return false;
                });

                if (doorNumberFoundAtLockerObject?.doorNumber) {
                    setLoading(true);

                    // Update session wizard with found locker info
                    setSessionWizard(Object.assign({}, sessionWizard.value, {
                        itemIds: testedItemId,
                        patronId: doorNumberFoundAtLockerObject.patronId,
                        doorNumber: +doorNumberFoundAtLockerObject.doorNumber,
                        patronExists: true,
                        groupKey: groupKey
                    }));

                    // Show modal instead of toast
                    setAlreadyInLockerItemId(testedItemId);
                    setAlreadyInLockerDoorNumber(+doorNumberFoundAtLockerObject.doorNumber);
                    setShowItemAlreadyInLockerModal(true);

                    return true;
                }
            }
        }
    }

    return false;
  }

  function getNextLockeID(isADA = false) {
    const next = getNextHoldModeDoorNro(sessionDevice.value, isADA, patronPreference);
    return next;
  }

  // Wrapper function for filterSelectedSize to match expected signature in processHoldItemIn.ts
  function filterSelecedSize(size: string, isADA: boolean) {
    return filterSelectedSize(sessionDevice.value, size, isADA);
  }

  // LEGACY FUNCTIONS REMOVED - Now using shared helpers from getNextHoldModeDoorNro.ts
  // - getAvailableCountPerSize: Replaced by getNextHoldModeDoorNro
  // - getFreeLockerIDs: Replaced by getNextHoldModeDoorNro

  function clearUserSessionData() {
      welcomeHandledRef.current = false;
      localStorage.removeItem('patronPin') ;
      localStorage.removeItem('patron') ;
      localStorage.removeItem('personalName') ;
      localStorage.removeItem('user') ;
      localStorage.removeItem('user_id') ;
  }

  function patronHasAllreadyHold(patronId: string): number {
    // Simple check: does this patron have a locker?
    if (!sessionDevice.value.manifest?.groups) {
      return 0;
    }

    // Search through all groups and lockers
    for (const groupKey in sessionDevice.value.manifest.groups) {
      const group = sessionDevice.value.manifest.groups[groupKey];

      if (!group.lockers) {
        continue;
      }

      // Firebase RTDB stores arrays as objects with numeric keys when there are nulls/gaps
      // Handle both array and object structures
      const lockerEntries = Array.isArray(group.lockers)
        ? group.lockers
        : Object.values(group.lockers);

      for (const locker of lockerEntries) {
        // Skip null/undefined entries
        if (!locker || !locker.patronId) {
          continue;
        }

        const lockerPatronId = String(locker.patronId);
        const searchPatronId = String(patronId);

        // Check for exact match OR "left behind" format (!patronId!)
        const isMatch =
          lockerPatronId === searchPatronId ||
          lockerPatronId === `!${searchPatronId}!`;

        if (isMatch) {
          return locker.doorNumber;
        }
      }
    }

    return 0;
  }

  function patronHasAllreadyHoldWithExpiration(patronId: string, holdExpirationDate: any): number {
    if (!sessionDevice.value.manifest?.groups) {
      return 0;
    }

    for (const groupKey in sessionDevice.value.manifest.groups) {
      const group = sessionDevice.value.manifest.groups[groupKey];

      if (!group.lockers) {
        continue;
      }

      const lockerEntries = Array.isArray(group.lockers)
        ? group.lockers
        : Object.values(group.lockers);

      for (const locker of lockerEntries) {
        if (!locker || !locker.patronId) {
          continue;
        }

        const lockerPatronId = String(locker.patronId);
        const searchPatronId = String(patronId);

        const isMatch =
          lockerPatronId === searchPatronId ||
          lockerPatronId === `!${searchPatronId}!`;

        if (isMatch && locker.holdExpirationDate == holdExpirationDate) {
          return locker.doorNumber;
        }
      }
    }

    return 0;
  }


  // LEGACY REST CALL REMOVED - runPatronBlocksCheck function
  // This function has been moved to helpers/PatronBlocksCheck.ts
  // async function runPatronBlocksCheck(patronId) {
  //   try {
  //     const patronInfo = await request(EndPoint.SIDEEVENT).post(`/${licenseId}/hybridsip/`, {
  //         patronId: patronId,
  //         patronPassword: '',
  //         branch:  sessionDevice.value.branch.branch_code,
  //         resource: 'sip:patroninformation',
  //     }).then(result => result.data || {});
  //     let isBlocked = false;
  //     let first = true;
  //     let restrictionsMessageText = `Patron ID ${patronId} locker usage is blocked due following restrictions`;
  //     for (let i = 0; i <= 13; i++) {
  //         if (patronInfo?.patronStatus && sessionDevice.value.config.locker.express_patron_blocks[i] && patronInfo.patronStatus[i] === 'Y') {
  //             isBlocked = true;
  //             restrictionsMessageText = restrictionsMessageText + (first ? `: ${t('EXPRESS_MODE_STAFF_PATRON_KEY_' + i)}` : `, ${t('EXPRESS_MODE_STAFF_PATRON_KEY_' + i)}`);
  //             first = false;
  //         }
  //     }
  //     if (sessionDevice.value.config.locker.express_patron_block_patronexpired && patronInfo?.PY) {
  //         if (patronInfo.PY.toUpperCase() === 'Y') {
  //             isBlocked = true;
  //             restrictionsMessageText = restrictionsMessageText + (first ? `: PatronID ${patronId} is expired` : `, PatronID ${patronId} is expired`);
  //             first = false;
  //         }
  //     }
  //     if (sessionDevice.value.config.locker.express_patron_block_feeamountlimit && patronInfo.feeAmount && patronInfo.feeLimit) {
  //         if (+patronInfo.feeAmount > +patronInfo.feeLimit) {
  //             isBlocked = true;
  //             restrictionsMessageText = restrictionsMessageText + (first ? `: PatronID ${patronId} fee amount is exceeded` : `, Fee amount is exceeded`);
  //             first = false;
  //         }
  //     }
  //     if (sessionDevice.value.config.locker.express_patron_block_chargedmountlimit && patronInfo.chargedItemsCount && patronInfo.chargedItemsLimit) {
  //         if (+patronInfo.chargedItemsCount > +patronInfo.chargedItemsLimit) {
  //             isBlocked = true;
  //             restrictionsMessageText = restrictionsMessageText + (first ? `: PatronID ${patronId} charged amount is exceeded` : `, Charged amount is exceeded`);
  //             first = false;
  //         }
  //     }
  //     if (sessionDevice.value.config.locker.express_patron_block_overdueitemslimit && patronInfo.overdueItemsLimit && patronInfo.overdueItemsCount) {
  //         if (+patronInfo.overdueItemsCount > +patronInfo.overdueItemsLimit) {
  //             isBlocked = true;
  //             restrictionsMessageText = restrictionsMessageText + (first ? `: PatronID ${patronId} overdue count is exceeded` : `, Overdue count is exceeded`);
  //             first = false;
  //         }
  //     }
  //     if (sessionDevice.value.config.locker.express_patron_block_holditemslimit && patronInfo.holdItemsCount && patronInfo.holdItemsLimit) {
  //         if (+patronInfo.holdItemsCount > +patronInfo.holdItemsLimit) {
  //             isBlocked = true;
  //             restrictionsMessageText = restrictionsMessageText + (first ? `: PatronID ${patronId} hold count is exceeded` : `, Hold count is exceeded`);
  //             first = false;
  //         }
  //     }
  //     if (isBlocked) {
  //         openErrorView(6000, restrictionsMessageText);
  //         return false;
  //     }
  //     return true;
  //   } catch (error) {
  //       return false;
  //   }
  // }

  async function customizedTestsPerLicenseIfInteInfoHasHoldOrCanProceed(sipItemInfo: any, itemId: string) {

    if (licenseId === 120) {
      if (!sipItemInfo.response.includes('CF')) {
          errorReport.message = `Item ID ${itemId} doesn't have a hold, stand by..`;
          openErrorView();
          return false;
      }

    } else if (licenseId === 117) {
        // Sonoma special test 1
        if (sipItemInfo?.circulationStatus !== '10') {
            errorReport.message = `Item ID ${itemId} doesn't have a hold, stand by..`;
            openErrorView();
            return false;
        }

    } else if (licenseId === 106) {
        // Seattle special test 1

        if (!+sipItemInfo?.holdQueueLength) {
            if (sipItemInfo?.circulationStatus !== '10') {
                errorReport.message = `Item ID ${itemId} doesn't have a hold, stand by..`;
                openErrorView();
                return false;
            }
        }
    }
    // doesn't remove
    else if (licenseId === 115) {
        if (
            !(
                +sipItemInfo?.circulationStatus === 1 ||
                +sipItemInfo?.circulationStatus === 3 ||
                +sipItemInfo?.circulationStatus === 8 ||
                +sipItemInfo?.circulationStatus === 10
            )
        ) {
            errorReport.message = `Item ID ${itemId} doesn't have a hold, stand by..`;
            openErrorView();
            return false;
        }
    }
    // Washco check
    else if (licenseId === 109) {
        if (+sipItemInfo?.holdQueueLength && !(+sipItemInfo?.circulationStatus === 4)) {
            console.log('Normal hold queue detected... continue');
        } else if (
            sipItemInfo.AP &&
            sipItemInfo.AP.includes('North Pointe Lockers') &&
            (+sipItemInfo?.circulationStatus === 8 || +sipItemInfo?.circulationStatus === 10)
        ) {
            console.log('APNorth Pointe Lockers – Hagerstown –24-7 Pickup and CH Book, circ status 8 or 10... do continue');
        } else {
            errorReport.message = `Item ID ${itemId} doesn't have a hold, stand by..`;
            openErrorView();
            return false;
        }
    } else if (license.name.toUpperCase().includes('PHOENIX')) {
        if (+sipItemInfo?.holdQueueLength && !(+sipItemInfo?.circulationStatus === 4)) {
            console.log('Normal hold queue detected... continue');
        } else if (!+sipItemInfo?.holdQueueLength && +sipItemInfo?.circulationStatus === 8) {
            const messageText = `Item ID ${itemId} has no hold queue, but processed as temporary pass check ..`;
            console.log(messageText);
        } else {
            errorReport.message = `Item ID ${itemId} doesn't have a hold, stand by..`;
            openErrorView();
            return false;
        }
    } else if (!+sipItemInfo?.holdQueueLength) {
        errorReport.message = `Item ID ${itemId} doesn't have a hold, stand by..`;
        openErrorView();
        return false;
    }
    return true;
  }

  // Build dependencies object for processHoldItemIn helpers
  const buildProcessHoldItemDeps = () => {
    return {
      device: sessionDevice.value,
      license,
      licenseId,
      branch,
      sessionWizard,
      sessionBranch,
      sessionBarcode: sessionBarcode.value,
      nextLockerNro: { value: nextLockerNro.value },
      password,
      username,
      isADA: { value: isADA },
      patronPreference,
      setLoading,
      setSessionWizard,
      setShowAddHoldInfo,
      setNextLockerNro,
      setIsADA,
      setTestedOpenDoor,
      setPatronPreference,
      setSelectionProtected,
      setAllAvailableDoorsWithSizes,
      setSessionExistingItemsCount,
      updateSessionStaffModeOn,
      updateSessionUserModeOn,
      updateDevice,
      setLocation,
      setSplitMode,
      setShowKeyboard,
      resetKeybard,
      stopVideo,
      testPatron,
      isItemIdAlradyInLocker,
      // patronHasAllreadyHold - now imported from lockerHelpers in processHoldItemIn
      // runPatronBlocksCheck - now imported from PatronBlocksCheck in processHoldItemIn
      customizedTestsPerLicenseIfInteInfoHasHoldOrCanProceed,
      getNextLockeID,
      filterSelecedSize,
      getAvailableLockers: async () => {
        // Update UI with currently available door sizes from RTDB
        const availableSizes = getAvailableDoorsWithSizes(sessionDevice.value);
        setAllAvailableDoorsWithSizes(availableSizes);
        console.log('📦 Updated available door sizes for UI');
      },
      openErrorView,
      endStaffMode,
      exitCountdownTimer,
      startDoorCloseWatcher,
      persistDeviceManifestChanges,
      createOrUpdateRestoredLockerEntity: async (lockerNro: number, itemIds: string, patronId: string, type?: string) => {
        // LEGACY REST FUNCTION DISABLED
        console.warn('createOrUpdateRestoredLockerEntity is disabled (legacy REST)');
        return null;
      },
      errorReport,
      t,
      handleExitCountdownTimerRef,
    };
  };

  // Wrapper functions for the new helpers
  async function processHoldItem(itemId: string) {
    setReopenClicked(0);
    const electron = (window as any).electron;
    const isOffline = await electron.sideeventNative.isMainOperatingOffline();
    if (isOffline) {
      customToast(() => <div style={{ textAlign: 'center' }}><b>Offline mode</b><br /><span>Adding hold items is not available while offline</span></div>, 4000, 'warning', 'dark');
      return;
    }

    // Run ILS hold processing workflow before opening door
    const holdResult = await workflowILSProcessHold(itemId, username);
    if (!holdResult.success) {
      // workflowILSProcessHold already handled error view / toast
      return;
    }

    // Set holdExpires on wizard from ILS date or holdperiod setting
    const device = sessionDevice.value;
    const holdperiod = device?.settings?.holdperiod;
    let holdExpires: number | undefined;
    if (holdperiod) {
      const endOfDay = new Date();
      endOfDay.setDate(endOfDay.getDate() + (+holdperiod - 1));
      endOfDay.setHours(23, 59, 59, 999);
      holdExpires = endOfDay.getTime();
      console.log(`📦 holdExpires from holdperiod=${holdperiod}: ${new Date(holdExpires).toISOString()}`);
    } else if (holdResult.holdExpiration) {
      // Parse SIP2 CM date format: "20260301    192519" or ISO or Polaris /Date(...)/
      const raw = holdResult.holdExpiration;
      const cleaned = raw.replace(/\s+/g, ' ').trim();
      let expDate: Date | null = null;

      // Try SIP2 format: YYYYMMDD HHmmss
      const sip2Match = cleaned.match(/^(\d{4})(\d{2})(\d{2})\s*(\d{2})(\d{2})(\d{2})?$/);
      if (sip2Match) {
        expDate = new Date(`${sip2Match[1]}-${sip2Match[2]}-${sip2Match[3]}T${sip2Match[4]}:${sip2Match[5]}:${sip2Match[6] || '00'}`);
      }

      // Try standard Date parse as fallback
      if (!expDate || isNaN(expDate.getTime())) {
        expDate = new Date(cleaned);
      }

      if (expDate && !isNaN(expDate.getTime())) {
        expDate.setHours(23, 59, 59, 999);
        holdExpires = expDate.getTime();
      }
      console.log(`📦 holdExpirationDate from ILS CM="${raw}": ${holdExpires ? new Date(holdExpires).toISOString() : 'parse failed'}`);
    }

    // Set wizard with ILS hold data — use title from hold result, detection phase, or fallback to itemId
    const resolvedTitle = holdResult.holdTitle || lastILSItemLookup?.title || null;
    const wizardUpdate: any = {
      itemIds: [itemId],
      patronId: holdResult.holdPatronId || username,
      title: resolvedTitle || itemId,
      itemTitle: resolvedTitle || 'ID ' + itemId,
    };
    if (holdExpires) {
      wizardUpdate.holdExpires = holdExpires;
    }
    setSessionWizard(Object.assign({}, sessionWizard.value, wizardUpdate));
    console.log(`📦 Wizard updated: patronId=${wizardUpdate.patronId}, holdExpires=${holdExpires}, title=${holdResult.holdTitle}`);

    // Overflow check: if lockers are full and device is hold locker, try sending to overflow device
    const anyEmpty = hasAnyEmptyLockers(device);
    if (!anyEmpty && device.isHoldLocker) {
      try {
        const db = getLicenseDatabase(licenseId);
        const devicesRef = ref(db, `license_${licenseId}/devices`);
        const devicesSnap = await get(devicesRef);
        if (devicesSnap.exists()) {
          const allDevices = devicesSnap.val();
          const overflowEntry = Object.entries(allDevices).find(([, d]: [string, any]) =>
            d.isOverflow && d.branchId === device.branchId
          );
          if (overflowEntry) {
            const [overflowDeviceId, overflowDevice] = overflowEntry as [string, any];
            console.log(`📦 Locker full — overflowing to overflow device ${overflowDeviceId}`);

            // Calculate holdExpires as days from today and dateKey
            const holdExpiresDate = holdExpires ? new Date(holdExpires) : new Date();
            holdExpiresDate.setHours(23, 59, 59, 999);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const diffDays = Math.max(0, Math.ceil((holdExpiresDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
            const targetDate = new Date(today);
            targetDate.setDate(today.getDate() + diffDays);
            const dateKey = `${targetDate.getFullYear()}${String(targetDate.getMonth() + 1).padStart(2, '0')}${String(targetDate.getDate()).padStart(2, '0')}`;

            const patronId = wizardUpdate.patronId || username || (holdResult.demo ? testPatron() : '');
            const itemsDataArr = [{ itemId, title: holdResult.holdTitle || itemId }];
            const overflowItemData = {
              patronId,
              itemIds: itemId,
              itemsData: JSON.stringify(itemsDataArr),
              holdExpires: String(diffDays),
              createdAt: new Date().toISOString(),
            };

            // Check for existing patron card in this column and merge
            const itemsPath = `license_${licenseId}/devices/${overflowDeviceId}/overflow/data/${dateKey}/items`;
            const itemsRef = ref(db, itemsPath);
            const itemsSnap = await get(itemsRef);
            let merged = false;
            if (itemsSnap.exists()) {
              const existingItems = itemsSnap.val();
              for (const [key, item] of Object.entries(existingItems) as [string, any][]) {
                if (String(item.patronId).trim() === String(patronId).trim()) {
                  // Merge with existing patron card
                  const existingItemsData = item.itemsData ? JSON.parse(item.itemsData) :
                    item.itemIds ? item.itemIds.split(',').map((id: string) => ({ itemId: id.trim(), title: '' })) : [];
                  const mergedMap = new Map();
                  existingItemsData.forEach((i: any) => mergedMap.set(i.itemId, i));
                  itemsDataArr.forEach((i: any) => mergedMap.set(i.itemId, i));
                  const mergedItems = Array.from(mergedMap.values());
                  const mergedItemIds = mergedItems.map((i: any) => i.itemId).join(', ');
                  await set(ref(db, `${itemsPath}/${key}`), {
                    ...item,
                    itemIds: mergedItemIds,
                    itemsData: JSON.stringify(mergedItems),
                    updatedAt: new Date().toISOString(),
                  });
                  merged = true;
                  break;
                }
              }
            }
            if (!merged) {
              await push(itemsRef, overflowItemData);
            }

            // Get shelf day name and show success modal
            const shelfLabel = holdExpiresDate.toLocaleDateString('en-US', { weekday: 'long' });
            setOverflowSuccessInfo({
              shelfLabel,
              deviceName: (overflowDevice as any).settings?.name || overflowDeviceId,
            });
            setLoading(false);
            console.log(`📦 Overflow success — shelf label: ${shelfLabel}`);
            return;
          }
        }
      } catch (overflowErr) {
        console.error('📦 Overflow attempt failed, falling through to normal flow:', overflowErr);
      }
    }

    const deps:any = buildProcessHoldItemDeps();
    return ProcessHoldItemInHelpers.processHoldItem(itemId, deps);
  }

  async function makeHoldLockerSelection(mode: string, isADA: boolean = false) {
    const deps:any = buildProcessHoldItemDeps();
    return ProcessHoldItemInHelpers.makeHoldLockerSelection(mode, isADA, deps);
  }

  async function processHoldLockerSelection(groupNumber: number, lockNro: number, splitlocker: boolean) {
    const deps:any = buildProcessHoldItemDeps();
    return ProcessHoldItemInHelpers.processHoldLockerSelection(groupNumber, lockNro, splitlocker, deps);
  }

  async function finalizeHoldLockerSelection(success: boolean) {
    const deps:any = buildProcessHoldItemDeps();
    return ProcessHoldItemInHelpers.finalizeHoldLockerSelection(success, deps);
  }


  async function exit() {
    setLoading(false);
    updateSessionUserModeOn(false);
    updateSessionStaffModeOn(false);

    setUsername('');
  }


  // step final — detect door close via grace-period approach
  // Hardware reports lock state (not physical door state), so isDoorOpen returns false almost immediately.
  // We trust the open command and use a grace period before polling for close.
  const doorSeenOpenRef = useRef(false);
  const doorCloseWatcherRef = useRef<NodeJS.Timeout | null>(null);
  const doorOpenedAtRef = useRef<number>(0); // Timestamp when door was opened (for grace period guard)
  const DOOR_GRACE_MS = 2000; // 2s grace period after door open before checking for close

  // Start door close watcher — called directly when door opens (not via useEffect)
  function startDoorCloseWatcher(mac: string, doorNumber: number) {
    // Stop any existing watcher
    if (doorCloseWatcherRef.current) {
      clearInterval(doorCloseWatcherRef.current);
      doorCloseWatcherRef.current = null;
    }

    console.log(`🚪 Door close watcher starting for door ${doorNumber}, mac=${mac} (grace: ${DOOR_GRACE_MS / 1000}s)`);
    doorSeenOpenRef.current = true; // Trust the open command
    const startedAt = Date.now();
    doorOpenedAtRef.current = startedAt; // For legacy testIsDoorOpen guard

    doorCloseWatcherRef.current = setInterval(async () => {
      try {
        // Grace period: don't check for close within first N seconds
        const elapsed = Date.now() - startedAt;
        if (elapsed < DOOR_GRACE_MS) {
          console.log(`🚪 Door watcher: grace period (${Math.round((DOOR_GRACE_MS - elapsed) / 1000)}s left)`);
          return;
        }

        const isOpen = await isDoorOpen(mac, doorNumber, { fresh: true });
        console.log(`🚪 Door watcher poll: door=${doorNumber}, isOpen=${isOpen}`);

        if (isOpen) return; // Door still open, keep watching

        console.log(`🚪 Door ${doorNumber} closed (watcher) — ending staff wizard`);
        if (doorCloseWatcherRef.current) {
          clearInterval(doorCloseWatcherRef.current);
          doorCloseWatcherRef.current = null;
        }
        doorSeenOpenRef.current = false;
        endStaffMode();
      } catch (err) {
        console.error('🚪 Door watcher error:', err);
      }
    }, 2000);
  }

  // Legacy testIsDoorOpen — door close detection is now handled by startDoorCloseWatcher
  // This function only runs when the watcher is NOT active AND grace period has passed
  async function testIsDoorOpen() {
    // Skip if watcher is running — it handles close detection with proper grace period
    if (doorCloseWatcherRef.current) return;
    // Skip during grace period (covers async race where watcher was started but await was in-flight)
    if (doorOpenedAtRef.current > 0 && Date.now() - doorOpenedAtRef.current < DOOR_GRACE_MS) return;

    try {
      if (testedOpenDoor.value > 0) {
        // Resolve MAC: prefer integration MAC, fall back to device MAC
        let mac = '';
        const cachedIntegrations = localStorage.getItem('integrations');
        if (cachedIntegrations) {
          try {
            const integrationsObj = JSON.parse(cachedIntegrations);
            const integrations = Array.isArray(integrationsObj) ? integrationsObj : Object.values(integrationsObj);
            if (integrations.length > 0) {
              mac = (integrations[0] as any).macId || (integrations[0] as any).mac || '';
            }
          } catch (error) {
            console.error('Error parsing integrations:', error);
          }
        }
        if (!mac) mac = sessionDevice.value?.settings?.macid || '';

        const isOpen = await isDoorOpen(mac, testedOpenDoor.value, { fresh: true });
        console.log(`🚪 testIsDoorOpen (legacy): door=${testedOpenDoor.value}, isOpen=${isOpen}, mac=${mac}`);

        if (isOpen) return;

        // No watcher running and door reports closed — end session
        setTestedOpenDoor(null);
        doorSeenOpenRef.current = false;
        endStaffMode();
      }

    } catch (error) {
      console.error('🚪 testIsDoorOpen error:', error);
    }

  }

  // Handler for when staff accesses admin view from "Item Already in Locker" modal
  const handleStaffAccessAlreadyInLocker = () => {
    adminAutoOpenDoor.value = alreadyInLockerDoorNumber;
    setShowItemAlreadyInLockerModal(false);
    // Navigate to admin page to open the door
    setShowLoginAdminModal(true);
  };

  // Handler for when patron wants to scan card from "Item Already in Locker" modal
  const handlePatronScanAlreadyInLocker = () => {
    setShowItemAlreadyInLockerModal(false);
    // Reset to allow patron to scan their card
    setLoading(false);
    updateSessionStaffModeOn(false);
    updateSessionUserModeOn(false);
    // Focus back on the barcode input for patron card scan
    setShowKeyboard(true);
  };

  // Handler to close the "Item Already in Locker" modal
  const handleCloseItemAlreadyInLockerModal = () => {
    setShowItemAlreadyInLockerModal(false);
    setLoading(false);
    updateSessionStaffModeOn(false);
    updateSessionUserModeOn(false);
  };

  // Handler to close the Error modal
  const handleCloseErrorModal = () => {
    setShowErrorModal(false);
    exit();
  };

  // Handler to reopen the current door
  const handleReopenDoor = async () => {
    if (!testedOpenDoor.value) return;

    const doorNumber = testedOpenDoor.value;
    console.log(`Reopening door ${doorNumber}`);

    try {
      await openDoor(doorNumber);
      console.log(`Door ${doorNumber} reopened successfully`);
      customToast(() => (<b>Door {doorNumber} reopened</b>), 2000, 'default', 'dark');
      setReopenClicked(prev => prev + 1);
    } catch (error) {
      console.error(`Failed to reopen door ${doorNumber}:`, error);
      customToast(() => (<b>Failed to reopen door {doorNumber}</b>), 3000, 'default', 'dark');
    }
  };

  // Handler for door failed to open
  const handleDoorFailedToOpen = async () => {
    const doorNumber = testedOpenDoor.value;
    console.log(`⚠️ Door ${doorNumber} reported as failed to open by patron`);

    // Mark door as disabled in device.thedoors (set enabled: false)
    let updatedThedoors = null;
    if (sessionDevice.value?.thedoors) {
      updatedThedoors = sessionDevice.value.thedoors.map((door: any) => {
        if (Number(door.doorNumber) === Number(doorNumber)) {
          console.log(`🚫 Marking door ${doorNumber} as enabled: false`);
          return { ...door, enabled: false };
        }
        return door;
      });

      // Update sessionDevice with the disabled door
      const updatedDevice = {
        ...sessionDevice.value,
        thedoors: updatedThedoors
      };
      updateDevice(updatedDevice);
      console.log(`✅ Door ${doorNumber} has been set to enabled: false in device.thedoors (local)`);

      // Persist thedoors to Firebase RTDB
      console.log(`💾 Persisting thedoors changes to Firebase for door ${doorNumber}`);
      await persistDeviceTheDoorsChanges(updatedThedoors);
    }

    // Remove itemId from manifest for this door
    if (sessionDevice.value?.manifest?.groups) {
      let manifestChanged = false;
      for (const groupKey in sessionDevice.value.manifest.groups) {
        const group = sessionDevice.value.manifest.groups[groupKey];
        if (group.lockers) {
          for (const lockerKey in group.lockers) {
            const locker = group.lockers[lockerKey];
            if (locker && Number(locker.doorNumber) === Number(doorNumber)) {
              console.log(`🗑️ Found locker for door ${doorNumber} with itemIds:`, locker.itemIds);

              // Check if locker has no items or will be empty after removal
              const hasNoItems = !locker.itemIds || locker.itemIds.length === 0 || locker.itemIds.length === 1;

              if (hasNoItems) {
                // Delete the entire locker object if it has no items (or only the one being removed)
                console.log(`🗑️ Deleting empty locker object for door ${doorNumber}`);
                delete group.lockers[lockerKey];
              } else {
                // Locker has multiple items - just clear it but keep the locker
                console.log(`🗑️ Clearing locker for door ${doorNumber} (had multiple items)`);
                locker.itemIds = [];
                locker.patronId = null;
                locker.timestamp = null;
                locker.set = {};
              }
              manifestChanged = true;
              break;
            }
          }
        }
        if (manifestChanged) break;
      }

      if (manifestChanged) {
        // Persist the updated manifest
        console.log(`💾 Persisting manifest changes for door ${doorNumber}`);
        await persistDeviceManifestChanges(sessionDevice.value.manifest);
      }
    }

    // Show toast informing patron
    customToast(() => (
      <div>
        <b>Door {doorNumber} marked as broken</b>
        <br /><br />
        Please re-scan the hold item to try again.
      </div>
    ), 5000, 'default', 'dark');

    // Reset state and exit
    console.log(`🚪 Exiting - door disabled and itemId removed from manifest`);
    setReopenClicked(0);
    setTestedOpenDoor(null);
    exit();
  };

  async function endStaffMode() {
    if (false) {
      try {
        if (testedOpenDoor.value > 0 && (sessionLocation.value === '/')) {
          await anyDoorOpen(sessionDevice.value.config.locker.mac).then((doorsStillOpen) => {
          if (doorsStillOpen) {
              setTimeout(() => customToast(() => (<b>{t('ERROR.DOOR_LEFT_OPEN')}</b>), 3000, 'default', 'dark'), 100);
            }
          });
        }

      } catch (error) {

      }
    }

    setShowKeyboard(false);
    resetKeybard();
    updateSessionStaffModeOn(false);
    updateSessionUserModeOn(false);
    setSplitMode(false);
    doorSeenOpenRef.current = false;
    doorOpenedAtRef.current = 0;
    // Stop door close watcher
    if (doorCloseWatcherRef.current) {
      clearInterval(doorCloseWatcherRef.current);
      doorCloseWatcherRef.current = null;
    }
    setTestedOpenDoor(null);
    setLoading(false);

  }

  async function endUserMode() {
    endStaffMode()
  }

  async function exitCountdownTimer(timerval?) {
    if(handleExitCountdownTimerRef.current) {
      clearTimeout(handleExitCountdownTimerRef.current);
    }
    if (!sessionStaffModeOn.value) {
      updateSessionTimer(0);
      return;
    }
    updateSessionTimer(timerval);
    if (sessionLocation.value !== '/') {
      return;
    }

    if (sessionTimer.value > 0) {
      // Door close detection using RTDB device status (sessionDevice.value.status)
      // sessionDoorStatus may be empty if doorStatusWatcher uses file watcher mode
      if (doorOpenedAtRef.current > 0 && testedOpenDoor.value) {
        const elapsed = Date.now() - doorOpenedAtRef.current;
        if (elapsed >= 3000) {
          const isOpen = (window as any).electronAPI?.getLocalConfig()?.testmode || getDoorOpenFromRTDB(testedOpenDoor.value);
          if (isOpen) {
            doorSeenOpenRef.current = true;
          } else if (doorSeenOpenRef.current) {
            console.log(`🚪 Door ${testedOpenDoor.value} CLOSED after being open (elapsed=${Math.round(elapsed/1000)}s) — ending staff wizard`);
            endStaffMode();
            return;
          }
        }
      }

      handleExitCountdownTimerRef.current = setTimeout(() => {
        if (sessionTimer.value > 0 && sessionLocation.value === '/') {
          const timerval = sessionTimer.value - 1;
          exitCountdownTimer(timerval);
        }
      }, 1000);

      return;

    }

    endStaffMode();
  }




  // HTMLs ****

  const isVideoBackground = !sessionWelcomeBackgroundImage.value && !sessionWelcomeBackgroundColor.value;

  const htmlShowWelcomeScreen = () => {
    return (<>
      <div onClick={() => handleTouch(false)} style={style.getEmptyBackground()}></div>
      {isVideoBackground && (
        <video
          style={style.backgroundVideo()}
          src='./loginbackground.webm'
          autoPlay
          loop
          muted
          playsInline
        />
      )}

        {!showKeyboard && !slideshowActive.value && <>

          <Row style={{...stylelogin, ...(isVideoBackground ? { backgroundColor: 'transparent', boxShadow: 'none' } : {})}}>
            <Col span={24} style={{zIndex: 10}}>
                <Card variant="borderless" onClick={() => handleTouch(true)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'scale(1.015)';
                    e.currentTarget.style.boxShadow = '0 10px 36px 0 rgba(31, 38, 135, 0.45)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scale(1)';
                    e.currentTarget.style.boxShadow = '0 8px 32px 0 rgba(31, 38, 135, 0.37)';
                  }}
                  style={{
                  backgroundColor: isVideoBackground ? 'transparent' : 'rgba(255,255,255,0.15)',
                  boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.37)',
                  border: isVideoBackground ? '1px solid rgba(255, 255, 255, 0.25)' : 'none',
                  borderRadius: '12px',
                  padding: '20px',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  transform: 'scale(1)',
                  overflow: 'visible',
                }}

                cover={
                  <div style={{
                    position: 'relative',
                    top: '-20px',
                    width: '120px',
                    height: '140px',
                    display: 'block',
                    margin: '0 auto',
                    zIndex: 10,
                    overflow: 'visible'
                  }}>
                    <style>{`
                      @keyframes tap {
                        0%, 100% {
                          transform: translateY(0) scale(1);
                        }
                        10% {
                          transform: translateY(15px) scale(0.95);
                        }
                        20% {
                          transform: translateY(0) scale(1);
                        }
                      }
                      .hand-pointer {
                        animation: tap 2s ease-in-out infinite;
                      }
                    `}</style>
                    <MdTouchApp
                      className="hand-pointer"
                      style={{
                        fontSize: '120px',
                        color: 'white',
                        display: 'block',
                        margin: '0 auto',
                        filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.3))'
                      }}
                    />
                  </div>

                }

                  >
                    <h2 style={{
                      ...getTextStyle({color: 'white'}, 32),
                      transform: 'translateZ(20px)',
                      transition: 'transform 0.3s ease',
                      marginTop: '20px'
                    }}> {t('SAAS.START_HERE')} </h2>
              </Card>
            </Col>


          </Row>


          <button style={{ position: 'fixed', left: '25px', top: '25px', opacity: '0.005', zIndex: 200 }} onDoubleClick={onDoubleClickHandler}>
            <MdLanguage size={80} />
          </button>

        </>
        }
        {showKeyboard && htmlShowWelcomeScreenLogin()}
    </>);
  }

  const htmlShowWelcomeScreenLogin = () => {
    return (<>

      {/* Full-screen overlay — clicking outside the card/keyboard closes login */}
      <div
        onClick={() => handleTouch(false)}
        style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 0 }}
      />

      <form onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()} style={{...stylelogin, top: '5%', transform: 'none'}}>
        <Card onClick={() => handleTouch(true)} style={{
            backgroundColor: 'rgba(255,255,255,0.15)',
            boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.37)'}}

          >
            <Row >
              <Col span={24} style={{ 'marginTop': '20px' }}>
                <input
                  ref={userRef}
                  placeholder={t('SAAS.USERNAME_PLACEHOLDER', { defaultValue: ' username / patron' })}
                  style={{...getTextStyle({}, 10), color: SEBlue.value, width:'100%', height: '100px', fontSize: '42px', padding: '15px'}}
                  type="text"
                  id="username"
                  name="username"
                  onClick={() => changeFocus('username')}
                  value={username}
                  onChange={onChangeUsernameInput}
                  required />
              </Col>
            </Row>

            {/* Only show password field if password/PIN is enforced */}
            {sessionDevice.value.settings?.password && (
              <Row justify="center">
                <Col span={24} style={{ 'marginTop': '20px' }}>
                  <input
                    ref={passRef}
                    placeholder='  password / PIN'
                    style={{
                      ...getTextStyle({}, 10),
                      color: SEBlue.value,
                      width: '100%',
                      height: '100px',
                      fontSize: '42px',
                      padding: '15px'
                    }}
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

            <Row justify="center">
              <Col span={24} style={{ 'marginTop': '20px' }}>
                <Button size='large'
                  disabled={username.length === 0}
                  style={{
                  ...getTextStyle({}, 10),
                  'fontWeight': 'bold',
                  'marginTop': '20px',
                  width: '100%',
                  padding: '30px',
                  fontSize: '36px',
                  color: SEBlue.value,
                  height: 'auto',
                  backgroundColor: 'white',
                  'boxShadow': '1px 1px 1px 1px rgb(0 0 0 / 50%), 0 1px 6px -1px rgb(0 0 0 / 2%), 0 2px 4px 0 rgb(0 0 0 / 4%' }}
                  type="primary" htmlType="submit"> {t('SAAS.LOGIN')} </Button>
              </Col>
            </Row>

        </Card>
      </form>
      <LoginKeyboard
        ref={keyboard}
        layoutName={layout}
        onChange={focusOnUsername ? onChangeUsername : onChangePassword}
        onKeyPress={onKeyPress}
        customLayout={sessionDevice.value?.settings?.customKeyboard
          ? (focusOnUsername
            ? sessionDevice.value?.settings?.customKeyboardUser
            : sessionDevice.value?.settings?.customKeyboardPassword) || undefined
          : undefined}
      />
    </>);
  }


  const htmlShowLoadAHoldItemIntoLockerScreen = () => {


    return !splitMode.value ?

      htmlShowLoadAHoldItemIntoLockerScreenDefault()
      :
      htmlShowLoadAHoldItemIntoLockerScreenSplit()
  }

  const htmlShowLoadAHoldItemIntoLockerScreenDefault = () => {
    const isOpen = (window as any).electronAPI?.getLocalConfig()?.testmode || getDoorOpenFromRTDB(testedOpenDoor.value);
    return (<>

      <Button size='large' style={{...getTextStyle({fontWeight: 'bold', color: 'white'}, 10), zIndex: 1000, position: 'fixed', bottom: '180px', right: '20px', margin: 'auto', height: 'auto', fontSize: '36px', padding: '20px 60px', backgroundColor: '#52c41a', borderColor: '#52c41a' }} onClick={() => exitCountdownTimer(0)} type="primary" > DONE </Button>

      <Card variant="borderless" style={{
          marginTop: '10px',
          backgroundColor: 'rgba(0,0,0,0.0)',
        }} >

        {/* same for both screens */}
        <Row style={{marginTop: '0px'}}>
            <Col span={20} offset={2}>
              <div dangerouslySetInnerHTML={{ __html: t('STAFF.INFO', {'doorNumber': testedOpenDoor.value, 'patronId': sessionWizard.value.patronId}) }} style={{...getTextStyle({color: 'white', 'fontWeight': 'bold'}, 30)}}></div>
            </Col>
        </Row>

        {/* screen specific text shown*/}
        <Row gutter={[20, 100]} style={{marginTop: '50px'}}>
          <Col span={20} offset={2}>
          { allAvailableDoorsWithSizes.normal.length > 0 ?
            <div dangerouslySetInnerHTML={{ __html: t('STAFF.DETAILS_INIT', {
              'itemCount': (t('STAFF.DOOR._COUNT_' + (sessionExistingItemsCount + 1))),
              'itemId': sessionWizard.value?.itemIds || '',
              'doorNumber': testedOpenDoor.value
            }) }} style={{...getTextStyle({color: 'white'}, 20)}}>
            </div>
            :
            <>
              <div dangerouslySetInnerHTML={{ __html: t('STAFF.DETAILS_INIT_NO_DOORS', {
                'itemCount': (t('STAFF.DOOR._COUNT_' + (sessionExistingItemsCount + 1))),
                'itemId': sessionWizard.value?.itemIds || '',
                'doorNumber': testedOpenDoor.value
              }) }} style={{...getTextStyle({color: 'white'}, 20)}}>
              </div>
              <div style={{...getTextStyle({color: '#ffa500', fontWeight: 'bold', textShadow: '2px 2px 4px rgba(0,0,0,0.5)', textAlign: 'center'}, 22), marginTop: '80px'}}>
                {t('STAFF.NO_DOORS_LEFT')}
              </div>
            </>
            }

          </Col>
        </Row>

        {/* Door selection buttons - shown after 2 second delay */}
        {showDoorButtons && (
          <>
            {/* Normal doors row */}
            <Row gutter={[20, 30]} style={{marginTop: '40px'}}>
            {
              // Available normal (non-ADA) doors
              allAvailableDoorsWithSizes.normal.map((item:any, key:any) => {

              async function selectNewDoor(size: string): Promise<void> {
                console.log(`📦 Selected door size for split: ${size}`);

                // Ensure size is a string
                const sizeStr = typeof size === 'string' ? size : String(size);

                // Get all empty doors of the requested size, sorted by priority (low prio number = high priority)
                const availableDoors = filterSelecedSize(sizeStr, false);

                if (availableDoors.length === 0) {
                  console.error(`❌ No empty ${size} doors available for split operation`);
                  openErrorView(5000, `No empty ${size} doors available. Please select another size or contact staff.`, 'error');
                  return;
                }

                // Select the first door (highest priority)
                const selectedDoorNumber = availableDoors[0];
                console.log(`📦 Selected door #${selectedDoorNumber} from ${availableDoors.length} available ${size} doors`, availableDoors);

                // Store the old locker number for split operation
                setOldLockerNro(testedOpenDoor.value);

                // Set split mode before processing
                setSplitMode(true);

                // Clear any existing countdown timer
                if(handleExitCountdownTimerRef.current) {
                  clearTimeout(handleExitCountdownTimerRef.current);
                }

                // Process the split operation: move last item from old locker to new locker
                // This calls processHoldLockerSelection with splitlocker=true, which triggers processSplitLockerContent
                await processHoldLockerSelection(0, selectedDoorNumber, true);

                // Start countdown timer for door closure
                const timerSplitAddHold = sessionDevice.value?.settings?.timerShowSplitAddHold || 15;
                exitCountdownTimer(timerSplitAddHold);
              }

              return (
                <Col key={key} span={6} style={{ marginTop: '10px', color: 'white' }}>
                    <Card
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'scale(1.05)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'scale(1)';
                    }}
                    style={{
                      ...getTextStyle({color: 'white'}, 15),
                      backgroundColor: '#ffa500d9',
                      boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.37)',
                      borderRadius: '30px',
                      padding: '15px',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      transform: 'scale(1)',
                      overflow: 'visible'
                    }}
                    onClick={() => selectNewDoor(item.size)}
                    cover={
                      <div style={{
                        position: 'relative',
                        top: '-15px',
                        width: '80px',
                        height: '100px',
                        display: 'block',
                        margin: '0 auto',
                        zIndex: 10,
                        overflow: 'visible'
                      }}>
                        <style>{`
                          @keyframes tap {
                            0%, 100% {
                              transform: translateY(0) scale(1);
                            }
                            10% {
                              transform: translateY(15px) scale(0.95);
                            }
                            20% {
                              transform: translateY(0) scale(1);
                            }
                          }
                          .hand-pointer {
                            animation: tap 2s ease-in-out infinite;
                          }
                        `}</style>
                        <MdTouchApp
                          className="hand-pointer"
                          style={{
                            fontSize: '80px',
                            color: 'white',
                            display: 'block',
                            margin: '0 auto',
                            filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.3))'
                          }}
                        />
                      </div>
                    }
                    >
                      <div style={{
                        height: '100px',
                        color: 'white',
                        marginBottom: '15px',
                        fontSize: '1.1em',
                        fontWeight: 'bold',
                        textShadow: '2px 2px 4px rgba(0,0,0,0.3)',
                        marginTop: '10px'
                      }}>
                        {t('DOOR.OPTION', {'size': item.sizeName, 'type': item.typeName})}
                        <br />
                        <span style={{ fontSize: '0.75em' }}>({item.count} available)</span>
                      </div>
                    </Card>
                </Col>

              )
          })
        }
        {
          // Available ADA doors - now in same row as normal doors
          allAvailableDoorsWithSizes.ada.map((item:any, key:any) => {

              async function selectNewADADoor(size: string): Promise<void> {
                console.log(`📦 Selected ADA door size for split: ${size}`);

                const sizeStr = typeof size === 'string' ? size : String(size);

                // Get available ADA doors of the requested size
                const availableDoors = filterSelecedSize(sizeStr, true);

                if (availableDoors.length === 0) {
                  console.error(`❌ No empty ADA ${size} doors available for split operation`);
                  openErrorView(5000, `No empty ADA ${size} doors available. Please select another size or contact staff.`, 'error');
                  return;
                }

                const selectedDoorNumber = availableDoors[0];
                console.log(`📦 Selected ADA door #${selectedDoorNumber} from ${availableDoors.length} available ${size} doors`, availableDoors);

                // Store the old locker number for split operation
                setOldLockerNro(testedOpenDoor.value);

                // Set split mode before processing
                setSplitMode(true);

                // Clear any existing countdown timer
                if(handleExitCountdownTimerRef.current) {
                  clearTimeout(handleExitCountdownTimerRef.current);
                }

                // Process the split operation: move last item from old locker to new locker
                await processHoldLockerSelection(0, selectedDoorNumber, true);

                // Start countdown timer for door closure
                const timerSplitAddHold = sessionDevice.value?.settings?.timerShowSplitAddHold || 15;
                exitCountdownTimer(timerSplitAddHold);
              }

              return (
                <Col key={key} span={6} style={{ marginTop: '10px', color: 'white' }}>
                    <Card
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'scale(1.05)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'scale(1)';
                    }}
                    style={{
                      ...getTextStyle({color: 'white'}, 15),
                      backgroundColor: '#00adff',
                      boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.37)',
                      borderRadius: '30px',
                      padding: '15px',
                      cursor: 'pointer',
                      transition: 'all 0.3s ease',
                      transform: 'scale(1)',
                      overflow: 'visible'
                    }}
                    onClick={() => selectNewADADoor(item.size)}
                    cover={
                      <div style={{
                        position: 'relative',
                        top: '-15px',
                        width: '80px',
                        height: '100px',
                        display: 'block',
                        margin: '0 auto',
                        zIndex: 10,
                        overflow: 'visible'
                      }}>
                        <style>{`
                          @keyframes tap {
                            0%, 100% {
                              transform: translateY(0) scale(1);
                            }
                            10% {
                              transform: translateY(15px) scale(0.95);
                            }
                            20% {
                              transform: translateY(0) scale(1);
                            }
                          }
                          .hand-pointer {
                            animation: tap 2s ease-in-out infinite;
                          }
                        `}</style>
                        <MdTouchApp
                          className="hand-pointer"
                          style={{
                            fontSize: '80px',
                            color: 'white',
                            display: 'block',
                            margin: '0 auto',
                            filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.3))'
                          }}
                        />
                      </div>
                    }
                    >
                      <div style={{
                        height: '100px',
                        color: 'white',
                        marginBottom: '15px',
                        fontSize: '1.1em',
                        fontWeight: 'bold',
                        textShadow: '2px 2px 4px rgba(0,0,0,0.3)',
                        marginTop: '10px'
                      }}>
                        {t('DOOR.OPTION', {'size': item.sizeName, 'type': item.typeName})}
                        <br />
                        <span style={{ fontSize: '0.75em' }}>({item.count} available)</span>
                      </div>
                    </Card>
                </Col>
              )
          })
        }
        </Row>
          </>
        )}

        {/* Loading message while waiting for buttons */}
        {!showDoorButtons && (
          <Row gutter={[20, 30]} style={{marginTop: '80px'}}>
            <Col span={24} style={{ textAlign: 'center' }}>
              <div style={{
                ...getTextStyle({color: 'white', fontWeight: 'bold'}, 25),
                textShadow: '2px 2px 4px rgba(0,0,0,0.3)',
                padding: '40px'
              }}>
                <Spin size="large" style={{ marginRight: '20px' }} />
                <br /><br />
                Opening locker, please stand by...

              </div>
            </Col>
          </Row>
        )}
      </Card>

      {/* Re-open / Door failed to open + Door status */}
      <div style={{ position: 'fixed', bottom: '180px', left: '20px', zIndex: 1000, display: 'flex', alignItems: 'center', gap: '15px' }}>
        {reopenClicked >= 2 ? (
          <Button
            size='large'
            style={{
              ...getTextStyle({fontWeight: 'bold', color: 'white'}, 10),
              height: 'auto',
              fontSize: '36px',
              padding: '20px 60px',
              backgroundColor: '#ff4d4f',
              borderColor: '#ff4d4f'
            }}
            onClick={handleDoorFailedToOpen}
            type="primary"
            danger
          >
            Door Failed to Open
          </Button>
        ) : (
          <Button
            size='large'
            style={{
              ...getTextStyle({fontWeight: 'bold', color: 'white'}, 10),
              height: 'auto',
              fontSize: '36px',
              padding: '20px 60px',
              backgroundColor: '#1890ff',
              borderColor: '#1890ff'
            }}
            onClick={handleReopenDoor}
            type="primary"
          >
            Re-open Door {testedOpenDoor.value}
          </Button>
        )}
        <div style={{
          ...getTextStyle({fontWeight: 'bold'}, 10),
          fontSize: '30px',
          color: isOpen ? '#52c41a' : '#ff4d4f',
        }}>
          {isOpen ? 'OPEN' : 'CLOSED'}
        </div>
      </div>

      {/* Timer is now shown in ZoomLanguageControls component */}
      {!modalOpen && !showLoginAdminModal && (
        <ZoomLanguageControls
          showLanguageButton={false}
          showAccessibleModeButton={false}
          showSlideshowButton={false}
          showZoom={false}
          showTimer={true}
          timer={sessionTimer.value}
          resetSlideshowTrigger={slideshowResetTrigger}
          onTimerClick={() => setLocation('/')}
          onZoomIn={() => updateFontSize(fontSize.value + 1)}
          onZoomOut={() => updateFontSize(fontSize.value - 1)}
        />
      )}

    </>);
  }

  const htmlShowLoadAHoldItemIntoLockerScreenSplit = () => {
    const isOpen = (window as any).electronAPI?.getLocalConfig()?.testmode || getDoorOpenFromRTDB(testedOpenDoor.value);
    return (<>

      <Button size='large' style={{...getTextStyle({fontWeight: 'bold', color: 'white'}, 10), zIndex: 1000, position: 'fixed', bottom: '180px', right: '20px', margin: 'auto', height: 'auto', fontSize: '36px', padding: '20px 60px', backgroundColor: '#52c41a', borderColor: '#52c41a' }} onClick={() => exitCountdownTimer(0)} type="primary" > DONE </Button>

      <Card variant="borderless" style={{
          marginTop: '10px',
          backgroundColor: 'rgba(0,0,0,0.0)',
        }} >
        <Row gutter={[20, 20]}>
          <Col span={20} offset={2}>
            <div dangerouslySetInnerHTML={{ __html: t('STAFF.INFO', {'doorNumber': testedOpenDoor.value, 'patronId': sessionWizard.value.patronId}) }} style={{...getTextStyle({color: 'white', 'fontWeight': 'bold'}, 20)}}></div>
          </Col>
        </Row>
         <Row gutter={[20, 100]}>
          <Col span={20} offset={2}>
            <div style={getTextStyle({color: 'white', fontWeight: 'bold'}, 15)}>
              { t('STAFF.DETAILS_SPLIT', {'itemId': sessionWizard.value?.itemIds || '', 'oldLockerNro': oldLockerNro, 'doorNumber': testedOpenDoor.value }) }
            </div>
          </Col>
        </Row>

        <Row gutter={[20, 30]} style={{marginTop: '40px', opacity: '0.8'}}>
        {
          allAvailableDoorsWithSizes.normal.map((item:any, key:any) =>
          {
            return (
              <Col key={key} span={8} style={{marginTop: '10px',  color: 'gray' }}>
                <Card
                  cover={<MdDoorFront style={{marginTop: '20px'}} color='white' size={60} />}
                  style={{...getTextStyle({color: 'white'}, 15), 'backgroundColor': '#ffa500d9', 'opacity': '0.8' }}
                  >
                  <div style={{...getTextStyle({color: 'white'}, 15), height: '110px', marginBottom: '20px' }}>
                      {t('DOOR.OPTION', {'size': item.sizeName, type: item.typeName})}
                  </div>
                </Card>
              </Col>
            )
          })
        }
        {
          allAvailableDoorsWithSizes.ada.map((item:any, key:any) =>
          {
            return (
              <Col key={key} span={8} style={{marginTop: '10px',  color: 'gray' }}>
                <Card
                  cover={<MdDoorFront style={{marginTop: '20px'}} color='white' size={60} />}
                  style={{...getTextStyle({color: 'white'}, 15), 'backgroundColor': '#ffa500d9', 'opacity': '0.8' }}
                  >
                  <div style={{...getTextStyle({color: 'white'}, 15), height: '110px', marginBottom: '20px' }}>
                      {t('DOOR.OPTION', {'size': item.sizeName, type: item.typeName})}
                  </div>
                </Card>
              </Col>
            )
          })
        }
        </Row>
      </Card>

      {/* Re-open / Door failed to open + Door status */}
      <div style={{ position: 'fixed', bottom: '180px', left: '20px', zIndex: 1000, display: 'flex', alignItems: 'center', gap: '15px' }}>
        {reopenClicked >= 2 ? (
          <Button
            size='large'
            style={{
              ...getTextStyle({fontWeight: 'bold', color: 'white'}, 10),
              height: 'auto',
              fontSize: '36px',
              padding: '20px 60px',
              backgroundColor: '#ff4d4f',
              borderColor: '#ff4d4f'
            }}
            onClick={handleDoorFailedToOpen}
            type="primary"
            danger
          >
            Door Failed to Open
          </Button>
        ) : (
          <Button
            size='large'
            style={{
              ...getTextStyle({fontWeight: 'bold', color: 'white'}, 10),
              height: 'auto',
              fontSize: '36px',
              padding: '20px 60px',
              backgroundColor: '#1890ff',
              borderColor: '#1890ff'
            }}
            onClick={handleReopenDoor}
            type="primary"
          >
            Re-open Door {testedOpenDoor.value}
          </Button>
        )}
        <div style={{
          ...getTextStyle({fontWeight: 'bold'}, 10),
          fontSize: '30px',
          color: isOpen ? '#52c41a' : '#ff4d4f',
        }}>
          {isOpen ? 'OPEN' : 'CLOSED'}
        </div>
      </div>

      {/* Timer and Zoom Controls */}
      <ZoomLanguageControls
        showLanguageButton={false}
        showAccessibleModeButton={false}
        showSlideshowButton={false}
        showZoom={false}
        showTimer={true}
        timer={sessionTimer.value}
        onTimerClick={() => setLocation('/')}
        onZoomIn={() => updateFontSize(fontSize.value + 1)}
        onZoomOut={() => updateFontSize(fontSize.value - 1)}
      />

    </>);
  }

  const htmlRenderLang = Object.keys(languges).map((langKey: any) => {
    const input = languges[langKey].translation;
    const isSelectedLang = lang === langKey;
    const selectedStyle: React.CSSProperties = {
      border: isSelectedLang ? '10x solid' : '1px solid',
      padding: isSelectedLang ? '5px' : '',
      boxShadow: isSelectedLang ? '1px 1px 1px 1px rgb(0 0 0 / 50%), 0 1px 6px -1px rgb(0 0 0 / 2%), 0 2px 4px 0 rgb(0 0 0 / 4%' : '',
    };

    return (
        <Col key={langKey} span={20} offset={2} >
          <Card variant="borderless" style={selectedStyle} onClick={() => {changeLanguage(langKey); setTimeout(() => procesModalResult(false), 300)}}>
            <Avatar shape="square" style={{marginRight: '20px', marginTop: '-15px' }} size={40} src={input.icon} />
            {isSelectedLang ? <CheckOutlined style={{ color: '#42A4DE', marginRight: '10px', fontSize: '30px', fontWeight: 'bold'}} /> : ''}
            <span style={{color: '#42A4DE', ...getTextStyle({}, 15)}}>{input.name}</span>
          </Card>
        </Col>
    )
  });

  const htmlMain = () => {
    return (
      <>
        <div className="sweet-loading" style={stylePage} onClick={handleUIClick}>
          {/* Hidden input for scanner/keyboard input */}
          <input
            ref={scannerInputRef}
            type="text"
            onChange={onScannerInputChange}
            onKeyDown={(e) => {
              // Handle Enter key for immediate processing (scanner behavior)
              if (e.key === 'Enter') {
                e.preventDefault();
                if (scannerDebounceTimerRef.current) {
                  clearTimeout(scannerDebounceTimerRef.current);
                }
                handleScannerInput(e.currentTarget.value);
              }
            }}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '1px',
              height: '1px',
              opacity: 0,
              pointerEvents: 'none',
              overflow: 'hidden',
            }}
            aria-hidden="true"
            tabIndex={-1}
          />

          { loading && <Spinner></Spinner> }

          {!modalOpen && !showLoginAdminModal && !testedOpenDoor.value && (
            <ZoomLanguageControls
              languages={Object.values(languges)}
              showLanguageButton={(langKeys?.length || 0) > 1}
              showAccessibleModeButton={false}
              showSlideshowButton={true}
              deviceId={sessionDevice.value?.id}
              licenseId={licenseId?.toString()}
              resetSlideshowTrigger={slideshowResetTrigger}
              onLanguageClick={() => setModalOpen(true)}
              onAccessibleModeClick={() => {
                console.log('Accessible mode clicked');
                setShowAccessibilityModal(true);
              }}
              onZoomIn={increaseFontSize}
              onZoomOut={decreaseFontSize}
            />
          )}
          <AdminLoginModal
            open={showLoginAdminModal}
            onClose={() => { setShowLoginAdminModal(false); adminAutoOpenDoor.value = null; setLoading(true); }}
            onSuccess={() => {
              setLocation('/admin');
            }}
            customStaffPin={config.customStaffPin}
          />

          <LanguageModal
            open={modalOpen}
            onClose={() => procesModalResult(false)}
            languages={Object.keys(languges).map(langKey => ({
              key: langKey,
              lang: langKey,
              name: languges[langKey].translation.name,
              icon: languges[langKey].translation.icon
            }))}
            currentLanguage={lang}
            onLanguageChange={changeLanguage}
            title={t('SAAS.CHANGE_LANGUAGE')}
          />

          <AccessibleModal
            open={showAccessibilityModal}
            onClose={() => setShowAccessibilityModal(false)}
            title={t('SAAS.ACCESSIBILITY_SETTINGS') || "Accessibility Settings"}
            device={sessionDevice.value}
            onDeviceUpdate={(updatedDevice) => {
              updateDevice(updatedDevice);
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
                // Restore device settings
                const restoredDevice = {
                  ...sessionDevice.value,
                  welcomeBackgroundColor: sessionDevice.value.setting?.originalColor || sessionDevice.value.welcomeBackgroundColor,
                  welcomeBackgroundImage: sessionDevice.value.setting?.originalBackgroundImage || sessionDevice.value.welcomeBackgroundImage,
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

          <ErrorModal
            open={showErrorModal}
            onClose={handleCloseErrorModal}
            severity={errorModalConfig.severity}
            title={errorModalConfig.title}
            body={errorModalConfig.body}
            footer={errorModalConfig.footer}
            timer={errorModalConfig.timer}
          />

          {/* Overflow Success Modal */}
          <Modal
            open={!!overflowSuccessInfo}
            footer={null}
            closable={false}
            centered
            width={'90vw'}
            afterOpenChange={(open) => {
              if (open) {
                setTimeout(() => setOverflowSuccessInfo(null), 3000);
              }
            }}
          >
            {overflowSuccessInfo && (
              <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                <div style={{ fontSize: '80px', marginBottom: '16px' }}>📦</div>
                <h2 style={{ fontSize: '42px', fontWeight: 'bold', marginBottom: '24px' }}>
                  Locker Full — Sent to Overflow
                </h2>
                <p style={{ fontSize: '28px', color: '#666', marginBottom: '30px' }}>
                  Item has been moved to the overflow shelf.
                </p>
                <div style={{
                  backgroundColor: '#fffbeb',
                  border: '3px solid #f59e0b',
                  borderRadius: '16px',
                  padding: '40px',
                  marginBottom: '30px',
                }}>
                  <p style={{ fontSize: '26px', color: '#92400e', marginBottom: '12px' }}>
                    Place item on shelf labeled
                  </p>
                  <p style={{ fontSize: '64px', fontWeight: 'bold', color: '#78350f', margin: 0 }}>
                    {overflowSuccessInfo.shelfLabel}
                  </p>
                  <p style={{ fontSize: '20px', color: '#a16207', marginTop: '12px' }}>
                    on "{overflowSuccessInfo.deviceName}"
                  </p>
                </div>
                <Button
                  type="primary"
                  size="large"
                  style={{ minWidth: '300px', height: '60px', fontSize: '24px' }}
                  onClick={() => setOverflowSuccessInfo(null)}
                >
                  OK
                </Button>
              </div>
            )}
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

          {/* Welcome User Mode Modal — full-screen overlay for first-time patron preference selection */}
          {showWelcomeModal && !loading && (
            <div style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100vw',
              height: '100vh',
              backgroundColor: '#ffffff',
              zIndex: 10000,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '40px',
            }}>
              {/* Custom HTML content from device settings */}
              <div
                style={{
                  color: SEBlue.value,
                  maxWidth: '800px',
                  width: '100%',
                  marginBottom: '40px',
                  fontSize: '32px',
                }}
                dangerouslySetInnerHTML={{ __html: sessionDevice.value?.settings?.welcomeUserModeHTML || '' }}
              />

              {/* Preference buttons */}
              <div style={{
                display: 'flex',
                gap: '20px',
                flexWrap: 'wrap',
                justifyContent: 'center',
              }}>
                {[
                  { label: 'Any size is OK', value: 'any' as const },
                  { label: 'Low', value: 'low' as const },
                  { label: 'High', value: 'high' as const },
                  { label: 'ADA', value: 'ada' as const },
                ].map((opt) => (
                  <Button
                    key={opt.value}
                    type="primary"
                    size="large"
                    onClick={() => handleWelcomePreferenceSelect(opt.value)}
                    style={{
                      minWidth: '180px',
                      height: '80px',
                      fontSize: '28px',
                      borderRadius: '12px',
                      backgroundColor: opt.value === 'ada' ? '#e67e22' : SEBlue.value,
                      borderColor: opt.value === 'ada' ? '#d35400' : SEBlue.value,
                    }}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>

              {/* Countdown timer */}
              <div style={{
                marginTop: '30px',
                color: '#999',
                fontSize: '20px',
              }}>
                Auto-selecting <strong>Any</strong> in {welcomeCountdown}s
              </div>
            </div>
          )}

          {loading ? '' : !testedOpenDoor.value ? htmlShowWelcomeScreen() : htmlShowLoadAHoldItemIntoLockerScreen()}
        </div>

        <ItemAlreadyInLockerModal
          visible={showItemAlreadyInLockerModal}
          itemId={alreadyInLockerItemId}
          doorNumber={alreadyInLockerDoorNumber}
          onClose={handleCloseItemAlreadyInLockerModal}
          onStaffAccess={handleStaffAccessAlreadyInLocker}
          onPatronScan={handlePatronScanAlreadyInLocker}
        />
      </>
    );
  }
  return htmlMain();
}
