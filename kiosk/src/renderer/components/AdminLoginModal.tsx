import React, { useRef, useEffect, useState } from 'react';
import { Modal, Card, Row, Col, Input, Button, Badge } from 'antd';
import { useTranslation } from 'react-i18next';
import LoginKeyboard from './LoginKeyboard';
import { getTextStyle, SEBlue, customToast } from '../state/shared';

interface AdminLoginModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  customStaffPin: string;
}

const AdminLoginModal: React.FC<AdminLoginModalProps> = ({ open, onClose, onSuccess, customStaffPin }) => {
  const { t } = useTranslation();
  const [adminPIN, setAdminPIN] = useState('');
  const [adminLayout, setAdminLayout] = useState('default');
  const [adminModalTimer, setAdminModalTimer] = useState(10);
  const adminPinInputRef = useRef<any>(null);
  const adminModalTimerRef = useRef<NodeJS.Timeout | null>(null);
  const timerCountRef = useRef<number>(10);
  const keyboard = useRef<any>();

  // Reset timer to 10 seconds (just reset the ref, timer loop handles display)
  const resetTimer = () => {
    timerCountRef.current = 10;
  };

  // Admin keyboard handlers (virtual keyboard)
  const onAdminPINKeyPress = (button: string) => {
    resetTimer();
    if (button === "{shift}") {
      setAdminLayout(adminLayout === "default" ? "shift" : "default");
    }
  };

  // Process admin login
  const processAdminLogin = () => {
    if (adminPIN === customStaffPin) {
      console.log('✅ Admin PIN correct - granting access');
      setAdminPIN('');
      onSuccess();
    } else {
      console.log('❌ Admin PIN incorrect');
      customToast(() => (<b>Invalid PIN</b>), 2000, 'default', 'white');
      setAdminPIN('');
    }
  };

  // Handle modal open/close
  useEffect(() => {
    if (open) {
      // Reset state when modal opens
      timerCountRef.current = 10;
      setAdminModalTimer(10);
      setAdminPIN('');
      setAdminLayout('default');
      keyboard.current?.clearInput();

      // Focus input after modal renders
      const focusTimeout = setTimeout(() => {
        adminPinInputRef.current?.focus();
      }, 150);

      // Start countdown timer
      adminModalTimerRef.current = setInterval(() => {
        if (timerCountRef.current > 0) {
          timerCountRef.current -= 1;
          setAdminModalTimer(timerCountRef.current);
        } else {
          console.log('⏱️ Admin modal timeout expired - closing modal');
          onClose();
        }
      }, 1000);

      return () => {
        clearTimeout(focusTimeout);
        if (adminModalTimerRef.current) {
          clearInterval(adminModalTimerRef.current);
          adminModalTimerRef.current = null;
        }
      };
    } else {
      // Clean up when modal closes
      if (adminModalTimerRef.current) {
        clearInterval(adminModalTimerRef.current);
        adminModalTimerRef.current = null;
      }
      setAdminPIN('');
      setAdminLayout('default');
      keyboard.current?.clearInput();
    }
  }, [open]);

  // Handle PIN input change
  const handlePINChange = (value: string) => {
    setAdminPIN(value);
    resetTimer(); // Reset timer on any input
  };

  return (
    <Modal
      title={
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%'}}>
          <span style={{...getTextStyle({color: SEBlue.value}, 15), fontWeight: 'bold', flex: 1, textAlign: 'center'}}>
            {t('SAAS.ENTER_ADMIN_PIN_DESCRIPTION')}
          </span>
          <Badge
            count={adminModalTimer}
            showZero
            style={{
              ...getTextStyle({}, 10),
              backgroundColor: adminModalTimer <= 3 ? '#ff4d4f' : SEBlue.value,
              fontSize: '24px',
              minWidth: '50px',
              height: '50px',
              lineHeight: '50px',
              borderRadius: '25px'
            }}
          />
        </div>
      }
      footer={null}
      open={open}
      onOk={onClose}
      onCancel={onClose}
      closable={false}
      width="calc(100% - 20px)"
      style={{
        top: '20px',
        maxWidth: 'calc(100% - 40px)',
        paddingBottom: '20px',
        margin: '0 20px'
      }}
      styles={{
        body: {
          padding: 0
        }
      }}
    >
      <Card style={{
        padding: '10px',
        display: 'flex',
        flexDirection: 'column',
        border: 'none',
        position: 'relative'
      }}>
        <Row gutter={[20, 15]} style={{marginTop: '10px', marginBottom: '10px', flex: '0 0 auto'}}>
          <Col span={16} offset={4}>
            <div style={{...getTextStyle({color: SEBlue.value, textAlign: 'center', marginBottom: '5px'}, 15)}}>
              {t('SAAS.ENTER_ADMIN_PIN')}
            </div>
          </Col>
          <Col span={16} offset={4}>
            <Input.Password
              ref={adminPinInputRef}
              autoFocus
              onChange={(e) => handlePINChange(e.target.value)}
              placeholder={t('SAAS.ENTER_ADMIN_PIN')}
              style={{fontSize: '36px', padding: '15px', color: SEBlue.value, textAlign: 'center'}}
              value={adminPIN}
              visibilityToggle={false}
              onPressEnter={() => {
                if (adminPIN.length >= 4) {
                  onClose();
                  processAdminLogin();
                }
              }}
            />
          </Col>
          <Col span={8} offset={4}>
            <Button
              block
              size='large'
              style={{
                ...getTextStyle({fontSize: '32px', padding: '15px'}, 15),
                height: 'auto'
              }}
              onClick={() => {
                onClose();
                setTimeout(() => window.location.reload(), 100);
              }}
            >
              {t('CANCEL')}
            </Button>
          </Col>
          <Col span={8}>
            <Button
              block
              size='large'
              style={{
                ...getTextStyle({backgroundColor: '#42A4DE', fontSize: '32px', padding: '15px', color: 'white'}, 15),
                height: 'auto'
              }}
              type="primary"
              onClick={() => {
                onClose();
                processAdminLogin();
              }}
              disabled={adminPIN.length < 4}
            >
              {t('SAAS.LOTIN')}
            </Button>
          </Col>
        </Row>
        <LoginKeyboard
          ref={keyboard}
          layoutName={adminLayout}
          onChange={handlePINChange}
          onKeyPress={onAdminPINKeyPress}
          numericOnly={true}
          inModal={true}
        />
      </Card>
    </Modal>
  );
};

export default AdminLoginModal;
