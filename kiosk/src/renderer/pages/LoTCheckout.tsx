import React, { useRef } from 'react';
import { useEffect, useState /*, CSSProperties*/ } from 'react';
import config from '../../../config';
import { Table, Row, Col, Button, /*Flex, Avatar,*/ Badge, Space, /*TableProps,*/ Card, /*TableColumnsType,*/ Switch, Modal, TableProps} from 'antd';
import { CheckOutlined, /*UploadOutlined, ClockCircleOutlined,*/ CloseOutlined } from '@ant-design/icons';
// import _ from 'lodash';
import { useLocation } from 'wouter';
import { /*sessionLang,*/ sessionTimer, updateSessionTimer, sessionLocation, updateLocation, persistDeviceManifestChanges, sessionDevice, updateSessionUserModeOn, updateShowBackgroundImage, /*updateSessionStaffModeOn,*/
  getTextStyle, updateFontSize, fontSizeStorage, libraryOfThingsGroup, fontSize,
  // updateDevice,
  SEBlue,
  getImage,
  customToast,
  sessionBranch,
  FirebaseSIP2,
  sessionLicenseId,
  updateSessionError} from "../state/shared";
// import * as style from '../App.styles';
import { Promise } from "bluebird";
import {AiOutlineClockCircle} from "react-icons/ai";
import { useTranslation } from 'react-i18next';
import { toast, ToastContainer } from 'react-toastify';
import { useSignals } from "@preact/signals-react/runtime";
import { isDoorOpen, openDoor, getDoorOpenFromRTDB } from 'renderer/state/locker';
import { createCheckoutTransaction, createDoorIsOpenTestFailedEvent } from 'renderer/state/transaction-service';

const POLARIS_API_BASE = 'https://polarisapi-be4ekemxaa-uc.a.run.app';
import { addWaiverToPatron } from 'renderer/state/firestore';
import Spinner from 'renderer/components/spinner';
import TextArea from 'antd/es/input/TextArea';
import Keyboard from 'react-simple-keyboard';
import ZoomLanguageControls from '../components/ZoomLanguageControls';
let exiting = false;


