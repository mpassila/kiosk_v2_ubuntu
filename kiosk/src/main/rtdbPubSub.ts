/**
 * Firebase Realtime Database Pub/Sub Module
 * Replaces Redis pub/sub with RTDB-based messaging
 */

import log from 'electron-log';
import { BrowserWindow } from 'electron';
import { getLockerStatus, openLockerDoor } from './lockerService';

interface RTDBSubscription {
  channel: string;
  unsubscribe: () => void;
}

const subscriptions: Map<string, RTDBSubscription> = new Map();
let mainWindow: BrowserWindow | null = null;
let databaseUrl: string | null = null;
let authToken: string | null = null;
let integrations: any = null;
let tokenRefreshTimer: NodeJS.Timeout | null = null;

// Track last known door status to detect changes
let lastKnownDoorStatus: { [doorNumber: string]: boolean } = {};

/**
 * Initialize the RTDB pub/sub module with database URL and main window
 */
export function initRTDBPubSub(dbUrl: string, window: BrowserWindow, token?: string) {
  databaseUrl = dbUrl;
  mainWindow = window;

  // Clear any existing token refresh timer
  if (tokenRefreshTimer) {
    clearInterval(tokenRefreshTimer);
    tokenRefreshTimer = null;
  }

  if (token) {
    authToken = token;
    log.info(`RTDB PubSub: Initialized with database URL and auth token (${token.substring(0, 20)}...)`);

    // Set up token refresh - Firebase tokens expire after 1 hour
    // Request a new token every 55 minutes to be safe
    tokenRefreshTimer = setInterval(() => {
      log.info('RTDB PubSub: Auth token refresh interval triggered - requesting new token from renderer');
      if (mainWindow) {
        mainWindow.webContents.send('rtdb-token-refresh-needed');
      }
    }, 55 * 60 * 1000); // 55 minutes

    log.info('RTDB PubSub: Token refresh mechanism initialized (will refresh every 55 minutes)');
  } else {
    authToken = null;
    log.warn(`RTDB PubSub: Initialized WITHOUT auth token - this may cause 401 errors!`);
    log.info(`RTDB PubSub: Database URL: ${dbUrl}`);
  }
}

/**
 * Update the auth token (called when token is refreshed)
 */
export function updateAuthToken(newToken: string) {
  if (!newToken) {
    log.warn('RTDB PubSub: Attempted to update with null/empty auth token');
    return;
  }

  authToken = newToken;
  log.info(`RTDB PubSub: Auth token updated (${newToken.substring(0, 20)}...)`);

  // Note: Existing RTDB connections will automatically use the new token on next request
  // because they reference the authToken variable
}

/**
 * Set integrations data for looking up IP addresses
 */
export function setIntegrations(integrationsData: any) {
  integrations = integrationsData;
  log.info(`RTDB PubSub: Integrations data set with ${Object.keys(integrationsData || {}).length} integrations`);
}

// Store deviceId for status updates
let currentDeviceId: string | null = null;

/**
 * Set the current device ID for status updates
 */
export function setDeviceId(deviceId: string) {
  currentDeviceId = deviceId;
  log.info(`RTDB PubSub: Device ID set to: ${deviceId}`);
}

/**
 * Update device.status in Firebase RTDB from locker status endpoint response
 * Transforms: { content: { lockers: [{number, locked, alarm, online}, ...] }, type: "status" }
 * Into: { "1": { doorNumber, isOpen, alarm, online, updatedAt }, ... }
 */
