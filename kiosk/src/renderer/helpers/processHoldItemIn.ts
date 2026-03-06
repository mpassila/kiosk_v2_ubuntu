import React from 'react';
import _, { find } from 'lodash';
import Promise from 'bluebird';
// LEGACY REST IMPORTS REMOVED
// import { request, EndPoint } from '../state/request';
import { validateItemInfo, validateIsSipOk, persistDeviceManifestChanges, customToast, updateSessionSpinnerStatus } from '../state/shared';
import MonthYear from './MonthYear';
import { openDoor } from '../state/locker';
import { patronHasAllreadyHold, patronLatestLocker } from './lockerHelpers';
import { runPatronBlocksCheck } from './PatronBlocksCheck';
import { getNextHoldModeDoorNro } from './getNextHoldModeDoorNro';
import { updateManifest } from './updateManifest';
import device from '../../../services/packages/REM_locker/src/service/device';

/**
 * Clean up manifest by removing null/undefined entries from lockers arrays
 * This prevents sparse arrays with null entries from being persisted to the database
 * @param manifest - The device manifest to clean
 */
function cleanupManifestLockers(manifest: any): void {
  if (!manifest?.groups) {
    return;
  }

  for (const groupKey in manifest.groups) {
    const group = manifest.groups[groupKey];
    if (group.lockers && Array.isArray(group.lockers)) {
      // Filter out null, undefined, and empty entries
      const cleanedLockers = group.lockers.filter((locker: any) => locker != null && locker !== undefined);

      // Log if we found any null entries
      if (cleanedLockers.length !== group.lockers.length) {
        console.log(`🧹 Cleaned up group ${groupKey} lockers: ${group.lockers.length} -> ${cleanedLockers.length} (removed ${group.lockers.length - cleanedLockers.length} null entries)`);
      }

      // Replace with cleaned array
      group.lockers = cleanedLockers;
    }
  }
}

/**
 * ⚠️ TYPING ISSUES IDENTIFIED ⚠️
 *
 * The Device type from root types/device-types.ts is incomplete and doesn't match
 * the actual device structure used in the kiosk application.
 *
 * Missing/Incorrect Properties in Device interface:
 *
 * 1. PROPERTY NAME MISMATCHES (snake_case vs camelCase):
 *    - device.license_id      → should be device.licenseId
 *    - device.is_online       → should be device.enabled
 *    - device.device_id       → should be device.deviceId
 *    - device.locker_manifest → should be device.manifest
 *    - device._id             → should be device.id
 *
 * 2. MISSING NESTED STRUCTURES:
 *    - device.settings.* (entire locker configuration object)
 *      ├── settings.locks
 *      ├── settings.groups[]
 *      │   ├── groups[].reserved_locks[]
 *      │   └── groups[].lockers{}
 *      │       ├── lockers[].itemId
 *      │       ├── lockers[].patronId
 *      │       ├── lockers[].holdExpirationDate
 *      │       ├── lockers[].set{}
 *      │       ├── lockers[].timestamp
 *      │       ├── lockers[].empty
 *      │       ├── lockers[].enabled
 *      │       └── lockers[].isADA
 *      ├── settings.holdperiod
 *      ├── settings.is_extended_hold_expired
 *      ├── settings.express_patron_block
 *      ├── settings.first_time_user
 *      ├── settings.mac
 *      └── settings.sizelist[]
 *
 *    - device.branch (branch object)
 *    - device.branch_overflow (overflow branch configuration)
 *    - device.name (device name string)
 *
 * 3. ACTUAL DEVICE PROPERTIES ACCESSED IN THIS FILE:
 *    Line 368: device.license_id
 *    Line 374: device.is_online
 *    Line 531: device.manifest.groups (NEW - using hasAnyEmptyLockers helper)
 *    Line 393: device.settings.holdperiod
 *    Line 476: device.settings.is_extended_hold_expired
 *    Line 485: device.settings.holdperiod
 *    Line 493: device.settings.holdperiod
 *    Line 514: device.settings.express_patron_block
 *    Line 541: device.settings.holdperiod
 *    Line 575: device.settings.first_time_user
 *    Line 581: device._id
 *    Line 809: device.config.locker['groups'][groupNumber].lockers
 *    Line 846: device.settings.mac
 *    Line 894: device.locker_manifest.groups
 *    Line 895: device.device_id
 *    Line 896: device.name
 *
 * RECOMMENDATION:
 * Either:
 * A) Update root types/device-types.ts to include all these properties, OR
 * B) Create a separate KioskDevice interface that extends Device with kiosk-specific fields
 *
 * For now, using 'any' for device to avoid type errors until proper types are defined.
 */

// Types for the dependencies
interface ProcessHoldItemDeps {
  device: any; // TODO: Use proper KioskDevice type once created
  license: any;
  licenseId: number;
  branch: any;
  sessionWizard: { value: any };
  sessionBranch: { value: any };
  sessionBarcode: string;
  nextLockerNro: { value: number };
  password: string;
  username: string;
  isADA: { value: boolean };
  patronPreference: string | null;

  // State setters
  setLoading: (loading: boolean) => void;
  setSessionWizard: (wizard: any) => void;
  setShowAddHoldInfo: (show: boolean) => void;
  setNextLockerNro: (nro: number) => void;
  setIsADA: (ada: boolean) => void;
  setTestedOpenDoor: (nro: number | null) => void;
  setPatronPreference: (pref: string | null) => void;
  setSelectionProtected: (isProtected: boolean) => void;
  setAllAvailableDoorsWithSizes: (sizes: any) => void;
  setSessionExistingItemsCount: (count: number) => void;
  updateSessionStaffModeOn: (on: boolean) => void;
  updateSessionUserModeOn: (on: boolean) => void;
  updateDevice: (device: any) => void;
  setLocation: (location: string) => void;
  setSplitMode: (mode: boolean) => void;
  setShowKeyboard: (show: boolean) => void;
  resetKeybard: () => void;

