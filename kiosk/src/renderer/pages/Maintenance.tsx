import React from 'react';

import { useRef, useEffect, useState, CSSProperties } from 'react';
import { Table, Row, Col, Button, Flex, Card} from 'antd';
import _ from 'lodash';
import { useLocation } from 'wouter';
import { sessionTimer, updateSessionTimer, updateLocation, sessionBackgroundImage, sessionDevice } from "../state/shared";
import * as style from '../App.styles';
// eslint-disable-next-line import/order
import { useTranslation } from 'react-i18next';
import { toast, ToastContainer } from 'react-toastify';
import { Spin } from 'antd';
import { Promise } from "bluebird";
import { useSignals } from "@preact/signals-react/runtime";

export default function MaintenancePage() {
  useSignals();
  updateLocation('/maintenance')
  const [loading, setLoading] = useState(false);
  const [location, setLocation] = useLocation()
  const [runOnce, setrunOnce] = useState(true)

  const { i18n, t } = useTranslation();
  const style2: React.CSSProperties = {
    zIndex: 1,
  };

  const stylePage: React.CSSProperties = {
    overflow: 'auto',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
    minHeight: '100vh',
  };

  const [color] = useState('#ffffff');

  const override: CSSProperties = {
    display: 'block',
    margin: '0 auto',
    borderColor: 'blue',
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
    background: 'linear-gradient(135deg, #f39c12 0%, #e67e22 100%)',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: `
      0 15px 45px rgba(243, 156, 18, 0.4),
      inset 0 -6px 0 rgba(0, 0, 0, 0.2),
      inset 0 6px 0 rgba(255, 255, 255, 0.3)
    `,
    transform: 'translateZ(30px)',
  };

  const titleStyle: React.CSSProperties = {
    fontSize: '54px',
    fontWeight: 700,
    color: '#2d3748',
    marginBottom: '24px',
    textShadow: '0 3px 6px rgba(0, 0, 0, 0.1)',
    letterSpacing: '-0.5px',
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
          .ooo-card {
            animation: float 4s ease-in-out infinite;
          }
          .ooo-card:hover {
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
          <div className="ooo-card" style={card3DStyle}>
            {/* 3D Icon - Wrench */}
            <div style={iconContainerStyle}>
              <svg
                width="90"
                height="90"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={pulseAnimation}
              >
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
              </svg>
            </div>

            {/* Title */}
            <h1 style={titleStyle}>
              {t('SAAS.DEVICE_MAINTENANCE', { defaultValue: 'Maintenance' })}
            </h1>

            {/* Subtitle */}
            <p style={subtitleStyle}>
              {sessionDevice.value?.deviceMaintenance?.maintenanceBreakMessage ||
               t('SAAS.DEVICE_MAINTENANCE_MESSAGE', { defaultValue: 'This device is under maintenance. Please try again later.' })}
            </p>

            {/* Scheduled maintenance time window */}
            {sessionDevice.value?.deviceMaintenance?.scheduledMaintenanceEnabled &&
             sessionDevice.value?.deviceMaintenance?.scheduledMaintenanceStart &&
             sessionDevice.value?.deviceMaintenance?.scheduledMaintenanceEnd && (
              <p style={{ fontSize: '22px', color: '#a0aec0', marginTop: '20px', lineHeight: 1.6 }}>
                {new Date(sessionDevice.value.deviceMaintenance.scheduledMaintenanceStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {' - '}
                {new Date(sessionDevice.value.deviceMaintenance.scheduledMaintenanceEnd).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}

            {/* Decorative bottom bar */}
            <div style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: '9px',
              background: 'linear-gradient(90deg, #f39c12 0%, #e67e22 50%, #f39c12 100%)',
              borderRadius: '0 0 36px 36px',
            }} />
          </div>
        )}

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
          theme="light"
        />
      </div>
    </>
  );
}
