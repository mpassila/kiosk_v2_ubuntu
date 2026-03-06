/**
 * RFID Service - Renderer side API
 * Uses WebSocket-based communication via main process to RFID pad server
 * Replaces legacy REST API implementation
 */

import { signal } from '@preact/signals-react'

// Signals for reactive state
const rfidItemId = signal<string>('')
const rfidConnectionStatus = signal<{ wsConnected: boolean; readerConnected: boolean }>({
  wsConnected: false,
  readerConnected: false
})
const rfidTags = signal<any[]>([])
const rfidReaderInfo = signal<any>(null)

// Get electron API
const getElectron = () => (window as any).electron;
const getElectronAPI = () => (window as any).electronAPI;

/**
 * Initialize RFID service - connects to WebSocket server
 */
async function initRfidService(): Promise<any> {
  try {
    const electron = getElectron();
    if (!electron?.sideeventNative?.initRfidService) {
      console.error('RFID: initRfidService not available in preload');
      return { success: false, message: 'RFID service not available' };
    }

    const result = await electron.sideeventNative.initRfidService();
    console.log('RFID: Service initialized:', result);
    return result;
  } catch (error: any) {
    console.error('RFID: Error initializing service:', error);
    return { success: false, message: error.message };
  }
}

/**
 * Connect to RFID reader hardware
 */
async function connectRfidReader(): Promise<any> {
  try {
    const electron = getElectron();
    if (!electron?.sideeventNative?.connectRfidReader) {
      console.error('RFID: connectRfidReader not available in preload');
      return { success: false, message: 'RFID service not available' };
    }

    const result = await electron.sideeventNative.connectRfidReader();
    console.log('RFID: Reader connected:', result);

    if (result.success) {
      rfidConnectionStatus.value = { wsConnected: true, readerConnected: true };
      rfidReaderInfo.value = {
        readerType: result.readerType,
        deviceId: result.deviceId,
        connectionMode: result.connectionMode
      };
    }

    return result;
  } catch (error: any) {
    console.error('RFID: Error connecting reader:', error);
    return { success: false, message: error.message };
  }
}

/**
 * Disconnect from RFID reader hardware
 */
async function disconnectRfidReader(): Promise<any> {
  try {
    const electron = getElectron();
    if (!electron?.sideeventNative?.disconnectRfidReader) {
      console.error('RFID: disconnectRfidReader not available in preload');
      return { success: false, message: 'RFID service not available' };
    }

    const result = await electron.sideeventNative.disconnectRfidReader();
    console.log('RFID: Reader disconnected:', result);

    if (result.success) {
      rfidConnectionStatus.value = { ...rfidConnectionStatus.value, readerConnected: false };
    }

    return result;
  } catch (error: any) {
    console.error('RFID: Error disconnecting reader:', error);
    return { success: false, message: error.message };
  }
}

/**
 * Read all RFID tags on the pad
 * Returns array of tags with parsed data (itemId, barcode, AFI, security, etc.)
 */
async function readAllTags(): Promise<any> {
  try {
    const electron = getElectron();
    if (!electron?.sideeventNative?.readRfidTags) {
      console.error('RFID: readRfidTags not available in preload');
      return { success: false, message: 'RFID service not available', tags: [] };
    }

    const result = await electron.sideeventNative.readRfidTags();

    // Debug log raw result
    console.log('RFID: Raw result from main:', JSON.stringify(result).substring(0, 500));

    // Handle response - tags are in result.tags
    let tags = result?.tags || [];

    // Check if result itself is an array of tags
    if (Array.isArray(result) && result.length > 0 && result[0]?.IDD) {
      tags = result;
    }

    console.log('RFID: Extracted tags count:', tags.length);

    if (tags.length > 0) {
      console.log('RFID: Tags read:', tags.length, 'tag(s)');
      rfidTags.value = tags;

      // Update itemId signal with first tag's itemId/barcode (for compatibility with barcode flow)
      const firstTag = tags[0];
      const itemId = firstTag.parsed?.barcode || firstTag.parsed?.itemId || '';
      const security = firstTag.security ?? (firstTag.afi === 7);

      console.log('RFID: First tag -', 'IDD:', firstTag.IDD, 'barcode:', itemId, 'security:', security, 'afi:', firstTag.afi);

      if (itemId) {
        // Transform test barcodes to random 6-digit value starting with 300 (same as barcode scanner)
        let finalItemId = itemId;
        if (itemId === '12345678999999' || itemId === '21202000818465') {
          const rnd = Math.floor(Math.random() * 1000); // 0-999
          const rndStr = rnd.toString().padStart(3, '0'); // 000-999
          finalItemId = '300' + rndStr; // 300000-300999
          console.log('RFID: Test barcode detected, transformed to:', finalItemId);
        }

        // Always update signal (clear first to ensure change is detected)
        if (rfidItemId.value === finalItemId) {
          rfidItemId.value = ''; // Clear first
        }
        rfidItemId.value = finalItemId;
        console.log('RFID: ✅ Updated rfidItemId signal to:', finalItemId);
      }
    }

    return { success: result?.success !== false, tags };
  } catch (error: any) {
    console.error('RFID: Error reading tags:', error);
    return { success: false, message: error.message, tags: [] };
  }
}