export async function updateDeviceStatusInRTDB(
  status: any,
  macId: string,
  licenseId: string
): Promise<void> {
  if (!databaseUrl || !authToken || !currentDeviceId) {
    log.warn('RTDB PubSub: Cannot update device status - missing databaseUrl, authToken, or deviceId');
    return;
  }

  if (!status?.content?.lockers || !Array.isArray(status.content.lockers)) {
    log.warn('RTDB PubSub: Invalid status format - missing content.lockers array');
    return;
  }

  try {
    const https = require('https');
    const now = new Date().toISOString();

    // Transform locker status array to keyed object format
    const deviceStatus: { [doorNumber: string]: any } = {};
    let hasChanges = false;

    for (const locker of status.content.lockers) {
      if (locker.number !== undefined) {
        const doorNum = String(locker.number);
        const isOpen = !locker.locked; // locked: false means isOpen: true

        // Check if this door's status has changed
        if (lastKnownDoorStatus[doorNum] !== isOpen) {
          hasChanges = true;
          log.info(`RTDB PubSub: Door ${doorNum} changed: isOpen=${isOpen}`);
        }

        // Update tracking
        lastKnownDoorStatus[doorNum] = isOpen;

        deviceStatus[doorNum] = {
          MAC: macId,
          doorNumber: locker.number,
          isOpen: isOpen,
          alarm: locker.alarm || false,
          online: locker.online !== undefined ? locker.online : true,
          updatedAt: now
        };
      }
    }

    if (Object.keys(deviceStatus).length === 0) {
      log.warn('RTDB PubSub: No valid doors found in status');
      return;
    }

    // Only update RTDB if there are changes
    if (!hasChanges) {
      return;
    }

    // Path: license_{licenseId}/devices/{deviceId}/status
    // Use PATCH to merge with existing data (preserves doors from other hardware)
    const statusPath = `license_${licenseId}/devices/${currentDeviceId}/status.json`;
    const url = `${databaseUrl}/${statusPath}?auth=${authToken}`;

    const statusData = JSON.stringify(deviceStatus);

    log.info(`RTDB PubSub: Updating device status with ${Object.keys(deviceStatus).length} doors from MAC: ${macId}`);

    return new Promise((resolve) => {
      const urlObj = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(statusData),
        },
      };

      const req = https.request(options, (response: any) => {
        if (response.statusCode === 200 || response.statusCode === 201) {
          log.info(`RTDB PubSub: [OK] Device status updated in RTDB`);
        } else {
          log.error(`RTDB PubSub: Failed to update device status, HTTP ${response.statusCode}`);
        }
        resolve();
      });

      req.on('error', (error: Error) => {
        log.error('RTDB PubSub: Error updating device status:', error);
        resolve();
      });

      req.write(statusData);
      req.end();
    });

  } catch (error) {
    log.error('RTDB PubSub: Error in updateDeviceStatusInRTDB:', error);
  }
}

/**
 * Find integration IP and MAC address by channel name.
 * If the channel matches an integration macId, returns that integration's IP and MAC.
 * Falls back to the first available integration when the channel is a device ID (not a MAC).
 */
function findIntegration(channel: string): { ip: string; mac: string } | null {
  if (!integrations) {
    log.warn(`RTDB PubSub: Integrations not loaded, cannot find integration for channel: ${channel}`);
    return null;
  }

  let fallback: { ip: string; mac: string } | null = null;

  // Search through integrations to find matching macId
  for (const [integrationType, integration] of Object.entries(integrations)) {
    if (integration && typeof integration === 'object') {
      const intIp = (integration as any).ip;
      const intMac = (integration as any).macId || (integration as any).mac;

      // Track first available integration as fallback
      if (!fallback && intIp && intMac) {
        fallback = { ip: intIp, mac: intMac };
      }

      // Check direct macId match
      if (intMac === channel && intIp) {
        log.info(`RTDB PubSub: Found integration for channel ${channel} in ${integrationType}: IP=${intIp}, MAC=${intMac}`);
        return { ip: intIp, mac: intMac };
      }

      // Check nested integrations
      for (const [key, value] of Object.entries(integration)) {
        if (value && typeof value === 'object') {
          const nestedIp = (value as any).ip;
          const nestedMac = (value as any).macId || (value as any).mac;

          if (!fallback && nestedIp && nestedMac) {
            fallback = { ip: nestedIp, mac: nestedMac };
          }
          if (nestedMac === channel && nestedIp) {
            log.info(`RTDB PubSub: Found integration for channel ${channel} in ${integrationType}.${key}: IP=${nestedIp}, MAC=${nestedMac}`);
            return { ip: nestedIp, mac: nestedMac };
          }
        }
      }
    }
  }

  // Fallback: channel is likely a device ID, not a MAC — use first available integration
  if (fallback) {
    log.info(`RTDB PubSub: No exact match for channel "${channel}" — using fallback: IP=${fallback.ip}, MAC=${fallback.mac}`);
    return fallback;
  }

  log.warn(`RTDB PubSub: No integration found for channel: ${channel}`);
  return null;
}

/**
 * Subscribe to a channel in RTDB using Server-Sent Events (real-time sync)
 * @param channel - The channel name to subscribe to
 * @param licenseId - The license ID (for constructing the path)
 */
// Track channels where we've already attempted to create init message
const initAttempted: Set<string> = new Set();

