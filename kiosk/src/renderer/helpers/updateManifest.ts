/**
 * Update device manifest helper
 * Updates the manifest groups in Firebase RTDB for hold mode
 */

/**
 * Update manifest with new or updated locker information
 * @param device - The device object with manifest and config
 * @param lockNro - The locker door number to update
 * @param persistDeviceManifestChanges - Function to persist changes to Firebase
 * @returns Promise<void>
 */
export async function updateManifest(
  device: any,
  lockNro: number,
  persistDeviceManifestChanges: (manifest: any) => Promise<void>
): Promise<void> {
  try {
    if (!device.manifest?.groups) {
      console.error('❌ updateManifest: device.manifest.groups not found');
      return;
    }

    if (!device.settings?.groups) {
      console.error('❌ updateManifest: device.settings.groups not found');
      return;
    }

    // Find the Holds/Hold group or use index 0
    let holdsGroupKey: string | null = null;
    let holdsGroupIndex = 0;

    // Try to find group by name first
    for (const [key, group] of Object.entries(device.manifest.groups)) {
      if (group && typeof group === 'object' && 'name' in group) {
        const groupName = (group as any).name?.toLowerCase();
        if (groupName === 'holds' || groupName === 'hold') {
          holdsGroupKey = key;
          holdsGroupIndex = parseInt(key);
          break;
        }
      }
    }

    // If not found by name, use index 0
    if (holdsGroupKey === null) {
      holdsGroupKey = '0';
      holdsGroupIndex = 0;
      console.log('📦 updateManifest: Using default group index 0 for holds');
    } else {
      console.log(`📦 updateManifest: Found holds group at index ${holdsGroupIndex}`);
    }

    // Get the locker data from device.settings.groups
    const settingsLocker = device.settings.groups[holdsGroupIndex]?.lockers?.[lockNro];

    if (!settingsLocker) {
      console.error(`❌ updateManifest: Locker ${lockNro} not found in device.settings.groups[${holdsGroupIndex}]`);
      return;
    }

    // Initialize the manifest group structure if it doesn't exist
    if (!device.manifest.groups[holdsGroupKey]) {
      device.manifest.groups[holdsGroupKey] = {
        name: 'Holds',
        lockers: {}
      };
    }

    if (!device.manifest.groups[holdsGroupKey].lockers) {
      device.manifest.groups[holdsGroupKey].lockers = {};
    }

    // Update the locker in manifest.groups
    device.manifest.groups[holdsGroupKey].lockers[lockNro] = {
      doorNumber: lockNro,
      itemId: settingsLocker.itemId || null,
      itemIds: settingsLocker.itemId ? settingsLocker.itemId.split(',').map((id: string) => id.trim()) : [],
      patronId: settingsLocker.patronId || null,
      holdExpirationDate: settingsLocker.holdExpirationDate || null,
      timestamp: settingsLocker.timestamp || Date.now(),
      empty: settingsLocker.empty !== undefined ? settingsLocker.empty : false,
      enabled: settingsLocker.enabled !== undefined ? settingsLocker.enabled : true,
      isADA: settingsLocker.isADA || false,
      set: settingsLocker.set || {}
    };

    console.log(`✅ updateManifest: Updated locker ${lockNro} in manifest.groups[${holdsGroupKey}]`, {
      itemId: settingsLocker.itemId,
      patronId: settingsLocker.patronId,
      isADA: settingsLocker.isADA
    });

    // Persist the updated manifest to Firebase RTDB
    await persistDeviceManifestChanges(device.manifest);

    console.log(`🔄 updateManifest: Manifest changes persisted to Firebase for locker ${lockNro}`);
  } catch (error) {
    console.error('❌ updateManifest: Error updating manifest:', error);
    throw error;
  }
}
