/**
 * RFID Service - WebSocket client for RFID pad communication
 * Connects to Python RFID WebSocket server on ws://localhost:8765
 * Follows same pattern as barcode scanner for main process to renderer communication
 */

import WebSocket from 'ws';
import { BrowserWindow } from 'electron';

// RFID WebSocket server URL
const RFID_WS_URL = 'ws://localhost:8765';

// Connection state
let wsConnection: WebSocket | null = null;
let isConnected = false;
let isReaderConnected = false;
let reconnectTimer: NodeJS.Timeout | null = null;
let mainWindow: BrowserWindow | null = null;

// Pending request - only one at a time (simple queue)
let pendingRequest: {
  command: string;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timeout: NodeJS.Timeout
} | null = null;

/**
 * Set the main window reference for IPC communication
 */
export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window;
}

/**
 * Initialize RFID WebSocket connection
 */
export function initRfidService(): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve) => {
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
      console.log('RFID: Already connected to WebSocket server');
      resolve({ success: true, message: 'Already connected' });
      return;
    }

    console.log(`RFID: Connecting to WebSocket server at ${RFID_WS_URL}`);

    try {
      wsConnection = new WebSocket(RFID_WS_URL);

      wsConnection.on('open', () => {
        console.log('RFID: WebSocket connected to RFID server');
        isConnected = true;

        // Clear any reconnect timer
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }

        // Notify renderer that RFID service is available
        mainWindow?.webContents.send('rfid-connection-status', { connected: true, readerConnected: false });

        resolve({ success: true, message: 'Connected to RFID WebSocket server' });
      });

      wsConnection.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString());
          handleRfidMessage(message);
        } catch (error) {
          console.error('RFID: Error parsing message:', error);
        }
      });

      wsConnection.on('close', () => {
        console.log('RFID: WebSocket connection closed');
        isConnected = false;
        isReaderConnected = false;
        wsConnection = null;

        // Reject pending request if any
        if (pendingRequest) {
          clearTimeout(pendingRequest.timeout);
          pendingRequest.reject(new Error('WebSocket closed'));
          pendingRequest = null;
        }

        // Notify renderer
        mainWindow?.webContents.send('rfid-connection-status', { connected: false, readerConnected: false });

        // Schedule reconnect
        scheduleReconnect();
      });

      wsConnection.on('error', (error) => {
        console.error('RFID: WebSocket error:', error.message);
        isConnected = false;

        // Reject pending request
        if (pendingRequest) {
          clearTimeout(pendingRequest.timeout);
          pendingRequest.reject(new Error('WebSocket error'));
          pendingRequest = null;
        }

        resolve({ success: false, message: `WebSocket error: ${error.message}` });
      });

      // Timeout for initial connection
      setTimeout(() => {
        if (!isConnected) {
          console.log('RFID: Connection timeout');
          if (wsConnection) {
            wsConnection.close();
            wsConnection = null;
          }
          resolve({ success: false, message: 'Connection timeout - RFID server may not be running' });
        }
      }, 5000);

    } catch (error: any) {
      console.error('RFID: Error creating WebSocket:', error);
      resolve({ success: false, message: `Error: ${error.message}` });
    }
  });
}

/**
 * Schedule reconnection attempt — only retry once, then wait for next app startup
 */
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 1;

