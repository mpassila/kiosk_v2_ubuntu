import React, { CSSProperties, useRef } from 'react';
import { useEffect, useState } from 'react';
import config from '../../../config';
import { Row, Col, Button, Space, Card, Switch, Modal, Table, TableProps} from 'antd';
import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { useLocation } from 'wouter';
import { sessionTimer, updateSessionTimer, sessionLocation, updateLocation, persistDeviceManifestChanges, sessionDevice, updateSessionUserModeOn, updateShowBackgroundImage,
  getTextStyle, updateFontSize, fontSizeStorage, libraryOfThingsGroup, fontSize,
  updateDevice,
  SEBlue,
  getImage,
  kioskConfig,
  customToast,
  getHotListItemIds,
  setHotListItemIds,
  sessionBranch,
  sessionLicenseId,
  updateSessionError,
  FirebaseSIP2 } from "../state/shared";
import { Promise } from "bluebird";
import { useTranslation } from 'react-i18next';
import { toast, ToastContainer } from 'react-toastify';
import { useSignals } from "@preact/signals-react/runtime";
import { isDoorOpen, openDoor, getDoorOpenFromRTDB } from 'renderer/state/locker';
import { createCheckinTransaction, createEnforceCheckinEvent, createDoorIsOpenTestFailedEvent } from 'renderer/state/transaction-service';

const POLARIS_API_BASE = 'https://polarisapi-be4ekemxaa-uc.a.run.app';
import Spinner from 'renderer/components/spinner';
import Keyboard from 'react-simple-keyboard';
import ZoomLanguageControls from '../components/ZoomLanguageControls';
import TextArea from 'antd/es/input/TextArea';

let testIsAllDoorsClosedByUser = false;
let exiting = false;
let returnWorkflowExecuted = false;
let countdownRunning = false;
let allImages = {};
let allLockers = {};