export default function LoTCheckoutPage() {
  useSignals();
  updateLocation('/lotcheckout')
  const [lotLocker, setLotLocker] = useState(null);
  const [lockerNameAndDescription, setLockerNameAndDescription] = useState({
    name: '',
    description: ''
  });
  const [showReport, setShowReport] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [, setLocation] = useLocation()
  const { t } = useTranslation();
  const style2: React.CSSProperties = { zIndex: 1, ...getTextStyle({}, 15), color: SEBlue.value};
  const stylePage: React.CSSProperties = { overflow: 'auto', height: '100%' };
  const [anyDoorsOpen, setAnyDoorsOpen] = useState(true);
  const [lotLockerImage, setLotLockerImage] = useState(null);
  const [startCheckoutSession, setStartCheckoutSession] = useState(false);
  const [lotLockerReport, setLotLockerReport] = useState<{title: string, description: string, descriptionIfReported: string, report: boolean, index: number}[]>([]);
  const [messageToStaff, setMessageToStaff] = useState('');
  const [waiverText, setWaiverText] = useState<string | null>(null);
  const [waiverPending, setWaiverPending] = useState(false);
  const waiverHandled = useRef(false);
  // Don't create snapshot - use sessionDevice.value directly for real-time RTDB updates
  const branch = sessionBranch.value;
  const user = JSON.parse(localStorage.getItem('patron') || '{}' );
  const keyboard: any = useRef();
  const [layout, setLayout] = useState("default");
  const hasInitialized = useRef(false); // Track if we've already initialized this checkout session

  // *************** workflowILSCheckout ***************
  async function workflowILSCheckout(itemBarcode: string, patronBarcode: string): Promise<any> {
    const branch = sessionBranch.value;
    const currentLicenseId = sessionLicenseId.value;
    const isPolaris = branch?.polarisSettings?.enabled;
    const isSip2 = branch?.sip2Settings?.enabled;
    const isSymphony = branch?.symphonySettings?.enabled;

    // Skip for license 1/2 simulation
    if (currentLicenseId === 1 || currentLicenseId === 2) {
      console.log(`📦 workflowILSCheckout: Demo checkout for license ${currentLicenseId}, item ${itemBarcode}`);
      return { success: true, demo: true, itemBarcode };
    }

    if (isPolaris) {
      const branchId = branch?.id;
      const baseUrl = `${POLARIS_API_BASE}/${currentLicenseId}/${branchId}`;
      const logonBranchID = branch?.polarisSettings?.logonBranchId;
      const logonUserID = branch?.polarisSettings?.logonUserId;
      const logonWorkstationID = branch?.polarisSettings?.logonWorkstationId;

      console.log(`📦 workflowILSCheckout: Polaris checkout for item ${itemBarcode}, patron ${patronBarcode}`);
      const checkoutRes = await fetch(`${baseUrl}/circulation/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemBarcode,
          patronBarcode,
          logonBranchID,
          logonUserID,
          logonWorkstationID
        })
      });

      const checkoutData = await checkoutRes.json();
      console.log(`📦 workflowILSCheckout: Polaris checkout response:`, checkoutData);

      if (!checkoutRes.ok) {
        throw new Error(checkoutData?.error || checkoutData?.message || `Polaris checkout failed (HTTP ${checkoutRes.status})`);
      }

      return {
        success: checkoutData?.PAPIErrorCode === 0,
        title: checkoutData?.Title || null,
        itemId: checkoutData?.ItemBarcode || itemBarcode,
        itemStatusId: checkoutData?.ItemStatusID || null,
        raw: checkoutData,
      };
    } else if (isSip2) {
      console.log(`📦 workflowILSCheckout: SIP2 checkout for item ${itemBarcode}, patron ${patronBarcode}`);
      const result = await FirebaseSIP2.checkout(itemBarcode, patronBarcode);
      console.log(`📦 workflowILSCheckout: SIP2 checkout response:`, result);
      return { success: +result.ok === 1, data: result };
    } else if (isSymphony) {
      console.log(`📦 workflowILSCheckout: Symphony checkout — not yet implemented`);
      return { success: true, pending: true, itemBarcode };
    } else {
      console.error(`❌ workflowILSCheckout: No ILS configured for branch`);
      throw new Error('Checkout not supported — no ILS configured for this branch');
    }
  }

  // *************** workflowCheckOutItemIds ***************
  async function workflowCheckOutItemIds(items: string[], doorNumber: number) {
    const licenseId = sessionLicenseId.value;
    const group = libraryOfThingsGroup.value.groupIndex ? sessionDevice.value.manifest.groups[libraryOfThingsGroup.value.groupIndex] : sessionDevice.value.manifest.groups[0];

    // Determine checkout method based on license and branch settings
    const isSip2 = sessionBranch.value?.sip2Settings?.enabled;
    const isPolaris = sessionBranch.value?.polarisSettings?.enabled;
    const isSymphony = sessionBranch.value?.symphonySettings?.enabled;
    const isDemo = licenseId === 1 || licenseId === 2 || (!isSip2 && !isPolaris && !isSymphony);

    const results = {
      success: true,
      items: [] as any[]
    };

    const patronBarcode = user.patronId || localStorage.getItem('patronId') || '';

    if (isDemo) {
      console.log('📦 Demo checkout for license', licenseId);
      return await demoCheckout(items, doorNumber, group);
    }

    const ilsType = isPolaris ? 'Polaris' : isSip2 ? 'SIP2' : isSymphony ? 'Symphony' : 'ILS';

    // Polaris and Symphony: parallel checkout for all items
    // SIP2: sequential (pub/sub cannot handle concurrent requests)
    if (isPolaris || isSymphony) {
      const ilsResults = await Promise.all(items.map(async (itemId) => {
        try {
          const ilsResult = await workflowILSCheckout(itemId, patronBarcode);
          console.log(`📦 ILS checkout result for ${itemId}:`, ilsResult);
          return { itemId, ilsResult, error: null };
        } catch (error: any) {
          console.error(`❌ ILS checkout failed for ${itemId}:`, error);
          return { itemId, ilsResult: null, error };
        }
      }));

      for (const { itemId, ilsResult, error } of ilsResults) {
        if (error || !ilsResult?.success) {
          updateSessionError({ message: `${ilsType} checkout failed for patron id ${patronBarcode}` });
          setLocation('/error');
          return { success: false, items: [] };
        }

        results.items.push({
          doorNumber, itemId, success: true, screenMessage: 'Checked out', ilsResult,
        });

        createCheckoutTransaction({
          itemIds: [itemId], patronId: patronBarcode, doorNumber,
          groupName: group?.name || '', success: ilsResult.success,
          metadata: {
            title: ilsResult?.title || null,
            itemStatusId: ilsResult?.itemStatusId || null,
            ilsType: isPolaris ? 'polaris' : 'symphony',
          }
        }).catch(txErr => console.error('❌ Failed to create checkout transaction:', txErr));
      }
    } else {
      // SIP2: sequential checkout
      for (const itemId of items) {
        try {
          const ilsResult = await workflowILSCheckout(itemId, patronBarcode);
          console.log(`📦 ILS checkout result for ${itemId}:`, ilsResult);

          if (!ilsResult.success) {
            updateSessionError({ message: `${ilsType} checkout failed for patron id ${patronBarcode}` });
            setLocation('/error');
            return { success: false, items: [] };
          }

          results.items.push({
            doorNumber, itemId, success: true, screenMessage: 'Checked out', ilsResult,
          });

          createCheckoutTransaction({
            itemIds: [itemId], patronId: patronBarcode, doorNumber,
            groupName: group?.name || '', success: ilsResult.success,
            metadata: {
              title: ilsResult?.title || null, itemStatusId: ilsResult?.itemStatusId || null,
              ilsType: 'sip2',
            }
          }).catch(txErr => console.error('❌ Failed to create checkout transaction:', txErr));
        } catch (error: any) {
          console.error(`❌ ILS checkout failed for ${itemId}:`, error);
          updateSessionError({ message: `${ilsType} checkout failed for patron id ${patronBarcode}` });
          setLocation('/error');
          return { success: false, items: [] };
        }
      }
    }

    results.success = results.items.every(item => item.success);
    return results;
  }

  // Demo checkout: marks items as checked out without ILS integration
  async function demoCheckout(items: string[], doorNumber: number, group: any) {
    console.log('📦 Demo checkout — skipping ILS, returning success immediately');
    return {
      success: true,
      items: items.map(itemId => ({
        doorNumber, itemId, success: true, screenMessage: 'Success'
      }))
    };
  }

  // *************** useEffect ***************
  useEffect(() => {
    updateShowBackgroundImage(true);

  }, []);

  useEffect(() => {
    // Prevent re-initialization if we've already started the checkout session
    if (hasInitialized.current || startCheckoutSession) {
      console.log('⏭️  Skipping re-initialization - already initialized or session started');
      return;
    }

    console.log('🎬 LoTCheckout useEffect starting - hasInitialized:', hasInitialized.current);

    console.log('📋 Full device object:', {
      hasManifest: !!sessionDevice.value.manifest,
      hasGroups: !!(sessionDevice.value.manifest?.groups),
      groupsType: Array.isArray(sessionDevice.value.manifest?.groups) ? 'array' : typeof sessionDevice.value.manifest?.groups,
      groupsLength: sessionDevice.value.manifest?.groups ? (Array.isArray(sessionDevice.value.manifest.groups) ? sessionDevice.value.manifest.groups.length : Object.keys(sessionDevice.value.manifest.groups).length) : 0,
      allGroups: sessionDevice.value.manifest?.groups
    });

    // Read from MANIFEST for all data (locker data, name, description, image)
    const manifestGroup = sessionDevice.value.manifest.groups[libraryOfThingsGroup.value.groupIndex];

    console.log('📋 Using manifest group for all data:', manifestGroup);
    console.log('📋 Requested group index:', libraryOfThingsGroup.value.groupIndex);

    if (!manifestGroup) {
      console.error('❌ No manifest group found at index:', libraryOfThingsGroup.value.groupIndex);
      console.error('  Available groups:', sessionDevice.value.manifest?.groups);
      return;
    }

    setLockerNameAndDescription({
      name: manifestGroup.name || '',
      description: manifestGroup.description || ''
    });

    console.log('🔍 LoTCheckout - Manifest group lockers property:', manifestGroup.lockers);
    console.log('🔍 LoTCheckout - Manifest group all keys:', Object.keys(manifestGroup));

    if (!manifestGroup.lockers) {
      console.error('❌ No lockers property in manifest group - manifest may not have synced from Firebase yet');
      console.error('  manifestGroup keys:', Object.keys(manifestGroup));
      console.error('  Full manifestGroup:', manifestGroup);

      const message = t('ERROR.NO_ITEMS_ON_SELECTED_ITEMGROUP')
      customToast(() => (<b>{message}</b>), 20000, 'default', 'dark');
      Promise.delay((sessionDevice.value?.settings?.timerForErrorView || 10) * 1000).then(() => exit());
      return;
    }

    // Handle both array and object formats
    const lockersArray = Array.isArray(manifestGroup.lockers)
      ? manifestGroup.lockers
      : Object.values(manifestGroup.lockers);

    const lockersCount = lockersArray.length;

    console.log('🔍 LoTCheckout - Lockers format:', Array.isArray(manifestGroup.lockers) ? 'array' : 'object');
    console.log('🔍 LoTCheckout - Locker count:', lockersCount);

    if (lockersCount === 0) {
      console.error('❌ No lockers in manifest group!');
      const message = t('ERROR.NO_ITEMS_ON_SELECTED_ITEMGROUP')
      customToast(() => (<b>{message}</b>), 20000, 'default', 'dark');
      Promise.delay((sessionDevice.value?.settings?.timerForErrorView || 10) * 1000).then(() => exit());
      return;
    }

    updateSessionTimer(sessionDevice.value?.settings?.timerForCheckoutView || 30)
    let lotLockerReportTemp = lotLockerReport;
    let firstLockerProcessed = false;

    console.log('🔍 LoTCheckout - Initializing with manifest group lockers:', manifestGroup.lockers);

    // Prioritize patron's own hold locker — scan for exact patronId match first
    let selectedLockerIndex: string | null = null;
    const currentPatronId = user?.patronId;
    if (currentPatronId) {
      for (const i in manifestGroup.lockers) {
        const locker = manifestGroup.lockers[i];
        if (locker && locker.itemIds && locker.itemIds.length > 0 && locker.patronId === currentPatronId && locker.status !== 'CHECKEDOUT') {
          selectedLockerIndex = i;
          console.log(`🎯 Patron hold locker found at index ${i}, door #${locker.doorNumber}`);
          break;
        }
      }
    }
    // If no patron-specific locker, fall back to first 'All' locker
    if (!selectedLockerIndex) {
      for (const i in manifestGroup.lockers) {
        const locker = manifestGroup.lockers[i];
        if (locker && locker.itemIds && locker.itemIds.length > 0 && (!locker.patronId || locker.patronId === 'All') && !locker.conditionCheck && locker.status !== 'CHECKEDOUT') {
          selectedLockerIndex = i;
          break;
        }
      }
    }

    if (selectedLockerIndex !== null) {
      const i = selectedLockerIndex;
      {
        const locker = manifestGroup.lockers[i];
        console.log(`🔍 Selected locker at index ${i}:`, {
          doorNumber: locker.doorNumber,
          itemIds: locker.itemIds,
          patronId: locker.patronId,
          hasItemIds: locker.itemIds && locker.itemIds.length > 0,
          isPatronAll: locker.patronId === 'All'
        });

        if (locker && locker.itemIds && locker.itemIds.length > 0) {
          console.log('✅ Found first locker to checkout:', {
            index: i,
            doorNumber: locker.doorNumber,
            itemIds: locker.itemIds,
            patronId: locker.patronId
          });

          // Mark that we've initialized IMMEDIATELY to prevent race conditions
          hasInitialized.current = true;
          console.log('🔒 Set hasInitialized to true');

          // Mark that we've processed the first locker
          firstLockerProcessed = true;

          const timerval = sessionTimer.value;
          updateSessionTimer(timerval);
          setLotLockerImage({image: manifestGroup.image, name: manifestGroup.name});

          const itemCount = locker.itemIds.length;
          if (itemCount === 1) {
            locker.itemIds.forEach((itemId) => {
              let title = manifestGroup.name + ' missing?';
              let description = 'Report if item processed is missing';
              let descriptionIfReported = 'Will be reported as missing';
              lotLockerReportTemp.push({title: title, description: description, descriptionIfReported: descriptionIfReported, report: false, index: lotLockerReportTemp.length});

              title = manifestGroup.name + ' damaged?';
              description = 'Report if item processed is damaged';
              descriptionIfReported = 'Will be reported as damaged';
              lotLockerReportTemp.push({title: title, description: description, descriptionIfReported: descriptionIfReported, report: false, index: lotLockerReportTemp.length});
            });

          } else {
            locker.itemIds.forEach((itemId, index) => {
              let title = index === 0 ? manifestGroup.name + ' missing?' : 'Accessory missing?';
              let description = 'Report id ' + itemId + ' missing';
              let descriptionIfReported = 'Item will be reported as missing';
              lotLockerReportTemp.push({title: title, description: description, descriptionIfReported: descriptionIfReported, report: false, index: lotLockerReportTemp.length});

              title = index === 0 ? manifestGroup.name + ' damaged?' : 'Accessory damaged?';
              description = 'Report id ' + itemId + ' damaged';
              descriptionIfReported = 'Item will be reported as damaged';
              lotLockerReportTemp.push({title: title, description: description, descriptionIfReported: descriptionIfReported, report: false, index: lotLockerReportTemp.length});
            });
          }

          setLotLocker({
            doorNumber: locker.doorNumber,
            itemIds: locker.itemIds,
            image: manifestGroup.image,
            name: manifestGroup.name,
            locked: true,
            checkedOut: false,
            patronId: locker.patronId, // Preserve original patronId from manifest for matching
            originalPatronId: locker.patronId, // Store original for reference
            checkoutPatronId: user.patronId, // Store who's checking it out
            timestamp: new Date().getTime(),
            ada: user.ada || false,
            door: locker.doorNumber, // Store door number for display
            isLockedForItemId: locker.isLockedForItemId || false // Permanent locker flag
          });

          console.log('💾 Set lotLocker state:', {
            doorNumber: locker.doorNumber,
            itemIds: locker.itemIds,
            door: locker.doorNumber,
            patronId: locker.patronId,
            checkoutPatronId: user.patronId
          });

          setStartCheckoutSession(true)
          exiting = false;

          // add feedback to report
          if (lotLockerReportTemp.length > 0) {
            lotLockerReportTemp.push(
              {
                title: 'Message to staff',
                description: 'Write a message to staff',
                descriptionIfReported: 'Message will be sent to staff',
                report: false,
                index: lotLockerReportTemp.length

            });
            setLotLockerReport(lotLockerReportTemp);
          }

          // Door close watcher will be started after processDoor succeeds
          return;
        }
      }
    }

    // If we get here, no locker was found for checkout
    console.error('❌ No locker found for checkout that matches criteria!');
    console.error('  Group index:', libraryOfThingsGroup.value.groupIndex);
    console.error('  Checked', lockersCount, 'lockers in the group');

    const message = t('ERROR.NO_ITEMS_ON_SELECTED_ITEMGROUP');
    customToast(() => (<b>{message}</b>), 20000, 'default', 'dark');

    Promise.delay(5000).then(() => exit());

  }, [libraryOfThingsGroup, sessionDevice.value?.manifest?.groups]); // Watch for manifest changes to stay in sync with RTDB

  useEffect(() => {
    setShowReport(sessionDevice.value.config.locker?.show_report || false);
  }, [sessionDevice.value?.config?.locker?.show_report]);

  useEffect(() => {
    if (!lotLocker || !startCheckoutSession) {
      return;
    }

    // Check for waiver text on the group before proceeding with checkout
    if (!waiverHandled.current) {
      const groupIndex = libraryOfThingsGroup.value.groupIndex;
      const group = sessionDevice.value?.manifest?.groups?.[groupIndex] || sessionDevice.value?.manifest?.groups?.[0];
      if (group?.waiverText) {
        if (!waiverPending) {
          console.log('📋 Waiver text found on group — showing waiver modal');
          setWaiverText(substituteWaiverVariables(group.waiverText));
          setWaiverPending(true);
        }
        return; // Wait for user to approve/reject
      }
    }

    console.log('🚀 Starting checkout process for locker:', lotLocker);

    workflowCheckOutItemIds(lotLocker.itemIds, lotLocker.doorNumber).then( results => {
      if (results.success) {
        processDoor(lotLocker.doorNumber).then(async () => {
          // Update lotLocker status to reflect door is now open
          setLotLocker(prev => prev ? { ...prev, locked: false } : prev);
          const timerval = sessionTimer.value;
          updateSessionTimer(timerval);

          // Start door close watcher IMMEDIATELY after door opens
          // Must run before manifest removal logic (which has early-return safety checks)
          setAnyDoorsOpen(true);
          startDoorCloseWatcher(lotLocker.doorNumber);

          if (lotLocker.isLockedForItemId) {
            // *** Permanent locker workflow ***
            // Don't delete the locker — just update status and patronId
            console.log('🔒 isLockedForItemId checkout — updating status instead of removing locker');

            let manifest = JSON.parse(JSON.stringify(sessionDevice.value.manifest));
            let lockerUpdated = false;

            for (const groupIndex in manifest.groups) {
              if (lockerUpdated) break;
              const group = manifest.groups[groupIndex as keyof typeof manifest.groups];
              if (group.lockers) {
                if (Array.isArray(group.lockers)) {
                  for (let i = 0; i < group.lockers.length; i++) {
                    const locker = group.lockers[i];
                    if (locker && locker.doorNumber === lotLocker.doorNumber) {
                      group.lockers[i] = {
                        ...locker,
                        status: 'CHECKEDOUT',
                        patronId: user.patronId,
                      };
                      lockerUpdated = true;
                      console.log('✅ Updated locked locker (array):', group.lockers[i]);
                      break;
                    }
                  }
                } else {
                  for (const lockerKey in group.lockers) {
                    const locker = group.lockers[lockerKey as keyof typeof group.lockers];
                    if (locker && locker.doorNumber === lotLocker.doorNumber) {
                      group.lockers[lockerKey as keyof typeof group.lockers] = {
                        ...locker,
                        status: 'CHECKEDOUT',
                        patronId: user.patronId,
                      };
                      lockerUpdated = true;
                      console.log('✅ Updated locked locker (object):', group.lockers[lockerKey as keyof typeof group.lockers]);
                      break;
                    }
                  }
                }
              }
            }

            if (lockerUpdated) {
              console.log('💾 Persisting manifest changes for isLockedForItemId checkout');
              await persistDeviceManifestChanges(manifest);
              sessionDevice.value = {
                ...sessionDevice.value,
                manifest: manifest
              };
              console.log('✅ Permanent locker checkout persisted');
            } else {
              console.warn('⚠️  Could not find locker to update for isLockedForItemId checkout');
            }

          } else {
            // *** Normal checkout workflow — remove locker from manifest ***
            console.log('🔧 Starting locker removal process - timestamp:', new Date().toISOString());

            // Find and remove ONLY ONE locker from manifest groups
            // Match on MULTIPLE fields to ensure exact match
            // IMPORTANT: Create a DEEP COPY to avoid mutating the original signal
            let manifest = JSON.parse(JSON.stringify(sessionDevice.value.manifest));
            let lockerRemoved = false;
            let removedCount = 0; // Safety counter

            console.log('🗑️  STARTING locker removal from manifest:', {
              doorNumber: lotLocker.doorNumber,
              door: lotLocker.door,
              itemIds: lotLocker.itemIds,
              patronId: lotLocker.patronId
            });

            console.log('📊 Manifest state BEFORE removal:');
            let totalLockersBefore = 0;
            for (const groupIndex in manifest.groups) {
              const group = manifest.groups[groupIndex as keyof typeof manifest.groups];
              const count = group.lockers ? (Array.isArray(group.lockers) ? group.lockers.length : Object.keys(group.lockers).length) : 0;
              totalLockersBefore += count;
              console.log(`  Group ${groupIndex} (${group.name}):`, {
                lockersCount: count,
                lockers: group.lockers
              });
            }
            console.log(`📊 TOTAL LOCKERS BEFORE: ${totalLockersBefore}`);

            // Helper function to check if two arrays have the same items
            const arraysMatch = (arr1: any[], arr2: any[]) => {
              if (!arr1 || !arr2 || arr1.length !== arr2.length) return false;
              const sorted1 = [...arr1].sort();
              const sorted2 = [...arr2].sort();
              return sorted1.every((val, idx) => val === sorted2[idx]);
            };

            // Helper function to check if locker matches lotLocker
            const isExactMatch = (locker: any) => {
              const doorNumberMatch = locker.doorNumber === lotLocker.doorNumber;
              const itemIdsMatch = arraysMatch(locker.itemIds, lotLocker.itemIds);
              // Patron match: either exact match, or manifest has 'All', or lotLocker was originally 'All'
              const patronMatch = locker.patronId === lotLocker.patronId ||
                                 locker.patronId === 'All' ||
                                 lotLocker.patronId === 'All';

              console.log(`  🔍 Comparing locker:`, {
                'manifest locker.doorNumber': locker.doorNumber,
                'lotLocker.doorNumber': lotLocker.doorNumber,
                doorNumberMatch,
                'manifest locker.itemIds': locker.itemIds,
                'lotLocker.itemIds': lotLocker.itemIds,
                itemIdsMatch,
                'manifest locker.patronId': locker.patronId,
                'lotLocker.patronId': lotLocker.patronId,
                patronMatch,
                overallMatch: doorNumberMatch && itemIdsMatch && patronMatch
              });

              return doorNumberMatch && itemIdsMatch && patronMatch;
            };

            for (const groupIndex in manifest.groups) {
              if (lockerRemoved || removedCount > 0) {
                console.log(`⏩ Skipping group ${groupIndex} - already removed one locker (lockerRemoved: ${lockerRemoved}, removedCount: ${removedCount})`);
                break; // Stop after removing one locker
              }

              const group = manifest.groups[groupIndex as keyof typeof manifest.groups];
              console.log(`🔍 Checking group ${groupIndex} (${group.name}) for locker to remove`);

              // Remove ONLY the first locker that EXACTLY matches lotLocker
              if (group.lockers) {
                // Handle both array and object formats
                if (Array.isArray(group.lockers)) {
                  console.log(`  📋 Group has ${group.lockers.length} lockers (array format)`);
                  const lockerIndexToRemove = group.lockers.findIndex(
                    (locker: any) => locker && isExactMatch(locker)
                  );
                  if (lockerIndexToRemove !== -1) {
                    const removedLocker = group.lockers[lockerIndexToRemove];
                    console.log(`✅ REMOVING locker at array index ${lockerIndexToRemove} from group ${groupIndex}:`, removedLocker);
                    group.lockers.splice(lockerIndexToRemove, 1);
                    lockerRemoved = true;
                    removedCount++;
                    console.log(`  ✔️  Array now has ${group.lockers.length} lockers remaining`);
                    console.log(`  ✔️  Removal counter: ${removedCount}`);
                  } else {
                    console.log(`  ❌ No matching locker found in this group's array`);
                  }
                } else {
                  // Object format
                  console.log(`  📋 Group has ${Object.keys(group.lockers).length} lockers (object format)`);
                  for (const lockerIndex in group.lockers) {
                    if (lockerRemoved || removedCount > 0) {
                      console.log(`⏩ Skipping locker ${lockerIndex} in group ${groupIndex} - already removed one (removedCount: ${removedCount})`);
                      break; // Already removed one, don't continue
                    }

                    const locker = group.lockers[lockerIndex as keyof typeof group.lockers];
                    if (locker && isExactMatch(locker)) {
                      console.log(`✅ REMOVING locker at object key ${lockerIndex} from group ${groupIndex}:`, locker);
                      delete group.lockers[lockerIndex as keyof typeof group.lockers];
                      lockerRemoved = true;
                      removedCount++;
                      console.log(`  ✔️  Object now has ${Object.keys(group.lockers).length} lockers remaining`);
                      console.log(`  ✔️  Removal counter: ${removedCount}`);
                      break; // Only remove ONE locker
                    }
                  }
                }
              }
            }

            // SAFETY CHECK: Ensure we only removed ONE locker
            if (removedCount > 1) {
              console.error(`🚨 CRITICAL ERROR: Removed ${removedCount} lockers instead of 1! Aborting persist.`);
              return; // Don't persist if we removed more than one
            }

            console.log('📊 Manifest state AFTER removal:');
            let totalLockersAfter = 0;
            for (const groupIndex in manifest.groups) {
              const group = manifest.groups[groupIndex as keyof typeof manifest.groups];
              const count = group.lockers ? (Array.isArray(group.lockers) ? group.lockers.length : Object.keys(group.lockers).length) : 0;
              totalLockersAfter += count;
              console.log(`  Group ${groupIndex} (${group.name}):`, {
                lockersCount: count,
                lockers: group.lockers
              });
            }
            console.log(`📊 TOTAL LOCKERS AFTER: ${totalLockersAfter}`);
            console.log(`📊 DIFFERENCE: ${totalLockersBefore - totalLockersAfter} locker(s) removed`);

            // FINAL SAFETY CHECK
            if (totalLockersBefore - totalLockersAfter !== 1) {
              console.error(`🚨 CRITICAL ERROR: Expected to remove 1 locker, but ${totalLockersBefore - totalLockersAfter} were removed! Aborting persist.`);
              console.error(`  Before: ${totalLockersBefore}, After: ${totalLockersAfter}`);
              return; // Don't persist if count is wrong
            }

            if (lockerRemoved && removedCount === 1) {
              console.log('💾 Persisting manifest changes after removing exactly ONE locker');
              // Persist the manifest changes to Firebase
              await persistDeviceManifestChanges(manifest);

              // Update local sessionDevice to stay in sync with RTDB
              console.log('🔄 Updating local sessionDevice with new manifest');
              sessionDevice.value = {
                ...sessionDevice.value,
                manifest: manifest
              };
              console.log('✅ Local sessionDevice updated successfully');

              // Checkout transaction is already created in workflowCheckOutItemIds
            } else {
              console.warn('⚠️  No locker found to remove with exact match:', {
                doorNumber: lotLocker.doorNumber,
                itemIds: lotLocker.itemIds,
                patronId: lotLocker.patronId,
                lockerRemoved,
                removedCount
              });
            }
          }

        });
      } else {
        const message = t('ERROR.CHECKOUT_FAILED') + '<br/>' + results.items.map(item => item.screenMessage).join('\n')
        customToast(() => (<b>{message}</b>), 20000, 'default', 'dark');
      }
    });


  }, [startCheckoutSession, waiverPending]);

  /** Parse integrations from localStorage once */
  function getCachedIntegrations(): { integrations: any[]; mac: string; ip: string } {
    try {
      const raw = localStorage.getItem('integrations');
      if (raw) {
        const parsed = JSON.parse(raw);
        const integrations = Array.isArray(parsed) ? parsed : Object.values(parsed);
        if (integrations.length > 0) {
          const first = integrations[0] as any;
          return {
            integrations,
            mac: first.macId || first.mac || '',
            ip: first.ip || '',
          };
        }
      }
    } catch (e) { /* ignore */ }
    return { integrations: [], mac: '', ip: '' };
  }

  async function processDoor(door: any) {
    try {
      await openDoor(door);
      testDoorAfterOpen(door);
    } catch (error) {
      console.error(`Error opening door ${door}:`, error);
      toast.error(t('SAAS.DOOR.OPEN_ERROR'))
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

  // Door close watcher: polls specific door until it closes, then exits
  const doorCloseWatcherRef = useRef<NodeJS.Timeout | null>(null);

  function stopDoorCloseWatcher() {
    if (doorCloseWatcherRef.current) {
      clearTimeout(doorCloseWatcherRef.current);
      doorCloseWatcherRef.current = null;
    }
  }

  function startDoorCloseWatcher(doorNumber: number) {
    stopDoorCloseWatcher();
    const cached = getCachedIntegrations();
    let mac = cached.mac;
    if (!mac) {
      mac = sessionDevice.value.config?.locker?.mac || sessionDevice.value.settings?.macid || '';
    }
    console.log(`🚪 Door close watcher started for door ${doorNumber}, mac: ${mac}`);

    const poll = async () => {
      if (sessionLocation.value !== '/lotcheckout' || exiting) return;

      // Decrement session timer on each poll
      if (sessionTimer.value > 0) {
        updateSessionTimer(sessionTimer.value - 1);
      } else {
        // Timer expired — exit
        console.log('⏱️ Checkout session timer expired — exiting');
        exiting = true;
        exit();
        return;
      }

      const doorOpen = getDoorOpenFromRTDB(doorNumber);

      if (doorOpen) {
        // Door is open — patron is taking the item, keep polling
        doorCloseWatcherRef.current = setTimeout(poll, 1000);
      } else {
        // Door is closed — processDoor already opened it, so patron is done
        console.log(`🚪 Door ${doorNumber} closed — ending checkout session in 2s`);
        setLotLocker(prev => prev ? { ...prev, locked: true } : prev);
        customToast(() => (<b>{t('SAAS.DOOR.CLOSE', {'door': doorNumber})} — {t('SAAS.EXIT')}...</b>), 2000, 'default', 'dark');
        doorCloseWatcherRef.current = setTimeout(() => {
          exiting = true;
          exit();
        }, 2000);
      }
    };

    // Start polling after a short delay to allow door to physically open
    doorCloseWatcherRef.current = setTimeout(poll, 2000);
  }

  async function exit() {
    exiting = true;
    stopDoorCloseWatcher();
    updateFontSize(fontSizeStorage.value); // Reset font size to default
    console.log('🚪 Exiting LoTCheckout — door closed, returning home');
    updateSessionUserModeOn(false);
    setLocation('/');
    updateShowBackgroundImage(true);
  }

  const onChange: TableProps['onChange'] = (pagination, filters, sorter, extra) => {
    console.log('params', pagination, filters, sorter, extra)
  }
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


  // *************** columns for the tables ***************
  const columnsLoTReport = [

    {
        width: '30%',
        title: 'Locker',
        dataIndex: 'title',
        key: 'title',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
        render: ( key: any , data: any ) => <>
        <div style={getTextStyle({ fontWeight: 'bold', color: SEBlue.value})} key={data.index}> {data.title} </div> </>

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
                <div style={getTextStyle({ fontWeight: 'bold', color: SEBlue.value})} key={data.index}> {data.descriptionIfReported} </div>
                :
                <div style={getTextStyle({ fontWeight: 'bold', color: SEBlue.value})} key={data.index}> {data.description} </div>
                }
            </>)
        }

    },
    {
      width: '10%',
      title: 'Actions',
      dataIndex: 'actions',
      key: 'actions',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
      render: ( key: any , data: any ) => <>
        <div  style={getTextStyle({fontWeight: 'bold'}, 10)} key={data.index}>

          {data.title.includes('staff') ?
          <Button style={{...getTextStyle({backgroundColor: SEBlue.value, color: 'white'})}} type="primary" onClick={() => {
            setModalOpen(true);
            setMessageToStaff(messageToStaff);
          }}> {t('SAAS.REPORT.SEND_MESSAGE')} </Button>
          :
          <Switch value={data.report} onChange={(checked) => {
            let newReport = lotLockerReport[data.index];
            newReport.report = checked;
            const result = [...lotLockerReport];
            result[data.index] = newReport;
            setLotLockerReport(result);
          }} />}
          </div>
      </>


    },
  ];

  const columnsLoT = [

    {
        title: 'ItemID',
        dataIndex: 'itemId',
        key: 'itemId',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
        render: ( key: any , _record: any ) => {
          const count = Array.isArray(_record.itemIds) ? _record.itemIds.length : (_record.itemId?.split(',').length || 0);
          return (<>
                <div style={getTextStyle({ fontWeight: 'bold', color: SEBlue.value}, 10)} key={key}> {count > 1 ? t('SAAS.LOT.LOCKER_HOLD_CONTENT_MANY', {'count': count, 'door': _record.door}) : t('SAAS.LOT.LOCKER_HOLD_CONTENT_ONE', {'count': count, 'door': _record.door})} </div>
            </>)
        }

    },
    {
      title: 'Door status',
      dataIndex: 'locked',
      key: 'locked',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
      render: ( key: any , _record: any ) => <>
        <div  style={getTextStyle({fontWeight: 'bold', color: SEBlue.value}, 10)} key={key}>  {
          _record.locked && !_record.checkedOut ?
          t('SAAS.DOOR.CLOSE', {'door': _record.door}) :
          _record.locked && _record.checkedOut ?
          <Button size='large' style={{...getTextStyle({fontWeight: 'bold'}, 10), padding: '10px'}} key={key} type="primary" onClick={async () => {
            await processDoor(_record.door);
            setLotLocker(prev => prev ? { ...prev, locked: false } : prev);
            updateSessionTimer(sessionDevice.value?.settings?.timerForCheckoutView || 30);
            startDoorCloseWatcher(_record.door);
          } }> {t('SAAS.DOOR.REOPEN', {'door': _record.door})} </Button>
          :
          t('SAAS.DOOR.OPEN', {'door': _record.door})
          }
          </div>
      </>

    },
    {
      title: 'Status',
      dataIndex: 'ils',
      key: 'ils',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
      render: ( key: any , _record: any ) => <>
      <div style={ getTextStyle({ fontWeight: 'bold'}, 10)} key={key}>
        { _record.checkedOut ? <CheckOutlined style={{color: 'green'}} /> : <CloseOutlined style={{color: 'red'}}/>}
      </div> </>

  },
  ];


  // *************** all html files ***************
  const htmlWelcomUser = () => {
    return (<Row justify="start">
        <Col span={24} >
          <Space>
              <div style={{...getTextStyle({color: 'white', marginTop: '-10px'}, 20), textAlign: 'left'}}> {t('SAAS.WELCOME_PATRON', {'name': (user.name ?? user.patronId)})} </div>
            </Space>
        </Col>
        <Col span={24} >
        </Col>
      </Row>)
  }

  const htmlThingDetails = () => {

    return (<>
      <Row justify="start" style={{marginTop: '10px'}}>
        <Col span={24}>

          { lotLockerImage &&
          <Card variant="borderless" style={{ 'boxShadow': '1px 1px 1px 1px rgb(0 0 0 / 50%), 0 1px 6px -1px rgb(0 0 0 / 2%), 0 2px 4px 0 rgb(0 0 0 / 4%'}}>
            {(() => {
              const isLandscape = sessionDevice.value?.settings?.screenOrientation?.toLowerCase() === 'landscape';

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
                        src={getImage(lotLockerImage.image, lotLockerImage.name)}
                      />
                    </div>

                    {/* Right: Content */}
                    <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                      {/* Door number */}
                      <h2 style={{
                        ...getTextStyle({fontWeight: 'bold'}, 12),
                        color: SEBlue.value,
                        margin: 0,
                        marginBottom: '8px'
                      }}>
                        Door #{lotLocker?.doorNumber || lotLocker?.door || 'N/A'}
                      </h2>

                      {/* Group name */}
                      <h3 style={{
                        ...getTextStyle({}, 10),
                        color: SEBlue.value,
                        fontWeight: 'bold',
                        marginTop: 0,
                        marginBottom: '4px'
                      }}>
                        {lockerNameAndDescription.name.toUpperCase()}
                      </h3>

                      {/* Group description */}
                      <p style={{
                        ...getTextStyle({}, 5),
                        color: SEBlue.value,
                        marginTop: 0,
                        marginBottom: '16px'
                      }}>
                        {lockerNameAndDescription.description}
                      </p>

                      {/* Item Id, Status, Action in a row */}
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
                              {lotLocker?.itemIds?.[0] || 'N/A'}
                            </div>
                          </div>
                        </Col>
                        <Col span={8}>
                          <div style={{textAlign: 'center'}}>
                            <div style={{ ...getTextStyle({}, 4), color: '#999', marginBottom: '4px' }}>Status</div>
                            <div style={{ ...getTextStyle({fontWeight: 'bold'}, 6) }}>
                              {lotLocker?.checkedOut ? (
                                <span style={{color: 'green'}}><CheckOutlined style={{marginRight: '5px'}} />Checked out</span>
                              ) : lotLocker?.locked ? (
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
                              onClick={async () => {
                                const doorNum = lotLocker?.doorNumber || lotLocker?.door;
                                customToast(() => (<b>Opening door {doorNum}</b>), 5000, 'default', 'dark');
                                await processDoor(doorNum);
                                setLotLocker(prev => prev ? { ...prev, locked: false } : prev);
                                updateSessionTimer(sessionDevice.value?.settings?.timerForCheckoutView || 30);
                                startDoorCloseWatcher(doorNum);
                              }}
                            >
                              Re-open door
                            </Button>
                          </div>
                        </Col>
                      </Row>

                      {/* Instructions */}
                      <div style={{marginTop: '16px'}}>
                        {anyDoorsOpen ?
                          <h2 style={getTextStyle({color: '#42A4DE', textAlign: 'center'}, 8)}>
                            {t('SAAS.LOCKER_CHECKOUT_INSTRUCTIONS_REMINDER')}
                          </h2>
                          :
                          <h2 style={getTextStyle({color: '#42A4DE', textAlign: 'center'}, 8)}>
                            {t('SAAS.LOCKER_CHECKOUT_INSTRUCTIONS_FINAL')}
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
                  {/* Door number at top left */}
                  <div style={{ padding: '20px', paddingBottom: '10px' }}>
                    <h2 style={{
                      ...getTextStyle({fontWeight: 'bold'}, 15),
                      color: SEBlue.value,
                      margin: 0,
                      textAlign: 'left'
                    }}>
                      Door #{lotLocker?.doorNumber || lotLocker?.door || 'N/A'}
                    </h2>
                  </div>

                  {/* Image on top */}
                  <img
                    style={{
                      width: '100%',
                      height: 'auto',
                      maxHeight: fontSize.value > 20 ? '400px' : '600px',
                      objectFit: 'contain',
                      display: 'block'
                    }}
                    alt="example"
                    src={getImage(lotLockerImage.image, lotLockerImage.name)}
                  />

                  {/* Card body content */}
                  <div style={{padding: '20px'}}>
                    <h3 style={{
                      ...getTextStyle({}, 10),
                      color: SEBlue.value,
                      textAlign: 'center',
                      fontWeight: 'bold',
                      marginTop: 0,
                      marginBottom: '10px'
                    }}>
                      {lockerNameAndDescription.name.toUpperCase()}
                    </h3>

                    <p style={{
                      ...getTextStyle({}, 5),
                      color: SEBlue.value,
                      textAlign: 'center',
                      marginTop: 0,
                      marginBottom: '20px'
                    }}>
                      {lockerNameAndDescription.description}
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
                            {lotLocker?.itemIds?.[0] || 'N/A'}
                          </div>
                        </div>
                      </Col>
                      <Col span={8}>
                        <div style={{textAlign: 'center'}}>
                          <div style={{ ...getTextStyle({}, 5), color: '#999', marginBottom: '5px' }}>Status</div>
                          <div style={{ ...getTextStyle({fontWeight: 'bold'}, 8) }}>
                            {lotLocker?.checkedOut ? (
                              <span style={{color: 'green'}}><CheckOutlined style={{marginRight: '5px'}} />Checked out</span>
                            ) : lotLocker?.locked ? (
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
                            onClick={async () => {
                              const doorNum = lotLocker?.doorNumber || lotLocker?.door;
                              customToast(() => (<b>Opening door {doorNum}</b>), 5000, 'default', 'dark');
                              await processDoor(doorNum);
                              setLotLocker(prev => prev ? { ...prev, locked: false } : prev);
                              updateSessionTimer(sessionDevice.value?.settings?.timerForCheckoutView || 30);
                              startDoorCloseWatcher(doorNum);
                            }}
                          >
                            Re-open door
                          </Button>
                        </div>
                      </Col>
                    </Row>

                    <Row gutter={[16, 16]} justify="center" style={{marginTop: '30px'}}>
                      <Col span={24}> {
                        anyDoorsOpen ?
                          <h2 style={getTextStyle({color: '#42A4DE', textAlign: 'center'}, 12)}>
                            {t('SAAS.LOCKER_CHECKOUT_INSTRUCTIONS_REMINDER')}
                          </h2>
                          :
                          <h2 style={getTextStyle({color: '#42A4DE', textAlign: 'center'}, 12)}>
                            {t('SAAS.LOCKER_CHECKOUT_INSTRUCTIONS_FINAL')}
                          </h2>
                      }
                      </Col>
                    </Row>
                  </div>
                </>
              );
            })()}
          </Card>
          }


      </Col>
    </Row>
    </>)
  }

  const htmlThingReport = () => {

    return (<>
      <Row justify="start" style={{marginTop: '10px'}}>
        <Col span={24} style={getTextStyle( {float: 'left', color: 'white', marginBottom: '-30px'})}>
          {t('SAAS.REPORT.TITLE')}
        </Col>
      </Row>

      <Row justify="start" style={{marginTop: '40px'}}>
        <Col span={24}>
        <Table style={getTextStyle()} pagination={false} showHeader={false} dataSource={ lotLockerReport } columns={columnsLoTReport} onChange={onChange}/>
        </Col>
      </Row>
    </>)
  }

  const htmlCheckoutThing = () => {

    return (
      <>
        {htmlThingDetails()}
        {showReport && htmlThingReport()}
      </>
    );


  }

  /** Substitute template variables in waiver HTML (matches sideevent admin flow) */
  const substituteWaiverVariables = (html: string): string => {
    const license = JSON.parse(localStorage.getItem('license') || '{}');
    const deviceName = sessionDevice.value?.name || sessionDevice.value?.config?.name || '';
    const templateData: Record<string, string> = {
      'LICENSE_NAME': license?.name || `License ${sessionLicenseId.value}`,
      'LICENSE_ADDRESS': license?.address || '',
      'LICENSE_EMAIL': license?.email || '',
      'PATRON_NAME': user?.patronId || user?.name || '',
      'patronId': user?.patronId || '',
      'DEVICE_NAME': deviceName,
      'TIMESTAMP': new Date().toLocaleString(),
    };
    let result = html;
    Object.entries(templateData).forEach(([key, value]) => {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    });
    return result;
  };

  const handleWaiverApprove = async () => {
    console.log('✅ Waiver approved — proceeding with checkout');

    // Save waiver approval to Firestore patron document + Firebase Storage
    const patronKey = localStorage.getItem('patronKey');
    const licenseId = sessionLicenseId.value;
    const groupIndex = libraryOfThingsGroup.value.groupIndex;
    const group = sessionDevice.value?.manifest?.groups?.[groupIndex] || sessionDevice.value?.manifest?.groups?.[0];

    const deviceName = sessionDevice.value?.settings?.name || sessionDevice.value?.name || '';
    const groupName = group?.name || '';
    const lockerName = `${deviceName} - Item type ${groupName}`;
    console.log('📋 Waiver save context:', {
      patronKey,
      licenseId,
      lockerName,
      groupIndex,
    });

    if (patronKey && licenseId !== undefined && licenseId !== null) {
      try {
        // waiverText already has variables substituted (done when shown in modal)
        const renderedHtml = waiverText || '';
        console.log(`📋 Calling addWaiverToPatron(${licenseId}, ${patronKey}, ${lockerName}, html[${renderedHtml.length}])`);
        await addWaiverToPatron(licenseId, patronKey, lockerName, renderedHtml);
        console.log('✅ Waiver saved to Firestore + Storage successfully');
      } catch (err: any) {
        console.error('❌ Failed to save waiver to Firestore:', err?.message || err, err);
      }
    } else {
      console.error('❌ Cannot save waiver — missing data:', { patronKey, licenseId });
    }

    waiverHandled.current = true;
    setWaiverText(null);
    setWaiverPending(false); // This triggers the useEffect to continue checkout
  };

  const handleWaiverReject = () => {
    console.log('❌ Waiver rejected — cancelling checkout');
    setWaiverText(null);
    setWaiverPending(false);
    setStartCheckoutSession(false);
    exit();
  };

  const htmlMain = () => {
    return (
      <>
        <div className="sweet-loading" style={stylePage}>

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

          {!loading && htmlWelcomUser() }
          {/* {!loading && getHoldLockers().lockers.length && htmlShowPickupItems() } */}
          {!loading && htmlCheckoutThing()}
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

        <Modal
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

          </Modal>

          {/* Waiver Modal - fullscreen HTML waiver with approve/reject */}
          {waiverText && (
            <div style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100vw',
              height: '100vh',
              zIndex: 9999,
              backgroundColor: '#fff',
              display: 'flex',
              flexDirection: 'column',
            }}>
              <div style={{
                padding: '10px 30px',
                backgroundColor: '#f5f5f5',
                borderBottom: '1px solid #e0e0e0',
                fontSize: '14px',
                color: '#999',
              }}>
                {localStorage.getItem('patronKey') || '—'}
              </div>
              <iframe
                srcDoc={`<style>html,body{margin:0!important;padding:10px 30px!important;max-width:100%!important;width:100%!important;box-sizing:border-box!important;font-size:22px!important;}body>*{max-width:100%!important;}</style>${waiverText}`}
                style={{
                  flex: 1,
                  border: 'none',
                  width: '100%',
                }}
                title="Waiver"
              />
              <div style={{
                display: 'flex',
                justifyContent: 'center',
                gap: '40px',
                padding: '20px',
                borderTop: '1px solid #e0e0e0',
                backgroundColor: '#f5f5f5',
              }}>
                <Button
                  size='large'
                  style={{
                    ...getTextStyle({ fontWeight: 'bold' }, 12),
                    backgroundColor: '#e74c3c',
                    borderColor: '#e74c3c',
                    color: 'white',
                    padding: '30px 80px',
                    height: 'auto',
                  }}
                  onClick={handleWaiverReject}
                >
                  {t('SAAS.REJECT', { defaultValue: 'Reject' })}
                </Button>
                <Button
                  size='large'
                  type="primary"
                  style={{
                    ...getTextStyle({ fontWeight: 'bold' }, 12),
                    backgroundColor: '#27ae60',
                    borderColor: '#27ae60',
                    color: 'white',
                    padding: '30px 80px',
                    height: 'auto',
                  }}
                  onClick={handleWaiverApprove}
                >
                  {t('SAAS.APPROVE', { defaultValue: 'Approve' })}
                </Button>
              </div>
            </div>
          )}

        </div>
      </>
    );
  }

  return htmlMain();


}

