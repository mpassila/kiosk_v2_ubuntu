import React from 'react';
import { effect, useSignalEffect } from '@preact/signals-react'
import { signal } from '@preact/signals-react'
import { useEffect, useState, CSSProperties } from 'react';
import { Row, Col, Button, Avatar, Modal, Divider, Badge, Space, Card, Tabs, TabsProps, Checkbox, Input, Spin } from 'antd';
import _ from 'lodash';
import { sessionBarcode, sessionDevice, sessionLocation, updateLocation, updateSessionTimer, sessionTimer, updateSessionBarcode, updateFontSize, fontSize, updateFontSizeStorage, fontSizeStorage, showBackgroundImage, updateShowBackgroundImage, updateSessionBackgroundImage, SEBlue, isHandpickMode, customToast, persistDeviceManifestChanges, sessionBranch, sessionLicenseId, adminAutoOpenDoor } from "../state/shared";
import { useTranslation } from 'react-i18next';
import {AiOutlineClockCircle, AiOutlineMinusCircle, AiOutlinePlusCircle} from "react-icons/ai";
import {TbPackageExport} from "react-icons/tb";
import {MdOutlineCancel, MdOutlineRemoveCircleOutline, MdOutlineCheckCircle, MdOutlineCleaningServices} from "react-icons/md";
import {BiPackage} from "react-icons/bi";
import { toast, ToastContainer } from 'react-toastify';
import { useLocation } from 'wouter';
import { Promise } from "bluebird";
import { MdOutlineDoorBack} from "react-icons/md";
import { useSignals } from "@preact/signals-react/runtime";
import { openDoor, isDoorOpen as isDoorOpenIPC } from 'renderer/state/locker';
import { createReturnEnforceCheckinEvent } from 'renderer/state/transaction-service';
import { MdPersonSearch } from "react-icons/md";
import config from '../../../config';
import { rfidItemId } from 'renderer/state/rfid';
import { getTextStyle } from "../state/shared";
import { Meta } from 'antd/es/list/Item';
import { CloseOutlined } from '@ant-design/icons';
import { blockDevices } from 'systeminformation';
const currentBarcode = signal<string>('');
const setCurrentBarcode = (nro: string) => {
  currentBarcode.value = nro;
}

const previousBarcode = signal<string>('---');
const setPreviousBarcode = (nro: string) => {
  previousBarcode.value = nro;
}

// Polaris API endpoint
const POLARIS_API_BASE = 'https://polarisapi-be4ekemxaa-uc.a.run.app';