export async function subscribeRTDB(channel: string, licenseId: string): Promise<void> {
  if (!databaseUrl) {
    throw new Error('RTDB PubSub not initialized - database URL not set');
  }

  if (subscriptions.has(channel)) {
    log.info(`RTDB PubSub: Already subscribed to channel: ${channel}`);
    return;
  }

  log.info(`PUBSUB RTDB sub with ${databaseUrl}/pubsub/${channel}`);

  try {
    const https = require('https');
    const http = require('http');
    // URL-encode the channel name to handle spaces, commas, and special characters
    const encodedChannel = encodeURIComponent(channel);
    const basePath = `pubsub/${encodedChannel}.json`;

    log.info(`RTDB PubSub: Listening at: ${databaseUrl}/${basePath} (auth=${!!authToken})`);

    // Track processed message IDs to avoid duplicates
    const processedMessages = new Set<string>();

    let request: any = null;
    let reconnectTimer: any = null;
    let keepAliveTimer: any = null;

    // Keep-alive watchdog: Firebase SSE sends keep-alive every ~30s.
    // If we receive nothing for 90s, the connection is dead — force reconnect.
    const KEEPALIVE_TIMEOUT_MS = 90000;

    const resetKeepAliveTimer = () => {
      if (keepAliveTimer) clearTimeout(keepAliveTimer);
      keepAliveTimer = setTimeout(() => {
        log.warn(`RTDB PubSub: No data received for ${KEEPALIVE_TIMEOUT_MS / 1000}s on channel ${channel} — connection dead, forcing reconnect`);
        if (request) {
          try { request.destroy(); } catch (e) { /* ignore */ }
        }
        reconnectTimer = setTimeout(connect, 2000);
      }, KEEPALIVE_TIMEOUT_MS);
    };

    const connect = () => {
      // Clear pending reconnect timer to prevent cascading reconnects
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      // Destroy previous request if still alive (prevents duplicate listeners)
      if (request) {
        try { request.destroy(); } catch (e) { /* ignore */ }
        request = null;
      }
      if (keepAliveTimer) { clearTimeout(keepAliveTimer); keepAliveTimer = null; }

      // Rebuild URL each time using current authToken (token refreshes after expiry)
      let currentUrl = `${databaseUrl}/${basePath}`;
      if (authToken) {
        currentUrl += `?auth=${authToken}`;
      }
      const protocol = currentUrl.startsWith('https') ? https : http;
      const urlObj = new URL(currentUrl);
      log.info(`RTDB PubSub: Connecting to channel ${channel} (token=${authToken ? authToken.substring(0, 10) + '...' : 'none'})`);

      request = protocol.get({
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        headers: {
          'Accept': 'text/event-stream',
        },
      }, (response: any) => {
        if (response.statusCode !== 200) {
          // 404 - path doesn't exist yet, create it with an init message (only once)
          if (response.statusCode === 404) {
            if (!initAttempted.has(channel)) {
              log.info(`RTDB PubSub: Channel ${channel} doesn't exist yet (404) - creating with init message`);
              initAttempted.add(channel);

              // Publish init message to create the channel
              publishRTDB(channel, {
                type: 'INIT',
                data: {
                  message: 'Channel initialized',
                  createdBy: 'kiosk'
                }
              }, licenseId).then(() => {
                log.info(`RTDB PubSub: [OK] Init message published, channel ${channel} created`);
                // Retry connection after short delay
                reconnectTimer = setTimeout(connect, 2000);
              }).catch((err) => {
                log.error(`RTDB PubSub: Failed to create channel ${channel}:`, err);
                // Retry after 30 seconds
                reconnectTimer = setTimeout(connect, 30000);
              });
            } else {
              log.info(`RTDB PubSub: Channel ${channel} still 404 after init - retrying in 30 seconds`);
              reconnectTimer = setTimeout(connect, 30000);
            }
            return;
          }

          log.error(`RTDB PubSub: HTTP error! status: ${response.statusCode}`);

          // Special handling for 401 Unauthorized errors
          if (response.statusCode === 401) {
            log.error(`RTDB PubSub: 401 Unauthorized - auth token may be expired or invalid`);
            log.info(`RTDB PubSub: Requesting token refresh from renderer...`);

            // Request token refresh from renderer
            if (mainWindow) {
              mainWindow.webContents.send('rtdb-token-refresh-needed');
            }

            // Retry connection after 10 seconds to give time for token refresh
            reconnectTimer = setTimeout(connect, 10000);
          } else {
            // Other errors - retry after 5 seconds
            reconnectTimer = setTimeout(connect, 5000);
          }
          return;
        }

        log.info(`RTDB PubSub: [OK] Real-time connection established for channel: ${channel}`);

        // Start keep-alive watchdog now that connection is up
        resetKeepAliveTimer();

        let buffer = '';
        let initialDataReceived = false; // Only process messages after initial data

        response.on('data', async (chunk: Buffer) => {
          // Reset keep-alive watchdog on ANY data (including keep-alive events)
          resetKeepAliveTimer();

          const chunkStr = chunk.toString();
          buffer += chunkStr;

          // Log raw SSE data (truncated for readability)
          if (!chunkStr.trim().startsWith('event: keep-alive')) {
            log.info(`PUBSUB SSE raw chunk: ${chunkStr.substring(0, 200)}`);
          }

          // Process complete event messages
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || ''; // Keep incomplete message in buffer

          for (const eventBlock of lines) {
            // Parse event block - format is "event: type\ndata: json"
            const eventLines = eventBlock.split('\n');
            let eventType = '';
            let dataLine = '';

            for (const line of eventLines) {
              if (line.startsWith('event: ')) {
                eventType = line.substring(7).trim();
              } else if (line.startsWith('data: ')) {
                dataLine = line.substring(6);
              }
            }

            // Skip keep-alive and null data silently
            if (eventType === 'keep-alive' || dataLine === 'null' || !dataLine) {
              continue;
            }

            log.info(`PUBSUB SSE event: ${eventType}, data: ${dataLine.substring(0, 200)}`);

            if (dataLine) {
              try {
                const data = JSON.parse(dataLine);

                // Initial data (path = "/") - mark as received but don't process
                if (data.path === '/') {
                  initialDataReceived = true;
                  log.info(`PUBSUB SSE subscription ready for channel: ${channel}`);
                  continue;
                }

                // Only process new messages AFTER initial data is received
                if (!initialDataReceived) {
                  log.info(`PUBSUB SSE skipping — initial data not yet received`);
                  continue;
                }

                // New child message after subscription
                if (data.path && data.data) {
                  const messageId = data.path.substring(1); // Remove leading '/'
                  const message = data.data;

                  // Skip INIT messages silently
                  if (message?.type === 'INIT') {
                    continue;
                  }

                  log.info(`PUBSUB [MSG] ${channel}: ${messageId} type=${message.type}`);
                  log.info(`PUBSUB [MSG] content: ${JSON.stringify(message)}`);
                  await processMessage(channel, message);
                } else {
                  log.info(`PUBSUB SSE skipping — no path/data in parsed event`);
                }
              } catch (parseError) {
                log.error(`PUBSUB SSE parse error:`, parseError);
              }
            }
          }
        });

        response.on('end', () => {
          log.warn(`RTDB PubSub: Connection closed for channel ${channel}, reconnecting...`);
          if (keepAliveTimer) { clearTimeout(keepAliveTimer); keepAliveTimer = null; }
          reconnectTimer = setTimeout(connect, 2000);
        });

        response.on('error', (error: Error) => {
          log.error(`RTDB PubSub: Response error for channel ${channel}:`, error);
          if (keepAliveTimer) { clearTimeout(keepAliveTimer); keepAliveTimer = null; }
          reconnectTimer = setTimeout(connect, 5000);
        });
      });

      request.on('error', (error: Error) => {
        log.error(`RTDB PubSub: Request error for channel ${channel}:`, error);
        if (keepAliveTimer) { clearTimeout(keepAliveTimer); keepAliveTimer = null; }
        reconnectTimer = setTimeout(connect, 5000);
      });
    };

    // Initial connection
    connect();

    subscriptions.set(channel, {
      channel,
      unsubscribe: () => {
        if (request) {
          request.destroy();
        }
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
        }
        if (keepAliveTimer) {
          clearTimeout(keepAliveTimer);
        }
        log.info(`RTDB PubSub: Unsubscribed from channel: ${channel}`);
      },
    });

    log.info(`RTDB PubSub: Successfully initiated real-time subscription for channel: ${channel}`);
  } catch (error) {
    log.error(`RTDB PubSub: Error subscribing to channel ${channel}:`, error);
    throw error;
  }
}

