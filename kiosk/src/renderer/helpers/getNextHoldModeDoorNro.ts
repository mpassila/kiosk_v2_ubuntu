import _ from 'lodash';
import { setNextLockerNro } from 'renderer/state/shared';

/**
 * Get available locker count per size preference using RTDB structure
 * @param device - The device object with thedoors, doorsizes and manifest
 * @param preference - Locker preference ('ANY', 'TOP2', 'BOTTOM2', 'ADA')
 * @returns Array of available lock numbers
 *
 * Door preference values from RTDB:
 * - 'high' - High/top shelf doors
 * - 'low' - Low/bottom shelf doors
 * - 'all' - Available for any preference
 * - undefined/null - Defaults to 'all'
 *
 * Preference filtering:
 * - ANY: Includes doors with pref 'all', 'high', 'low', or undefined
 * - TOP2: Includes doors with pref 'all' or 'high'
 * - BOTTOM2: Includes doors with pref 'all' or 'low'
 * - ADA: Includes doors with ada/isADA = true
 */
function getAvailableCountPerSize(device: any, preference = 'ANY'): number[] {
  console.log(`🔍 getAvailableCountPerSize called with preference: "${preference}"`);

  // Check if device has thedoors array from RTDB
  if (!device.thedoors || !Array.isArray(device.thedoors)) {
    console.warn('❌ getAvailableCountPerSize: device.thedoors not found');
    return [];
  }

  // Get doorsizes configuration from RTDB to determine valid sizes
  // If not configured, allow ALL sizes
  let validSizes: string[] = [];
  let useSizeFilter = false;

  if (device.doorsizes && Array.isArray(device.doorsizes) && device.doorsizes.length > 0) {
    // Filter to get sizes that are not "large" or size index < 3
    const filteredSizes = device.doorsizes
      .filter((sizeConfig: any) => {
        // Exclude large sizes (typically index 3 or higher, or name 'large')
        const sizeName = sizeConfig.name?.toLowerCase();
        const sizeIndex = sizeConfig.size;
        return (sizeName !== 'large') && (sizeIndex === undefined || sizeIndex < 3);
      })
      .map((sizeConfig: any) => sizeConfig.name?.toLowerCase());

    if (filteredSizes.length > 0) {
      validSizes = filteredSizes;
      useSizeFilter = true;
      console.log(`📦 Valid door sizes for selection: ${validSizes.join(', ')}`);
    } else {
      console.log(`📦 No valid door sizes found in doorsizes config, allowing ALL sizes`);
    }
  } else {
    console.log(`📦 No doorsizes configuration, allowing ALL door sizes`);
  }

  console.log(`📦 Total doors in device.thedoors: ${device.thedoors.length}`);

  // Get occupied door numbers from manifest.groups.lockers
  const occupiedDoors = new Set<number>();
  if (device.manifest?.groups) {
    for (const groupKey in device.manifest.groups) {
      const group = device.manifest.groups[groupKey];
      if (group.lockers) {
        // Handle both array and object formats
        if (Array.isArray(group.lockers)) {
          // Array format: [{doorNumber: 1, itemIds: [...], patronId: '22'}, ...]
          group.lockers.forEach((locker: any) => {
            // Only mark as occupied if locker has items or a patron assigned
            if (locker && locker.doorNumber && ((locker.itemIds && locker.itemIds.length > 0) || locker.patronId)) {
              occupiedDoors.add(Number(locker.doorNumber));
            }
          });
        } else {
          // Object format: {1: {itemIds: [...], patronId: '22'}, ...}
          for (const doorNumber in group.lockers) {
            const locker = group.lockers[doorNumber];
            // Only mark as occupied if locker has items or a patron assigned
            if (locker && ((locker.itemIds && locker.itemIds.length > 0) || locker.patronId)) {
              occupiedDoors.add(Number(doorNumber));
            }
          }
        }
      }
    }
  }

  console.log(`📦 Occupied doors: ${Array.from(occupiedDoors).sort((a, b) => a - b).join(', ') || 'none'}`);

  // Log disabled doors
  const disabledDoors = device.thedoors.filter((door: any) => door.enabled === false);
  if (disabledDoors.length > 0) {
    console.log(`🚫 Disabled doors (enabled: false): ${disabledDoors.map((d: any) => d.doorNumber).join(', ')}`);
  }

  // Filter doors by valid size, availability, and enabled
  let availableDoors = device.thedoors.filter((door: any) => {
    const doorNum = Number(door.doorNumber);
    const doorSize = door.size?.toLowerCase();
    const isOccupied = occupiedDoors.has(doorNum);
    const isEnabled = door.enabled !== false; // enabled by default unless explicitly set to false

    // Check size filter only if we have a size configuration
    const sizeMatch = useSizeFilter ? validSizes.includes(doorSize) : true;

    return sizeMatch && !isOccupied && isEnabled;
  });

  console.log(`📦 Available doors after size+occupancy+enabled filter: ${availableDoors.length} (${availableDoors.map((d: any) => d.doorNumber).join(', ')})`);

  // Log a sample door to see its properties
  if (availableDoors.length > 0) {
    console.log(`📦 Sample door properties:`, JSON.stringify({
      doorNumber: availableDoors[0].doorNumber,
      size: availableDoors[0].size,
      pref: availableDoors[0].pref,
      ada: availableDoors[0].ada,
      isADA: availableDoors[0].isADA
    }));
  }

  // Apply preference filtering based on door.pref (high, low, all)
  if (preference === 'ANY') {
    // Include all doors where pref is undefined, 'all', 'high', or 'low'
    availableDoors = availableDoors.filter((door: any) =>
      !door.pref || door.pref === 'all' || door.pref === 'high' || door.pref === 'low'
    );
  } else if (preference === 'TOP2') {
    // TOP2: pref = 'all' or 'high'
    availableDoors = availableDoors.filter((door: any) =>
      door.pref === 'all' || door.pref === 'high'
    );
  } else if (preference === 'BOTTOM2') {
    // BOTTOM2: pref = 'all' or 'low'
    availableDoors = availableDoors.filter((door: any) =>
      door.pref === 'all' || door.pref === 'low'
    );
  } else if (preference === 'ADA') {
    // ADA: filter by ada or isADA property
    availableDoors = availableDoors.filter((door: any) =>
      door.ada === true || door.isADA === true
    );
  }

  const finalDoorNumbers = availableDoors.map((door: any) => Number(door.doorNumber));
  console.log(`📦 Final available doors after preference filter (${preference}): ${finalDoorNumbers.length} (${finalDoorNumbers.join(', ')})`);

  // Map to door numbers
  return finalDoorNumbers;
}

