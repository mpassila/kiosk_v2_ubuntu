import React, { useEffect, useRef, useState } from 'react';
import { Modal, Button, Card, Row, Col, Avatar, Badge } from 'antd';
import { CheckOutlined } from '@ant-design/icons';
import { getTextStyle, SEBlue } from '../state/shared';

interface LanguageModalProps {
  open: boolean;
  onClose: () => void;
  languages: any[]; // Array of language objects with { key, lang, name, icon }
  currentLanguage: string;
  onLanguageChange: (lang: string) => void;
  title?: string;
  modalConfig?: {
    fullScreen?: boolean;
    title?: React.ReactNode;
    content?: React.ReactNode;
  };
}

const LanguageModal: React.FC<LanguageModalProps> = ({
  open,
  onClose,
  languages,
  currentLanguage,
  onLanguageChange,
  title = "Change session language",
  modalConfig
}) => {
  const [timer, setTimer] = useState(20);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const countRef = useRef<number>(20);

  const handleLanguageSelect = (lang: string) => {
    onLanguageChange(lang);
    setTimeout(() => onClose(), 300);
  };

  const resetTimer = () => {
    countRef.current = 20;
    setTimer(20);
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

  // If 4 or fewer languages, show one per row (span 24)
  // If more than 4, show 2 per row (span 12)
  const colSpan = languages.length <= 4 ? 24 : 12;

  const renderLanguages = languages.map((input: any) => {
    // Use langKey (input.key or input.lang) for comparison
    const isSelectedLang = currentLanguage === input.key || currentLanguage === input.lang;
    const selectedStyle: React.CSSProperties = {
      border: isSelectedLang ? '4px solid #42A4DE' : '2px solid #d9d9d9',
      padding: '30px 40px',
      borderRadius: '16px',
      cursor: 'pointer',
      boxShadow: isSelectedLang ? '0 6px 16px rgba(66, 164, 222, 0.3)' : '0 2px 8px rgba(0, 0, 0, 0.1)',
      backgroundColor: isSelectedLang ? '#f0f8ff' : 'white',
      transition: 'all 0.3s ease',
      minHeight: '180px',
      display: 'flex',
      alignItems: 'center'
    };

    return (
      <Col key={input.key} span={colSpan}>
        <Card
          style={selectedStyle}
          onClick={() => handleLanguageSelect(input.lang)}
          hoverable
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '30px' }}>
            <Avatar
              shape="square"
              size={120}
              src={input.icon}
              style={{ minWidth: 120 }}
            />
            {isSelectedLang && (
              <CheckOutlined
                style={{
                  color: '#42A4DE',
                  fontSize: '64px',
                  fontWeight: 'bold'
                }}
              />
            )}
            <span style={{
              color: '#42A4DE',
              fontSize: '48px',
              fontWeight: 'bold',
              flex: 1
            }}>
              {input.name}
            </span>
          </div>
        </Card>
      </Col>
    );
  });

  return (
    <Modal
      title={
        modalConfig?.title || (
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%'}}>
            <span style={{color: '#42A4DE', fontSize: '32px', fontWeight: 'bold', flex: 1, textAlign: 'center'}}>
              {title}
            </span>
            <Badge
              count={timer}
              showZero
              style={{
                backgroundColor: timer <= 3 ? '#ff4d4f' : SEBlue.value,
                fontSize: '28px',
                minWidth: '60px',
                height: '60px',
                lineHeight: '60px',
                borderRadius: '30px',
                fontWeight: 'bold'
              }}
            />
          </div>
        )
      }
      centered
      footer={modalConfig?.fullScreen ? null : (
        <Button
          size='large'
          style={{
            backgroundColor: '#42A4DE',
            fontSize: '48px',
            padding: '40px 80px',
            color: 'white',
            height: 'auto',
            fontWeight: 'bold'
          }}
          type="primary"
          onClick={onClose}
        >
          Close
        </Button>
      )}
      open={open}
      onOk={onClose}
      onCancel={onClose}
      width={modalConfig?.fullScreen ? '100%' : '90%'}
      style={modalConfig?.fullScreen ? {top: 0, maxWidth: '100%', paddingBottom: 0} : {}}
      styles={modalConfig?.fullScreen ? { body: {height: 'calc(100vh - 55px)', padding: 0} } : {}}
    >
      {modalConfig?.content || (
        <Card style={{padding: '20px', height: window.innerHeight * 0.8}} onClick={resetTimer}>
          <Row gutter={[24, 24]}>
            {renderLanguages}
          </Row>
        </Card>
      )}
    </Modal>
  );
};

export default LanguageModal;
