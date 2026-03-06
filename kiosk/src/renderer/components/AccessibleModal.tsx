import React, { useEffect, useRef, useState } from 'react';
import { Modal, Button, Card, Row, Col, Badge } from 'antd';
import { getTextStyle, SEBlue, customToast } from '../state/shared';

interface AccessibleModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  device?: any;
  onDeviceUpdate?: (device: any) => void;
  onSettingsChange?: () => void; // Called when any setting changes
  onHighContrastChange?: (enabled: boolean) => void; // Called when high contrast specifically changes
  resetSettings?: boolean; // External signal to reset all settings
}

const AccessibleModal: React.FC<AccessibleModalProps> = ({
  open,
  onClose,
  title = "Accessibility Settings",
  device,
  onDeviceUpdate,
  onSettingsChange,
  onHighContrastChange,
  resetSettings = false
}) => {
  const [timer, setTimer] = useState(15);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const countRef = useRef<number>(15);

  const [highContrast, setHighContrast] = useState(false);
  const [largeText, setLargeText] = useState(false);
  const [extendedTimeout, setExtendedTimeout] = useState(false);

  // Reset all settings when resetSettings prop becomes true
  useEffect(() => {
    if (resetSettings) {
      console.log('🔄 Resetting accessibility settings to defaults');
      setHighContrast(false);
      setLargeText(false);
      setExtendedTimeout(false);
    }
  }, [resetSettings]);

  const resetTimer = () => {
    countRef.current = 15;
    setTimer(15);
  };

  const handleTimer = (keepGoing = true) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (keepGoing) {
      timerRef.current = setTimeout(() => {
        if (countRef.current > 0) {
          countRef.current = countRef.current - 1;
          setTimer(countRef.current);
          handleTimer(true);
        } else {
          onClose();
        }
      }, 1000);
    }
  };

  useEffect(() => {
    if (open) {
      resetTimer();
      handleTimer(true);

      return () => {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      };
    } else {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [open]);

  return (
    <Modal
      title={
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', backgroundColor: '#000', padding: '5px'}}>
          <span style={{color: '#fff', fontSize: '56px', fontWeight: 'bold', flex: 1, textAlign: 'center'}}>
            {title}
          </span>
          <Badge
            count={timer}
            showZero
            style={{
              backgroundColor: timer <= 3 ? '#ff4d4f' : '#fff',
              color: timer <= 3 ? '#fff' : '#000',
              fontSize: '48px',
              minWidth: '80px',
              height: '80px',
              lineHeight: '80px',
              borderRadius: '40px',
              fontWeight: 'bold',
              border: '2px solid #fff'
            }}
          />
        </div>
      }
      footer={
        <Button
          size='large'
          style={{
            backgroundColor: '#000',
            fontSize: '56px',
            padding: '12px 40px',
            color: '#fff',
            height: 'auto',
            fontWeight: 'bold',
            border: '3px solid #fff'
          }}
          type="primary"
          onClick={onClose}
        >
          Close
        </Button>
      }
      open={open}
      onOk={onClose}
      onCancel={onClose}
      width='calc(100% - 20px)'
      style={{
        position: 'fixed',
        top: 'auto',
        bottom: '100px',
        left: '10px',
        right: '10px',
        margin: 0,
        paddingBottom: 0
      }}
      styles={{
        body: {
          padding: '5px',
          maxHeight: '50vh',
          overflowY: 'hidden'
        }
      }}
      wrapClassName="accessible-modal-wrapper"
    >
      <style>{`
        .accessible-modal-wrapper .ant-modal-wrap {
          overflow: hidden !important;
        }
        body:has(.accessible-modal-wrapper) {
          overflow: hidden !important;
        }
        .accessible-modal-wrapper .ant-modal-mask {
          background-color: #000 !important;
        }
        .accessible-modal-wrapper .ant-modal {
          position: fixed !important;
          top: auto !important;
          bottom: 100px !important;
          left: 10px !important;
          right: 10px !important;
          margin: 0 !important;
          max-width: calc(100% - 20px) !important;
        }
      `}</style>
      <Card style={{padding: '5px', backgroundColor: '#000', border: '3px solid #fff'}} onClick={resetTimer}>
        <Row gutter={[8, 12]}>
          <Col span={24}>
            <Button
              size='large'
              style={{
                width: '100%',
                height: 'auto',
                padding: '16px 24px',
                backgroundColor: highContrast ? '#fff' : '#1a1a1a',
                borderRadius: '8px',
                border: highContrast ? '5px solid #42A4DE' : '3px solid #fff',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                textAlign: 'left'
              }}
              onClick={() => {
                const checked = !highContrast;
                setHighContrast(checked);
                if (device && onDeviceUpdate) {
                  const updatedDevice = {
                    ...device,
                    welcomeBackgroundColor: checked ? 'black' : (device.setting?.originalColor || device.welcomeBackgroundColor),
                    welcomeBackgroundImage: checked ? '' : (device.setting?.originalBackgroundImage || device.welcomeBackgroundImage),
                    setting: {
                      ...device.setting,
                      color: checked ? 'black' : (device.setting?.originalColor || 'default')
                    }
                  };
                  if (checked && !device.setting?.originalColor) {
                    updatedDevice.setting.originalColor = device.welcomeBackgroundColor || 'default';
                    updatedDevice.setting.originalBackgroundImage = device.welcomeBackgroundImage || '';
                  }
                  onDeviceUpdate(updatedDevice);
                  console.log('🎨 High Contrast Mode:', checked ? 'ON (black, no bg image)' : 'OFF (restored)', 'welcomeBackgroundColor:', updatedDevice.welcomeBackgroundColor, 'welcomeBackgroundImage:', updatedDevice.welcomeBackgroundImage);
                }
                if (onHighContrastChange) {
                  onHighContrastChange(checked);
                }
                if (onSettingsChange) {
                  onSettingsChange();
                }
              }}
            >
              <div style={{flex: 1}}>
                <div style={{fontSize: '48px', fontWeight: 'bold', color: highContrast ? '#000' : '#fff', marginBottom: '2px'}}>
                  {highContrast ? '✓ ' : ''}High Contrast Mode
                </div>
                <div style={{fontSize: '32px', color: highContrast ? '#333' : '#e0e0e0', fontWeight: '500'}}>
                  Increases contrast for better visibility
                </div>
              </div>
            </Button>
          </Col>

          <Col span={24}>
            <Button
              size='large'
              style={{
                width: '100%',
                height: 'auto',
                padding: '16px 24px',
                backgroundColor: largeText ? '#fff' : '#1a1a1a',
                borderRadius: '8px',
                border: largeText ? '5px solid #42A4DE' : '3px solid #fff',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                textAlign: 'left'
              }}
              onClick={() => {
                const checked = !largeText;
                setLargeText(checked);
                if (onSettingsChange) {
                  onSettingsChange();
                }
              }}
            >
              <div style={{flex: 1}}>
                <div style={{fontSize: '48px', fontWeight: 'bold', color: largeText ? '#000' : '#fff', marginBottom: '4px'}}>
                  {largeText ? '✓ ' : ''}Large Text Mode
                </div>
                <div style={{fontSize: '32px', color: largeText ? '#333' : '#e0e0e0', fontWeight: '500'}}>
                  Makes all text significantly larger
                </div>
              </div>
            </Button>
          </Col>

          <Col span={24}>
            <Button
              size='large'
              style={{
                width: '100%',
                height: 'auto',
                padding: '16px 24px',
                backgroundColor: extendedTimeout ? '#fff' : '#1a1a1a',
                borderRadius: '8px',
                border: extendedTimeout ? '5px solid #42A4DE' : '3px solid #fff',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                textAlign: 'left'
              }}
              onClick={() => {
                const checked = !extendedTimeout;
                setExtendedTimeout(checked);
                if (onSettingsChange) {
                  onSettingsChange();
                }
              }}
            >
              <div style={{flex: 1}}>
                <div style={{fontSize: '48px', fontWeight: 'bold', color: extendedTimeout ? '#000' : '#fff', marginBottom: '4px'}}>
                  {extendedTimeout ? '✓ ' : ''}Extended Timeout
                </div>
                <div style={{fontSize: '32px', color: extendedTimeout ? '#333' : '#e0e0e0', fontWeight: '500'}}>
                  Provides more time to complete actions
                </div>
              </div>
            </Button>
          </Col>

        </Row>
      </Card>
    </Modal>
  );
};

export default AccessibleModal;