/**
 * Fetch messages from RTDB
 */
async function fetchMessages(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const https = require('https');

    https.get(url, (response: any) => {
      if (response.statusCode !== 200) {
        if (response.statusCode === 404) {
          resolve({}); // No messages yet
          return;
        }
        reject(new Error(`HTTP error! status: ${response.statusCode}`));
        return;
      }

      let data = '';
      response.on('data', (chunk: any) => {
        data += chunk;
      });

      response.on('end', () => {
        try {
          const messages = JSON.parse(data);
          resolve(messages || {});
        } catch (parseError) {
          reject(parseError);
        }
      });

      response.on('error', (error: Error) => {
        reject(error);
      });
    }).on('error', (error: Error) => {
      reject(error);
    });
  });
}

/**
 * Delete a message from RTDB after processing
 */
async function deleteMessage(baseUrl: string, messageId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const https = require('https');
    let url = `${baseUrl.replace('.json', '')}/${messageId}.json`;

    // Add auth token if available
    if (authToken) {
      url += `?auth=${authToken}`;
    }

    log.info(`RTDB PubSub: Deleting message ${messageId}`);

    const urlObj = new URL(url);

    // Use PUT with null to delete (more reliable than DELETE)
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': 4, // "null"
      },
    };

    const req = https.request(options, (response: any) => {
      if (response.statusCode === 200 || response.statusCode === 204) {
        log.info(`RTDB PubSub: Message ${messageId} deleted successfully`);
        resolve();
      } else {
        if (response.statusCode === 401) {
          log.error(`RTDB PubSub: DELETE failed with 401 - auth token may be expired`);
          if (mainWindow) {
            mainWindow.webContents.send('rtdb-token-refresh-needed');
          }
        }
        log.warn(`RTDB PubSub: Failed to delete message ${messageId}, status: ${response.statusCode}`);
        // Don't reject - just log and resolve to avoid breaking the flow
        resolve();
      }
    });

    req.on('error', (error: Error) => {
      log.error(`RTDB PubSub: Error deleting message ${messageId}:`, error);
      // Don't reject - just log and resolve to avoid breaking the flow
      resolve();
    });

    req.write('null');
    req.end();
  });
}