/**
 * Read RFID tags using Buffer Read Mode (for BLE/TCP modes)
 */
async function readTagsBrm(readTime: number = 2000): Promise<any> {
  try {
    const electron = getElectron();
    if (!electron?.sideeventNative?.readRfidTagsBrm) {
      console.error('RFID: readRfidTagsBrm not available in preload');
      return { success: false, message: 'RFID service not available', tags: [] };
    }

    const result = await electron.sideeventNative.readRfidTagsBrm(readTime);
    console.log('RFID: Tags read (BRM):', result);

    if (result.success && result.tags) {
      rfidTags.value = result.tags;
    }

    return result;
  } catch (error: any) {
    console.error('RFID: Error reading tags (BRM):', error);
    return { success: false, message: error.message, tags: [] };
  }
}

/**
 * Set security (AFI) on RFID tags
 * @param security - true = AFI 7 (checked in), false = AFI 0 (checked out)
 * @param tagId - optional tag ID, if not provided applies to all tags
 */
async function setRfidSecurity(security: boolean, tagId?: string): Promise<any> {
  try {
    const electron = getElectron();
    if (!electron?.sideeventNative?.setRfidSecurity) {
      console.error('RFID: setRfidSecurity not available in preload');
      return { success: false, message: 'RFID service not available' };
    }

    const result = await electron.sideeventNative.setRfidSecurity(security, tagId);
    console.log('RFID: Security set:', result);
    return result;
  } catch (error: any) {
    console.error('RFID: Error setting security:', error);
    return { success: false, message: error.message };
  }
}

/**
 * Activate security (AFI = 7) on all tags or specific tag
 */
async function activateSecurity(tagId?: string): Promise<any> {
  return setRfidSecurity(true, tagId);
}

/**
 * Deactivate security (AFI = 0) on all tags or specific tag
 */
async function deactivateSecurity(tagId?: string): Promise<any> {
  return setRfidSecurity(false, tagId);
}

/**
 * Get RFID reader information
 */
async function getRfidReaderInfo(): Promise<any> {
  try {
    const electron = getElectron();
    if (!electron?.sideeventNative?.getRfidReaderInfo) {
      console.error('RFID: getRfidReaderInfo not available in preload');
      return { success: false, message: 'RFID service not available' };
    }

    const result = await electron.sideeventNative.getRfidReaderInfo();
    console.log('RFID: Reader info:', result);

    if (result.success) {
      rfidReaderInfo.value = result;
    }

    return result;
  } catch (error: any) {
    console.error('RFID: Error getting reader info:', error);
    return { success: false, message: error.message };
  }
}

/**
 * Start continuous RFID tag scanning
 * Tags will be sent via onRfidTagRead callback
 */
async function startContinuousScan(interval: number = 1): Promise<any> {
  try {
    const electron = getElectron();
    if (!electron?.sideeventNative?.startRfidContinuousScan) {
      console.error('RFID: startRfidContinuousScan not available in preload');
      return { success: false, message: 'RFID service not available' };
    }

    const result = await electron.sideeventNative.startRfidContinuousScan(interval);
    console.log('RFID: Continuous scan started:', result);
    return result;
  } catch (error: any) {
    console.error('RFID: Error starting continuous scan:', error);
    return { success: false, message: error.message };
  }
}

