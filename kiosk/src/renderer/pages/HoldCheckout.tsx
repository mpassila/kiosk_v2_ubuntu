import React, { useEffect, useState, useRef } from 'react';
import { Row, Col, Button, Card, Tag, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useLocation } from 'wouter';
import {
  sessionDevice, sessionDoorStatus, updateSessionUserModeOn, updateShowBackgroundImage,
  getTextStyle, SEBlue, customToast, persistDeviceManifestChanges, sessionTimer,
  updateSessionTimer, fontSize, updateFontSize, sessionLang, updateSessionBranch, doorStatuses, itemStatuses, setDoorStatuses, setItemStatuses, trackReopenDoor,
  sessionBranch, sessionLicenseId, FirebaseSIP2
} from "../state/shared";
import { useTranslation } from 'react-i18next';
import { useSignals } from "@preact/signals-react/runtime";
import { openDoor, isDoorOpen, getDoorOpenFromRTDB } from 'renderer/state/locker';
import { createDoorIsOpenTestFailedEvent, createCheckoutTransaction, createItemLeftBehindEvent } from 'renderer/state/transaction-service';
import { Promise } from "bluebird";
import ZoomLanguageControls from '../components/ZoomLanguageControls';
import { ToastContainer } from 'react-toastify';

// Grace period (ms) after door open before checking for close.
// Hardware reports lock state (not physical door state), so isDoorOpen returns false almost immediately.
// We trust the open command and skip close-checking during the grace period.
const DOOR_GRACE_MS = 8000;

const POLARIS_API_BASE = 'https://polarisapi-be4ekemxaa-uc.a.run.app';