// Helper to parse .NET JSON date format "/Date(1795503599000-0700)/"
const parseNetDate = (dateString: string): Date | null => {
  if (!dateString) return null;
  const match = dateString.match(/\/Date\((\d+)([+-]\d{4})?\)\//);
  if (match) {
    const timestamp = parseInt(match[1], 10);
    return new Date(timestamp);
  }
  // Fallback to regular date parsing
  const parsed = new Date(dateString);
  return isNaN(parsed.getTime()) ? null : parsed;
};

// Pull List Content Component
const PullListContent: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [holds, setHolds] = useState<any[]>([]);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Function to fetch holds from API
  const fetchHoldsFromAPI = async () => {
    const licenseId = sessionLicenseId.value;
    const branchId = sessionBranch.value?.id;
    const logonBranchId = sessionBranch.value?.polarisSettings?.logonBranchId;

    if (!licenseId || !branchId || !logonBranchId) {
      throw new Error('Missing configuration: licenseId, branchId, or logonBranchId');
    }

    // Skip for demo licenses — Polaris API has no credentials for license 1 and 2
    if (licenseId === 1 || licenseId === 2 || licenseId === '1' || licenseId === '2') {
      throw new Error('Polaris API not available for demo licenses');
    }

    const url = `${POLARIS_API_BASE}/${licenseId}/${branchId}/patron/holds?branch=${encodeURIComponent(logonBranchId)}&branchtype=2&requeststatus=6`;
    console.log('📋 Fetching Polaris holds from:', url);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    const data = await response.json();
    console.log('📋 Polaris holds response:', data);

    if (data?.RequestPicklistRows) {
      // Filter to simplified view format and cache
      const simplifiedHolds = data.RequestPicklistRows.map((hold: any) => ({
        ExpirationDate: hold.ExpirationDate,
        HoldStatus: hold.HoldStatus,
        PickupBranch: hold.PickupBranch,
        BrowseTitle: hold.BrowseTitle,
        PatronID: hold.PatronID,
        PatronBarcode: hold.PatronBarcode,
        ItemBarcode: hold.ItemBarcode,
        ItemRecordID: hold.ItemRecordID,
        MaterialType: hold.MaterialType,
        ShelfLocationID: hold.ShelfLocationID,
        ShelfLocation: hold.ShelfLocation
      }));

      // Cache to localStorage
      const now = new Date().toISOString();
      localStorage.setItem('polarisHoldsList', JSON.stringify({
        holds: simplifiedHolds,
        fetchedAt: now,
        recordCount: data.RecordCount || simplifiedHolds.length
      }));

      return { holds: simplifiedHolds, fetchedAt: now };
    }

    return { holds: [], fetchedAt: new Date().toISOString() };
  };

  // Refresh handler
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const result = await fetchHoldsFromAPI();
      setHolds(result.holds);
      setLastFetched(result.fetchedAt);
      setError(null);
    } catch (err: any) {
      console.error('❌ Error refreshing holds:', err);
      setError(err.message || 'Failed to refresh holds');
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    const loadHolds = async () => {
      try {
        setLoading(true);
        setError(null);

        // First try to load from localStorage cache
        const cached = localStorage.getItem('polarisHoldsList');
        if (cached) {
          try {
            const cachedData = JSON.parse(cached);
            if (cachedData.holds && cachedData.holds.length > 0) {
              setHolds(cachedData.holds);
              setLastFetched(cachedData.fetchedAt);
              setLoading(false);
              console.log('📋 Loaded holds from cache:', cachedData.holds.length, 'items');
              return;
            }
          } catch (parseError) {
            console.warn('📋 Error parsing cached holds, fetching fresh data');
          }
        }

        // If no cache or empty, fetch from API
        const result = await fetchHoldsFromAPI();
        setHolds(result.holds);
        setLastFetched(result.fetchedAt);
      } catch (err: any) {
        console.error('❌ Error fetching holds:', err);
        setError(err.message || 'Failed to fetch holds');
      } finally {
        setLoading(false);
      }
    };

    loadHolds();
  }, []);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px' }}>
        <Spin size="large" />
        <p style={{ marginTop: '20px', ...getTextStyle({}) }}>Loading holds...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: '40px', color: '#ff4d4f' }}>
        <p style={getTextStyle({})}>Error: {error}</p>
      </div>
    );
  }

  if (holds.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '40px' }}>
        <p style={getTextStyle({})}>No holds found</p>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '15px' }}>
        <span style={getTextStyle({ fontSize: '36px', fontWeight: 'bold' })}>
          Total: {holds.length} items
        </span>
        {lastFetched && (
          <span style={getTextStyle({ fontSize: '24px', color: '#888' })}>
            (Updated: {new Date(lastFetched).toLocaleString()})
          </span>
        )}
        <Button
          type="primary"
          size="large"
          loading={isRefreshing}
          onClick={handleRefresh}
          style={{ marginLeft: 'auto', fontSize: '24px', height: '50px', padding: '0 30px' }}
        >
          Refresh
        </Button>
      </div>

      <div style={{ display: 'flex', fontWeight: 'bold', borderBottom: '2px solid #ccc', paddingBottom: '10px', marginBottom: '10px', gap: '10px' }}>
        <div style={{ flex: 1.5 }}><span style={getTextStyle({ fontSize: '40px', fontWeight: 'bold' })}>Title</span></div>
        <div style={{ flex: 1.5 }}><span style={getTextStyle({ fontSize: '40px', fontWeight: 'bold' })}>Item Barcode</span></div>
        <div style={{ flex: 1.5 }}><span style={getTextStyle({ fontSize: '40px', fontWeight: 'bold' })}>Patron Barcode</span></div>
        <div style={{ flex: 1 }}><span style={getTextStyle({ fontSize: '40px', fontWeight: 'bold' })}>Expires</span></div>
      </div>

      {holds.map((hold: any, index: number) => (
        <div
          key={index}
          style={{
            display: 'flex',
            padding: '8px 0',
            borderBottom: '1px solid #eee',
            backgroundColor: index % 2 === 0 ? '#fafafa' : 'white',
            gap: '10px',
            alignItems: 'center'
          }}
        >
          <div style={{ flex: 1.5 }}>
            <span style={getTextStyle({ fontSize: '40px' })} title={hold.BrowseTitle}>
              {hold.BrowseTitle ? (hold.BrowseTitle.length > 20 ? hold.BrowseTitle.substring(0, 20) + '...' : hold.BrowseTitle) : 'N/A'}
            </span>
          </div>
          <div style={{ flex: 1.5 }}>
            <span style={getTextStyle({ fontSize: '40px', fontFamily: 'monospace' })}>{hold.ItemBarcode || 'N/A'}</span>
          </div>
          <div style={{ flex: 1.5 }}>
            <span style={getTextStyle({ fontSize: '40px', fontFamily: 'monospace' })}>{hold.PatronBarcode || 'N/A'}</span>
          </div>
          <div style={{ flex: 1 }}>
            <span style={getTextStyle({ fontSize: '40px' })}>
              {hold.ExpirationDate ? (parseNetDate(hold.ExpirationDate)?.toLocaleDateString() || 'Invalid Date') : 'N/A'}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
};

// Fullscreen Door Grid Modal Component - defined outside AdminPage to prevent re-renders
interface FullscreenDoorGridModalProps {
  open: boolean;
  onClose: () => void;
  onOpenDoor: (doorNumber: number) => void;
  onShowCmdCommands?: () => void;
}

const FullscreenDoorGridModal: React.FC<FullscreenDoorGridModalProps> = ({ open, onClose, onOpenDoor, onShowCmdCommands }) => {
  const [groupFilter, setGroupFilter] = React.useState('all');
  const [pusatecColTab, setPusatecColTab] = React.useState(0);
  const device = sessionDevice.value;
  const deviceStatus = device?.status;

  // Helper to get door size height
  const maxGridHeight = 900;
  const smallHeight = Math.floor(maxGridHeight / 12);

  const getSizeHeight = (size: string) => {
    switch (size?.toLowerCase()) {
      case 'small': return smallHeight;
      case 'medium': return smallHeight * 2;
      case 'large': return smallHeight * 4;
      case 'xxl': return smallHeight * 8;
      case 'custom1': return smallHeight * 2.5;
      case 'custom2': return smallHeight * 3;
      case 'custom3': return smallHeight * 5;
      case 'external': return smallHeight * 2;
      default: return smallHeight * 2;
    }
  };

  // Get flex value based on door size for proportional height
  const getSizeFlex = (size: string) => {
    switch (size?.toLowerCase()) {
      case 'small': return 1;
      case 'medium': return 2;
      case 'large': return 4;
      case 'xxl': return 8;
      case 'custom1': return 2.5;
      case 'custom2': return 3;
      case 'custom3': return 5;
      case 'external': return 2;
      default: return 2;
    }
  };

  // Helper to check if door is open
  const isDoorOpen = (door: any) => {
    const doorStatus = deviceStatus?.[door?.doorNumber];
    return doorStatus?.isOpen === true || doorStatus?.isOpen === 1;
  };

  // Helper to get color hex value
  const getColorHex = (colorName: string): string | undefined => {
    const colorMap: Record<string, string> = {
      slate: '#64748b', gray: '#6b7280', zinc: '#71717a', neutral: '#737373',
      stone: '#78716c', red: '#ef4444', orange: '#f97316', amber: '#f59e0b',
      yellow: '#eab308', lime: '#84cc16', green: '#22c55e', emerald: '#10b981',
      teal: '#14b8a6', cyan: '#06b6d4', sky: '#0ea5e9', blue: '#3b82f6',
      indigo: '#6366f1', violet: '#8b5cf6', purple: '#a855f7', fuchsia: '#d946ef',
      pink: '#ec4899', rose: '#f43f5e'
    };
    return colorMap[colorName?.toLowerCase()];
  };

  // Helper to get door info
  const getDoorInfo = (doorNumber: number) => {
    let itemCount = 0;
    let doorGroupColor = '';
    let doorBelongsToSelectedGroup = groupFilter === 'all';

    if (device?.manifest?.groups) {
      for (const [groupId, group] of Object.entries(device.manifest.groups)) {
        const groupData = group as any;
        if (!groupData.lockers) continue;

        const lockers = Array.isArray(groupData.lockers) ? groupData.lockers : Object.values(groupData.lockers);

        for (const locker of lockers) {
          if ((locker as any)?.doorNumber === doorNumber) {
            if (groupFilter === 'all' || groupFilter === groupId) {
              doorBelongsToSelectedGroup = true;
            }
            const itemIds = (locker as any).itemIds;
            itemCount = itemIds && Array.isArray(itemIds) ? itemIds.length : 0;
            doorGroupColor = groupData.color || '';
            break;
          }
        }
      }
    }

    return { itemCount, doorGroupColor, doorBelongsToSelectedGroup };
  };

  // Get door data
  let doorsData = device?.thedoors || [];

  if (doorsData.length === 0) {
    const constructedDoors: any[] = [];
    let groups = device?.manifest?.groups;

    if (groups) {
      const groupsArray = Array.isArray(groups) ? groups : Object.values(groups);

      for (const group of groupsArray) {
        const groupData = group as any;
        if (groupData.lockers) {
          const lockers = Array.isArray(groupData.lockers) ? groupData.lockers : Object.values(groupData.lockers);

          for (const locker of lockers) {
            if (!locker) continue;
            const lockerData = locker as any;
            const doorNum = lockerData.doorNumber || lockerData.door;

            if (doorNum) {
              constructedDoors.push({
                doorNumber: doorNum,
                door: doorNum,
                size: lockerData.size || 'medium',
                col: 1,
                row: doorNum,
                ada: lockerData.isAda || lockerData.ada || false,
                enabled: true,
                open: false
              });
            }
          }
        }
      }

      constructedDoors.sort((a, b) => a.doorNumber - b.doorNumber);
      constructedDoors.forEach((door, index) => {
        door.col = 1;
        door.row = index + 1;
      });

      doorsData = constructedDoors;
    }
  }

  const displayPos = device?.settings?.displayPos || 0;
  const displaySize = device?.settings?.displaySize || '';
  const pusatecEnabled = device?.settings?.hwIntegrations?.pusatecEnabled || false;

  let workingDoorsData = [...doorsData];
  const shouldInjectDisplay = displayPos > 0 || displaySize?.toLowerCase() === 'external';

  if (shouldInjectDisplay && displayPos > 0) {
    const sortedDoors = [...workingDoorsData].sort((a, b) => a.doorNumber - b.doorNumber);
    let displayCol = 1;
    if (displayPos <= sortedDoors.length) {
      displayCol = sortedDoors[displayPos - 1]?.col ?? 1;
    } else {
      displayCol = sortedDoors[sortedDoors.length - 1]?.col ?? 1;
    }

    const displayCard = {
      doorNumber: 'DISPLAY',
      isDisplay: true,
      size: displaySize?.toLowerCase() || 'medium',
      col: displayCol,
      originalPosition: displayPos
    };

    const insertIndex = Math.min(displayPos - 1, workingDoorsData.length);
    workingDoorsData.splice(insertIndex, 0, displayCard);
  }

  // Pusatec mode: L/R pairs per row, display replaces matching door
  let pusatecLayout: { col: number, rows: { left?: any, right?: any }[] }[] | null = null;
  if (pusatecEnabled) {
    const sorted = [...doorsData].sort((a, b) => a.doorNumber - b.doorNumber);
    const colUnits = new Map<number, any[]>();
    sorted.forEach(d => {
      const col = d.col ?? 1;
      if (!colUnits.has(col)) colUnits.set(col, []);
      colUnits.get(col)!.push(d);
    });
    const hasDisplay = displayPos > 0;
    const displayCard = hasDisplay ? { doorNumber: 'DISPLAY', isDisplay: true, size: displaySize?.toLowerCase() || 'small', col: 1 } : null;
    const units: { col: number, rows: { left?: any, right?: any }[] }[] = [];
    colUnits.forEach((unitDoors, col) => {
      const rows: { left?: any, right?: any }[] = [];
      for (let i = 0; i < unitDoors.length; i += 2) {
        const left = unitDoors[i]?.doorNumber % 2 !== 0 ? unitDoors[i] : unitDoors[i + 1];
        const right = unitDoors[i]?.doorNumber % 2 === 0 ? unitDoors[i] : unitDoors[i + 1];
        const dc = displayCard ? { ...displayCard, col } : null;
        if (hasDisplay && left?.doorNumber === displayPos) {
          rows.push({ left: dc, right });
        } else if (hasDisplay && right?.doorNumber === displayPos) {
          rows.push({ left, right: dc });
        } else {
          rows.push({ left, right });
        }
      }
      units.push({ col, rows });
    });
    pusatecLayout = units;
  }

  // Group doors by column (normal mode)
  const maxCol = Math.max(...(workingDoorsData.map((d: any) => d?.col ?? 1)), 1);
  const columns: any[][] = Array.from({ length: maxCol }, () => []);

  workingDoorsData.forEach((door: any) => {
    const col = (door?.col ?? 1) - 1;
    if (col >= 0 && col < columns.length) {
      columns[col].push(door);
    } else if (columns.length > 0) {
      columns[columns.length - 1].push(door);
    }
  });

  columns.forEach(col => col.sort((a, b) => (a?.row ?? 1) - (b?.row ?? 1)));

  // Helper to render a single door card (fullscreen mode)
  const renderFullscreenDoorCard = (door: any, key: string | number, useFlexWidth?: boolean) => {
    if (door?.isDisplay) {
      return (
        <div
          key={key}
          style={{
            border: '2px solid #3b82f6',
            borderRadius: '8px',
            padding: '8px',
            width: useFlexWidth ? undefined : '100%',
            flex: useFlexWidth ? `${getSizeFlex(door?.size || 'medium')} 1 0` : getSizeFlex(door?.size || 'medium'),
            minHeight: '50px',
            background: 'linear-gradient(to bottom right, #eff6ff, #dbeafe)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
            boxSizing: 'border-box' as const,
            overflow: 'hidden',
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
          onClick={() => onShowCmdCommands?.()}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
            <svg style={{ width: '56px', height: '56px', color: '#2563eb' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <span style={{ ...getTextStyle({ fontWeight: 'bold', color: '#1e40af' }, 10) }}>DISPLAY</span>
          </div>
        </div>
      );
    }

    const isOpen = isDoorOpen(door);
    const { itemCount, doorGroupColor, doorBelongsToSelectedGroup } = getDoorInfo(door.doorNumber);
    const hasItems = itemCount > 0;
    const flexValue = getSizeFlex(door?.size);
    const isDisabled = !doorBelongsToSelectedGroup;
    const closedBgColorHex = doorGroupColor ? getColorHex(doorGroupColor) : undefined;
    const closedBorderColorHex = doorGroupColor ? getColorHex(doorGroupColor) : undefined;

    let cardStyle: any = {
      width: useFlexWidth ? undefined : '100%',
      flex: useFlexWidth ? `${flexValue} 1 0` : flexValue,
      minHeight: '50px',
      border: '2px solid',
      borderRadius: '8px',
      padding: '8px',
      cursor: 'pointer',
      transition: 'all 0.2s',
      boxSizing: 'border-box',
      overflow: 'hidden'
    };

    if (isDisabled) {
      cardStyle.backgroundColor = '#e5e7eb';
      cardStyle.borderColor = '#d1d5db';
      cardStyle.opacity = 0.4;
      cardStyle.cursor = 'not-allowed';
    } else if (isOpen) {
      cardStyle.backgroundColor = '#fef2f2';
      cardStyle.borderColor = '#fca5a5';
    } else {
      cardStyle.backgroundColor = closedBgColorHex || '#f0fdf4';
      cardStyle.borderColor = closedBorderColorHex || '#86efac';
    }

    return (
      <div
        key={key}
        style={cardStyle}
        onMouseEnter={(e) => {
          if (!isDisabled) {
            e.currentTarget.style.boxShadow = 'inset 0 0 10px rgba(0,0,0,0.2)';
            e.currentTarget.style.transform = 'scale(0.97)';
          }
        }}
        onMouseLeave={(e) => {
          if (!isDisabled) {
            e.currentTarget.style.boxShadow = '';
            e.currentTarget.style.transform = 'scale(1)';
          }
        }}
        onClick={() => { if (!isDisabled) onOpenDoor(door.doorNumber); }}
      >
        {door?.size?.toLowerCase() === 'small' ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '100%', gap: '12px' }}>
            <span style={{ ...getTextStyle({ fontWeight: 'bold' }, 12), whiteSpace: 'nowrap' }}>#{door.doorNumber}</span>
            {door?.ada && (
              <svg style={{ width: '18px', height: '18px', color: '#2563eb', flexShrink: 0 }} fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 2a2 2 0 100 4 2 2 0 000-4zM4 9a1 1 0 011-1h3.5a1 1 0 01.867.5l1.5 2.598a1 1 0 01-.866 1.5H8v4a1 1 0 11-2 0v-4.5a.5.5 0 00-.5-.5H5a1 1 0 01-1-1V9zm11.5 7.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm0-1.5a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
              </svg>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }}>
              {hasItems && (
                <span style={{ ...getTextStyle({ fontWeight: '600' }, 7), padding: '4px 8px', borderRadius: '4px', backgroundColor: '#e9d5ff', color: '#6b21a8', whiteSpace: 'nowrap' }}>({itemCount})</span>
              )}
              <span style={{ ...getTextStyle({ fontWeight: '600' }, 7), padding: '4px 8px', borderRadius: '4px', backgroundColor: isOpen ? '#fecaca' : '#bbf7d0', color: isOpen ? '#991b1b' : '#15803d', whiteSpace: 'nowrap' }}>
                {isOpen ? 'OPEN' : 'CLOSED'}
              </span>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ ...getTextStyle({ fontWeight: 'bold' }, 14) }}>#{door.doorNumber}</span>
                {door?.ada && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#2563eb' }}>
                    <svg style={{ width: '20px', height: '20px' }} fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 2a2 2 0 100 4 2 2 0 000-4zM4 9a1 1 0 011-1h3.5a1 1 0 01.867.5l1.5 2.598a1 1 0 01-.866 1.5H8v4a1 1 0 11-2 0v-4.5a.5.5 0 00-.5-.5H5a1 1 0 01-1-1V9zm11.5 7.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm0-1.5a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                    </svg>
                    <span style={{ ...getTextStyle({ fontWeight: '600' }, 9) }}>(ADA)</span>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                <span style={{ ...getTextStyle({ fontWeight: '600' }, 8), padding: '6px 10px', borderRadius: '6px', backgroundColor: isOpen ? '#fecaca' : '#bbf7d0', color: isOpen ? '#991b1b' : '#15803d', whiteSpace: 'nowrap' }}>
                  {isOpen ? 'OPEN' : 'CLOSED'}
                </span>
                <span style={{ ...getTextStyle({ fontWeight: '600' }, 8), padding: '6px 10px', borderRadius: '6px', backgroundColor: hasItems ? '#e9d5ff' : '#f3f4f6', color: hasItems ? '#6b21a8' : '#6b7280', whiteSpace: 'nowrap' }}>
                  {hasItems ? `${itemCount} ITEM${itemCount !== 1 ? 'S' : ''}` : 'EMPTY'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <Modal
      title={null}
      open={open}
      onCancel={onClose}
      footer={null}
      width="100vw"
      style={{ top: 0, padding: 0, maxWidth: '100vw', margin: 0 }}
      styles={{ body: { height: 'calc(100vh - 110px)', padding: '10px', overflow: 'hidden', backgroundColor: '#1f2937' } }}
      closable={false}
      maskClosable={false}
      keyboard={false}
      destroyOnHidden={false}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Header with group filter and close button */}
        <div style={{ marginBottom: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            {device?.manifest?.groups && (
              <select
                value={groupFilter}
                onChange={(e) => setGroupFilter(e.target.value)}
                style={{
                  padding: '12px 16px',
                  border: '2px solid #d1d5db',
                  borderRadius: '8px',
                  fontSize: '28px',
                  color: SEBlue.value,
                  backgroundColor: 'white',
                  cursor: 'pointer'
                }}
              >
                <option value="all">All Groups</option>
                {Object.entries(device.manifest.groups).map(([groupId, group]: [string, any]) => (
                  <option key={groupId} value={groupId}>
                    {group.name}
                  </option>
                ))}
              </select>
            )}
            <span style={{ color: 'white', fontSize: '24px', fontWeight: 'bold' }}>Door Grid - Fullscreen View</span>
          </div>
          <Button
            size="large"
            onClick={onClose}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 24px',
              fontSize: '22px',
              height: 'auto',
              backgroundColor: '#ef4444',
              borderColor: '#ef4444',
              color: 'white',
              fontWeight: 'bold'
            }}
          >
            <svg style={{ width: '24px', height: '24px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Close Fullscreen
          </Button>
        </div>

        {/* Fullscreen door grid content */}
        {doorsData.length === 0 && !shouldInjectDisplay ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'white', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
            <p style={{...getTextStyle({}, 14)}}>No door configuration found</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            <div style={{
              border: '2px solid #374151',
              borderRadius: '8px',
              padding: '4px',
              backgroundColor: '#f3f4f6',
              width: '100%',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              boxSizing: 'border-box'
            }}>
              {pusatecEnabled && pusatecLayout ? (
              <div style={{ display: 'flex', flexDirection: 'column', width: '100%', flex: 1, boxSizing: 'border-box' }}>
                {(() => {
                  const totalCols = pusatecLayout.length;
                  const perTab = 3;
                  const tabCount = totalCols > perTab ? Math.ceil(totalCols / perTab) : 0;
                  const tabs = tabCount > 0 ? Array.from({ length: tabCount }, (_, i) => {
                    const start = i * perTab;
                    const end = Math.min(start + perTab, totalCols);
                    return { label: `Col ${start + 1}-${end}`, start, end };
                  }) : null;
                  const activeTab = tabs ? Math.min(pusatecColTab, tabs.length - 1) : 0;
                  const visibleUnits = tabs ? pusatecLayout.slice(tabs[activeTab].start, tabs[activeTab].end) : pusatecLayout;
                  return (
                    <>
                      {tabs && (
                        <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', flexShrink: 0 }}>
                          {tabs.map((tab, idx) => (
                            <button
                              key={idx}
                              onClick={() => setPusatecColTab(idx)}
                              style={{
                                padding: '8px 20px',
                                borderRadius: '9999px',
                                fontSize: '18px',
                                fontWeight: 600,
                                border: 'none',
                                cursor: 'pointer',
                                transition: 'all 0.15s',
                                backgroundColor: activeTab === idx ? '#2563eb' : '#e5e7eb',
                                color: activeTab === idx ? 'white' : '#4b5563',
                                boxShadow: activeTab === idx ? '0 1px 3px rgb(0 0 0 / 0.2)' : 'none'
                              }}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: '24px', width: '100%', flex: 1, boxSizing: 'border-box' }}>
                        {visibleUnits.map((unit) => (
                          <div key={unit.col} style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '4px', minWidth: 0, overflow: 'hidden' }}>
                            {unit.rows.map((row, rowIdx) => (
                              <div key={rowIdx} style={{ display: 'flex', gap: '4px', flex: getSizeFlex(row.left?.size || row.right?.size || 'small') }}>
                                {row.left && renderFullscreenDoorCard(row.left, `L-${row.left.doorNumber}`, true)}
                                {row.right && renderFullscreenDoorCard(row.right, `R-${row.right.doorNumber}`, true)}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    </>
                  );
                })()}
              </div>
              ) : (
              <div style={{ display: 'flex', gap: '4px', width: '100%', flex: 1, boxSizing: 'border-box' }}>
                {columns.map((colDoors, colIndex) => (
                <div key={colIndex} style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '4px', minWidth: 0, overflow: 'hidden' }}>
                  {colDoors.map((door: any, doorIndex: number) => renderFullscreenDoorCard(door, doorIndex))}
                </div>
              ))}
              </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default function AdminPage() {
  useSignals();
  updateLocation('/admin')
  const onChange = (key: string) => {
    console.log(key);
  };

  type Align = 'start' | 'center' | 'end';
  const [viewMainView, setViewMainView] = useState(true);
  const [alignValue, setAlignValue] = React.useState<Align>('start');
  const [isLoT, setIsLoT] = useState(false);
  const [isHoldPickup, setIsHoldPickup] = useState(false);
  const [isDynamicLoT, setIsDynamicLoT] = useState(false);
  const [isTestMode, setIsTestMode] = useState(false);
  const {t} = useTranslation();

  useEffect(() => {
    // Check offline status
    (async () => {
      try {
        const electron = (window as any).electron;
        const offline = await electron.sideeventNative.isMainOperatingOffline();
        setIsOffline(offline);
        if (offline) {
          setActiveTab('2'); // Default to Door Actions when offline
          console.log('⚠️ Admin: Offline mode - only Door Actions and Door Grid tabs enabled');
        }
      } catch (e) {
        console.log('⚠️ Admin: Could not check offline status');
      }
    })();
  }, []);
  // Don't create snapshot - use sessionDevice.value directly for real-time RTDB updates
  const [loading, setLoading] = useState(false);
  const [, setLocation] = useLocation();
  const [modal_openAllDoors, setModal_openAllDoors] = useState(false);
  const [openingDoorsProgress, setOpeningDoorsProgress] = useState<{current: number, total: number} | null>(null);
  const [modal_openGivenDoor, setModal_openGivenDoor] = useState(false);
  const [cleanOpenedDoor, setCleanOpenedDoor] = useState(false);
  const [givenDoorNumber, setGivenDoorNumber] = useState(0);
  const [modal_openDoorTitle, setModal_openDoorTitle] = useState('');
  const [modal_doorOpenFailed, setModal_doorOpenFailed] = useState(false);
  const [modal_doorOpenFailedDoor, setModal_doorOpenFailedDoor] = useState(0);

  const [viewRemoveAllCancelled, setViewRemoveAllCancelled] = useState(false);
  const [viewRemoveAllExpiredSmartConsolidation, setViewRemoveAllExpiredSmartConsolidation] = useState(false);
  const [viewRemoveAllLeftBehind, setViewRemoveAllLeftBehind] = useState(false);
  const [viewRemoveAllExpired, setViewRemoveAllExpired] = useState(false);
  const [viewRemoveAllReturned, setViewRemoveAllReturned] = useState(false);
  const [viewInspection, setViewInspection] = useState(false);

  // State variables used in useEffect hooks - must be declared before the hooks
  const [smartConsolidationHolds, setSmartConsolidationHolds] = useState<any>(null);
  const [cancelledHolds, setCancelledHolds] = useState<any>(null);
  const [cancelledHoldsList, setCancelledHoldsList] = useState<any[]>([]);
  const [cancelledHoldsIndex, setCancelledHoldsIndex] = useState(0);
  const [expiredHoldLockers, setExpiredHoldLockers] = useState<any>(null);
  const [leftBehindLockers, setLeftBehindLockers] = useState<any>(null);
  const [inspectionItem, setInspectionItem] = useState<any>(null);
  const [inspectionLockers, setInspectionLockers] = useState<any[]>([]);
  const [inspectionIndex, setInspectionIndex] = useState(0);
  const [expiredTimer, setExpiredTimer] = useState(20);
  const [smartConsolidationTimer, setSmartConsolidationTimer] = useState(20);
  const [cancelledTimer, setCancelledTimer] = useState(20);
  const [leftBehindTimer, setLeftBehindTimer] = useState(20);
  const [inspectionTimer, setInspectionTimer] = useState(20);
  const [timerPaused, setTimerPaused] = useState(false);
  const [adminViewTimer, setAdminViewTimer] = useState(990);

  const [modal_showConfirmCleanup, setModal_showConfirmCleanup] = useState(false);
  const [modal_confirmCleanupActionTitle, setModal_confirmCleanupActionTitle] = useState('Cleanup');
  const [modal_confirmCleanupActionBody, setModal_confirmCleanupActionBody] = useState('<b>No body</b>');
  const [modal_confirmCleanupAction, setModal_confirmCleanupAction] = useState('default');
  enum CleanupAction {
    OPEN_ALL_DOORS = 'openAllDoors',
    REMOVE_ALL_CANCELLED = 'removeAllCancelled',
    REMOVE_ALL_EXPIRED = 'removeAllExpired',
    REMOVE_ALL_LEFT_BEHIND = 'removeAllLeftBehind',
    REMOVE_ALL_RETURNED = 'removeAllReturned',
    REMOVE_ALL_EXPIRED_SMART_CONSOLIDATION = "removeAllExpiredSmartConsolidation",
    REMOVE_CANCELLED_AND_EXPIRED = 'removeCancelledAndExpired',
    INSPECTION = 'inspection'
  }




  const [modal_showManifest, setModal_showManifest] = useState(false);
  const [modal_showPullList, setModal_showPullList] = useState(false);
  const [modal_showCmdCommands, setModal_showCmdCommands] = useState(false);
  const [modal_showCmdResult, setModal_showCmdResult] = useState(false);
  const [cmdResultText, setCmdResultText] = useState('');
  const [customCmdText, setCustomCmdText] = useState('');
  const [activeTab, setActiveTab] = useState('1'); // Default to Cleanup
  const [isOffline, setIsOffline] = useState(false);
  const [manifest, setManifest] = useState<any>([]);
  const [removeTitlesFromLockerOneLockerAtTheTime, setRemoveTitlesFromLockerOneLockerAtTheTime] = useState<any>([]);
  const [modal_removeTitles, setModal_removeTitles] = useState(false);

  // Workflow Wizard State
  const [workflowWizardOpen, setWorkflowWizardOpen] = useState(false);
  const [workflowWizardType, setWorkflowWizardType] = useState<'sip2' | 'sip2lot' | 'polaris' | 'polarislot' | 'symphony' | 'symphonylot'>('sip2');
  const [workflowWizardStep, setWorkflowWizardStep] = useState(0);
  const [workflowWizardStepStatus, setWorkflowWizardStepStatus] = useState<('pending' | 'running' | 'done' | 'error')[]>(['pending', 'pending', 'pending']);
  const [workflowWizardStepResults, setWorkflowWizardStepResults] = useState<any[]>([null, null, null]);
  const [workflowWizardRunning, setWorkflowWizardRunning] = useState(false);
  const [workflowWizardItemId, setWorkflowWizardItemId] = useState('');
  const [workflowWizardItemInfoSent, setWorkflowWizardItemInfoSent] = useState(false);
  const [workflowWizardHasHold, setWorkflowWizardHasHold] = useState<boolean | null>(null);
  const [workflowWizardCircStatus, setWorkflowWizardCircStatus] = useState<number | null>(null);
  const [workflowWizardPatronId, setWorkflowWizardPatronId] = useState<string | null>(null);
  const [workflowWizardVerifyCircStatus, setWorkflowWizardVerifyCircStatus] = useState<number | null>(null);
  const [workflowWizardDoorNumber, setWorkflowWizardDoorNumber] = useState<number | null>(null);
  // Polaris-specific state
  const [workflowWizardItemFound, setWorkflowWizardItemFound] = useState<boolean | null>(null);
  const [workflowWizardHoldExpiration, setWorkflowWizardHoldExpiration] = useState<string | null>(null);
  // SIP2 LoT specific state
  const [workflowWizardIsReturn, setWorkflowWizardIsReturn] = useState<boolean>(false); // true if circ status was 4 (checked out)
  const [workflowWizardSelectedGroup, setWorkflowWizardSelectedGroup] = useState<string | null>(null); // Selected group for LoT
  const sip2LotGroups = ['Group A', 'Group B', 'Group C', 'Group D']; // Available groups for SIP2 LoT

  // Helper to get circulation status text
  const getCircStatusText = (status: number | null): string => {
    switch (status) {
      case 1: return 'Shelved';
      case 4: return 'Checked Out';
      case 8: return 'At Hold Pickup';
      case 10: return 'In Transit';
      default: return 'Unknown';
    }
  };

  const getCircStatusColor = (status: number | null): string => {
    switch (status) {
      case 1: return '#52c41a'; // green - shelved
      case 4: return '#faad14'; // orange - checked out
      case 8: return '#1890ff'; // blue - at hold pickup
      case 10: return '#722ed1'; // purple - in transit
      default: return '#999';
    }
  };

  useEffect(() => {
    const isTestMode = localStorage.getItem('IsTestMode') === 'true';
    setIsTestMode(isTestMode);
    // Disabled auto-exit on admin page
    // updateSessionTimer(360)
    // exitCountdownTimer();

    // Auto-open door confirmation if navigated with adminAutoOpenDoor signal
    if (adminAutoOpenDoor.value && adminAutoOpenDoor.value > 0) {
      const doorNumber = adminAutoOpenDoor.value;
      adminAutoOpenDoor.value = null;
      console.log('Admin mount — auto-open door:', doorNumber);
      setGivenDoorNumber(doorNumber);
      setModal_confirmCleanupAction('openGivenDoor');
      setModal_openGivenDoor(true);
    }

    if (!sessionDevice.value) return;
    setIsHoldPickup(sessionDevice.value.settings?.isHoldLocker || false);
    setIsLoT(!sessionDevice.value.settings?.isHoldLocker && !sessionDevice.value.settings?.isDynamicLoT);
    setIsDynamicLoT(!sessionDevice.value.settings?.isHoldLocker && sessionDevice.value.settings?.isDynamicLoT);

    if (sessionDevice.value.manifest?.groups) {
      setManifest([])
      const groupKeys = sessionDevice.value.manifest.groups ? Object.keys(sessionDevice.value.manifest.groups) : [];
      groupKeys.map((groupKey: any) => {
        const lockerKeys = sessionDevice.value.manifest.groups[groupKey]?.lockers ? Object.keys(sessionDevice.value.manifest.groups[groupKey].lockers) : [];
        lockerKeys.map((lockerKey: any) => {
          const locker = sessionDevice.value.manifest.groups[groupKey].lockers[lockerKey];
          if (locker.itemId) {
            const itemString = `<Col span={22} offset={2} key="${lockerKey}">Door #${lockerKey}: Items ${locker.itemId} for patron ${locker.patronId} - Expieres ${locker.holdExpirationDate ? new Date(locker.holdExpirationDate).toLocaleString() : 'N/A'}</Col>`;
            setManifest([...manifest, itemString])
          }
        })
      })
    }

  }, []);

  useEffect(() => {
    if (viewRemoveAllExpired && expiredHoldLockers && !timerPaused) {
      const itemCount = expiredHoldLockers.reduce((acc: number, locker: any) => acc + locker.itemId.split(',').length, 0);
      const initialTime = itemCount > 4 ? 40 : 20;
      if (expiredTimer === 20 || expiredTimer === 40) {
        setExpiredTimer(initialTime);
      }
      const interval = setInterval(() => {
        setExpiredTimer((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            returnToMainView();
            return initialTime;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [viewRemoveAllExpired, expiredHoldLockers, timerPaused]);

  // Smart consolidation timer removed — now uses cancelledTimer via viewRemoveAllCancelled

  useEffect(() => {
    if (viewRemoveAllCancelled && cancelledHolds && !timerPaused) {
      const itemCount = cancelledHolds.removeTitles?.length || 0;
      const initialTime = itemCount > 4 ? 40 : 20;
      if (cancelledTimer === 20 || cancelledTimer === 40) {
        setCancelledTimer(initialTime);
      }
      const interval = setInterval(() => {
        setCancelledTimer((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            returnToMainView();
            return initialTime;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [viewRemoveAllCancelled, cancelledHolds, timerPaused]);

  useEffect(() => {
    if (viewRemoveAllLeftBehind && leftBehindLockers && !timerPaused) {
      const itemCount = leftBehindLockers.reduce((acc: number, locker: any) => acc + locker.itemId.split(',').length, 0);
      const initialTime = itemCount > 4 ? 40 : 20;
      if (leftBehindTimer === 20 || leftBehindTimer === 40) {
        setLeftBehindTimer(initialTime);
      }
      const interval = setInterval(() => {
        setLeftBehindTimer((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            returnToMainView();
            return initialTime;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [viewRemoveAllLeftBehind, leftBehindLockers, timerPaused]);

  useEffect(() => {
    if (viewInspection && inspectionItem && !timerPaused) {
      const initialTime = 60;
      if (inspectionTimer <= 20) {
        setInspectionTimer(initialTime);
      }
      const interval = setInterval(() => {
        setInspectionTimer((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            returnToMainView();
            return initialTime;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [viewInspection, inspectionItem, timerPaused]);

  // Admin view auto-exit timer - counts down and exits when reaching 0
  useEffect(() => {
    const interval = setInterval(() => {
      setAdminViewTimer((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          exit();
          return 99;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Reset admin timer function - call this on button clicks
  const resetAdminTimer = () => {
    setAdminViewTimer(99);
  };

  const enableBarcodeMode = async (barcode: string) => {
    if (sessionLocation.value === '/admin' && barcode && barcode !== '') {
      setCurrentBarcode(barcode);

      Promise.delay(1000).then(() => {
        updateSessionBarcode('');
        rfidItemId.value = ''; // Clear RFID signal so next read triggers useEffect
        setCurrentBarcode('');
        setPreviousBarcode(barcode);
      });
    }

  };

  useEffect(() => {
    if (sessionBarcode.value) {
      enableBarcodeMode(sessionBarcode.value);
    }
  }, [sessionBarcode.value]);

  useEffect(() => {
    if (rfidItemId.value) {
      enableBarcodeMode(rfidItemId.value);
    }
  }, [rfidItemId.value]);


  function exitCountdownTimer() {
    if (sessionLocation.value !== '/admin') {
      return;
    }
    if (sessionTimer.value > 0) {
      const timerval = sessionTimer.value - 1;
      updateSessionTimer(timerval);
      Promise.delay(1000).then(() => exitCountdownTimer());
    } else {
      setLoading(true)
      setLocation('/')
    }

  }





  const style2: React.CSSProperties = {
    zIndex: 1,
  };

  const stylePage: React.CSSProperties = { height: '100%', zIndex: 1 };
  const [color] = useState('#ffffff');

  const override: CSSProperties = {
    display: 'block',
    margin: '0 auto',
    borderColor: 'blue',
  };

  function exit() {
    updateLocation('/')
    setLocation('/')
    // Reset font size to default (16px) when exiting
    updateFontSize(fontSizeStorage.value);
  }

  // Function to manually clear a locker's manifest data (for out-of-sync lockers)
  async function clearLockerManifest(doorNumber: number, silent?: boolean) {
    try {
      const doorNum = +doorNumber; // Ensure it's a number
      console.log(`🧹 Deleting locker ${doorNum} from manifest`);

      // Find and delete the locker in all groups
      const groups = sessionDevice.value.manifest.groups;
      let cleared = false;

      // Handle both array and object formats for groups
      const groupsIterable = Array.isArray(groups) ? groups.entries() : Object.entries(groups);

      for (const [groupKey, group] of groupsIterable) {
        const groupData = group as any;
        if (!groupData?.lockers) continue;

        console.log(`   Checking group ${groupKey}, lockers type: ${Array.isArray(groupData.lockers) ? 'array' : 'object'}, count: ${Array.isArray(groupData.lockers) ? groupData.lockers.length : Object.keys(groupData.lockers).length}`);

        // Handle both array and object formats for lockers
        if (Array.isArray(groupData.lockers)) {
          // Array format - find by doorNumber property and remove from array
          // Use == to handle type coercion (doorNumber might be string or number)
          const lockerIndex = groupData.lockers.findIndex((l: any) => +l?.doorNumber === doorNum);
          console.log(`   Array search for doorNumber ${doorNum}: found at index ${lockerIndex}`);
          if (lockerIndex !== -1) {
            const removedLocker = groupData.lockers.splice(lockerIndex, 1);
            cleared = true;
            console.log(`✅ Deleted locker ${doorNum} from group ${groupKey} (array format, was at index ${lockerIndex})`, removedLocker);
          }
        } else if (groupData.lockers[doorNum] !== undefined) {
          // Object format - delete by doorNumber key (numeric)
          delete groupData.lockers[doorNum];
          cleared = true;
          console.log(`✅ Deleted locker ${doorNum} from group ${groupKey} (object format, numeric key)`);
        } else if (groupData.lockers[String(doorNum)] !== undefined) {
          // Object format with string key
          delete groupData.lockers[String(doorNum)];
          cleared = true;
          console.log(`✅ Deleted locker ${doorNum} from group ${groupKey} (object format, string key)`);
        }
      }

      if (cleared) {
        // Persist manifest changes to Firebase RTDB
        console.log(`📤 Persisting manifest to Firebase...`);
        await persistDeviceManifestChanges(sessionDevice.value.manifest);
        console.log(`✅ Locker ${doorNum} deleted and manifest persisted to Firebase`);
        if (!silent) customToast(() => `Locker ${doorNum} cleared successfully`, 3000, 'default', 'dark');
      } else {
        console.warn(`⚠️ Locker ${doorNum} not found in any group.`);
        // Log the structure for debugging
        if (Array.isArray(groups)) {
          groups.forEach((g: any, i: number) => {
            if (g?.lockers) {
              console.log(`   Group ${i} lockers:`, Array.isArray(g.lockers) ? g.lockers.map((l: any) => l?.doorNumber) : Object.keys(g.lockers));
            }
          });
        }
        if (!silent) customToast(() => `Locker ${doorNum} not found`, 3000, 'default', 'dark');
      }

      resetAdminTimer();
    } catch (error) {
      console.error(`❌ Error clearing locker ${doorNumber}:`, error);
      if (!silent) customToast(() => `Error clearing locker ${doorNumber}`, 3000, 'default', 'dark');
    }
  }



  function isExpired(obj:any) {
    if (!obj) return false;
    const now = Date.now();

    // 1. holdExpirationDate overrides everything when set
    if (obj.holdExpirationDate && +obj.holdExpirationDate > 0) {
        return now > +obj.holdExpirationDate;
    }

    // 2. No holdExpirationDate — check set keys (each key is an expiration epoch)
    //    Expired if ANY set date has passed
    if (obj.set && typeof obj.set === 'object') {
        for (const dateKey of Object.keys(obj.set)) {
            if (+dateKey > 0 && now > +dateKey) {
                return true;
            }
        }
    }

    // 3. No expiration info — not expired
    return false;
  }

  // Get only the expired item IDs from a locker's set (items whose set date has passed)
  function getExpiredItemsFromSet(obj: any): string[] {
    if (!obj?.set || typeof obj.set !== 'object') return [];
    const now = Date.now();
    const expired: string[] = [];
    for (const dateKey of Object.keys(obj.set)) {
      if (+dateKey > 0 && now > +dateKey) {
        const items = obj.set[dateKey];
        if (Array.isArray(items)) {
          expired.push(...items);
        }
      }
    }
    return expired;
  }

  const getExpiredCancelledLockersCount = () => {
    let expiredItemCount = getCancelledLockersDoors();
    return expiredItemCount.length;
  }

  // Get doors with expired manifest items (based on holdExpirationDate)
  const getExpiredHoldLockersDoors = () => {
    const expiredDoors: number[] = [];
    const now = new Date().getTime();

    if (!sessionDevice.value?.manifest?.groups) {
      return expiredDoors;
    }

    // Handle both array and object formats for groups
    const groups = sessionDevice.value.manifest.groups;
    const groupsArray = Array.isArray(groups) ? groups : Object.values(groups);

    for (const group of groupsArray) {
      const groupData = group as any;
      if (!groupData?.lockers) continue;

      // Handle both array and object formats for lockers
      const lockers = Array.isArray(groupData.lockers) ? groupData.lockers : Object.entries(groupData.lockers);

      for (const lockerEntry of lockers) {
        let doorNumber: number;
        let locker: any;

        if (Array.isArray(groupData.lockers)) {
          locker = lockerEntry;
          doorNumber = locker?.doorNumber;
        } else {
          // Object format: [key, value]
          const [key, value] = lockerEntry as [string, any];
          doorNumber = parseInt(key);
          locker = value;
        }

        if (!locker || !doorNumber) continue;

        // Check if locker has items and is expired
        const hasItems = locker.itemId || (locker.itemIds && locker.itemIds.length > 0);
        if (hasItems && isExpired(locker)) {
          expiredDoors.push(doorNumber);
        }
      }
    }

    return [...new Set(expiredDoors)].sort((a, b) => a - b); // Unique and sorted
  };

  const getExpiredHoldLockersCount = () => {
    return getExpiredHoldLockersDoors().length;
  };

  const getLeftBehindLockersCount = () => {
    let expiredItemCount = getLeftBehindLockersDoors();
    return expiredItemCount.length;
  };

  const getDoorsWithItemsCount = () => {
    let count = 0;
    if (sessionDevice.value?.manifest?.groups) {
      const doorNumbers = new Set<number>();
      for (const group of Object.values(sessionDevice.value.manifest.groups)) {
        const groupData = group as any;
        if (!groupData.lockers) continue;
        const lockers = Array.isArray(groupData.lockers) ? groupData.lockers : Object.values(groupData.lockers);
        for (const locker of lockers) {
          if (!locker) continue;
          const lockerData = locker as any;
          if (lockerData?.doorNumber && lockerData.itemIds && Array.isArray(lockerData.itemIds) && lockerData.itemIds.length > 0) {
            doorNumbers.add(lockerData.doorNumber);
          }
        }
      }
      count = doorNumbers.size;
    }
    return count;
  }

  const getDoorsWithoutItemsCount = () => {
    const usedDoors = new Set<number>();
    if (sessionDevice.value?.manifest?.groups) {
      for (const group of Object.values(sessionDevice.value.manifest.groups)) {
        const groupData = group as any;
        if (!groupData.lockers) continue;
        const lockers = Array.isArray(groupData.lockers) ? groupData.lockers : Object.values(groupData.lockers);
        for (const locker of lockers) {
          if (!locker) continue;
          const lockerData = locker as any;
          if (lockerData?.doorNumber) {
            usedDoors.add(lockerData.doorNumber);
          }
        }
      }
    }
    const doorsData = sessionDevice.value?.thedoors || [];
    const emptyDoors = doorsData.filter((door: any) => door.enabled && !usedDoors.has(door.doorNumber));
    return emptyDoors.length;
  }

const getLeftBehindLockersDoors = () => {
  let leftBehindLockers: number[] = [];

  const groups = sessionDevice.value?.manifest?.groups;
  if (!groups) return leftBehindLockers;

  const groupsArray = Array.isArray(groups) ? groups : Object.values(groups);

  for (const group of groupsArray) {
    const groupData = group as any;
    if (!groupData?.lockers) continue;
    const lockers = Array.isArray(groupData.lockers) ? groupData.lockers : Object.values(groupData.lockers);

    for (const locker of lockers) {
      if (!locker) continue;
      const lockerData = locker as any;
      // Left behind: patronId starts with '!'
      if (lockerData.patronId && String(lockerData.patronId).startsWith('!')) {
        if (lockerData.doorNumber) {
          leftBehindLockers.push(+lockerData.doorNumber);
        }
      }
    }
  }
  return leftBehindLockers;
}
  const getCancelledLockersDoors = () => {

    let cancelledLockers = [];

    const groups = sessionDevice.value?.manifest?.groups;
    if (!groups) {
      return cancelledLockers;
    }

    const groupsArray = Array.isArray(groups) ? groups : Object.values(groups);

    for (const group of groupsArray) {
        if (group?.name === 'Holds' && group?.lockers) {
            for (const index in group.lockers) {
                const locker = group.lockers[index];
                const hasCancel = locker?.itemIds?.some((id: string) => id.startsWith('*'))
                  || (locker?.itemId && locker.itemId.startsWith('*'));
                if (hasCancel) {
                    cancelledLockers.push(+index);
                }
              }
        }
    }
    return cancelledLockers;
}

  async function processModalResult(exit = false) {
    setModal_showConfirmCleanup(false);
    setModal_openGivenDoor(false);
    // Don't close openAllDoors modal here - it will be closed after doors are opened
    if (modal_confirmCleanupAction !== 'openAllDoors') {
      setModal_openAllDoors(false);
    }
    setLoading(false);
    resetAdminTimer();

    if (exit) {
      setModal_showConfirmCleanup(false);
      setModal_confirmCleanupAction(null);
      setModal_openAllDoors(false);
      setLoading(false);
      return;
    }

    const typeResult = modal_confirmCleanupAction;
    setLoading(false)
    switch (typeResult) {

      case 'openGivenDoor':
        // no view, just open given door
        setLoading(true);
        setModal_openGivenDoor(false);

        // Get integrations from localStorage (saved by App.tsx)
        const cachedIntegrationsGiven = localStorage.getItem('integrations');
        let integrationsGiven: any[] = [];

        if (cachedIntegrationsGiven) {
          try {
            const integrationsObj = JSON.parse(cachedIntegrationsGiven);
            integrationsGiven = Array.isArray(integrationsObj) ? integrationsObj : Object.values(integrationsObj);
          } catch (error) {
            console.error('Error parsing integrations:', error);
          }
        }

        // Find bound slave door if this is a master
        const thedoorsGiven = sessionDevice.value?.thedoors;
        const givenDoorData = thedoorsGiven && Array.isArray(thedoorsGiven)
          ? thedoorsGiven.find((d: any) => d.doorNumber === givenDoorNumber)
          : null;
        const boundSlaveDoor = givenDoorData?.bindWithDoor != null ? Number(givenDoorData.bindWithDoor) : null;
        const isPusatecGiven = sessionDevice.value?.settings?.hwIntegrations?.pusatecEnabled;

        {
          const doorToTest = givenDoorNumber;
          let macForTest = sessionDevice.value.settings.macid;

          if (integrationsGiven.length > 0) {
            const integration = integrationsGiven[0];
            const mac = integration.macId || integration.mac;
            const ip = integration.ip;
            macForTest = mac;
            console.log(`Opening door ${givenDoorNumber} using integration MAC: ${mac}, IP: ${ip}`);
            try {
              const electron = (window as any).electron;
              await electron.sideeventNative.openLockerDoor(givenDoorNumber, mac, ip);
              console.log(`Door ${givenDoorNumber} opened successfully`);
              // Also open bound slave door
              if (boundSlaveDoor != null) {
                await new Promise(r => setTimeout(r, isPusatecGiven ? 200 : 1200));
                console.log(`Opening bound door ${boundSlaveDoor}`);
                await electron.sideeventNative.openLockerDoor(boundSlaveDoor, mac, ip);
              }
            } catch (error) {
              console.error(`Error opening door ${givenDoorNumber}:`, error);
            }
          } else {
            console.log('No integrations found, using device settings');
            await openDoor(sessionDevice.value.settings.macid, givenDoorNumber);
          }

          setGivenDoorNumber(0);
          setLoading(false);
        }
        break;

      case 'openAllDoors':
          setLoading(true);
          // Show spinner immediately with "preparing" state
          setOpeningDoorsProgress({ current: 0, total: 0 });

          // In testmode, simulate opening doors
          if (config.testmode) {
            console.log('🧪 testmode: Simulating open all doors');
            const totalDoors = sessionDevice.value?.thedoors?.length || 10;
            for (let i = 0; i < totalDoors; i++) {
              setOpeningDoorsProgress({ current: i + 1, total: totalDoors });
              console.log(`🧪 testmode: Simulated opening door ${i + 1}`);
              await Promise.delay(100); // Faster simulation
            }
            setOpeningDoorsProgress(null);
            setModal_openAllDoors(false);
            setModal_confirmCleanupAction(null);
            setLoading(false);
            break;
          }

          // Get integrations from localStorage (saved by App.tsx)
          const cachedIntegrations = localStorage.getItem('integrations');
          let integrations = [];

          if (cachedIntegrations) {
            try {
              const integrationsObj = JSON.parse(cachedIntegrations);
              // Convert object to array if needed
              integrations = Array.isArray(integrationsObj) ? integrationsObj : Object.values(integrationsObj);
            } catch (error) {
              console.error('Error parsing integrations:', error);
            }
          }

          // If we have integrations, use the first one's MAC and IP
          if (integrations.length > 0) {
            const integration = integrations[0];
            const mac = integration.macId || integration.mac;
            const ip = integration.ip;

            console.log(`Opening doors 1, 2, 3, 4 using integration MAC: ${mac}, IP: ${ip}`);

            // Open doors sequentially with 300ms interval
            const electron = (window as any).electron;
            const doorNumbers = sessionDevice.value.thedoors.map((door: any) => door.doorNumber);
            const totalDoors = doorNumbers.length;

            for (let i = 0; i < doorNumbers.length; i++) {
              const doorNumber = doorNumbers[i];
              setOpeningDoorsProgress({ current: i + 1, total: totalDoors });
              console.log(`Opening door ${doorNumber}...`);
              try {
                await electron.sideeventNative.openLockerDoor(doorNumber, mac, ip);
                console.log(`Door ${doorNumber} opened successfully`);
                await Promise.delay(300);
              } catch (error) {
                console.error(`Error opening door ${doorNumber}:`, error);
              }
            }
          } else {
            // Fallback to old behavior if no integrations found
            console.log('No integrations found, using device doors');
            const locks: any = sessionDevice.value.thedoors;
            const totalDoors = locks.length;

            for (let i = 0; i < locks.length; i++) {
              const lock = locks[i];
              setOpeningDoorsProgress({ current: i + 1, total: totalDoors });
              const mac = sessionDevice.value.settings.macid;
              const openDoorResult = await openDoor(mac, lock.door);
              await Promise.delay(300);
            }
          }

          setOpeningDoorsProgress(null);
          setModal_openAllDoors(false);
          setModal_confirmCleanupAction(null);
          setLoading(false);

        break;
      case 'removeAllCancelled':
        processNextCancelledHold(undefined, undefined, 'cancelled');
        setViewMainView(false);
        setModal_confirmCleanupAction(null);
        setLoading(false);
        setViewRemoveAllCancelled(true);
        break;

      case 'removeAllExpiredSmartConsolidation':
        processNextCancelledHold(undefined, undefined, 'expired');
        setViewRemoveAllCancelled(true);
        setViewMainView(false);
        setModal_confirmCleanupAction(null);
        setLoading(false);
        break;

      case 'removeCancelledAndExpired':
        processNextCancelledHold(undefined, undefined, 'hybrid');
        setViewRemoveAllCancelled(true);
        setViewMainView(false);
        setModal_confirmCleanupAction(null);
        setLoading(false);
        break;

      case 'removeAllExpired':
        processNextExpiredHold();
        setViewMainView(false);
        setModal_confirmCleanupAction(null);
        setLoading(false);
        setViewRemoveAllExpired(true);

        break;
      case 'removeAllLeftBehind':
        processNextCancelledHold(undefined, undefined, 'leftbehind');
        setViewRemoveAllCancelled(true);
        setViewMainView(false);
        setModal_confirmCleanupAction(null);
        setLoading(false);
        break;
      case 'removeAllReturned':
        setViewRemoveAllReturned(true);
        setModal_confirmCleanupAction(null);
        setLoading(false);
        break;
      case 'inspection':
        processNextInspection();
        setViewInspection(true);
        setViewMainView(false);
        setModal_confirmCleanupAction(null);
        setLoading(false);
        break;
      default:
        setModal_confirmCleanupAction(null);
        setLoading(false);
        break;
    }
  }

  function getDoorCount(): any {
    return sessionDevice.value?.thedoors ? sessionDevice.value.thedoors.length : 0
  }





  const dividerStyle = {
    ...getTextStyle({
      borderColor: 'white',
      color: 'white'
    },5),
    zIndex: 1,
    '& .antDividerInnerText': {
      zIndex: 1,
    }
  };



  const increaseFontSize = () => {
    const result = Math.min(fontSize.value + 2, 30);
    updateFontSizeStorage(result);
  };

  const decreaseFontSize = () => {
    const result = Math.max(fontSize.value - 2, 16);
    updateFontSizeStorage(result);
  };


  const fontControlStyle: React.CSSProperties = {
    position: 'fixed',
    top: '20px',
    right: '20px',
    display: 'flex',
    gap: '10px',
    zIndex: 1000,
  };

  const removeDoor = async (door: number) => {
    for (const groupName in sessionDevice.value.manifest.groups) {
      const group = sessionDevice.value.manifest.groups[groupName];
      if (group.name.toLowerCase() === 'holds') {
        for (const locker in sessionDevice.value.manifest.groups[groupName].lockers) {
          if (+locker === door) {
            delete sessionDevice.value.manifest.groups[groupName].lockers[locker];
            const key = _.findIndex(sessionDevice.value.manifest.groups[groupName].reserved_locks, a => a === +locker)
            if (key != -1)
              sessionDevice.value.manifest.groups[groupName].reserved_locks.splice(key, 1);
            break;
          }
        }
      }
    }
    persistDeviceManifestChanges(sessionDevice.value.manifest);

  }

  const getNextHandpickCancelledDoor = () => {
    let expiredLockers = getCancelledLockersDoors();
    const currentDoor = expiredLockers.shift();
    return currentDoor;
  }


  function setCurrentLockerTitles(locker: any, currentDoor: number) {
    if (locker.titles) {
      locker.titles.map((title: any) => {
        setRemoveTitlesFromLockerOneLockerAtTheTime([...removeTitlesFromLockerOneLockerAtTheTime, {locker: currentDoor, title: title, itemId: locker.itemId}]);
      });
    }
    if (!removeTitlesFromLockerOneLockerAtTheTime.length) {
      locker.itemId.split(',').map((itemId: any, index: number) => {
        setRemoveTitlesFromLockerOneLockerAtTheTime([...removeTitlesFromLockerOneLockerAtTheTime, {locker: currentDoor, title: 'Test '+index + 1 , itemId: locker.itemId}]);
      });
    }
    return removeTitlesFromLockerOneLockerAtTheTime;
  }

  const processCurrentHandpickCancelledDoor = async (init = false, processCurrentLocker: boolean) => {

    setViewRemoveAllCancelled(false);
    const currentDoor = getNextHandpickCancelledDoor();
    let locker

    // Check if sessionDevice.value.config.locker exists and has groups
    if (sessionDevice.value?.config?.locker?.groups) {
      for (const group of sessionDevice.value.manifest.groups) {
        if (group?.name === 'Holds' && group?.lockers) {
          for (const index in group.lockers) {
            if (+index === currentDoor) {
              locker = group.lockers[index];
            }
          }
        }
      }
    }

    setRemoveTitlesFromLockerOneLockerAtTheTime([]);

    if (locker) {
      setCurrentLockerTitles(locker, currentDoor);
    }
    if (init) {
      setViewRemoveAllCancelled(true);
    }

    if (processCurrentLocker) {
      await removeDoor(currentDoor);
    } else {
      return;
    }


    const nextDoor = getNextHandpickCancelledDoor();
    if (nextDoor) {
      setModal_removeTitles(true);

      setLoading(true);
      openDoor(sessionDevice.value.settings.macid, nextDoor);
    } else {
      setModal_removeTitles(false);
      setLoading(false);
    }
  }


  const getNextHandpickCleanupDoor = () => {
    let expiredLockers = getExpiredHoldLockersDoors();
    const currentDoor = expiredLockers.shift();
    return currentDoor;
  }

  const processCurrentHandpickDoor = async (processCurrentLocker: boolean) => {

    const currentDoor = getNextHandpickCleanupDoor();

    if (processCurrentLocker) {
      await removeDoor(currentDoor);
    } else {
      setCleanOpenedDoor(false);
      return;
    }


    const nextDoor = getNextHandpickCleanupDoor();
    if (nextDoor) {
      setLoading(true);
      openDoor(sessionDevice.value.settings.macid, nextDoor);
    } else {
      setCleanOpenedDoor(false);
      setLoading(false);
    }
  }


const mainHtmlTools = () => {
  return (
    <>
      <div style={{ marginBottom: '20px', textAlign: 'left' }}>
        <p style={{ ...getTextStyle({ color: 'rgba(255,255,255,0.7)', margin: '5px 0 0 0', textAlign: 'left' }, 8) }}>
          View manifest, pull lists, settings, and other administrative tools
        </p>
      </div>
     <div className="sweet-loading" style={stylePage}>
        <Spin size="large" spinning={loading} />




        {loading ? (
          ''
        ) : (
          <>
           {/* Add the font size controls here */}
            <Row gutter={[16, 16]}>
              <Col span={8}>
                <Card style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '300px',
                  }}
                  cover={
                    <svg width="70" height="70" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{color: '#42A4DE', position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -100%)'}}>
                      <path d="M21 10C21 10 18.995 7.26822 17.3662 5.63824C15.7373 4.00827 13 2 13 2M3 14C3 14 5.00504 16.7318 6.63382 18.3618C8.26261 19.9917 11 22 11 22M20 2L13 9M4 22L11 15" stroke="#42A4DE" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M3 3L10 10M14 14L21 21" stroke="#42A4DE" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  }
                  onClick={() => {
                    updateShowBackgroundImage(false);
                    updateSessionBackgroundImage(null);
                    localStorage.clear();
                    window.location.reload();
                  }}>

                  <Meta
                  style={{
                    marginTop: '20px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    color: '#42A4DE',
                    position: 'absolute',
                    backgroundColor: 'rgba(255,255,255,0.0)',
                    bottom: '10px',
                    width: '90%',
                    textAlign: 'center',
                  }}
                  title={<span style={{...getTextStyle({color: '#42A4DE'})}}>Reset Storage</span>}
                  description={<span style={{...getTextStyle({color: '#42A4DE'})}}>Clear local storage</span>}
                />
                </Card>
              </Col>
              <Col span={8}>
                <Card style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '300px',
                  }}
                  cover={
                    <svg width="70" height="70" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{color: '#42A4DE', position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -100%)'}}>
                      <path d="M9 12H15M9 16H15M17 21H7C5.89543 21 5 20.1046 5 19V5C5 3.89543 5.89543 3 7 3H12.5858C12.851 3 13.1054 3.10536 13.2929 3.29289L18.7071 8.70711C18.8946 8.89464 19 9.149 19 9.41421V19C19 20.1046 18.1046 21 17 21Z" stroke="#42A4DE" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M13 3V8C13 8.55228 13.4477 9 14 9H19" stroke="#42A4DE" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  }
                  onClick={() => {
                    setModal_showManifest(true);
                  }}>

                  <Meta
                  style={{
                    marginTop: '20px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    color: '#42A4DE',
                    position: 'absolute',
                    backgroundColor: 'rgba(255,255,255,0.0)',
                    bottom: '10px',
                    width: '90%',
                    textAlign: 'center',
                  }}
                  title={<span style={{...getTextStyle({color: '#42A4DE'})}}>Show Manifest</span>}
                  description={<span style={{...getTextStyle({color: '#42A4DE'})}}>View device manifest</span>}
                />
                </Card>
              </Col>

              <Col span={8}>
                {(() => {
                  const isPolarisEnabled = sessionBranch.value?.polarisSettings?.enabled === true;
                  const cardColor = isPolarisEnabled ? '#42A4DE' : '#9ca3af';
                  return (
                    <Card style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        height: '300px',
                        opacity: isPolarisEnabled ? 1 : 0.5,
                        cursor: isPolarisEnabled ? 'pointer' : 'not-allowed',
                      }}
                      cover={
                        <svg width="70" height="70" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{color: cardColor, position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -100%)'}}>
                          <path d="M9 5H7C5.89543 5 5 5.89543 5 7V19C5 20.1046 5.89543 21 7 21H17C18.1046 21 19 20.1046 19 19V7C19 5.89543 18.1046 5 17 5H15M9 5C9 6.10457 9.89543 7 11 7H13C14.1046 7 15 6.10457 15 5M9 5C9 3.89543 9.89543 3 11 3H13C14.1046 3 15 3.89543 15 5M12 12H15M12 16H15M9 12H9.01M9 16H9.01" stroke={cardColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      }
                      onClick={() => {
                        if (isPolarisEnabled) {
                          setModal_showPullList(true);
                        } else {
                          customToast(() => 'Pull List requires Polaris to be enabled', 2000, 'default', 'dark');
                        }
                      }}>

                      <Meta
                      style={{
                        marginTop: '20px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        color: cardColor,
                        position: 'absolute',
                        backgroundColor: 'rgba(255,255,255,0.0)',
                        bottom: '10px',
                        width: '90%',
                        textAlign: 'center',
                      }}
                      title={<span style={{...getTextStyle({color: cardColor})}}>Pull List</span>}
                      description={<span style={{...getTextStyle({color: cardColor})}}>{isPolarisEnabled ? 'View items in lockers' : 'Polaris not enabled'}</span>}
                    />
                    </Card>
                  );
                })()}
              </Col>

              <Col span={8}>
                <Card style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '300px',
                  }}
                  cover={
                    <svg width="70" height="70" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{color: '#42A4DE', position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -100%)'}}>
                      <path d="M4 17L10 11L4 5" stroke="#42A4DE" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M12 19H20" stroke="#42A4DE" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  }
                  onClick={() => {
                    setModal_showCmdCommands(true);
                  }}>

                  <Meta
                  style={{
                    marginTop: '20px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    color: '#42A4DE',
                    position: 'absolute',
                    backgroundColor: 'rgba(255,255,255,0.0)',
                    bottom: '10px',
                    width: '90%',
                    textAlign: 'center',
                  }}
                  title={<span style={{...getTextStyle({color: '#42A4DE'})}}>CMD Commands</span>}
                  description={<span style={{...getTextStyle({color: '#42A4DE'})}}>System commands</span>}
                />
                </Card>
              </Col>

            </Row>

            <Row>
              <Divider style={dividerStyle}> {t('ADMIN.SCANNER.TITLE')} </Divider>
            </Row>

            <Row justify="start" gutter={[16, 16]}>
              <Col span={24} style={{...getTextStyle({color: 'white', textAlign: 'left'}, 5)}}>
                {t('ADMIN.SCANNER.DESCRIPTION')}
              </Col>

              <Col span={12} style={{...getTextStyle({color: 'white', textAlign: 'left'})}}>
                {t('ADMIN_BARCODE', {barcode: currentBarcode.value})}
              </Col>
              <Col span={12} style={{...getTextStyle({color: 'white', textAlign: 'left'})}}>
                {t('ADMIN_LASTBARCODE', {barcode: previousBarcode.value})}
              </Col>
            </Row>

          </>
        )}



      </div>

    </>
  )
}


const mainHtmlWorkflows = () => {
  // Check if workflows are enabled based on branch settings
  const isSip2Enabled = sessionBranch.value?.sip2Settings?.enabled === true;
  const isPolarisEnabled = sessionBranch.value?.polarisSettings?.enabled === true;
  const isSymphonyEnabled = sessionBranch.value?.symphonySettings?.enabled === true;

  const openWorkflowWizard = (type: 'sip2' | 'sip2lot' | 'polaris' | 'polarislot' | 'symphony' | 'symphonylot') => {
    setWorkflowWizardType(type);
    setWorkflowWizardStep(0);
    // Polaris/Symphony (Add Hold, scan item) has 2 steps, others have 3 steps
    if (type === 'polaris' || type === 'symphony') {
      setWorkflowWizardStepStatus(['pending', 'pending']);
      setWorkflowWizardStepResults([null, null]);
    } else {
      setWorkflowWizardStepStatus(['pending', 'pending', 'pending']);
      setWorkflowWizardStepResults([null, null, null]);
    }
    setWorkflowWizardRunning(false);
    setWorkflowWizardItemId('');
    setWorkflowWizardItemInfoSent(false);
    setWorkflowWizardHasHold(null);
    setWorkflowWizardCircStatus(null);
    setWorkflowWizardPatronId(null);
    setWorkflowWizardVerifyCircStatus(null);
    setWorkflowWizardDoorNumber(null);
    setWorkflowWizardItemFound(null);
    setWorkflowWizardHoldExpiration(null);
    setWorkflowWizardIsReturn(false);
    setWorkflowWizardSelectedGroup(null);
    setWorkflowWizardOpen(true);
  };

  const handleSip2Workflow = () => openWorkflowWizard('sip2');
  const handleSip2LotWorkflow = () => openWorkflowWizard('sip2lot');
  const handlePolarisWorkflow = () => openWorkflowWizard('polaris');
  const handlePolarisLotWorkflow = () => openWorkflowWizard('polarislot');
  const handleSymphonyWorkflow = () => openWorkflowWizard('symphony');
  const handleSymphonyLotWorkflow = () => openWorkflowWizard('symphonylot');

  return (
    <>
      <div style={{ marginBottom: '20px', textAlign: 'left' }}>
        <p style={{ ...getTextStyle({ color: 'rgba(255,255,255,0.7)', margin: '5px 0 0 0', textAlign: 'left' }, 8) }}>
          ILS integration workflows for SIP2, Polaris, and Symphony systems. Simulation will use real ILS endpoints with real itemId to test the workflow how scanned itemId would be located if scanned at the welcomescreen
        </p>
      </div>
      {/* First row: Add Hold workflows - show for Hold lockers */}
      {!isLoT && <Row gutter={[16, 16]}>
        {/* SIP2 Workflow */}
        <Col span={8}>
          <Card
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '300px',
              opacity: isSip2Enabled ? 1 : 0.5,
              cursor: isSip2Enabled ? 'pointer' : 'not-allowed',
            }}
            cover={
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -100%)',
                backgroundColor: isSip2Enabled ? '#1890ff' : '#9ca3af',
                color: 'white',
                padding: '20px 30px',
                borderRadius: '12px',
                fontSize: '24px',
                fontWeight: 'bold',
              }}>
                SIP2 (Add Hold, scan item)
              </div>
            }
            onClick={() => {
              if (isSip2Enabled) {
                handleSip2Workflow();
              }
            }}
          >
            <Meta
              style={{
                marginTop: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                color: isSip2Enabled ? '#42A4DE' : '#9ca3af',
                position: 'absolute',
                backgroundColor: 'rgba(255,255,255,0.0)',
                bottom: '10px',
                width: '90%',
                textAlign: 'center',
              }}
              title={<span style={{...getTextStyle({color: isSip2Enabled ? '#42A4DE' : '#9ca3af'})}}>Simulate adding a hold to locker using SIP2</span>}
              description={<span style={{...getTextStyle({color: isSip2Enabled ? '#42A4DE' : '#9ca3af'})}}>
                {isSip2Enabled ? 'Standard SIP2 protocol' : 'Not enabled'}
              </span>}
            />
          </Card>
        </Col>

        {/* Polaris Workflow */}
        <Col span={8}>
          <Card
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '300px',
              opacity: isPolarisEnabled ? 1 : 0.5,
              cursor: isPolarisEnabled ? 'pointer' : 'not-allowed',
            }}
            cover={
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -100%)',
                backgroundColor: isPolarisEnabled ? '#722ed1' : '#9ca3af',
                color: 'white',
                padding: '20px 30px',
                borderRadius: '12px',
                fontSize: '24px',
                fontWeight: 'bold',
              }}>
                Polaris (Add Hold, scan item)
              </div>
            }
            onClick={() => {
              if (isPolarisEnabled) {
                handlePolarisWorkflow();
              }
            }}
          >
            <Meta
              style={{
                marginTop: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                color: isPolarisEnabled ? '#42A4DE' : '#9ca3af',
                position: 'absolute',
                backgroundColor: 'rgba(255,255,255,0.0)',
                bottom: '10px',
                width: '90%',
                textAlign: 'center',
              }}
              title={<span style={{...getTextStyle({color: isPolarisEnabled ? '#42A4DE' : '#9ca3af'})}}>Simulate adding a hold to locker using Polaris</span>}
              description={<span style={{...getTextStyle({color: isPolarisEnabled ? '#42A4DE' : '#9ca3af'})}}>
                {isPolarisEnabled ? 'Innovative Polaris API' : 'Not enabled'}
              </span>}
            />
          </Card>
        </Col>

        {/* Symphony Workflow */}
        <Col span={8}>
          <Card
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '300px',
              opacity: isSymphonyEnabled ? 1 : 0.5,
              cursor: isSymphonyEnabled ? 'pointer' : 'not-allowed',
            }}
            cover={
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -100%)',
                backgroundColor: isSymphonyEnabled ? '#52c41a' : '#9ca3af',
                color: 'white',
                padding: '20px 30px',
                borderRadius: '12px',
                fontSize: '24px',
                fontWeight: 'bold',
              }}>
                Symphony (Add Hold, scan item)
              </div>
            }
            onClick={() => {
              if (isSymphonyEnabled) {
                handleSymphonyWorkflow();
              }
            }}
          >
            <Meta
              style={{
                marginTop: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                color: isSymphonyEnabled ? '#42A4DE' : '#9ca3af',
                position: 'absolute',
                backgroundColor: 'rgba(255,255,255,0.0)',
                bottom: '10px',
                width: '90%',
                textAlign: 'center',
              }}
              title={<span style={{...getTextStyle({color: isSymphonyEnabled ? '#42A4DE' : '#9ca3af'})}}>Simulate adding a hold to locker using Symphony</span>}
              description={<span style={{...getTextStyle({color: isSymphonyEnabled ? '#42A4DE' : '#9ca3af'})}}>
                {isSymphonyEnabled ? 'SirsiDynix Symphony' : 'Not enabled'}
              </span>}
            />
          </Card>
        </Col>
      </Row>}

      {/* Second row: LoT Scan Item buttons - show for LoT lockers */}
      {isLoT && <Row gutter={[16, 16]} style={{ marginTop: '32px' }}>
        {/* SIP2 LoT Scan Item */}
        <Col span={8}>
          <Card
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '300px',
              opacity: isSip2Enabled ? 1 : 0.5,
              cursor: isSip2Enabled ? 'pointer' : 'not-allowed',
            }}
            cover={
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -100%)',
                backgroundColor: isSip2Enabled ? '#1890ff' : '#9ca3af',
                color: 'white',
                padding: '20px 30px',
                borderRadius: '12px',
                fontSize: '24px',
                fontWeight: 'bold',
              }}>
                SIP2 (LoT, scan item)
              </div>
            }
            onClick={() => {
              if (isSip2Enabled) {
                handleSip2LotWorkflow();
              }
            }}
          >
            <Meta
              style={{
                marginTop: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                color: isSip2Enabled ? '#42A4DE' : '#9ca3af',
                position: 'absolute',
                backgroundColor: 'rgba(255,255,255,0.0)',
                bottom: '10px',
                width: '90%',
                textAlign: 'center',
              }}
              title={<span style={{...getTextStyle({color: isSip2Enabled ? '#42A4DE' : '#9ca3af'})}}>Simulate scanning an item into locker using SIP2 - will it be a return or load into selected group?</span>}
              description={<span style={{...getTextStyle({color: isSip2Enabled ? '#42A4DE' : '#9ca3af'})}}>
                {isSip2Enabled ? 'Standard SIP2 protocol' : 'Not enabled'}
              </span>}
            />
          </Card>
        </Col>

        {/* Polaris LoT Scan Item */}
        <Col span={8}>
          <Card
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '300px',
              opacity: isPolarisEnabled ? 1 : 0.5,
              cursor: isPolarisEnabled ? 'pointer' : 'not-allowed',
            }}
            cover={
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -100%)',
                backgroundColor: isPolarisEnabled ? '#722ed1' : '#9ca3af',
                color: 'white',
                padding: '20px 30px',
                borderRadius: '12px',
                fontSize: '24px',
                fontWeight: 'bold',
              }}>
                Polaris (LoT, scan item)
              </div>
            }
            onClick={() => {
              if (isPolarisEnabled) {
                handlePolarisLotWorkflow();
              }
            }}
          >
            <Meta
              style={{
                marginTop: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                color: isPolarisEnabled ? '#42A4DE' : '#9ca3af',
                position: 'absolute',
                backgroundColor: 'rgba(255,255,255,0.0)',
                bottom: '10px',
                width: '90%',
                textAlign: 'center',
              }}
              title={<span style={{...getTextStyle({color: isPolarisEnabled ? '#42A4DE' : '#9ca3af'})}}>Simulate scanning an item into locker using Polaris - will it be a check-in or load into selected group?</span>}
              description={<span style={{...getTextStyle({color: isPolarisEnabled ? '#42A4DE' : '#9ca3af'})}}>
                {isPolarisEnabled ? 'Innovative Polaris API' : 'Not enabled'}
              </span>}
            />
          </Card>
        </Col>

        {/* Symphony LoT Scan Item */}
        <Col span={8}>
          <Card
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '300px',
              opacity: isSymphonyEnabled ? 1 : 0.5,
              cursor: isSymphonyEnabled ? 'pointer' : 'not-allowed',
            }}
            cover={
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -100%)',
                backgroundColor: isSymphonyEnabled ? '#52c41a' : '#9ca3af',
                color: 'white',
                padding: '20px 30px',
                borderRadius: '12px',
                fontSize: '24px',
                fontWeight: 'bold',
              }}>
                Symphony (LoT, scan item)
              </div>
            }
            onClick={() => {
              if (isSymphonyEnabled) {
                handleSymphonyLotWorkflow();
              }
            }}
          >
            <Meta
              style={{
                marginTop: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                color: isSymphonyEnabled ? '#42A4DE' : '#9ca3af',
                position: 'absolute',
                backgroundColor: 'rgba(255,255,255,0.0)',
                bottom: '10px',
                width: '90%',
                textAlign: 'center',
              }}
              title={<span style={{...getTextStyle({color: isSymphonyEnabled ? '#42A4DE' : '#9ca3af'})}}>Simulate scanning an item into locker using Symphony - will it be a return or load into selected group?</span>}
              description={<span style={{...getTextStyle({color: isSymphonyEnabled ? '#42A4DE' : '#9ca3af'})}}>
                {isSymphonyEnabled ? 'SirsiDynix Symphony' : 'Not enabled'}
              </span>}
            />
          </Card>
        </Col>
      </Row>}
    </>
  )
}

const badgeStyle: React.CSSProperties = {
  zoom: 1.5,
}


const mainHtmlCleanup = () => {
  const isCombinedButton = !isLoT && sessionDevice.value?.settings?.useSmartConsolidation && getExpiredHoldLockersCount() > 0 && getExpiredCancelledLockersCount() > 0;
  // Count visible cards: LoT shows inspection only; non-LoT shows expired/cancelled (or combined) + left behind
  let visibleCards = 0;
  if (isLoT) {
    visibleCards = 1; // inspection only
  } else {
    visibleCards += isCombinedButton ? 1 : 2; // combined OR (expired + cancelled)
    visibleCards += 1; // left behind
  }
  const cleanupColSpan = visibleCards <= 2 ? 12 : 8;

  return (
    <div style={{ overflow: 'hidden', width: '100%', boxSizing: 'border-box' }}>

    <div style={{ marginBottom: '20px', textAlign: 'left' }}>
      <p style={{ ...getTextStyle({ color: 'rgba(255,255,255,0.7)', margin: '5px 0 0 0', textAlign: 'left' }, 8) }}>
        Manage expired holds, cancelled items, left behind materials, and locker inspections
      </p>
    </div>

    <Row gutter={[16, 16]}>

      {/* When useSmartConsolidation + both expired AND cancelled have counts → ONE combined button */}
      {!isLoT && sessionDevice.value?.settings?.useSmartConsolidation && getExpiredHoldLockersCount() > 0 && getExpiredCancelledLockersCount() > 0 && <Col span={cleanupColSpan}>
        <Card
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '300px',
          }}
          cover={
            <Badge showZero={true} count={getExpiredHoldLockersCount() + getExpiredCancelledLockersCount()} color='red' offset={[25, -40]} size="default" style={badgeStyle}>
              <TbPackageExport style={{color: '#42A4DE', position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -100%)'}} size={70}/>
            </Badge>
          }
          onClick={() => {
            setModal_confirmCleanupAction(CleanupAction.REMOVE_CANCELLED_AND_EXPIRED);
            setModal_confirmCleanupActionTitle('Cleanup Cancelled & Expired Holds');
            setModal_confirmCleanupActionBody(`Cancelled: ${getExpiredCancelledLockersCount()} doors\nExpired: ${getExpiredHoldLockersCount()} doors\n\nDoors are processed one by one. Follow the instructions on the screen.`);
            setModal_showConfirmCleanup(true);
          }}
        >
          <Meta
            style={{
              marginTop: '20px',
              left: '50%',
              transform: 'translateX(-50%)',
              color: '#42A4DE',
              position: 'absolute',
              backgroundColor: 'rgba(255,255,255,0.0)',
              bottom: '10px',
              width: '90%',
              textAlign: 'center',
            }}
            title={<span style={{...getTextStyle({color: '#42A4DE'})}}>Cancelled & Expired</span>}
            description={<span style={{...getTextStyle({color: '#42A4DE'})}}>Cleanup cancelled & expired holds</span>}
          />
        </Card>
      </Col>}

      {/* Expired card — shown when NOT combined */}
      {!isLoT && !(sessionDevice.value?.settings?.useSmartConsolidation && getExpiredHoldLockersCount() > 0 && getExpiredCancelledLockersCount() > 0) && <Col span={cleanupColSpan}>
        <Card
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '300px',
          }}
          cover={
            <Badge showZero={true} count={getExpiredHoldLockersCount()} color={getExpiredHoldLockersCount() > 0 ? 'red' : 'gray'} offset={[25, -40]} size="default" style={badgeStyle}>
              <TbPackageExport style={{color: '#42A4DE', position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -100%)'}} size={70}/>
            </Badge>
          }
          onClick={() => {
            const expiredDoors = getExpiredHoldLockersDoors();
            if (expiredDoors.length === 0) {
              customToast(() => 'No expired holds', 2000, 'default', 'dark');
            } else {
              const doorsListStr = expiredDoors.join(', ');
              if (sessionDevice.value?.settings?.useSmartConsolidation) {
                setModal_confirmCleanupAction(CleanupAction.REMOVE_ALL_EXPIRED_SMART_CONSOLIDATION);
                setModal_confirmCleanupActionTitle(t('ADMIN.CLEANUP.REMOVE_ALL_EXPIRED_SMART_CONSOLIDATION_TILE'));
                setModal_confirmCleanupActionBody(`${t('ADMIN.CLEANUP.REMOVE_ALL_EXPIRED_SMART_CONSOLIDATION_BODY')}\n\nDoors (${expiredDoors.length}): ${doorsListStr}`);
              } else {
                setModal_confirmCleanupAction(CleanupAction.REMOVE_ALL_EXPIRED);
                setModal_confirmCleanupActionTitle(t('ADMIN.CLEANUP.REMOVE_ALL_EXPIRED_TILE'));
                setModal_confirmCleanupActionBody(`${t('ADMIN.CLEANUP.REMOVE_ALL_EXPIRED_BODY')}\n\nDoors (${expiredDoors.length}): ${doorsListStr}`);
              }
              setModal_showConfirmCleanup(true);
            }
          }}
        >
          <Meta
            style={{
              marginTop: '20px',
              left: '50%',
              transform: 'translateX(-50%)',
              color: '#42A4DE',
              position: 'absolute',
              backgroundColor: 'rgba(255,255,255,0.0)',
              bottom: '10px',
              width: '90%',
              textAlign: 'center',
            }}
            title={<span style={{...getTextStyle({color: '#42A4DE'})}}>{t('ADMIN.DOOR.EXPIRED')}</span>}
            description={<span style={{...getTextStyle({color: '#42A4DE'})}}>{t('ADMIN.DOOR.EXPIREDDESCRIPTION')}</span>}
          />
        </Card>
      </Col>}

      {/* Cancelled card — shown when NOT combined */}
      {!isLoT && !(sessionDevice.value?.settings?.useSmartConsolidation && getExpiredHoldLockersCount() > 0 && getExpiredCancelledLockersCount() > 0) && <Col span={cleanupColSpan}>
        <Card
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '300px',
          }}
          cover={
            <Badge showZero={true} count={getExpiredCancelledLockersCount()} color={getExpiredCancelledLockersCount() > 0 ? 'red' : 'gray'} offset={[25, -40]} size="default" style={badgeStyle}>
              <MdOutlineCancel style={{color: '#42A4DE', position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -100%)'}} size={70}/>
            </Badge>
          }
          onClick={() => {
            if (getExpiredCancelledLockersCount() === 0) {
              customToast(() => 'No expired cancelled holds', 2000, 'default', 'dark');
            } else {
              setModal_confirmCleanupAction(CleanupAction.REMOVE_ALL_CANCELLED);
              setModal_confirmCleanupActionTitle(t('ADMIN.CLEANUP.REMOVE_ALL_CANCELLED_TILE'));
              setModal_confirmCleanupActionBody(t('ADMIN.CLEANUP.REMOVE_ALL_CANCELLED_BODY'));
              setModal_showConfirmCleanup(true);
            }
          }}
        >
          <Meta
            style={{
              marginTop: '20px',
              left: '50%',
              transform: 'translateX(-50%)',
              color: '#42A4DE',
              position: 'absolute',
              backgroundColor: 'rgba(255,255,255,0.0)',
              bottom: '10px',
              width: '90%',
              textAlign: 'center',
            }}
            title={<span style={{...getTextStyle({color: '#42A4DE'})}}>{t('ADMIN.DOOR.CANCELLED')}</span>}
            description={<span style={{...getTextStyle({color: '#42A4DE'})}}>{t('ADMIN.DOOR.CANCELLEDDESCRIPTION')}</span>}
          />
        </Card>
      </Col>}
      {/* Inspection card — only visible on LoT lockers */}
      {isLoT && <Col span={cleanupColSpan}>
        <Card
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '300px',
          }}
          cover={
            <Badge showZero={true} count={getConditionCheckCount()} color={getConditionCheckCount() > 0 ? 'orange' : 'gray'} offset={[25, -40]} size="default" style={badgeStyle}>
              <MdPersonSearch style={{color: '#42A4DE', position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -100%)'}} size={70}/>
            </Badge>
          }
          onClick={() => {
            if (getConditionCheckCount() === 0) {
              customToast(() => 'No items for inspection', 2000, 'default', 'dark');
            } else {
              setModal_confirmCleanupAction(CleanupAction.INSPECTION);
              setModal_confirmCleanupActionTitle('Inspection');
              setModal_confirmCleanupActionBody(`There are ${getConditionCheckCount()} item(s) pending condition inspection. Each door will be opened individually for you to review the item and decide whether to return it to circulation or keep it aside.`);
              setModal_showConfirmCleanup(true);
            }
          }}
        >
          <Meta
            style={{
              marginTop: '20px',
              left: '50%',
              transform: 'translateX(-50%)',
              color: '#42A4DE',
              position: 'absolute',
              backgroundColor: 'rgba(255,255,255,0.0)',
              bottom: '10px',
              width: '90%',
              textAlign: 'center',
            }}
            title={<span style={{...getTextStyle({color: '#42A4DE'})}}>Inspection</span>}
            description={<span style={{...getTextStyle({color: '#42A4DE'})}}>Review condition check items</span>}
          />
        </Card>
      </Col>}

      {/* Left behind — always last */}
      {!isLoT && <Col span={cleanupColSpan}>
        <Card
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '300px',
          }}
          cover={
            <Badge showZero={true} count={getLeftBehindLockersCount()} color={getLeftBehindLockersCount() > 0 ? 'red' : 'gray'} offset={[25, -40]} size="default" style={badgeStyle}>
              <BiPackage style={{color: '#42A4DE', position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -100%)'}} size={70}/>
            </Badge>
          }
          onClick={() => {
            if (getLeftBehindLockersCount() === 0) {
              customToast(() => 'No left behind items', 2000, 'default', 'dark');
            } else {
              setModal_confirmCleanupAction(CleanupAction.REMOVE_ALL_LEFT_BEHIND);
              setModal_confirmCleanupActionTitle('Remove all left behind items');
              setModal_confirmCleanupActionBody('You are about to remove all left behind items. Doors are processed one by one. Follow the instructions on the screen');
              setModal_showConfirmCleanup(true);
            }
          }}
        >
          <Meta
            style={{
              marginTop: '20px',
              left: '50%',
              transform: 'translateX(-50%)',
              color: '#42A4DE',
              position: 'absolute',
              backgroundColor: 'rgba(255,255,255,0.0)',
              bottom: '10px',
              width: '90%',
              textAlign: 'center',
            }}
            title={<span style={{...getTextStyle({color: '#42A4DE'})}}>{t('ADMIN.DOOR.LEFTBEHIND')}</span>}
            description={<span style={{...getTextStyle({color: '#42A4DE'})}}>{t('ADMIN.DOOR.LEFTBEHINDDESCRIPTION')}</span>}
          />
        </Card>
      </Col>}
    </Row>

    {/* Expired (Smart) standalone card removed — now handled in main row */}

    </div>
  )
}


  const getAllDoorButtons = (key: number) => {
    return (
      <>
        <Col span={sessionDevice.value?.thedoors?.length > 12 ? sessionDevice.value?.thedoors?.length > 60 ? 3 : 6 : 8}>
          <Button
            onClick={() => {
              setLoading(true);
              setModal_openDoorTitle(t('ADMIN.ADMIN_OPENDOOR', {door: key + 1}));
              setGivenDoorNumber(key+1);
              setModal_openGivenDoor(true);
            }}
            size="large" style={ {...getTextStyle({padding: 'auto', fontWeight: 'bold', margin: 'auto', height: 'auto', width: '100%', color: SEBlue.value})}}>
            {sessionDevice.value?.thedoors?.length > 60 ? '# ' + (key + 1) : 'Door # ' + (key + 1)}
          </Button>
        </Col>
      </>
    )
  }

  const mainHtmlDoors = () => {
    const [showOpenGroupSelectModal, setShowOpenGroupSelectModal] = React.useState(false);
    const [selectedGroupsToOpen, setSelectedGroupsToOpen] = React.useState<string[]>([]);
    const [showConfirmWithItems, setShowConfirmWithItems] = React.useState(false);
    const [showConfirmEmptyLockers, setShowConfirmEmptyLockers] = React.useState(false);
    const [doorOpeningProgress, setDoorOpeningProgress] = React.useState<{current: number, total: number, label: string} | null>(null);

    // Get door data from device
    let doorsData = sessionDevice.value?.thedoors || [];

    // Helper to get color hex value
    const getColorHex = (colorName: string): string | undefined => {
      const colorMap: Record<string, string> = {
        slate: '#64748b', gray: '#6b7280', zinc: '#71717a', neutral: '#737373',
        stone: '#78716c', red: '#ef4444', orange: '#f97316', amber: '#f59e0b',
        yellow: '#eab308', lime: '#84cc16', green: '#22c55e', emerald: '#10b981',
        teal: '#14b8a6', cyan: '#06b6d4', sky: '#0ea5e9', blue: '#3b82f6',
        indigo: '#6366f1', violet: '#8b5cf6', purple: '#a855f7', fuchsia: '#d946ef',
        pink: '#ec4899', rose: '#f43f5e'
      };
      return colorMap[colorName?.toLowerCase()];
    };

    // Handle opening group select modal
    const handleOpenGroupSelect = async () => {
      const groups = sessionDevice.value?.manifest?.groups;
      if (groups) {
        const groupIds = Object.keys(groups);
        // If only one group, pre-select it
        if (groupIds.length === 1) {
          setSelectedGroupsToOpen([groupIds[0]]);
        } else {
          setSelectedGroupsToOpen([]);
        }
      } else {
        setSelectedGroupsToOpen([]);
      }
      setShowOpenGroupSelectModal(true);
    };

    // Open doors for specific groups
    const openGroupDoors = async (groupIds: string[]) => {
      try {
        setLoading(true);
        setDoorOpeningProgress({ current: 0, total: 0, label: 'Opening Group Doors' });
        const doorNumbersToOpen: number[] = [];

        for (const groupId of groupIds) {
          const group = sessionDevice.value?.manifest?.groups?.[groupId];
          if (!group) continue;
          const groupData = group as any;
          if (!groupData.lockers) continue;

          const lockers = Array.isArray(groupData.lockers) ? groupData.lockers : Object.values(groupData.lockers);
          for (const locker of lockers) {
            if (!locker) continue;
            const lockerData = locker as any;
            if (lockerData?.doorNumber) {
              doorNumbersToOpen.push(lockerData.doorNumber);
            }
          }
        }

        const uniqueDoorNumbers = [...new Set(doorNumbersToOpen)];
        const totalDoors = uniqueDoorNumbers.length;

        // Get integrations from localStorage
        const cachedIntegrations = localStorage.getItem('integrations');
        let integrations: any[] = [];

        if (cachedIntegrations) {
          try {
            const integrationsObj = JSON.parse(cachedIntegrations);
            integrations = Array.isArray(integrationsObj) ? integrationsObj : Object.values(integrationsObj);
          } catch (error) {
            console.error('Error parsing integrations:', error);
          }
        }

        if (integrations.length > 0) {
          const integration = integrations[0];
          const mac = integration.macId || integration.mac;
          const ip = integration.ip;

          console.log(`Opening ${uniqueDoorNumbers.length} doors using integration MAC: ${mac}, IP: ${ip}`);

          const electron = (window as any).electron;
          for (let i = 0; i < uniqueDoorNumbers.length; i++) {
            const doorNumber = uniqueDoorNumbers[i];
            setDoorOpeningProgress({ current: i + 1, total: totalDoors, label: 'Opening Group Doors' });
            console.log(`Opening door ${doorNumber}...`);
            try {
              await electron.sideeventNative.openLockerDoor(doorNumber, mac, ip);
              console.log(`Door ${doorNumber} opened successfully`);
              await Promise.delay(300);
            } catch (error) {
              console.error(`Error opening door ${doorNumber}:`, error);
            }
          }
        } else {
          console.log('No integrations found, using device settings');
          for (let i = 0; i < uniqueDoorNumbers.length; i++) {
            const doorNumber = uniqueDoorNumbers[i];
            setDoorOpeningProgress({ current: i + 1, total: totalDoors, label: 'Opening Group Doors' });
            await openDoor(sessionDevice.value.settings.macid, doorNumber);
            await Promise.delay(300);
          }
        }

        setDoorOpeningProgress(null);
        setLoading(false);
        customToast(() => `Opened ${uniqueDoorNumbers.length} door(s) successfully!`, 3000, 'success', 'dark');
      } catch (error: any) {
        setDoorOpeningProgress(null);
        setLoading(false);
        console.error('Error opening group doors:', error);
        customToast(() => `Failed to open doors: ${error.message}`, 3000, 'error', 'dark');
      }
    };

    // Toggle group selection
    const toggleGroupSelection = (groupId: string) => {
      setSelectedGroupsToOpen(prev => {
        const prevArray = Array.isArray(prev) ? prev : [];
        return prevArray.includes(groupId)
          ? prevArray.filter(id => id !== groupId)
          : [...prevArray, groupId];
      });
    };

    // Confirm and open selected groups
    const confirmOpenSelectedGroups = async () => {
      if (selectedGroupsToOpen.length === 0) {
        customToast(() => 'Please select at least one group', 2000, 'default', 'dark');
        return;
      }

      try {
        setLoading(true);
        setDoorOpeningProgress({ current: 0, total: 0, label: 'Opening Selected Doors' });
        const doorNumbersToOpen: number[] = [];

        // Handle special selections
        if (Array.isArray(selectedGroupsToOpen) && selectedGroupsToOpen.includes('all_with_items')) {
          // Get all doors with items
          if (sessionDevice.value?.manifest?.groups) {
            for (const group of Object.values(sessionDevice.value.manifest.groups)) {
              const groupData = group as any;
              if (!groupData.lockers) continue;
              const lockers = Array.isArray(groupData.lockers) ? groupData.lockers : Object.values(groupData.lockers);
              for (const locker of lockers) {
                if (!locker) continue;
                const lockerData = locker as any;
                if (lockerData?.doorNumber && lockerData.itemIds && Array.isArray(lockerData.itemIds) && lockerData.itemIds.length > 0) {
                  doorNumbersToOpen.push(lockerData.doorNumber);
                }
              }
            }
          }
        }

        if (Array.isArray(selectedGroupsToOpen) && selectedGroupsToOpen.includes('all_no_items')) {
          // Get all doors without items
          const usedDoors = new Set<number>();
          if (sessionDevice.value?.manifest?.groups) {
            for (const group of Object.values(sessionDevice.value.manifest.groups)) {
              const groupData = group as any;
              if (!groupData.lockers) continue;
              const lockers = Array.isArray(groupData.lockers) ? groupData.lockers : Object.values(groupData.lockers);
              for (const locker of lockers) {
                if (!locker) continue;
                const lockerData = locker as any;
                if (lockerData?.doorNumber) {
                  usedDoors.add(lockerData.doorNumber);
                }
              }
            }
          }
          const emptyDoors = doorsData.filter((door: any) => door.enabled && !usedDoors.has(door.doorNumber));
          doorNumbersToOpen.push(...emptyDoors.map((d: any) => d.doorNumber));
        }

        // Handle specific group selections
        for (const groupId of selectedGroupsToOpen) {
          if (groupId === 'all_with_items' || groupId === 'all_no_items') continue;

          const group = sessionDevice.value?.manifest?.groups?.[groupId];
          if (!group) continue;
          const groupData = group as any;
          if (!groupData.lockers) continue;

          const lockers = Array.isArray(groupData.lockers) ? groupData.lockers : Object.values(groupData.lockers);
          for (const locker of lockers) {
            if (!locker) continue;
            const lockerData = locker as any;
            if (lockerData?.doorNumber) {
              doorNumbersToOpen.push(lockerData.doorNumber);
            }
          }
        }

        // Remove duplicates
        const uniqueDoorNumbers = [...new Set(doorNumbersToOpen)];
        const totalDoors = uniqueDoorNumbers.length;

        // Get integrations from localStorage (saved by App.tsx)
        const cachedIntegrations = localStorage.getItem('integrations');
        let integrations: any[] = [];

        if (cachedIntegrations) {
          try {
            const integrationsObj = JSON.parse(cachedIntegrations);
            integrations = Array.isArray(integrationsObj) ? integrationsObj : Object.values(integrationsObj);
          } catch (error) {
            console.error('Error parsing integrations:', error);
          }
        }

        // If we have integrations, use the first one's MAC and IP
        if (integrations.length > 0) {
          const integration = integrations[0];
          const mac = integration.macId || integration.mac;
          const ip = integration.ip;

          console.log(`Opening ${uniqueDoorNumbers.length} doors using integration MAC: ${mac}, IP: ${ip}`);

          const electron = (window as any).electron;
          for (let i = 0; i < uniqueDoorNumbers.length; i++) {
            const doorNumber = uniqueDoorNumbers[i];
            setDoorOpeningProgress({ current: i + 1, total: totalDoors, label: 'Opening Selected Doors' });
            console.log(`Opening door ${doorNumber}...`);
            try {
              await electron.sideeventNative.openLockerDoor(doorNumber, mac, ip);
              console.log(`Door ${doorNumber} opened successfully`);
              await Promise.delay(300);
            } catch (error) {
              console.error(`Error opening door ${doorNumber}:`, error);
            }
          }
        } else {
          // Fallback to old behavior if no integrations found
          console.log('No integrations found, using device settings');
          for (let i = 0; i < uniqueDoorNumbers.length; i++) {
            const doorNumber = uniqueDoorNumbers[i];
            setDoorOpeningProgress({ current: i + 1, total: totalDoors, label: 'Opening Selected Doors' });
            await openDoor(sessionDevice.value.settings.macid, doorNumber);
            await Promise.delay(300);
          }
        }

        setDoorOpeningProgress(null);
        setLoading(false);
        customToast(() => `Opened ${uniqueDoorNumbers.length} door(s) successfully!`, 3000, 'success', 'dark');
        setShowOpenGroupSelectModal(false);
        setSelectedGroupsToOpen([]);
      } catch (error: any) {
        setDoorOpeningProgress(null);
        setLoading(false);
        console.error('Error opening doors:', error);
        customToast(() => `Failed to open doors: ${error.message}`, 3000, 'error', 'dark');
      }
    };

    // Open all doors with items
    const openDoorsWithItems = async () => {
      try {
        setLoading(true);
        setDoorOpeningProgress({ current: 0, total: 0, label: 'Opening Doors With Items' });
        const doorNumbersToOpen: number[] = [];

        if (sessionDevice.value?.manifest?.groups) {
          for (const group of Object.values(sessionDevice.value.manifest.groups)) {
            const groupData = group as any;
            if (!groupData.lockers) continue;
            const lockers = Array.isArray(groupData.lockers) ? groupData.lockers : Object.values(groupData.lockers);
            for (const locker of lockers) {
              if (!locker) continue;
              const lockerData = locker as any;
              if (lockerData?.doorNumber && lockerData.itemIds && Array.isArray(lockerData.itemIds) && lockerData.itemIds.length > 0) {
                doorNumbersToOpen.push(lockerData.doorNumber);
              }
            }
          }
        }

        const uniqueDoorNumbers = [...new Set(doorNumbersToOpen)];
        const totalDoors = uniqueDoorNumbers.length;

        // Get integrations from localStorage (saved by App.tsx)
        const cachedIntegrations = localStorage.getItem('integrations');
        let integrations: any[] = [];

        if (cachedIntegrations) {
          try {
            const integrationsObj = JSON.parse(cachedIntegrations);
            integrations = Array.isArray(integrationsObj) ? integrationsObj : Object.values(integrationsObj);
          } catch (error) {
            console.error('Error parsing integrations:', error);
          }
        }

        // If we have integrations, use the first one's MAC and IP
        if (integrations.length > 0) {
          const integration = integrations[0];
          const mac = integration.macId || integration.mac;
          const ip = integration.ip;

          console.log(`Opening ${uniqueDoorNumbers.length} doors with items using integration MAC: ${mac}, IP: ${ip}`);

          const electron = (window as any).electron;
          for (let i = 0; i < uniqueDoorNumbers.length; i++) {
            const doorNumber = uniqueDoorNumbers[i];
            setDoorOpeningProgress({ current: i + 1, total: totalDoors, label: 'Opening Doors With Items' });
            console.log(`Opening door ${doorNumber}...`);
            try {
              await electron.sideeventNative.openLockerDoor(doorNumber, mac, ip);
              console.log(`Door ${doorNumber} opened successfully`);
              await Promise.delay(300);
            } catch (error) {
              console.error(`Error opening door ${doorNumber}:`, error);
            }
          }
        } else {
          // Fallback to old behavior if no integrations found
          console.log('No integrations found, using device settings');
          for (let i = 0; i < uniqueDoorNumbers.length; i++) {
            const doorNumber = uniqueDoorNumbers[i];
            setDoorOpeningProgress({ current: i + 1, total: totalDoors, label: 'Opening Doors With Items' });
            await openDoor(sessionDevice.value.settings.macid, doorNumber);
            await Promise.delay(300);
          }
        }

        setDoorOpeningProgress(null);
        setShowConfirmWithItems(false);
        setLoading(false);
        customToast(() => `Opened ${uniqueDoorNumbers.length} door(s) with items!`, 3000, 'success', 'dark');
      } catch (error: any) {
        setDoorOpeningProgress(null);
        setShowConfirmWithItems(false);
        setLoading(false);
        console.error('Error opening doors with items:', error);
        customToast(() => `Failed to open doors: ${error.message}`, 3000, 'error', 'dark');
      }
    };

    // Open all empty lockers
    const openEmptyLockers = async () => {
      try {
        setLoading(true);
        setDoorOpeningProgress({ current: 0, total: 0, label: 'Opening Empty Lockers' });
        const usedDoors = new Set<number>();

        if (sessionDevice.value?.manifest?.groups) {
          for (const group of Object.values(sessionDevice.value.manifest.groups)) {
            const groupData = group as any;
            if (!groupData.lockers) continue;
            const lockers = Array.isArray(groupData.lockers) ? groupData.lockers : Object.values(groupData.lockers);
            for (const locker of lockers) {
              if (!locker) continue;
              const lockerData = locker as any;
              if (lockerData?.doorNumber && lockerData.itemIds && Array.isArray(lockerData.itemIds) && lockerData.itemIds.length > 0) {
                usedDoors.add(lockerData.doorNumber);
              }
            }
          }
        }

        const emptyDoors = doorsData.filter((door: any) => door.enabled && !usedDoors.has(door.doorNumber));
        const doorNumbersToOpen = emptyDoors.map((d: any) => d.doorNumber);
        const totalDoors = doorNumbersToOpen.length;

        // Get integrations from localStorage (saved by App.tsx)
        const cachedIntegrations = localStorage.getItem('integrations');
        let integrations: any[] = [];

        if (cachedIntegrations) {
          try {
            const integrationsObj = JSON.parse(cachedIntegrations);
            integrations = Array.isArray(integrationsObj) ? integrationsObj : Object.values(integrationsObj);
          } catch (error) {
            console.error('Error parsing integrations:', error);
          }
        }

        // If we have integrations, use the first one's MAC and IP
        if (integrations.length > 0) {
          const integration = integrations[0];
          const mac = integration.macId || integration.mac;
          const ip = integration.ip;

          console.log(`Opening ${doorNumbersToOpen.length} empty lockers using integration MAC: ${mac}, IP: ${ip}`);

          const electron = (window as any).electron;
          for (let i = 0; i < doorNumbersToOpen.length; i++) {
            const doorNumber = doorNumbersToOpen[i];
            setDoorOpeningProgress({ current: i + 1, total: totalDoors, label: 'Opening Empty Lockers' });
            console.log(`Opening door ${doorNumber}...`);
            try {
              await electron.sideeventNative.openLockerDoor(doorNumber, mac, ip);
              console.log(`Door ${doorNumber} opened successfully`);
              await Promise.delay(300);
            } catch (error) {
              console.error(`Error opening door ${doorNumber}:`, error);
            }
          }
        } else {
          // Fallback to old behavior if no integrations found
          console.log('No integrations found, using device settings');
          for (let i = 0; i < doorNumbersToOpen.length; i++) {
            const doorNumber = doorNumbersToOpen[i];
            setDoorOpeningProgress({ current: i + 1, total: totalDoors, label: 'Opening Empty Lockers' });
            await openDoor(sessionDevice.value.settings.macid, doorNumber);
            await Promise.delay(300);
          }
        }

        setDoorOpeningProgress(null);
        setShowConfirmEmptyLockers(false);
        setLoading(false);
        customToast(() => `Opened ${doorNumbersToOpen.length} empty locker(s)!`, 3000, 'success', 'dark');
      } catch (error: any) {
        setDoorOpeningProgress(null);
        setShowConfirmEmptyLockers(false);
        setLoading(false);
        console.error('Error opening empty lockers:', error);
        customToast(() => `Failed to open doors: ${error.message}`, 3000, 'error', 'dark');
      }
    };

    return (
      <>
        <div style={{ marginBottom: '20px', textAlign: 'left' }}>
          <p style={{ ...getTextStyle({ color: 'rgba(255,255,255,0.7)', margin: '5px 0 0 0', textAlign: 'left' }, 8) }}>
            Open individual doors, all doors, or doors by group. View door status and manage lockers.
          </p>
        </div>

        <Row gutter={[16, 16]}>
          <Col span={8}>

            <Card style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '300px',
              }}
              cover={
                <Badge showZero={true} count={getDoorCount()} color={getDoorCount() > 0 ? 'blue' : 'gray'} offset={[25, -40]} size="default" style={badgeStyle}>
                  <svg width="70" height="90" viewBox="0 0 36 48" fill="none" xmlns="http://www.w3.org/2000/svg" style={{color: '#42A4DE', position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -100%)'}}>
                    <rect x="1" y="1" width="34" height="46" stroke="#42A4DE" strokeWidth="2" fill="none" rx="2"/>
                    <rect x="4" y="4" width="12" height="10" fill="#42A4DE" rx="1"/>
                    <rect x="20" y="4" width="12" height="10" fill="#42A4DE" rx="1"/>
                    <rect x="4" y="19" width="12" height="10" fill="#42A4DE" rx="1"/>
                    <rect x="20" y="19" width="12" height="10" fill="#42A4DE" rx="1"/>
                    <rect x="4" y="34" width="12" height="10" fill="#42A4DE" rx="1"/>
                    <rect x="20" y="34" width="12" height="10" fill="#42A4DE" rx="1"/>
                  </svg>
                </Badge>
              }
              onClick={() => {
                setLoading(true);
                setModal_openDoorTitle(t('ADMIN_OPENALLDOORS'));
                setModal_confirmCleanupAction(CleanupAction.OPEN_ALL_DOORS);
                setModal_openAllDoors(true);
              }} >

              <Meta
              style={{
                // marginTop: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                color: '#42A4DE',
                position: 'absolute',
                backgroundColor: 'rgba(255,255,255,0.0)',
                // bottom: '10px',
                width: '90%',
                textAlign: 'center',
                // boxShadow: '1px 1px 1px 1px rgb(0 0 0 / 50%), 0 1px 6px -1px rgb(0 0 0 / 2%), 0 2px 4px 0 rgb(0 0 0 / 4%'
              }}
              title={<span style={{...getTextStyle({color: '#42A4DE'})}}>{t('ADMIN.DOOR.ALL')}</span>}
              description={<span style={{...getTextStyle({color: '#42A4DE'})}}>Open all doors in order</span>}
            />


            </Card>
          </Col>

          <Col span={8}>
            <Card style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '300px',
              }}
              cover={
                <Badge showZero={true} count={getDoorsWithItemsCount()} color={getDoorsWithItemsCount() > 0 ? 'blue' : 'gray'} offset={[25, -40]} size="default" style={badgeStyle}>
                  <svg width="70" height="70" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{color: '#42A4DE', position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -100%)'}}>
                    <rect x="2" y="2" width="9" height="9" stroke="#42A4DE" strokeWidth="1.5" fill="#42A4DE" rx="1"/>
                    <rect x="13" y="2" width="9" height="9" stroke="#42A4DE" strokeWidth="1.5" fill="none" rx="1"/>
                    <rect x="2" y="13" width="9" height="9" stroke="#42A4DE" strokeWidth="1.5" fill="none" rx="1"/>
                    <rect x="13" y="13" width="9" height="9" stroke="#42A4DE" strokeWidth="1.5" fill="none" rx="1"/>
                  </svg>
                </Badge>
              }
              onClick={() => setShowConfirmWithItems(true)}
            >

              <Meta
              style={{
                marginTop: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                color: '#42A4DE',
                position: 'absolute',
                backgroundColor: 'rgba(255,255,255,0.0)',
                bottom: '10px',
                width: '90%',
                textAlign: 'center',
              }}
              title={<span style={{...getTextStyle({color: '#42A4DE'})}}>{t('ADMIN.DOOR.WITHITEMS')}</span>}
              description={<span style={{...getTextStyle({color: '#42A4DE'})}}>{t('ADMIN.DOOR.WITHITEMSDESCRIPTION')}</span>}
            />


            </Card>
          </Col>
          <Col span={8}>
            <Card style={{

                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '300px',
              }}
              cover={
                <Badge showZero={true} count={getDoorsWithoutItemsCount()} color={getDoorsWithoutItemsCount() > 0 ? 'blue' : 'gray'} offset={[25, -40]} size="default" style={badgeStyle}>
                  <svg width="70" height="70" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{color: '#42A4DE', position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -100%)'}}>
                    <rect x="2" y="2" width="9" height="9" stroke="#42A4DE" strokeWidth="1.5" strokeDasharray="2,2" fill="none" rx="1"/>
                    <rect x="13" y="2" width="9" height="9" stroke="#42A4DE" strokeWidth="1.5" strokeDasharray="2,2" fill="none" rx="1"/>
                    <rect x="2" y="13" width="9" height="9" stroke="#42A4DE" strokeWidth="1.5" strokeDasharray="2,2" fill="none" rx="1"/>
                    <rect x="13" y="13" width="9" height="9" stroke="#42A4DE" strokeWidth="1.5" strokeDasharray="2,2" fill="none" rx="1"/>
                  </svg>
                </Badge>
              }
              onClick={() => setShowConfirmEmptyLockers(true)}
            >

              <Meta
              style={{
                marginTop: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                color: '#42A4DE',
                position: 'absolute',
                backgroundColor: 'rgba(255,255,255,0.0)',
                bottom: '10px',
                width: '90%',
                textAlign: 'center',
              }}
              title={<span style={{...getTextStyle({color: '#42A4DE'})}}>{t('ADMIN.DOOR.WITHOUTITEMS')}</span>}
              description={<span style={{...getTextStyle({color: '#42A4DE'})}}>{t('ADMIN.DOOR.WITHOUTITEMSDESCRIPTION')}</span>}
            />


            </Card>
          </Col>

          <Col span={8}>
            <Card style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '300px',
              }}
              cover={
                <svg width="70" height="70" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{color: '#42A4DE', position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -100%)'}}>
                  <rect x="2" y="2" width="9" height="9" stroke="#42A4DE" strokeWidth="1.5" fill="none" rx="1"/>
                  <rect x="13" y="2" width="9" height="9" stroke="#42A4DE" strokeWidth="1.5" fill="#42A4DE" rx="1"/>
                  <rect x="2" y="13" width="9" height="9" stroke="#42A4DE" strokeWidth="1.5" fill="#42A4DE" rx="1"/>
                  <rect x="13" y="13" width="9" height="9" stroke="#42A4DE" strokeWidth="1.5" fill="none" rx="1"/>
                </svg>
              }
              onClick={handleOpenGroupSelect} >

              <Meta
              style={{
                marginTop: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                color: '#42A4DE',
                position: 'absolute',
                backgroundColor: 'rgba(255,255,255,0.0)',
                bottom: '10px',
                width: '90%',
                textAlign: 'center',
              }}
              title={<span style={{...getTextStyle({color: '#42A4DE'})}}>Open Group</span>}
              description={<span style={{...getTextStyle({color: '#42A4DE'})}}>Select specific groups to open</span>}
            />


            </Card>
          </Col>

        </Row>

        {/* Open Group Select Modal */}
        <Modal
          title={<span style={{...getTextStyle({fontSize: '32px', fontWeight: 'bold'})}}>Select Groups to Open</span>}
          open={showOpenGroupSelectModal}
          onCancel={() => {
            if (!doorOpeningProgress) {
              setShowOpenGroupSelectModal(false);
              setSelectedGroupsToOpen([]);
            }
          }}
          closable={!doorOpeningProgress}
          maskClosable={!doorOpeningProgress}
          footer={doorOpeningProgress ? null : [
            <Button
              key="cancel"
              size="large"
              onClick={() => {
                setShowOpenGroupSelectModal(false);
                setSelectedGroupsToOpen([]);
              }}
              style={{...getTextStyle({fontSize: '24px', padding: '15px 40px', height: 'auto'})}}
            >
              Cancel
            </Button>,
            <Button
              key="submit"
              type="primary"
              size="large"
              disabled={selectedGroupsToOpen.length === 0}
              onClick={confirmOpenSelectedGroups}
              style={{
                ...getTextStyle({fontSize: '24px', padding: '15px 40px', height: 'auto'}),
                backgroundColor: selectedGroupsToOpen.length === 0 ? '#9ca3af' : '#ea580c',
                borderColor: selectedGroupsToOpen.length === 0 ? '#9ca3af' : '#ea580c'
              }}
            >
              Open Selected ({selectedGroupsToOpen.length})
            </Button>
          ]}
          width={1200}
          centered
        >
          {doorOpeningProgress ? (
            <div style={{...getTextStyle({fontSize: '22px', padding: '40px', textAlign: 'center'})}}>
              <Spin size="large" />
              <div style={{ marginTop: '20px' }}>
                {doorOpeningProgress.current === 0 ? 'Preparing to open doors...' : `Opening door ${doorOpeningProgress.current} of ${doorOpeningProgress.total}...`}
              </div>
            </div>
          ) : (
          <div style={{ maxHeight: '70vh', overflowY: 'auto', overflowX: 'hidden', padding: '30px 10px' }}>
            <Space direction="vertical" style={{ width: '100%' }} size="large">
              {/* Group options */}
              <div>
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                  {sessionDevice.value?.manifest?.groups && Object.entries(sessionDevice.value.manifest.groups).map(([groupId, group]: [string, any]) => {
                    // Count doors in this group
                    let doorCount = 0;
                    const groupData = group as any;
                    if (groupData.lockers) {
                      const lockers = Array.isArray(groupData.lockers) ? groupData.lockers : Object.values(groupData.lockers);
                      doorCount = lockers.length;
                    }

                    // Get group color
                    const groupColor = groupData.color ? getColorHex(groupData.color) : '#3b82f6';
                    const isSelected = Array.isArray(selectedGroupsToOpen) && selectedGroupsToOpen.includes(groupId);

                    return (
                      <Button
                        key={groupId}
                        size="large"
                        block
                        onClick={() => toggleGroupSelection(groupId)}
                        style={{
                          ...getTextStyle({fontSize: '26px', padding: '25px', height: 'auto', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'flex-start'}),
                          backgroundColor: isSelected ? groupColor : (groupColor + '15'), // Selected: full opacity, Unselected: ~8% opacity
                          borderColor: groupColor,
                          borderWidth: isSelected ? '3px' : '2px',
                          color: '#111827',
                          boxSizing: 'border-box'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', width: '100%' }}>
                          {groupData.image && (
                            <img
                              src={groupData.image}
                              alt={group.name}
                              style={{
                                width: '90px',
                                height: '90px',
                                objectFit: 'cover',
                                borderRadius: '50%',
                                border: `4px solid ${groupColor}`
                              }}
                            />
                          )}
                          <span style={{ flex: 1, textAlign: 'left' }}>
                            {isSelected ? '✓ ' : ''}Open all {group.name} ({doorCount}) doors
                          </span>
                        </div>
                      </Button>
                    );
                  })}
                </Space>
              </div>
            </Space>
          </div>
          )}
        </Modal>

        {/* Confirm Open Doors With Items Modal */}
        <Modal
          title={<span style={{...getTextStyle({fontSize: '28px', fontWeight: 'bold'})}}>Open Doors With Items</span>}
          open={showConfirmWithItems}
          onCancel={() => !doorOpeningProgress && setShowConfirmWithItems(false)}
          closable={!doorOpeningProgress}
          maskClosable={!doorOpeningProgress}
          footer={doorOpeningProgress ? null : [
            <Button
              key="cancel"
              size="large"
              onClick={() => setShowConfirmWithItems(false)}
              style={{...getTextStyle({fontSize: '24px', padding: '15px 40px', height: 'auto'})}}
            >
              Cancel
            </Button>,
            <Button
              key="confirm"
              type="primary"
              size="large"
              onClick={() => openDoorsWithItems()}
              style={{
                ...getTextStyle({fontSize: '24px', padding: '15px 40px', height: 'auto'}),
                backgroundColor: '#ea580c',
                borderColor: '#ea580c'
              }}
            >
              Open {getDoorsWithItemsCount()} Door(s)
            </Button>
          ]}
          width={800}
          centered
        >
          {doorOpeningProgress ? (
            <div style={{...getTextStyle({fontSize: '22px', padding: '40px', textAlign: 'center'})}}>
              <Spin size="large" />
              <div style={{ marginTop: '20px' }}>
                {doorOpeningProgress.current === 0 ? 'Preparing to open doors...' : `Opening door ${doorOpeningProgress.current} of ${doorOpeningProgress.total}...`}
              </div>
            </div>
          ) : (
            <div style={{...getTextStyle({fontSize: '22px', padding: '20px', textAlign: 'center'})}}>
              Are you sure you want to open all {getDoorsWithItemsCount()} door(s) that contain items?
            </div>
          )}
        </Modal>

        {/* Confirm Open Empty Lockers Modal */}
        <Modal
          title={<span style={{...getTextStyle({fontSize: '28px', fontWeight: 'bold'})}}>Open Empty Lockers</span>}
          open={showConfirmEmptyLockers}
          onCancel={() => !doorOpeningProgress && setShowConfirmEmptyLockers(false)}
          closable={!doorOpeningProgress}
          maskClosable={!doorOpeningProgress}
          footer={doorOpeningProgress ? null : [
            <Button
              key="cancel"
              size="large"
              onClick={() => setShowConfirmEmptyLockers(false)}
              style={{...getTextStyle({fontSize: '24px', padding: '15px 40px', height: 'auto'})}}
            >
              Cancel
            </Button>,
            <Button
              key="confirm"
              type="primary"
              size="large"
              onClick={() => openEmptyLockers()}
              style={{
                ...getTextStyle({fontSize: '24px', padding: '15px 40px', height: 'auto'}),
                backgroundColor: '#ea580c',
                borderColor: '#ea580c'
              }}
            >
              Open {getDoorsWithoutItemsCount()} Door(s)
            </Button>
          ]}
          width={800}
          centered
        >
          {doorOpeningProgress ? (
            <div style={{...getTextStyle({fontSize: '22px', padding: '40px', textAlign: 'center'})}}>
              <Spin size="large" />
              <div style={{ marginTop: '20px' }}>
                {doorOpeningProgress.current === 0 ? 'Preparing to open doors...' : `Opening door ${doorOpeningProgress.current} of ${doorOpeningProgress.total}...`}
              </div>
            </div>
          ) : (
            <div style={{...getTextStyle({fontSize: '22px', padding: '20px', textAlign: 'center'})}}>
              Are you sure you want to open all {getDoorsWithoutItemsCount()} empty locker(s)?
            </div>
          )}
        </Modal>
      </>
  )}

  const returnToMainView = () => {
    setViewMainView(true);
    setViewRemoveAllExpired(false);
    setViewRemoveAllExpiredSmartConsolidation(false);
    setViewRemoveAllCancelled(false);
    setViewRemoveAllLeftBehind(false);
    setViewInspection(false);
    setCancelledHolds(null);
    setCancelledHoldsList([]);
    setCancelledHoldsIndex(0);
    resetAdminTimer();
  }





  const processNextCancelledHold = (existingList?: any[], startIndex?: number, mode?: 'cancelled' | 'expired' | 'hybrid' | 'leftbehind') => {
    console.log('processNextCancelledHold called', { existingList: !!existingList, startIndex, mode, cancelledHoldsListLen: cancelledHoldsList.length });
    // Build list on first call, reuse on subsequent calls
    let list = existingList || cancelledHoldsList;
    let idx = startIndex ?? cancelledHoldsIndex;

    if (!existingList && list.length === 0) {
      const built: any[] = [];
      const groups = sessionDevice.value?.manifest?.groups;
      if (groups) {
        const groupEntries = Array.isArray(groups)
          ? groups.map((g: any, i: number) => [String(i), g])
          : Object.entries(groups);

        // Build cancelled holds list
        if (mode === 'cancelled' || mode === 'hybrid' || !mode) {
          for (const [groupKey, group] of groupEntries) {
            const g = group as any;
            if (g?.name === 'Holds' && g?.lockers) {
              for (const index in g.lockers) {
                const locker = g.lockers[index];
                const itemIds: string[] = locker?.itemIds || (locker?.itemId ? locker.itemId.split(',') : []);
                const hasCancelled = itemIds.some((id: string) => id.startsWith('*'));
                if (!hasCancelled) continue;

                const removeTitles: any[] = [];
                const stayTitles: any[] = [];
                for (const id of itemIds) {
                  const cleanId = id.startsWith('*') ? id.substring(1) : id;
                  const title = locker?.titles?.[cleanId] || cleanId;
                  if (id.startsWith('*')) {
                    removeTitles.push({ title, barcode: cleanId });
                  } else {
                    stayTitles.push({ title, barcode: cleanId });
                  }
                }

                built.push({
                  locker: locker.doorNumber || +index,
                  patronId: locker.patronId || 'Unknown',
                  removeTitles,
                  stayTitles,
                  groupKey,
                  lockerKey: index,
                  type: 'cancelled',
                });
              }
            }
          }
        }

        // Build expired holds list
        if (mode === 'expired' || mode === 'hybrid') {
          for (const [groupKey, group] of groupEntries) {
            const g = group as any;
            if (!g?.lockers) continue;
            for (const index in g.lockers) {
              const locker = g.lockers[index];
              if (!locker) continue;
              const doorNumber = locker.doorNumber || +index;
              const hasItems = locker.itemId || (locker.itemIds && locker.itemIds.length > 0);
              if (!hasItems || !isExpired(locker)) continue;

              // Skip if already in the list as cancelled (hybrid mode — avoid duplicates)
              if (mode === 'hybrid' && built.some((b: any) => b.locker === doorNumber)) continue;

              let itemIds: string[] = [];
              if (locker.itemIds && Array.isArray(locker.itemIds)) {
                itemIds = locker.itemIds;
              } else if (locker.itemId) {
                itemIds = locker.itemId.split(',').filter((id: string) => id.trim());
              }

              const removeTitles: any[] = [];
              if (locker.titles && Array.isArray(locker.titles)) {
                for (let ti = 0; ti < itemIds.length; ti++) {
                  removeTitles.push({ title: locker.titles[ti] || '', barcode: itemIds[ti] });
                }
              } else {
                for (const id of itemIds) {
                  const cleanId = id.startsWith('*') ? id.substring(1) : id;
                  removeTitles.push({ title: locker?.titles?.[cleanId] || cleanId, barcode: cleanId });
                }
              }

              built.push({
                locker: doorNumber,
                patronId: locker.patronId || locker.patronBarcode || 'Unknown',
                removeTitles,
                stayTitles: [],
                groupKey,
                lockerKey: index,
                type: 'expired',
              });
            }
          }
        }

        // Build left-behind list
        if (mode === 'leftbehind') {
          for (const [groupKey, group] of groupEntries) {
            const g = group as any;
            if (!g?.lockers) continue;
            for (const index in g.lockers) {
              const locker = g.lockers[index];
              if (!locker) continue;
              if (!locker.patronId || !String(locker.patronId).startsWith('!')) continue;

              let itemIds: string[] = [];
              if (locker.itemIds && Array.isArray(locker.itemIds)) {
                itemIds = locker.itemIds;
              } else if (locker.itemId) {
                itemIds = locker.itemId.split(',').filter((id: string) => id.trim());
              }

              const removeTitles: any[] = [];
              for (const id of itemIds) {
                const cleanId = id.startsWith('*') ? id.substring(1) : id;
                removeTitles.push({ title: locker?.titles?.[cleanId] || cleanId, barcode: cleanId });
              }

              built.push({
                locker: locker.doorNumber || +index,
                patronId: String(locker.patronId).replace(/^!/, ''),
                removeTitles,
                stayTitles: [],
                groupKey,
                lockerKey: index,
                type: 'leftbehind',
              });
            }
          }
        }
      }
      built.sort((a, b) => a.locker - b.locker);
      list = built;
      idx = 0;
      setCancelledHoldsList(built);
      setCancelledHoldsIndex(0);
    }

    if (idx >= list.length) {
      // All done
      const msg = mode === 'expired' ? 'All expired holds processed'
        : mode === 'hybrid' ? 'All holds processed'
        : mode === 'leftbehind' ? 'All left behind items processed'
        : 'All cancelled holds processed';
      customToast(() => msg, 2000, 'success', 'dark');
      returnToMainView();
      return;
    }

    const hold = list[idx];
    setCancelledHolds(hold);
    setCancelledHoldsIndex(idx);

    // Open the door — get MAC from integrations (same as openGivenDoor)
    let mac = sessionDevice.value?.settings?.macid || '';
    const cachedIntegrations = localStorage.getItem('integrations');
    if (cachedIntegrations) {
      try {
        const parsed = JSON.parse(cachedIntegrations);
        const integrations = Array.isArray(parsed) ? parsed : Object.values(parsed);
        if (integrations.length > 0) {
          mac = (integrations[0] as any).macId || (integrations[0] as any).mac || mac;
        }
      } catch (e) { /* ignore */ }
    }
    if (mac && hold.locker) {
      openDoor(mac, hold.locker);
    }
  }

  /**
   * Remove cancelled (*) items from the manifest locker and persist.
   * If no items remain after removal, delete the locker object entirely.
   */
  const removeCancelledFromManifest = async (hold: any) => {
    console.log('removeCancelledFromManifest called', { groupKey: hold.groupKey, lockerKey: hold.lockerKey, locker: hold.locker, type: hold.type });
    const groups = sessionDevice.value?.manifest?.groups;
    if (!groups || hold.groupKey == null || hold.lockerKey == null) {
      console.log('removeCancelledFromManifest SKIPPED — missing groups/groupKey/lockerKey', { groups: !!groups, groupKey: hold.groupKey, lockerKey: hold.lockerKey });
      return;
    }

    const group = groups[hold.groupKey];
    console.log('removeCancelledFromManifest — group found:', !!group, 'locker found:', !!group?.lockers?.[hold.lockerKey]);
    if (!group?.lockers?.[hold.lockerKey]) return;

    const locker = group.lockers[hold.lockerKey];
    const itemIds: string[] = locker.itemIds || (locker.itemId ? locker.itemId.split(',') : []);
    console.log('removeCancelledFromManifest — itemIds:', itemIds);

    // Filter out cancelled items (those starting with *)
    const remaining = itemIds.filter((id: string) => !id.startsWith('*'));
    console.log('removeCancelledFromManifest — remaining after filter:', remaining);

    if (remaining.length === 0) {
      // No items left — remove the locker entry
      if (Array.isArray(group.lockers)) {
        group.lockers[+hold.lockerKey] = null;
        group.lockers = group.lockers.filter(Boolean);
      } else {
        delete group.lockers[hold.lockerKey];
      }
    } else {
      // Keep only the non-cancelled items
      locker.itemIds = remaining;
      if (locker.itemId) {
        locker.itemId = remaining.join(',');
      }
    }

    // Persist and update signal
    console.log('removeCancelledFromManifest — persisting changes, remaining items:', remaining.length);
    const manifest = { ...sessionDevice.value.manifest };
    await persistDeviceManifestChanges(manifest);
    sessionDevice.value = { ...sessionDevice.value, manifest };
  };

  // processNextSmartConsolidationHold removed — now handled by processNextCancelledHold with mode='expired'


  const processNextExpiredHold = () => {
    // Load actual expired lockers from manifest
    const expiredLockers: any[] = [];

    if (sessionDevice.value?.manifest?.groups) {
      const groups = sessionDevice.value.manifest.groups;
      const groupsArray = Array.isArray(groups) ? groups : Object.values(groups);

      for (const group of groupsArray) {
        const groupData = group as any;
        if (!groupData?.lockers) continue;

        const lockers = Array.isArray(groupData.lockers) ? groupData.lockers : Object.entries(groupData.lockers);

        for (const lockerEntry of lockers) {
          let doorNumber: number;
          let locker: any;

          if (Array.isArray(groupData.lockers)) {
            locker = lockerEntry;
            doorNumber = locker?.doorNumber;
          } else {
            const [key, value] = lockerEntry as [string, any];
            doorNumber = parseInt(key);
            locker = value;
          }

          if (!locker || !doorNumber) continue;

          // Check if locker has items and is expired
          const hasItems = locker.itemId || (locker.itemIds && locker.itemIds.length > 0);
          if (hasItems && isExpired(locker)) {
            // Build item list — if holdExpirationDate is set, all items are expired;
            // otherwise only items under expired set keys
            let itemIds: string[] = [];
            if (locker.holdExpirationDate && +locker.holdExpirationDate > 0) {
              // holdExpirationDate overrides: all items expired
              if (locker.itemIds && Array.isArray(locker.itemIds)) {
                itemIds = locker.itemIds;
              } else if (locker.itemId) {
                itemIds = locker.itemId.split(',').filter((id: string) => id.trim());
              }
            } else {
              // No holdExpirationDate: only items from expired set dates
              itemIds = getExpiredItemsFromSet(locker);
            }

            if (itemIds.length === 0) continue;

            // Build titles array: use locker.titles if available, otherwise fall back to itemIds as barcodes
            const titles: {title: string, barcode: string}[] = [];
            if (locker.titles && typeof locker.titles === 'object' && !Array.isArray(locker.titles)) {
              for (const id of itemIds) {
                titles.push({ title: locker.titles[id] || '', barcode: id });
              }
            } else if (locker.titles && Array.isArray(locker.titles)) {
              for (let ti = 0; ti < itemIds.length; ti++) {
                titles.push({ title: locker.titles[ti] || '', barcode: itemIds[ti] });
              }
            } else {
              for (const id of itemIds) {
                titles.push({ title: '', barcode: id });
              }
            }

            expiredLockers.push({
              isOpen: false,
              locker: doorNumber,
              itemId: itemIds.join(','),
              itemIds: itemIds,
              titles: titles,
              patronId: locker.patronId || locker.patronBarcode || 'Unknown',
              holdExpirationDate: locker.holdExpirationDate,
              groupKey: groupData.groupKey || groupData.name,
              cleared: false
            });
          }
        }
      }
    }

    // Sort by door number
    expiredLockers.sort((a, b) => a.locker - b.locker);

    console.log('📦 Expired lockers loaded:', expiredLockers.length, expiredLockers);
    setExpiredHoldLockers(expiredLockers.length > 0 ? expiredLockers : []);
  }

  /** Get all lockers with conditionCheck: true from manifest */
  const getConditionCheckLockers = (): any[] => {
    const lockers: any[] = [];
    const groups = sessionDevice.value?.manifest?.groups;
    if (!groups) return lockers;
    const groupKeys = Array.isArray(groups) ? groups.map((_: any, i: number) => i) : Object.keys(groups);
    const groupsArray = Array.isArray(groups) ? groups : Object.values(groups);
    for (let gIdx = 0; gIdx < groupsArray.length; gIdx++) {
      const group = groupsArray[gIdx] as any;
      if (!group?.lockers) continue;
      const lockersObj = Array.isArray(group.lockers) ? group.lockers : Object.entries(group.lockers);
      for (const entry of lockersObj) {
        let doorNumber: number;
        let locker: any;
        if (Array.isArray(group.lockers)) {
          locker = entry;
          doorNumber = locker?.doorNumber;
        } else {
          const [key, value] = entry as [string, any];
          doorNumber = parseInt(key);
          locker = value;
        }
        if (!locker || !doorNumber || !locker.conditionCheck) continue;
        const itemIds = locker.itemIds && Array.isArray(locker.itemIds) ? locker.itemIds
          : locker.itemId ? locker.itemId.split(',').filter((id: string) => id.trim()) : [];
        lockers.push({
          locker: doorNumber,
          itemId: itemIds.join(','),
          itemIds,
          patronId: locker.patronId || 'All',
          groupName: group.name || `Group ${gIdx}`,
          groupIndex: gIdx,
          groupKey: groupKeys[gIdx],
          lockerKey: String(doorNumber),
        });
      }
    }
    lockers.sort((a, b) => a.locker - b.locker);
    return lockers;
  };

  const getConditionCheckCount = (): number => getConditionCheckLockers().length;

  const processNextInspection = () => {
    const lockers = getConditionCheckLockers();
    console.log(`🔍 Inspection: found ${lockers.length} lockers with conditionCheck`);
    setInspectionLockers(lockers);
    setInspectionIndex(0);
    if (lockers.length > 0) {
      setInspectionItem(lockers[0]);
      // Open the first door for inspection
      openDoor(sessionDevice.value.settings.macid, lockers[0].locker);
      customToast(() => (<span>Door #{lockers[0].locker} opened for inspection</span>), 2000, 'default', 'dark');
    } else {
      setInspectionItem(null);
    }
  }

  const processNextLeftBehind = async () => {
    if (!leftBehindLockers) {
      const list: any[] = [];
      const groups = sessionDevice.value?.manifest?.groups;
      if (groups) {
        const groupsArray = Array.isArray(groups) ? groups : Object.values(groups);
        for (const group of groupsArray) {
          const groupData = group as any;
          if (!groupData?.lockers) continue;
          const lockers = Array.isArray(groupData.lockers) ? groupData.lockers : Object.values(groupData.lockers);
          for (const locker of lockers) {
            if (!locker) continue;
            const lockerData = locker as any;
            if (lockerData.patronId && String(lockerData.patronId).startsWith('!')) {
              const itemIds = Array.isArray(lockerData.itemIds) ? lockerData.itemIds : (lockerData.itemId ? [lockerData.itemId] : []);
              list.push({
                isOpen: false,
                locker: +lockerData.doorNumber,
                itemId: itemIds.join(','),
                groupKey: groupData.groupKey ?? groupData.name,
              });
            }
          }
        }
      }
      setLeftBehindLockers(list);

      // Open all doors and clear from manifest
      const electron = (window as any).electron;
      const cachedIntegrations = localStorage.getItem('integrations');
      let integrations: any[] = [];
      if (cachedIntegrations) {
        try { integrations = Array.isArray(JSON.parse(cachedIntegrations)) ? JSON.parse(cachedIntegrations) : Object.values(JSON.parse(cachedIntegrations)); } catch (e) { /* ignore */ }
      }

      for (const entry of list) {
        try {
          if (integrations.length > 0) {
            const integration = integrations[0];
            const mac = integration.macId || integration.mac;
            const ip = integration.ip;
            await electron.sideeventNative.openLockerDoor(entry.locker, mac, ip);
          } else if (sessionDevice.value?.settings?.macid) {
            await openDoor(sessionDevice.value.settings.macid, entry.locker);
          }
          entry.isOpen = true;
          await clearLockerManifest(entry.locker, true);
          console.log(`🧹 Left behind: door #${entry.locker} opened and cleared`);
          await new Promise(r => setTimeout(r, 300));
        } catch (err) {
          console.error(`❌ Left behind: failed to process door #${entry.locker}:`, err);
        }
      }
      setLeftBehindLockers([...list]);
    }
  }

  /** Handle inspection action for current locker, then advance to next */
  const handleInspectionAction = async (action: string) => {
    if (!inspectionItem) return;

    if (action === 'ok') {
      // Clear conditionCheck on the locker in manifest
      try {
        // Capture manifest reference before mutating — the RTDB listener can replace
        // sessionDevice.value at any time, so we must mutate and persist the same object
        const manifest = sessionDevice.value.manifest;
        const groups = manifest.groups;

        // Use the saved groupKey to target the exact group — searching all groups
        // would match the wrong locker if another group has the same doorNumber
        const groupData = Array.isArray(groups) ? groups[inspectionItem.groupKey] : groups[inspectionItem.groupKey];
        let cleared = false;

        if (groupData?.lockers) {
          if (Array.isArray(groupData.lockers)) {
            const locker = groupData.lockers.find((l: any) => +l?.doorNumber === +inspectionItem.locker);
            if (locker) { locker.conditionCheck = false; cleared = true; }
          } else {
            if (groupData.lockers[inspectionItem.locker]) { groupData.lockers[inspectionItem.locker].conditionCheck = false; cleared = true; }
            else if (groupData.lockers[String(inspectionItem.locker)]) { groupData.lockers[String(inspectionItem.locker)].conditionCheck = false; cleared = true; }
          }
        }

        if (!cleared) {
          console.warn(`⚠️ Could not find locker #${inspectionItem.locker} in group ${inspectionItem.groupKey} (${inspectionItem.groupName})`);
        }

        await persistDeviceManifestChanges(manifest);
        console.log(`✅ conditionCheck cleared for door #${inspectionItem.locker} in group ${inspectionItem.groupKey} (${inspectionItem.groupName})`);

        // Create return_enforce_checkin transaction event
        await createReturnEnforceCheckinEvent({
          itemIds: inspectionItem.itemIds || [],
          patronId: inspectionItem.patronId || 'All',
          doorNumber: inspectionItem.locker,
          groupName: inspectionItem.groupName,
          metadata: { inspectionResult: 'ok' }
        });
        console.log(`✅ return_enforce_checkin event created for door #${inspectionItem.locker}`);
        customToast(() => `Door #${inspectionItem.locker} — OK, returned to circulation`, 2000, 'default', 'dark');
      } catch (err: any) {
        console.error(`❌ Error processing inspection for door #${inspectionItem.locker}:`, err);
        customToast(() => `Error processing door #${inspectionItem.locker}`, 2000, 'default', 'dark');
      }
    } else {
      // keep_out — leave conditionCheck true, just skip
      customToast(() => `Door #${inspectionItem.locker} — kept out of circulation`, 2000, 'default', 'dark');
    }

    // Advance to next locker
    const nextIndex = inspectionIndex + 1;
    if (nextIndex < inspectionLockers.length) {
      setInspectionIndex(nextIndex);
      setInspectionItem(inspectionLockers[nextIndex]);
      setInspectionTimer(60);
      resetAdminTimer();
      // Open the next door for inspection
      openDoor(sessionDevice.value.settings.macid, inspectionLockers[nextIndex].locker);
      customToast(() => (<span>Door #{inspectionLockers[nextIndex].locker} opened for inspection</span>), 2000, 'default', 'dark');
    } else {
      // All done
      customToast(() => 'Inspection complete', 2000, 'default', 'dark');
      returnToMainView();
    }
  };

  const HtmlInspection = () => {
    if (!inspectionItem) {
      return <div style={{...getTextStyle({color: 'white', fontSize: '30px', textAlign: 'center', marginTop: '40px'})}}>No items to inspect</div>;
    }
    return (
      <>
        <Row style={{marginTop: '20px'}}>
          <Divider style={dividerStyle}>
            Inspection ({inspectionIndex + 1} of {inspectionLockers.length})
          </Divider>
        </Row>

        <Row gutter={[16, 16]}>
          <Col offset={1} span={6}>
            <Card style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '300px',
              }}
              cover={
                <MdPersonSearch style={{color: '#42A4DE', position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -100%)'}} size={70}/>
              }
              onClick={() => { openDoor(sessionDevice.value.settings.macid, inspectionItem.locker); customToast(() => (<span>Door #{inspectionItem.locker} re-opened</span>), 1000, 'default', 'dark'); resetAdminTimer(); }} >

              <Meta
              style={{
                transform: 'translateX(-50%)',
                color: '#42A4DE',
                position: 'absolute',
                backgroundColor: 'rgba(255,255,255,0.0)',
                width: '100%',
                textAlign: 'center',
              }}
              title={<span style={{...getTextStyle({color: '#42A4DE'})}}>Door #{inspectionItem.locker}</span>}
              description={<span style={{...getTextStyle({color: '#42A4DE'})}}>Click to re-open</span>}
            />
            </Card>
          </Col>

          <Col offset={2} span={14} style={{color: 'white', textAlign: 'left', marginTop: '20px', fontSize: '42px', fontWeight: 'bold', lineHeight: '1.3'}}>
            This item from <b>{inspectionItem.groupName}</b> has been flagged for condition review. Please inspect the item and confirm whether it is suitable to return to circulation or should be kept aside.
          </Col>
        </Row>

        <Divider style={{...dividerStyle, color: 'white', fontSize: '36px', marginTop: '40px'}}>
          Item group: {inspectionItem.groupName} — Door #{inspectionItem.locker}
        </Divider>

        <Row gutter={[16, 16]} style={{marginTop: '20px'}}>
          <Col offset={2} span={20} style={{color: 'white', textAlign: 'center', fontSize: '38px'}}>
              {(inspectionItem.itemIds || []).map((id: string, idx: number) => (
                <span key={idx} style={{
                  display: 'inline-block',
                  backgroundColor: '#1890ff',
                  color: 'white',
                  borderRadius: '30px',
                  padding: '8px 28px',
                  marginLeft: idx > 0 ? '12px' : '0',
                  fontWeight: 'bold',
                  fontSize: '36px',
                }}>Item ID - {id}</span>
              ))}
          </Col>
        </Row>

        <Row justify="space-between" gutter={[16, 16]} style={{position: 'absolute', bottom: '20px', width: '100%', padding: '0 20px'}}>
          <Col><Button type="default" size="large" style={{height: 'auto', padding: '40px 80px', fontSize: '36px'}} onClick={() => {returnToMainView();}}>{t('CANCEL')}</Button></Col>
          <Col><Button danger size="large" style={{height: 'auto', padding: '40px 60px', fontSize: '32px'}} onClick={() => handleInspectionAction('keep_out')}>Keep out, next</Button></Col>
          <Col><Button type="primary" size="large" style={{height: 'auto', padding: '40px 80px', fontSize: '36px', backgroundColor: '#52c41a', borderColor: '#52c41a'}} onClick={() => handleInspectionAction('ok')}>Ok, next</Button></Col>
        </Row>


      </>
    )
  }

  const HtmlCancelledHolds = () => {

    return (
      <>
              {/* Breadcrumb pills */}
              <Row>
                <Col offset={1} span={22} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
                    {cancelledHoldsList.map((step, i) => {
                      const isActive = i === cancelledHoldsIndex;
                      const isDone = i < cancelledHoldsIndex;
                      return (
                        <div key={i} style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: 'white',
                          borderRadius: '10px',
                          padding: '0px 24px',
                          minWidth: '80px',
                          height: '50px',
                          fontSize: '32px',
                          fontWeight: isActive ? 'bold' : 'normal',
                          color: SEBlue.value,
                          opacity: isActive ? 1 : isDone ? 0.5 : 0.35,
                          boxShadow: isActive ? '0 4px 0 rgba(0,0,0,0.3), 0 6px 12px rgba(0,0,0,0.2)' : 'none',
                        }}>
                          {isDone ? '✓' : ''} #{step.locker}
                        </div>
                      );
                    })}
                </Col>
              </Row>

              {/* Header: Door re-open + info */}
              <Row gutter={[16, 16]} align="middle">
                <Col offset={1} span={7}>
                  <Card
                    style={{ width: '100%', cursor: 'pointer', borderRadius: '12px' }}
                    styles={{ body: { padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '16px' } }}
                    onClick={() => { openDoor(sessionDevice.value.settings.macid, cancelledHolds.locker); customToast(() => (<span>Door #{cancelledHolds.locker} re-opened</span>), 1000, 'default', 'dark'); resetAdminTimer() }}
                  >
                    <MdOutlineDoorBack size={50} style={{ color: '#42A4DE', flexShrink: 0 }} />
                    <div>
                      <div style={{ ...getTextStyle({ color: '#42A4DE', fontSize: '30px', fontWeight: 'bold' }) }}>Door #{cancelledHolds.locker}</div>
                      <span style={{ ...getTextStyle({ color: sessionDevice.value?.status?.[cancelledHolds.locker]?.isOpen ? '#22c55e' : '#ef4444', fontSize: '24px' }) }}>{sessionDevice.value?.status?.[cancelledHolds.locker]?.isOpen ? 'OPEN' : 'CLOSED'}</span>
                      <span style={{ ...getTextStyle({ color: '#42A4DE', fontSize: '24px', marginLeft: '12px' }) }}>{t('ADMIN.CLEANUP.DOOR_REOPEN')}</span>
                    </div>
                  </Card>
                </Col>

                <Col offset={1} span={15} style={{...getTextStyle({color: 'white', textAlign: 'left', fontSize: '34px', fontWeight: 'bold'})}}>
                  {cancelledHolds.type === 'leftbehind'
                    ? 'Remove left behind items from this locker'
                    : cancelledHolds.type === 'expired'
                    ? t('ADMIN.CLEANUP.REMOVE_ALL_EXPIRED_SMART_CONSOLIDATION_INFO')
                    : t('ADMIN.CLEANUP.REMOVE_ALL_CANCELLED_INFO')}
                </Col>
              </Row>

              {/* Remove items */}
              <Row style={{marginTop: '24px'}}>
                <Col offset={1} span={22}>
                  <Card style={{borderRadius: '16px', backgroundColor: 'white', padding: '16px 20px'}}>
                    <div style={{fontSize: '32px', fontWeight: 'bold', color: '#ef4444', marginBottom: '12px'}}>
                      {cancelledHolds.type === 'leftbehind'
                        ? `Left behind: ${cancelledHolds.removeTitles.length} item(s) — patron ${cancelledHolds.patronId}`
                        : cancelledHolds.type === 'expired'
                        ? t('ADMIN.CLEANUP.EXPIRED_HOLDS_ITEMS_REMOVE', {count: cancelledHolds.removeTitles.length, patron: cancelledHolds.patronId})
                        : t('ADMIN.CLEANUP.CANCELLED_HOLDS_ITEMS_REMOVE', {count: cancelledHolds.removeTitles.length, patron: cancelledHolds.patronId})}
                    </div>
                    {cancelledHolds.removeTitles.map((item: any, index: number) => (
                      <div key={index} style={{display: 'inline-block', margin: '6px 8px 6px 0', padding: '12px 24px', borderRadius: '999px', backgroundColor: `${SEBlue.value}15`, border: `2px solid ${SEBlue.value}40`}}>
                        <span style={{fontSize: '32px', fontWeight: 'bold', color: SEBlue.value}}>{item.title}</span>
                        <span style={{fontSize: '32px', color: `${SEBlue.value}60`, margin: '0 12px'}}>|</span>
                        <span style={{fontSize: '32px', color: `${SEBlue.value}99`}}>{item.barcode}</span>
                      </div>
                    ))}
                  </Card>
                </Col>
              </Row>

              {/* Stay items */}
              <Row style={{marginTop: '16px'}}>
                <Col offset={1} span={22}>
                  <Card style={{borderRadius: '16px', backgroundColor: 'white', padding: '16px 20px'}}>
                    <div style={{fontSize: '32px', fontWeight: 'bold', color: '#22c55e', marginBottom: '12px'}}>
                      {cancelledHolds.type === 'expired'
                        ? t('ADMIN.CLEANUP.EXPIRED_HOLDS_ITEMS_STAY', {count: cancelledHolds.stayTitles.length})
                        : t('ADMIN.CLEANUP.CANCELLED_HOLDS_ITEMS_STAY', {count: cancelledHolds.stayTitles.length})}
                    </div>
                    {cancelledHolds.stayTitles.length === 0 ? (
                      <div style={{fontSize: '28px', color: `${SEBlue.value}80`, fontStyle: 'italic'}}>No items to stay</div>
                    ) : cancelledHolds.stayTitles.map((item: any, index: number) => (
                      <div key={index} style={{display: 'inline-block', margin: '6px 8px 6px 0', padding: '12px 24px', borderRadius: '999px', backgroundColor: `${SEBlue.value}15`, border: `2px solid ${SEBlue.value}40`}}>
                        <span style={{fontSize: '32px', fontWeight: 'bold', color: SEBlue.value}}>{item.title}</span>
                        <span style={{fontSize: '32px', color: `${SEBlue.value}60`, margin: '0 12px'}}>|</span>
                        <span style={{fontSize: '32px', color: `${SEBlue.value}99`}}>{item.barcode}</span>
                      </div>
                    ))}
                  </Card>
                </Col>
              </Row>

              {/* Action buttons */}
              <Row justify="center" gutter={[16, 16]} style={{position: 'absolute', bottom: '20px', width: '100%'}}>
                <Col span={12} style={{textAlign: 'center'}}><Button type="default" size="large" style={{height: 'auto', padding: '30px 120px', fontSize: '36px', borderRadius: '12px'}} onClick={() => {returnToMainView()}}>{t('CANCEL')}</Button></Col>
                <Col span={12} style={{textAlign: 'center'}}><Button type="primary" size="large" style={{height: 'auto', padding: '30px 120px', fontSize: '36px', borderRadius: '12px'}} onClick={async () => {
                  if (cancelledHolds.type === 'expired' || cancelledHolds.type === 'leftbehind') {
                    await clearLockerManifest(cancelledHolds.locker, true);
                  } else {
                    await removeCancelledFromManifest(cancelledHolds);
                  }
                  processNextCancelledHold(cancelledHoldsList, cancelledHoldsIndex + 1);
                }}>{cancelledHoldsIndex + 1 < cancelledHoldsList.length ? t('CONTINUE') : t('DONE')}</Button></Col>
              </Row>


      </>
  )}

  const HtmlRemoveAllExpired = () => {
    // Handler to re-open door only (manifest already cleared by auto-open)
    const handleReopen = async (locker: any, index: number) => {
      try {
        console.log(`🚪 Re-opening door #${locker.locker}`);

        // Just open the door
        await openDoor(sessionDevice.value.settings.macid, +locker.locker);

        setExpiredTimer(20);
        resetAdminTimer();

      } catch (error) {
        console.error(`❌ Error re-opening door #${locker.locker}:`, error);
      }
    };

    // Auto-open all doors in order when component mounts
    React.useEffect(() => {
      const autoOpenDoors = async () => {
        if (!expiredHoldLockers || expiredHoldLockers.length === 0) return;

        // Check if any doors already processed (to prevent re-running on re-render)
        const anyProcessed = expiredHoldLockers.some((l: any) => l.cleared || l.error);
        if (anyProcessed) return;

        console.log('📦 Auto-opening expired doors in order...');

        for (let i = 0; i < expiredHoldLockers.length; i++) {
          const locker = expiredHoldLockers[i];
          if (locker.cleared || locker.error) continue;

          try {
            console.log(`🚪 Auto-opening door #${locker.locker}`);
            const mac = sessionDevice.value.settings.macid;

            // Open the door
            await openDoor(mac, +locker.locker);

            // Wait 1s then verify door actually opened
            await Promise.delay(1000);
            const isOpen = await isDoorOpenIPC(mac, +locker.locker, { fresh: true });

            if (isOpen) {
              // Door confirmed open — clear manifest
              await clearLockerManifest(locker.locker, true);
              setExpiredHoldLockers((prev: any[]) => {
                const updated = [...prev];
                updated[i] = { ...updated[i], isOpen: true, cleared: true, error: false };
                return updated;
              });
            } else {
              // Door failed to open — keep manifest entry, mark as failed
              console.warn(`⚠️ Door #${locker.locker} did not open — keeping manifest entry`);
              setExpiredHoldLockers((prev: any[]) => {
                const updated = [...prev];
                updated[i] = { ...updated[i], isOpen: false, cleared: false, error: true };
                return updated;
              });
            }

            // Wait between doors
            await Promise.delay(500);

          } catch (error) {
            console.error(`❌ Error auto-opening door #${locker.locker}:`, error);

            // Mark as error — keep manifest entry
            setExpiredHoldLockers((prev: any[]) => {
              const updated = [...prev];
              updated[i] = { ...updated[i], error: true };
              return updated;
            });
          }
        }

        console.log('✅ Auto-open complete');
        resetAdminTimer();
      };

      autoOpenDoors();
    }, []); // Run once on mount

    // Count cleared vs remaining
    const clearedCount = expiredHoldLockers?.filter((l: any) => l.cleared).length || 0;
    const remainingCount = (expiredHoldLockers?.length || 0) - clearedCount;

    return (
      <>
        {/* Breadcrumb pills */}
        <Row>
          <Col offset={1} span={22}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', margin: '4px 0 16px' }}>
              {expiredHoldLockers?.map((locker: any, i: number) => {
                const isDone = locker.cleared;
                return (
                  <div key={i} style={{
                    padding: '10px 28px',
                    borderRadius: '12px',
                    fontSize: '28px',
                    fontWeight: 'bold',
                    cursor: 'default',
                    backgroundColor: isDone ? 'rgba(255,255,255,0.15)' : 'white',
                    color: isDone ? 'rgba(255,255,255,0.7)' : SEBlue.value,
                    boxShadow: isDone ? 'none' : '0 2px 8px rgba(0,0,0,0.2)',
                  }}>
                    {isDone && <span style={{ marginRight: '6px' }}>✓</span>}
                    Locker {locker.locker}
                  </div>
                );
              })}
            </div>
          </Col>
        </Row>

        {/* Info row */}
        <Row gutter={[16, 16]} align="middle">
          <Col offset={1} span={22} style={{...getTextStyle({color: 'white', textAlign: 'left', fontSize: '34px', fontWeight: 'bold'})}}>
            Remove all items from opened doors and close them. Tap a locker to re-open.
          </Col>
        </Row>

        <div style={{ maxHeight: '50vh', overflowY: 'auto', overflowX: 'hidden', marginTop: '16px', padding: '0 24px' }}>
          {expiredHoldLockers?.map((locker: any, index: number) => {
            const itemCount = locker.itemIds?.length || (locker.itemId ? locker.itemId.split(',').filter((s: string) => s).length : 0);
            const titles: {title: string, barcode: string}[] = locker.titles || [];
            // Show inline titles if 3 or fewer, otherwise just count
            const showInline = titles.length <= 3;

            return (
              <Card
                key={index}
                style={{
                  marginTop: '10px',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  border: locker.cleared ? '2px solid #52c41a' : '2px solid transparent',
                }}
                styles={{ body: { padding: '16px 24px', display: 'flex', alignItems: 'center', gap: '20px' } }}
                onClick={() => { handleReopen(locker, index); }}
              >
                <MdOutlineDoorBack size={50} style={{ color: locker.cleared ? '#52c41a' : '#42A4DE', flexShrink: 0 }} />
                <div style={{ flexShrink: 0 }}>
                  <div style={{ ...getTextStyle({ color: locker.cleared ? '#52c41a' : '#42A4DE', fontSize: '30px', fontWeight: 'bold' }) }}>Door #{locker.locker}</div>
                  <span style={{ ...getTextStyle({ color: sessionDevice.value?.status?.[locker.locker]?.isOpen ? '#22c55e' : '#ef4444', fontSize: '22px' }) }}>
                    {sessionDevice.value?.status?.[locker.locker]?.isOpen ? 'OPEN' : 'CLOSED'}
                  </span>
                  <span style={{ ...getTextStyle({ color: locker.cleared ? '#52c41a' : '#42A4DE', fontSize: '22px', marginLeft: '10px' }) }}>
                    {locker.cleared ? '✓ Cleared' : locker.error ? 'Error' : 'Tap to re-open'}
                  </span>
                </div>

                <div style={{ borderLeft: '1px solid #e0e0e0', height: '50px', margin: '0 8px', flexShrink: 0 }} />

                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px', overflow: 'hidden' }}>
                  {showInline ? (
                    titles.map((item, ti) => (
                      <span key={ti} style={{ fontSize: '24px', padding: '6px 16px', borderRadius: '8px', backgroundColor: SEBlue.value, color: 'white', fontWeight: 'bold', whiteSpace: 'nowrap', display: 'inline-block' }}>
                        {item.title ? `${item.title} | ${item.barcode}` : item.barcode}
                      </span>
                    ))
                  ) : (
                    <span style={{ ...getTextStyle({ fontSize: '26px', fontWeight: 'bold', color: '#333' }) }}>
                      {itemCount} item{itemCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>

        {(!expiredHoldLockers || expiredHoldLockers.length === 0) && (
          <Row justify="center" style={{marginTop: '40px'}}>
            <Col style={{...getTextStyle({color: 'white', fontSize: '18px'})}}>
              No expired items found in manifest
            </Col>
          </Row>
        )}

        <Row justify="center" gutter={[16, 16]} style={{position: 'absolute', bottom: '20px', width: '100%'}}>
          <Col span={24} style={{textAlign: 'center'}}><Button type="primary" size="large" style={{height: 'auto', padding: '30px 120px', fontSize: '36px', borderRadius: '12px'}} onClick={() => {returnToMainView()}}>{t('DONE')}</Button></Col>
        </Row>
      </>
    );
  }

  const HtmlRemoveAllLeftBehind = () => {
    return (
      <>
              <Row>
                <Divider style={dividerStyle}>
                  Left Behind Items
                </Divider>
              </Row>

              <Row gutter={[16, 16]}>
                <Col offset={4} span={20} style={{...getTextStyle({color: 'white', textAlign: 'left', marginTop: '20px'})}}>
                  Remove all left behind items from all opened doors
                </Col>

              </Row>

              <Divider style={{...dividerStyle, color: 'red', marginTop: '20px'}}>
                Remove {leftBehindLockers.length} left behind lockers
              </Divider>


                {leftBehindLockers.map((locker: any, index: number) => {
                  return (
                    <Row gutter={[16, 16]} style={{marginTop: '20px'}}>

                    <Col offset={2} span={1}  style={{...getTextStyle({color: 'white', textAlign: 'left', marginTop: '10px'})}} key={index}>
                      {index + 1}
                    </Col>

                    <Col span={5}  style={{...getTextStyle({color: 'white', textAlign: 'left', marginTop: '10px'})}} key={index}>
                      Locker #{locker.locker}
                    </Col>

                    <Col span={5}  style={{...getTextStyle({color: 'white', textAlign: 'left'})}} key={index}>
                      Left behind items {locker.itemId.split(',').length}
                    </Col>

                    <Col span={5}  style={{...getTextStyle({color: 'white', textAlign: 'left'})}} key={index}>
                        {locker.isOpen ?
                          <span style={{...getTextStyle({color: 'green'})}}>{t('DOOR.OPEN')}</span>
                          :
                          <span style={{...getTextStyle({color: 'red'})}}>{t('DOOR.CLOSED')}</span>
                        }
                    </Col>

                    <Col span={4}  style={{...getTextStyle({color: 'white', textAlign: 'left'})}} key={index}>
                      <Button type="primary" style={{height: 'auto', padding: 'auto', margin: 'auto', marginRight: '10px'}} onClick={() => {openDoor(sessionDevice.value.settings.macid, +locker.locker); resetAdminTimer();}}>{<span style={getTextStyle({height: 'auto', padding: 'auto', margin: 'auto', zoom: 1.2})}>{t('SAAS.REOPEN_DOOR', {door: locker.locker})}</span>}</Button>
                    </Col>
                    </Row>
                    )
                  })}




              <Row justify="center" gutter={[16, 16]} style={{position: 'absolute', bottom: '50px', width: '100%'}}>
                <Col span={24} style={{...getTextStyle({color: 'white', float: 'right'})}}><Button type="primary" size="large" style={{height: 'auto', padding: '40px 120px', margin: 'auto', marginRight: '10px', fontSize: '28px', backgroundColor: '#52c41a', borderColor: '#52c41a'}} onClick={() => {returnToMainView()}}>Done</Button></Col>
              </Row>




      </>
  )}

  // Door Grid as a proper React component for signal reactivity
  // Cloned from sideevent/components/doors-grid.tsx pattern
  // Memoized to prevent re-renders from parent timer updates
  const DoorGridTab = React.useMemo(() => React.memo(() => {
    useSignals(); // Enable signal reactivity in this component
    const [doorGridGroupFilter, setDoorGridGroupFilter] = React.useState('all');
    const [showOpenGroupSelectModal, setShowOpenGroupSelectModal] = React.useState(false);
    const [selectedGroupsToOpen, setSelectedGroupsToOpen] = React.useState<string[]>([]);
    const [doorOpeningProgress, setDoorOpeningProgress] = React.useState<{current: number, total: number, label: string} | null>(null);
    const [pusatecColTab, setPusatecColTab] = React.useState(0);

    // Use signal value directly - useSignal hook makes component reactive to changes
    const device = sessionDevice.value;
    const deviceStatus = device?.status;

    // Get door data and settings from device (matching preview modal logic)
    // If thedoors is not populated, create door data from manifest groups
    let doorsData = device?.thedoors || [];

    // Fallback: If no thedoors data, construct from manifest groups or config.locker.groups
    if (doorsData.length === 0) {
      const constructedDoors: any[] = [];

      // Try device.manifest.groups first
      let groups = device?.manifest?.groups;

      if (groups) {
        const groupsArray = Array.isArray(groups) ? groups : Object.values(groups);

        for (const group of groupsArray) {
          const groupData = group as any;
          if (groupData.lockers) {
            const lockers = Array.isArray(groupData.lockers)
              ? groupData.lockers
              : Object.values(groupData.lockers);

            for (const locker of lockers) {
              if (!locker) continue;
              const lockerData = locker as any;
              const doorNum = lockerData.doorNumber || lockerData.door;

              if (doorNum) {
                constructedDoors.push({
                  doorNumber: doorNum,
                  door: doorNum,
                  size: lockerData.size || 'medium',
                  col: 1, // Default column
                  row: doorNum, // Default row based on door number
                  ada: lockerData.isAda || lockerData.ada || false,
                  enabled: true,
                  open: false // We'll get real status from device.status if available
                });
              }
            }
          }
        }

        // Sort by door number and assign proper column/row
        constructedDoors.sort((a, b) => a.doorNumber - b.doorNumber);

        // Assign column and row (4 doors in a single column by default)
        constructedDoors.forEach((door, index) => {
          door.col = 1;
          door.row = index + 1;
        });

        doorsData = constructedDoors;
      }
    }

    const displayPos = device?.settings?.displayPos || 0;
    const displaySize = device?.settings?.displaySize || '';
    const lockerCols = device?.settings?.lockerCols;

    // Helper to get door size height - sized so 12 small doors fit in view (~900px available)
    // Max height reference: ~900px for grid area (1080px - header ~100px - toolbar ~80px)
    const maxGridHeight = 900; // hairline reference for max height
    const smallHeight = Math.floor(maxGridHeight / 12); // ~75px per small door

    const getSizeHeightClass = (size: string) => {
      switch (size?.toLowerCase()) {
        case 'small': return smallHeight;           // ~75px (12 fit in view)
        case 'medium': return smallHeight * 2;      // ~150px
        case 'large': return smallHeight * 4;       // ~300px
        case 'xxl': return smallHeight * 8;         // ~600px
        case 'custom1': return smallHeight * 2.5;   // ~187px
        case 'custom2': return smallHeight * 3;     // ~225px
        case 'custom3': return smallHeight * 5;     // ~375px
        case 'external': return smallHeight * 2;    // ~150px
        default: return smallHeight * 2;            // ~150px
      }
    };

    // Helper to check if door is open - matching sideevent/doors-grid.tsx pattern
    // Read status from device.status.<doorNumber>.isOpen
    const isDoorOpen = (door: any) => {
      // Match exact pattern from sideevent: device?.status?.[door?.doorNumber]
      const doorStatus = deviceStatus?.[door?.doorNumber];
      const isOpen = doorStatus?.isOpen === true || doorStatus?.isOpen === 1;
      console.log('🚪 isDoorOpen:', { doorNumber: door?.doorNumber, doorStatus, isOpen });
      return isOpen;
    };

    // Helper to get color hex value
    const getColorHex = (colorName: string): string | undefined => {
      const colorMap: Record<string, string> = {
        slate: '#64748b', gray: '#6b7280', zinc: '#71717a', neutral: '#737373',
        stone: '#78716c', red: '#ef4444', orange: '#f97316', amber: '#f59e0b',
        yellow: '#eab308', lime: '#84cc16', green: '#22c55e', emerald: '#10b981',
        teal: '#14b8a6', cyan: '#06b6d4', sky: '#0ea5e9', blue: '#3b82f6',
        indigo: '#6366f1', violet: '#8b5cf6', purple: '#a855f7', fuchsia: '#d946ef',
        pink: '#ec4899', rose: '#f43f5e'
      };
      return colorMap[colorName?.toLowerCase()];
    };

    // Helper to get door info including item count, group color, group image, group name
    const getDoorInfo = (doorNumber: number) => {
      let itemCount = 0;
      let doorGroupColor = '';
      let doorGroupImage = '';
      let doorGroupName = '';
      let doorBelongsToSelectedGroup = doorGridGroupFilter === 'all';

      if (device?.manifest?.groups) {
        for (const [groupId, group] of Object.entries(device.manifest.groups)) {
          const groupData = group as any;
          if (!groupData.lockers) continue;

          const lockers = Array.isArray(groupData.lockers)
            ? groupData.lockers
            : Object.values(groupData.lockers);

          for (const locker of lockers) {
            if ((locker as any)?.doorNumber === doorNumber) {
              if (doorGridGroupFilter === 'all' || doorGridGroupFilter === groupId) {
                doorBelongsToSelectedGroup = true;
              }
              const itemIds = (locker as any).itemIds;
              itemCount = itemIds && Array.isArray(itemIds) ? itemIds.length : 0;
              doorGroupColor = groupData.color || '';
              doorGroupImage = groupData.image || '';
              doorGroupName = groupData.name || '';
              break;
            }
          }
        }
      }

      return { itemCount, doorGroupColor, doorGroupImage, doorGroupName, doorBelongsToSelectedGroup };
    };

    // Build bind pairs map: odd door is always the master
    const bindMap = new Map<number, { isMaster: boolean, partnerDoorNumber: number }>();
    {
      const visited = new Set<number>();
      doorsData.forEach((d: any) => {
        if (visited.has(d.doorNumber) || d.bindWithDoor == null) return;
        const doorNum = d.doorNumber;
        const partnerNum = Number(d.bindWithDoor);
        visited.add(doorNum);
        visited.add(partnerNum);
        const master = doorNum % 2 !== 0 ? doorNum : partnerNum;
        const slave = doorNum % 2 !== 0 ? partnerNum : doorNum;
        bindMap.set(master, { isMaster: true, partnerDoorNumber: slave });
        bindMap.set(slave, { isMaster: false, partnerDoorNumber: master });
      });
    }

    // Create working doors data with display if needed (matching preview logic)
    let workingDoorsData = [...doorsData];
    const shouldInjectDisplay = displayPos > 0 || displaySize?.toLowerCase() === 'external';

    if (shouldInjectDisplay && displayPos > 0) {
      const sortedDoors = [...workingDoorsData].sort((a, b) => a.doorNumber - b.doorNumber);
      let displayCol = 1;
      if (displayPos <= sortedDoors.length) {
        displayCol = sortedDoors[displayPos - 1]?.col ?? 1;
      } else {
        displayCol = sortedDoors[sortedDoors.length - 1]?.col ?? 1;
      }

      const displayCard = {
        doorNumber: 'DISPLAY',
        isDisplay: true,
        size: displaySize?.toLowerCase() || 'medium',
        col: displayCol,
        originalPosition: displayPos
      };

      const insertIndex = Math.min(displayPos - 1, workingDoorsData.length);
      workingDoorsData.splice(insertIndex, 0, displayCard);
    }

    // Group doors by column
    const maxCol = Math.max(...(workingDoorsData.map((d: any) => d?.col ?? 1)));
    const columns: any[][] = Array.from({ length: maxCol }, () => []);

    workingDoorsData.forEach((door: any) => {
      const col = (door?.col ?? 1) - 1;
      if (col >= 0 && col < columns.length) {
        columns[col].push(door);
      } else if (columns.length > 0) {
        columns[columns.length - 1].push(door);
      }
    });

    // Sort each column by row
    columns.forEach(col => col.sort((a, b) => (a?.row ?? 1) - (b?.row ?? 1)));

    // Pusatec mode: arrange doors in L/R pairs per row, grouped by column units
    const pusatecEnabled = device?.settings?.hwIntegrations?.pusatecEnabled || false;
    let pusatecLayout: { col: number, rows: { left?: any, right?: any }[] }[] | null = null;

    if (pusatecEnabled) {
      const sorted = [...doorsData].sort((a, b) => a.doorNumber - b.doorNumber);
      const colUnits = new Map<number, any[]>();
      sorted.forEach((d: any) => {
        const col = d.col ?? 1;
        if (!colUnits.has(col)) colUnits.set(col, []);
        colUnits.get(col)!.push(d);
      });

      const hasDisplay = displayPos > 0;
      const displayCard = hasDisplay ? {
        doorNumber: 'DISPLAY',
        isDisplay: true,
        size: displaySize?.toLowerCase() || 'small',
        col: 1
      } : null;

      const units: { col: number, rows: { left?: any, right?: any }[] }[] = [];
      colUnits.forEach((unitDoors, col) => {
        const rows: { left?: any, right?: any }[] = [];
        for (let i = 0; i < unitDoors.length; i += 2) {
          const left = unitDoors[i]?.doorNumber % 2 !== 0 ? unitDoors[i] : unitDoors[i + 1];
          const right = unitDoors[i]?.doorNumber % 2 === 0 ? unitDoors[i] : unitDoors[i + 1];
          const dc = displayCard ? { ...displayCard, col } : null;
          if (hasDisplay && left?.doorNumber === displayPos) {
            rows.push({ left: dc, right });
          } else if (hasDisplay && right?.doorNumber === displayPos) {
            rows.push({ left, right: dc });
          } else {
            rows.push({ left, right });
          }
        }
        units.push({ col, rows });
      });
      pusatecLayout = units;
    }

    // Pusatec column tab computation
    const pusatecTotalCols = pusatecLayout ? pusatecLayout.length : 0;
    const pusatecPerTab = 3;
    const pusatecTabCount = pusatecTotalCols > pusatecPerTab ? Math.ceil(pusatecTotalCols / pusatecPerTab) : 0;
    const pusatecTabs = pusatecTabCount > 0 ? Array.from({ length: pusatecTabCount }, (_, i) => {
      const start = i * pusatecPerTab;
      const end = Math.min(start + pusatecPerTab, pusatecTotalCols);
      return { label: `Col ${start + 1}-${end}`, start, end };
    }) : null;
    const activeColTab = pusatecTabs ? Math.min(pusatecColTab, pusatecTabs.length - 1) : 0;

    // Open doors for specific groups (used when only one group exists)
    const openGroupDoors = async (groupIds: string[]) => {
      try {
        setLoading(true);
        const doorNumbersToOpen: number[] = [];

        for (const groupId of groupIds) {
          const group = device?.manifest?.groups?.[groupId];
          if (!group) continue;
          const groupData = group as any;
          if (!groupData.lockers) continue;

          const lockers = Array.isArray(groupData.lockers) ? groupData.lockers : Object.values(groupData.lockers);
          for (const locker of lockers) {
            if (!locker) continue;
            const lockerData = locker as any;
            if (lockerData?.doorNumber) {
              doorNumbersToOpen.push(lockerData.doorNumber);
            }
          }
        }

        const uniqueDoorNumbers = [...new Set(doorNumbersToOpen)];

        // Get integrations from localStorage
        const cachedIntegrations = localStorage.getItem('integrations');
        let integrations: any[] = [];

        if (cachedIntegrations) {
          try {
            const integrationsObj = JSON.parse(cachedIntegrations);
            integrations = Array.isArray(integrationsObj) ? integrationsObj : Object.values(integrationsObj);
          } catch (error) {
            console.error('Error parsing integrations:', error);
          }
        }

        if (integrations.length > 0) {
          const integration = integrations[0];
          const mac = integration.macId || integration.mac;
          const ip = integration.ip;

          console.log(`Opening ${uniqueDoorNumbers.length} doors using integration MAC: ${mac}, IP: ${ip}`);

          const electron = (window as any).electron;
          for (const doorNumber of uniqueDoorNumbers) {
            console.log(`Opening door ${doorNumber}...`);
            try {
              await electron.sideeventNative.openLockerDoor(doorNumber, mac, ip);
              console.log(`Door ${doorNumber} opened successfully`);
              await Promise.delay(1000);
            } catch (error) {
              console.error(`Error opening door ${doorNumber}:`, error);
            }
          }
        } else {
          console.log('No integrations found, using device settings');
          for (const doorNumber of uniqueDoorNumbers) {
            await openDoor(device.settings.macid, doorNumber);
            await Promise.delay(1000);
          }
        }

        setLoading(false);
        customToast(() => `Opened ${uniqueDoorNumbers.length} door(s) successfully!`, 3000, 'success', 'dark');
      } catch (error: any) {
        setLoading(false);
        console.error('Error opening group doors:', error);
        customToast(() => `Failed to open doors: ${error.message}`, 3000, 'error', 'dark');
      }
    };

    // Handle open group select modal
    const handleOpenGroupSelect = async () => {
      const groups = device?.manifest?.groups;
      if (groups) {
        const groupIds = Object.keys(groups);
        // If only one group, pre-select it
        if (groupIds.length === 1) {
          setSelectedGroupsToOpen([groupIds[0]]);
        } else {
          setSelectedGroupsToOpen([]);
        }
      } else {
        setSelectedGroupsToOpen([]);
      }
      setShowOpenGroupSelectModal(true);
    };

    // Toggle group selection
    const toggleGroupSelection = (groupId: string) => {
      setSelectedGroupsToOpen(prev => {
        const prevArray = Array.isArray(prev) ? prev : [];
        return prevArray.includes(groupId)
          ? prevArray.filter(id => id !== groupId)
          : [...prevArray, groupId];
      });
    };

    // Confirm opening selected groups
    const confirmOpenSelectedGroups = async () => {
      if (selectedGroupsToOpen.length === 0) {
        customToast(() => 'Please select at least one group', 2000, 'default', 'dark');
        return;
      }

      try {
        setLoading(true);
        setDoorOpeningProgress({ current: 0, total: 0, label: 'Opening Selected Doors' });
        const doorNumbersToOpen: number[] = [];

        // Handle special selections
        if (Array.isArray(selectedGroupsToOpen) && selectedGroupsToOpen.includes('all_with_items')) {
          // Get all doors with items
          if (device?.manifest?.groups) {
            for (const group of Object.values(device.manifest.groups)) {
              const groupData = group as any;
              if (!groupData.lockers) continue;
              const lockers = Array.isArray(groupData.lockers) ? groupData.lockers : Object.values(groupData.lockers);
              for (const locker of lockers) {
                if (!locker) continue;
                const lockerData = locker as any;
                if (lockerData?.doorNumber && lockerData.itemIds && Array.isArray(lockerData.itemIds) && lockerData.itemIds.length > 0) {
                  doorNumbersToOpen.push(lockerData.doorNumber);
                }
              }
            }
          }
        }

        if (Array.isArray(selectedGroupsToOpen) && selectedGroupsToOpen.includes('all_no_items')) {
          // Get all doors without items
          const usedDoors = new Set<number>();
          if (device?.manifest?.groups) {
            for (const group of Object.values(device.manifest.groups)) {
              const groupData = group as any;
              if (!groupData.lockers) continue;
              const lockers = Array.isArray(groupData.lockers) ? groupData.lockers : Object.values(groupData.lockers);
              for (const locker of lockers) {
                if (!locker) continue;
                const lockerData = locker as any;
                if (lockerData?.doorNumber) {
                  usedDoors.add(lockerData.doorNumber);
                }
              }
            }
          }
          const emptyDoors = doorsData.filter((door: any) => door.enabled && !usedDoors.has(door.doorNumber));
          doorNumbersToOpen.push(...emptyDoors.map((d: any) => d.doorNumber));
        }

        // Handle specific group selections
        for (const groupId of selectedGroupsToOpen) {
          if (groupId === 'all_with_items' || groupId === 'all_no_items') continue;

          const group = device?.manifest?.groups?.[groupId];
          if (!group) continue;
          const groupData = group as any;
          if (!groupData.lockers) continue;

          const lockers = Array.isArray(groupData.lockers) ? groupData.lockers : Object.values(groupData.lockers);
          for (const locker of lockers) {
            if (!locker) continue;
            const lockerData = locker as any;
            if (lockerData?.doorNumber) {
              doorNumbersToOpen.push(lockerData.doorNumber);
            }
          }
        }

        // Remove duplicates
        const uniqueDoorNumbers = [...new Set(doorNumbersToOpen)];
        const totalDoors = uniqueDoorNumbers.length;

        // Get integrations from localStorage (saved by App.tsx)
        const cachedIntegrations = localStorage.getItem('integrations');
        let integrations: any[] = [];

        if (cachedIntegrations) {
          try {
            const integrationsObj = JSON.parse(cachedIntegrations);
            integrations = Array.isArray(integrationsObj) ? integrationsObj : Object.values(integrationsObj);
          } catch (error) {
            console.error('Error parsing integrations:', error);
          }
        }

        // If we have integrations, use the first one's MAC and IP
        if (integrations.length > 0) {
          const integration = integrations[0];
          const mac = integration.macId || integration.mac;
          const ip = integration.ip;

          console.log(`Opening ${uniqueDoorNumbers.length} doors using integration MAC: ${mac}, IP: ${ip}`);

          const electron = (window as any).electron;
          for (let i = 0; i < uniqueDoorNumbers.length; i++) {
            const doorNumber = uniqueDoorNumbers[i];
            setDoorOpeningProgress({ current: i + 1, total: totalDoors, label: 'Opening Selected Doors' });
            console.log(`Opening door ${doorNumber}...`);
            try {
              await electron.sideeventNative.openLockerDoor(doorNumber, mac, ip);
              console.log(`Door ${doorNumber} opened successfully`);
              await Promise.delay(300);
            } catch (error) {
              console.error(`Error opening door ${doorNumber}:`, error);
            }
          }
        } else {
          // Fallback to old behavior if no integrations found
          console.log('No integrations found, using device settings');
          for (let i = 0; i < uniqueDoorNumbers.length; i++) {
            const doorNumber = uniqueDoorNumbers[i];
            setDoorOpeningProgress({ current: i + 1, total: totalDoors, label: 'Opening Selected Doors' });
            await openDoor(device.settings.macid, doorNumber);
            await Promise.delay(300);
          }
        }

        setDoorOpeningProgress(null);
        setLoading(false);
        customToast(() => `Opened ${uniqueDoorNumbers.length} door(s) successfully!`, 3000, 'success', 'dark');
        setShowOpenGroupSelectModal(false);
        setSelectedGroupsToOpen([]);
      } catch (error: any) {
        setDoorOpeningProgress(null);
        setLoading(false);
        console.error('Error opening doors:', error);
        customToast(() => `Failed to open doors: ${error.message}`, 3000, 'error', 'dark');
      }
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 210px)', overflow: 'hidden', boxSizing: 'border-box', position: 'relative', zIndex: 101 }}>
        <div style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
            {device?.manifest?.groups && (
              <select
                value={doorGridGroupFilter}
                onChange={(e) => setDoorGridGroupFilter(e.target.value)}
                style={{
                  padding: '8px 12px',
                  border: '1px solid #d1d5db',
                  borderRadius: '6px',
                  fontSize: '28px',
                  color: SEBlue.value,
                  backgroundColor: 'white',
                  cursor: 'pointer'
                }}
              >
                <option value="all">All Groups</option>
                {Object.entries(device.manifest.groups).map(([groupId, group]: [string, any]) => (
                  <option key={groupId} value={groupId}>
                    {group.name}
                  </option>
                ))}
              </select>
            )}
            {pusatecTabs && pusatecTabs.map((tab, idx) => (
              <button
                key={idx}
                onClick={() => setPusatecColTab(idx)}
                style={{
                  padding: '10px 24px',
                  borderRadius: '9999px',
                  fontSize: '26px',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  backgroundColor: activeColTab === idx ? '#2563eb' : '#e5e7eb',
                  color: activeColTab === idx ? 'white' : '#4b5563',
                  boxShadow: activeColTab === idx ? '0 1px 3px rgb(0 0 0 / 0.2)' : 'none'
                }}
              >
                {tab.label}
              </button>
            ))}
        </div>

        {/* Open Group Select Modal */}
        <Modal
          title={<span style={{...getTextStyle({fontSize: '32px', fontWeight: 'bold'})}}>Select Groups to Open</span>}
          open={showOpenGroupSelectModal}
          onCancel={() => {
            if (!doorOpeningProgress) {
              setShowOpenGroupSelectModal(false);
              setSelectedGroupsToOpen([]);
            }
          }}
          closable={!doorOpeningProgress}
          maskClosable={!doorOpeningProgress}
          footer={doorOpeningProgress ? null : [
            <Button
              key="cancel"
              size="large"
              onClick={() => {
                setShowOpenGroupSelectModal(false);
                setSelectedGroupsToOpen([]);
              }}
              style={{...getTextStyle({fontSize: '24px', padding: '15px 40px', height: 'auto'})}}
            >
              Cancel
            </Button>,
            <Button
              key="submit"
              type="primary"
              size="large"
              disabled={selectedGroupsToOpen.length === 0}
              onClick={confirmOpenSelectedGroups}
              style={{
                ...getTextStyle({fontSize: '24px', padding: '15px 40px', height: 'auto'}),
                backgroundColor: selectedGroupsToOpen.length === 0 ? '#9ca3af' : '#ea580c',
                borderColor: selectedGroupsToOpen.length === 0 ? '#9ca3af' : '#ea580c'
              }}
            >
              Open Selected ({selectedGroupsToOpen.length})
            </Button>
          ]}
          width={1200}
          centered
        >
          {doorOpeningProgress ? (
            <div style={{...getTextStyle({fontSize: '22px', padding: '40px', textAlign: 'center'})}}>
              <Spin size="large" />
              <div style={{ marginTop: '20px' }}>
                {doorOpeningProgress.current === 0 ? 'Preparing to open doors...' : `Opening door ${doorOpeningProgress.current} of ${doorOpeningProgress.total}...`}
              </div>
            </div>
          ) : (
          <div style={{ maxHeight: '70vh', overflowY: 'auto', overflowX: 'hidden', padding: '30px 10px' }}>
            <Space direction="vertical" style={{ width: '100%' }} size="large">
              {/* Group options */}
              <div>
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                  {sessionDevice.value?.manifest?.groups && Object.entries(sessionDevice.value.manifest.groups).map(([groupId, group]: [string, any]) => {
                    // Count doors in this group
                    let doorCount = 0;
                    const groupData = group as any;
                    if (groupData.lockers) {
                      const lockers = Array.isArray(groupData.lockers) ? groupData.lockers : Object.values(groupData.lockers);
                      doorCount = lockers.length;
                    }

                    // Get group color
                    const groupColor = groupData.color ? getColorHex(groupData.color) : '#3b82f6';
                    const isSelected = Array.isArray(selectedGroupsToOpen) && selectedGroupsToOpen.includes(groupId);

                    return (
                      <Button
                        key={groupId}
                        size="large"
                        block
                        onClick={() => toggleGroupSelection(groupId)}
                        style={{
                          ...getTextStyle({fontSize: '26px', padding: '25px', height: 'auto', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'flex-start'}),
                          backgroundColor: isSelected ? groupColor : (groupColor + '15'), // Selected: full opacity, Unselected: ~8% opacity
                          borderColor: groupColor,
                          borderWidth: isSelected ? '3px' : '2px',
                          color: '#111827',
                          boxSizing: 'border-box'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', width: '100%' }}>
                          {groupData.image && (
                            <img
                              src={groupData.image}
                              alt={group.name}
                              style={{
                                width: '90px',
                                height: '90px',
                                objectFit: 'cover',
                                borderRadius: '50%',
                                border: `4px solid ${groupColor}`
                              }}
                            />
                          )}
                          <span style={{ flex: 1, textAlign: 'left' }}>
                            {isSelected ? '✓ ' : ''}Open all {group.name} ({doorCount}) doors
                          </span>
                        </div>
                      </Button>
                    );
                  })}
                </Space>
              </div>
            </Space>
          </div>
          )}
        </Modal>

        {doorsData.length === 0 && !shouldInjectDisplay ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'white', flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
            <p style={{...getTextStyle({}, 12)}}>No door configuration found</p>
            <p style={{...getTextStyle({marginTop: '10px', color: '#9ca3af'}, 10)}}>
              Please configure doors in the device settings on the admin dashboard
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
            <div style={{
              border: '3px solid #1f2937',
              borderRadius: '6px',
              padding: '4px',
              backgroundColor: '#f3f4f6',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              boxSizing: 'border-box',
              minHeight: 0,
              minWidth: 0
            }}>
              {(() => {
                // Flex value based on door size for proportional height
                const getSizeFlex = (size: string) => {
                  switch (size?.toLowerCase()) {
                    case 'small': return 1;
                    case 'medium': return 2;
                    case 'large': return 4;
                    case 'xxl': return 8;
                    case 'custom1': return 2.5;
                    case 'custom2': return 3;
                    case 'custom3': return 5;
                    case 'external': return 2;
                    default: return 2;
                  }
                };

                // Helper to render a single door card in the grid tab (flex-based)
                const renderGridDoorCard = (door: any, key: string | number, useFlex?: boolean) => {
                  const flexValue = getSizeFlex(door?.size || 'medium');

                  if (door?.isDisplay) {
                    return (
                      <div
                        key={key}
                        style={{
                          border: '4px solid #3b82f6',
                          borderRadius: '8px',
                          padding: '12px',
                          flex: useFlex ? `${flexValue} 1 0` : undefined,
                          minHeight: useFlex ? '40px' : `${getSizeHeightClass(door?.size || 'medium')}px`,
                          width: useFlex ? undefined : '100%',
                          background: 'linear-gradient(to bottom right, #eff6ff, #dbeafe)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          boxSizing: 'border-box' as const,
                          overflow: 'hidden'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.boxShadow = '0 20px 25px -5px rgb(0 0 0 / 0.1)';
                          e.currentTarget.style.transform = 'scale(1.05)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.boxShadow = '0 10px 15px -3px rgb(0 0 0 / 0.1)';
                          e.currentTarget.style.transform = 'scale(1)';
                        }}
                        onClick={() => setModal_showCmdCommands(true)}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                          <svg style={{ width: '56px', height: '56px', color: '#2563eb' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                          </svg>
                          <span style={{ ...getTextStyle({ fontWeight: 'bold', color: '#1e40af' }, 10) }}>DISPLAY</span>
                        </div>
                      </div>
                    );
                  }

                  const bindInfo = bindMap.get(door?.doorNumber);
                  const isSlave = bindInfo && !bindInfo.isMaster;
                  // Slaves are not rendered individually - part of the combined card
                  if (isSlave) return null;

                  const isMaster = bindInfo && bindInfo.isMaster;
                  const isOpen = isDoorOpen(door);
                  const { itemCount, doorGroupColor, doorGroupImage, doorGroupName, doorBelongsToSelectedGroup } = getDoorInfo(door.doorNumber);
                  const hasItems = itemCount > 0;
                  const isDisabled = !doorBelongsToSelectedGroup;
                  const closedBgColorHex = doorGroupColor ? getColorHex(doorGroupColor) : undefined;
                  const closedBorderColorHex = doorGroupColor ? getColorHex(doorGroupColor) : undefined;

                  // Slave info for bound pairs
                  let slaveDoor: any = null;
                  let slaveIsOpen = false;
                  let slaveHasItems = false;
                  let slaveItemCount = 0;
                  if (isMaster) {
                    slaveDoor = doorsData.find((d: any) => d.doorNumber === bindInfo.partnerDoorNumber);
                    if (slaveDoor) {
                      slaveIsOpen = isDoorOpen(slaveDoor);
                      const slaveInfo = getDoorInfo(slaveDoor.doorNumber);
                      slaveHasItems = slaveInfo.itemCount > 0;
                      slaveItemCount = slaveInfo.itemCount;
                    }
                  }

                  let cardStyle: any = {
                    flex: useFlex ? (isMaster ? `${flexValue} 1 0` : `${flexValue} 1 0`) : undefined,
                    minHeight: useFlex ? '40px' : `${getSizeHeightClass(door?.size)}px`,
                    width: useFlex ? undefined : '100%',
                    border: '2px solid',
                    borderRadius: '10px',
                    padding: '10px',
                    cursor: isDisabled ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s',
                    boxSizing: 'border-box',
                    overflow: 'hidden',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                  };

                  if (isDisabled) {
                    cardStyle.backgroundColor = '#e5e7eb';
                    cardStyle.borderColor = '#d1d5db';
                    cardStyle.opacity = 0.4;
                  } else if (isOpen) {
                    cardStyle.backgroundColor = '#fef2f2';
                    cardStyle.borderColor = '#fca5a5';
                  } else {
                    cardStyle.backgroundColor = closedBgColorHex || '#f0fdf4';
                    cardStyle.borderColor = closedBorderColorHex || '#86efac';
                  }

                  if (isMaster) {
                    cardStyle.borderColor = '#6366f1';
                  }

                  const linkIcon = isMaster ? (
                    <svg style={{ width: '12px', height: '12px', color: '#6366f1' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                  ) : null;

                  const handleClick = () => {
                    if (!isDisabled) {
                      setLoading(true);
                      setModal_openDoorTitle(t('ADMIN.ADMIN_OPENDOOR', { door: door.doorNumber }));
                      setGivenDoorNumber(door.doorNumber);
                      setModal_confirmCleanupAction('openGivenDoor');
                      setModal_openGivenDoor(true);
                    }
                  };

                  const hoverIn = (e: any) => {
                    if (!isDisabled) {
                      e.currentTarget.style.boxShadow = 'inset 0 0 10px rgba(0,0,0,0.2)';
                      e.currentTarget.style.transform = 'scale(0.97)';
                    }
                  };
                  const hoverOut = (e: any) => {
                    if (!isDisabled) {
                      e.currentTarget.style.boxShadow = '';
                      e.currentTarget.style.transform = 'scale(1)';
                    }
                  };

                  // Combined bound pair card with vertical dotted line
                  if (isMaster && slaveDoor) {
                    // In pusatec mode, take flex of 2 doors; otherwise span full width
                    if (useFlex) cardStyle.flex = `${flexValue * 2 + 0.1} 1 0`;
                    return (
                      <div key={key} style={cardStyle} onMouseEnter={hoverIn} onMouseLeave={hoverOut} onClick={handleClick}>
                        <div style={{ display: 'flex', height: '100%' }}>
                          {/* Master (odd) door - left */}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px', flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span style={{ ...getTextStyle({ fontWeight: 'bold' }, 12), whiteSpace: 'nowrap' }}>#{door.doorNumber}</span>
                              {linkIcon}
                              {door?.ada && (
                                <svg style={{ width: '14px', height: '14px', color: '#2563eb', flexShrink: 0 }} fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M10 2a2 2 0 100 4 2 2 0 000-4zM4 9a1 1 0 011-1h3.5a1 1 0 01.867.5l1.5 2.598a1 1 0 01-.866 1.5H8v4a1 1 0 11-2 0v-4.5a.5.5 0 00-.5-.5H5a1 1 0 01-1-1V9zm11.5 7.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm0-1.5a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                                </svg>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              {hasItems && (
                                <span style={{ ...getTextStyle({ fontWeight: '600' }, 7), padding: '2px 6px', borderRadius: '4px', backgroundColor: '#e9d5ff', color: '#6b21a8', whiteSpace: 'nowrap' }}>({itemCount})</span>
                              )}
                              <span style={{ ...getTextStyle({ fontWeight: '600' }, 7), padding: '2px 6px', borderRadius: '4px', backgroundColor: isOpen ? '#fecaca' : '#bbf7d0', color: isOpen ? '#991b1b' : '#15803d', whiteSpace: 'nowrap' }}>
                                {isOpen ? 'OPEN' : 'CLOSED'}
                              </span>
                            </div>
                          </div>
                          {/* Vertical dotted separator */}
                          <div style={{ borderLeft: '1px dashed #a5b4fc', margin: '-8px 0 -8px 6px', alignSelf: 'stretch' }} />
                          {/* Slave (even) door - right, disabled */}
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px', flex: 1, minWidth: 0, paddingLeft: '8px', opacity: 0.45 }}>
                            <span style={{ ...getTextStyle({}, 10), color: '#9ca3af', whiteSpace: 'nowrap' }}>#{bindInfo.partnerDoorNumber}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              {slaveHasItems && (
                                <span style={{ ...getTextStyle({ fontWeight: '600' }, 7), padding: '2px 6px', borderRadius: '4px', backgroundColor: '#e9d5ff', color: '#6b21a8', whiteSpace: 'nowrap' }}>({slaveItemCount})</span>
                              )}
                              <span style={{ ...getTextStyle({ fontWeight: '600' }, 7), padding: '2px 6px', borderRadius: '4px', backgroundColor: slaveIsOpen ? '#fecaca' : '#bbf7d0', color: slaveIsOpen ? '#991b1b' : '#15803d', whiteSpace: 'nowrap' }}>
                                {slaveIsOpen ? 'OPEN' : 'CLOSED'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={key} style={{...cardStyle, position: 'relative'}} onMouseEnter={hoverIn} onMouseLeave={hoverOut} onClick={handleClick}>
                      {door?.size?.toLowerCase() === 'small' ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '100%', gap: '12px', position: 'relative' }}>
                          {doorGroupImage && (
                            <img src={doorGroupImage} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: 0.08, pointerEvents: 'none' }} />
                          )}
                          <span style={{ ...getTextStyle({ fontWeight: 'bold' }, 12), whiteSpace: 'nowrap', position: 'relative', zIndex: 1 }}>#{door.doorNumber}</span>
                          {door?.ada && (
                            <svg style={{ width: '18px', height: '18px', color: '#2563eb', flexShrink: 0, position: 'relative', zIndex: 1 }} fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 2a2 2 0 100 4 2 2 0 000-4zM4 9a1 1 0 011-1h3.5a1 1 0 01.867.5l1.5 2.598a1 1 0 01-.866 1.5H8v4a1 1 0 11-2 0v-4.5a.5.5 0 00-.5-.5H5a1 1 0 01-1-1V9zm11.5 7.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm0-1.5a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                            </svg>
                          )}
                          {doorGroupName && (
                            <span style={{ ...getTextStyle({}, 5), color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60px', position: 'relative', zIndex: 1 }}>{doorGroupName}</span>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto', position: 'relative', zIndex: 1 }}>
                            {hasItems && (
                              <span style={{ ...getTextStyle({ fontWeight: '600' }, 7), padding: '4px 8px', borderRadius: '4px', backgroundColor: '#e9d5ff', color: '#6b21a8', whiteSpace: 'nowrap' }}>({itemCount})</span>
                            )}
                            <span style={{ ...getTextStyle({ fontWeight: '600' }, 7), padding: '4px 8px', borderRadius: '4px', backgroundColor: isOpen ? '#fecaca' : '#bbf7d0', color: isOpen ? '#991b1b' : '#15803d', whiteSpace: 'nowrap' }}>
                              {isOpen ? 'OPEN' : 'CLOSED'}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
                          {/* Subtle group image background */}
                          {doorGroupImage && (
                            <img src={doorGroupImage} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: 0.1, pointerEvents: 'none' }} />
                          )}
                          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', position: 'relative', zIndex: 1 }}>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span style={{ ...getTextStyle({ fontWeight: 'bold' }, 14) }}>#{door.doorNumber}</span>
                              {door?.ada && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#2563eb' }}>
                                  <svg style={{ width: '20px', height: '20px' }} fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 2a2 2 0 100 4 2 2 0 000-4zM4 9a1 1 0 011-1h3.5a1 1 0 01.867.5l1.5 2.598a1 1 0 01-.866 1.5H8v4a1 1 0 11-2 0v-4.5a.5.5 0 00-.5-.5H5a1 1 0 01-1-1V9zm11.5 7.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zm0-1.5a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                                  </svg>
                                  <span style={{ ...getTextStyle({ fontWeight: '600' }, 9) }}>(ADA)</span>
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                              <span style={{ ...getTextStyle({ fontWeight: '600' }, 8), padding: '6px 10px', borderRadius: '6px', backgroundColor: isOpen ? '#fecaca' : '#bbf7d0', color: isOpen ? '#991b1b' : '#15803d', whiteSpace: 'nowrap' }}>
                                {isOpen ? 'OPEN' : 'CLOSED'}
                              </span>
                              <span style={{ ...getTextStyle({ fontWeight: '600' }, 8), padding: '6px 10px', borderRadius: '6px', backgroundColor: hasItems ? '#e9d5ff' : '#f3f4f6', color: hasItems ? '#6b21a8' : '#6b7280', whiteSpace: 'nowrap' }}>
                                {hasItems ? `${itemCount} ITEM${itemCount !== 1 ? 'S' : ''}` : 'EMPTY'}
                              </span>
                            </div>
                          </div>
                          {/* Subtle group name at bottom-left */}
                          {doorGroupName && (
                            <div style={{ marginTop: 'auto', position: 'relative', zIndex: 1, textAlign: 'left' }}>
                              <span style={{ ...getTextStyle({ fontWeight: '500' }, 6), color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', textAlign: 'left' }}>{doorGroupName}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                };

                // Pusatec mode: L/R pairs per row (flex fill)
                if (pusatecEnabled && pusatecLayout) {
                  const visibleUnits = pusatecTabs ? pusatecLayout.slice(pusatecTabs[activeColTab].start, pusatecTabs[activeColTab].end) : pusatecLayout;
                  return (
                    <div style={{ display: 'flex', gap: '8px', flex: 1, minHeight: 0 }}>
                      {visibleUnits.map((unit) => (
                        <div key={unit.col} style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '6px', minWidth: 0, minHeight: 0 }}>
                          {unit.rows.map((row, rowIdx) => {
                            const leftNum = row.left?.doorNumber;
                            const isBound = leftNum != null && bindMap.has(leftNum) && bindMap.get(leftNum)!.isMaster;
                            if (isBound) {
                              return (
                                <div key={rowIdx} style={{ display: 'flex', gap: '4px', flex: getSizeFlex(row.left?.size || 'small'), minHeight: 0 }}>
                                  {row.left && renderGridDoorCard(row.left, `L-${row.left.doorNumber}`, true)}
                                </div>
                              );
                            }
                            return (
                              <div key={rowIdx} style={{ display: 'flex', gap: '4px', flex: getSizeFlex(row.left?.size || row.right?.size || 'small'), minHeight: 0 }}>
                                {row.left && renderGridDoorCard(row.left, `L-${row.left.doorNumber}`, true)}
                                {row.right && renderGridDoorCard(row.right, `R-${row.right.doorNumber}`, true)}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  );
                }

                // Normal mode: column-based layout (flex fill)
                return (
                  <div style={{ display: 'flex', gap: '8px', flex: 1, minHeight: 0 }}>
                    {columns.map((colDoors, colIndex) => (
                      <div key={colIndex} style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '6px', minWidth: 0, minHeight: 0 }}>
                        {colDoors.map((door: any, doorIndex: number) => renderGridDoorCard(door, doorIndex, true))}
                      </div>
                    ))}
                  </div>
                );
              })()}
          </div>
        </div>
        )}
      </div>
    );
  }), []);

  const getTabLabel = (key: string, label: string) => (
    <span style={{
      ...getTextStyle({ fontWeight: 'bold' }, 10),
      color: activeTab === key ? SEBlue.value : 'white',
      display: 'inline-block',
      padding: '4px 12px',
    }}>{label}</span>
  );

  const items: TabsProps['items'] = [
    { key: '1', label: getTabLabel('1', 'Cleanup'), children: mainHtmlCleanup(), disabled: isOffline},
    { key: '2', label: getTabLabel('2', 'Door Actions'), children: mainHtmlDoors()},
    { key: '3', label: getTabLabel('3', 'The doors'), children: <DoorGridTab />},
    { key: '4', label: getTabLabel('4', 'Tools'), children: mainHtmlTools()},
    { key: '6', label: getTabLabel('6', 'Workflows'), children: mainHtmlWorkflows(), disabled: isOffline},
  ];


  return (
    <>
      {/* Offline banner */}
      {isOffline && (
        <div style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          backgroundColor: '#ff4d4f',
          color: 'white',
          textAlign: 'center',
          padding: '12px 0',
          fontSize: '28px',
          fontWeight: 'bold',
          letterSpacing: '1px',
          boxShadow: '0 -4px 12px rgba(255, 77, 79, 0.4)',
        }}>
          ⚠ Kiosk is offline
        </div>
      )}

      {viewRemoveAllExpired && <span  style={{position: 'absolute', top: '120px', left: '20px', right: '20px', bottom: '20px', backgroundColor: `${SEBlue.value}40`, borderRadius: '8px', padding: '20px'}}><HtmlRemoveAllExpired /></span>}
      {/* Smart consolidation expired holds now routed through HtmlCancelledHolds via viewRemoveAllCancelled */}
      {viewRemoveAllCancelled && <span  style={{position: 'absolute', top: '120px', left: '20px', right: '20px', bottom: '20px', backgroundColor: `${SEBlue.value}40`, borderRadius: '8px', padding: '20px'}}><HtmlCancelledHolds /></span>}
      {viewRemoveAllLeftBehind && <span  style={{position: 'absolute', top: '120px', left: '20px', right: '20px', bottom: '20px', backgroundColor: `${SEBlue.value}40`, borderRadius: '8px', padding: '20px'}}><HtmlRemoveAllLeftBehind /></span>}
      {viewInspection && <span  style={{position: 'absolute', top: '120px', left: '20px', right: '20px', bottom: '20px', backgroundColor: `${SEBlue.value}40`, borderRadius: '8px', padding: '20px'}}><HtmlInspection /></span>}

      {viewMainView && <Tabs
        style={{position: 'absolute', top: '120px', left: '20px', right: '20px', bottom: isOffline ? '60px' : '4px', backgroundColor: `${SEBlue.value}40`, borderRadius: '8px', padding: '4px 12px', overflow: 'hidden'}}
        defaultActiveKey="1"
        activeKey={activeTab}
        items={items}
        onChange={(key) => { setActiveTab(key); onChange(key); }}
        type="card"
        size="large"
      />}

      <Modal
        title={<span style={getTextStyle({height: 'auto', padding: 'auto', margin: 'auto', fontSize: '48px', fontWeight: 'bold'})}>{modal_confirmCleanupActionTitle}</span>}
        open={modal_showConfirmCleanup}
        onOk={() => processModalResult()}
        onCancel={() => processModalResult(true)}
        style={{ top: 50, margin: '0 20px' }}
        width="calc(100vw - 40px)"
        footer={<div style={{padding: '20px 40px', display: 'flex', justifyContent: 'space-between'}}>
          <Button type="default" size="large" style={{height: 'auto', padding: '30px 100px', fontSize: '36px'}} onClick={() => processModalResult(true)}>{t('EXIT')}</Button>
          <Button type="primary" size="large" style={{height: 'auto', padding: '30px 100px', fontSize: '36px'}} onClick={() => processModalResult()}>{t('CONFIRM')}</Button>
        </div>}
      >
        <div style={{fontSize: '36px', marginBottom: '30px', marginTop: '30px', lineHeight: '1.4'}}>
          {modal_confirmCleanupActionBody}
        </div>

        <div style={{fontSize: '30px', marginBottom: '40px', marginTop: '20px', color: '#666'}}>
          {t('ADMIN.CLEANUP.CONFIRM_CLEANUP_ACTION')}
        </div>

      </Modal>

      {/* Open Single Door Modal */}
      <Modal
        title={<span style={{...getTextStyle({fontSize: '28px', fontWeight: 'bold'})}}>Open Door #{givenDoorNumber}</span>}
        open={modal_openGivenDoor}
        onCancel={() => processModalResult(true)}
        zIndex={2000}
        footer={[
          <Button
            key="cancel"
            size="large"
            onClick={() => processModalResult(true)}
            style={{...getTextStyle({fontSize: '24px', padding: '15px 40px', height: 'auto'})}}
          >
            Cancel
          </Button>,
          <Button
            key="confirm"
            type="primary"
            size="large"
            onClick={() => processModalResult()}
            style={{
              ...getTextStyle({fontSize: '24px', padding: '15px 40px', height: 'auto'}),
              backgroundColor: '#ea580c',
              borderColor: '#ea580c'
            }}
          >
            Open Door
          </Button>
        ]}
        width={800}
        centered
      >
        <div style={{...getTextStyle({fontSize: '22px', padding: '20px', textAlign: 'center'})}}>
          Are you sure you want to open door #{givenDoorNumber}?
        </div>
      </Modal>

      {/* Door Open Failed Modal */}
      <Modal
        title={<span style={{...getTextStyle({fontSize: '28px', fontWeight: 'bold', color: '#ef4444'})}}>Door #{modal_doorOpenFailedDoor} did not open</span>}
        open={modal_doorOpenFailed}
        onCancel={() => setModal_doorOpenFailed(false)}
        zIndex={2000}
        footer={[
          <Button
            key="ok"
            type="primary"
            size="large"
            danger
            onClick={() => setModal_doorOpenFailed(false)}
            style={{...getTextStyle({fontSize: '24px', padding: '15px 40px', height: 'auto'})}}
          >
            OK
          </Button>
        ]}
        width={600}
        centered
      >
        <div style={{...getTextStyle({fontSize: '22px', padding: '20px', textAlign: 'center'})}}>
          Door #{modal_doorOpenFailedDoor} failed to open. Please check the hardware.
        </div>
      </Modal>

      {/* Open All Doors Modal */}
      <Modal
        title={<span style={{...getTextStyle({fontSize: '28px', fontWeight: 'bold'})}}>Open All Doors</span>}
        open={modal_openAllDoors}
        onCancel={() => !openingDoorsProgress && processModalResult(true)}
        closable={!openingDoorsProgress}
        maskClosable={!openingDoorsProgress}
        footer={openingDoorsProgress ? null : [
          <Button
            key="cancel"
            size="large"
            onClick={() => processModalResult(true)}
            style={{...getTextStyle({fontSize: '24px', padding: '15px 40px', height: 'auto'})}}
          >
            Cancel
          </Button>,
          <Button
            key="confirm"
            type="primary"
            size="large"
            onClick={() => processModalResult()}
            style={{
              ...getTextStyle({fontSize: '24px', padding: '15px 40px', height: 'auto'}),
              backgroundColor: '#ea580c',
              borderColor: '#ea580c'
            }}
          >
            Open {getDoorCount()} Door(s)
          </Button>
        ]}
        width={800}
        centered
      >
        {openingDoorsProgress ? (
          <div style={{...getTextStyle({fontSize: '22px', padding: '40px', textAlign: 'center'})}}>
            <Spin size="large" />
            <div style={{ marginTop: '20px' }}>
              {openingDoorsProgress.current === 0 ? 'Preparing to open doors...' : `Opening door ${openingDoorsProgress.current} of ${openingDoorsProgress.total}...`}
            </div>
          </div>
        ) : (
          <div style={{...getTextStyle({fontSize: '22px', padding: '20px', textAlign: 'center'})}}>
            Are you sure you want to open all {getDoorCount()} door(s)?
          </div>
        )}
      </Modal>

      <Modal
        title={<span style={getTextStyle({height: 'auto', padding: 'auto', margin: 'auto', color: SEBlue.value}, 2)}>
          Manifest for {isLoT ? 'Library of Things' : isHoldPickup ? 'Holds Pickup' : isDynamicLoT ? 'Dynamic LoT' : 'Undefined Mode'}
          </span>}
        open={modal_showManifest}
        onOk={() => setModal_showManifest(false)}
        onCancel={() => setModal_showManifest(false)}
        footer={<div style={getTextStyle({height: 'auto', padding: 'auto', margin: 'auto'})}>
          <Button type="default" style={{height: 'auto', padding: 'auto', margin: 'auto'}} onClick={() => setModal_showManifest(false)}>{<span style={getTextStyle({height: 'auto', padding: 'auto', margin: 'auto'})}>{t('EXIT')}</span>}</Button>
        </div>}
        style={{ top: 20 }}
        width={'100%'}
      >
        {(() => {
          const lockersWithItems: any[] = [];

          if (sessionDevice.value?.manifest?.groups) {
            const groups = Array.isArray(sessionDevice.value.manifest.groups)
              ? sessionDevice.value.manifest.groups
              : Object.values(sessionDevice.value.manifest.groups);

            for (const group of groups) {
              const groupData = group as any;
              if (!groupData?.lockers) continue;

              const lockers = Array.isArray(groupData.lockers)
                ? groupData.lockers
                : Object.values(groupData.lockers);

              for (const locker of lockers) {
                if (!locker) continue;
                const lockerData = locker as any;
                const doorNumber = lockerData.doorNumber || lockerData.door;

                const hasItems = lockerData.itemId ||
                  (lockerData.itemIds && Array.isArray(lockerData.itemIds) && lockerData.itemIds.length > 0);

                if (doorNumber && hasItems) {
                  lockersWithItems.push({
                    key: doorNumber,
                    doorNumber,
                    items: lockerData.itemId || (lockerData.itemIds ? lockerData.itemIds.join(', ') : 'N/A'),
                    patron: lockerData.patronId || 'N/A',
                    expires: lockerData.holdExpirationDate ? new Date(lockerData.holdExpirationDate).toDateString() : 'N/A'
                  });
                }
              }
            }
          }

          lockersWithItems.sort((a, b) => a.doorNumber - b.doorNumber);

          if (lockersWithItems.length === 0) {
            return (
              <div style={{...getTextStyle({color: SEBlue.value}), textAlign: 'center', padding: '20px'}}>
                No items in any lockers
              </div>
            );
          }

          const columns = [
            { title: 'Door', dataIndex: 'doorNumber', key: 'doorNumber', width: 80 },
            { title: 'Items', dataIndex: 'items', key: 'items' },
            { title: 'Patron', dataIndex: 'patron', key: 'patron', width: 150 },
            { title: 'Expires', dataIndex: 'expires', key: 'expires', width: 150 }
          ];

          return (
            <table style={{ width: '100%', borderCollapse: 'collapse', ...getTextStyle({color: SEBlue.value}) }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #ccc', textAlign: 'left' }}>
                  <th style={{ padding: '10px', width: '80px' }}>Door</th>
                  <th style={{ padding: '10px' }}>Items</th>
                  <th style={{ padding: '10px', width: '150px' }}>Patron</th>
                  <th style={{ padding: '10px', width: '150px' }}>Expires</th>
                </tr>
              </thead>
              <tbody>
                {lockersWithItems.map((row) => (
                  <tr key={row.doorNumber} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '10px' }}>{row.doorNumber}</td>
                    <td style={{ padding: '10px' }}>{row.items}</td>
                    <td style={{ padding: '10px' }}>{row.patron}</td>
                    <td style={{ padding: '10px' }}>{row.expires}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        })()}
      </Modal>

      {/* Pull List Modal */}
      <Modal
        title={<span style={{...getTextStyle({color: SEBlue.value}), fontSize: '24px', fontWeight: 'bold'}}>
          Pull List - Polaris Holds
          </span>}
        open={modal_showPullList}
        onOk={() => setModal_showPullList(false)}
        onCancel={() => setModal_showPullList(false)}
        footer={<div style={{ textAlign: 'center' }}>
          <Button danger type="primary" size="large" style={{ fontSize: '28px', height: '60px', padding: '0 50px' }} onClick={() => setModal_showPullList(false)}>
            <span style={getTextStyle({ fontSize: '28px' })}>{t('EXIT')}</span>
          </Button>
        </div>}
        style={{ top: 20, paddingBottom: 0 }}
        width={'100%'}
        styles={{ body: { height: 'calc(100vh - 180px)', overflow: 'auto' } }}
      >
        <PullListContent />
      </Modal>

      {/* CMD Commands Modal */}
      <Modal
        title={<span style={{...getTextStyle({color: SEBlue.value}), fontSize: '24px', fontWeight: 'bold'}}>
          CMD Commands
          </span>}
        open={modal_showCmdCommands}
        onOk={() => setModal_showCmdCommands(false)}
        onCancel={() => setModal_showCmdCommands(false)}
        footer={<div style={{ textAlign: 'center' }}>
          <Button danger type="primary" size="large" style={{ fontSize: '28px', height: '60px', padding: '0 50px' }} onClick={() => setModal_showCmdCommands(false)}>
            <span style={getTextStyle({ fontSize: '28px' })}>{t('EXIT')}</span>
          </Button>
        </div>}
        style={{ top: 20 }}
        width={600}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px' }}>
          <Button
            type="default"
            size="large"
            style={{ height: '80px', fontSize: '24px' }}
            onClick={async () => {
              try {
                customToast(() => 'Running test command...', 2000, 'default', 'dark');
                const electron = (window as any).electron;
                console.log('Running command: cd \\SideEvents\\ && dir');
                const result = await electron.sideeventNative.runCommand('cd \\SideEvents\\ && dir');
                console.log('Command result:', result);
                const outputText = result ? String(result) : 'No output returned';
                setCmdResultText(outputText);
                setModal_showCmdCommands(false);
                setModal_showCmdResult(true);
              } catch (error: any) {
                console.error('Failed to run test command:', error);
                const errorText = error?.message || String(error) || 'Unknown error';
                setCmdResultText('ERROR: ' + errorText);
                setModal_showCmdCommands(false);
                setModal_showCmdResult(true);
              }
            }}
          >
            <span style={getTextStyle({ color: '#42A4DE' })}>Test: dir SideEvents</span>
          </Button>

          <Button
            type="primary"
            size="large"
            style={{ height: '80px', fontSize: '24px' }}
            onClick={async () => {
              try {
                customToast(() => 'Restarting Modbus service...', 2000, 'default', 'dark');
                const electron = (window as any).electron;
                await electron.sideeventNative.runCommand('pm2 restart modbus');
                customToast(() => 'Modbus service restarted', 3000, 'default', 'dark');
              } catch (error) {
                console.error('Failed to restart modbus:', error);
                customToast(() => 'Failed to restart Modbus', 3000, 'error', 'dark');
              }
            }}
          >
            <span style={getTextStyle({ color: 'white' })}>PM2 Restart Modbus</span>
          </Button>

          <Button
            type="primary"
            size="large"
            style={{ height: '80px', fontSize: '24px' }}
            onClick={async () => {
              try {
                customToast(() => 'Restarting all services...', 2000, 'default', 'dark');
                const electron = (window as any).electron;
                await electron.sideeventNative.runCommand('pm2 restart all');
                customToast(() => 'All services restarted', 3000, 'default', 'dark');
              } catch (error) {
                console.error('Failed to restart all services:', error);
                customToast(() => 'Failed to restart all services', 3000, 'error', 'dark');
              }
            }}
          >
            <span style={getTextStyle({ color: 'white' })}>Restart All SW (pm2)</span>
          </Button>

          <Button
            type="primary"
            danger
            size="large"
            style={{ height: '80px', fontSize: '24px' }}
            onClick={async () => {
              Modal.confirm({
                title: 'Restart PC?',
                content: 'Are you sure you want to restart this computer?',
                okText: 'Restart',
                okType: 'danger',
                cancelText: 'Cancel',
                onOk: async () => {
                  try {
                    customToast(() => 'Restarting PC...', 2000, 'default', 'dark');
                    const electron = (window as any).electron;
                    await electron.sideeventNative.runCommand('shutdown /r /t 5');
                  } catch (error) {
                    console.error('Failed to restart PC:', error);
                    customToast(() => 'Failed to restart PC', 3000, 'error', 'dark');
                  }
                }
              });
            }}
          >
            <span style={getTextStyle({ color: 'white' })}>Restart PC</span>
          </Button>

          {/* Custom Command Section */}
          <div style={{ marginTop: '20px', borderTop: '1px solid #ccc', paddingTop: '20px' }}>
            <div style={{ marginBottom: '10px', ...getTextStyle({ color: SEBlue.value }) }}>Custom Command:</div>
            <textarea
              value={customCmdText}
              onChange={(e) => setCustomCmdText(e.target.value)}
              placeholder="Enter command here..."
              style={{
                width: '100%',
                height: '80px',
                padding: '10px',
                fontSize: '16px',
                fontFamily: 'monospace',
                borderRadius: '5px',
                border: '1px solid #ccc',
                resize: 'vertical'
              }}
            />
            <Button
              type="primary"
              size="large"
              style={{ height: '60px', fontSize: '20px', marginTop: '10px', width: '100%' }}
              disabled={!customCmdText.trim()}
              onClick={async () => {
                if (!customCmdText.trim()) return;
                try {
                  customToast(() => 'Running custom command...', 2000, 'default', 'dark');
                  const electron = (window as any).electron;
                  console.log('Running custom command:', customCmdText);
                  const result = await electron.sideeventNative.runCommand(customCmdText);
                  console.log('Command result:', result);
                  const outputText = result ? String(result) : 'No output returned';
                  setCmdResultText(outputText);
                  setModal_showCmdCommands(false);
                  setModal_showCmdResult(true);
                } catch (error: any) {
                  console.error('Failed to run custom command:', error);
                  const errorText = error?.message || String(error) || 'Unknown error';
                  setCmdResultText('ERROR: ' + errorText);
                  setModal_showCmdCommands(false);
                  setModal_showCmdResult(true);
                }
              }}
            >
              <span style={getTextStyle({ color: 'white' })}>Send Command</span>
            </Button>
          </div>
        </div>
      </Modal>

      {/* CMD Result Modal */}
      <Modal
        title={<span style={{...getTextStyle({color: SEBlue.value}), fontSize: '24px', fontWeight: 'bold'}}>
          Command Result
          </span>}
        open={modal_showCmdResult}
        onOk={() => setModal_showCmdResult(false)}
        onCancel={() => setModal_showCmdResult(false)}
        footer={<div style={{ textAlign: 'center' }}>
          <Button type="primary" size="large" style={{ fontSize: '28px', height: '60px', padding: '0 50px' }} onClick={() => setModal_showCmdResult(false)}>
            <span style={getTextStyle({ fontSize: '28px' })}>OK</span>
          </Button>
        </div>}
        style={{ top: 20 }}
        width={700}
      >
        <pre style={{
          whiteSpace: 'pre-wrap',
          maxHeight: '500px',
          overflow: 'auto',
          backgroundColor: '#f5f5f5',
          padding: '15px',
          borderRadius: '5px',
          fontSize: '14px',
          fontFamily: 'monospace'
        }}>
          {cmdResultText}
        </pre>
      </Modal>

      {/* Workflow Wizard Modal */}
      <Modal
        title={
          <span style={{...getTextStyle({color: SEBlue.value}), fontSize: '28px', fontWeight: 'bold'}}>
            {workflowWizardType === 'sip2' ? 'SIP2 (Add Hold, scan item)' : workflowWizardType === 'sip2lot' ? 'SIP2 (LoT, scan item)' : workflowWizardType === 'polaris' ? 'Polaris (Add Hold, scan item)' : workflowWizardType === 'polarislot' ? 'Polaris (LoT, scan item)' : workflowWizardType === 'symphony' ? 'Symphony (Add Hold, scan item)' : workflowWizardType === 'symphonylot' ? 'Symphony (LoT, scan item)' : 'Symphony'} Workflow
          </span>
        }
        open={workflowWizardOpen}
        onCancel={() => {
          if (!workflowWizardRunning) {
            setWorkflowWizardOpen(false);
          }
        }}
        footer={null}
        width={700}
        style={{ top: 50 }}
        maskClosable={!workflowWizardRunning}
        closable={!workflowWizardRunning}
      >
        <div style={{ padding: '20px' }}>
          {/* Step indicators */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '30px' }}>
            {(workflowWizardType === 'polaris' ? [
              { num: 1, title: 'HoldPull Check', desc: 'Check Hold Pull List' },
              { num: 2, title: 'Verify', desc: 'Check-in & Confirm' }
            ] : workflowWizardType === 'symphony' ? [
              { num: 1, title: 'HoldPull Check', desc: 'Check Hold Pull List' },
              { num: 2, title: 'Verify', desc: 'Check-in & Confirm' }
            ] : workflowWizardType === 'sip2lot' ? [
              { num: 1, title: 'ItemInfo', desc: 'Hold Queue & Circ Status' },
              { num: 2, title: workflowWizardIsReturn ? 'Return' : 'Add Item', desc: workflowWizardIsReturn ? 'Check-in Item' : 'Add to Locker' },
              { num: 3, title: 'Verify', desc: 'Confirm Success' }
            ] : workflowWizardType === 'polarislot' ? [
              { num: 1, title: 'HoldPull Check', desc: 'Hold & Circ Status' },
              { num: 2, title: workflowWizardIsReturn ? 'Return' : 'Add Item', desc: workflowWizardIsReturn ? 'Return Item' : 'Add to Locker' },
              { num: 3, title: 'Verify', desc: 'Confirm Success' }
            ] : workflowWizardType === 'symphonylot' ? [
              { num: 1, title: 'HoldPull Check', desc: 'Hold & Circ Status' },
              { num: 2, title: workflowWizardIsReturn ? 'Return' : 'Add Item', desc: workflowWizardIsReturn ? 'Return Item' : 'Add to Locker' },
              { num: 3, title: 'Verify', desc: 'Confirm Success' }
            ] : [
              { num: 1, title: 'ItemInfo', desc: 'Hold Queue & Circ Status' },
              { num: 2, title: 'Check-in', desc: 'Collect Patron ID' },
              { num: 3, title: 'Verify', desc: 'Confirm Success' }
            ]).map((step, idx) => {
              // Determine if this is the current step (first pending step)
              const isCurrentStep = workflowWizardStepStatus[idx] === 'pending' &&
                (idx === 0 || workflowWizardStepStatus[idx - 1] === 'done');

              return (
                <div key={idx} style={{
                  flex: 1,
                  textAlign: 'center',
                  padding: '15px',
                  margin: '0 5px',
                  borderRadius: '8px',
                  backgroundColor:
                    workflowWizardStepStatus[idx] === 'done' ? '#52c41a' :
                    workflowWizardStepStatus[idx] === 'running' ? SEBlue.value :
                    workflowWizardStepStatus[idx] === 'error' ? '#ff4d4f' :
                    isCurrentStep ? SEBlue.value :
                    '#f0f0f0',
                  color: (workflowWizardStepStatus[idx] !== 'pending' || isCurrentStep) ? 'white' : '#666',
                  transition: 'all 0.3s ease',
                  boxShadow: isCurrentStep ? '0 4px 12px rgba(0,0,0,0.15)' : 'none'
                }}>
                  <div style={{ fontSize: '32px', fontWeight: 'bold', marginBottom: '5px' }}>
                    {workflowWizardStepStatus[idx] === 'done' ? '✓' :
                     workflowWizardStepStatus[idx] === 'error' ? '✗' :
                     step.num}
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{step.title}</div>
                  <div style={{ fontSize: '12px', opacity: 0.8 }}>{step.desc}</div>
                </div>
              );
            })}
          </div>

          {/* Current step details */}
          <div style={{
            backgroundColor: '#f9f9f9',
            padding: '20px',
            borderRadius: '8px',
            marginBottom: '20px',
            minHeight: '100px'
          }}>
            {workflowWizardStep === 0 && !workflowWizardRunning && workflowWizardType === 'sip2' && (
              <div style={{ textAlign: 'center', color: '#666' }}>
                <p style={{ fontSize: '18px', marginBottom: '15px' }}>Enter Item ID to start the SIP2 (Add Hold, scan item) workflow</p>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', alignItems: 'center' }}>
                  <Input
                    placeholder="Enter Item ID (barcode)"
                    value={workflowWizardItemId}
                    onChange={(e) => {
                      setWorkflowWizardItemId(e.target.value);
                      // Reset result if item changes
                      if (workflowWizardItemInfoSent) {
                        setWorkflowWizardItemInfoSent(false);
                        setWorkflowWizardHasHold(null);
                        setWorkflowWizardCircStatus(null);
                      }
                    }}
                    style={{ fontSize: '18px', padding: '10px', width: '100%', maxWidth: '350px' }}
                    onPressEnter={() => {
                      if (workflowWizardItemId.trim()) {
                        const hasHold = Math.random() > 0.5;
                        const circStatuses = [1, 4, 8, 10];
                        const circStatus = circStatuses[Math.floor(Math.random() * circStatuses.length)];
                        setWorkflowWizardItemInfoSent(true);
                        setWorkflowWizardHasHold(hasHold);
                        setWorkflowWizardCircStatus(circStatus);
                        customToast(() => (<b>ItemInfo SIP2 message sent for: {workflowWizardItemId}</b>), 2000, 'default', 'dark');
                      }
                    }}
                  />
                  <Button
                    type="primary"
                    size="large"
                    disabled={!workflowWizardItemId.trim()}
                    style={{ height: '50px', fontSize: '16px' }}
                    onClick={() => {
                      if (workflowWizardItemId.trim()) {
                        const hasHold = Math.random() > 0.5;
                        const circStatuses = [1, 4, 8, 10];
                        const circStatus = circStatuses[Math.floor(Math.random() * circStatuses.length)];
                        setWorkflowWizardItemInfoSent(true);
                        setWorkflowWizardHasHold(hasHold);
                        setWorkflowWizardCircStatus(circStatus);
                        customToast(() => (<b>ItemInfo SIP2 message sent for: {workflowWizardItemId}</b>), 2000, 'default', 'dark');
                      }
                    }}
                  >
                    Send
                  </Button>
                </div>
                {/* Show result after send */}
                {workflowWizardItemInfoSent && workflowWizardHasHold !== null && (
                  <div style={{
                    marginTop: '20px',
                    padding: '15px',
                    backgroundColor: '#f9f9f9',
                    border: '1px solid #d9d9d9',
                    borderRadius: '8px',
                    display: 'inline-block',
                    minWidth: '300px'
                  }}>
                    <p style={{ fontSize: '16px', margin: '0 0 10px 0', color: workflowWizardHasHold ? '#52c41a' : '#ff4d4f' }}>
                      <b>Has Hold:</b> {workflowWizardHasHold ? 'Yes ✓' : 'No ✗'}
                    </p>
                    <p style={{ fontSize: '16px', margin: 0, color: getCircStatusColor(workflowWizardCircStatus) }}>
                      <b>Circulation Status ({workflowWizardCircStatus}):</b> {getCircStatusText(workflowWizardCircStatus)}
                    </p>
                  </div>
                )}
                <p style={{ fontSize: '14px', marginTop: '15px' }}>
                  {!workflowWizardItemId.trim()
                    ? 'Item ID is required'
                    : !workflowWizardItemInfoSent
                      ? 'Click "Send" to query item info'
                      : workflowWizardHasHold
                        ? 'Item has hold - click "Next" to proceed with Check-in'
                        : 'Item has no hold - you may still proceed or try another item'}
                </p>
              </div>
            )}
            {/* Polaris View 1: HoldPull Check input */}
            {workflowWizardStep === 0 && !workflowWizardRunning && workflowWizardType === 'polaris' && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '18px', marginBottom: '15px' }}>Enter Item ID to check Hold Pull List</p>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginBottom: '10px' }}>
                  <Input
                    size="large"
                    placeholder="Enter Item ID"
                    value={workflowWizardItemId}
                    style={{ width: '300px', fontSize: '18px', height: '50px' }}
                    onChange={(e) => {
                      setWorkflowWizardItemId(e.target.value);
                      // Reset result if item changes
                      if (workflowWizardItemInfoSent) {
                        setWorkflowWizardItemInfoSent(false);
                        setWorkflowWizardItemFound(null);
                        setWorkflowWizardPatronId(null);
                        setWorkflowWizardHoldExpiration(null);
                      }
                    }}
                    onPressEnter={() => {
                      if (workflowWizardItemId.trim()) {
                        // Simulate HoldPull check - random found/not found
                        const itemFound = Math.random() > 0.3; // 70% chance found
                        const randomDigits = Math.floor(10000 + Math.random() * 90000);
                        const patronId = itemFound ? `2${randomDigits}` : null;
                        // Generate random expiration date (1-14 days from now)
                        const expDate = new Date();
                        expDate.setDate(expDate.getDate() + Math.floor(1 + Math.random() * 14));
                        const expDateStr = itemFound ? expDate.toLocaleDateString() : null;

                        setWorkflowWizardItemInfoSent(true);
                        setWorkflowWizardItemFound(itemFound);
                        setWorkflowWizardPatronId(patronId);
                        setWorkflowWizardHoldExpiration(expDateStr);
                        customToast(() => (<b>HoldPull check sent for: {workflowWizardItemId}</b>), 2000, 'default', 'dark');
                      }
                    }}
                  />
                  <Button
                    type="primary"
                    size="large"
                    disabled={!workflowWizardItemId.trim()}
                    style={{ height: '50px', fontSize: '16px' }}
                    onClick={() => {
                      if (workflowWizardItemId.trim()) {
                        // Simulate HoldPull check - random found/not found
                        const itemFound = Math.random() > 0.3; // 70% chance found
                        const randomDigits = Math.floor(10000 + Math.random() * 90000);
                        const patronId = itemFound ? `2${randomDigits}` : null;
                        // Generate random expiration date (1-14 days from now)
                        const expDate = new Date();
                        expDate.setDate(expDate.getDate() + Math.floor(1 + Math.random() * 14));
                        const expDateStr = itemFound ? expDate.toLocaleDateString() : null;

                        setWorkflowWizardItemInfoSent(true);
                        setWorkflowWizardItemFound(itemFound);
                        setWorkflowWizardPatronId(patronId);
                        setWorkflowWizardHoldExpiration(expDateStr);
                        customToast(() => (<b>HoldPull check sent for: {workflowWizardItemId}</b>), 2000, 'default', 'dark');
                      }
                    }}
                  >
                    Send
                  </Button>
                </div>
                {/* Show result after send */}
                {workflowWizardItemInfoSent && workflowWizardItemFound !== null && (
                  <div style={{
                    marginTop: '20px',
                    padding: '15px',
                    backgroundColor: '#f9f9f9',
                    border: '1px solid #d9d9d9',
                    borderRadius: '8px',
                    display: 'inline-block',
                    minWidth: '300px'
                  }}>
                    <p style={{ fontSize: '16px', margin: '0 0 10px 0', color: workflowWizardItemFound ? '#52c41a' : '#ff4d4f' }}>
                      <b>Status:</b> {workflowWizardItemFound ? 'Item Found in Hold Pull List ✓' : 'Item NOT Found ✗'}
                    </p>
                    {workflowWizardItemFound && workflowWizardPatronId && (
                      <>
                        <p style={{ fontSize: '16px', margin: '0 0 10px 0', color: '#1890ff' }}>
                          <b>Patron ID:</b> {workflowWizardPatronId}
                        </p>
                        <p style={{ fontSize: '16px', margin: 0, color: '#666' }}>
                          <b>Hold Expiration:</b> {workflowWizardHoldExpiration}
                        </p>
                      </>
                    )}
                  </div>
                )}
                <p style={{ fontSize: '14px', marginTop: '15px' }}>
                  {!workflowWizardItemId.trim()
                    ? 'Item ID is required'
                    : !workflowWizardItemInfoSent
                      ? 'Click "Send" to check Hold Pull List'
                      : workflowWizardItemFound
                        ? 'Item found - click "Next" to proceed with Check-in'
                        : 'Item not found - try another item'}
                </p>
              </div>
            )}
            {/* Symphony (Add Hold) View: HoldPull Check input */}
            {workflowWizardStep === 0 && !workflowWizardRunning && workflowWizardType === 'symphony' && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '18px', marginBottom: '15px' }}>Enter Item ID to check Hold Pull List</p>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', marginBottom: '10px' }}>
                  <Input
                    size="large"
                    placeholder="Enter Item ID"
                    value={workflowWizardItemId}
                    style={{ width: '300px', fontSize: '18px', height: '50px' }}
                    onChange={(e) => {
                      setWorkflowWizardItemId(e.target.value);
                      // Reset result if item changes
                      if (workflowWizardItemInfoSent) {
                        setWorkflowWizardItemInfoSent(false);
                        setWorkflowWizardItemFound(null);
                        setWorkflowWizardPatronId(null);
                        setWorkflowWizardHoldExpiration(null);
                      }
                    }}
                    onPressEnter={() => {
                      if (workflowWizardItemId.trim()) {
                        // Simulate HoldPull check - random found/not found
                        const itemFound = Math.random() > 0.3; // 70% chance found
                        const randomDigits = Math.floor(10000 + Math.random() * 90000);
                        const patronId = itemFound ? `2${randomDigits}` : null;
                        // Generate random expiration date (1-14 days from now)
                        const expDate = new Date();
                        expDate.setDate(expDate.getDate() + Math.floor(1 + Math.random() * 14));
                        const expDateStr = itemFound ? expDate.toLocaleDateString() : null;

                        setWorkflowWizardItemInfoSent(true);
                        setWorkflowWizardItemFound(itemFound);
                        setWorkflowWizardPatronId(patronId);
                        setWorkflowWizardHoldExpiration(expDateStr);
                        customToast(() => (<b>HoldPull check sent for: {workflowWizardItemId}</b>), 2000, 'default', 'dark');
                      }
                    }}
                  />
                  <Button
                    type="primary"
                    size="large"
                    disabled={!workflowWizardItemId.trim()}
                    style={{ height: '50px', fontSize: '16px' }}
                    onClick={() => {
                      if (workflowWizardItemId.trim()) {
                        // Simulate HoldPull check - random found/not found
                        const itemFound = Math.random() > 0.3; // 70% chance found
                        const randomDigits = Math.floor(10000 + Math.random() * 90000);
                        const patronId = itemFound ? `2${randomDigits}` : null;
                        // Generate random expiration date (1-14 days from now)
                        const expDate = new Date();
                        expDate.setDate(expDate.getDate() + Math.floor(1 + Math.random() * 14));
                        const expDateStr = itemFound ? expDate.toLocaleDateString() : null;

                        setWorkflowWizardItemInfoSent(true);
                        setWorkflowWizardItemFound(itemFound);
                        setWorkflowWizardPatronId(patronId);
                        setWorkflowWizardHoldExpiration(expDateStr);
                        customToast(() => (<b>HoldPull check sent for: {workflowWizardItemId}</b>), 2000, 'default', 'dark');
                      }
                    }}
                  >
                    Send
                  </Button>
                </div>
                {/* Show result after send */}
                {workflowWizardItemInfoSent && workflowWizardItemFound !== null && (
                  <div style={{
                    marginTop: '20px',
                    padding: '15px',
                    backgroundColor: '#f9f9f9',
                    border: '1px solid #d9d9d9',
                    borderRadius: '8px',
                    display: 'inline-block',
                    minWidth: '300px'
                  }}>
                    <p style={{ fontSize: '16px', margin: '0 0 10px 0', color: workflowWizardItemFound ? '#52c41a' : '#ff4d4f' }}>
                      <b>Status:</b> {workflowWizardItemFound ? 'Item Found in Hold Pull List ✓' : 'Item NOT Found ✗'}
                    </p>
                    {workflowWizardItemFound && workflowWizardPatronId && (
                      <>
                        <p style={{ fontSize: '16px', margin: '0 0 10px 0', color: '#1890ff' }}>
                          <b>Patron ID:</b> {workflowWizardPatronId}
                        </p>
                        <p style={{ fontSize: '16px', margin: 0, color: '#666' }}>
                          <b>Hold Expiration:</b> {workflowWizardHoldExpiration}
                        </p>
                      </>
                    )}
                  </div>
                )}
                <p style={{ fontSize: '14px', marginTop: '15px' }}>
                  {!workflowWizardItemId.trim()
                    ? 'Item ID is required'
                    : !workflowWizardItemInfoSent
                      ? 'Click "Send" to check Hold Pull List'
                      : workflowWizardItemFound
                        ? 'Item found - click "Next" to proceed with Check-in'
                        : 'Item not found - try another item'}
                </p>
              </div>
            )}
            {/* SIP2 LoT View: ItemInfo input */}
            {workflowWizardStep === 0 && !workflowWizardRunning && workflowWizardType === 'sip2lot' && (
              <div style={{ textAlign: 'center', color: '#666' }}>
                <p style={{ fontSize: '18px', marginBottom: '15px' }}>Enter Item ID to start the SIP2 (LoT) workflow</p>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', alignItems: 'center' }}>
                  <Input
                    placeholder="Enter Item ID (barcode)"
                    value={workflowWizardItemId}
                    onChange={(e) => {
                      setWorkflowWizardItemId(e.target.value);
                      // Reset result if item changes
                      if (workflowWizardItemInfoSent) {
                        setWorkflowWizardItemInfoSent(false);
                        setWorkflowWizardHasHold(null);
                        setWorkflowWizardCircStatus(null);
                        setWorkflowWizardIsReturn(false);
                      }
                    }}
                    style={{ fontSize: '18px', padding: '10px', width: '100%', maxWidth: '350px' }}
                    onPressEnter={() => {
                      if (workflowWizardItemId.trim()) {
                        const hasHold = Math.random() > 0.5;
                        const circStatuses = [1, 4, 8, 10];
                        const circStatus = circStatuses[Math.floor(Math.random() * circStatuses.length)];
                        setWorkflowWizardItemInfoSent(true);
                        setWorkflowWizardHasHold(hasHold);
                        setWorkflowWizardCircStatus(circStatus);
                        setWorkflowWizardIsReturn(circStatus === 4); // Return if checked out
                        customToast(() => (<b>ItemInfo SIP2 message sent for: {workflowWizardItemId}</b>), 2000, 'default', 'dark');
                      }
                    }}
                  />
                  <Button
                    type="primary"
                    size="large"
                    disabled={!workflowWizardItemId.trim()}
                    style={{ height: '50px', fontSize: '16px' }}
                    onClick={() => {
                      if (workflowWizardItemId.trim()) {
                        const hasHold = Math.random() > 0.5;
                        const circStatuses = [1, 4, 8, 10];
                        const circStatus = circStatuses[Math.floor(Math.random() * circStatuses.length)];
                        setWorkflowWizardItemInfoSent(true);
                        setWorkflowWizardHasHold(hasHold);
                        setWorkflowWizardCircStatus(circStatus);
                        setWorkflowWizardIsReturn(circStatus === 4); // Return if checked out
                        customToast(() => (<b>ItemInfo SIP2 message sent for: {workflowWizardItemId}</b>), 2000, 'default', 'dark');
                      }
                    }}
                  >
                    Send
                  </Button>
                </div>
                {/* Show result after send */}
                {workflowWizardItemInfoSent && workflowWizardHasHold !== null && (
                  <div style={{
                    marginTop: '20px',
                    padding: '15px',
                    backgroundColor: '#f9f9f9',
                    border: '1px solid #d9d9d9',
                    borderRadius: '8px',
                    display: 'inline-block',
                    minWidth: '300px'
                  }}>
                    <p style={{ fontSize: '16px', margin: '0 0 10px 0', color: workflowWizardHasHold ? '#52c41a' : '#ff4d4f' }}>
                      <b>Has Hold:</b> {workflowWizardHasHold ? 'Yes' : 'No'}
                    </p>
                    <p style={{ fontSize: '16px', margin: 0, color: getCircStatusColor(workflowWizardCircStatus) }}>
                      <b>Circulation Status ({workflowWizardCircStatus}):</b> {getCircStatusText(workflowWizardCircStatus)}
                    </p>
                    {workflowWizardCircStatus === 4 && (
                      <p style={{ fontSize: '14px', margin: '10px 0 0 0', color: '#fa8c16', fontWeight: 'bold' }}>
                        Item is checked out - will process as Return
                      </p>
                    )}
                    {workflowWizardCircStatus !== 4 && (
                      <p style={{ fontSize: '14px', margin: '10px 0 0 0', color: '#1890ff', fontWeight: 'bold' }}>
                        Item will be added to locker
                      </p>
                    )}
                  </div>
                )}
                <p style={{ fontSize: '14px', marginTop: '15px' }}>
                  {!workflowWizardItemId.trim()
                    ? 'Item ID is required'
                    : !workflowWizardItemInfoSent
                      ? 'Click "Send" to query item info'
                      : workflowWizardCircStatus === 4
                        ? 'Item is checked out - click "Next: Return" to check-in'
                        : 'Click "Next: Add Item" to add to locker'}
                </p>
              </div>
            )}
            {/* Polaris LoT View: HoldPull Check input */}
            {workflowWizardStep === 0 && !workflowWizardRunning && workflowWizardType === 'polarislot' && (
              <div style={{ textAlign: 'center', color: '#666' }}>
                <p style={{ fontSize: '18px', marginBottom: '15px' }}>Enter Item ID to check Hold Pull List</p>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', alignItems: 'center' }}>
                  <Input
                    placeholder="Enter Item ID (barcode)"
                    value={workflowWizardItemId}
                    onChange={(e) => {
                      setWorkflowWizardItemId(e.target.value);
                      // Reset result if item changes
                      if (workflowWizardItemInfoSent) {
                        setWorkflowWizardItemInfoSent(false);
                        setWorkflowWizardHasHold(null);
                        setWorkflowWizardCircStatus(null);
                        setWorkflowWizardPatronId(null);
                        setWorkflowWizardIsReturn(false);
                      }
                    }}
                    style={{ fontSize: '18px', padding: '10px', width: '100%', maxWidth: '350px' }}
                    onPressEnter={() => {
                      if (workflowWizardItemId.trim()) {
                        // Check hold pull list - found if itemId is 31730036921331
                        const itemFound = workflowWizardItemId.trim() === '31730036921331';
                        const randomDigits = Math.floor(10000 + Math.random() * 90000);
                        const patronId = itemFound ? `2${randomDigits}` : null;
                        // Random circ status same as SIP2 LoT
                        const circStatuses = [1, 4, 8, 10];
                        const circStatus = circStatuses[Math.floor(Math.random() * circStatuses.length)];
                        setWorkflowWizardItemInfoSent(true);
                        setWorkflowWizardHasHold(itemFound);
                        setWorkflowWizardPatronId(patronId);
                        setWorkflowWizardCircStatus(circStatus);
                        // For Polaris LoT: Return if circ IS 4, Add if circ NOT 4
                        setWorkflowWizardIsReturn(circStatus === 4);
                        customToast(() => (<b>HoldPull check sent for: {workflowWizardItemId}</b>), 2000, 'default', 'dark');
                      }
                    }}
                  />
                  <Button
                    type="primary"
                    size="large"
                    disabled={!workflowWizardItemId.trim()}
                    style={{ height: '50px', fontSize: '16px' }}
                    onClick={() => {
                      if (workflowWizardItemId.trim()) {
                        // Check hold pull list - found if itemId is 31730036921331
                        const itemFound = workflowWizardItemId.trim() === '31730036921331';
                        const randomDigits = Math.floor(10000 + Math.random() * 90000);
                        const patronId = itemFound ? `2${randomDigits}` : null;
                        // Random circ status same as SIP2 LoT
                        const circStatuses = [1, 4, 8, 10];
                        const circStatus = circStatuses[Math.floor(Math.random() * circStatuses.length)];
                        setWorkflowWizardItemInfoSent(true);
                        setWorkflowWizardHasHold(itemFound);
                        setWorkflowWizardPatronId(patronId);
                        setWorkflowWizardCircStatus(circStatus);
                        // For Polaris LoT: Return if circ IS 4, Add if circ NOT 4
                        setWorkflowWizardIsReturn(circStatus === 4);
                        customToast(() => (<b>HoldPull check sent for: {workflowWizardItemId}</b>), 2000, 'default', 'dark');
                      }
                    }}
                  >
                    Send
                  </Button>
                </div>
                {/* Show result after send */}
                {workflowWizardItemInfoSent && workflowWizardCircStatus !== null && (
                  <div style={{
                    marginTop: '20px',
                    padding: '15px',
                    backgroundColor: '#f9f9f9',
                    border: '1px solid #d9d9d9',
                    borderRadius: '8px',
                    display: 'inline-block',
                    minWidth: '300px'
                  }}>
                    <p style={{ fontSize: '16px', margin: '0 0 10px 0', color: workflowWizardHasHold ? '#52c41a' : '#fa8c16' }}>
                      <b>Hold Status:</b> {workflowWizardHasHold ? `For Patron ${workflowWizardPatronId}` : 'Anyone'}
                    </p>
                    <p style={{ fontSize: '16px', margin: 0, color: getCircStatusColor(workflowWizardCircStatus) }}>
                      <b>Circulation Status ({workflowWizardCircStatus}):</b> {getCircStatusText(workflowWizardCircStatus)}
                    </p>
                    {workflowWizardCircStatus === 4 && (
                      <p style={{ fontSize: '14px', margin: '10px 0 0 0', color: '#fa8c16', fontWeight: 'bold' }}>
                        Item is checked out - will process as Return
                      </p>
                    )}
                    {workflowWizardCircStatus !== 4 && (
                      <p style={{ fontSize: '14px', margin: '10px 0 0 0', color: '#1890ff', fontWeight: 'bold' }}>
                        Item will be added to locker
                      </p>
                    )}
                  </div>
                )}
                <p style={{ fontSize: '14px', marginTop: '15px' }}>
                  {!workflowWizardItemId.trim()
                    ? 'Item ID is required'
                    : !workflowWizardItemInfoSent
                      ? 'Click "Send" to check Hold Pull List'
                      : workflowWizardCircStatus === 4
                        ? 'Click "Next: Return" to check-in item'
                        : 'Click "Next: Add Item" to add to locker'}
                </p>
              </div>
            )}
            {/* Symphony LoT View: HoldPull Check input */}
            {workflowWizardStep === 0 && !workflowWizardRunning && workflowWizardType === 'symphonylot' && (
              <div style={{ textAlign: 'center', color: '#666' }}>
                <p style={{ fontSize: '18px', marginBottom: '15px' }}>Enter Item ID to check Hold Pull List</p>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', alignItems: 'center' }}>
                  <Input
                    placeholder="Enter Item ID (barcode)"
                    value={workflowWizardItemId}
                    onChange={(e) => {
                      setWorkflowWizardItemId(e.target.value);
                      // Reset result if item changes
                      if (workflowWizardItemInfoSent) {
                        setWorkflowWizardItemInfoSent(false);
                        setWorkflowWizardHasHold(null);
                        setWorkflowWizardCircStatus(null);
                        setWorkflowWizardPatronId(null);
                        setWorkflowWizardIsReturn(false);
                      }
                    }}
                    style={{ fontSize: '18px', padding: '10px', width: '100%', maxWidth: '350px' }}
                    onPressEnter={() => {
                      if (workflowWizardItemId.trim()) {
                        // Check hold pull list - found if itemId is 31730036921331
                        const itemFound = workflowWizardItemId.trim() === '31730036921331';
                        const randomDigits = Math.floor(10000 + Math.random() * 90000);
                        const patronId = itemFound ? `2${randomDigits}` : null;
                        // Random circ status same as Polaris LoT
                        const circStatuses = [1, 4, 8, 10];
                        const circStatus = circStatuses[Math.floor(Math.random() * circStatuses.length)];
                        setWorkflowWizardItemInfoSent(true);
                        setWorkflowWizardHasHold(itemFound);
                        setWorkflowWizardPatronId(patronId);
                        setWorkflowWizardCircStatus(circStatus);
                        // For Symphony LoT: Return if circ IS 4, Add if circ NOT 4
                        setWorkflowWizardIsReturn(circStatus === 4);
                        customToast(() => (<b>HoldPull check sent for: {workflowWizardItemId}</b>), 2000, 'default', 'dark');
                      }
                    }}
                  />
                  <Button
                    type="primary"
                    size="large"
                    disabled={!workflowWizardItemId.trim()}
                    style={{ height: '50px', fontSize: '16px' }}
                    onClick={() => {
                      if (workflowWizardItemId.trim()) {
                        // Check hold pull list - found if itemId is 31730036921331
                        const itemFound = workflowWizardItemId.trim() === '31730036921331';
                        const randomDigits = Math.floor(10000 + Math.random() * 90000);
                        const patronId = itemFound ? `2${randomDigits}` : null;
                        // Random circ status same as Polaris LoT
                        const circStatuses = [1, 4, 8, 10];
                        const circStatus = circStatuses[Math.floor(Math.random() * circStatuses.length)];
                        setWorkflowWizardItemInfoSent(true);
                        setWorkflowWizardHasHold(itemFound);
                        setWorkflowWizardPatronId(patronId);
                        setWorkflowWizardCircStatus(circStatus);
                        // For Symphony LoT: Return if circ IS 4, Add if circ NOT 4
                        setWorkflowWizardIsReturn(circStatus === 4);
                        customToast(() => (<b>HoldPull check sent for: {workflowWizardItemId}</b>), 2000, 'default', 'dark');
                      }
                    }}
                  >
                    Send
                  </Button>
                </div>
                {/* Show result after send */}
                {workflowWizardItemInfoSent && workflowWizardCircStatus !== null && (
                  <div style={{
                    marginTop: '20px',
                    padding: '15px',
                    backgroundColor: '#f9f9f9',
                    border: '1px solid #d9d9d9',
                    borderRadius: '8px',
                    display: 'inline-block',
                    minWidth: '300px'
                  }}>
                    <p style={{ fontSize: '16px', margin: '0 0 10px 0', color: workflowWizardHasHold ? '#52c41a' : '#fa8c16' }}>
                      <b>Hold Status:</b> {workflowWizardHasHold ? `For Patron ${workflowWizardPatronId}` : 'Anyone'}
                    </p>
                    <p style={{ fontSize: '16px', margin: 0, color: getCircStatusColor(workflowWizardCircStatus) }}>
                      <b>Circulation Status ({workflowWizardCircStatus}):</b> {getCircStatusText(workflowWizardCircStatus)}
                    </p>
                    {workflowWizardCircStatus === 4 && (
                      <p style={{ fontSize: '14px', margin: '10px 0 0 0', color: '#fa8c16', fontWeight: 'bold' }}>
                        Item is checked out - will process as Return
                      </p>
                    )}
                    {workflowWizardCircStatus !== 4 && (
                      <p style={{ fontSize: '14px', margin: '10px 0 0 0', color: '#1890ff', fontWeight: 'bold' }}>
                        Item will be added to locker
                      </p>
                    )}
                  </div>
                )}
                <p style={{ fontSize: '14px', marginTop: '15px' }}>
                  {!workflowWizardItemId.trim()
                    ? 'Item ID is required'
                    : !workflowWizardItemInfoSent
                      ? 'Click "Send" to check Hold Pull List'
                      : workflowWizardCircStatus === 4
                        ? 'Click "Next: Return" to check-in item'
                        : 'Click "Next: Add Item" to add to locker'}
                </p>
              </div>
            )}
            {/* SIP2 Step 1 running */}
            {workflowWizardStepStatus[0] === 'running' && workflowWizardType === 'sip2' && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '18px', color: '#1890ff' }}>⏳ Running Step 1: Check-in...</p>
                <p style={{ fontSize: '14px', color: '#666' }}>Collecting Patron ID for item: {workflowWizardItemId}</p>
                {workflowWizardPatronId && (
                  <p style={{ fontSize: '16px', color: '#1890ff', fontWeight: 'bold' }}>Patron ID: {workflowWizardPatronId}</p>
                )}
              </div>
            )}
            {/* Polaris Step 1 running */}
            {workflowWizardStepStatus[0] === 'running' && workflowWizardType === 'polaris' && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '18px', color: '#1890ff' }}>⏳ Running Step 1: Check-in & Verify...</p>
                <p style={{ fontSize: '14px', color: '#666' }}>Processing item: {workflowWizardItemId}</p>
              </div>
            )}
            {/* SIP2 LoT Step 1 running */}
            {workflowWizardStepStatus[0] === 'running' && workflowWizardType === 'sip2lot' && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '18px', color: '#1890ff' }}>
                  ⏳ Running Step 1: {workflowWizardIsReturn ? 'Return (Check-in)' : 'Add Item'}...
                </p>
                <p style={{ fontSize: '14px', color: '#666' }}>
                  {workflowWizardIsReturn ? 'Checking in item' : 'Adding item to locker'}: {workflowWizardItemId}
                </p>
                {workflowWizardIsReturn && workflowWizardPatronId && (
                  <p style={{ fontSize: '16px', color: '#1890ff', fontWeight: 'bold' }}>Patron ID: {workflowWizardPatronId}</p>
                )}
              </div>
            )}
            {/* Polaris LoT Step 1 running */}
            {workflowWizardStepStatus[0] === 'running' && workflowWizardType === 'polarislot' && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '18px', color: '#1890ff' }}>
                  ⏳ Running Step 1: {workflowWizardIsReturn ? 'Return' : 'Add Item'}...
                </p>
                <p style={{ fontSize: '14px', color: '#666' }}>
                  {workflowWizardIsReturn ? 'Returning item' : 'Adding item to locker'}: {workflowWizardItemId}
                </p>
                {workflowWizardIsReturn && workflowWizardPatronId && (
                  <p style={{ fontSize: '16px', color: '#1890ff', fontWeight: 'bold' }}>Patron: {workflowWizardHasHold ? workflowWizardPatronId : 'Anyone'}</p>
                )}
              </div>
            )}
            {/* Symphony Step 1 running */}
            {workflowWizardStepStatus[0] === 'running' && workflowWizardType === 'symphony' && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '18px', color: '#1890ff' }}>⏳ Running Step 1: Check-in & Verify...</p>
                <p style={{ fontSize: '14px', color: '#666' }}>Processing item: {workflowWizardItemId}</p>
              </div>
            )}
            {/* Symphony LoT Step 1 running */}
            {workflowWizardStepStatus[0] === 'running' && workflowWizardType === 'symphonylot' && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '18px', color: '#1890ff' }}>
                  ⏳ Running Step 1: {workflowWizardIsReturn ? 'Return' : 'Add Item'}...
                </p>
                <p style={{ fontSize: '14px', color: '#666' }}>
                  {workflowWizardIsReturn ? 'Returning item' : 'Adding item to locker'}: {workflowWizardItemId}
                </p>
                {workflowWizardIsReturn && workflowWizardPatronId && (
                  <p style={{ fontSize: '16px', color: '#1890ff', fontWeight: 'bold' }}>Patron: {workflowWizardHasHold ? workflowWizardPatronId : 'Anyone'}</p>
                )}
              </div>
            )}
            {/* SIP2 Step 1 done */}
            {workflowWizardStepStatus[0] === 'done' && workflowWizardStepStatus[1] === 'pending' && workflowWizardType === 'sip2' && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '18px', color: '#52c41a' }}>✓ Step 1: Check-in Complete</p>
                <p style={{ fontSize: '14px', color: '#666' }}>Item: {workflowWizardItemId}</p>
                <div style={{
                  marginTop: '15px',
                  padding: '15px',
                  backgroundColor: '#f9f9f9',
                  border: '1px solid #d9d9d9',
                  borderRadius: '8px',
                  display: 'inline-block',
                  minWidth: '300px'
                }}>
                  <p style={{ fontSize: '16px', margin: 0, color: '#1890ff', fontWeight: 'bold' }}>
                    Patron ID: {workflowWizardPatronId || 'N/A'}
                  </p>
                </div>
                <p style={{ fontSize: '14px', color: '#666', marginTop: '15px' }}>Ready for verification</p>
              </div>
            )}
            {/* Polaris Step 1 done - shows verification result like SIP2 Step 3 */}
            {workflowWizardStepStatus[0] === 'done' && workflowWizardStepStatus[1] === 'pending' && workflowWizardType === 'polaris' && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '18px', color: '#52c41a' }}>✓ Step 1: Check-in Complete</p>
                <p style={{ fontSize: '14px', color: '#666' }}>Item: {workflowWizardItemId}</p>
                <div style={{
                  marginTop: '15px',
                  padding: '15px',
                  backgroundColor: '#f9f9f9',
                  border: '1px solid #d9d9d9',
                  borderRadius: '8px',
                  display: 'inline-block',
                  minWidth: '300px'
                }}>
                  <p style={{ fontSize: '16px', margin: '0 0 10px 0', color: '#1890ff', fontWeight: 'bold' }}>
                    Patron ID: {workflowWizardPatronId || 'N/A'}
                  </p>
                  <p style={{ fontSize: '16px', margin: 0, color: '#666' }}>
                    <b>Hold Expiration:</b> {workflowWizardHoldExpiration || 'N/A'}
                  </p>
                </div>
                <p style={{ fontSize: '14px', color: '#666', marginTop: '15px' }}>Ready for verification</p>
              </div>
            )}
            {/* SIP2 LoT Step 1 done */}
            {workflowWizardStepStatus[0] === 'done' && workflowWizardStepStatus[1] === 'pending' && workflowWizardType === 'sip2lot' && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '18px', color: '#52c41a' }}>
                  ✓ Step 1: {workflowWizardIsReturn ? 'Return' : 'Add Item'} Complete
                </p>
                <p style={{ fontSize: '14px', color: '#666' }}>Item: {workflowWizardItemId}</p>
                <div style={{
                  marginTop: '15px',
                  padding: '15px',
                  backgroundColor: '#f9f9f9',
                  border: '1px solid #d9d9d9',
                  borderRadius: '8px',
                  display: 'inline-block',
                  minWidth: '300px'
                }}>
                  {workflowWizardIsReturn ? (
                    <>
                      <p style={{ fontSize: '16px', margin: '0 0 10px 0', color: '#52c41a' }}>
                        <b>Check-in Result:</b> Success ✓
                      </p>
                      <p style={{ fontSize: '16px', margin: 0, color: '#1890ff', fontWeight: 'bold' }}>
                        Patron: {workflowWizardHasHold ? workflowWizardPatronId : 'Anyone'}
                      </p>
                      <p style={{ fontSize: '16px', margin: '10px 0 0 0', color: '#722ed1', fontWeight: 'bold' }}>
                        Group: {workflowWizardSelectedGroup}
                      </p>
                    </>
                  ) : (
                    <>
                      <p style={{ fontSize: '16px', margin: '0 0 15px 0', color: '#1890ff', fontWeight: 'bold' }}>
                        Item added to locker queue
                      </p>
                      <p style={{ fontSize: '16px', margin: '0 0 10px 0', color: '#333' }}>
                        <b>Select Group:</b>
                      </p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center' }}>
                        {sip2LotGroups.map((group) => (
                          <Button
                            key={group}
                            type={workflowWizardSelectedGroup === group ? 'primary' : 'default'}
                            size="large"
                            style={{
                              minWidth: '100px',
                              borderColor: workflowWizardSelectedGroup === group ? '#1890ff' : '#d9d9d9'
                            }}
                            onClick={() => setWorkflowWizardSelectedGroup(group)}
                          >
                            {group}
                          </Button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <p style={{ fontSize: '14px', color: '#666', marginTop: '15px' }}>
                  {workflowWizardIsReturn
                    ? 'Ready for verification'
                    : workflowWizardSelectedGroup
                      ? `Group "${workflowWizardSelectedGroup}" selected - Ready for verification`
                      : 'Please select a group to continue'}
                </p>
              </div>
            )}
            {/* Polaris LoT Step 1 done */}
            {workflowWizardStepStatus[0] === 'done' && workflowWizardStepStatus[1] === 'pending' && workflowWizardType === 'polarislot' && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '18px', color: '#52c41a' }}>
                  ✓ Step 1: {workflowWizardIsReturn ? 'Return' : 'Add Item'} Complete
                </p>
                <p style={{ fontSize: '14px', color: '#666' }}>Item: {workflowWizardItemId}</p>
                <div style={{
                  marginTop: '15px',
                  padding: '15px',
                  backgroundColor: '#f9f9f9',
                  border: '1px solid #d9d9d9',
                  borderRadius: '8px',
                  display: 'inline-block',
                  minWidth: '300px'
                }}>
                  {workflowWizardIsReturn ? (
                    <>
                      <p style={{ fontSize: '16px', margin: '0 0 10px 0', color: '#52c41a' }}>
                        <b>Return Result:</b> Success ✓
                      </p>
                      <p style={{ fontSize: '16px', margin: 0, color: '#1890ff', fontWeight: 'bold' }}>
                        Patron: {workflowWizardHasHold ? workflowWizardPatronId : 'Anyone'}
                      </p>
                      <p style={{ fontSize: '16px', margin: '10px 0 0 0', color: '#722ed1', fontWeight: 'bold' }}>
                        Group: {workflowWizardSelectedGroup}
                      </p>
                    </>
                  ) : (
                    <>
                      <p style={{ fontSize: '16px', margin: '0 0 15px 0', color: '#1890ff', fontWeight: 'bold' }}>
                        Item added to locker queue
                      </p>
                      <p style={{ fontSize: '16px', margin: '0 0 10px 0', color: '#333' }}>
                        <b>Select Group:</b>
                      </p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center' }}>
                        {sip2LotGroups.map((group) => (
                          <Button
                            key={group}
                            type={workflowWizardSelectedGroup === group ? 'primary' : 'default'}
                            size="large"
                            style={{
                              minWidth: '100px',
                              borderColor: workflowWizardSelectedGroup === group ? '#1890ff' : '#d9d9d9'
                            }}
                            onClick={() => setWorkflowWizardSelectedGroup(group)}
                          >
                            {group}
                          </Button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <p style={{ fontSize: '14px', color: '#666', marginTop: '15px' }}>
                  {workflowWizardIsReturn
                    ? 'Ready for verification'
                    : workflowWizardSelectedGroup
                      ? `Group "${workflowWizardSelectedGroup}" selected - Ready for verification`
                      : 'Please select a group to continue'}
                </p>
              </div>
            )}
            {/* Symphony Step 1 done */}
            {workflowWizardStepStatus[0] === 'done' && workflowWizardStepStatus[1] === 'pending' && workflowWizardType === 'symphony' && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '18px', color: '#52c41a' }}>✓ Step 1: Check-in Complete</p>
                <p style={{ fontSize: '14px', color: '#666' }}>Item: {workflowWizardItemId}</p>
                <div style={{
                  marginTop: '15px',
                  padding: '15px',
                  backgroundColor: '#f9f9f9',
                  border: '1px solid #d9d9d9',
                  borderRadius: '8px',
                  display: 'inline-block',
                  minWidth: '300px'
                }}>
                  <p style={{ fontSize: '16px', margin: '0 0 10px 0', color: '#1890ff', fontWeight: 'bold' }}>
                    Patron ID: {workflowWizardPatronId || 'N/A'}
                  </p>
                  <p style={{ fontSize: '16px', margin: 0, color: '#666' }}>
                    <b>Hold Expiration:</b> {workflowWizardHoldExpiration || 'N/A'}
                  </p>
                </div>
                <p style={{ fontSize: '14px', color: '#666', marginTop: '15px' }}>Ready for verification</p>
              </div>
            )}
            {/* Symphony LoT Step 1 done */}
            {workflowWizardStepStatus[0] === 'done' && workflowWizardStepStatus[1] === 'pending' && workflowWizardType === 'symphonylot' && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '18px', color: '#52c41a' }}>
                  ✓ Step 1: {workflowWizardIsReturn ? 'Return' : 'Add Item'} Complete
                </p>
                <p style={{ fontSize: '14px', color: '#666' }}>Item: {workflowWizardItemId}</p>
                <div style={{
                  marginTop: '15px',
                  padding: '15px',
                  backgroundColor: '#f9f9f9',
                  border: '1px solid #d9d9d9',
                  borderRadius: '8px',
                  display: 'inline-block',
                  minWidth: '300px'
                }}>
                  {workflowWizardIsReturn ? (
                    <>
                      <p style={{ fontSize: '16px', margin: '0 0 10px 0', color: '#52c41a' }}>
                        <b>Return Result:</b> Success ✓
                      </p>
                      <p style={{ fontSize: '16px', margin: 0, color: '#1890ff', fontWeight: 'bold' }}>
                        Patron: {workflowWizardHasHold ? workflowWizardPatronId : 'Anyone'}
                      </p>
                      <p style={{ fontSize: '16px', margin: '10px 0 0 0', color: '#722ed1', fontWeight: 'bold' }}>
                        Group: {workflowWizardSelectedGroup}
                      </p>
                    </>
                  ) : (
                    <>
                      <p style={{ fontSize: '16px', margin: '0 0 15px 0', color: '#1890ff', fontWeight: 'bold' }}>
                        Item added to locker queue
                      </p>
                      <p style={{ fontSize: '16px', margin: '0 0 10px 0', color: '#333' }}>
                        <b>Select Group:</b>
                      </p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center' }}>
                        {sip2LotGroups.map((group) => (
                          <Button
                            key={group}
                            type={workflowWizardSelectedGroup === group ? 'primary' : 'default'}
                            size="large"
                            style={{
                              minWidth: '100px',
                              borderColor: workflowWizardSelectedGroup === group ? '#1890ff' : '#d9d9d9'
                            }}
                            onClick={() => setWorkflowWizardSelectedGroup(group)}
                          >
                            {group}
                          </Button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <p style={{ fontSize: '14px', color: '#666', marginTop: '15px' }}>
                  {workflowWizardIsReturn
                    ? 'Ready for verification'
                    : workflowWizardSelectedGroup
                      ? `Group "${workflowWizardSelectedGroup}" selected - Ready for verification`
                      : 'Please select a group to continue'}
                </p>
              </div>
            )}
            {/* SIP2 Step 2 running */}
            {workflowWizardStepStatus[1] === 'running' && workflowWizardType === 'sip2' && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '18px', color: '#1890ff' }}>⏳ Running Step 2: Verify...</p>
                <p style={{ fontSize: '14px', color: '#666' }}>Verifying item status for: {workflowWizardItemId}</p>
              </div>
            )}
            {/* Polaris Step 2 running */}
            {workflowWizardStepStatus[1] === 'running' && workflowWizardType === 'polaris' && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '18px', color: '#1890ff' }}>⏳ Running Step 2: Verify...</p>
                <p style={{ fontSize: '14px', color: '#666' }}>Verifying item status for: {workflowWizardItemId}</p>
              </div>
            )}
            {/* Symphony Step 2 running */}
            {workflowWizardStepStatus[1] === 'running' && workflowWizardType === 'symphony' && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '18px', color: '#1890ff' }}>⏳ Running Step 2: Verify...</p>
                <p style={{ fontSize: '14px', color: '#666' }}>Verifying item status for: {workflowWizardItemId}</p>
              </div>
            )}
            {/* SIP2 LoT Step 2 running */}
            {workflowWizardStepStatus[1] === 'running' && workflowWizardType === 'sip2lot' && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '18px', color: '#1890ff' }}>⏳ Running Step 2: Verify...</p>
                <p style={{ fontSize: '14px', color: '#666' }}>Verifying item status for: {workflowWizardItemId}</p>
              </div>
            )}
            {/* Polaris LoT Step 2 running */}
            {workflowWizardStepStatus[1] === 'running' && workflowWizardType === 'polarislot' && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '18px', color: '#1890ff' }}>⏳ Running Step 2: Verify...</p>
                <p style={{ fontSize: '14px', color: '#666' }}>Verifying item status for: {workflowWizardItemId}</p>
              </div>
            )}
            {/* Symphony LoT Step 2 running */}
            {workflowWizardStepStatus[1] === 'running' && workflowWizardType === 'symphonylot' && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '18px', color: '#1890ff' }}>⏳ Running Step 2: Verify...</p>
                <p style={{ fontSize: '14px', color: '#666' }}>Verifying item status for: {workflowWizardItemId}</p>
              </div>
            )}
            {/* SIP2 Step 2 done */}
            {workflowWizardStepStatus[1] === 'done' && workflowWizardStepStatus[2] === 'pending' && workflowWizardType === 'sip2' && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '18px', color: '#52c41a' }}>✓ Step 2: Verify Complete</p>
                <p style={{ fontSize: '14px', color: '#666' }}>Item: {workflowWizardItemId}</p>
                <div style={{
                  marginTop: '15px',
                  padding: '15px',
                  backgroundColor: '#f9f9f9',
                  border: '1px solid #d9d9d9',
                  borderRadius: '8px',
                  display: 'inline-block',
                  minWidth: '300px'
                }}>
                  <p style={{ fontSize: '16px', margin: '0 0 10px 0', color: '#52c41a' }}>
                    <b>Has Hold:</b> Yes ✓
                  </p>
                  <p style={{ fontSize: '16px', margin: 0, color: getCircStatusColor(8) }}>
                    <b>Circulation Status (8):</b> {getCircStatusText(8)}
                  </p>
                </div>
                <div style={{
                  marginTop: '20px',
                  padding: '15px',
                  backgroundColor: '#e6f7ff',
                  border: '2px solid #1890ff',
                  borderRadius: '8px',
                  display: 'inline-block',
                  minWidth: '300px'
                }}>
                  <p style={{ fontSize: '20px', margin: 0, color: '#1890ff', fontWeight: 'bold' }}>
                    → Door #{workflowWizardDoorNumber || '?'}
                  </p>
                  <p style={{ fontSize: '14px', margin: '5px 0 0 0', color: '#666' }}>
                    Next available door for hold pickup
                  </p>
                </div>
                <p style={{ fontSize: '18px', color: '#52c41a', marginTop: '20px', fontWeight: 'bold' }}>Workflow Complete!</p>
              </div>
            )}
            {/* Polaris Step 2 done (FINAL) - similar to SIP2 Step 3 */}
            {workflowWizardStepStatus[1] === 'done' && workflowWizardType === 'polaris' && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '18px', color: '#52c41a' }}>✓ Step 2: Verify Complete</p>
                <p style={{ fontSize: '14px', color: '#666' }}>Item: {workflowWizardItemId}</p>
                <div style={{
                  marginTop: '15px',
                  padding: '15px',
                  backgroundColor: '#f9f9f9',
                  border: '1px solid #d9d9d9',
                  borderRadius: '8px',
                  display: 'inline-block',
                  minWidth: '300px'
                }}>
                  <p style={{ fontSize: '16px', margin: '0 0 10px 0', color: '#52c41a' }}>
                    <b>Has Hold:</b> Yes ✓
                  </p>
                  <p style={{ fontSize: '16px', margin: 0, color: getCircStatusColor(8) }}>
                    <b>Circulation Status (8):</b> {getCircStatusText(8)}
                  </p>
                </div>
                <div style={{
                  marginTop: '20px',
                  padding: '15px',
                  backgroundColor: '#e6f7ff',
                  border: '2px solid #1890ff',
                  borderRadius: '8px',
                  display: 'inline-block',
                  minWidth: '300px'
                }}>
                  <p style={{ fontSize: '20px', margin: 0, color: '#1890ff', fontWeight: 'bold' }}>
                    → Door #{workflowWizardDoorNumber || '?'}
                  </p>
                  <p style={{ fontSize: '14px', margin: '5px 0 0 0', color: '#666' }}>
                    Next available door for hold pickup
                  </p>
                </div>
                <p style={{ fontSize: '18px', color: '#52c41a', marginTop: '20px', fontWeight: 'bold' }}>Workflow Complete!</p>
              </div>
            )}
            {/* SIP2 LoT Step 2 done (FINAL) */}
            {workflowWizardStepStatus[1] === 'done' && workflowWizardStepStatus[2] === 'pending' && workflowWizardType === 'sip2lot' && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '18px', color: '#52c41a' }}>✓ Step 2: Verify Complete</p>
                <p style={{ fontSize: '14px', color: '#666' }}>Item: {workflowWizardItemId}</p>
                <div style={{
                  marginTop: '15px',
                  padding: '15px',
                  backgroundColor: '#f9f9f9',
                  border: '1px solid #d9d9d9',
                  borderRadius: '8px',
                  display: 'inline-block',
                  minWidth: '300px'
                }}>
                  {workflowWizardIsReturn ? (
                    <>
                      <p style={{ fontSize: '16px', margin: '0 0 10px 0', color: '#52c41a' }}>
                        <b>Return Status:</b> Complete ✓
                      </p>
                      <p style={{ fontSize: '16px', margin: 0, color: getCircStatusColor(1) }}>
                        <b>Circulation Status (1):</b> {getCircStatusText(1)}
                      </p>
                    </>
                  ) : (
                    <>
                      <p style={{ fontSize: '16px', margin: '0 0 10px 0', color: '#52c41a' }}>
                        <b>Add Item Status:</b> Complete ✓
                      </p>
                      <p style={{ fontSize: '16px', margin: 0, color: getCircStatusColor(8) }}>
                        <b>Circulation Status (8):</b> {getCircStatusText(8)}
                      </p>
                    </>
                  )}
                </div>
                <div style={{
                  marginTop: '20px',
                  padding: '15px',
                  backgroundColor: '#e6f7ff',
                  border: '2px solid #1890ff',
                  borderRadius: '8px',
                  display: 'inline-block',
                  minWidth: '300px'
                }}>
                  <p style={{ fontSize: '20px', margin: 0, color: '#1890ff', fontWeight: 'bold' }}>
                    → Door #{workflowWizardDoorNumber || '?'}
                  </p>
                  <p style={{ fontSize: '14px', margin: '5px 0 0 0', color: '#666' }}>
                    {workflowWizardIsReturn ? 'Return slot' : 'Next available door'}
                  </p>
                  <p style={{ fontSize: '16px', margin: '10px 0 0 0', color: '#722ed1', fontWeight: 'bold' }}>
                    Group: {workflowWizardSelectedGroup}
                  </p>
                </div>
                <p style={{ fontSize: '18px', color: '#52c41a', marginTop: '20px', fontWeight: 'bold' }}>Workflow Complete!</p>
              </div>
            )}
            {/* Polaris LoT Step 2 done (FINAL) */}
            {workflowWizardStepStatus[1] === 'done' && workflowWizardStepStatus[2] === 'pending' && workflowWizardType === 'polarislot' && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '18px', color: '#52c41a' }}>✓ Step 2: Verify Complete</p>
                <p style={{ fontSize: '14px', color: '#666' }}>Item: {workflowWizardItemId}</p>
                <div style={{
                  marginTop: '15px',
                  padding: '15px',
                  backgroundColor: '#f9f9f9',
                  border: '1px solid #d9d9d9',
                  borderRadius: '8px',
                  display: 'inline-block',
                  minWidth: '300px'
                }}>
                  {workflowWizardIsReturn ? (
                    <>
                      <p style={{ fontSize: '16px', margin: '0 0 10px 0', color: '#52c41a' }}>
                        <b>Return Status:</b> Complete ✓
                      </p>
                      <p style={{ fontSize: '16px', margin: 0, color: getCircStatusColor(1) }}>
                        <b>Circulation Status (1):</b> {getCircStatusText(1)}
                      </p>
                    </>
                  ) : (
                    <>
                      <p style={{ fontSize: '16px', margin: '0 0 10px 0', color: '#52c41a' }}>
                        <b>Add Item Status:</b> Complete ✓
                      </p>
                      <p style={{ fontSize: '16px', margin: 0, color: getCircStatusColor(8) }}>
                        <b>Circulation Status (8):</b> {getCircStatusText(8)}
                      </p>
                    </>
                  )}
                </div>
                <div style={{
                  marginTop: '20px',
                  padding: '15px',
                  backgroundColor: '#e6f7ff',
                  border: '2px solid #1890ff',
                  borderRadius: '8px',
                  display: 'inline-block',
                  minWidth: '300px'
                }}>
                  <p style={{ fontSize: '20px', margin: 0, color: '#1890ff', fontWeight: 'bold' }}>
                    → Door #{workflowWizardDoorNumber || '?'}
                  </p>
                  <p style={{ fontSize: '14px', margin: '5px 0 0 0', color: '#666' }}>
                    {workflowWizardIsReturn ? 'Return slot' : 'Next available door'}
                  </p>
                  <p style={{ fontSize: '16px', margin: '10px 0 0 0', color: '#722ed1', fontWeight: 'bold' }}>
                    Group: {workflowWizardSelectedGroup}
                  </p>
                </div>
                <p style={{ fontSize: '18px', color: '#52c41a', marginTop: '20px', fontWeight: 'bold' }}>Workflow Complete!</p>
              </div>
            )}
            {/* Symphony LoT Step 2 done (FINAL) */}
            {workflowWizardStepStatus[1] === 'done' && workflowWizardStepStatus[2] === 'pending' && workflowWizardType === 'symphonylot' && (
              <div style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '18px', color: '#52c41a' }}>✓ Step 2: Verify Complete</p>
                <p style={{ fontSize: '14px', color: '#666' }}>Item: {workflowWizardItemId}</p>
                <div style={{
                  marginTop: '15px',
                  padding: '15px',
                  backgroundColor: '#f9f9f9',
                  border: '1px solid #d9d9d9',
                  borderRadius: '8px',
                  display: 'inline-block',
                  minWidth: '300px'
                }}>
                  {workflowWizardIsReturn ? (
                    <>
                      <p style={{ fontSize: '16px', margin: '0 0 10px 0', color: '#52c41a' }}>
                        <b>Return Status:</b> Complete ✓
                      </p>
                      <p style={{ fontSize: '16px', margin: 0, color: getCircStatusColor(1) }}>
                        <b>Circulation Status (1):</b> {getCircStatusText(1)}
                      </p>
                    </>
                  ) : (
                    <>
                      <p style={{ fontSize: '16px', margin: '0 0 10px 0', color: '#52c41a' }}>
                        <b>Add Item Status:</b> Complete ✓
                      </p>
                      <p style={{ fontSize: '16px', margin: 0, color: getCircStatusColor(8) }}>
                        <b>Circulation Status (8):</b> {getCircStatusText(8)}
                      </p>
                    </>
                  )}
                </div>
                <div style={{
                  marginTop: '20px',
                  padding: '15px',
                  backgroundColor: '#e6f7ff',
                  border: '2px solid #1890ff',
                  borderRadius: '8px',
                  display: 'inline-block',
                  minWidth: '300px'
                }}>
                  <p style={{ fontSize: '20px', margin: 0, color: '#1890ff', fontWeight: 'bold' }}>
                    → Door #{workflowWizardDoorNumber || '?'}
                  </p>
                  <p style={{ fontSize: '14px', margin: '5px 0 0 0', color: '#666' }}>
                    {workflowWizardIsReturn ? 'Return slot' : 'Next available door'}
                  </p>
                  <p style={{ fontSize: '16px', margin: '10px 0 0 0', color: '#722ed1', fontWeight: 'bold' }}>
                    Group: {workflowWizardSelectedGroup}
                  </p>
                </div>
                <p style={{ fontSize: '18px', color: '#52c41a', marginTop: '20px', fontWeight: 'bold' }}>Workflow Complete!</p>
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '15px' }}>
            <Button
              size="large"
              style={{ flex: 1, height: '60px', fontSize: '20px' }}
              onClick={() => setWorkflowWizardOpen(false)}
              disabled={workflowWizardRunning}
            >
              {/* Close button text based on workflow completion */}
              {((workflowWizardType === 'polaris' || workflowWizardType === 'symphony') && workflowWizardStepStatus[1] === 'done') ||
               ((workflowWizardType !== 'polaris' && workflowWizardType !== 'symphony') && workflowWizardStepStatus[2] === 'done')
                ? 'Close' : 'Cancel'}
            </Button>
            {/* Show Next button if workflow not complete */}
            {!(((workflowWizardType === 'polaris' || workflowWizardType === 'symphony') && workflowWizardStepStatus[1] === 'done') ||
               ((workflowWizardType !== 'polaris' && workflowWizardType !== 'symphony') && workflowWizardStepStatus[2] === 'done')) && (
              <Button
                id="workflow-next-btn"
                type="primary"
                size="large"
                style={{ flex: 1, height: '60px', fontSize: '20px' }}
                disabled={
                  workflowWizardRunning ||
                  // SIP2 disabled conditions
                  (workflowWizardType === 'sip2' && workflowWizardStep === 0 && (!workflowWizardItemId.trim() || !workflowWizardItemInfoSent || workflowWizardHasHold === false || workflowWizardCircStatus === 4)) ||
                  // Polaris disabled conditions
                  (workflowWizardType === 'polaris' && workflowWizardStep === 0 && (!workflowWizardItemId.trim() || !workflowWizardItemInfoSent || workflowWizardItemFound === false)) ||
                  // Symphony disabled conditions
                  (workflowWizardType === 'symphony' && workflowWizardStep === 0 && (!workflowWizardItemId.trim() || !workflowWizardItemInfoSent || workflowWizardItemFound === false)) ||
                  // SIP2 LoT disabled conditions - only require itemId and itemInfoSent (no hold/circStatus restrictions)
                  (workflowWizardType === 'sip2lot' && workflowWizardStep === 0 && (!workflowWizardItemId.trim() || !workflowWizardItemInfoSent)) ||
                  // SIP2 LoT Step 2 - require group selection for Add Item (not Return)
                  (workflowWizardType === 'sip2lot' && workflowWizardStepStatus[0] === 'done' && workflowWizardStepStatus[1] === 'pending' && !workflowWizardIsReturn && !workflowWizardSelectedGroup) ||
                  // Polaris LoT disabled conditions - only require itemId and itemInfoSent
                  (workflowWizardType === 'polarislot' && workflowWizardStep === 0 && (!workflowWizardItemId.trim() || !workflowWizardItemInfoSent)) ||
                  // Polaris LoT Step 2 - require group selection for Add Item (not Return)
                  (workflowWizardType === 'polarislot' && workflowWizardStepStatus[0] === 'done' && workflowWizardStepStatus[1] === 'pending' && !workflowWizardIsReturn && !workflowWizardSelectedGroup) ||
                  // Symphony LoT disabled conditions - only require itemId and itemInfoSent
                  (workflowWizardType === 'symphonylot' && workflowWizardStep === 0 && (!workflowWizardItemId.trim() || !workflowWizardItemInfoSent)) ||
                  // Symphony LoT Step 2 - require group selection for Add Item (not Return)
                  (workflowWizardType === 'symphonylot' && workflowWizardStepStatus[0] === 'done' && workflowWizardStepStatus[1] === 'pending' && !workflowWizardIsReturn && !workflowWizardSelectedGroup)
                }
                onClick={async () => {
                  const currentStep = workflowWizardStepStatus.findIndex(s => s === 'pending');
                  if (currentStep === -1) return;

                  // For SIP2, require itemId and itemInfo sent before step 1
                  if (workflowWizardType === 'sip2' && currentStep === 0) {
                    if (!workflowWizardItemId.trim()) {
                      customToast(() => (<b>Please enter an Item ID first</b>), 2000, 'default', 'dark');
                      return;
                    }
                    if (!workflowWizardItemInfoSent) {
                      customToast(() => (<b>Please click "Send" to query item info first</b>), 2000, 'default', 'dark');
                      return;
                    }
                  }

                  // For Polaris, require itemId and itemInfo sent before step 1
                  if (workflowWizardType === 'polaris' && currentStep === 0) {
                    if (!workflowWizardItemId.trim()) {
                      customToast(() => (<b>Please enter an Item ID first</b>), 2000, 'default', 'dark');
                      return;
                    }
                    if (!workflowWizardItemInfoSent) {
                      customToast(() => (<b>Please click "Send" to check Hold Pull List first</b>), 2000, 'default', 'dark');
                      return;
                    }
                    if (!workflowWizardItemFound) {
                      customToast(() => (<b>Item not found in Hold Pull List</b>), 2000, 'default', 'dark');
                      return;
                    }
                  }

                  // For SIP2 LoT, require itemId and itemInfo sent before step 1
                  if (workflowWizardType === 'sip2lot' && currentStep === 0) {
                    if (!workflowWizardItemId.trim()) {
                      customToast(() => (<b>Please enter an Item ID first</b>), 2000, 'default', 'dark');
                      return;
                    }
                    if (!workflowWizardItemInfoSent) {
                      customToast(() => (<b>Please click "Send" to query item info first</b>), 2000, 'default', 'dark');
                      return;
                    }
                  }

                  // For Polaris LoT, require itemId and itemInfo sent before step 1
                  if (workflowWizardType === 'polarislot' && currentStep === 0) {
                    if (!workflowWizardItemId.trim()) {
                      customToast(() => (<b>Please enter an Item ID first</b>), 2000, 'default', 'dark');
                      return;
                    }
                    if (!workflowWizardItemInfoSent) {
                      customToast(() => (<b>Please click "Send" to query item info first</b>), 2000, 'default', 'dark');
                      return;
                    }
                  }

                  // For Symphony, require itemId and itemInfo sent before step 1
                  if (workflowWizardType === 'symphony' && currentStep === 0) {
                    if (!workflowWizardItemId.trim()) {
                      customToast(() => (<b>Please enter an Item ID first</b>), 2000, 'default', 'dark');
                      return;
                    }
                    if (!workflowWizardItemInfoSent) {
                      customToast(() => (<b>Please click "Send" to check Hold Pull List first</b>), 2000, 'default', 'dark');
                      return;
                    }
                    if (!workflowWizardItemFound) {
                      customToast(() => (<b>Item not found in Hold Pull List</b>), 2000, 'default', 'dark');
                      return;
                    }
                  }

                  // For Symphony LoT, require itemId and itemInfo sent before step 1
                  if (workflowWizardType === 'symphonylot' && currentStep === 0) {
                    if (!workflowWizardItemId.trim()) {
                      customToast(() => (<b>Please enter an Item ID first</b>), 2000, 'default', 'dark');
                      return;
                    }
                    if (!workflowWizardItemInfoSent) {
                      customToast(() => (<b>Please click "Send" to query item info first</b>), 2000, 'default', 'dark');
                      return;
                    }
                  }

                  // Mark current step as running
                  setWorkflowWizardRunning(true);
                  const newStatus = [...workflowWizardStepStatus];
                  newStatus[currentStep] = 'running';
                  setWorkflowWizardStepStatus(newStatus as any);
                  setWorkflowWizardStep(currentStep + 1);

                  // SIP2: For Step 1 (Check-in), generate random patronId starting with 2, 6 digits total
                  if (workflowWizardType === 'sip2' && currentStep === 0) {
                    // Small delay to ensure UI shows running state first
                    await new Promise(resolve => setTimeout(resolve, 100));
                    const randomDigits = Math.floor(10000 + Math.random() * 90000); // 5 random digits
                    const patronId = `2${randomDigits}`;
                    setWorkflowWizardPatronId(patronId);
                  }

                  // SIP2: For Step 2 (Verify), generate random door number (1-12)
                  if (workflowWizardType === 'sip2' && currentStep === 1) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    const doorNumber = Math.floor(1 + Math.random() * 12); // Random door 1-12
                    setWorkflowWizardDoorNumber(doorNumber);
                  }

                  // Polaris: For Step 1 (Check-in), door number is generated
                  if (workflowWizardType === 'polaris' && currentStep === 0) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    const doorNumber = Math.floor(1 + Math.random() * 12); // Random door 1-12
                    setWorkflowWizardDoorNumber(doorNumber);
                  }

                  // SIP2 LoT: For Step 1 (Return/Add Item), generate patronId if return and had hold, and randomly select group for return
                  if (workflowWizardType === 'sip2lot' && currentStep === 0) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    // For return with hold, generate patronId
                    if (workflowWizardIsReturn && workflowWizardHasHold) {
                      const randomDigits = Math.floor(10000 + Math.random() * 90000);
                      const patronId = `2${randomDigits}`;
                      setWorkflowWizardPatronId(patronId);
                    }
                    // For return, randomly select a group
                    if (workflowWizardIsReturn) {
                      const randomGroup = sip2LotGroups[Math.floor(Math.random() * sip2LotGroups.length)];
                      setWorkflowWizardSelectedGroup(randomGroup);
                    }
                  }

                  // SIP2 LoT: For Step 2 (Verify), generate door number
                  if (workflowWizardType === 'sip2lot' && currentStep === 1) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    const doorNumber = Math.floor(1 + Math.random() * 12); // Random door 1-12
                    setWorkflowWizardDoorNumber(doorNumber);
                  }

                  // Polaris LoT: For Step 1 (Return/Add Item), generate patronId if return and had hold, and randomly select group for return
                  if (workflowWizardType === 'polarislot' && currentStep === 0) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    // For return with hold, generate patronId
                    if (workflowWizardIsReturn && workflowWizardHasHold) {
                      const randomDigits = Math.floor(10000 + Math.random() * 90000);
                      const patronId = `2${randomDigits}`;
                      setWorkflowWizardPatronId(patronId);
                    }
                    // For return, randomly select a group
                    if (workflowWizardIsReturn) {
                      const randomGroup = sip2LotGroups[Math.floor(Math.random() * sip2LotGroups.length)];
                      setWorkflowWizardSelectedGroup(randomGroup);
                    }
                  }

                  // Polaris LoT: For Step 2 (Verify), generate door number
                  if (workflowWizardType === 'polarislot' && currentStep === 1) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    const doorNumber = Math.floor(1 + Math.random() * 12); // Random door 1-12
                    setWorkflowWizardDoorNumber(doorNumber);
                  }

                  // Symphony: For Step 1 (Check-in), door number is generated
                  if (workflowWizardType === 'symphony' && currentStep === 0) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    const doorNumber = Math.floor(1 + Math.random() * 12); // Random door 1-12
                    setWorkflowWizardDoorNumber(doorNumber);
                  }

                  // Symphony LoT: For Step 1 (Return/Add Item), generate patronId if return and had hold, and randomly select group for return
                  if (workflowWizardType === 'symphonylot' && currentStep === 0) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    // For return with hold, generate patronId
                    if (workflowWizardIsReturn && workflowWizardHasHold) {
                      const randomDigits = Math.floor(10000 + Math.random() * 90000);
                      const patronId = `2${randomDigits}`;
                      setWorkflowWizardPatronId(patronId);
                    }
                    // For return, randomly select a group
                    if (workflowWizardIsReturn) {
                      const randomGroup = sip2LotGroups[Math.floor(Math.random() * sip2LotGroups.length)];
                      setWorkflowWizardSelectedGroup(randomGroup);
                    }
                  }

                  // Symphony LoT: For Step 2 (Verify), generate door number
                  if (workflowWizardType === 'symphonylot' && currentStep === 1) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    const doorNumber = Math.floor(1 + Math.random() * 12); // Random door 1-12
                    setWorkflowWizardDoorNumber(doorNumber);
                  }

                  // Simulate step execution
                  await new Promise(resolve => setTimeout(resolve, 1000));

                  // Mark step as done
                  const doneStatus = [...newStatus];
                  doneStatus[currentStep] = 'done';
                  setWorkflowWizardStepStatus(doneStatus as any);
                  setWorkflowWizardRunning(false);

                  customToast(() => (<b>Step {currentStep + 1} done ✓</b>), 1500, 'default', 'dark');
                }}
              >
                {/* SIP2 button text */}
                {workflowWizardType === 'sip2' && workflowWizardStepStatus[0] === 'pending' && 'Next: Check-in →'}
                {workflowWizardType === 'sip2' && workflowWizardStepStatus[0] === 'done' && workflowWizardStepStatus[1] === 'pending' && 'Next: Verify →'}
                {workflowWizardType === 'sip2' && workflowWizardStepStatus[1] === 'done' && workflowWizardStepStatus[2] === 'pending' && 'Finish →'}
                {/* Polaris button text */}
                {workflowWizardType === 'polaris' && workflowWizardStepStatus[0] === 'pending' && 'Next: Check-in →'}
                {workflowWizardType === 'polaris' && workflowWizardStepStatus[0] === 'done' && workflowWizardStepStatus[1] === 'pending' && 'Finish →'}
                {/* SIP2 LoT button text */}
                {workflowWizardType === 'sip2lot' && workflowWizardStepStatus[0] === 'pending' && (workflowWizardIsReturn ? 'Next: Return →' : 'Next: Add Item →')}
                {workflowWizardType === 'sip2lot' && workflowWizardStepStatus[0] === 'done' && workflowWizardStepStatus[1] === 'pending' && 'Next: Verify →'}
                {workflowWizardType === 'sip2lot' && workflowWizardStepStatus[1] === 'done' && workflowWizardStepStatus[2] === 'pending' && 'Finish →'}
                {/* Polaris LoT button text */}
                {workflowWizardType === 'polarislot' && workflowWizardStepStatus[0] === 'pending' && (workflowWizardIsReturn ? 'Next: Return →' : 'Next: Add Item →')}
                {workflowWizardType === 'polarislot' && workflowWizardStepStatus[0] === 'done' && workflowWizardStepStatus[1] === 'pending' && 'Next: Verify →'}
                {workflowWizardType === 'polarislot' && workflowWizardStepStatus[1] === 'done' && workflowWizardStepStatus[2] === 'pending' && 'Finish →'}
                {/* Symphony button text */}
                {workflowWizardType === 'symphony' && workflowWizardStepStatus[0] === 'pending' && 'Next: Check-in →'}
                {workflowWizardType === 'symphony' && workflowWizardStepStatus[0] === 'done' && workflowWizardStepStatus[1] === 'pending' && 'Finish →'}
                {/* Symphony LoT button text */}
                {workflowWizardType === 'symphonylot' && workflowWizardStepStatus[0] === 'pending' && (workflowWizardIsReturn ? 'Next: Return →' : 'Next: Add Item →')}
                {workflowWizardType === 'symphonylot' && workflowWizardStepStatus[0] === 'done' && workflowWizardStepStatus[1] === 'pending' && 'Next: Verify →'}
                {workflowWizardType === 'symphonylot' && workflowWizardStepStatus[1] === 'done' && workflowWizardStepStatus[2] === 'pending' && 'Finish →'}
              </Button>
            )}
          </div>
        </div>
      </Modal>

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

      <div style={fontControlStyle}>
          <AiOutlineMinusCircle
            size={80}
            color="white"
            onClick={decreaseFontSize}
            style={{cursor: 'pointer'}}
          />
          <AiOutlinePlusCircle
            size={80}
            color="white"
            onClick={increaseFontSize}
            style={{cursor: 'pointer'}}
          />
      </div>

      {/* Auto-exit timer disabled for admin page */}
      {/* <Space size="middle" style={{  position: 'fixed', right: '20px', bottom: '10px', color: 'white' }} onClick={() => setLocation('/')}>
        <Badge  count={sessionTimer.value} color="gray">
          <span style={{color: 'white', fontSize: '20px'}}>Autoexit in <AiOutlineClockCircle color='white' size={30} /></span>
        </Badge>
      </Space> */}

      <Button size="large" style={ {position: 'fixed', left: '20px', top: '20px', ...getTextStyle({padding: '20px 40px', margin: 'auto', height: 'auto', fontSize: '32px', fontWeight: 'bold'})}} onClick={exit} type="primary" danger>   {t('ADMIN_EXIT')} </Button>

      {/* Admin view auto-exit timer - shown when no modal is open */}
      {viewMainView && <div style={{position: 'fixed', left: '170px', top: '20px', ...getTextStyle({padding: '20px 40px', margin: 'auto', height: 'auto', fontSize: '32px', fontWeight: 'bold', color: 'white', display: 'flex', alignItems: 'center', gap: '10px'})}}><AiOutlineClockCircle color='white' size={40} /> Auto-exit: {adminViewTimer}s</div>}

      {viewRemoveAllExpired && <div style={{position: 'fixed', left: '50%', transform: 'translateX(150px)', top: '20px', ...getTextStyle({padding: '20px 40px', margin: 'auto', height: 'auto', fontSize: '48px', fontWeight: 'bold', color: 'white', display: 'flex', alignItems: 'center', gap: '10px'})}}><AiOutlineClockCircle color='white' size={50} /> {expiredTimer}s</div>}
      {/* Smart consolidation timer removed — uses cancelledTimer via viewRemoveAllCancelled */}
      {viewRemoveAllCancelled && <div style={{position: 'fixed', left: '50%', transform: 'translateX(150px)', top: '20px', ...getTextStyle({padding: '20px 40px', margin: 'auto', height: 'auto', fontSize: '48px', fontWeight: 'bold', color: 'white', display: 'flex', alignItems: 'center', gap: '10px'})}}><AiOutlineClockCircle color='white' size={50} /> {cancelledTimer}s</div>}
      {viewRemoveAllLeftBehind && <div style={{position: 'fixed', left: '50%', transform: 'translateX(150px)', top: '20px', ...getTextStyle({padding: '20px 40px', margin: 'auto', height: 'auto', fontSize: '48px', fontWeight: 'bold', color: 'white', display: 'flex', alignItems: 'center', gap: '10px'})}}><AiOutlineClockCircle color='white' size={50} /> {leftBehindTimer}s</div>}
      {viewInspection && <div style={{position: 'fixed', left: '50%', transform: 'translateX(150px)', top: '20px', ...getTextStyle({padding: '20px 40px', margin: 'auto', height: 'auto', fontSize: '48px', fontWeight: 'bold', color: 'white', display: 'flex', alignItems: 'center', gap: '10px'})}}><AiOutlineClockCircle color='white' size={50} /> {inspectionTimer}s</div>}


    </>
  );
}