function scheduleReconnect(): void {
  if (reconnectTimer) return;

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.log('RFID: Max reconnect attempts reached — will retry on next startup');
    return;
  }

  reconnectAttempts++;
  console.log(`RFID: Scheduling reconnect attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in 60 seconds...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    initRfidService().catch(console.error);
  }, 60000);
}

/**
 * Handle incoming RFID messages
 */
function handleRfidMessage(message: any): void {
  const command = message.command;

  console.log('RFID: Received message:', JSON.stringify(message).substring(0, 200));

  // If we have a pending request and this looks like a response to it, resolve it
  if (pendingRequest) {
    // Check if this response matches the pending command
    const isMatchingResponse =
      (pendingRequest.command === 'connect' && command === 'connect') ||
      (pendingRequest.command === 'disconnect' && command === 'disconnect') ||
      (pendingRequest.command === 'read_tags' && (command === 'read_tags' || message.tags !== undefined)) ||
      (pendingRequest.command === 'read_brm' && (command === 'read_brm' || command === 'brm_update')) ||
      (pendingRequest.command === 'set_security' && command === 'set_security') ||
      (pendingRequest.command === 'get_info' && command === 'get_info') ||
      (pendingRequest.command === 'health' && command === 'health');

    if (isMatchingResponse) {
      clearTimeout(pendingRequest.timeout);
      const req = pendingRequest;
      pendingRequest = null;
      req.resolve(message);

      // Update connection state for connect/disconnect
      if (command === 'connect' && message.success) {
        isReaderConnected = true;
      } else if (command === 'disconnect' && message.success) {
        isReaderConnected = false;
      }
      return;
    }
  }

  // Handle broadcast/unsolicited messages
  switch (command) {
    case 'tag_update':
    case 'brm_update':
      // Forward tag data to renderer
      if (message.tags && message.tags.length > 0) {
        console.log(`RFID: Broadcasting ${message.tags.length} tag(s) to renderer`);
        mainWindow?.webContents.send('rfid-tag-read', message);
      }
      break;

    case 'connect':
      if (message.success) {
        isReaderConnected = true;
        mainWindow?.webContents.send('rfid-connection-status', {
          connected: true,
          readerConnected: true,
          readerType: message.readerType
        });
      }
      break;

    case 'disconnect':
      if (message.success) {
        isReaderConnected = false;
        mainWindow?.webContents.send('rfid-connection-status', { connected: true, readerConnected: false });
      }
      break;

    default:
      // Forward other messages to renderer if needed
      mainWindow?.webContents.send('rfid-message', message);
      break;
  }
}

/**
 * Send command to RFID server and wait for response
 */
export function sendRfidCommand(command: string, params: Record<string, any> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
      reject(new Error('RFID WebSocket not connected'));
      return;
    }

    // If there's already a pending request, reject it
    if (pendingRequest) {
      clearTimeout(pendingRequest.timeout);
      pendingRequest.reject(new Error('New request superseded pending request'));
    }

    // Create message
    const message = {
      command,
      ...params
    };

    // Set timeout for response
    const timeout = setTimeout(() => {
      if (pendingRequest && pendingRequest.command === command) {
        pendingRequest = null;
        reject(new Error(`RFID command timeout: ${command}`));
      }
    }, 10000); // 10 second timeout

    // Store pending request
    pendingRequest = { command, resolve, reject, timeout };

    // Send message
    console.log(`RFID: Sending command: ${command}`, JSON.stringify(params));
    wsConnection.send(JSON.stringify(message));
  });
}

/**
 * Connect to RFID reader
 */
export async function connectRfidReader(): Promise<any> {
  return sendRfidCommand('connect');
}

/**
 * Disconnect from RFID reader
 */
export async function disconnectRfidReader(): Promise<any> {
  return sendRfidCommand('disconnect');
}

/**
 * Read all RFID tags
 */
export async function readRfidTags(): Promise<any> {
  return sendRfidCommand('read_tags');
}

/**
 * Read tags using Buffer Read Mode (for BLE/TCP modes)
 */
export async function readRfidTagsBrm(readTime: number = 2000): Promise<any> {
  return sendRfidCommand('read_brm', { readTime });
}

/**
 * Set security (AFI) on tags
 */
export async function setRfidSecurity(security: boolean, tagId?: string): Promise<any> {
  return sendRfidCommand('set_security', { security, tagId });
}

/**
 * Get RFID reader info
 */
export async function getRfidReaderInfo(): Promise<any> {
  return sendRfidCommand('get_info');
}

/**
 * Start continuous tag scanning
 */
export async function startContinuousScan(interval: number = 1): Promise<any> {
  return sendRfidCommand('start_continuous', { interval });
}

/**
 * Stop continuous tag scanning
 */
export async function stopContinuousScan(): Promise<any> {
  return sendRfidCommand('stop_continuous');
}

/**
 * Health check
 */
export async function rfidHealthCheck(): Promise<any> {
  return sendRfidCommand('health');
}

/**
 * Get connection status
 */
export function getRfidConnectionStatus(): { wsConnected: boolean; readerConnected: boolean } {
  return {
    wsConnected: isConnected,
    readerConnected: isReaderConnected
  };
}

/**
 * Cleanup RFID service
 */
export function cleanupRfidService(): void {
  console.log('RFID: Cleaning up service');

  // Clear reconnect timer
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  // Clear pending request
  if (pendingRequest) {
    clearTimeout(pendingRequest.timeout);
    pendingRequest.reject(new Error('Service cleanup'));
    pendingRequest = null;
  }

  // Close WebSocket
  if (wsConnection) {
    wsConnection.close();
    wsConnection = null;
  }

  isConnected = false;
  isReaderConnected = false;
}
