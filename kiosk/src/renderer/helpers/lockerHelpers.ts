import _ from 'lodash';

export function anyItemsAvailableNormal (device: any, groupId: number) {
  if (!device?.config?.locker?.groups?.[groupId]) return false;
  const group = device.config.locker.groups[groupId];
  for (const door in group.lockers) {
    const locker = group.lockers[door];
    if (locker && locker.itemIds && locker.itemIds.length && (!locker.patronId || locker.patronId === 'All') && !locker.conditionCheck) {
      return true;
    }
  }
  return false;
}

export function anyItemsAvailableADA (device: any, groupId: number) {
  if (!device?.config?.locker?.groups?.[groupId]) return false;
  const group = device.config.locker.groups[groupId];
  for (const door in group.lockers) {
    const locker = group.lockers[door];
    if (locker && locker.itemIds && locker.isADA && locker.itemIds.length && (!locker.patronId || locker.patronId === 'All') && !locker.conditionCheck) {
      return true;
    }
  }
  return false;
}

export function getEmptyADALockerCount(device: any, groupId: number): number {
  if (!device?.config?.locker?.groups?.[groupId]) return 0;
  const group = device.config.locker.groups[groupId];
  let count = 0;
  for (const door in group.lockers) {
    const locker = group.lockers[door];
    if (locker && locker.isADA && (!locker.itemIds || locker.itemIds.length === 0) && (!locker.patronId || locker.patronId === 'All')) {
      count++;
    }
  }
  return count;
}

/**
 * Check if a patron already has a hold in a locker
 * @param device - The device object containing locker configuration
 * @param patronId - The patron ID to check
 * @param expirationDate - Optional expiration date to match
 * @returns Locker number if patron has a hold, false otherwise
 */
export function patronHasAllreadyHold(device: any, patronId: string, expirationDate?: any): number | boolean {
  // Check manifest.groups first (RTDB data), then fall back to config.locker.groups
  const groups = device.manifest?.groups || device.config?.locker?.groups;
  if (!groups) {
    console.log(`📦 patronHasAllreadyHold: No groups found for patron ${patronId}`);
    return false;
  }

  console.log(`📦 patronHasAllreadyHold: Checking patron ${patronId} in ${Object.keys(groups).length} groups`);

  // Iterate through all groups
  for (const groupKey in groups) {
    const group = groups[groupKey];

    if (group.lockers) {
      for (const doorNumber in group.lockers) {
        const locker = group.lockers[doorNumber];
        // Skip null/undefined entries
        if (!locker) continue;

        // Check if this locker belongs to the patron
        if (locker.patronId === patronId) {
          console.log(`📦 patronHasAllreadyHold: Found patron ${patronId} in door ${doorNumber}`);
          // If expirationDate is provided and not null, check if locker's set has that key
          if (expirationDate !== undefined && expirationDate !== null) {
            const setKeys = locker.set ? Object.keys(locker.set) : [];
            if (setKeys.includes(String(expirationDate))) {
              console.log(`📦 patronHasAllreadyHold: Same expiration date match in set — patron ${patronId} in door ${doorNumber} (expDate: ${expirationDate})`);
              return parseInt(doorNumber);
            } else {
              console.log(`📦 patronHasAllreadyHold: Different expiration date — door ${doorNumber} set keys [${setKeys}], looking for ${expirationDate} → will create new locker`);
            }
          } else {
            // No expiration date filter, just return the locker number
            return parseInt(doorNumber);
          }
        }
      }
    }
  }

  console.log(`📦 patronHasAllreadyHold: Patron ${patronId} not found in any locker`);
  return false;
}

/**
 * Find the patron's latest (most recent) locker by timestamp.
 * Used for smart consolidation — ignores expiration dates, returns the newest locker.
 * @param device - The device object containing locker configuration
 * @param patronId - The patron ID to search for
 * @returns Door number of the latest locker, or false if not found
 */
export function patronLatestLocker(device: any, patronId: string): number | false {
  const groups = device.manifest?.groups || device.config?.locker?.groups;
  if (!groups) {
    console.log(`📦 patronLatestLocker: No groups found for patron ${patronId}`);
    return false;
  }

  let latestTimestamp = 0;
  let latestDoorNumber: number | false = false;

  for (const groupKey in groups) {
    const group = groups[groupKey];
    if (group.lockers) {
      for (const key in group.lockers) {
        const locker = group.lockers[key];
        if (!locker) continue;
        if (locker.patronId === patronId) {
          const ts = locker.timestamp || 0;
          if (ts >= latestTimestamp || latestDoorNumber === false) {
            latestTimestamp = ts;
            latestDoorNumber = locker.doorNumber != null ? +locker.doorNumber : parseInt(key);
          }
        }
      }
    }
  }

  console.log(`📦 patronLatestLocker: patron ${patronId} latest locker: ${latestDoorNumber || 'none'} (timestamp: ${latestTimestamp})`);
  return latestDoorNumber;
}

/**
 * Sort locker list by priority and return the first lock number
 * @param myList - Array of locker objects with lock and prio properties
 * @returns The lock number with highest priority, or null if none available
 */
export function sortWithPrioReturnLockNro(myList: any[]): number | null {
  if (!myList || myList.length === 0) {
    return null;
  }

  const prioOrderForAll = _.orderBy(myList, (a: any) => a.prio);
  let finalAllLockers: any[] = [];
  prioOrderForAll.map((a: any) => {
    if (_.findKey(myList, (key: any) => key.lock === a.lock)) {
      finalAllLockers.push(a);
    }
  });
  return finalAllLockers.length ? _.first(finalAllLockers).lock : null;
}