/**
 * Process a message received from RTDB
 */
async function processMessage(channel: string, message: any) {
  if (!mainWindow) {
    log.warn('RTDB PubSub: Main window not set, cannot send message');
    return;
  }

  log.info(`RTDB PubSub: Processing message from channel ${channel}:`, message);

  // Forward COMMAND-FOR-CLIENT messages to renderer via IPC
  // But intercept RUNCMD — shell commands must run in main process, not renderer
  if (message.type === 'COMMAND-FOR-CLIENT') {
    const clientCommand = message.data?.command || message.data?.COMMAND;

    if (clientCommand === 'RUNCMD' && message.data?.cmd) {
      const cmdString = message.data.cmd;
      log.info(`RTDB PubSub: COMMAND-FOR-CLIENT/RUNCMD — executing in main: ${cmdString}`);

      const { exec } = require('child_process');
      exec(cmdString, { shell: true }, async (error: any, stdout: string, stderr: string) => {
        const result = {
          success: !error,
          stdout: stdout || '',
          stderr: stderr || '',
          error: error ? error.message : null,
          cmd: cmdString
        };

        log.info(`RTDB PubSub: RUNCMD result:`, result);

        // Publish result back to channel
        await publishRTDB(channel, {
          type: 'CMD_RESPONSE',
          data: {
            ...result,
            timestamp: Date.now(),
            channel: channel
          }
        }, message.licenseId || '2');

        // Also notify renderer
        mainWindow?.webContents.send('redis-kiosk-listener', JSON.stringify({
          data: result,
          channel: channel,
          type: 'CMD_RESPONSE',
        }));
      });
      return;
    }

    // Handle OPENDOOR directly in main process — just call the locker HTTP endpoint
    if (clientCommand === 'OPENDOOR' && message.data?.door) {
      const doorNumber = message.data.door;
      log.info(`RTDB PubSub: COMMAND-FOR-CLIENT/OPENDOOR — opening door ${doorNumber} from main`);

      // Get locker IP from integrations (first one with an IP)
      let lockerIp = 'localhost';
      if (integrations) {
        for (const [, integ] of Object.entries(integrations)) {
          if (integ && typeof integ === 'object') {
            const ip = (integ as any).ip;
            if (ip && ip !== 'localhost') {
              lockerIp = ip;
              break;
            }
            // Check nested
            for (const [, nested] of Object.entries(integ as any)) {
              if (nested && typeof nested === 'object' && (nested as any).ip && (nested as any).ip !== 'localhost') {
                lockerIp = (nested as any).ip;
                break;
              }
            }
            if (lockerIp !== 'localhost') break;
          }
        }
      }

      // Strip protocol prefix if present
      lockerIp = lockerIp.replace(/^https?:\/\//, '');
      log.info(`RTDB PubSub: OPENDOOR using IP=${lockerIp} for door ${doorNumber}`);

      try {
        const http = require('http');
        const url = `http://${lockerIp}:5003/data/dooropen?door=${doorNumber}&company=1`;
        const urlObj = new URL(url);
        log.info(`RTDB PubSub: OPENDOOR POST ${url}`);

        const req = http.request({
          hostname: urlObj.hostname,
          port: urlObj.port,
          path: urlObj.pathname + urlObj.search,
          method: 'POST',
        }, (res: any) => {
          let data = '';
          res.on('data', (chunk: any) => { data += chunk; });
          res.on('end', () => {
            log.info(`RTDB PubSub: OPENDOOR response for door ${doorNumber}: ${data}`);
          });
        });
        req.on('error', (err: any) => {
          log.error(`RTDB PubSub: OPENDOOR HTTP error for door ${doorNumber}:`, err.message);
        });
        req.end();
      } catch (error) {
        log.error(`RTDB PubSub: OPENDOOR error:`, error);
      }

      // Also forward to renderer for UI feedback
      mainWindow.webContents.send('rtdb-client-command', JSON.stringify(message));
      return;
    }

    // Handle DOORSTATUS directly in main process
    if (clientCommand === 'DOORSTATUS') {
      log.info(`RTDB PubSub: COMMAND-FOR-CLIENT/DOORSTATUS — handling in main`);

      let lockerIp = 'localhost';
      if (integrations) {
        for (const [, integ] of Object.entries(integrations)) {
          if (integ && typeof integ === 'object') {
            const ip = (integ as any).ip;
            if (ip && ip !== 'localhost') {
              lockerIp = ip;
              break;
            }
          }
        }
      }

      // Strip protocol prefix if present
      lockerIp = lockerIp.replace(/^https?:\/\//, '');
      try {
        const http = require('http');
        const url = `http://${lockerIp}:5003/data/doorstatus`;
        log.info(`RTDB PubSub: DOORSTATUS calling ${url}`);

        http.get(url, (res: any) => {
          let data = '';
          res.on('data', (chunk: any) => { data += chunk; });
          res.on('end', () => {
            log.info(`RTDB PubSub: DOORSTATUS response: ${data}`);
            mainWindow?.webContents.send('redis-kiosk-listener', JSON.stringify({
              data: { status: data, command: 'DOORSTATUS' },
              channel: channel,
              type: 'DOORSTATUS_RESPONSE',
            }));
          });
        }).on('error', (err: any) => {
          log.error(`RTDB PubSub: DOORSTATUS HTTP error:`, err.message);
        });
      } catch (error) {
        log.error(`RTDB PubSub: DOORSTATUS error:`, error);
      }
      return;
    }

    // Forward remaining COMMAND-FOR-CLIENT messages to renderer
    log.info(`RTDB PubSub: Forwarding COMMAND-FOR-CLIENT (${clientCommand}) to renderer`);
    mainWindow.webContents.send('rtdb-client-command', JSON.stringify(message));
    return;
  }

  // Handle type: 'CMD' — direct command execution from sideevent
  // Format: { type: 'CMD', data: { command: 'cd \\SideEvents && dir' } }
  if (message.type === 'CMD' && message.data?.command) {
    const cmdString = message.data.command;
    log.info(`PUBSUB CMD received: ${cmdString}`);

    const { exec } = require('child_process');
    exec(cmdString, { shell: true }, async (error: any, stdout: string, stderr: string) => {
      const result = {
        success: !error,
        stdout: stdout || '',
        stderr: stderr || '',
        error: error ? error.message : null,
        cmd: cmdString
      };

      log.info(`PUBSUB CMD result:`, result);

      await publishRTDB(channel, {
        type: 'CMD_RESPONSE',
        data: {
          ...result,
          timestamp: Date.now(),
          channel: channel
        }
      }, message.licenseId || '2');

      log.info(`PUBSUB CMD_RESPONSE published to channel: ${channel}`);

      mainWindow?.webContents.send('redis-kiosk-listener', JSON.stringify({
        data: result,
        channel: channel,
        type: 'CMD_RESPONSE',
      }));
    });
    return;
  }

  // Check if this is a hardware command message (handled by main process)
  // COMMAND-FOR-HW: Hardware commands (DOORSTATUS, OPENDOOR)
  // COMMAND-FOR-HW-CMD: Hardware CMD commands
  // Support both COMMAND (uppercase) and command (lowercase) for flexibility
  const commandValue = message.data?.COMMAND || message.data?.command;

  if ((message.type === 'COMMAND-FOR-HW' || message.type === 'COMMAND-FOR-HW-CMD') && message.data && commandValue) {
    const command = commandValue;
    log.info(`RTDB PubSub: Received command: ${command} on channel: ${channel}`);

    try {
      // Handle DOORSTATUS command
      if (command === 'DOORSTATUS') {
        log.info(`RTDB PubSub: Processing DOORSTATUS command for channel: ${channel}`);

        // Find the integration (IP + MAC) for this channel
        const integration = findIntegration(channel);

        if (!integration) {
          throw new Error(`No integration found for channel: ${channel}`);
        }

        log.info(`RTDB PubSub: Using IP=${integration.ip}, MAC=${integration.mac} for channel ${channel}`);

        // Call locker utility to get status
        const status = await getLockerStatus(integration.mac, integration.ip);

        log.info(`RTDB PubSub: Got locker status for ${channel}:`, status);

        // Update device.status in RTDB with the locker status (use actual MAC, not channel)
        await updateDeviceStatusInRTDB(status, integration.mac, message.licenseId || '2');

        // Publish the status back to the channel
        await publishRTDB(channel, {
          type: 'DOORSTATUS_RESPONSE',
          data: {
            status: status,
            timestamp: Date.now(),
            channel: channel
          }
        }, message.licenseId || '2');

        log.info(`RTDB PubSub: [OK] Published DOORSTATUS_RESPONSE to channel: ${channel}`);

        // Also send to renderer for UI updates
        mainWindow.webContents.send('redis-kiosk-listener', JSON.stringify({
          data: { status: status, command: 'DOORSTATUS' },
          channel: channel,
          type: 'DOORSTATUS_RESPONSE',
        }));
      }
      // Handle OPENDOOR command
      else if (command === 'OPENDOOR' && message.data.doorNumber) {
        const doorNumber = message.data.doorNumber;
        log.info(`RTDB PubSub: Processing OPENDOOR command for door ${doorNumber} on channel: ${channel}`);

        // Find the integration (IP + MAC) for this channel
        const integration = findIntegration(channel);

        if (!integration) {
          throw new Error(`No integration found for channel: ${channel}`);
        }

        log.info(`RTDB PubSub: Using IP=${integration.ip}, MAC=${integration.mac} for channel ${channel}`);

        const result = await openLockerDoor(doorNumber, integration.mac, integration.ip);

        log.info(`RTDB PubSub: Door ${doorNumber} opened on ${channel}:`, result);

        // Update device.status in RTDB with the locker status (use actual MAC, not channel)
        if (result.status) {
          await updateDeviceStatusInRTDB(result.status, integration.mac, message.licenseId || '2');
        }

        // Publish the result back
        await publishRTDB(channel, {
          type: 'OPENDOOR_RESPONSE',
          data: {
            result: result,
            doorNumber: doorNumber,
            timestamp: Date.now(),
            channel: channel
          }
        }, message.licenseId || '2');

        log.info(`RTDB PubSub: [OK] Published OPENDOOR_RESPONSE to channel: ${channel}`);

        // Send to renderer
        mainWindow.webContents.send('redis-kiosk-listener', JSON.stringify({
          data: { result: result, command: 'OPENDOOR', doorNumber: doorNumber },
          channel: channel,
          type: 'OPENDOOR_RESPONSE',
        }));
      }
      // Handle CMD command (execute terminal/shell commands)
      // Supports: { type: 'CMD', data: { command: 'dir' } }
      //           { type: 'COMMAND-FOR-HW-CMD', data: { COMMAND: 'CMD', cmd: 'dir' } }
      //           { type: 'COMMAND-FOR-HW-CMD', data: { COMMAND: 'dir' } }
      else if (command === 'CMD' && message.data.cmd || message.type === 'CMD' || (message.type === 'COMMAND-FOR-HW-CMD' && command !== 'DOORSTATUS' && command !== 'OPENDOOR')) {
        const cmdString = message.data.cmd || command;
        log.info(`RTDB PubSub: Processing CMD command on channel ${channel}: ${cmdString}`);

        const { exec } = require('child_process');

        exec(cmdString, { shell: true }, async (error: any, stdout: string, stderr: string) => {
          const result = {
            success: !error,
            stdout: stdout || '',
            stderr: stderr || '',
            error: error ? error.message : null,
            cmd: cmdString
          };

          log.info(`RTDB PubSub: CMD execution result:`, result);

          // Publish the result back
          await publishRTDB(channel, {
            type: 'CMD_RESPONSE',
            data: {
              ...result,
              timestamp: Date.now(),
              channel: channel
            }
          }, message.licenseId || '2');

          log.info(`RTDB PubSub: [OK] Published CMD_RESPONSE to channel: ${channel}`);

          // Send to renderer
          mainWindow?.webContents.send('redis-kiosk-listener', JSON.stringify({
            data: result,
            channel: channel,
            type: 'CMD_RESPONSE',
          }));
        });
      }
      else {
        log.warn(`RTDB PubSub: Unknown command: ${command}`);
      }
    } catch (error) {
      log.error(`RTDB PubSub: Error processing command ${command}:`, error);

      // Send error response
      mainWindow.webContents.send('redis-kiosk-listener', JSON.stringify({
        data: { error: String(error), command: command },
        channel: channel,
        type: 'COMMAND_ERROR',
      }));
    }
  } else {
    // Regular message - send to renderer process using the same format as Redis
    mainWindow.webContents.send('redis-kiosk-listener', JSON.stringify({
      data: message.data || message,
      channel: channel,
      type: message.type || 'KIOSK',
    }));
  }
}

/**
 * Publish a message to a channel in RTDB
 * @param channel - The channel name to publish to
 * @param message - The message to publish
 * @param licenseId - The license ID (for constructing the path)
 */
export async function publishRTDB(channel: string, message: any, licenseId: string): Promise<void> {
  if (!databaseUrl) {
    throw new Error('RTDB PubSub not initialized - database URL not set');
  }

  log.info(`RTDB PubSub: Publishing to channel: ${channel}`);
  log.info(`RTDB PubSub: Message type: ${message.type}`);

  try {
    const https = require('https');
    // URL-encode the channel name to handle spaces, commas, and special characters
    const encodedChannel = encodeURIComponent(channel);
    const path = `pubsub/${encodedChannel}.json`;
    let url = `${databaseUrl}/${path}`;

    // Add auth token if available
    if (authToken) {
      url += `?auth=${authToken}`;
    }

    const messageWithTimestamp = {
      ...message,
      timestamp: Date.now(),
    };

    const postData = JSON.stringify(messageWithTimestamp);

    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      };

      const req = https.request(options, (response: any) => {
        if (response.statusCode !== 200 && response.statusCode !== 201) {
          if (response.statusCode === 401) {
            log.error(`RTDB PubSub: PUBLISH failed with 401 - auth token may be expired`);
            if (mainWindow) {
              mainWindow.webContents.send('rtdb-token-refresh-needed');
            }
          }
          reject(new Error(`HTTP error! status: ${response.statusCode}`));
          return;
        }

        let data = '';
        response.on('data', (chunk: any) => {
          data += chunk;
        });

        response.on('end', () => {
          log.info(`RTDB PubSub: Message published successfully to channel: ${channel}`);
          resolve();
        });

        response.on('error', (error: Error) => {
          reject(error);
        });
      });

      req.on('error', (error: Error) => {
        reject(error);
      });

      req.write(postData);
      req.end();
    });
  } catch (error) {
    log.error(`RTDB PubSub: Error publishing to channel ${channel}:`, error);
    throw error;
  }
}

/**
 * Unsubscribe from a channel
 */
export function unsubscribeRTDB(channel: string): void {
  const subscription = subscriptions.get(channel);
  if (subscription) {
    subscription.unsubscribe();
    subscriptions.delete(channel);
    log.info(`RTDB PubSub: Unsubscribed from channel: ${channel}`);
  } else {
    log.warn(`RTDB PubSub: No subscription found for channel: ${channel}`);
  }
}

/**
 * Unsubscribe from all channels
 */
export function unsubscribeAll(): void {
  for (const [channel, subscription] of subscriptions.entries()) {
    subscription.unsubscribe();
  }
  subscriptions.clear();
  log.info('RTDB PubSub: Unsubscribed from all channels');
}