// *************** workflowILSCheckout ***************
async function workflowILSCheckout(itemBarcode: string, patronBarcode: string): Promise<any> {
  const branch = sessionBranch.value;
  const currentLicenseId = sessionLicenseId.value;
  const isPolaris = branch?.polarisSettings?.enabled;
  const isSip2 = branch?.sip2Settings?.enabled;
  const isSymphony = branch?.symphonySettings?.enabled;

  // Skip for license 1/2 (demo)
  if (currentLicenseId === 1 || currentLicenseId === 2) {
    console.log(`📦 workflowILSCheckout [Hold]: Demo checkout for license ${currentLicenseId}, item ${itemBarcode}`);
    return { success: true, demo: true, itemBarcode };
  }

  if (isPolaris) {
    const branchId = branch?.id;
    const baseUrl = `${POLARIS_API_BASE}/${currentLicenseId}/${branchId}`;
    const logonBranchID = branch?.polarisSettings?.logonBranchId;
    const logonUserID = branch?.polarisSettings?.logonUserId;
    const logonWorkstationID = branch?.polarisSettings?.logonWorkstationId;

    console.log(`📦 workflowILSCheckout [Hold]: Polaris checkout for item ${itemBarcode}, patron ${patronBarcode}`);
    const checkoutRes = await fetch(`${baseUrl}/circulation/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemBarcode, patronBarcode, logonBranchID, logonUserID, logonWorkstationID })
    });

    const checkoutData = await checkoutRes.json();
    console.log(`📦 workflowILSCheckout [Hold]: Polaris checkout response:`, checkoutData);

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
    console.log(`📦 workflowILSCheckout [Hold]: SIP2 checkout for item ${itemBarcode}, patron ${patronBarcode}`);
    const result = await FirebaseSIP2.checkout(itemBarcode, patronBarcode);
    console.log(`📦 workflowILSCheckout [Hold]: SIP2 checkout response:`, result);
    return {
      success: +result.ok === 1,
      title: result.titleIdentifier || null,
      dueDate: result.dueDate || null,
      itemId: result.itemIdentifier || itemBarcode,
      data: result,
    };
  } else if (isSymphony) {
    console.log(`📦 workflowILSCheckout [Hold]: Symphony checkout — not yet implemented`);
    return { success: true, pending: true, itemBarcode };
  } else {
    console.log(`📦 workflowILSCheckout [Hold]: No ILS configured, skipping`);
    return { success: true, noIls: true, itemBarcode };
  }
}

export default function HoldCheckoutPage() {
  useSignals();

  const { t, i18n } = useTranslation();
  const [, setLocation] = useLocation();
  // Door status read via getDoorOpenFromRTDB helper
  const patron = JSON.parse(localStorage.getItem('patron') || 'null');
  const timer = sessionTimer.value;
  const currentFontSize = fontSize.value;
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const hasInitialized = useRef(false); // Prevent duplicate initialization
  const isExiting = useRef(false); // Prevent duplicate exit processing
  const confirmedOpenDoors = useRef<Set<number>>(new Set()); // Doors confirmed open by hardware
  const doorOpenedAt = useRef<Map<number, number>>(new Map()); // When each door was opened (for grace period)
  const doorCloseWatcherRef = useRef<NodeJS.Timeout | null>(null);
  const patronLockersRef = useRef<any[]>([]); // Ref so handleExit always reads latest value
  const [showLanguageModal, setShowLanguageModal] = useState(false);

  const [patronLockers, setPatronLockers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemsLeftBehind, setItemsLeftBehind] = useState<{ [doorNumber: number]: { [itemId: string]: boolean } }>({});
  const itemsLeftBehindRef = useRef<{ [doorNumber: number]: { [itemId: string]: boolean } }>({}); // Ref so handleExit always reads latest value
  const [isReopenMode, setIsReopenMode] = useState(false);
  const isReopenModeRef = useRef(false);
  const [expandedLocker, setExpandedLocker] = useState<number | null>(null);
  // Get patron's lockers from device.manifest.groups
  useEffect(() => {
    // Prevent duplicate initialization WITHIN THE SAME MOUNT
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    updateShowBackgroundImage(false);

    if (!patron) {
      customToast(() => (<b>Patron not found</b>), 5000, 'default', 'dark');
      return setLocation('/');
    }

    let lockers: any[] = [];

    if (sessionDevice.value?.manifest?.groups) {
      for (const groupKey in sessionDevice.value.manifest.groups) {
        const group = sessionDevice.value.manifest.groups[groupKey];

        if (!group.lockers) continue;

        // Handle both array and object structures
        const lockerEntries = Array.isArray(group.lockers)
          ? group.lockers
          : Object.values(group.lockers);

        for (const locker of lockerEntries) {
          if (!locker || !locker.patronId) continue;

          const lockerPatronId = String(locker.patronId);
          const searchPatronId = String(patron.patronId);

          // Check if this locker belongs to the patron
          // Match both exact patronId and "left behind" format (!patronId!)
          const isMatch =
            lockerPatronId === searchPatronId ||
            lockerPatronId === `!${searchPatronId}!`;

          if (isMatch) {
            const doorNumber = locker.doorNumber;

            lockers.push({
              ...locker,
              doorNumber,
              locked: !getDoorOpenFromRTDB(doorNumber),
              itemIds: locker.itemIds || []
            });
          }
        }
      }
    }

    // If no holds in manifest, check lastOneOut for same patron (reopen mode)
    if (lockers.length === 0) {
      try {
        const lastOneOutRaw = sessionStorage.getItem('lastOneOut');
        if (lastOneOutRaw) {
          const lastOneOut: any[] = JSON.parse(lastOneOutRaw);
          const patronId = String(patron.patronId);
          const matchingLockers = lastOneOut.filter(l => String(l.patronId) === patronId);
          if (matchingLockers.length > 0) {
            console.log(`🔄 Reopen mode: patron ${patronId} has ${matchingLockers.length} recent locker(s) from lastOneOut`);
            setIsReopenMode(true);
            isReopenModeRef.current = true;
            // Build patronLockers from lastOneOut for door display
            const reopenLockers = matchingLockers.map(l => ({
              doorNumber: l.doorNumber,
              patronId: l.patronId,
              itemIds: l.checkedOutItems || [],
              titles: l.titles || {},
            }));
            setPatronLockers(reopenLockers);
            patronLockersRef.current = reopenLockers;
            lockers = reopenLockers;
          }
        }
      } catch (err) {
        console.error('Error checking lastOneOut:', err);
      }
    }

    setPatronLockers(lockers);
    patronLockersRef.current = lockers;
    setLoading(false);

    // Initialize door and item statuses
    setDoorStatuses({});
    setItemStatuses({});

    // Start checkout timer
    updateSessionTimer(sessionDevice.value?.settings?.timerForCheckoutView || 30);
    startTimer();

    // Open doors
    if (lockers.length > 0) {
      setTimeout(async () => {
        const useAccordion = lockers.length > 2;

        for (let i = 0; i < lockers.length; i++) {
          const locker = lockers[i];
          try {
            // Accordion: expand current card (appears at top via render sort)
            if (useAccordion) {
              setExpandedLocker(locker.doorNumber);
              await new Promise(resolve => setTimeout(resolve, 400));
            }

            // In normal mode, mark items checked out with animation
            if (!isReopenModeRef.current) {
              for (let itemIdx = 0; itemIdx < locker.itemIds.length; itemIdx++) {
                const itemId = locker.itemIds[itemIdx];
                setItemStatuses({
                  ...itemStatuses.value,
                  [locker.doorNumber]: {
                    ...itemStatuses.value[locker.doorNumber],
                    [itemId]: true
                  }
                });
                await new Promise(resolve => setTimeout(resolve, 500));
              }
              await new Promise(resolve => setTimeout(resolve, 300));
            }

            await openDoor(locker.doorNumber);

            // Track door for close watcher with grace period timestamp
            confirmedOpenDoors.current.add(locker.doorNumber);
            doorOpenedAt.current.set(locker.doorNumber, Date.now());

            setDoorStatuses({
              ...doorStatuses.value,
              [locker.doorNumber]: { open: true }
            });

            customToast(() => (<b>Door {locker.doorNumber} opened</b>), 2000, 'default', 'dark');

            if (useAccordion) {
              // Show open state briefly, then collapse — next iteration expands next card
              await new Promise(resolve => setTimeout(resolve, 1500));
              setExpandedLocker(null);
              await new Promise(resolve => setTimeout(resolve, 300));
            } else if (i < lockers.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          } catch (error) {
            console.error(`Failed to open door ${locker.doorNumber}:`, error);
          }
        }

        // Start door close watcher after all doors are opened
        if (confirmedOpenDoors.current.size > 0) {
          let mac = '';
          const cachedIntegrations = localStorage.getItem('integrations');
          if (cachedIntegrations) {
            try {
              const parsed = JSON.parse(cachedIntegrations);
              const integrations = Array.isArray(parsed) ? parsed : Object.values(parsed);
              if (integrations.length > 0) {
                mac = (integrations[0] as any).macId || (integrations[0] as any).mac || '';
              }
            } catch (e) { /* ignore */ }
          }
          if (!mac) {
            mac = sessionDevice.value?.settings?.macid || sessionDevice.value?.settings?.mac || sessionDevice.value?.config?.locker?.mac || '';
          }
          startDoorCloseWatcher(mac);
        }
      }, 1000);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (doorCloseWatcherRef.current) {
        clearInterval(doorCloseWatcherRef.current);
      }
      hasInitialized.current = false;
      isExiting.current = false;
    };
  }, []);

  const startTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    timerRef.current = setInterval(() => {
      const currentTimer = sessionTimer.value;
      if (currentTimer > 0) {
        updateSessionTimer(currentTimer - 1);
      } else {
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
        handleExit();
      }
    }, 1000);
  };

  const resetTimer = () => {
    updateSessionTimer(sessionDevice.value?.settings?.timerForCheckoutView || 30);
  };

  // Start polling confirmed-open doors every 2s — when all are closed, end session
  // Uses per-door grace period: skip close-checking until DOOR_GRACE_MS after door was opened
  const startDoorCloseWatcher = (mac: string) => {
    if (doorCloseWatcherRef.current) return; // Already running
    console.log('👀 Door close watcher started for doors:', [...confirmedOpenDoors.current]);
    doorCloseWatcherRef.current = setInterval(async () => {
      if (isExiting.current || confirmedOpenDoors.current.size === 0) return;
      try {
        for (const doorNumber of [...confirmedOpenDoors.current]) {
          // Per-door grace period: skip checking until enough time has passed
          const openedAt = doorOpenedAt.current.get(doorNumber) || 0;
          const elapsed = Date.now() - openedAt;
          if (elapsed < DOOR_GRACE_MS) {
            console.log(`🚪 Door ${doorNumber}: grace period (${Math.round((DOOR_GRACE_MS - elapsed) / 1000)}s left)`);
            continue;
          }

          const isOpen = await isDoorOpen(mac, doorNumber, { fresh: true });
          console.log(`🚪 Door watcher poll: door=${doorNumber}, isOpen=${isOpen}`);
          if (!isOpen) {
            console.log(`🚪 Door ${doorNumber} closed — removing from watch list`);
            confirmedOpenDoors.current.delete(doorNumber);
            doorOpenedAt.current.delete(doorNumber);
          }
        }
        if (confirmedOpenDoors.current.size === 0) {
          console.log('✅ All doors closed — ending checkout session');
          if (doorCloseWatcherRef.current) clearInterval(doorCloseWatcherRef.current);
          doorCloseWatcherRef.current = null;
          handleExit();
        }
      } catch (err) {
        console.error('Door close watcher error:', err);
      }
    }, 2000);
  };

  const handleReopenDoor = async (doorNumber: number) => {
    resetTimer();

    // Track reopen count — log error event on 2nd+ click
    const count = trackReopenDoor(doorNumber);
    if (count >= 2) {
      const locker = patronLockers.find(l => l.doorNumber === doorNumber);
      createDoorIsOpenTestFailedEvent({
        itemIds: locker?.itemIds || [],
        patronId: patron?.patronId || '',
        doorNumber,
        success: false,
        metadata: { error: `Door ${doorNumber} re-opened ${count} times by patron`, reopenCount: count }
      }).catch(err => console.error('Failed to log reopen error event:', err));
    }

    try {
      await openDoor(doorNumber);
      customToast(() => (<b>Door {doorNumber} opened</b>), 2000, 'default', 'dark');

      setDoorStatuses({
        ...doorStatuses.value,
        [doorNumber]: { open: true }
      });
    } catch (error) {
      console.error(`Failed to open door ${doorNumber}:`, error);
      customToast(() => (<b>Error opening door {doorNumber}</b>), 3000, 'default', 'dark');
    }
  };

  const handleLeaveItemBehind = (doorNumber: number, itemId: string) => {
    resetTimer();
    // Toggle left behind status
    const isCurrentlyLeftBehind = itemsLeftBehind[doorNumber]?.[itemId];

    setItemsLeftBehind(prev => {
      const updated = {
        ...prev,
        [doorNumber]: {
          ...prev[doorNumber],
          [itemId]: !isCurrentlyLeftBehind
        }
      };
      itemsLeftBehindRef.current = updated;
      return updated;
    });

    if (!isCurrentlyLeftBehind) {
      customToast(() => (
        <div>
          <b>Staff notified</b><br/>
          Item (barcode: {itemId}) is still in locker #{doorNumber}
        </div>
      ), 4000, 'default', 'dark');
    } else {
      customToast(() => (
        <div>
          <b>Undone</b><br/>
          Item (barcode: {itemId}) will be checked out
        </div>
      ), 3000, 'default', 'dark');
    }
  };

  const handleExit = async () => {
    if (isExiting.current) return;
    isExiting.current = true;

    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    if (doorCloseWatcherRef.current) {
      clearInterval(doorCloseWatcherRef.current);
      doorCloseWatcherRef.current = null;
    }
    confirmedOpenDoors.current.clear();
    doorOpenedAt.current.clear();

    // Reopen mode — just go home, no checkout/transactions needed
    if (isReopenModeRef.current) {
      sessionStorage.removeItem('lastOneOut');
      updateSessionUserModeOn(false);
      setLocation('/');
      updateShowBackgroundImage(true);
      return;
    }

    const patronBarcode = patron?.patronId || '';
    const branch = sessionBranch.value;
    const isPolaris = branch?.polarisSettings?.enabled;
    const isSip2 = branch?.sip2Settings?.enabled;
    const isSymphony = branch?.symphonySettings?.enabled;
    const ilsType = isPolaris ? 'polaris' : isSip2 ? 'sip2' : isSymphony ? 'symphony' : 'none';

    // Use refs to avoid stale closure — timer/watcher callbacks capture old state
    const lockers = patronLockersRef.current;
    const currentItemsLeftBehind = itemsLeftBehindRef.current;
    console.log(`🚪 handleExit: processing ${lockers.length} locker(s) for patron ${patronBarcode}, leftBehind:`, currentItemsLeftBehind);

    for (const locker of lockers) {

      const leftBehindItems = locker.itemIds.filter((itemId: string) =>
        currentItemsLeftBehind[locker.doorNumber]?.[itemId]
      );

      const checkedOutItems = locker.itemIds.filter((itemId: string) =>
        !currentItemsLeftBehind[locker.doorNumber]?.[itemId]
      );

      // ILS checkout for each checked-out item (each needs individual SIP2/Polaris call)
      const ilsResults: Record<string, any> = {};
      for (const itemId of checkedOutItems) {
        try {
          // Check if item is already checked out (circ status 04) — skip re-checkout
          const itemInfo = await FirebaseSIP2.itemInfo(itemId);
          const circStatus = String(itemInfo?.circulationStatus || '').trim();
          if (circStatus === '04' || circStatus === '4') {
            console.log(`📦 Item ${itemId} already checked out (circ status ${circStatus}), skipping re-checkout`);
            ilsResults[itemId] = { success: true, alreadyCheckedOut: true, title: itemInfo?.titleIdentifier || null };
            continue;
          }

          ilsResults[itemId] = await workflowILSCheckout(itemId, patronBarcode);
          console.log(`📦 Hold ILS checkout for ${itemId}:`, ilsResults[itemId]);
        } catch (err) {
          console.error(`❌ ILS checkout failed for item ${itemId}:`, err);
          ilsResults[itemId] = { success: false, error: String(err) };
        }
      }

      // Single transaction for all checked-out items from this locker
      if (checkedOutItems.length > 0) {
        const allSuccess = checkedOutItems.every(id => ilsResults[id]?.success);
        try {
          await createCheckoutTransaction({
            itemIds: checkedOutItems,
            patronId: patronBarcode,
            doorNumber: locker.doorNumber,
            success: allSuccess,
            metadata: {
              items: checkedOutItems.map(id => ({
                itemId: id,
                title: ilsResults[id]?.title || null,
                itemStatusId: ilsResults[id]?.itemStatusId || null,
                success: ilsResults[id]?.success ?? false,
                ...(ilsResults[id]?.error ? { error: ilsResults[id].error } : {}),
              })),
              ilsType,
            }
          });
          console.log(`✅ Checkout transaction created for ${checkedOutItems.length} item(s): ${checkedOutItems.join(', ')}`);
        } catch (txErr) {
          console.error(`❌ Failed to create checkout transaction:`, txErr);
        }
      }

      // Single event for all left-behind items from this locker
      if (leftBehindItems.length > 0) {
        await createItemLeftBehindEvent({
          itemIds: leftBehindItems,
          patronId: patronBarcode,
          doorNumber: locker.doorNumber,
          success: true,
          metadata: { ilsType }
        }).catch(txErr => console.error('❌ Failed to create item_left_behind event:', txErr));
      }

      // Update manifest directly on live signal (same pattern as clearLockerManifest)
      const doorNum = +locker.doorNumber;
      const groups = sessionDevice.value?.manifest?.groups;
      if (groups) {
        const groupsIterable = Array.isArray(groups) ? groups.entries() : Object.entries(groups);
        for (const [groupKey, group] of groupsIterable) {
          const groupData = group as any;
          if (!groupData?.lockers) continue;

          if (Array.isArray(groupData.lockers)) {
            const lockerIndex = groupData.lockers.findIndex((l: any) => +l?.doorNumber === doorNum);
            if (lockerIndex !== -1) {
              if (leftBehindItems.length === 0) {
                groupData.lockers.splice(lockerIndex, 1);
              } else {
                groupData.lockers[lockerIndex].itemIds = leftBehindItems;
                groupData.lockers[lockerIndex].patronId = `!${patron.patronId}!`;
              }
              break;
            }
          } else {
            // Object format — check numeric and string keys
            const lockerKey = groupData.lockers[doorNum] !== undefined ? doorNum
              : groupData.lockers[String(doorNum)] !== undefined ? String(doorNum)
              : Object.keys(groupData.lockers).find(k => +groupData.lockers[k]?.doorNumber === doorNum);
            if (lockerKey !== undefined && lockerKey !== null) {
              if (leftBehindItems.length === 0) {
                delete groupData.lockers[lockerKey];
              } else {
                groupData.lockers[lockerKey].itemIds = leftBehindItems;
                groupData.lockers[lockerKey].patronId = `!${patron.patronId}!`;
              }
              break;
            }
          }
        }
      }
    }

    // Save checkout session info as array of locker objects
    sessionStorage.setItem('lastOneOut', JSON.stringify(
      lockers.map(l => ({
        doorNumber: l.doorNumber,
        patronId: patronBarcode,
        patronName: patron?.name || null,
        itemIds: l.itemIds,
        titles: l.titles || {},
        leftBehindItems: l.itemIds.filter((id: string) => currentItemsLeftBehind[l.doorNumber]?.[id]),
        checkedOutItems: l.itemIds.filter((id: string) => !currentItemsLeftBehind[l.doorNumber]?.[id]),
        timestamp: Date.now(),
      }))
    ));

    console.log('📤 Persisting manifest after hold checkout...');
    await persistDeviceManifestChanges(sessionDevice.value.manifest);

    updateSessionUserModeOn(false);
    setLocation('/');
    updateShowBackgroundImage(true);
  };

  const handleZoomIn = () => {
    // Increase font sizes in cards and title by 2px
    const cards = document.querySelectorAll('.ant-card');
    const title = document.querySelector('h1');

    cards.forEach((card: any) => {
      const elements = card.querySelectorAll('div, span, button, .ant-tag');
      elements.forEach((el: any) => {
        const currentSize = parseInt(window.getComputedStyle(el).fontSize);
        el.style.fontSize = `${currentSize + 2}px`;
      });
    });

    if (title) {
      const currentSize = parseInt(window.getComputedStyle(title).fontSize);
      (title as any).style.fontSize = `${currentSize + 2}px`;
    }
  };

  const handleZoomOut = () => {
    // Decrease font sizes in cards and title by 2px
    const cards = document.querySelectorAll('.ant-card');
    const title = document.querySelector('h1');

    cards.forEach((card: any) => {
      const elements = card.querySelectorAll('div, span, button, .ant-tag');
      elements.forEach((el: any) => {
        const currentSize = parseInt(window.getComputedStyle(el).fontSize);
        const newSize = Math.max(12, currentSize - 2);
        el.style.fontSize = `${newSize}px`;
      });
    });

    if (title) {
      const currentSize = parseInt(window.getComputedStyle(title).fontSize);
      const newSize = Math.max(12, currentSize - 2);
      (title as any).style.fontSize = `${newSize}px`;
    }
  };

  const handleLanguageClick = () => {
    setShowLanguageModal(true);
  };


  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        ...getTextStyle()
      }}>
        <h2>Loading...</h2>
      </div>
    );
  }

  return (
    <div style={{
      padding: '40px',
      minHeight: '100vh',
      ...getTextStyle()
    }}>
      {/* Welcome Greeting */}
      <Row style={{ marginBottom: '40px' }}>
        <Col span={24}>
          <h1 style={{
            fontSize: '72px',
            color: 'white',
            marginBottom: '20px',
            fontWeight: 'bold'
          }}>
            {t('SAAS.HOLD.HOLD_INSTRUCTIONS', { patron: patron?.name || patron?.patronId })}
          </h1>
        </Col>
      </Row>

      {/* No Items Message */}
      {patronLockers.length === 0 && (
        <Row justify="center" style={{ marginTop: '60px' }}>
          <Col>
            <Card style={{
              textAlign: 'center',
              padding: '40px',
              borderRadius: '8px',
              boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
              backgroundColor: 'white'
            }}>
              <h2 style={{ fontSize: '48px', color: SEBlue.value, marginBottom: '20px', fontWeight: 'bold' }}>
                No Hold Items Found
              </h2>
              <p style={{ fontSize: '32px', color: SEBlue.value, marginBottom: '30px', fontWeight: 'bold' }}>
                Locker has no holds for patron {patron?.patronId || 'unknown'}
              </p>
              <p style={{ fontSize: '28px', color: '#666' }}>
                Thank you for using our hold pickup locker!
              </p>
              <Button
                size="large"
                type="primary"
                onClick={handleExit}
                style={{
                  marginTop: '30px',
                  fontSize: '24px',
                  height: '80px',
                  padding: '0 50px',
                  backgroundColor: SEBlue.value,
                  borderColor: SEBlue.value
                }}
              >
                Exit
              </Button>
            </Card>
          </Col>
        </Row>
      )}

      {/* Locker Cards - Centered */}
      {patronLockers.length > 0 && (() => {
        const useAccordion = patronLockers.length > 2;

        // Accordion: sort expanded card to top, rest below
        const sortedLockers = useAccordion
          ? [...patronLockers].sort((a, b) => {
              if (a.doorNumber === expandedLocker) return -1;
              if (b.doorNumber === expandedLocker) return 1;
              return 0;
            })
          : patronLockers;

        // Build running item offset map from original order
        const itemOffsetMap: Record<number, number> = {};
        let offset = 0;
        for (const locker of patronLockers) {
          itemOffsetMap[locker.doorNumber] = offset;
          offset += locker.itemIds?.length || 0;
        }

        return (
        <>
          <div style={{
            marginTop: useAccordion ? '10px' : '40px',
            display: 'flex',
            flexDirection: 'column',
            gap: useAccordion ? '6px' : '24px',
            alignItems: 'center',
            ...(useAccordion ? { height: 'calc(100vh - 180px)', overflowY: 'auto' as const } : {})
          }}>
            {sortedLockers.map((locker) => {
              const lockerItemOffset = itemOffsetMap[locker.doorNumber];
              const isExpanded = !useAccordion || expandedLocker === locker.doorNumber;
              const isOpen = doorStatuses.value[locker.doorNumber]?.open;
              const itemCount = locker.itemIds?.length || 0;

              // --- Collapsed accordion card ---
              if (useAccordion && !isExpanded) {
                return (
                  <Card
                    key={locker.doorNumber}
                    style={{
                      backgroundColor: 'white',
                      boxShadow: '0 1px 4px rgba(0, 0, 0, 0.06)',
                      borderRadius: '8px',
                      width: '90%',
                      maxWidth: '1400px',
                      border: '1px solid #e8e8e8',
                      flexShrink: 0,
                      cursor: 'pointer',
                    }}
                    styles={{
                      body: { padding: '16px 32px' },
                    }}
                    onClick={() => setExpandedLocker(locker.doorNumber)}
                  >
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <span style={{ fontSize: '30px', fontWeight: 'bold', color: SEBlue.value }}>
                          Locker #{locker.doorNumber}
                        </span>
                        <span style={{
                          fontSize: '22px',
                          fontWeight: 'bold',
                          color: isOpen ? '#166534' : '#ef4444',
                        }}>
                          {isOpen ? 'OPEN' : 'CLOSED'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                        <span style={{ fontSize: '24px', color: '#555' }}>
                          {itemCount} item{itemCount !== 1 ? 's' : ''}
                        </span>
                        <span style={{ fontSize: '22px', color: SEBlue.value, fontWeight: 'bold' }}>
                          show more &#9660;
                        </span>
                      </div>
                    </div>
                  </Card>
                );
              }

              // --- Expanded card (full layout) ---
              return (
              <Card
                key={locker.doorNumber}
                title={
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      width: '100%',
                      cursor: useAccordion ? 'pointer' : 'default',
                    }}
                    onClick={useAccordion ? () => setExpandedLocker(null) : undefined}
                  >
                    <div style={{ fontSize: '56px', fontWeight: 'bold', color: SEBlue.value, flex: '0 0 auto' }}>
                      Locker #{locker.doorNumber}
                    </div>
                    <div style={{ flex: '1', display: 'flex', justifyContent: 'center' }}>
                      {isOpen ? (
                        <div style={{
                          fontSize: '32px',
                          padding: '12px 24px',
                          fontWeight: 'bold',
                          color: '#166534',
                        }}>
                          OPEN
                        </div>
                      ) : (
                        <div style={{
                          fontSize: '32px',
                          padding: '12px 24px',
                          fontWeight: 'bold',
                          color: '#ef4444',
                        }}>
                          CLOSED
                        </div>
                      )}
                    </div>
                    <div style={{ flex: '0 0 auto', display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <Button
                        size="large"
                        icon={<ReloadOutlined />}
                        onClick={(e) => { e.stopPropagation(); handleReopenDoor(locker.doorNumber); }}
                        style={{
                          height: '60px',
                          fontSize: '24px',
                          fontWeight: 'bold',
                          padding: '0 40px',
                          backgroundColor: SEBlue.value,
                          color: 'white',
                          border: 'none'
                        }}
                      >
                        RE-OPEN
                      </Button>
                      {useAccordion && (
                        <span style={{ fontSize: '22px', color: SEBlue.value, fontWeight: 'bold', marginLeft: '8px' }}>
                          show less &#9650;
                        </span>
                      )}
                    </div>
                  </div>
                }
                style={{
                  backgroundColor: 'white',
                  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
                  borderRadius: '8px',
                  width: '90%',
                  maxWidth: '1400px',
                  transition: 'all 0.3s ease',
                  border: '1px solid #e8e8e8',
                  ...(useAccordion ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' } : {})
                }}
                styles={{
                  body: {
                    padding: '40px',
                    ...(useAccordion ? { flex: 1, minHeight: 0, overflow: 'hidden' } : {})
                  },
                  header: {
                    backgroundColor: 'white',
                    borderBottom: '1px solid #e8e8e8',
                    flexShrink: 0,
                  }
                }}
              >
                {/* Item IDs with Titles - Same Row */}
                <div style={{ textAlign: 'left', maxHeight: useAccordion ? '100%' : '400px', overflowY: 'auto', height: useAccordion ? '100%' : 'auto' }}>
                  <Space direction="vertical" size="small" style={{ width: '100%' }}>
                    {locker.itemIds.length > 0 ? (
                      locker.itemIds.map((itemId: string, idx: number) => (
                        <div key={idx} style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          padding: '6px 0'
                        }}>
                          <div style={{
                            display: 'flex',
                            alignItems: 'baseline',
                            gap: '8px',
                            flex: 1,
                            overflow: 'hidden',
                          }}>
                            <span style={{
                              fontSize: '24px',
                              fontWeight: 'normal',
                              color: '#999',
                              flexShrink: 0,
                            }}>
                              {lockerItemOffset + idx + 1}.
                            </span>
                            <span style={{
                              fontSize: '36px',
                              fontWeight: 'bold',
                              color: SEBlue.value,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}>
                              {(() => {
                                const raw = locker.titles?.[itemId] || '';
                                const cleaned = raw.replace(/[\s\\/;:]+$/, '');
                                return cleaned || itemId;
                              })()}
                            </span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, marginRight: '5px' }}>
                            {itemStatuses.value[locker.doorNumber]?.[itemId] ? (
                              <div style={{
                                fontSize: '26px',
                                color: '#166534',
                                fontWeight: 'bold',
                                textDecoration: itemsLeftBehind[locker.doorNumber]?.[itemId] ? 'line-through' : 'none'
                              }}>
                                ✓ Checked out
                              </div>
                            ) : (
                              <div style={{
                                fontSize: '26px',
                                color: SEBlue.value,
                                fontWeight: 'bold',
                              }}>
                                On Hold
                              </div>
                            )}
                            <Button
                              size="large"
                              onClick={() => handleLeaveItemBehind(locker.doorNumber, itemId)}
                              style={{
                                height: '56px',
                                fontSize: '22px',
                                fontWeight: 'bold',
                                padding: '0 24px',
                                backgroundColor: itemsLeftBehind[locker.doorNumber]?.[itemId]
                                  ? '#fff1f0'
                                  : '#f5f5f5',
                                color: itemsLeftBehind[locker.doorNumber]?.[itemId]
                                  ? '#cf1322'
                                  : '#666',
                                border: itemsLeftBehind[locker.doorNumber]?.[itemId]
                                  ? '2px solid #ffa39e'
                                  : '1px solid #d9d9d9',
                              }}
                            >
                              {itemsLeftBehind[locker.doorNumber]?.[itemId] ? 'Undo - Left behind' : 'Leave this item behind'}
                            </Button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <span style={{ color: '#999', fontSize: '28px' }}>No items in this locker</span>
                    )}
                  </Space>
                </div>
              </Card>
            ); })}
          </div>

        </>
      ); })()}

      {/* Zoom and Language Controls */}
      {!showLanguageModal && (
        <ZoomLanguageControls
          showTimer={true}
          showLanguageButton={false}
          showZoom={false}
          timer={timer}
          onTimerClick={handleExit}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onLanguageClick={handleLanguageClick}
        />
      )}

      {/* Toast Container */}
      <ToastContainer
        position="top-center"
        autoClose={3000}
        hideProgressBar
        newestOnTop
        closeOnClick
        rtl={false}
        pauseOnFocusLoss={false}
        draggable={false}
        pauseOnHover={false}
      />
    </div>
  );
}