  // Functions
  stopVideo: () => void;
  testPatron: () => string;
  isItemIdAlradyInLocker: (itemId: string) => Promise<any>;
  customizedTestsPerLicenseIfInteInfoHasHoldOrCanProceed: (sipItemInfo: any, itemId: string) => Promise<boolean>;
  filterSelecedSize: (size: string, isADA: boolean) => number[];
  getAvailableLockers: () => Promise<void>;
  openErrorView: (duration?: number, message?: string) => void;
  endStaffMode: () => Promise<void>;
  exitCountdownTimer: (seconds: number) => void;
  startDoorCloseWatcher: (mac: string, doorNumber: number) => void;
  persistDeviceChanges: (device: any) => void;
  persistDeviceManifestChanges: (device: any) => void;
  createOrUpdateRestoredLockerEntity: (lockerNro: number, itemIds: string, patronId: string, type?: string) => Promise<any>;

  // Error report
  errorReport: { message: string };

  // Translation
  t: (key: string, params?: any) => string;

  // Timers
  handleExitCountdownTimerRef: React.MutableRefObject<any>;
}

// Helper functions

/**
 * Display error message in shared modal and exit staff mode
 * @param message - Error message to display
 * @param duration - Duration in milliseconds (default: 6000)
 * @param deps - ProcessHoldItemDeps containing openErrorView and endStaffMode
 */
async function errorModal(message: string, duration: number = 6000, deps: ProcessHoldItemDeps) {
  deps.openErrorView(duration, message);
  await deps.endStaffMode();
}

/**
 * Check if there are any empty lockers available across all groups
 *
 * This function checks device.thedoors (from RTDB) for all available doors,
 * then compares against device.manifest.groups.lockers to determine which
 * doors are occupied. A locker is considered occupied if it appears in the
 * manifest with an itemId or patronId assigned.
 *
 * @example
 * ```typescript
 * const anyEmptyLockers = hasAnyEmptyLockers(device);
 * if (!anyEmptyLockers) {
 *   console.log('All lockers are full!');
 * }
 * ```
 *
 * @param device - The device object containing thedoors, manifest and configuration
 * @returns Boolean indicating if there are empty lockers available
 */
export function hasAnyEmptyLockers(device: any): boolean {
  // Check if device has thedoors array from RTDB
  if (!device.thedoors || !Array.isArray(device.thedoors)) {
    console.warn('❌ hasAnyEmptyLockers: device.thedoors not found or not an array');
    return false;
  }

  // Get list of all available door numbers from device.thedoors
  const allDoors = new Set<number>();
  device.thedoors.forEach((door: any) => {
    if (door?.doorNumber !== undefined && door?.doorNumber !== null) {
      allDoors.add(Number(door.doorNumber));
    }
  });

  console.log(`📦 Total doors available: ${allDoors.size}`);

  // Get list of occupied door numbers from manifest.groups.lockers
  const occupiedDoors = new Set<number>();

  if (device.manifest?.groups) {
    for (const groupKey in device.manifest.groups) {
      const group = device.manifest.groups[groupKey];

      if (group.lockers) {
        for (const doorNumber in group.lockers) {
          const locker = group.lockers[doorNumber];

          // Mark door as occupied if it has an itemId or patronId (skip null/undefined lockers)
          if (locker && ((locker.itemIds && locker.itemIds.length > 0) || locker.patronId)) {
            occupiedDoors.add(Number(doorNumber));
          }
        }
      }
    }
  }

  console.log(`📦 Occupied doors: ${occupiedDoors.size}`);

  // Calculate empty doors by comparing all doors against occupied doors
  const emptyDoors = allDoors.size - occupiedDoors.size;
  console.log(`📦 Empty doors available: ${emptyDoors}`);

  return emptyDoors > 0;
}

/**
 * Get count of empty lockers available across all groups
 * @param device - The device object containing manifest and configuration
 * @returns Number of empty lockers available
 */
export function getEmptyLockerCount(device: any): number {
  if (!device.manifest?.groups) {
    return 0;
  }

  let totalLockers = 0;
  let occupiedLockers = 0;

  // Iterate through all groups in the manifest
  for (const groupKey in device.manifest.groups) {
    const group = device.manifest.groups[groupKey];

    if (group.lockers) {
      for (const i in group.lockers) {
        const locker = group.lockers[i];
        // Skip null/undefined entries
        if (!locker) continue;

        totalLockers++;

        // Count as occupied if it has an itemId or patronId
        if (!(locker.itemIds && locker.itemIds.length > 0) || locker.patronId) {
          occupiedLockers++;
        }
      }
    }
  }

  return totalLockers - occupiedLockers;
}

/**
 * Get count of empty ADA lockers available across all groups
 * @param device - The device object containing manifest and configuration
 * @returns Number of empty ADA lockers available
 */
export function getEmptyADALockerCount(device: any): number {
  if (!device.manifest?.groups) {
    return 0;
  }

  let emptyADACount = 0;

  // Iterate through all groups in the manifest
  for (const groupKey in device.manifest.groups) {
    const group = device.manifest.groups[groupKey];

    if (group.lockers) {
      for (const i in group.lockers) {
        const locker: any = group.lockers[i];
        // Skip null/undefined entries
        if (!locker) continue;

        // Count as empty ADA locker if it's ADA and has no itemId/patronId
        if (locker.isADA && !(locker.itemIds?.length > 0) || locker.patronId) {
          emptyADACount++;
          console.log(`🔄 Empty ADA locker found: ${i}`);
        }
      }
    }
  }

  return emptyADACount;
}