export default function LoTReturnPage() {
  useSignals();
  updateLocation('/lotreturn')
  const [leckerNameAndDescription, setLockerNameAndDescription] = useState({
    name: '',
    description: '',
    ignoreEnforceReturnCheck: false
  });
  const [showReport, setShowReport] = useState(true);
  const [loading, setLoading] = useState(true);
  const [, setLocation] = useLocation()
  const { t } = useTranslation();
  const style2: React.CSSProperties = { zIndex: 1, ...getTextStyle()};
  const stylePage: React.CSSProperties = { overflow: 'auto', height: '100%' };
  // const [color] = useState('#ffffff');
  const [isAllCheckedIn, setIsAllCheckedIn] = useState(false);
  const [anyDoorsOpen, setAnyDoorsOpen] = useState(true);
  const [lockersCheckedIn, setLockersCheckedIn] = useState<any>({});
  const [lockerFullMessage, setLockerFullMessage] = useState<string | null>(null);
  const [lockerFullGroupImage, setLockerFullGroupImage] = useState<string | null>(null);
  const [enforcedReturnProcessed, setEnforcedReturnProcessed] = useState(false);
  const hasInitialized = useRef(false);
  // Don't create snapshot - use sessionDevice.value directly for real-time RTDB updates
  const config = kioskConfig.value;
  const user = JSON.parse(localStorage.getItem('patron') || '{}' );

  // Check for condition check enforcement from localStorage using queue system
  const getConditionCheckQueue = (): any[] => {
    const queueStr = localStorage.getItem('conditionCheckQueue');
    return queueStr ? JSON.parse(queueStr) : [];
  };

  const conditionCheckQueue = getConditionCheckQueue();
  const conditionCheckEnforced = conditionCheckQueue.length > 0;
  const conditionCheckEnforcedItem = conditionCheckQueue.length > 0 ? conditionCheckQueue[0] : null;

  console.log('📋 LoTReturn - Condition check queue read from localStorage:', {
    queueLength: conditionCheckQueue.length,
    currentItem: conditionCheckEnforcedItem,
    fullQueue: conditionCheckQueue
  });

  // Remove the current item from the queue and update localStorage
  if (conditionCheckEnforcedItem) {
    const remainingQueue = conditionCheckQueue.slice(1);
    localStorage.setItem('conditionCheckQueue', JSON.stringify(remainingQueue));
    console.log('🗑️  LoTReturn - Removed item from queue, updated localStorage:', {
      removedItem: conditionCheckEnforcedItem,
      remainingQueueLength: remainingQueue.length,
      remainingQueue: remainingQueue
    });
  }

  // Get device groups directly from device
  // The device object is reactive (via useSignals), so component will re-render when it changes
  const getDeviceGroups = () => {
    // Try to get groups from sessionDevice.value.manifest first (most common location)
    if (sessionDevice.value?.manifest?.groups) {
      return Array.isArray(sessionDevice.value.manifest.groups)
        ? sessionDevice.value.manifest.groups
        : Object.values(sessionDevice.value.manifest.groups);
    }

    // Fallback to config.locker.groups (from subscription updates)
    if (sessionDevice.value?.config?.locker?.groups) {
      return Array.isArray(sessionDevice.value.config.locker.groups)
        ? sessionDevice.value.config.locker.groups
        : Object.values(sessionDevice.value.config.locker.groups);
    }

    // Last fallback to kioskConfig
    if (config.device?.manifest?.groups) {
      return Array.isArray(config.device.manifest.groups)
        ? config.device.manifest.groups
        : Object.values(config.device.manifest.groups);
    }

    return [];
  };

  // Helper function to extract filename from Firebase Storage URLs
  const parseImageFilename = (imageUrl: string | null | undefined): string | null => {
    if (!imageUrl) return null;

    let filename = imageUrl;

    // Check if it's a URL (starts with http:// or https://
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      try {
        const url = new URL(imageUrl);
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
          filename = decodedPath.split('/').pop() || imageUrl;
        } else {
          // Standard URL, just get the last part
          filename = pathname.split('/').pop() || imageUrl;
        }

        // Remove query parameters if present
        filename = filename.split('?')[0];
      } catch (error) {
        console.error('❌ Error parsing image URL:', error);
        // Fallback to simple split
        filename = imageUrl.split('/').pop()?.split('?')[0] || imageUrl;
      }
    } else {
      // Not a URL, just extract filename from path
      filename = imageUrl.split('/').pop()?.split('?')[0] || imageUrl;
    }

    return filename;
  };

  // Log device groups for debugging
  useEffect(() => {
    const deviceGroups = getDeviceGroups();

    if (deviceGroups.length === 0) {
      console.error('❌ LoTReturn - No device groups found!', {
        'sessionDevice.value.manifest.groups exists': !!sessionDevice.value?.manifest?.groups,
        'sessionDevice.value.config.locker.groups exists': !!sessionDevice.value?.config?.locker?.groups,
        'config.device.manifest.groups exists': !!config.device?.manifest?.groups
      });
    } else {
      console.log('🔄 LoTReturn - Device groups loaded:', {
        groupsCount: deviceGroups.length,
        groups: deviceGroups.map((g: any) => ({ name: g.name, description: g.description }))
      });
    }
  }, [sessionDevice.value?.manifest?.groups]);

  const updateLockerStatus:any = (doorNumber: number, targetGroupName?: string) => {
    // Update locker status in Firebase groups structure
    const deviceGroups = getDeviceGroups();
    deviceGroups.forEach((group: any, groupIndex: number) => {
      // Only modify the matching group to avoid cross-contaminating lockers in other groups
      if (targetGroupName && group.name !== targetGroupName) return;

      if (group.lockers && group.lockers[doorNumber]) {
        const locker = group.lockers[doorNumber];

        // Check if this is a condition check item (should stay in locker)
        const isConditionCheck = locker.conditionCheck === true && locker.patronId === 'All';

        if (locker.isLockedForItemId) {
          // Permanent locker — don't clear itemIds, just reset status and patronId
          const updatedLocker: any = {
            ...group.lockers[doorNumber],
            status: 'AVAILABLE',
            patronId: 'All',
            timestamp: new Date().getTime(),
          };
          if (sessionDevice.value?.settings?.enforceReturnCheck && !group.ignoreEnforceReturnCheck) {
            updatedLocker.enforceReturnCheck = true;
            updatedLocker.conditionCheck = true;
          }
          group.lockers[doorNumber] = updatedLocker;
          console.log('✅ Reset permanent locker (isLockedForItemId) after return:', doorNumber);
        } else if (isConditionCheck) {
          // DO NOT clear itemIds for condition check items - they stay until staff processes
          console.log('⚠️  Skipping locker update for condition check item:', {
            doorNumber,
            itemIds: locker.itemIds,
            reason: 'Item requires staff verification'
          });
          // Don't update anything - item stays as-is
        } else {
          // Normal return - clear the locker
          const clearedLocker: any = {
            ...group.lockers[doorNumber],
            checkedIn: true,
            checkedOut: false,
            enabled: true,
            available: true,
            patronId: undefined,
            conditionCheck: undefined,
            itemIds: [],
            timestamp: new Date().getTime(),
            empty: true
          };
          if (sessionDevice.value?.settings?.enforceReturnCheck && !group.ignoreEnforceReturnCheck) {
            clearedLocker.enforceReturnCheck = true;
            clearedLocker.conditionCheck = true;
          }
          group.lockers[doorNumber] = clearedLocker;
          console.log('✅ Cleared locker after normal return:', doorNumber);
        }
      }
    });
  }

  useEffect(() => {
      // Only run initialization logic once per component mount
      // Prevents re-runs from manifest changes (via RTDB subscription) resetting flags
      if (hasInitialized.current) return;
      hasInitialized.current = true;

      // Reset module-level flags for new session
      returnWorkflowExecuted = false;
      exiting = false;
      countdownRunning = false;

      // Get fresh device groups data on every effect run
      const deviceGroups = getDeviceGroups();

      // Log condition check enforcement status
      console.log('🔍 LoTReturn - Condition check enforcement:', {
        enforced: conditionCheckEnforced,
        item: conditionCheckEnforcedItem,
        alreadyProcessed: enforcedReturnProcessed,
        deviceGroupsCount: deviceGroups.length
      });

      /**
       * ENFORCED RETURN FLOW - Condition Check Required
       *
       * When an item requires condition checking (hotlist item), this flow automatically
       * assigns it to an available locker for the patron to return.
       *
       * Locker Entry Structure:
       * @typedef {Object} LockerEntry
       * @property {number} doorNumber - Physical door number (e.g., 1, 2, 3...)
       * @property {string[]} itemIds - Array of item barcodes in this locker
       * @property {string} patronId - Patron identifier or 'All' for condition check returns
       * @property {boolean} conditionCheck - NEW: Flag indicating item requires condition verification by staff
       * @property {number} timestamp - Unix timestamp of when locker was assigned
       * @property {boolean} checkedIn - Whether item has been checked in
       * @property {boolean} checkedOut - Whether locker is currently checked out to patron
       * @property {boolean} enabled - Whether this locker is enabled/operational
       * @property {boolean} available - Whether this locker is available for use
       * @property {boolean} empty - Whether this locker is empty
       */

      // If condition check is enforced, add item wizard logic
      if (conditionCheckEnforced && conditionCheckEnforcedItem && !enforcedReturnProcessed) {
        console.log('🔧 LoTReturn - Starting add item wizard for enforced item');
        setEnforcedReturnProcessed(true); // Mark as processed to prevent duplicate execution

        // Find the group by name
        const targetGroup = deviceGroups.find((g: any) => g.name === conditionCheckEnforcedItem.groupName);

        if (!targetGroup) {
          console.error('❌ LoTReturn - Target group not found:', conditionCheckEnforcedItem.groupName);
          console.error('Available groups:', deviceGroups.map((g: any) => g?.name));
          customToast(() => (<b>Group not found: {conditionCheckEnforcedItem.groupName}</b>), 5000, 'error', 'dark');
          updateSessionTimer(sessionDevice.value?.settings?.timerForErrorView || 10);
          exitCountdownTimer();
          return;
        }

        // Check if patron self-return is allowed for this item type
        const patronAllowedSizes = targetGroup.patronAllowedSizes || [];
        if (patronAllowedSizes.length === 0) {
          console.warn('⛔ LoTReturn - No patronAllowedSizes for group:', targetGroup.name);
          updateSessionError({ message: t('ERROR.RETURN_TO_ITEMTYPE_NOT_ALLOWED', { itemType: targetGroup.name }) });
          setLocation('/error');
          return;
        }

        console.log('🔍 LoTReturn - Found target group:', {
          name: targetGroup.name,
          lockersObject: targetGroup.lockers,
          lockerCount: targetGroup.lockers ? Object.keys(targetGroup.lockers).length : 0,
          lockerKeys: targetGroup.lockers ? Object.keys(targetGroup.lockers) : [],
          patronAllowedSizes: targetGroup.patronAllowedSizes,
          fullTargetGroup: targetGroup
        });

        // STEP 1: Check all items in ALL lockers in the group

        const allItemsInGroup: any[] = [];
        let itemAlreadyInLocker = false;
        let existingDoorNumber = null;
        let existingDoorKey = null;
        const targetItemId = String(conditionCheckEnforcedItem.itemId); // Normalize to string

        console.log('🔍 Looking for itemId:', {
          original: conditionCheckEnforcedItem.itemId,
          normalized: targetItemId,
          type: typeof conditionCheckEnforcedItem.itemId
        });

        if (targetGroup.lockers && Object.keys(targetGroup.lockers).length > 0) {
          for (const doorKey in targetGroup.lockers) {
            const locker = targetGroup.lockers[doorKey];

            console.log(`🔍 Checking door ${doorKey}:`, {
              hasLocker: !!locker,
              hasItemIds: !!locker?.itemIds,
              itemIds: locker?.itemIds,
              itemIdsType: locker?.itemIds ? typeof locker.itemIds : 'undefined',
              isArray: Array.isArray(locker?.itemIds),
              fullLocker: locker
            });

            if (locker?.itemIds) {
              // Handle both array and single value
              const itemIdsArray = Array.isArray(locker.itemIds) ? locker.itemIds : [locker.itemIds];

              // Normalize all items to strings for comparison
              const normalizedItemIds = itemIdsArray.map((id: any) => String(id));

              // Collect all items
              allItemsInGroup.push(...normalizedItemIds);

              // Check if our item is in this locker (compare as strings)
              if (normalizedItemIds.includes(targetItemId)) {
                itemAlreadyInLocker = true;
                existingDoorKey = doorKey;
                existingDoorNumber = locker.doorNumber || parseInt(doorKey);
                console.log('⚠️  Item already exists in locker:', {
                  targetItemId,
                  itemIds: locker.itemIds,
                  normalizedItemIds,
                  doorKey,
                  doorNumber: existingDoorNumber,
                  match: true
                });
              } else {
                console.log(`✅ Item NOT in door ${doorKey}:`, {
                  targetItemId,
                  normalizedItemIds,
                  match: false
                });
              }
            }
          }
        } else {
          console.log('⚠️  No lockers in group yet - skipping item check (group is empty)');
        }

        console.log('📊 Group inventory summary:', {
          totalItemsInGroup: allItemsInGroup.length,
          uniqueItems: new Set(allItemsInGroup).size,
          itemAlreadyExists: itemAlreadyInLocker,
          targetItemId,
          allItems: allItemsInGroup,
          allItemsUnique: [...new Set(allItemsInGroup)]
        });

        // STEP 2: If item already in locker, re-open the door where it is
        if (itemAlreadyInLocker && existingDoorNumber) {
          console.log('🚪 Item already in locker - re-opening door:', existingDoorNumber);

          setLockerNameAndDescription({
            name: targetGroup.name || '',
            description: targetGroup.description || '',
            ignoreEnforceReturnCheck: targetGroup.ignoreEnforceReturnCheck || false
          });

          allImages = {};
          allImages[existingDoorKey] = {
            door: existingDoorKey,
            image: targetGroup.image,
            name: targetGroup.name
          };

          allLockers = {};
          allLockers[existingDoorKey] = {
            itemIds: [conditionCheckEnforcedItem.itemId],
            image: parseImageFilename(targetGroup?.image),
            name: targetGroup?.name,
            locked: true,
            available: false,
            door: existingDoorKey,
            doorNumber: existingDoorNumber,
            empty: false,
            returned: false
          };

          customToast(() => (<b>Opening door {existingDoorNumber}</b>), 5000, 'default', 'dark');

          processDoor(existingDoorNumber).then(async () => {
            allLockers[existingDoorKey] = {
              ...allLockers[existingDoorKey],
              locked: false,
              returned: true
            };
            testIsAllDoorsClosedByUser = true;
            updateSessionTimer(sessionDevice.value?.settings?.timerForReturnView || 30);
            exitCountdownTimer();
            setLockersCheckedIn(allLockers);
            setLoading(false);
          });

          return;
        }

        // STEP 3: Check available doors and capacity
        console.log('🔍 STEP 3: Checking available doors and capacity');

        const allowedSizes = (targetGroup.patronAllowedSizes || []).map((s: string) => s?.toLowerCase());
        console.log('📏 Allowed door sizes for patron returns:', allowedSizes);

        // Get physical doors data - try multiple sources
        let physicalDoors = sessionDevice.value?.thedoors || sessionDevice.value?.config?.locker?.thedoors || config.device?.thedoors || {};
        console.log('🚪 Physical doors data:', {
          count: Object.keys(physicalDoors).length,
          doors: physicalDoors,
          sources: {
            'sessionDevice.value.thedoors': !!sessionDevice.value?.thedoors,
            'sessionDevice.value.config.locker.thedoors': !!sessionDevice.value?.config?.locker?.thedoors,
            'config.device.thedoors': !!config.device?.thedoors
          }
        });

        // Count available vs occupied doors
        let totalDoors = 0;
        let occupiedDoors = 0;
        let availableDoorsCount = 0;
        let wrongSizeDoors = 0;

        // Log each locker's details and count availability
        console.log('🔍 Analyzing lockers in group:', {
          hasLockersObject: !!targetGroup.lockers,
          lockersObjectType: typeof targetGroup.lockers,
          lockersKeys: targetGroup.lockers ? Object.keys(targetGroup.lockers) : [],
          lockersCount: targetGroup.lockers ? Object.keys(targetGroup.lockers).length : 0
        });

        if (targetGroup.lockers && Object.keys(targetGroup.lockers).length > 0) {
          Object.entries(targetGroup.lockers).forEach(([key, locker]: [string, any]) => {
            totalDoors++;
            const physicalDoor = physicalDoors[key];
            const doorSize = physicalDoor?.size?.toLowerCase();
            const sizeAllowed = allowedSizes.length === 0 || !physicalDoor || allowedSizes.includes(doorSize);
            const hasItems = locker?.itemIds && locker.itemIds.length > 0;
            const isOccupied = hasItems || locker?.conditionCheck === true || (locker?.patronId && locker.patronId !== 'All');

            if (isOccupied) occupiedDoors++;
            if (!isOccupied && sizeAllowed) availableDoorsCount++;
            if (!sizeAllowed) wrongSizeDoors++;

            console.log(`📋 Door ${key} (doorNumber: ${locker?.doorNumber || 'N/A'}) status:`, {
              exists: !!locker,
              patronId: locker?.patronId,
              itemIds: locker?.itemIds,
              itemCount: locker?.itemIds?.length || 0,
              conditionCheck: locker?.conditionCheck,
              physicalDoorSize: physicalDoor?.size,
              sizeAllowed,
              isOccupied,
              available: !isOccupied && sizeAllowed
            });
          });
        } else {
          console.log('⚠️  Group has no lockers yet - will need to create first locker');
        }

        console.log('📊 Door capacity summary:', {
          totalDoors,
          occupiedDoors,
          availableDoorsCount,
          wrongSizeDoors,
          hasAvailableSpace: availableDoorsCount > 0
        });

        // Find a suitable EMPTY door in the target group by iterating through physical doors
        let availableDoor = null;
        let availableDoorKey = null;
        let availableDoorNumber = null;

        // Helper function to check if a door is truly empty and available
        const isDoorAvailable = (locker: any, doorIndex: string, physicalDoor: any) => {
          // FIRST: Check door size restrictions (even if locker doesn't exist yet)
          let doorSize = null;

          // Check if door size is allowed for patron returns (case-insensitive)
          // Only check size if physical door data is provided (not null)
          if (physicalDoor !== null) {
            doorSize = physicalDoor?.size?.toLowerCase();

            // If we have size restrictions AND physical door data exists, check the size
            if (allowedSizes.length > 0 && physicalDoor) {
              if (!doorSize || !allowedSizes.includes(doorSize)) {
                console.log('❌ Door unavailable: size not allowed for patron returns', {
                  doorIndex,
                  doorNumber: physicalDoor?.doorNumber,
                  doorSize: physicalDoor?.size,
                  doorSizeNormalized: doorSize,
                  allowedSizes
                });
                return false;
              }
            }
          } else {
            // Physical door is explicitly null - skip size check
            console.log('⚠️  Skipping door size check (no physical door data available)');
          }

          // SECOND: If locker doesn't exist yet AND size is OK (or no restrictions), it's available
          if (!locker) {
            console.log('✅ Door is available: does not exist yet (size check passed)');
            return true; // Door doesn't exist yet - can be used
          }

          // Exclude doors with pending condition checks
          if (locker.conditionCheck === true) {
            console.log('❌ Door unavailable: has pending conditionCheck');
            return false;
          }

          // Check if door has items
          const hasItems = locker.itemIds && locker.itemIds.length > 0;

          // Check patron status
          const hasNoPatron = !locker.patronId;
          const patronIsAll = locker.patronId === 'All';

          // CASE 1: Door has items AND has a patron (assigned to someone) - NOT AVAILABLE
          if (hasItems && locker.patronId && locker.patronId !== 'All') {
            console.log('❌ Door unavailable: has items and assigned to patron', locker.patronId);
            return false;
          }

          // CASE 2: Door has items but NO patron (orphaned/stale data) - AVAILABLE (we'll clear it)
          if (hasItems && hasNoPatron) {
            console.log('⚠️  Door has orphaned items (no patron) - will be cleared and used');
            return true;
          }

          // CASE 3: Door has no items OR patron is 'All' - AVAILABLE
          const isAvailable = !hasItems || patronIsAll;

          console.log(`${isAvailable ? '✅' : '❌'} Door availability:`, {
            hasItems,
            hasNoPatron,
            patronIsAll,
            isAvailable,
            patronId: locker.patronId,
            itemCount: locker.itemIds?.length,
            doorSize: doorSize || 'N/A',
            sizeAllowed: doorSize ? (allowedSizes.length === 0 || allowedSizes.includes(doorSize)) : 'N/A (no size data)'
          });

          return isAvailable;
        };

        // STEP 4: Search for an available door
        console.log('🔍 STEP 4: Searching for an available door to assign');
        const physicalDoorsCount = Object.keys(physicalDoors).length;
        console.log('🚪 Physical doors available for search:', {
          physicalDoorsCount,
          physicalDoorsKeys: Object.keys(physicalDoors),
          hasPhysicalDoors: physicalDoorsCount > 0
        });

        if (physicalDoorsCount > 0) {
          // We have physical doors data - iterate through them
          console.log('🚪 Iterating through physical doors to find available one...');
          for (const doorIndex in physicalDoors) {
            const physicalDoor = physicalDoors[doorIndex];
            const doorNumber = physicalDoor?.doorNumber;

            console.log(`🔍 Checking physical door index ${doorIndex}, doorNumber ${doorNumber}`);

            // Get the locker entry for this door index (if it exists)
            const locker = targetGroup.lockers?.[doorIndex];
            console.log(`   Locker exists for door ${doorIndex}:`, !!locker, locker);

            const isAvailable = isDoorAvailable(locker, doorIndex, physicalDoor);

            console.log(`🔍 Door ${doorIndex} (doorNumber ${doorNumber}):`, {
              available: isAvailable,
              hasLocker: !!locker,
              hasItems: locker?.itemIds?.length > 0,
              patronId: locker?.patronId,
              empty: locker?.empty,
              itemIds: locker?.itemIds,
              physicalDoorSize: physicalDoor?.size
            });

            if (isAvailable) {
              availableDoor = locker || {};
              availableDoorKey = doorIndex; // Use the index (0, 1, 2, etc.)
              availableDoorNumber = doorNumber; // The actual door number (1, 2, 3, etc.)
              console.log('✅ LoTReturn - Found available door:', {
                doorIndex,
                doorNumber,
                physicalDoor
              });
              break;
            } else {
              console.log(`❌ Door ${doorIndex} NOT available, continuing search...`);
            }
          }

          console.log('🔍 Physical door search complete:', {
            foundAvailableDoor: !!availableDoorKey,
            availableDoorKey,
            availableDoorNumber
          });
        } else {
          console.log('⚠️  No physical doors found - using fallback approach');
          // No physical doors data - fall back to iterating through target group lockers
          console.log('⚠️  No physical doors data, falling back to target group lockers');
          console.log('⚠️  Size restrictions will be skipped since physical door data is unavailable');

          if (targetGroup.lockers) {
            for (const doorIndex in targetGroup.lockers) {
              const locker = targetGroup.lockers[doorIndex];

              // Pass null for physical door to skip size checking in isDoorAvailable
              const isAvailable = isDoorAvailable(locker, doorIndex, null);

              console.log(`🔍 Checking locker ${doorIndex}:`, {
                available: isAvailable,
                hasItems: locker?.itemIds?.length > 0,
                patronId: locker?.patronId
              });

              if (isAvailable) {
                availableDoor = locker || {};
                availableDoorKey = doorIndex;
                availableDoorNumber = locker?.doorNumber || parseInt(doorIndex);
                console.log('✅ Found available door (fallback):', {
                  doorIndex,
                  doorNumber: availableDoorNumber
                });
                break;
              }
            }
          } else {
            // No lockers exist yet - create first locker at index 0
            console.log('⚠️  No lockers exist yet, will create first locker at index 0');
            availableDoorKey = '0';
            availableDoorNumber = 1; // Default to door number 1
            availableDoor = {};
          }
        }

        if (!availableDoorKey || !availableDoorNumber) {
          console.error('❌ LoTReturn - No available empty doors found');
          console.error('📊 Final decision - LOCKER FULL:', {
            groupName: conditionCheckEnforcedItem.groupName,
            itemId: conditionCheckEnforcedItem.itemId,
            totalDoors,
            occupiedDoors,
            availableDoorsCount,
            wrongSizeDoors,
            allowedSizes,
            allItemsInGroup: allItemsInGroup.length,
            reason: availableDoorsCount === 0 ? 'All doors occupied or wrong size' : 'No suitable door found'
          });

          // Set the locker full message to be displayed in the UI
          let message = `Locker is full. The ${conditionCheckEnforcedItem.groupName} cannot be returned to the locker at this time.`;

          if (wrongSizeDoors > 0 && allowedSizes.length > 0) {
            message += ` Only ${allowedSizes.join(', ')} size doors are available for patron returns.`;
          }

          message += ` Please return this item to the staff desk. Thank you!`;

          setLockerFullMessage(message);
          setLockerFullGroupImage(targetGroup.image);
          setLockerNameAndDescription({
            name: targetGroup.name || '',
            description: targetGroup.description || '',
            ignoreEnforceReturnCheck: targetGroup.ignoreEnforceReturnCheck || false
          });
          setLoading(false);

          // Exit after showing the message
          updateSessionTimer(sessionDevice.value?.settings?.timerForErrorView || 10);
          exitCountdownTimer();
          return;
        }

        // STEP 5: Add item to the available door
        console.log('✅ STEP 5: Adding item to available door');
        console.log('📊 Final decision - PROCEED WITH RETURN:', {
          groupName: conditionCheckEnforcedItem.groupName,
          itemId: conditionCheckEnforcedItem.itemId,
          assignedDoorKey: availableDoorKey,
          assignedDoorNumber: availableDoorNumber,
          totalItemsInGroupBefore: allItemsInGroup.length,
          availableDoorsRemaining: availableDoorsCount - 1
        });

        // Add the item to the available door's locker in the manifest
        const groupIndex = deviceGroups.indexOf(targetGroup);
        if (groupIndex !== -1 && config.device?.manifest?.groups) {
          const manifestGroup = config.device.manifest.groups[groupIndex];

          if (!manifestGroup.lockers) {
            manifestGroup.lockers = {};
          }

          console.log('🔢 Final door mapping:', {
            doorKey: availableDoorKey,
            doorNumber: availableDoorNumber,
            message: 'Using doorKey (index) as locker key, doorNumber as doorNumber'
          });

          console.log('📦 Creating manifest entry with itemId:', conditionCheckEnforcedItem.itemId);

          // Update or create the locker entry with patronId 'All' and conditionCheck flag
          manifestGroup.lockers[availableDoorKey] = {
            doorNumber: availableDoorNumber,
            itemIds: [conditionCheckEnforcedItem.itemId],
            patronId: 'All',
            conditionCheck: true,
            timestamp: conditionCheckEnforcedItem.timestamp,
            enabled: true,
            available: false,
            empty: false
          };

          console.log('✅ LoTReturn - Added enforced item to manifest:', {
            group: conditionCheckEnforcedItem.groupName,
            doorKey: availableDoorKey,
            doorNumber: availableDoorNumber,
            itemId: conditionCheckEnforcedItem.itemId,
            itemIds: manifestGroup.lockers[availableDoorKey].itemIds,
            patronId: manifestGroup.lockers[availableDoorKey].patronId,
            conditionCheck: manifestGroup.lockers[availableDoorKey].conditionCheck,
            fullLockerEntry: manifestGroup.lockers[availableDoorKey]
          });

          // Persist the changes immediately
          persistDeviceManifestChanges(config.device.manifest).then(() => {
            console.log('✅ LoTReturn - Manifest changes persisted, continuing to return flow');
            console.log('📥 After persist, locker entry is:', manifestGroup.lockers[availableDoorKey]);
            customToast(() => (<b>Please return item to door {availableDoorNumber}</b>), 5000, 'success', 'dark');
            // Don't clear enforcement yet - let the user return the item first
            // The enforcement will be cleared in the exit() function after successful return
          }).catch((error) => {
            console.error('❌ LoTReturn - Failed to persist manifest changes:', error);
            customToast(() => (<b>Failed to add item to locker</b>), 5000, 'error', 'dark');
          });

          // Manually set up the locker for display in htmlCheckinThing
          allLockers = {};
          let lotLockerReportTemp = {};

          // Add report options for the enforced item
          lotLockerReportTemp[availableDoorKey] = [];

          let title = targetGroup.name + ' missing?';
          let description = 'Report if item processed is missing';
          let descriptionIfReported = 'Will be reported as missing';
          lotLockerReportTemp[availableDoorKey].push({
            title: title,
            description: description,
            descriptionIfReported: descriptionIfReported,
            report: false,
            index: lotLockerReportTemp[availableDoorKey].length,
            door: availableDoorKey
          });

          title = targetGroup.name + ' damaged?';
          description = 'Report if item processed is damaged';
          descriptionIfReported = 'Will be reported as damaged';
          lotLockerReportTemp[availableDoorKey].push({
            title: title,
            description: description,
            descriptionIfReported: descriptionIfReported,
            report: false,
            index: lotLockerReportTemp[availableDoorKey].length,
            door: availableDoorKey
          });

          lotLockerReportTemp[availableDoorKey].push({
            title: 'Message to staff',
            description: 'Write a message to staff',
            descriptionIfReported: 'Message will be sent to staff',
            report: false,
            index: lotLockerReportTemp[availableDoorKey].length,
            door: availableDoorKey
          });

          setLotLockerReport(lotLockerReportTemp);

          // Set locker name and description
          setLockerNameAndDescription({
            name: targetGroup.name || '',
            description: targetGroup.description || '',
            ignoreEnforceReturnCheck: targetGroup.ignoreEnforceReturnCheck || false
          });

          // Add image reference
          allImages = Object.assign({}, allImages);
          allImages[availableDoorKey] = {
            door: availableDoorKey,
            image: targetGroup.image,
            name: targetGroup.name
          };

          // Add the locker to allLockers for display
          allLockers[availableDoorKey] = {
            itemIds: [conditionCheckEnforcedItem.itemId],
            image: parseImageFilename(targetGroup?.image),
            name: targetGroup?.name,
            locked: true,
            available: false,
            door: availableDoorKey,
            doorNumber: availableDoorNumber,
            empty: true,
            returned: false
          };

          // Display a prominent message about which door is opening
          customToast(() => (<b>Opening door {availableDoorNumber}</b>), 5000, 'default', 'dark');

          // Open the door for the enforced return (use actual door number, not key)
          processDoor(availableDoorNumber).then(async () => {
            allLockers[availableDoorKey] = {
              itemIds: [conditionCheckEnforcedItem.itemId],
              image: parseImageFilename(targetGroup?.image),
              name: targetGroup?.name,
              locked: false,
              available: true,
              door: availableDoorKey,
              doorNumber: availableDoorNumber,
              empty: false,
              patronId: 'All',
              timestamp: new Date().getTime(),
              returned: true
            };
            testIsAllDoorsClosedByUser = true;
            updateSessionTimer(sessionDevice.value?.settings?.timerForReturnView || 30);
            exitCountdownTimer();
            setLockersCheckedIn(allLockers);
            setLoading(false);
          });

          return; // Exit the useEffect here since we've handled the enforced return
        }
      }

      // If enforced return was already processed, don't run normal flow on re-render
      if (enforcedReturnProcessed) {
        console.log('⏭️  LoTReturn - Skipping normal flow, enforced return already processed');
        return;
      }

      console.log('📍 LoTReturn - Normal flow starting (not enforced return)');

      // Get hotlist and filter for current patron
      const currentHotlist = getHotListItemIds();
      const patronHotlist = currentHotlist.filter((item: any) => item.patronId === user.patronId);
      const patronItemIds = patronHotlist.map((item: any) => item.itemId);

      console.log('🔥 LoTReturn - Filtering items for patron:', {
        patronId: user.patronId,
        totalHotlistItems: currentHotlist.length,
        patronHotlistItems: patronHotlist.length,
        patronItemIds: patronItemIds
      });

      // MODIFIED: Clear the hotlist immediately after reading it
      console.log('🗑️  LoTReturn - Clearing hotlist from localStorage and shared state');
      setHotListItemIds([]);
      localStorage.removeItem('hotListItemIds');
      console.log('✅ LoTReturn - Hotlist cleared successfully');

      allLockers = []

      let found = false;
      let lotLockerReportTemp = lotLockerReport;

      // MODIFIED: Only process ONE item at a time from the hotlist
      // Get the first item from the patron's hotlist
      const firstHotlistItemId = patronItemIds.length > 0 ? patronItemIds[0] : null;

      console.log('🔥 LoTReturn - Processing only ONE item from hotlist:', {
        firstItemId: firstHotlistItemId,
        totalHotlistItems: patronItemIds.length
      });

      // Iterate through Firebase Realtime DB groups to find the locker containing the first hotlist item
      for (const group of deviceGroups) {
        if (!group || found) break; // Exit early if we already found the item

        setLockerNameAndDescription({
          name: group.name || '',
          description: group.description || '',
          ignoreEnforceReturnCheck: group.ignoreEnforceReturnCheck || false
        });

        // Iterate through lockers in this group
        if (group.lockers) {
          for (const door in group.lockers) {
            if (found) break; // Exit early if we already found the item

            const locker = group.lockers[door];

            // Check if this locker contains the first hotlist item OR is a condition check item
            const isConditionCheck = locker?.patronId === 'All' && locker?.conditionCheck === true;
            const lockerItemIds = Array.isArray(locker?.itemIds) ? locker.itemIds.map((id: any) => String(id)) : [];
            const containsFirstItem = firstHotlistItemId && lockerItemIds.includes(String(firstHotlistItemId));

            if (containsFirstItem || isConditionCheck) {
              console.log('✅ LoTReturn - Found locker for first hotlist item (ONE AT A TIME):', {
                door,
                firstItemId: firstHotlistItemId,
                allItemsInLocker: locker.itemIds,
                patronId: locker.patronId,
                reason: containsFirstItem ? 'Contains first hotlist item' : 'Condition check item'
              });
              found = true;
              lotLockerReportTemp[door] = [];

              // MODIFIED: Only process the ONE item from hotlist (not all items in the locker)
              const singleItemToProcess = isConditionCheck ? locker.itemIds : [firstHotlistItemId];

              console.log('📦 LoTReturn - Processing single item:', {
                singleItemToProcess,
                isConditionCheck
              });

              // Build report options for this single item
              let title = group.name + ' missing?';
              let description = 'Report if item processed is missing';
              let descriptionIfReported = 'Will be reported as missing';
              lotLockerReportTemp[door].push({title: title, description: description, descriptionIfReported: descriptionIfReported, report: false, index: lotLockerReportTemp[door].length, door: door });

              title = group.name + ' damaged?';
              description = 'Report if item processed is damaged';
              descriptionIfReported = 'Will be reported as damaged';
              lotLockerReportTemp[door].push({title: title, description: description, descriptionIfReported: descriptionIfReported, report: false, index: lotLockerReportTemp[door].length, door: door });

              lotLockerReportTemp[door].push(
                {
                  title: 'Message to staff',
                  description: 'Write a message to staff',
                  descriptionIfReported: 'Message will be sent to staff',
                  report: false,
                  index: lotLockerReportTemp[door].length,
                  door: door
              });

              allImages = Object.assign({}, allImages);
              allImages[door] = {door: door, image: group.image, name: group.name};

              allLockers = Object.assign({}, allLockers);
              // MODIFIED: Use only the single item we're processing
              allLockers[door] = {
                itemIds: singleItemToProcess,
                image: parseImageFilename(group?.image),
                name: group?.name,
                locked: true,
                available: false,
                door: door,
                doorNumber: locker.doorNumber || parseInt(door),
                empty: true,
                returned: false
              }
            }
          }
        }
      }

      // Set report after all groups processed
      setLotLockerReport(lotLockerReportTemp);

      if (!found) {
        // toast.info(t('ERROR.NO_ITEMS_ON_SELECTED_ITEMGROUP'))
        setLoading(false);
        updateSessionTimer(sessionDevice.value?.settings?.timerForErrorView || 10)
        exitCountdownTimer();
      } else {
        const door = Object.keys(allLockers)[0];
        processDoor(door).then(async () => {
          allLockers[door] = {
              itemIds: allLockers[door].itemIds,
              image: allLockers[door].image,
              name: allLockers[door].name,
              locked: false,
              available: true,
              door: door,
              doorNumber: allLockers[door].doorNumber,
              empty: false,
              patronId: undefined,
              timestamp: new Date().getTime(),
              returned: true
            }
            testIsAllDoorsClosedByUser = true;
            updateSessionTimer(sessionDevice.value?.settings?.timerForReturnView || 30)
            exitCountdownTimer();
            setLockersCheckedIn(allLockers);
            setLoading(false);
          });
      }


  }, [sessionDevice.value?.manifest?.groups, conditionCheckEnforced]); // Watch for manifest changes to stay in sync with RTDB

  // *************** workflowILSCheckin ***************
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

  /** Parse integrations from localStorage once */
  function getCachedIntegrations(): { mac: string; ip: string } {
    try {
      const raw = localStorage.getItem('integrations');
      if (raw) {
        const parsed = JSON.parse(raw);
        const integrations = Array.isArray(parsed) ? parsed : Object.values(parsed);
        if (integrations.length > 0) {
          const first = integrations[0] as any;
          return {
            mac: first.macId || first.mac || '',
            ip: first.ip || '',
          };
        }
      }
    } catch (e) { /* ignore */ }
    return { mac: '', ip: '' };
  }

  // *************** workflowReturnItemIds ***************
  async function workflowReturnItemIds(items: string[], doorNumber: number) {
    const licenseId = sessionLicenseId.value;
    const isSip2 = sessionBranch.value?.sip2Settings?.enabled;
    const isPolaris = sessionBranch.value?.polarisSettings?.enabled;
    const isSymphony = sessionBranch.value?.symphonySettings?.enabled;
    const isDemo = licenseId === 1 || licenseId === 2 || (!isSip2 && !isPolaris && !isSymphony);
    const ilsType = isPolaris ? 'polaris' : isSip2 ? 'sip2' : isSymphony ? 'symphony' : 'demo';

    const results = {
      success: true,
      items: [] as any[]
    };

    const createTransaction = (itemId: string, ilsResult: any) => {
      const txData = {
        itemIds: [itemId], patronId: user.patronId || '', doorNumber,
        groupName: leckerNameAndDescription.name || '', success: ilsResult.success,
        metadata: { title: ilsResult?.title || null, itemStatusId: ilsResult?.itemStatusId || null, ilsType }
      };
      const txPromise = (sessionDevice.value?.settings?.enforceReturnCheck && !leckerNameAndDescription.ignoreEnforceReturnCheck)
        ? createEnforceCheckinEvent(txData)
        : createCheckinTransaction(txData);
      txPromise.catch(txErr => console.error('❌ Failed to create checkin transaction:', txErr));
    };

    // Polaris and Symphony: parallel checkin for all items
    // SIP2 and Demo: sequential
    if ((isPolaris || isSymphony) && !isDemo) {
      const ilsResults = await Promise.all(items.map(async (itemId) => {
        try {
          const ilsResult = await workflowILSCheckin(itemId);
          console.log(`📦 ILS checkin result for ${itemId}:`, ilsResult);
          return { itemId, ilsResult, error: null };
        } catch (error: any) {
          console.error(`❌ ILS checkin failed for ${itemId}:`, error);
          return { itemId, ilsResult: null, error };
        }
      }));

      for (const { itemId, ilsResult, error } of ilsResults) {
        if (error || !ilsResult) {
          results.items.push({ doorNumber, itemId, success: false, screenMessage: error?.message || 'Return failed' });
        } else {
          results.items.push({ doorNumber, itemId, success: ilsResult.success, screenMessage: ilsResult.success ? 'Returned' : 'Return failed', ilsResult });
          createTransaction(itemId, ilsResult);
        }
      }
    } else {
      // SIP2 / Demo: sequential checkin
      for (const itemId of items) {
        try {
          let ilsResult;
          if (isDemo) {
            console.log(`📦 Demo return for item ${itemId} — skipping ILS`);
            ilsResult = { success: true, demo: true, itemBarcode: itemId };
          } else {
            ilsResult = await workflowILSCheckin(itemId);
          }

          console.log(`📦 ILS checkin result for ${itemId}:`, ilsResult);
          results.items.push({ doorNumber, itemId, success: ilsResult.success, screenMessage: ilsResult.success ? 'Returned' : 'Return failed', ilsResult });
          createTransaction(itemId, ilsResult);
        } catch (error: any) {
          console.error(`❌ ILS checkin failed for ${itemId}:`, error);
          results.items.push({ doorNumber, itemId, success: false, screenMessage: error?.message || 'Return failed' });
        }
      }
    }

    results.success = results.items.every(item => item.success);
    return results;
  }

  async function processDoor(door: any) {
    try {
      await openDoor(door);
      testDoorAfterOpen(door);
    } catch (error) {
      customToast(() => (<b>{t('SAAS.DOOR.OPEN_ERROR')}</b>), 5000, 'error', 'dark');
    }
  }

  // Test if a specific door is still open after opening — reports door_is_open_test_failed if not
  async function testDoorAfterOpen(doorNumber: number) {
    try {
      const delay = config.delayOnIsDoorOpen || 1400;
      await Promise.delay(delay);
      const isOpen = getDoorOpenFromRTDB(doorNumber);
      if (isOpen) return;
      await createDoorIsOpenTestFailedEvent({ itemIds: [], patronId: '', doorNumber, success: false, metadata: { error: `Door ${doorNumber} is not open after ${delay}ms`, doorNumber } });
    } catch (err) { console.error(`testDoorAfterOpen(${doorNumber}) failed:`, err); }
  }

  useEffect(() => {
    setShowReport(sessionDevice.value.config.locker?.show_report || false);
  }, [sessionDevice.value?.config?.locker?.show_report]);

  useEffect(() => {

    if (Object.keys(lockersCheckedIn).length) {
      const timerval = sessionTimer.value;
      // updateSessionTimer(timerval);
      // exitCountdownTimer();

      const testIsAllCheckedIn = Object.keys(lockersCheckedIn).length === 1;
      setIsAllCheckedIn(testIsAllCheckedIn);
      if (testIsAllCheckedIn) {
        testIsAllDoorsClosedByUser = true;
      }
    }
  }, [lockersCheckedIn, allImages]);

  async function exitCountdownTimer() {
    if (sessionLocation.value !== '/lotreturn') {
      countdownRunning = false;
      return;
    }
    // Prevent multiple concurrent countdown loops
    if (countdownRunning) return;
    countdownRunning = true;

    const tick = async () => {
      if (sessionLocation.value !== '/lotreturn') {
        countdownRunning = false;
        return;
      }
      const isDoorStillOpen = await testIsDoorOpen();

      if (sessionTimer.value > 0) {
        updateSessionTimer(sessionTimer.value - 1);
        Promise.delay(1000).then(() => tick());
      } else {
        countdownRunning = false;
        setLoading(true);
        exit();
      }
    };

    await tick();
  }

  async function testIsDoorOpen() {
    const cached = getCachedIntegrations();
    const mac = cached.mac || sessionDevice.value?.config?.locker?.mac || '';

    // Check the specific door that was opened
    let doorStillOpen = false;
    for (const key in allLockers) {
      const locker = allLockers[key];
      if (locker.returned) {
        const doorNum = locker.doorNumber || locker.door;
        const isOpen = await isDoorOpen(mac, doorNum, { fresh: true });
        if (isOpen) {
          doorStillOpen = true;
          break;
        }
      }
    }

    // If door was re-opened after we started exiting, restart timer
    if (doorStillOpen && exiting) {
      console.log('🚪 Door re-opened! Restarting timer...');
      exiting = false;
      // Update UI to show door open again
      for (const key in allLockers) {
        if (allLockers[key].returned && allLockers[key].locked) {
          allLockers[key] = { ...allLockers[key], locked: false };
        }
      }
      setLockersCheckedIn({ ...allLockers });
      updateSessionTimer(sessionDevice.value?.settings?.timerForReturnView || 30);
    }

    if (testIsAllDoorsClosedByUser && !doorStillOpen) {
      // Update UI to show door closed
      let updated = false;
      for (const key in allLockers) {
        if (allLockers[key].returned && !allLockers[key].locked) {
          allLockers[key] = { ...allLockers[key], locked: true };
          updated = true;
        }
      }
      if (updated) {
        setLockersCheckedIn({ ...allLockers });
      }

      if (!exiting) {
        // Wait 2s so user sees "Door Closed" status before finalizing
        await Promise.delay(2000);

        // Door closed - run return workflow and exit
        if (!returnWorkflowExecuted) {
          returnWorkflowExecuted = true;
          for (const key in allLockers) {
            const locker = allLockers[key];
            if (locker.returned && locker.itemIds?.length > 0) {
              const doorNum = locker.doorNumber || locker.door;
              await workflowReturnItemIds(locker.itemIds, doorNum);
            }
          }
        }
        exiting = true;
        updateSessionTimer(2);
      }
    }
    return doorStillOpen;
  }

  async function exit() {
    exiting = true
    updateFontSize(fontSizeStorage.value); // Reset font size to default

    // Run return workflow if not already executed (fallback for timer expiry)
    if (!returnWorkflowExecuted) {
      returnWorkflowExecuted = true;
      for (const key in allLockers) {
        const locker = allLockers[key];
        if (locker.returned && locker.itemIds?.length > 0) {
          const doorNum = locker.doorNumber || locker.door;
          await workflowReturnItemIds(locker.itemIds, doorNum);
        }
      }
    }

    // Check if any lockers were returned
    let hasReturned = false;
    const deviceGroups = getDeviceGroups();

    for (const key in allLockers) {
      if (allLockers[key].returned) {
        hasReturned = true;

        // Check if this is a condition check item by looking at actual manifest data
        let isConditionCheckItem = false;
        const lockerGroupName = allLockers[key].name;

        // Find the locker in the matching group only
        deviceGroups.forEach((group: any) => {
          if (lockerGroupName && group.name !== lockerGroupName) return;
          if (group.lockers && group.lockers[key]) {
            const locker = group.lockers[key];
            if (locker.conditionCheck === true && locker.patronId === 'All') {
              isConditionCheckItem = true;
            }
          }
        });

        if (isConditionCheckItem) {
          console.log(`⚠️  Skipping locker update for condition check item in door ${key}:`, {
            itemIds: allLockers[key].itemIds,
            patronId: allLockers[key].patronId,
            reason: 'Item stays in locker for staff verification - checking manifest data'
          });
        } else {
          // Normal return - update locker status (clears itemIds)
          // Pass group name to scope update to correct group only
          console.log(`✅ Clearing locker ${key} - normal return, group: ${allLockers[key].name}`);
          updateLockerStatus(key, allLockers[key].name);
        }
      }
    }

    // Update manifest in Firebase Realtime DB if any lockers were returned
    if (hasReturned && config.device?.manifest) {
      try {
        await persistDeviceManifestChanges(config.device.manifest);
        console.log('✅ LoTReturn - Manifest changes persisted successfully');
        // REMOVED: Hotlist removal code - hotlist is now cleared immediately after reading at the beginning
      } catch (error) {
        console.error('Failed to persist manifest changes:', error);
      }
    }

    // Clean up old localStorage items for backward compatibility
    localStorage.removeItem('conditionCheckEnforced');
    localStorage.removeItem('conditionCheckEnforcedItem');

    // MODIFIED: Ensure hotlist is fully cleared from both localStorage and shared state
    console.log('🗑️  LoTReturn - Final cleanup: Clearing hotlist');
    setHotListItemIds([]);
    localStorage.removeItem('hotListItemIds');
    console.log('✅ LoTReturn - Hotlist fully cleared on exit');

    // Log queue status on exit
    const finalQueue = getConditionCheckQueue();
    console.log('📤 LoTReturn - Exit with queue status:', {
      itemReturned: hasReturned,
      remainingQueueLength: finalQueue.length,
      remainingQueue: finalQueue
    });

    if (finalQueue.length === 0) {
      console.log('✅ LoTReturn - Condition check queue is now empty');
    } else {
      console.log(`⏳ LoTReturn - ${finalQueue.length} items remaining in queue`);
    }

    updateSessionUserModeOn(false);
    updateDevice(sessionDevice.value);
    setLocation('/')
    updateShowBackgroundImage(true);
  }


  const onChange: TableProps['onChange'] = (pagination, filters, sorter, extra) => {
    console.log('params', pagination, filters, sorter, extra)
  }

  const htmlCheckinThing = () => {
    const count = Object.keys(lockersCheckedIn).reduce((acc, a) => acc + (lockersCheckedIn[a].itemIds?.length || 0), 0);

    // Show locker full message or no items message
    if (count === 0 || lockerFullMessage) {
      const displayMessage = lockerFullMessage || t('SAAS.LOT.RETURN_INSTRUCTIONS_NOITEMS');

      return (<>
      <div style={{ margin: '10px 50px 0 50px' }}>
          {lockerFullGroupImage ? (
            <Card style={{
                backgroundColor: 'white',
                boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.37)',
                borderRadius: '40px',
                border: '1px solid rgba(255, 255, 255, 0.18)'
              }}>

              {/* Image on top */}
              <img
                style={{
                  width: '100%',
                  height: 'auto',
                  maxHeight: fontSize.value > 20 ? '200px' : '300px',
                  objectFit: 'contain',
                  display: 'block'
                }}
                alt="Group"
                src={getImage(lockerFullGroupImage, conditionCheckEnforcedItem?.groupName || 'Item')}
              />

              {/* Card body content */}
              <div style={{padding: '20px'}}>

                {/* Group name */}
                <h3 style={{
                  ...getTextStyle({}, 10),
                  color: SEBlue.value,
                  textAlign: 'center',
                  fontWeight: 'bold',
                  marginTop: 0,
                  marginBottom: '10px'
                }}>
                  {conditionCheckEnforcedItem?.groupName?.toUpperCase() || 'ITEM'}
                </h3>

                {/* Group description if available */}
                {leckerNameAndDescription.description && (
                  <p style={{
                    ...getTextStyle({}, 5),
                    color: SEBlue.value,
                    textAlign: 'center',
                    marginTop: 0,
                    marginBottom: '20px'
                  }}>
                    {leckerNameAndDescription.description}
                  </p>
                )}

                {/* Message */}
                <div style={{
                  ...getTextStyle({}, 12),
                  textAlign: 'center',
                  fontWeight: 'bold',
                  padding: '20px',
                  backgroundColor: SEBlue.value,
                  color: 'white',
                  borderRadius: '8px'
                }}>
                  {displayMessage}
                </div>
              </div>
            </Card>
          ) : (
            <Card style={{
                ...getTextStyle({}, 15),
                textAlign: 'center',
                fontWeight: 'bold',
                marginTop: '20px',
                backgroundColor: 'white',
                color: SEBlue.value,
                boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.37)',
                borderRadius: '40px',
                border: '1px solid rgba(255, 255, 255, 0.18)'
              }}>
              {displayMessage}
            </Card>
          )}

          {/* Exit button below the card */}
          <div style={{ textAlign: 'center', marginTop: '30px' }}>
            <Button
              size='large'
              type="primary"
              style={{
                ...getTextStyle({fontWeight: 'bold'}, 8),
                backgroundColor: SEBlue.value,
                borderColor: SEBlue.value,
                padding: '30px 60px',
                height: 'auto',
                fontSize: '24px'
              }}
              onClick={() => exit()}
            >
              {t('SAAS.EXIT')}
            </Button>
          </div>
      </div>
      </>)
    }

    // Always show single card - we only process one item at a time
    const doorKey = Object.keys(lockersCheckedIn)[0];
    const locker = lockersCheckedIn[doorKey];
    const imageData = allImages[doorKey];

    if (!locker || !imageData) return <></>;

    return (<>
      <div style={{ margin: '10px 50px 0 50px' }}>

        <Card variant="borderless" style={{ 'boxShadow': '1px 1px 1px 1px rgb(0 0 0 / 50%), 0 1px 6px -1px rgb(0 0 0 / 2%), 0 2px 4px 0 rgb(0 0 0 / 4%)'}}>
          {(() => {
            const isLandscape = sessionDevice.value?.settings?.screenOrientation?.toLowerCase() === 'landscape';
            const reopenDoorHandler = () => {
              const timerval = sessionTimer.value + 30;
              updateSessionTimer(timerval);
              const doorNum = locker.doorNumber || locker.door;
              customToast(() => (<b>Opening door {doorNum}</b>), 5000, 'default', 'dark');
              openDoor(doorNum);
              testDoorAfterOpen(doorNum);
            };

            if (isLandscape) {
              return (
                <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'stretch' }}>
                  {/* Left: Image */}
                  <div style={{ flex: '0 0 35%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                    <img
                      style={{
                        width: '100%',
                        height: 'auto',
                        maxHeight: '280px',
                        objectFit: 'contain',
                        display: 'block',
                        borderRadius: '8px'
                      }}
                      alt="example"
                      src={getImage(imageData.image, imageData.name)}
                    />
                  </div>

                  {/* Right: Content */}
                  <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    <h2 style={{
                      ...getTextStyle({fontWeight: 'bold'}, 12),
                      color: SEBlue.value,
                      margin: 0,
                      marginBottom: '8px'
                    }}>
                      Door #{locker.doorNumber || locker.door || 'N/A'}
                    </h2>

                    <h3 style={{
                      ...getTextStyle({}, 10),
                      color: SEBlue.value,
                      fontWeight: 'bold',
                      marginTop: 0,
                      marginBottom: '4px'
                    }}>
                      {leckerNameAndDescription.name.toUpperCase()}
                    </h3>

                    <p style={{
                      ...getTextStyle({}, 5),
                      color: SEBlue.value,
                      marginTop: 0,
                      marginBottom: '16px'
                    }}>
                      {leckerNameAndDescription.description}
                    </p>

                    <Row gutter={[16, 8]} align="middle">
                      <Col span={8}>
                        <div style={{textAlign: 'center'}}>
                          <div style={{ ...getTextStyle({}, 4), color: '#999', marginBottom: '4px' }}>Item Id</div>
                          <div style={{
                            ...getTextStyle({fontWeight: 'bold'}, 6),
                            color: 'white',
                            backgroundColor: SEBlue.value,
                            padding: '6px 12px',
                            borderRadius: '20px',
                            display: 'inline-block'
                          }}>
                            {locker.itemIds?.[0] || 'N/A'}
                          </div>
                        </div>
                      </Col>
                      <Col span={8}>
                        <div style={{textAlign: 'center'}}>
                          <div style={{ ...getTextStyle({}, 4), color: '#999', marginBottom: '4px' }}>Status</div>
                          <div style={{ ...getTextStyle({fontWeight: 'bold'}, 6) }}>
                            {locker.locked ? (
                              <span style={{color: SEBlue.value}}>Door Closed</span>
                            ) : (
                              <span style={{color: 'green'}}>Door Open</span>
                            )}
                          </div>
                        </div>
                      </Col>
                      <Col span={8}>
                        <div style={{textAlign: 'center'}}>
                          <div style={{ ...getTextStyle({}, 4), color: '#999', marginBottom: '4px' }}>Action</div>
                          <Button
                            size='large'
                            type="primary"
                            style={{
                              ...getTextStyle({fontWeight: 'bold'}, 6),
                              backgroundColor: SEBlue.value,
                              borderColor: SEBlue.value,
                              padding: '16px 32px',
                              height: 'auto'
                            }}
                            onClick={reopenDoorHandler}
                          >
                            Re-open door
                          </Button>
                        </div>
                      </Col>
                    </Row>

                    <div style={{marginTop: '16px'}}>
                      {anyDoorsOpen ?
                        <h2 style={getTextStyle({color: SEBlue.value, textAlign: 'center'}, 8)}>
                          {t('SAAS.LOCKER_CHECKIN_ONE_INSTRUCTIONS_REMINDER', {'count': count})}
                        </h2>
                        :
                        <h2 style={getTextStyle({color: SEBlue.value, textAlign: 'center'}, 8)}>
                          {t('SAAS.LOCKER_CHECKIN_ONE_INSTRUCTIONS_FINAL', {'count': count})}
                        </h2>
                      }
                    </div>
                  </div>
                </div>
              );
            }

            /* Portrait layout - original vertical card */
            return (
              <>
                <div style={{ padding: '20px', paddingBottom: '10px' }}>
                  <h2 style={{
                    ...getTextStyle({fontWeight: 'bold'}, 15),
                    color: SEBlue.value,
                    margin: 0,
                    textAlign: 'left'
                  }}>
                    Door #{locker.doorNumber || locker.door || 'N/A'}
                  </h2>
                </div>

                <img
                  style={{
                    width: '100%',
                    height: 'auto',
                    maxHeight: fontSize.value > 20 ? '400px' : '600px',
                    objectFit: 'contain',
                    display: 'block'
                  }}
                  alt="example"
                  src={getImage(imageData.image, imageData.name)}
                />

                <div style={{padding: '20px'}}>
                  <h3 style={{
                    ...getTextStyle({}, 10),
                    color: SEBlue.value,
                    textAlign: 'center',
                    fontWeight: 'bold',
                    marginTop: 0,
                    marginBottom: '10px'
                  }}>
                    {leckerNameAndDescription.name.toUpperCase()}
                  </h3>

                  <p style={{
                    ...getTextStyle({}, 5),
                    color: SEBlue.value,
                    textAlign: 'center',
                    marginTop: 0,
                    marginBottom: '20px'
                  }}>
                    {leckerNameAndDescription.description}
                  </p>

                  <Row gutter={[16, 16]} style={{marginTop: '20px'}}>
                    <Col span={8}>
                      <div style={{textAlign: 'center'}}>
                        <div style={{ ...getTextStyle({}, 5), color: '#999', marginBottom: '5px' }}>Item Id</div>
                        <div style={{
                          ...getTextStyle({fontWeight: 'bold'}, 8),
                          color: 'white',
                          backgroundColor: SEBlue.value,
                          padding: '8px 16px',
                          borderRadius: '20px',
                          display: 'inline-block'
                        }}>
                          {locker.itemIds?.[0] || 'N/A'}
                        </div>
                      </div>
                    </Col>
                    <Col span={8}>
                      <div style={{textAlign: 'center'}}>
                        <div style={{ ...getTextStyle({}, 5), color: '#999', marginBottom: '5px' }}>Status</div>
                        <div style={{ ...getTextStyle({fontWeight: 'bold'}, 8) }}>
                          {locker.locked ? (
                            <span style={{color: SEBlue.value}}>Door Closed</span>
                          ) : (
                            <span style={{color: 'green'}}>Door Open</span>
                          )}
                        </div>
                      </div>
                    </Col>
                    <Col span={8}>
                      <div style={{textAlign: 'center'}}>
                        <div style={{ ...getTextStyle({}, 5), color: '#999', marginBottom: '5px' }}>Action</div>
                        <Button
                          size='large'
                          type="primary"
                          style={{
                            ...getTextStyle({fontWeight: 'bold'}, 8),
                            backgroundColor: SEBlue.value,
                            borderColor: SEBlue.value,
                            padding: '30px 60px',
                            height: 'auto',
                            fontSize: '24px'
                          }}
                          onClick={reopenDoorHandler}
                        >
                          Re-open door
                        </Button>
                      </div>
                    </Col>
                  </Row>
                </div>

                <Row gutter={[16, 16]} justify="center" style={{marginTop: '30px'}}>
                  <Col span={24}> {
                    anyDoorsOpen ?
                      <h2 style={getTextStyle({color: SEBlue.value, textAlign: 'center'}, 12)}>
                        {t('SAAS.LOCKER_CHECKIN_ONE_INSTRUCTIONS_REMINDER', {'count': count})}
                      </h2>
                      :
                      <h2 style={getTextStyle({color: SEBlue.value, textAlign: 'center'}, 12)}>
                        {t('SAAS.LOCKER_CHECKIN_ONE_INSTRUCTIONS_FINAL', {'count': count})}
                      </h2>
                  }
                  </Col>
                </Row>
              </>
            );
          })()}
        </Card>

        {showReport && htmlThingReport(doorKey)}

      </div>

    </>)

  }

  const [messageToStaff, setMessageToStaff] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [lotLockerReport, setLotLockerReport] = useState<any>({});
  const columnsLoTReport = [

    {
        width: '30%',
        title: 'Locker',
        dataIndex: 'title',
        key: 'title',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
        render: ( key: any , data: any ) => <>
        <div style={getTextStyle({ fontWeight: 'bold', color: SEBlue.value})} key={key}> {data.title} </div> </>

    },

    {
       width: '60%',
        title: 'Description',
        dataIndex: 'description',
        key: 'description',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
        render: ( key: any , data: any ) => {
          return (<>
                {data.report || (messageToStaff && data.index === 0) ?
                <div style={getTextStyle({ fontWeight: 'bold', color: SEBlue.value})} key={key}> {data.descriptionIfReported} </div>
                :
                <div style={getTextStyle({ fontWeight: 'bold', color: SEBlue.value})} key={key}> {data.description} </div>
                }
            </>)
        }

    },
    {
      width: '10%',
      title: 'Actions',
      key: 'actions',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
      render: ( key: any , data: any ) => <>
        <div  style={getTextStyle({fontWeight: 'bold'}, 10)} key={key}>

          {data.title.includes('staff') ?
          <Button style={{...getTextStyle({backgroundColor: SEBlue.value, color: 'white'})}} type="primary" onClick={() => {
            setModalOpen(true);
            setMessageToStaff(messageToStaff);
          }}> {t('SAAS.REPORT.SEND_MESSAGE')} </Button>
          :
          <Switch value={data.report} onChange={(checked) => {
            let newReport = lotLockerReport[data.door];
            newReport[data.index].report = checked;
            const result = {...lotLockerReport};
            result[data.door] = newReport;
            setLotLockerReport(result);
          }} />}
          </div>
      </>


    },
  ];

  const htmlThingReport = (door: string) => {

    return (<>
      <Row justify="center" style={{marginTop: '10px'}}>
        <Col span={24}>
          <div style={getTextStyle( {color: 'white', marginBottom: '-30px'})}> {t('SAAS.REPORT.TITLE')} </div>
        </Col>
      </Row>
      <Row justify="start" style={{marginTop: '40px'}}>
        <Col span={24}>
        <Table style={getTextStyle()} pagination={false} showHeader={false} dataSource={ lotLockerReport[door] } columns={columnsLoTReport} onChange={onChange}/>
        </Col>
      </Row>
    </>)
  }



  const welcomUser = () => {
    return (<Row style={{marginTop: '10px'}} justify="center">
        <Col span={24} >
           <h2 style={{
            ...getTextStyle({}, 20),
            color: 'white',
            textAlign: 'center'
          }}>
            {conditionCheckEnforced
              ? 'Express Return Mode'
              : 'Welcome, please return your item'} </h2>
        </Col>
      </Row>)

{/* <Row justify="start" >
<Col span={16}>
  <Card  onClick={() => setPlayMode(true)} variant="borderless"
    style={{ color: 'white', marginTop: '10px',marginBottom: '20px', backgroundColor: 'rgba(0,0,0,0.0)', 'boxShadow': '1px 1px 1px 1px rgb(0 0 0 / 50%), 0 1px 6px -1px rgb(0 0 0 / 2%), 0 2px 4px 0 rgb(0 0 0 / 4%'}} >
    <h2 style={getTextStyle({}, 20)}> {t('SAAS.WELCOME_TO_LOT')} </h2>
  </Card>
</Col>
</Row> */}
  }

  const [modalOpenAReport, setModalOpenAReport] = useState(false);
  const [modalOpenAReportLocker, setModalOpenAReportLocker] = useState<any>({
    name: '',
    description: '',
    door: ''
  });
  const keyboard: any = useRef();
  const [layout, setLayout] = useState("default");
  const onChangeMessageToStaff = (input: string) => {
    setMessageToStaff(input);
    // Promise.delay(100).then(() => keyboard.current?.focus())
  };

  const handleShift = () => {
    const newLayoutName = layout === "default" ? "shift" : "default";
    setLayout(newLayoutName);
    // Promise.delay(50).then(() => keyboard.current?.focus())

  };
  const onKeyPress = (button: any) => {
    console.log("Button pressed", button);
    updateSessionTimer(10);
    if (button === "{shift}" || button === "{lock}") handleShift();
  };

  const htmlMain = () => {
    return (
      <>

        <div className="sweet-loading" style={stylePage}>
          {/* <ClipLoader
            color={color}
            loading={loading}
            cssOverride={override}
            size={100}
            aria-label="Loading Spinner"
            data-testid="loader">
          </ClipLoader> */}
          {loading && <Spinner />}
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

          {!loading && welcomUser() }
          {/* {!loading && getHoldLockers().lockers.length && htmlShowPickupItems() } */}
          {!loading && htmlCheckinThing()}
          {/* {!loading && !getHoldLockers().lockers.length && htmlShowPickupNoItems() } */}

          {!modalOpen && (
            <ZoomLanguageControls
              showTimer={true}
              showLanguageButton={false}
              timer={sessionTimer.value}
              onTimerClick={() => exit()}
              onZoomIn={() => updateFontSize(fontSize.value + 2)}
              onZoomOut={() => updateFontSize(Math.max(12, fontSize.value - 2))}
            />
          )}

       { modalOpen && <Modal
            title={<span style={{color: '#42A4DE', ...getTextStyle({}, 15)}}>{t("Change session language")}</span>}
            centered
            open={modalOpen}
            onOk={() => setModalOpen(false)}
            onCancel={() => {
              setMessageToStaff('');
              setModalOpen(false)}}
            width={'90%'}
            height={'90%'}
            footer={
              <Space direction="horizontal">
                <Button type="default" style={{...getTextStyle({backgroundColor: 'red', color: 'white'}, 10)}} onClick={() => {
                  setModalOpen(false);
                  setMessageToStaff('');
                }}>Cancel</Button>
                <Button type="primary" style={{...getTextStyle({backgroundColor: SEBlue.value, color: 'white'}, 10)}} onClick={() => {
                  setModalOpen(false);
                }}>OK</Button>
              </Space>
            }
          >
            <Card style={{padding: '0px', height: window.innerHeight * 0.8}}>
              <Row>
                <TextArea style={{...getTextStyle({fontSize: '20px', color: SEBlue.value}, 10)}} rows={10} value={messageToStaff} onChange={(e) => setMessageToStaff(e.target.value)} />
              </Row>
              <Keyboard
                  keyboardRef={r => (keyboard.current = r)}
                  layoutName={layout}
                  onChange={onChangeMessageToStaff}
                  onKeyPress={onKeyPress} />
            </Card>

        </Modal>}

        { modalOpenAReport && <Modal
            title={<span style={{color: '#42A4DE', ...getTextStyle({}, 15)}}>Report for {modalOpenAReportLocker.name}</span>}
            centered
            open={modalOpenAReport}
            onOk={() => setModalOpenAReport(false)}
            onCancel={() => {

            }}
            width={'90%'}
            height={'90%'}
            footer={
              <Space direction="horizontal">
                <Button type="default" style={{...getTextStyle({backgroundColor: 'red', color: 'white'}, 10)}} onClick={() => {
                  setModalOpenAReport(false);
                  setMessageToStaff('');
                }}>Cancel</Button>
                <Button type="primary" style={{...getTextStyle({backgroundColor: SEBlue.value, color: 'white'}, 10)}} onClick={() => {
                  setModalOpenAReport(false);
                }}>OK</Button>
              </Space>
            }
          >
            <Card style={{padding: '0px', height: window.innerHeight * 0.8}}>
              {htmlThingReport(modalOpenAReportLocker.door)}
            </Card>

        </Modal>}

      </div>
      </>
    );
  }

  return htmlMain();


}