/**
 * Stop continuous RFID tag scanning
 */
async function stopContinuousScan(): Promise<any> {
  try {
    const electron = getElectron();
    if (!electron?.sideeventNative?.stopRfidContinuousScan) {
      console.error('RFID: stopRfidContinuousScan not available in preload');
      return { success: false, message: 'RFID service not available' };
    }

    const result = await electron.sideeventNative.stopRfidContinuousScan();
    console.log('RFID: Continuous scan stopped:', result);
    return result;
  } catch (error: any) {
    console.error('RFID: Error stopping continuous scan:', error);
    return { success: false, message: error.message };
  }
}

/**
 * RFID health check
 */
async function rfidHealthCheck(): Promise<any> {
  try {
    const electron = getElectron();
    if (!electron?.sideeventNative?.rfidHealthCheck) {
      console.error('RFID: rfidHealthCheck not available in preload');
      return { success: false, message: 'RFID service not available' };
    }

    const result = await electron.sideeventNative.rfidHealthCheck();
    console.log('RFID: Health check:', result);
    return result;
  } catch (error: any) {
    console.error('RFID: Error in health check:', error);
    return { success: false, message: error.message };
  }
}

/**
 * Get RFID connection status
 */
async function getRfidConnectionStatus(): Promise<{ wsConnected: boolean; readerConnected: boolean }> {
  try {
    const electron = getElectron();
    if (!electron?.sideeventNative?.getRfidConnectionStatus) {
      return { wsConnected: false, readerConnected: false };
    }

    const result = await electron.sideeventNative.getRfidConnectionStatus();
    rfidConnectionStatus.value = result;
    return result;
  } catch (error: any) {
    console.error('RFID: Error getting connection status:', error);
    return { wsConnected: false, readerConnected: false };
  }
}

/**
 * Register callback for RFID tag read events (continuous scanning)
 */
function onRfidTagRead(callback: (data: any) => void): void {
  const electronAPI = getElectronAPI();
  if (electronAPI?.onRfidTagRead) {
    electronAPI.onRfidTagRead((data: any) => {
      console.log('RFID: Tag read event:', data);
      if (data.tags) {
        rfidTags.value = data.tags;
      }
      callback(data);
    });
  } else {
    console.error('RFID: onRfidTagRead not available in electronAPI');
  }
}

/**
 * Register callback for RFID connection status events
 */
function onRfidConnectionStatusChange(callback: (status: { connected: boolean; readerConnected: boolean }) => void): void {
  const electronAPI = getElectronAPI();
  if (electronAPI?.onRfidConnectionStatus) {
    electronAPI.onRfidConnectionStatus((status: any) => {
      console.log('RFID: Connection status event:', status);
      rfidConnectionStatus.value = {
        wsConnected: status.connected,
        readerConnected: status.readerConnected
      };
      callback(status);
    });
  } else {
    console.error('RFID: onRfidConnectionStatus not available in electronAPI');
  }
}

// Legacy compatibility aliases
const runRFIDInit = initRfidService;
const readGivenTag = async (tag: string) => {
  // For specific tag reading, we read all and filter
  const result = await readAllTags();
  if (result.success && result.tags) {
    const matchingTag = result.tags.find((t: any) =>
      t.idd?.toUpperCase() === tag.toUpperCase() ||
      t.IDD?.toUpperCase() === tag.toUpperCase()
    );
    return matchingTag ? [matchingTag] : [];
  }
  return [];
};

export {
  // New API
  initRfidService,
  connectRfidReader,
  disconnectRfidReader,
  readAllTags,
  readTagsBrm,
  setRfidSecurity,
  activateSecurity,
  deactivateSecurity,
  getRfidReaderInfo,
  startContinuousScan,
  stopContinuousScan,
  rfidHealthCheck,
  getRfidConnectionStatus,
  onRfidTagRead,
  onRfidConnectionStatusChange,

  // Signals
  rfidItemId,
  rfidConnectionStatus,
  rfidTags,
  rfidReaderInfo,

  // Legacy compatibility
  runRFIDInit,
  readGivenTag
}