const makeSureSetHasUniqueItemsAndExpirationDates = (inputSet: any) => {
  let uniqueSet = {};
  for (const [expirationDate, itemIds] of Object.entries(inputSet)) {
    const uniqueItemIds = [...new Set(itemIds.toString().split(',').map((id) => id.trim()))];
    for (const itemId of uniqueItemIds) {
      if (!uniqueSet[itemId] || uniqueSet[itemId] < expirationDate) {
        uniqueSet[itemId] = expirationDate;
      }
    }
  }
  let result = {};
  for (const itemId of Object.keys(uniqueSet)) {
    if (!result[uniqueSet[itemId]]) {
      result[uniqueSet[itemId]] = [];
    }
    result[uniqueSet[itemId]].push(itemId);
  }
  return result;
};

const makeSureItemIdIsNotDuplicated = (inputString: string) => {
  const itemIds = inputString.split(',').map((id) => id.trim());
  let cancelledItemIds = itemIds.filter((id) => id[0] === '*');
  let itemIdsWithoutCancelled = itemIds.filter((id) => id[0] !== '*');

  cancelledItemIds = [...new Set(cancelledItemIds)];
  itemIdsWithoutCancelled = [...new Set(itemIdsWithoutCancelled)];
  let uniqueItemIds = [];
  cancelledItemIds.map((ci) => {
    if (!_.find(uniqueItemIds, (ui) => ui.includes(ci))) {
      uniqueItemIds.push(ci);
    }
  });

  itemIdsWithoutCancelled.map((i) => {
    if (!_.find(uniqueItemIds, (ui) => ui.includes(i))) {
      uniqueItemIds.push(i);
    }
  });

  return uniqueItemIds.join(',').trim();
};

const processSplitLockerContent = (
  device: any,
  groupNumber: number,
  newlockNro: number,
  wizard: any,
) => {
  const timestamp = Date.now();

  // Use wizard.holdExpires from ILS workflow, fallback to end of today
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const holdExpires = wizard.holdExpires || endOfToday.getTime();

  // Validate wizard.itemIds exists
  if (!wizard.itemIds || !Array.isArray(wizard.itemIds) || wizard.itemIds.length === 0) {
    console.error('❌ processSplitLockerContent: wizard.itemIds is invalid', wizard);
    return false;
  }

  const newItemId = wizard.itemIds.toString().trim();
  console.log(`📦 SPLIT: itemId="${newItemId}" → new door ${newlockNro}`);

  // THEN ADD THE NEW LOCKER TO THE MANIFEST
  if (!device.manifest.groups[groupNumber].lockers) {
    device.manifest.groups[groupNumber].lockers = []
  }

  console.log(`📦 SPLIT BEFORE: ${device.manifest.groups[groupNumber].lockers.length} lockers:`,
    JSON.stringify(device.manifest.groups[groupNumber].lockers.map((l:any) => l ? {door: l.doorNumber, items: l.itemIds} : null)));

  // Remove item from old locker
  let removedFromDoor = null;
  for (let i in device.manifest.groups[groupNumber].lockers) {
    const locker = device.manifest.groups[groupNumber].lockers[i];
    // Check if locker and itemIds exist before accessing
    if (locker && locker.itemIds && locker.itemIds.includes(newItemId)) {
      removedFromDoor = locker.doorNumber;
      console.log(`📦 SPLIT: Found item in door ${locker.doorNumber}, removing...`);
      const oldItemIdsLeft = locker.itemIds.filter((id: string) => id !== newItemId);
      let oldLockerObject = locker;
      oldLockerObject.itemIds = oldLockerObject.itemIds.filter((id: string) => id !== newItemId);

      if (oldItemIdsLeft.length > 0) {
        device.manifest.groups[groupNumber].lockers[i] = oldLockerObject;
      } else {
        // If no items left, mark locker for removal (set to null instead of delete to avoid sparse array during iteration)
        device.manifest.groups[groupNumber].lockers[i] = null;
      }
    }
  }

  if (!removedFromDoor) {
    console.error(`❌ SPLIT: Item "${newItemId}" NOT FOUND in any locker! Lockers:`,
      JSON.stringify(device.manifest.groups[groupNumber].lockers.map((l:any) => l ? {door: l.doorNumber, items: l.itemIds} : null)));
  }

  // Clean up the lockers array to remove null entries after iteration
  device.manifest.groups[groupNumber].lockers = device.manifest.groups[groupNumber].lockers.filter((locker: any) => locker != null);

  let newLockerObject = {
    itemIds: [newItemId],
    patronId: wizard.patronId,
    isADA: wizard.isADA,
    titles: {[newItemId]: wizard.title},
    timestamp: timestamp,
    doorNumber: newlockNro,
    set: {} as any,
  }
  // Populate set with holdExpires date as key → [itemIds]
  newLockerObject.set[holdExpires] = [newItemId];
  device.manifest.groups[groupNumber].lockers.push(newLockerObject);

  console.log(`📦 SPLIT AFTER: ${device.manifest.groups[groupNumber].lockers.length} lockers:`,
    JSON.stringify(device.manifest.groups[groupNumber].lockers.map((l:any) => l ? {door: l.doorNumber, items: l.itemIds} : null)));

  return true;
}