/**
 * Get free locker IDs based on ADA preference and patron preference using RTDB structure
 * @param device - The device object with thedoors and manifest
 * @param isADA - Whether to get ADA-accessible lockers
 * @param patronPreference - Patron's locker size preference
 * @returns Array of available lock numbers ordered by priority
 */
function getFreeLockerIDs(device: any, isADA = false, patronPreference: string | null = null): number[] {
  // Get available locks based on preference
  let allLocks = patronPreference ? getAvailableCountPerSize(device, patronPreference) : getAvailableCountPerSize(device);

  if (!device.thedoors || !Array.isArray(device.thedoors)) {
    console.warn('❌ getFreeLockerIDs: device.thedoors not found');
    return allLocks;
  }

  // Create a Set for faster lookup
  const availableLocksSet = new Set(allLocks);

  if (isADA) {
    // Get all ADA doors and order by priority (excluding disabled doors)
    const adaDoors = device.thedoors.filter((door: any) =>
      (door.ada === true || door.isADA === true) && availableLocksSet.has(Number(door.doorNumber)) && door.enabled !== false
    );
    const prioOrderForAllAda = _.orderBy(adaDoors, (door) => door.prio ?? 999);
    return prioOrderForAllAda.map((door: any) => Number(door.doorNumber));
  } else {
    // Get all doors ordered by priority (excluding disabled doors)
    const allDoors = device.thedoors.filter((door: any) =>
      availableLocksSet.has(Number(door.doorNumber)) && door.enabled !== false
    );
    const prioOrderForAll = _.orderBy(allDoors, (door) => door.prio ?? 999);

    let finalAllLockers: number[] = [];

    // First, add non-ADA doors
    prioOrderForAll.forEach((door: any) => {
      if (!door.ada && !door.isADA) {
        finalAllLockers.push(Number(door.doorNumber));
      }
    });

    // Then, add ADA doors
    prioOrderForAll.forEach((door: any) => {
      if (door.ada === true || door.isADA === true) {
        finalAllLockers.push(Number(door.doorNumber));
      }
    });

    return finalAllLockers;
  }
}

