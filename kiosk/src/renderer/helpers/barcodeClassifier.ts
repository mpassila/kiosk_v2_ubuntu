import { adminFeedHoldsMode } from './adminFeedHoldsMode';

export type BarcodeClassification = 'item' | 'deviceReturn' | 'patron' | 'staffCard' | 'blocked';

interface ClassifyOptions {
  branch: any;
  licenseId: number;
  device: any;
  adminPin?: string;
  customStaffPin?: string;
  adminFeedCallbacks?: {
    setLibraryOfThingsGroup?: (group: { name: string; groupIndex: number | null }) => void;
    processLoginUser?: (patronId: string, password: string) => void;
  };
  checkOffline?: boolean; // HomeHold needs offline check, HomeLoT does not
}

/**
 * Check if input is a staff card (PIN-only check against adminPin and customStaffPin).
 */
export function isStaffCard(input: string, options?: { adminPin?: string; customStaffPin?: string }): boolean {
  const staffPin = options?.adminPin || '20212022';
  const customPin = options?.customStaffPin;
  const localPin = (window as any).electronAPI?.getLocalConfig()?.customStaffPin;
  const upper = input.toUpperCase();
  if (upper === staffPin.toUpperCase()
    || (customPin && upper === customPin.toUpperCase())
    || (localPin && upper === localPin.toUpperCase())) {
    return true;
  }
  return false;
}

/**
 * Check if input matches the scannedinput staffcard rule from device config.
 */
function matchesStaffcardRule(input: string, device: any): boolean {
  const scannedinput = device?.scannedinput;
  if (!scannedinput?.staffcardEnabled || !scannedinput?.staffcardRule) return false;

  const rule = scannedinput.staffcardRule;
  const ruleType = scannedinput.staffcardRuleType;
  const type = Array.isArray(ruleType) ? ruleType[0] : ruleType;
  try {
    let pattern = rule;
    if (type === 'startsWith') pattern = `^${rule}`;
    else if (type === 'endsWith') pattern = `${rule}$`;
    else if (type === 'exact') pattern = `^${rule}$`;
    const matched = new RegExp(pattern, 'i').test(input);
    if (matched) {
      console.log(`✅ matchesStaffcardRule: matched "${rule}" (${type})`);
    }
    return matched;
  } catch (e) {
    console.error('❌ matchesStaffcardRule: invalid regex:', rule, e);
    return false;
  }
}

/**
 * Classify a scanned barcode as item, deviceReturn, patron, staffCard, or blocked.
 * Shared between HomeLoT and HomeHold.
 *
 * 1. isStaffCard() → 'staffCard' (PIN check)
 * 2. matchesStaffcardRule() → 'staffCard' (scannedinput rule from device config)
 * 3. Offline check (if options.checkOffline) → 'blocked' for items, 'patron' for matching patronId
 * 4. adminFeedHoldsMode() → maps result to BarcodeClassification
 */
export async function classifyBarcode(input: string, options: ClassifyOptions): Promise<BarcodeClassification | null> {
  // 1. Staff card check (PIN-only)
  if (isStaffCard(input, { adminPin: options.adminPin, customStaffPin: options.customStaffPin })) {
    return 'staffCard';
  }

  // 2. Scannedinput staffcard rule check (always before ILS calls)
  if (matchesStaffcardRule(input, options.device)) {
    return 'staffCard';
  }

  // 3. Offline check (HomeHold only)
  if (options.checkOffline) {
    const electron = (window as any).electron;
    const isOffline = await electron.sideeventNative.isMainOperatingOffline();
    if (isOffline) {
      const groups = options.device?.manifest?.groups;
      if (groups) {
        for (const groupKey in groups) {
          const lockers = groups[groupKey]?.lockers;
          if (lockers) {
            const lockersArr = Array.isArray(lockers) ? lockers : Object.values(lockers);
            for (const locker of lockersArr) {
              if ((locker as any)?.patronId === input) {
                console.log(`OFFLINE: Barcode "${input}" matched patronId in group ${groupKey}`);
                return 'patron';
              }
            }
          }
        }
      }
      // No patronId match - it's an item, block it
      console.log(`OFFLINE: Barcode "${input}" is an item - hold item add disabled offline`);
      return 'blocked';
    }
  }

  // 4. adminFeedHoldsMode detection
  const result: string = await adminFeedHoldsMode(input, options.branch, options.licenseId, options.device, options.adminFeedCallbacks) || '';
  switch (result) {
    case 'isItem':
      return 'item';
    case 'isDeviceReturn':
      return 'deviceReturn';
    case 'isStaffCard':
      return 'staffCard';
    case 'isPatron':
      return 'patron';
    default:
      return null;
  }
}