const processDefaultLockerAllocation = (
  device: any,
  groupNumber: number,
  lockNro: number,
  wizard: any,
) => {

  if (!device.manifest.groups[groupNumber].lockers) {
    device.manifest.groups[groupNumber].lockers = [];
  }

  // Validate wizard.itemIds exists
  if (!wizard.itemIds || !Array.isArray(wizard.itemIds) || wizard.itemIds.length === 0) {
    console.error('❌ processDefaultLockerAllocation: wizard.itemIds is invalid', wizard);
    return;
  }

  const timestamp = Date.now();

  // Use wizard.holdExpires from ILS workflow, fallback to end of today
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  const holdExpires = wizard.holdExpires || endOfToday.getTime();

  const newItemId = wizard.itemIds[0].trim();

  // Check if the locker number is already in use
  let lockerObjectIndex = _.findIndex(device.manifest.groups[groupNumber].lockers, (locker: any) => locker && +locker.doorNumber === +lockNro);
  const isNewLocker = lockerObjectIndex === -1;
  if (isNewLocker) {
    // New locker — different expiration date or patron not in this door yet
    console.log(`📦 Creating NEW locker at door #${lockNro} for patron ${wizard.patronId} (holdExpires: ${wizard.holdExpires})`);
    let lockerObject = {
      set: {} as any,
      title: {},
      doorNumber: lockNro,
      itemIds: [newItemId],
      patronId: wizard.patronId,
      isADA: wizard.isADA,
      titles: {[newItemId]: wizard.title},
      timestamp: timestamp,
    }
    // Populate set with holdExpires date as key → [itemIds]
    lockerObject.set[holdExpires] = [newItemId];
    // create new locker object
    device.manifest.groups[groupNumber].lockers.push(lockerObject);

  } else {
    // Same door already exists — same patron + same expiration date → add item to existing locker
    console.log(`📦 Adding item "${newItemId}" to EXISTING locker at door #${lockNro} for patron ${wizard.patronId} (same holdExpires: ${wizard.holdExpires})`);
    if (!Array.isArray(device.manifest.groups[groupNumber].lockers[lockerObjectIndex].itemIds)) {
      device.manifest.groups[groupNumber].lockers[lockerObjectIndex].itemIds = [];
    }
    device.manifest.groups[groupNumber].lockers[lockerObjectIndex].itemIds.push(newItemId);
    if (!device.manifest.groups[groupNumber].lockers[lockerObjectIndex].titles) {
      device.manifest.groups[groupNumber].lockers[lockerObjectIndex].titles = {};
    }
    device.manifest.groups[groupNumber].lockers[lockerObjectIndex].titles[newItemId] = wizard.title || '';
    device.manifest.groups[groupNumber].lockers[lockerObjectIndex].timestamp = timestamp;
    // Populate set with holdExpires date as key → [itemIds]
    if (!device.manifest.groups[groupNumber].lockers[lockerObjectIndex].set) {
      device.manifest.groups[groupNumber].lockers[lockerObjectIndex].set = {};
    }
    if (!device.manifest.groups[groupNumber].lockers[lockerObjectIndex].set[holdExpires]) {
      device.manifest.groups[groupNumber].lockers[lockerObjectIndex].set[holdExpires] = [];
    }
    device.manifest.groups[groupNumber].lockers[lockerObjectIndex].set[holdExpires].push(newItemId);
  }


}

async function customTestForHoldCheckinChange(
  itemId: string,
  customSipCY: string,
  secondSipItemInfoTest: number,
  deps: ProcessHoldItemDeps
) {
  const { licenseId, sessionWizard, setSessionWizard, errorReport, openErrorView } = deps;

  if (!(secondSipItemInfoTest === 8)) {
    const messageText = `Failed. HOLD on item ID ${itemId} is for other location, please check item's destination at the desk  or retry`;
    await errorModal(messageText, 6000, deps);
    return false;
  }
  return true;
}