/**
 * Filter and return all empty doors matching specific size and ADA criteria
 * @param device - The device object with thedoors and manifest
 * @param size - Door size ('small', 'medium', 'large', 'xlarge', 'xxl')
 * @param isADA - Whether to filter for ADA-accessible doors only
 * @returns Array of available door numbers matching the criteria, ordered by priority
 */
export function filterSelectedSize(device: any, size: string, isADA: boolean = false): number[] {
  console.log(`📦 filterSelectedSize START: size=${size}, isADA=${isADA}`);

  // Check if device has thedoors array from RTDB
  if (!device.thedoors || !Array.isArray(device.thedoors)) {
    console.warn('❌ filterSelectedSize: device.thedoors not found');
    return [];
  }

  console.log(`📦 filterSelectedSize: device.thedoors has ${device.thedoors.length} doors`);

  // Get occupied door numbers from manifest.groups.lockers
  const occupiedDoors = new Set<number>();
  if (device.manifest?.groups) {
    for (const groupKey in device.manifest.groups) {
      const group = device.manifest.groups[groupKey];
      if (group.lockers) {
        // Handle both array and object formats
        if (Array.isArray(group.lockers)) {
          group.lockers.forEach((locker: any) => {
            if (locker && locker.doorNumber && ((locker.itemIds && locker.itemIds.length > 0) || locker.patronId)) {
              occupiedDoors.add(Number(locker.doorNumber));
            }
          });
        } else {
          for (const doorNumber in group.lockers) {
            const locker = group.lockers[doorNumber];
            if (locker && ((locker.itemIds && locker.itemIds.length > 0) || locker.patronId)) {
              occupiedDoors.add(Number(doorNumber));
            }
          }
        }
      }
    }
  }

  console.log(`📦 filterSelectedSize: ${occupiedDoors.size} doors occupied:`, Array.from(occupiedDoors));

  // Define size priority order: small → medium → large → xlarge → xxl
  // Then ADA versions: ada-small → ada-medium → ada-large → etc.
  const sizeOrder = ['small', 'medium', 'large', 'xlarge', 'xxl'];
  const normalizedSize = size?.toLowerCase() || 'small';

  // Build search order: requested size first, then larger sizes
  const startIndex = sizeOrder.indexOf(normalizedSize);
  const searchOrder: string[] = [];

  // Non-ADA sizes first (from requested size onwards)
  for (let i = startIndex >= 0 ? startIndex : 0; i < sizeOrder.length; i++) {
    searchOrder.push(sizeOrder[i]);
  }

  // If ADA requested, we only search ADA doors
  // If not ADA, we search non-ADA first, then ADA as fallback
  const adaSearchOrder = isADA ? [true] : [false, true];

  console.log(`📦 filterSelectedSize: search order: sizes=${searchOrder}, adaOrder=${adaSearchOrder}`);

  // Helper to get available doors for a specific size and ADA setting (excluding disabled)
  const getAvailableForSize = (targetSize: string, targetADA: boolean): any[] => {
    return device.thedoors.filter((door: any) => {
      const doorNum = Number(door.doorNumber);
      const doorSize = door.size?.toLowerCase();
      const isOccupied = occupiedDoors.has(doorNum);
      const isEnabled = door.enabled !== false;
      const matchesSize = doorSize === targetSize;
      const doorIsADA = door.ada === true || door.isADA === true;
      const matchesADA = targetADA ? doorIsADA : !doorIsADA;

      return matchesSize && matchesADA && !isOccupied && isEnabled;
    });
  };

  // Search through size/ADA combinations in priority order
  for (const adaSearch of adaSearchOrder) {
    for (const sizeSearch of searchOrder) {
      const available = getAvailableForSize(sizeSearch, adaSearch);
      if (available.length > 0) {
        // Order by priority and return
        const orderedDoors = _.orderBy(available, (door) => door.prio ?? 999);
        const result = orderedDoors.map((door: any) => Number(door.doorNumber));
        console.log(`📦 filterSelectedSize: found ${result.length} doors with size=${sizeSearch}, isADA=${adaSearch}`, result);
        return result;
      }
    }
  }

  console.log(`📦 filterSelectedSize: no available doors found`);
  return [];
}

