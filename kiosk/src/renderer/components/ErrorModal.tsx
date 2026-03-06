import React, { useEffect, useRef, useState } from 'react';
import { Modal, Button, Badge } from 'antd';
import {
  CloseCircleOutlined,
  WarningOutlined,
  InfoCircleOutlined,
  CheckCircleOutlined
} from '@ant-design/icons';

type SeverityType = 'error' | 'warning' | 'info' | 'success';

interface ErrorModalProps {
  open: boolean;
  onClose: () => void;
  severity?: SeverityType;
  title: string;
  body: string | React.ReactNode;
  footer?: string | React.ReactNode;
  timer?: number; // in seconds, default 5s
}

const ErrorModal: React.FC<ErrorModalProps> = ({
  open,
  onClose,
  severity = 'error',
  title,
  body,
  footer,
  timer = 5
}) => {
  const [countdown, setCountdown] = useState(timer);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const countRef = useRef<number>(timer);

  const resetTimer = () => {
    countRef.current = timer;
    setCountdown(timer);
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
          setCountdown(countRef.current);
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
  }, [open, timer]);

  // Get severity-specific colors and icons
  const getSeverityConfig = () => {
    switch (severity) {
      case 'error':
        return {
          color: '#ff4d4f',
          bgColor: '#fff1f0',
          icon: <CloseCircleOutlined style={{ fontSize: '64px', color: '#ff4d4f' }} />
        };
      case 'warning':
        return {
          color: '#faad14',
          bgColor: '#fffbe6',
          icon: <WarningOutlined style={{ fontSize: '64px', color: '#faad14' }} />
        };
      case 'info':
        return {
          color: '#1890ff',
          bgColor: '#e6f7ff',
          icon: <InfoCircleOutlined style={{ fontSize: '64px', color: '#1890ff' }} />
        };
      case 'success':
        return {
          color: '#52c41a',
          bgColor: '#f6ffed',
          icon: <CheckCircleOutlined style={{ fontSize: '64px', color: '#52c41a' }} />
        };
      default:
        return {
          color: '#ff4d4f',
          bgColor: '#fff1f0',
          icon: <CloseCircleOutlined style={{ fontSize: '64px', color: '#ff4d4f' }} />
        };
    }
  };

  const config = getSeverityConfig();

  return (
    <Modal
      title={
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          width: '100%',
          backgroundColor: config.color,
          padding: '10px 20px',
          margin: '-20px -24px 0 -24px'
        }}>
          <span style={{
            color: '#fff',
            fontSize: '32px',
            fontWeight: 'bold',
            flex: 1,
            textAlign: 'center'
          }}>
            {title}
          </span>
          <Badge
            count={countdown}
            showZero
            style={{
              backgroundColor: countdown <= 3 ? '#fff' : config.color,
              color: countdown <= 3 ? config.color : '#fff',
              fontSize: '24px',
              minWidth: '50px',
              height: '50px',
              lineHeight: '50px',
              borderRadius: '25px',
              fontWeight: 'bold',
              border: `3px solid ${countdown <= 3 ? config.color : '#fff'}`
            }}
          />
        </div>
      }
      footer={
        <div style={{ textAlign: 'center' }}>
          {footer && (
            <div style={{
              fontSize: '18px',
              marginBottom: '16px',
              color: '#666'
            }}>
              {footer}
            </div>
          )}
          <Button
            size='large'
            style={{
              backgroundColor: config.color,
              fontSize: '24px',
              padding: '12px 40px',
              color: '#fff',
              height: 'auto',
              fontWeight: 'bold',
              border: 'none'
            }}
            type="primary"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      }
      open={open}
      onOk={onClose}
      onCancel={onClose}
      width='80%'
      centered
      closable={false}
      maskClosable={false}
      styles={{
        body: {
          padding: '40px',
          minHeight: '200px'
        }
      }}
    >
      <div style={{ textAlign: 'center' }} onClick={resetTimer}>
        {/* Icon */}
        <div style={{ marginBottom: '24px' }}>
          {config.icon}
        </div>

        {/* Body */}
        <div style={{
          backgroundColor: config.bgColor,
          padding: '24px',
          borderRadius: '8px',
          border: `2px solid ${config.color}`,
          fontSize: '20px',
          lineHeight: '1.6',
          color: '#333'
        }}>
          {body}
        </div>
      </div>
    </Modal>
  );
};

export default ErrorModal;