// Step 1: Check-in hold item
export async function processHoldItem(itemId: string, deps: ProcessHoldItemDeps) {
  try {
    const {
      device,
      license,
      licenseId,
      branch,
      sessionWizard,
      sessionBranch,
      sessionBarcode,
      nextLockerNro,
      password,
      username,
      isADA,
      patronPreference,
      setLoading,
      setSessionWizard,
      setShowAddHoldInfo,
      setNextLockerNro,
      setIsADA,
      setTestedOpenDoor,
      setPatronPreference,
      updateSessionStaffModeOn,
      updateSessionUserModeOn,
      setLocation,
      stopVideo,
      testPatron,
      isItemIdAlradyInLocker,
      customizedTestsPerLicenseIfInteInfoHasHoldOrCanProceed,
      openErrorView,
      endStaffMode,
      exitCountdownTimer,
      handleExitCountdownTimerRef,
      errorReport,
      t,
    } = deps;

    updateSessionStaffModeOn(true);

    const processingText = 'Processing request with library systems...';
    updateSessionSpinnerStatus(processingText);
    setLoading(true);

    // Use real patron from wizard (set by workflowILSProcessHold), fall back to testPatron for demo (license 1/2)
    const isDemoLicense = licenseId === 1 || licenseId === 2;
    const testPatronId = sessionWizard.value?.patronId || (isDemoLicense ? testPatron() : testPatron());
    console.log(`📦 processHoldItem: patronId=${testPatronId} (${sessionWizard.value?.patronId ? 'wizard/ILS' : isDemoLicense ? 'demo' : 'fallback'})`);

    // TODO: SIP2 Status Check
    // Check SIP2 server status before proceeding with hold item processing
    // This ensures the ILS is available before attempting further operations
    if (device.licenseId > 2) {
      // const sipStatus = await sip2Service.getStatus(itemId, sessionBarcode);
      // if (!sipStatus || !sipStatus.ok) {
      //   await errorModal('SIP2 server unavailable, please try again later', 6000, deps);
      //   return;
      // }
    }


    const testResult = await isItemIdAlradyInLocker(itemId);
    if (testResult) {
      setTimeout(() => {
        setLoading(false);
        updateSessionSpinnerStatus('');
        updateSessionStaffModeOn(false);
        if (handleExitCountdownTimerRef.current) {
          clearTimeout(handleExitCountdownTimerRef.current);
        }
        exitCountdownTimer(10);
      }, 100);
    } else {
      // Check if there are any empty lockers available across all groups
      const anyEmptyLockers = hasAnyEmptyLockers(device);
      const emptyLockerCount = getEmptyLockerCount(device);
      const emptyADALockerCount = getEmptyADALockerCount(device);

      console.log(`📊 Empty locker check: ${anyEmptyLockers ? 'Available' : 'Full'} (${emptyLockerCount} empty lockers)`);

      const testedTime: any = device.settings.holdperiod ? null : MonthYear.getNextHelper().todayEnd;
      let customSipCY: any = null;

      // Use real ILS data from wizard if available, otherwise mock
      let sipItemInfo: any = {
        CM: sessionWizard.value?.holdExpires || testedTime?.getTime() || null,
        CY: testPatronId,
        circulationStatus: '08',
        titleIdentifier: sessionWizard.value?.itemTitle || itemId,
        ok: '1',
        PA: 'FOO',
        holdQueueLength: 1,
      };

      // Check if item is checked out
      if (+sipItemInfo?.circulationStatus === 4) {
        const errorMessage = `Item ID ${itemId} is currently checked out, processing a checked out itemID is not allowed in this mode`;
        await errorModal(errorMessage, 6000, deps);
        return;
      }

      // LEGACY REST CALL REMOVED
      // Custom for Phoenix only
      // if (license.name.toUpperCase().includes('PHOENIX') && +sipItemInfo?.circulationStatus !== 4) {
      //   let customItemInfo: any = await request(EndPoint.SIDEEVENT)
      //     .post(`${licenseId}/hybridsip`, {
      //       itemId: itemId,
      //       institutionId: branch.institutionId || '',
      //       branch: sessionBranch.value.branch_code,
      //       resource: 'sip:branchcheckin',
      //     })
      //     .then((result) => result.data || null);
      //
      //   if (customItemInfo?.CY) {
      //     sipItemInfo.CY = customItemInfo.CY;
      //   } else {
      //     throw new Error(`Barcode ${itemId} not found`);
      //   }
      // }

      // LEGACY REST CALL REMOVED
      // Custom way to get patron if locker is full and we need the patronId using overflow branch
      // const testwithOverflow = device.branch_overflow;
      // if (!anyEmptyLockers && testwithOverflow) {
      //   try {
      //     if (testwithOverflow.branch_code) {
      //       let preSIP = await request(EndPoint.SIDEEVENT)
      //         .post(`${licenseId}/hybridsip`, { itemId: itemId, branch: testwithOverflow.branch_code, resource: 'sip:branchcheckin' })
      //         .then((result) => result.data || {});
      //       // Just to get the CY property via check-in with overflow branch code
      //       if (preSIP?.CY) {
      //         customSipCY = preSIP.CY;
      //       }
      //     } else {
      //       throw new Error('Not found');
      //     }
      //   } catch (error) {
      //     console.log(error);
      //     errorReport.message = `Custom SIP2 integration check-in failed, please try again later`;
      //     openErrorView();
      //     return;
      //   }
      // }
      // Smart consolidation: when lockers are full, find patron's latest locker regardless of dates
      if (device.settings?.useSmartConsolidation && !anyEmptyLockers && sipItemInfo?.CY) {
        if (!patronLatestLocker(device, sipItemInfo.CY)) {
          const errorMessage = `No empty locker and patron has no existing locker to consolidate to`;
          await errorModal(errorMessage, 6000, deps);
          return;
        }
      }
      // Custom way for license >= 2
      else if (licenseId >= 2 && !anyEmptyLockers) {
        const testPatron = patronHasAllreadyHold(device, testPatronId, sipItemInfo.CM);
        if (!testPatron) {
          const errorMessage = `Locker is full, and patron having this hold, don't have suitable locker`;
          await errorModal(errorMessage, 6000, deps);
          return;
        }
      }
      // For all others, if locker is full
      else if (!anyEmptyLockers) {
        if (!validateItemInfo(sipItemInfo, itemId)) {
          const messageText = `Failed to validate barcode, please re-try`;
          await errorModal(messageText, 6000, deps);
          return;
        }

        if (!device.settings?.holdperiod && sipItemInfo && sipItemInfo.CY && sipItemInfo.CM) {
          const endOfDayresult = MonthYear.endOfDayAtCurrentLocation(license, sipItemInfo.CM);
          if (!patronHasAllreadyHold(device, sipItemInfo.CY, endOfDayresult)) {
            const errorMessage = `No empty locker for processed hold item or patron ID to add item`;
            await errorModal(errorMessage, 6000, deps);
            return;
          }
        } else if (!device.settings?.holdperiod && sipItemInfo && sipItemInfo.CY) {
          if (!patronHasAllreadyHold(device, sipItemInfo.CY)) {
            const errorMessage = `No empty locker for processed hold item or patron ID to add item`;
            await errorModal(errorMessage, 6000, deps);
            return;
          }
        } else {
          const errorMessage = `No empty doors available for processed hold item`;
          await errorModal(errorMessage, 6000, deps);
          return;
        }
      }

      setSessionWizard(
        Object.assign({}, sessionWizard.value, {
          ilsItemInfo: sipItemInfo,
          itemTitle: sipItemInfo.titleIdentifier ?? 'ID ' + itemId,
        })
      );

      // Patron block check .. express_patron_block
      if (device.settings?.express_patron_block && sipItemInfo?.CY) {
        const result = await runPatronBlocksCheck(
          licenseId,
          sipItemInfo.CY,
          branch.branch_code || sessionBranch.value.branch_code,
          device.config.locker
        );
        if (!result) {
          return;
        }
      }

      // Set of special tests for different licenses
      const testResult = await customizedTestsPerLicenseIfInteInfoHasHoldOrCanProceed(sipItemInfo, itemId);
      if (!testResult) {
        await errorModal('Failed to validate barcode, please re-try', 6000, deps);
        return;
      }

      // **************
      // LEGACY REST CALL REMOVED - Mock SIP2 checkin response
      let sip: any = { ok: '1', PA: 'FOO' };

      if (sip && validateIsSipOk(sip)) {
        if (customSipCY) {
          sip.CY = customSipCY;
        }

        const wiz = Object.assign({}, sessionWizard.value, { ilsCheckIn: sip, itemIds: [itemId] });
        setSessionWizard(wiz);

        // Set holdExpirationDate + patronId: demo licenses always use test values, others use ILS workflow values
        let secondSipItemInfoTest = 8;
        if (isDemoLicense) {
          setSessionWizard(
            Object.assign({}, sessionWizard.value, {
              holdExpires: MonthYear.getNextHelper().todayEnd.getTime(),
              patronId: testPatronId,
            })
          );
        } else {
          // ILS workflow already set these on the wizard — only fill in missing values
          if (!sessionWizard.value?.holdExpires && !device.settings?.holdperiod) {
            setSessionWizard(
              Object.assign({}, sessionWizard.value, {
                holdExpires: MonthYear.getNextHelper().todayEnd.getTime(),
              })
            );
          }
          if (!sessionWizard.value?.patronId) {
            setSessionWizard(
              Object.assign({}, sessionWizard.value, {
                patronId: testPatronId,
              })
            );
          }
        }

        if (!(await customTestForHoldCheckinChange(itemId, testPatronId, secondSipItemInfoTest, deps))) {
          return;
        }

        // LEGACY REST CALL REMOVED - Mock patron data
        let persistPatron: any = {
          identifier: username,
          license_id: licenseId,
          sideevent_id: licenseId + '-' + username,
          name: username,
          keyword: '',
          side_events: { lockers: [] },
          email: username,
          hms_disabled: true,
          notify_via: 'EMAIL',
          isADA: false,
        };

        setSessionWizard(Object.assign({}, sessionWizard.value, { isADA: false }));

        if (persistPatron && device.settings?.first_time_user) {
          if (!persistPatron?.side_events?.lockers) {
            persistPatron.side_events = {
              lockers: [],
            };
          }
          const patronPrefIndex = _.findIndex(persistPatron.side_events.lockers, (l: any) => l.id === device._id);
          if (persistPatron?.side_events?.lockers && patronPrefIndex !== -1) {
            const patronPref: any = persistPatron.side_events.lockers[patronPrefIndex];
            setPatronPreference(patronPref.preference || null);
          }
        }

        // LEGACY REST CALL REMOVED
        // Use patron preference or existing isAda value
        const testIsAda = patronPreference && patronPreference === 'ADA' ? true : persistPatron.isAda;
        setSessionWizard(
          Object.assign({}, sessionWizard.value, {
            isADA: testIsAda,
          })
        );

        setIsADA(sessionWizard.value.isADA || false);

        // LEGACY REST CALL REMOVED - Custom parsing for license 120
        // Hold period defined
        // const year = MonthYear.getNextHelper().todayEnd.getFullYear();
        // if (licenseId === 120 && secondSipItemInfoResult.response.includes('CM' + year) && !device.settings.holdperiod) {
        //   const firstPart = secondSipItemInfoResult.response.slice(secondSipItemInfoResult.response.indexOf('CM' + year));
        //   secondSipItemInfoResult.CM = firstPart.slice(2, firstPart.indexOf('|'));
        // }
        // if (secondSipItemInfoResult?.CM && !device.settings.holdperiod) {
        //   let text = secondSipItemInfoResult.CM;
        //   if (secondSipItemInfoResult.CM.includes(' ')) {
        //     text = text.slice(0, text.indexOf(' ')).trim();
        //   }
        //   const result = MonthYear.getNextHelper().todayEnd;
        //   setSessionWizard(Object.assign({}, sessionWizard.value, { holdExpirationDate: result }));
        // }

        // Get next locker nro
        console.log(`🔍 Getting next locker for patron ${sessionWizard.value.patronId}: isADA=${isADA.value}, patronPreference=${patronPreference}`);
        const next = getNextHoldModeDoorNro(device, isADA.value, patronPreference);
        console.log(`🔍 getNextHoldModeDoorNro returned: ${next} (type: ${typeof next})`);

        const doorNumber = next ? Number(next) : 0;
        console.log(`🔍 Converted to doorNumber: ${doorNumber}`);
        setNextLockerNro(doorNumber);
        setSessionWizard(Object.assign({}, sessionWizard.value, { doorNumber: doorNumber }));
        console.log(`🔍 After setting - nextLockerNro.value: ${nextLockerNro.value}, sessionWizard.doorNumber: ${sessionWizard.value.doorNumber}`);

        let testIfAlreadySomeExistingLockerNro: number | boolean;
        if (device.settings?.useSmartConsolidation) {
          // Smart consolidation: always add to patron's latest locker regardless of expiration date
          testIfAlreadySomeExistingLockerNro = patronLatestLocker(device, sessionWizard.value.patronId);
          console.log(`🔍 Smart consolidation: patron ${sessionWizard.value.patronId} latest locker: ${testIfAlreadySomeExistingLockerNro || 'none'}`);
        } else {
          testIfAlreadySomeExistingLockerNro = patronHasAllreadyHold(device, sessionWizard.value.patronId, sessionWizard.value.holdExpires);
          console.log(`🔍 Patron ${sessionWizard.value.patronId} already has hold in locker: ${testIfAlreadySomeExistingLockerNro || 'none'} (holdExpires: ${sessionWizard.value.holdExpires})`);
          console.log(`🔍 Rule: same patron + same expiration date → add to existing locker; different date → new locker`);
        }
        console.log(`🔍 Checking availability: existingLocker=${testIfAlreadySomeExistingLockerNro}, newDoor=${doorNumber}`);
        if (!testIfAlreadySomeExistingLockerNro && !doorNumber) {
          // No door found - check if it's because patron requested ADA but no ADA doors available
          if (isADA.value) {
            // ADA requested but no ADA doors available
            if (licenseId <= 2) {
              // For licenses 1-2: Allow fallback to any available door
              setIsADA(false);
              const messageText = `${sessionWizard.value.patronId} is pre-defined ADA Patron, but all ADA doors are in use. Assigning regular door instead.`;
              customToast(() => React.createElement('div', { dangerouslySetInnerHTML: { __html: messageText } }), 10000, 'info');

              // Retry finding a door without ADA restriction
              const retryNext = getNextHoldModeDoorNro(device, false, patronPreference);
              const retryDoorNumber = retryNext ? Number(retryNext) : 0;
              console.log(`🔍 Retry found door: ${retryDoorNumber}`);
              setNextLockerNro(retryDoorNumber);
              setSessionWizard(Object.assign({}, sessionWizard.value, { doorNumber: retryDoorNumber }));
            } else {
              // For other licenses: Exit with error
              const messageText = `${sessionWizard.value.patronId}\nADA Patron ID involved\n\nLocker cannot find empty accessible (ADA) door, exiting..`;
              await errorModal(messageText, 6000, deps);
              return;
            }
          } else {
            // Non-ADA patron, no doors available at all
            const messageText = `No empty locker available for patron ${sessionWizard.value.patronId}`;
            await errorModal(messageText, 6000, deps);
            return;
          }
        }

        if (!!testIfAlreadySomeExistingLockerNro) {
          // Same patron + same hold expiration date → add item to existing locker
          console.log(`📦 Adding item to existing locker #${testIfAlreadySomeExistingLockerNro} (same patron + same expiration date)`);
          setNextLockerNro(+testIfAlreadySomeExistingLockerNro);
          setSessionWizard(
            Object.assign({}, sessionWizard.value, {
              patronExists: true,
              doorNumber: testIfAlreadySomeExistingLockerNro,
            })
          );
        } else {
          setSessionWizard(
            Object.assign({}, sessionWizard.value, {
              patronExists: false,
            })
          );
        }

        if (!sessionWizard.value.doorNumber) {
          await errorModal('Failed to assign empty door number, please re-try', 6000, deps);
          return;
        }
        setTestedOpenDoor(sessionWizard.value.doorNumber);
        setShowAddHoldInfo(true);

        if (sessionWizard.value.patronExists) {
          // add to existing locker doorNro
          return await processHoldLockerSelection(0, sessionWizard.value.doorNumber, false, deps);
        } else {
          // create new locker doorNro
          return await makeHoldLockerSelection('NORMAL', sessionWizard.value.isADA, deps);
        }

      } else {
        throw new Error(`ItemId ${itemId} check-in failed. SIP2 reason is ${sip.screenMessage || 'no reason available'}`);
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An error occurred during hold item processing';
    await errorModal(errorMessage, 6000, deps);
  }
}

// Step 2: Make hold locker selection
export async function makeHoldLockerSelection(mode: string, isADA: boolean = false, deps: ProcessHoldItemDeps) {
  const {
    device,
    licenseId,
    sessionWizard,
    setSessionWizard,
    setSelectionProtected,
    filterSelecedSize,
    getAvailableLockers,
    stopVideo,
    endStaffMode,
    t,
  } = deps;

  stopVideo();
  setSelectionProtected(true);

  // Determine size based on mode parameter (not wizard flags which may not be updated yet)
  const isNormal = mode.includes('NORMAL');
  const isMedium = mode.includes('MEDIUM');
  const isLarge = mode.includes('LARGE');
  const isXXL = mode.includes('XXL');

  let selectedSize = 'small'; // default
  if (isMedium) {
    selectedSize = 'medium';
  } else if (isLarge) {
    selectedSize = 'large';
  } else if (isXXL) {
    selectedSize = 'xxl';
  }

  console.log(`📦 makeHoldLockerSelection: mode=${mode}, size=${selectedSize}, isADA=${isADA}`);

  setSessionWizard(
    Object.assign({}, sessionWizard.value, {
      mode: mode,
      isADA: isADA,
      isNormal: isNormal,
      isMedium: isMedium,
      isLarge: isLarge,
      isXXL: isXXL,
    })
  );

  getAvailableLockers();

  // Get available doors matching the size and ADA criteria
  // filterSelecedSize already returns doors sorted by priority (lowest prio = highest priority)
  const availableDoors = filterSelecedSize(selectedSize, isADA);

  console.log(`📦 makeHoldLockerSelection: availableDoors=${JSON.stringify(availableDoors)}`);

  // Get the first door (highest priority)
  const selectedDoorNumber = _.first(availableDoors) || null;

  console.log(`📦 makeHoldLockerSelection: selectedDoorNumber=${selectedDoorNumber}`);

  setSessionWizard(
    Object.assign({}, sessionWizard.value, {
      doorNumber: selectedDoorNumber,
    })
  );

  // LEGACY REST CALL REMOVED - Update patron's isADA
  // request(EndPoint.SIDEEVENT)
  //   .get(`/${licenseId}/patrons/identifier/` + sessionWizard.value.patronId)
  //   .then((persistPatron) => {
  //     if (persistPatron.data === null) {
  //       persistPatron.data = {
  //         identifier: sessionWizard.value.patronId,
  //         isADA: sessionWizard.value.isADA,
  //       };
  //       request(EndPoint.SIDEEVENT).post(`/${licenseId}/patrons/`, persistPatron.data);
  //     } else if (persistPatron.data.isADA !== sessionWizard.value.isADA) {
  //       persistPatron.data.isADA = sessionWizard.value.isADA;
  //       request(EndPoint.SIDEEVENT).post(`/${licenseId}/patrons/`, persistPatron.data);
  //     }
  //   });

  if (selectedDoorNumber) {
    // process hold locker selection, step 3
    await processHoldLockerSelection(0, selectedDoorNumber, false, deps);
  } else {
    const messageText = isADA ? t('No empty ADA locker to process hold item') : t('No empty locker to process hold item');
    await errorModal(messageText, 6000, deps);
  }
}

// Step 3: Process hold locker selection
export async function processHoldLockerSelection(groupNumber: number, lockNro: number, splitlocker: boolean, deps: ProcessHoldItemDeps) {
  try {
    const {
      device,
      sessionWizard,
      setLoading,
      setTestedOpenDoor,
      setSessionExistingItemsCount,
      getAvailableLockers,
      exitCountdownTimer,
      startDoorCloseWatcher,
      persistDeviceChanges,
      persistDeviceManifestChanges,
      endStaffMode,
      createOrUpdateRestoredLockerEntity,
      licenseId,
      t,
    } = deps;

    setLoading(true);
    console.log('🔍 processHoldLockerSelection - t function type:', typeof t);
    const openingText = `Opening locker ${lockNro}, stand by...`;
    updateSessionSpinnerStatus(openingText);

    // Ensure manifest.groups exists
    if (!device.manifest) {
      device.manifest = { groups: {} };
    }
    if (!device.manifest.groups) {
      device.manifest.groups = {};
    }
    if (!device.manifest.groups[groupNumber]) {
      device.manifest.groups[groupNumber] = { lockers: [] };
    }

    // Count existing items in this locker before adding new one
    const existingLocker = device.manifest.groups[groupNumber]?.lockers?.find((locker: any) => locker && +locker.doorNumber === +lockNro);
    const existingItemsCount = existingLocker?.itemIds?.length || 0;
    console.log(`📦 Locker #${lockNro} currently has ${existingItemsCount} items`);
    setSessionExistingItemsCount(existingItemsCount);

    if (splitlocker) {
      console.log(`📦 Split: moving item from old locker to door ${lockNro}`);
      console.log(`📦 Split wizard state:`, JSON.stringify(sessionWizard.value?.itemIds));
      console.log(`📦 Split device manifest lockers BEFORE:`, JSON.stringify(device.manifest?.groups?.[groupNumber]?.lockers?.map((l:any) => l ? {door: l.doorNumber, items: l.itemIds} : null)));
      const splitResult = processSplitLockerContent(device, groupNumber, lockNro, sessionWizard.value);
      console.log(`📦 Split result: ${splitResult}`);
      console.log(`📦 Split device manifest lockers AFTER:`, JSON.stringify(device.manifest?.groups?.[groupNumber]?.lockers?.map((l:any) => l ? {door: l.doorNumber, items: l.itemIds} : null)));
      cleanupManifestLockers(device.manifest);
    } else {
      processDefaultLockerAllocation(device, groupNumber, lockNro, sessionWizard.value);
    }

    setTestedOpenDoor(+lockNro);

    // Open the door and verify it actually opened
    let doorOpened = false;
    try {
      const result = await openDoor(+lockNro);
      console.log(`Door ${lockNro} open result:`, JSON.stringify(result));
      doorOpened = result?.doorOpened !== false;
    } catch (error) {
      console.error(`Error opening door ${lockNro}:`, error);
    }

    if (doorOpened) {
      console.log(`✅ Door ${lockNro} opened - showing wizard`);
      getAvailableLockers();
      setLoading(false);
      updateSessionSpinnerStatus('');

      // Door close watcher disabled — hardware has no door sensors (lock re-engages immediately)
      // Session duration controlled solely by countdown timer, like HomeLoT
      setTestedOpenDoor(+lockNro);
      console.log(`✅ setTestedOpenDoor called with: ${+lockNro}`);

      const timerAddHold = device.settings?.timerShowAddHold || 30;
      exitCountdownTimer(timerAddHold);

      // Persist manifest after door opens (non-blocking for UI)
      cleanupManifestLockers(device.manifest);
      persistDeviceManifestChanges(device.manifest).catch(err =>
        console.error(`❌ Manifest persist failed:`, err)
      );
      if (false) {
        // TODO: processHoldPickupEmailNotification(lockNro, sessionWizard.value);
      }
      // Success path - don't call finalizeHoldLockerSelection, wizard continues
      console.log(`✅ Wizard should now be visible for door ${lockNro}`);
    } else {
      console.log(`❌ Door ${lockNro} failed to open - showing error`);
      finalizeHoldLockerSelection(false, deps);
    }
  } catch (error) {
    console.error(error);
    finalizeHoldLockerSelection(false, deps);
  }

}

// Step 4: Final staff step
export async function finalizeHoldLockerSelection(success: boolean, deps: ProcessHoldItemDeps) {
  const { device, t, exitCountdownTimer } = deps;

  if (!success) {
    const messageText = t('DOOR.FAILED_TO_OPEN');
    await errorModal(messageText, 6000, deps);
  } else {
    // Manifest already updated in processHoldLockerSelection via updateManifest()
    exitCountdownTimer(10);
  }
}

