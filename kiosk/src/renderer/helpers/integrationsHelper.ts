/**
 * Helper functions to access integrations data from localStorage
 */

export interface Integration {
  [key: string]: any;
}

export interface Integrations {
  [integrationType: string]: Integration;
}

/**
 * Get all integrations from localStorage
 * @returns All integrations object or null if not found
 */
export function getIntegrations(): Integrations | null {
  try {
    const integrationsStr = localStorage.getItem('integrations');
    if (!integrationsStr) {
      console.warn('No integrations found in localStorage');
      return null;
    }
    return JSON.parse(integrationsStr);
  } catch (error) {
    console.error('Error parsing integrations from localStorage:', error);
    return null;
  }
}

/**
 * Get a specific integration by type (e.g., 'locker', 'rfid', 'ils')
 * @param integrationType - The type of integration to retrieve
 * @returns The integration object or null if not found
 */
export function getIntegration(integrationType: string): Integration | null {
  const integrations = getIntegrations();
  if (!integrations) {
    return null;
  }

  const integration = integrations[integrationType];
  if (!integration) {
    console.warn(`Integration type '${integrationType}' not found`);
    return null;
  }

  return integration;
}

/**
 * Get locker integration data (convenience function)
 * @returns Locker integration object or null
 */
export function getLockerIntegration(): Integration | null {
  return getIntegration('locker');
}

/**
 * Get RFID integration data (convenience function)
 * @returns RFID integration object or null
 */
export function getRFIDIntegration(): Integration | null {
  return getIntegration('rfid');
}

/**
 * Get ILS integration data (convenience function)
 * @returns ILS integration object or null
 */
export function getILSIntegration(): Integration | null {
  return getIntegration('ils');
}

/**
 * Check if integrations are cached and still valid
 * @param maxAgeHours - Maximum age in hours (default: 24)
 * @returns True if cache is valid
 */
export function isIntegrationsCacheValid(maxAgeHours: number = 24): boolean {
  const timestampStr = localStorage.getItem('integrations_timestamp');
  if (!timestampStr) {
    return false;
  }

  try {
    const timestamp = new Date(timestampStr);
    const now = new Date();
    const ageHours = (now.getTime() - timestamp.getTime()) / (1000 * 60 * 60);
    return ageHours < maxAgeHours;
  } catch (error) {
    console.error('Error checking integrations cache validity:', error);
    return false;
  }
}

/**
 * Clear integrations from localStorage
 */
export function clearIntegrations(): void {
  localStorage.removeItem('integrations');
  localStorage.removeItem('integrations_licenseId');
  localStorage.removeItem('integrations_timestamp');
  console.log('Integrations cleared from localStorage');
}

/**
 * Find an integration that matches the current device ID
 * @param deviceId - The device ID to match against (e.g., 'LYNGSOE_WINDOWS_TESTID-1:2:3:4')
 * @param integrationType - Optional integration type to filter (e.g., 'locker')
 * @returns The matching integration object or null if not found
 */
export function findIntegrationForDevice(
  deviceId: string,
  integrationType?: string
): Integration | null {
  const integrations = getIntegrations();
  if (!integrations) {
    return null;
  }

  // Filter by integration type if provided
  const integrationsToSearch = integrationType
    ? { [integrationType]: integrations[integrationType] }
    : integrations;

  // Search through integrations to find one with matching bindDeviceId
  for (const [type, integration] of Object.entries(integrationsToSearch)) {
    if (!integration) continue;

    // Check if integration has bindDeviceId that matches
    if (integration.bindDeviceId === deviceId) {
      console.log(`✅ Found matching integration (${type}) for device: ${deviceId}`);
      return integration;
    }

    // Also check if integration is an object with nested integrations
    if (typeof integration === 'object' && !integration.bindDeviceId) {
      for (const [key, value] of Object.entries(integration)) {
        if (value && typeof value === 'object' && (value as any).bindDeviceId === deviceId) {
          console.log(`✅ Found matching integration (${type}.${key}) for device: ${deviceId}`);
          return value as Integration;
        }
      }
    }
  }

  console.warn(`No integration found for device: ${deviceId}`);
  return null;
}

/**
 * Get locker integration data for the current device
 * @param deviceId - The device ID to match
 * @returns Locker integration object or null
 */
export function getLockerIntegrationForDevice(deviceId: string): Integration | null {
  return findIntegrationForDevice(deviceId, 'locker');
}
