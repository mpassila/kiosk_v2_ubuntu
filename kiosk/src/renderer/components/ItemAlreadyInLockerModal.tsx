import React, { useState, useEffect, useRef } from 'react';
import { Button } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { getTextStyle, SEBlue } from '../state/shared';

interface ItemAlreadyInLockerModalProps {
  visible: boolean;
  itemId: string;
  doorNumber: number;
  onClose: () => void;
  onStaffAccess: () => void;
  onPatronScan: () => void;
}

export default function ItemAlreadyInLockerModal({
  visible,
  itemId,
  doorNumber,
  onClose,
  onStaffAccess,
  onPatronScan
}: ItemAlreadyInLockerModalProps) {
  const { t } = useTranslation();
  const [countdown, setCountdown] = useState(30);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (visible) {
      setCountdown(30);
      timerRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(timerRef.current!);
            onClose();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      backgroundColor: 'white',
      zIndex: 2000,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: '20px 30px',
    }}>
      {/* Top: Header + Item Info */}
      <div style={{ textAlign: 'center' }}>
        <InfoCircleOutlined style={{ fontSize: '60px', color: SEBlue.value }} />
        <h2 style={{ ...getTextStyle({ fontSize: '52px', fontWeight: 'bold', color: SEBlue.value, margin: '5px 0' }) }}>
          {t('ITEM_ALREADY_IN_LOCKER.TITLE', 'Item Already in Locker')}
        </h2>
        <div style={{ backgroundColor: '#f0f2f5', borderRadius: '8px', padding: '15px', marginTop: '10px' }}>
          <span style={{ ...getTextStyle({ fontSize: '48px', color: SEBlue.value }) }}>
            <span style={{ fontWeight: 'bold', color: SEBlue.value }}>{itemId}</span> is at locker #{doorNumber}
          </span>
        </div>
      </div>

      {/* Middle: Staff and Patron side by side */}
      <div style={{ display: 'flex', gap: '20px', flex: 1, margin: '15px 0', minHeight: 0 }}>
        {/* Staff */}
        <div style={{
          flex: 1,
          border: `3px solid ${SEBlue.value}`,
          borderRadius: '8px',
          padding: '15px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center',
        }}>
          <h3 style={{ ...getTextStyle({ fontSize: '44px', fontWeight: 'bold', color: SEBlue.value, margin: '0 0 10px 0' }) }}>
            {t('ITEM_ALREADY_IN_LOCKER.STAFF_SECTION', 'For Staff Members')}
          </h3>
          <p style={{ ...getTextStyle({ fontSize: '34px', color: SEBlue.value, margin: '0 0 15px 0' }) }}>
            {t(
              'ITEM_ALREADY_IN_LOCKER.STAFF_MESSAGE',
              'This item is already registered in the locker system. Click below to access the admin view and open the door.'
            )}
          </p>
          <Button
            type="primary"
            size="large"
            onClick={onStaffAccess}
            style={{ ...getTextStyle({ fontSize: '38px', height: 'auto', padding: '15px 40px' }) }}
          >
            {t('ITEM_ALREADY_IN_LOCKER.ADMIN_ACCESS', 'Access Admin View & Open Door')}
          </Button>
        </div>

        {/* Patron */}
        <div style={{
          flex: 1,
          border: '3px solid #52c41a',
          borderRadius: '8px',
          padding: '15px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center',
        }}>
          <h3 style={{ ...getTextStyle({ fontSize: '44px', fontWeight: 'bold', color: '#52c41a', margin: '0 0 10px 0' }) }}>
            {t('ITEM_ALREADY_IN_LOCKER.PATRON_SECTION', 'For Patrons')}
          </h3>
          <p style={{ ...getTextStyle({ fontSize: '34px', color: SEBlue.value, margin: '0 0 15px 0' }) }}>
            {t(
              'ITEM_ALREADY_IN_LOCKER.PATRON_MESSAGE',
              'Your hold item is ready for pickup. Please scan your library card to collect it.'
            )}
          </p>
          <Button
            type="default"
            size="large"
            onClick={onPatronScan}
            style={{
              ...getTextStyle({ fontSize: '38px', height: 'auto', padding: '15px 40px' }),
              backgroundColor: '#52c41a',
              color: 'white',
              borderColor: '#52c41a'
            }}
          >
            {t('ITEM_ALREADY_IN_LOCKER.SCAN_CARD', 'Scan Library Card')}
          </Button>
        </div>
      </div>

      {/* Bottom: Close */}
      <div style={{ textAlign: 'center' }}>
        <Button size="large" onClick={onClose} type="primary" danger style={{ ...getTextStyle({ fontSize: '40px', height: 'auto', padding: '15px 80px' }) }}>
          {t('COMMON.CLOSE', 'Close')} ({countdown})
        </Button>
      </div>
    </div>
  );
}
