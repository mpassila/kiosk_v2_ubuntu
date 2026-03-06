import React from 'react';

import { useRef, useState, useEffect, CSSProperties } from 'react';
import { useLocation } from 'wouter';
import { sessionLang, updateLang, updateLocation, updateShowBackgroundImage } from "../state/shared";
import { Promise } from "bluebird";
import { useTranslation } from 'react-i18next';
import { ToastContainer } from 'react-toastify';
import { Spin } from 'antd';
import { sessionIsReady, sessionError, sessionDevice, sessionLicenseId, sessionDeviceId, sessionBranch, kioskConfig } from "../state/shared";
import { useSignals } from "@preact/signals-react/runtime";
import { ref, set } from 'firebase/database';
import { getLicenseDatabase } from '../state/firebase-client';

export default function ErrorPage() {
  useSignals();
  updateLocation('/error')
  updateShowBackgroundImage(true);

  function stopVideo() {
    const video: any = document.getElementById('welcomevideo');
    if (video) {
      video.pause();
    }
  }
  setTimeout(() => {
    stopVideo()
  }, 100);

  const isReady = sessionIsReady.value;
  const [loading, setLoading] = useState(false);
  const [, setLocation] = useLocation()
  const { t } = useTranslation();
  const timerForErrorView = sessionDevice.value?.settings?.timerForErrorView || 5;
  const [timer, setTimer] = useState(timerForErrorView);
  const errorMessage = sessionError.value?.message || '';

  // Create RTDB message when error page loads
  useEffect(() => {
    const createErrorMessage = async () => {
      try {
        const licenseId = sessionLicenseId.value;
        if (!licenseId) {
          console.warn('Cannot create error message: no licenseId');
          return;
        }

        const now = new Date();
        const timestamp = Date.now();
        const messageId = Math.floor(timestamp / 1000).toString();
        const deviceId = sessionDeviceId.value || kioskConfig.value?.device?.id || 'unknown';
        const branch = sessionBranch.value;
        const branchName = branch?.name || 'Unknown';
        const branchId = branch?.id || 'unknown';
        const errorText = errorMessage || 'Unknown error';

        const message = {
          id: messageId,
          from: sessionDevice.value?.settings?.name || sessionDevice.value?.name || `Kiosk ${deviceId}`,
          subject: 'Kiosk Error',
          date: now.toISOString().split('T')[0],
          time: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
          status: 'unread',
          preview: errorText.substring(0, 100),
          message: errorText,
          content: errorText,
          timestamp,
          priority: 'high',
          messageType: 'device',
          branches: [branchName],
          branchIds: [branchId],
          location: branchName,
          locations: [branchName],
          deviceIds: [deviceId],
        };

        const licenseDb = getLicenseDatabase(licenseId);
        const messageRef = ref(licenseDb, `license_${licenseId}/messages/${messageId}`);
        await set(messageRef, message);
        console.log('Error message created in RTDB:', messageId);
      } catch (err) {
        console.error('Failed to create error message in RTDB:', err);
      }
    };

    createErrorMessage();
  }, []);

  const [color] = useState('#ffffff');

  const override: CSSProperties = {
    display: 'block',
    margin: '0 auto',
    borderColor: 'blue',
  };

  (async function ticktock() {
    Promise.delay(1000).then(() => {
      if (isReady && timer > 0) {
        const timerval = timer - 1;
        setTimer(timerval);
      } else {
        setTimer(timerForErrorView);
        setLocation('/');
      }
    })
  })();

  const stylePage: React.CSSProperties = {
    overflow: 'auto',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    minHeight: '100vh',
  };

  const card3DStyle: React.CSSProperties = {
    background: 'linear-gradient(145deg, #ffffff 0%, #f0f0f0 100%)',
    borderRadius: '36px',
    padding: '90px 120px',
    boxShadow: `
      0 40px 80px -20px rgba(0, 0, 0, 0.5),
      0 20px 40px -12px rgba(0, 0, 0, 0.3),
      inset 0 -4px 0 rgba(0, 0, 0, 0.1),
      inset 0 4px 0 rgba(255, 255, 255, 0.8),
      0 0 0 1px rgba(255, 255, 255, 0.1)
    `,
    transform: 'perspective(1000px) rotateX(2deg)',
    transformStyle: 'preserve-3d',
    transition: 'all 0.3s ease',
    position: 'relative',
    overflow: 'hidden',
    maxWidth: '900px',
    width: '90%',
    textAlign: 'center',
  };

  const iconContainerStyle: React.CSSProperties = {
    width: '180px',
    height: '180px',
    margin: '0 auto 45px',
    background: timer <= 2
      ? 'linear-gradient(135deg, #ff4d4f 0%, #cf1322 100%)'
      : 'linear-gradient(135deg, #faad14 0%, #d48806 100%)',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: timer <= 2
      ? '0 15px 45px rgba(207, 19, 34, 0.4), inset 0 -6px 0 rgba(0, 0, 0, 0.2), inset 0 6px 0 rgba(255, 255, 255, 0.3)'
      : '0 15px 45px rgba(212, 136, 6, 0.4), inset 0 -6px 0 rgba(0, 0, 0, 0.2), inset 0 6px 0 rgba(255, 255, 255, 0.3)',
    transform: 'translateZ(30px)',
    transition: 'all 0.3s ease',
  };

  const titleStyle: React.CSSProperties = {
    fontSize: '54px',
    fontWeight: 700,
    color: '#2d3748',
    marginBottom: '24px',
    textShadow: '0 3px 6px rgba(0, 0, 0, 0.1)',
    letterSpacing: '-0.5px',
  };

  const timerStyle: React.CSSProperties = {
    fontSize: '140px',
    fontWeight: 700,
    color: timer <= 2 ? '#ff4d4f' : '#1890ff',
    lineHeight: 1,
    marginBottom: '20px',
    transition: 'color 0.3s ease',
  };

  const subtitleStyle: React.CSSProperties = {
    fontSize: '27px',
    color: '#718096',
    marginBottom: '0',
    lineHeight: 1.6,
  };

  const pulseAnimation: React.CSSProperties = {
    animation: 'pulse 2s ease-in-out infinite',
  };

  return (
    <>
      <style>
        {`
          @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
          }
          @keyframes float {
            0%, 100% { transform: perspective(1000px) rotateX(2deg) translateY(0); }
            50% { transform: perspective(1000px) rotateX(2deg) translateY(-10px); }
          }
          .error-card {
            animation: float 4s ease-in-out infinite;
          }
          .error-card:hover {
            transform: perspective(1000px) rotateX(0deg) translateY(-5px) !important;
            box-shadow:
              0 35px 60px -15px rgba(0, 0, 0, 0.5),
              0 20px 40px -10px rgba(0, 0, 0, 0.3),
              inset 0 -3px 0 rgba(0, 0, 0, 0.1),
              inset 0 3px 0 rgba(255, 255, 255, 0.8),
              0 0 0 1px rgba(255, 255, 255, 0.1) !important;
          }
        `}
      </style>
      <div className="sweet-loading" style={stylePage}>
        <Spin size="large" spinning={loading} />

        {loading ? (
          ''
        ) : (
          <div className="error-card" style={card3DStyle}>
            {/* Icon */}
            <div style={iconContainerStyle}>
              <svg
                width="90"
                height="90"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={pulseAnimation}
              >
                <polygon points="12 2 22 22 2 22" />
                <line x1="12" y1="9" x2="12" y2="15" />
                <line x1="12" y1="18" x2="12.01" y2="18" />
              </svg>
            </div>

            {/* Title */}
            <h1 style={titleStyle}>
              {t('ERROR.VIEW', { defaultValue: 'Something went wrong' })}
            </h1>

            {/* Error message */}
            {errorMessage && (
              <p style={{
                fontSize: '30px',
                color: '#4a5568',
                marginBottom: '30px',
                lineHeight: 1.5,
                padding: '0 20px',
              }}>
                {t(errorMessage, { defaultValue: errorMessage })}
              </p>
            )}

            {/* Timer */}
            <div style={timerStyle}>
              {timer}
            </div>


            {/* Decorative bottom bar */}
            <div style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: '9px',
              background: timer <= 2
                ? 'linear-gradient(90deg, #ff4d4f 0%, #faad14 50%, #ff4d4f 100%)'
                : 'linear-gradient(90deg, #faad14 0%, #1890ff 50%, #faad14 100%)',
              borderRadius: '0 0 36px 36px',
              transition: 'background 0.3s ease',
            }} />
          </div>
        )}

        <ToastContainer
          style={{ zIndex: 1 }}
          position="top-center"
          autoClose={2000}
          hideProgressBar
          newestOnTop={false}
          closeOnClick
          rtl={false}
          pauseOnFocusLoss={false}
          draggable={false}
          pauseOnHover={false}
          theme="light"
        />
      </div>
    </>
  );
}