/**
 * Get the next available locker door number for hold mode
 * @param device - The device object containing locker configuration
 * @param isADA - Whether to get an ADA-accessible locker
 * @param patronPreference - Optional patron preference for locker size/location
 * @returns The next available lock number, or undefined if none available
 */
export function getNextHoldModeDoorNro(
  device: any,
  isADA = false,
  patronPreference: string | null = null
): number | undefined {
  const next = _.first(getFreeLockerIDs(device, isADA, patronPreference));
  console.log(`🔍 getNextHoldModeDoorNro: Found door ${next || 'undefined'}`);
  // Don't set the signal here - let the caller do it
  return next;
}

/**
 * Get available door sizes grouped by normal and ADA
 * Returns data structure for UI to display available door size options
 * @param device - The device object with thedoors and manifest
 * @returns Object with normal and ada arrays containing size options
 */
export function getAvailableDoorsWithSizes(device: any): { normal: any[], ada: any[] } {
  // Check if device has thedoors array from RTDB
  if (!device.thedoors || !Array.isArray(device.thedoors)) {
    console.warn('❌ getAvailableDoorsWithSizes: device.thedoors not found');
    return { normal: [], ada: [] };
  }

  // Get occupied door numbers from manifest
  const occupiedDoors = new Set<number>();
  if (device.manifest?.groups) {
    for (const groupKey in device.manifest.groups) {
      const group = device.manifest.groups[groupKey];
      if (group.lockers) {
        // Handle both array and object formats
        if (Array.isArray(group.lockers)) {
          // Array format: [{doorNumber: 1, itemIds: [...], patronId: '22'}, ...]
          group.lockers.forEach((locker: any) => {
            // Only mark as occupied if locker has items or a patron assigned
            if (locker && locker.doorNumber && ((locker.itemIds && locker.itemIds.length > 0) || locker.patronId)) {
              occupiedDoors.add(Number(locker.doorNumber));
            }
          });
        } else {
          // Object format: {1: {itemIds: [...], patronId: '22'}, ...}
          for (const doorNumber in group.lockers) {
            const locker = group.lockers[doorNumber];
            // Only mark as occupied if locker has items or a patron assigned
            if (locker && ((locker.itemIds && locker.itemIds.length > 0) || locker.patronId)) {
              occupiedDoors.add(Number(doorNumber));
            }
          }
        }
      }
    }
  }

  // Get available doors (not occupied and enabled)
  const availableDoors = device.thedoors.filter((door: any) => {
    const doorNum = Number(door.doorNumber);
    return !occupiedDoors.has(doorNum) && door.enabled !== false;
  });

  // Group by size and ADA status
  const sizeMap = new Map<string, { normal: number, ada: number }>();

  availableDoors.forEach((door: any) => {
    const size = door.size?.toLowerCase() || 'unknown';
    const isADA = door.ada === true || door.isADA === true;

    if (!sizeMap.has(size)) {
      sizeMap.set(size, { normal: 0, ada: 0 });
    }

    const counts = sizeMap.get(size)!;
    if (isADA) {
      counts.ada++;
    } else {
      counts.normal++;
    }
  });

  // Convert to UI format
  const normal: any[] = [];
  const ada: any[] = [];

  sizeMap.forEach((counts, size) => {
    const sizeName = size.charAt(0).toUpperCase() + size.slice(1); // Capitalize

    if (counts.normal > 0) {
      normal.push({
        size: size,
        sizeName: sizeName,
        typeName: '',
        count: counts.normal
      });
    }

    if (counts.ada > 0) {
      ada.push({
        size: size,
        sizeName: sizeName,
        typeName: 'ADA',
        count: counts.ada
      });
    }
  });

  console.log(`📦 Available door sizes - Normal: ${normal.length} types, ADA: ${ada.length} types`, { normal, ada });

  return { normal, ada };
}

