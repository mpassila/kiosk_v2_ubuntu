import React, { useEffect, useState, useRef } from 'react';
import { Row, Col, Button, Card, Tag, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useLocation } from 'wouter';
import {
  sessionDevice, sessionDoorStatus, updateSessionUserModeOn, updateShowBackgroundImage,
  getTextStyle, SEBlue, customToast, sessionTimer,
  updateSessionTimer, doorStatuses, itemStatuses, setDoorStatuses, setItemStatuses, trackReopenDoor
} from "../state/shared";
import { useTranslation } from 'react-i18next';
import { useSignals } from "@preact/signals-react/runtime";
import { openDoor, getDoorOpenFromRTDB } from 'renderer/state/locker';
import { createDoorIsOpenTestFailedEvent } from 'renderer/state/transaction-service';
import ZoomLanguageControls from '../components/ZoomLanguageControls';
import { ToastContainer } from 'react-toastify';

export default function HoldCheckoutOfflinePage() {
  useSignals();

  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  // Door status read via getDoorOpenFromRTDB helper
  const patronId = localStorage.getItem('patronId') || '';
  const timer = sessionTimer.value;
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const hasInitialized = useRef(false);
  const isExiting = useRef(false);

  const [patronLockers, setPatronLockers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    updateShowBackgroundImage(false);

    if (!patronId) {
      customToast(() => (<b>Patron not found</b>), 5000, 'default', 'dark');
      return setLocation('/');
    }

    // Collect lockers where patronId matches the scanned barcode
    const lockers: any[] = [];
    const groups = sessionDevice.value?.manifest?.groups;
    if (groups) {
      for (const groupKey in groups) {
        const group = groups[groupKey];
        if (!group.lockers) continue;

        const lockerEntries = Array.isArray(group.lockers)
          ? group.lockers
          : Object.values(group.lockers);

        for (const locker of lockerEntries) {
          if (!locker || !locker.patronId) continue;
          if (String(locker.patronId) === patronId || String(locker.patronId) === `!${patronId}!`) {
            const doorNumber = locker.doorNumber;
            lockers.push({
              ...locker,
              groupKey,
              doorNumber,
              locked: !getDoorOpenFromRTDB(doorNumber),
              itemIds: locker.itemIds || []
            });
          }
        }
      }
    }

    setPatronLockers(lockers);
    setLoading(false);
    setDoorStatuses({});
    setItemStatuses({});
    updateSessionTimer(sessionDevice.value?.settings?.timerForCheckoutView || 30);
    startTimer();

    // Auto-open all doors
    if (lockers.length > 0) {
      setTimeout(async () => {
        for (let i = 0; i < lockers.length; i++) {
          const locker = lockers[i];
          try {
            // Mark items as checked out
            for (const itemId of locker.itemIds) {
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

            await openDoor(locker.doorNumber);

            setDoorStatuses({
              ...doorStatuses.value,
              [locker.doorNumber]: { open: true }
            });

            if (i < lockers.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          } catch (error) {
            console.error(`Failed to open door ${locker.doorNumber}:`, error);
          }
        }
      }, 1000);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      hasInitialized.current = false;
      isExiting.current = false;
    };
  }, []);

  const startTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      const current = sessionTimer.value;
      if (current > 0) {
        updateSessionTimer(current - 1);
      } else {
        if (timerRef.current) clearInterval(timerRef.current);
        handleExit();
      }
    }, 1000);
  };

  const resetTimer = () => updateSessionTimer(sessionDevice.value?.settings?.timerForCheckoutView || 30);

  const handleReopenDoor = async (doorNumber: number) => {
    resetTimer();

    // Track reopen count — log error event on 2nd+ click
    const count = trackReopenDoor(doorNumber);
    if (count >= 2) {
      const locker = patronLockers.find(l => l.doorNumber === doorNumber);
      createDoorIsOpenTestFailedEvent({
        itemIds: locker?.itemIds || [],
        patronId: patronId,
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

  const handleExit = async () => {
    if (isExiting.current) return;
    isExiting.current = true;

    if (timerRef.current) clearInterval(timerRef.current);

    // Append each patron locker object to checkoutManifest.json
    const electron = (window as any).electron;
    for (const locker of patronLockers) {
      try {
        await electron.sideeventNative.appendCheckoutManifest(locker);
        console.log(`OFFLINE: Appended locker door #${locker.doorNumber} to checkoutManifest.json`);
      } catch (error) {
        console.error(`OFFLINE: Failed to append locker door #${locker.doorNumber}:`, error);
      }
    }

    updateSessionUserModeOn(false);
    setLocation('/');
    updateShowBackgroundImage(true);
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
      {/* Exit Button */}
      <Button
        onClick={handleExit}
        style={{
          position: 'absolute',
          top: '20px',
          left: '20px',
          fontSize: '24px',
          padding: '15px 30px',
          height: 'auto',
          backgroundColor: '#ff4d4f',
          color: 'white',
          fontWeight: 'bold',
          borderRadius: '8px',
          zIndex: 1000,
          border: 'none'
        }}
      >
        {t('SAAS.EXIT') || 'Exit'}
      </Button>

      {/* Welcome */}
      <Row style={{ marginBottom: '40px' }}>
        <Col span={24}>
          <h1 style={{
            fontSize: '72px',
            color: 'white',
            marginBottom: '20px',
            fontWeight: 'bold'
          }}>
            {t('SAAS.HOLD.HOLD_INSTRUCTIONS', { patron: patronId })}
          </h1>
        </Col>
      </Row>

      {/* No Items */}
      {patronLockers.length === 0 && (
        <Row justify="center" style={{ marginTop: '60px' }}>
          <Col>
            <Card style={{
              textAlign: 'center',
              padding: '40px',
              borderRadius: '12px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              backgroundColor: 'rgba(200,200,200,0.5)'
            }}>
              <h2 style={{ fontSize: '48px', color: 'white', marginBottom: '20px', fontWeight: 'bold' }}>
                No Hold Items Found
              </h2>
              <p style={{ fontSize: '32px', color: 'white', marginBottom: '30px', fontWeight: 'bold' }}>
                Locker has no holds for patron {patronId}
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

      {/* Locker Cards */}
      {patronLockers.length > 0 && (
        <div style={{ marginTop: '40px', display: 'flex', flexDirection: 'column', gap: '24px', alignItems: 'center' }}>
          {patronLockers.map((locker, index) => (
            <Card
              key={index}
              title={
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%'
                }}>
                  <div style={{ fontSize: '56px', fontWeight: 'bold', color: 'white', textShadow: '2px 2px 4px rgba(0,0,0,0.3)' }}>
                    Locker #{locker.doorNumber}
                  </div>
                  <div style={{ flex: '1', display: 'flex', justifyContent: 'center' }}>
                    {doorStatuses.value[locker.doorNumber]?.open ? (
                      <div style={{ fontSize: '32px', padding: '12px 24px', fontWeight: 'bold', color: '#166534', textShadow: '1px 1px 2px rgba(0,0,0,0.2)' }}>
                        Door open
                      </div>
                    ) : (
                      <div style={{ fontSize: '32px', padding: '12px 24px', fontWeight: 'bold', color: '#ef4444', textShadow: '1px 1px 2px rgba(0,0,0,0.2)' }}>
                        Door Closed
                      </div>
                    )}
                  </div>
                  <Button
                    size="large"
                    icon={<ReloadOutlined />}
                    onClick={() => handleReopenDoor(locker.doorNumber)}
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
                    Re-open Door
                  </Button>
                </div>
              }
              style={{
                backgroundColor: 'rgba(200,200,200,0.5)',
                boxShadow: '0 8px 32px 0 rgba(31, 38, 135, 0.37)',
                borderRadius: '40px',
                width: '90%',
                maxWidth: '1400px',
                border: '1px solid rgba(255, 255, 255, 0.18)'
              }}
              styles={{
                body: { padding: '40px' },
                header: {
                  backgroundColor: 'transparent',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.2)'
                }
              }}
            >
              <div style={{ textAlign: 'left' }}>
                <Space direction="vertical" size="small" style={{ width: '100%' }}>
                  {locker.itemIds.length > 0 ? (
                    locker.itemIds.map((itemId: string, idx: number) => (
                      <div key={idx} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '16px',
                        padding: '6px 0'
                      }}>
                        <div style={{ fontSize: '32px', fontWeight: 'bold', color: 'white', minWidth: '140px', textShadow: '1px 1px 2px rgba(0,0,0,0.3)' }}>
                          Title {idx + 1}:
                        </div>
                        <Tag style={{
                          fontSize: '40px',
                          padding: '20px 40px',
                          borderRadius: '32px',
                          backgroundColor: SEBlue.value,
                          color: 'white',
                          border: 'none',
                          fontWeight: 'bold'
                        }}>
                          {itemId}
                        </Tag>
                        {itemStatuses.value[locker.doorNumber]?.[itemId] ? (
                          <div style={{ fontSize: '28px', padding: '10px 20px', marginLeft: '12px', color: 'white', fontWeight: 'bold', textShadow: '1px 1px 2px rgba(0,0,0,0.3)' }}>
                            ✓ Checked out
                          </div>
                        ) : (
                          <div style={{ fontSize: '28px', padding: '10px 20px', marginLeft: '12px', color: 'white', fontWeight: 'bold', textShadow: '1px 1px 2px rgba(0,0,0,0.3)' }}>
                            On Hold
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <span style={{ color: '#999', fontSize: '28px' }}>No items</span>
                  )}
                </Space>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Controls */}
      <ZoomLanguageControls
        showTimer={true}
        showLanguageButton={false}
        timer={timer}
        onTimerClick={handleExit}
        onZoomIn={() => {}}
        onZoomOut={() => {}}
        onLanguageClick={() => {}}
      />

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
