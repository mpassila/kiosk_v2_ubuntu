/**
 * Locker Service Module
 * Handles communication with locker hardware via HTTP API
 */

import log from 'electron-log';
import * as fs from 'fs';

const LOCKER_URL = 'http://localhost:3001';
const LOCAL_CONFIG_PATH = 'C:\\SideEvents\\localConfig.json';

function readDelayOnIsDoorOpen(): number {
  try {
    if (fs.existsSync(LOCAL_CONFIG_PATH)) {
      const cfg = JSON.parse(fs.readFileSync(LOCAL_CONFIG_PATH, 'utf8'));
      if (typeof cfg.delayOnIsDoorOpen === 'number') return cfg.delayOnIsDoorOpen;
    }
  } catch (e) { /* ignore */ }
  return 1400;
}

/**
 * Get the current status of all doors for a specific locker
 * @param mac - MAC address of the locker device
 * @param ip - IP address of the locker device (required for direct device access)
 * @returns Promise with locker status data
 */
export async function getLockerStatus(mac: string, ip?: string): Promise<any> {
  try {
    // Strip protocol prefix if present (e.g. "http://192.168.11.2" → "192.168.11.2")
    const cleanIp = ip ? ip.replace(/^https?:\/\//, '') : undefined;
    log.info(`LOCKER: Getting status for MAC: ${mac}, IP: ${cleanIp || 'not provided'}`);

    const https = require('https');
    const http = require('http');

    // If IP is provided, use direct device endpoint
    // Otherwise fall back to service endpoint
    let url: string;
    if (cleanIp) {
      url = `http://${cleanIp}:5003/data/status`;
      log.info(`LOCKER: Using direct device endpoint: ${url}`);
    } else {
      // Fallback to old service endpoint
      url = `${LOCKER_URL}/ci/locker/${mac}`;
      log.info(`LOCKER: Using service endpoint: ${url}`);
    }

    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;

      // Set a timeout for the request (3 seconds — short enough to not block polling)
      const timeoutMs = 3000;
      let timeoutId: NodeJS.Timeout;

      const req = protocol.get(url, (response: any) => {
        clearTimeout(timeoutId);

        console.log(`LOCKER: Response status code: ${response.statusCode}`);
        log.info(`LOCKER: Response status code: ${response.statusCode}`);

        if (response.statusCode !== 200) {
          console.log(`LOCKER: HTTP error! status: ${response.statusCode}`);
          log.error(`LOCKER: HTTP error! status: ${response.statusCode}`);
          reject(new Error(`HTTP error! status: ${response.statusCode}`));
          return;
        }

        let data = '';

        response.on('data', (chunk: any) => {
          data += chunk;
        });

        response.on('end', () => {
          try {
            console.log(`LOCKER: Raw response data: ${data.substring(0, 500)}`);
            log.info(`LOCKER: Raw response data: ${data.substring(0, 500)}`);
            const result = JSON.parse(data);
            console.log(`LOCKER: Status retrieved successfully, type: ${result?.type}, lockers: ${result?.content?.lockers?.length || 0}`);
            log.info(`LOCKER: Status retrieved successfully, type: ${result?.type}, lockers: ${result?.content?.lockers?.length || 0}`);
            resolve(result);
          } catch (parseError) {
            console.log('LOCKER: Error parsing response:', parseError);
            console.log('LOCKER: Raw data was:', data);
            log.error('LOCKER: Error parsing response:', parseError);
            log.error('LOCKER: Raw data was:', data);
            reject(parseError);
          }
        });

        response.on('error', (error: Error) => {
          log.error(`LOCKER: Error getting status:`, error);
          reject(error);
        });
      });

      req.on('error', (error: Error) => {
        clearTimeout(timeoutId);
        console.log(`LOCKER: Request error:`, error.message);
        log.error(`LOCKER: Request error:`, error);
        reject(error);
      });

      // Set timeout
      timeoutId = setTimeout(() => {
        req.destroy();
        console.log(`LOCKER: Request timeout after ${timeoutMs}ms for URL: ${url}`);
        log.error(`LOCKER: Request timeout after ${timeoutMs}ms for URL: ${url}`);
        reject(new Error(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      console.log(`LOCKER: Request sent, waiting for response...`);
    });
  } catch (error: any) {
    log.error(`LOCKER: Error in getLockerStatus:`, error);
    throw error;
  }
}

/**
 * Open a specific door and return the new status
 * @param doorNumber - The door number to open
 * @param mac - MAC address of the locker device
 * @param ip - IP address of the locker device (required for direct device access)
 * @returns Promise with the result including new status
 */
export async function openLockerDoor(doorNumber: number, mac: string, ip?: string): Promise<any> {
  try {
    // Strip protocol prefix if present
    const cleanIp = ip ? ip.replace(/^https?:\/\//, '') : undefined;
    log.info(`LOCKER: Opening door ${doorNumber} for MAC: ${mac}, IP: ${cleanIp || 'not provided'}`);

    const https = require('https');
    const http = require('http');

    // If IP is provided, use direct device endpoint
    // Otherwise fall back to service endpoint
    let url: string;
    if (cleanIp) {
      // Use the correct endpoint: /data/dooropen with query parameters
      url = `http://${cleanIp}:5003/data/dooropen?door=${doorNumber}`;
      log.info(`LOCKER: Using direct device endpoint: ${url}`);
    } else {
      // Fallback to old service endpoint with POST
      url = `${LOCKER_URL}/ci/locker/${mac}`;
      log.info(`LOCKER: Using service endpoint: ${url}`);
    }

    const MAX_RETRIES = 2;
    const OPEN_TIMEOUT_MS = 2000;

    const attemptOpen = (attempt: number): Promise<any> => {
      return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        let settled = false;

        // Hard wall-clock timeout — fires regardless of socket activity
        const hardTimeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          log.error(`LOCKER: openLockerDoor timed out after ${OPEN_TIMEOUT_MS}ms (attempt ${attempt}/${MAX_RETRIES})`);
          if (req) try { req.destroy(); } catch (e) { /* ignore */ }
          reject(new Error(`Open door request timed out after ${OPEN_TIMEOUT_MS}ms`));
        }, OPEN_TIMEOUT_MS);

        const done = (fn: typeof resolve, val: any) => {
          if (settled) return;
          settled = true;
          clearTimeout(hardTimeout);
          fn(val);
        };

        if (ip) {
          // For direct device endpoint, use GET request (matching hardware API)
          var req = protocol.get(url, (response: any) => {
            if (response.statusCode !== 200 && response.statusCode !== 201) {
              log.error(`LOCKER: HTTP error! status: ${response.statusCode}`);
              done(reject, new Error(`HTTP error! status: ${response.statusCode}`));
              return;
            }

            let data = '';

            response.on('data', (chunk: any) => {
              data += chunk;
            });

            response.on('end', () => {
              const openResult = data ? (() => { try { return JSON.parse(data); } catch(e) { return { raw: data }; } })() : { success: true };
              log.info(`LOCKER: Door ${doorNumber} opened successfully`);
              // Resolve immediately — DoorStatusWatcher handles status polling
              done(resolve, {
                success: true,
                doorNumber: doorNumber,
                openResult: openResult,
                status: null,
              });
            });

            response.on('error', (error: Error) => {
              log.error(`LOCKER: Error opening door:`, error);
              done(reject, error);
            });
          });

          req.on('error', (error: Error) => {
            log.error(`LOCKER: Request error:`, error);
            done(reject, error);
          });
      } else {
        // Fallback to old service endpoint with POST body
        const postData = JSON.stringify({
          doorNumber: doorNumber,
          command: 'OPENDOOR',
        });

        const urlObj = new URL(url);

        const options = {
          hostname: urlObj.hostname,
          port: urlObj.port,
          path: urlObj.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
        };

        var req = protocol.request(options, (response: any) => {
          if (response.statusCode !== 200 && response.statusCode !== 201) {
            log.error(`LOCKER: HTTP error! status: ${response.statusCode}`);
            done(reject, new Error(`HTTP error! status: ${response.statusCode}`));
            return;
          }

          let data = '';

          response.on('data', (chunk: any) => {
            data += chunk;
          });

          response.on('end', () => {
            const openResult = data ? (() => { try { return JSON.parse(data); } catch(e) { return { raw: data }; } })() : { success: true };
            log.info(`LOCKER: Door ${doorNumber} opened successfully`);
            done(resolve, {
              success: true,
              doorNumber: doorNumber,
              openResult: openResult,
              status: null,
            });
          });

          response.on('error', (error: Error) => {
            log.error(`LOCKER: Error opening door:`, error);
            done(reject, error);
          });
        });

        req.on('error', (error: Error) => {
          log.error(`LOCKER: Request error:`, error);
          done(reject, error);
        });

        req.write(postData);
        req.end();
      }
      });
    };

    // Retry loop
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const openResult = await attemptOpen(attempt);

        // Post-open verification: wait, then check if the door actually opened
        try {
          const delay = readDelayOnIsDoorOpen();
          log.info(`LOCKER: Waiting ${delay}ms before door-open verification for door ${doorNumber}`);
          await new Promise(r => setTimeout(r, delay));

          const status = await getLockerStatus(mac, ip);
          // Modbus service returns { doorStatus: [...] }, cloud returns { content: { lockers: [...] } }
          const lockers = status?.doorStatus || status?.content?.lockers || [];
          const doorEntry = lockers.find((d: any) => +d.number === +doorNumber);
          const doorOpened = doorEntry ? doorEntry.locked === false : false;
          log.info(`LOCKER: Door ${doorNumber} verification: locked=${doorEntry?.locked}, doorOpened=${doorOpened}`);

          return { ...openResult, doorOpened, status };
        } catch (verifyErr: any) {
          log.warn(`LOCKER: Door ${doorNumber} verification failed: ${verifyErr.message} — assuming opened`);
          return { ...openResult, doorOpened: true, status: null };
        }
      } catch (err: any) {
        lastError = err;
        log.warn(`LOCKER: openLockerDoor attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 500));
        }
      }
    }
    throw lastError;
  } catch (error: any) {
    log.error(`LOCKER: Error in openLockerDoor:`, error);
    throw error;
  }
}
