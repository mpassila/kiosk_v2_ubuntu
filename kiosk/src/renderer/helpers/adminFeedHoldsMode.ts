import { validateItemInfo, sessionLicenseId, sessionDatabaseUrl, kioskConfig, sessionBranch } from '../state/shared';
import { getFirebaseAuth, getFirebaseDatabase } from '../state/firebase-client';
import { ref, onValue, off } from 'firebase/database';

const POLARIS_API_BASE = 'https://polarisapi-be4ekemxaa-uc.a.run.app';
const SIP2_PROXY_BASE = 'https://sip2proxy-be4ekemxaa-uc.a.run.app';

let allPendingReturnItems: any = {};

// Cached admin card barcode from Firebase scannedinput settings
export let cachedAdminCardBarcode: string | null = null;

// Last ILS item lookup result — available after workflowILSForItemVsPatronDetection
export let lastILSItemLookup: { title: string | null; holdsQueue: number | null; itemId: string | null; circulationStatus: number | null; raw: any } | null = null;

/**
 * Direct SIP2 ITEM_INFORMATION request via sip2proxy.
 * Uses the same pattern as the SIP2 test tool (sip2-tool/page.tsx):
 * 1. POST to /hybridsip → returns { rtdbUrl }
 * 2. Listen to Firebase RTDB via SDK onValue until RESPONSE arrives
 * 3. Parse the RESULT field for structured data
 */
async function sip2ItemInfoDirect(barcode: string): Promise<any> {
  const branch = sessionBranch.value;
  const currentLicenseId = sessionLicenseId.value;
  const branchId = branch?.id;
  const institutionId = branch?.sip2Settings?.institutionId || '';

  const body = JSON.stringify({
    licenseId: currentLicenseId,
    branchId,
    type: 'ITEMINFO',
    message: { itemId: barcode, institutionId, skipTerminalLocation: true }
  });

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  try {
    const auth = getFirebaseAuth();
    const currentUser = auth.currentUser;
    if (currentUser) {
      const idToken = await currentUser.getIdToken();
      headers['Authorization'] = `Bearer ${idToken}`;
    }
  } catch (e) {
    console.warn('⚠️ sip2ItemInfoDirect: Could not get auth token, trying without auth');
  }

  // Step 1: POST to hybridsip to trigger the SIP2 request
  const response = await fetch(`${SIP2_PROXY_BASE}/hybridsip`, {
    method: 'POST',
    headers,
    body
  });

  const data = await response.json();
  console.log('📡 sip2ItemInfoDirect POST response:', data);

  if (!data.rtdbUrl) {
    console.error('❌ sip2ItemInfoDirect: No rtdbUrl in response:', data);
    return null;
  }

  // Step 2: Listen to Firebase RTDB via SDK (same pattern as sip2-tool)
  const rtdbUrl: string = data.rtdbUrl;
  // Extract path from full URL: https://library-456310-default-rtdb.firebaseio.com/SIP2/...
  const rtdbPath = rtdbUrl.split('.firebaseio.com')[1];
  console.log('📡 sip2ItemInfoDirect: Listening to RTDB path:', rtdbPath);

  const db = getFirebaseDatabase();
  const dbRef = ref(db, rtdbPath);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      off(dbRef);
      console.error('❌ sip2ItemInfoDirect: Timeout waiting for SIP2 response after 10s');
      resolve(null);
    }, 10000);

    onValue(dbRef, (snapshot) => {
      const messageData = snapshot.val();
      console.log('📡 sip2ItemInfoDirect RTDB snapshot:', messageData ? Object.keys(messageData) : null);

      if (messageData && (messageData.RESPONSE || messageData.ERROR)) {
        clearTimeout(timeout);
        off(dbRef);

        console.log('📡 sip2ItemInfoDirect RTDB response received:', messageData);
        const result = messageData.RESULT || messageData.result || {};
        console.log('📡 sip2ItemInfoDirect parsed RESULT:', result);

        resolve({
          itemIdentifier: result.itemIdentifier || result.AB || barcode,
          titleIdentifier: result.titleIdentifier || result.AJ || null,
          circulationStatus: result.circulationStatus ?? null,
          screenMessage: result.screenMessage || result.AF || null,
          holdQueueLength: result.holdQueueLength || result.CF || null,
          CF: result.CF || result.holdQueueLength || null,
          AJ: result.AJ || result.titleIdentifier || null,
          AB: result.AB || result.itemIdentifier || null,
          AF: result.AF || result.screenMessage || null,
          AG: result.AG || null,
          raw: messageData,
        });
      }
    }, (error) => {
      clearTimeout(timeout);
      off(dbRef);
      console.error('❌ sip2ItemInfoDirect: RTDB listener error:', error);
      resolve(null);
    });
  });
}

/**
 * Load scanning input settings from Firebase Realtime DB
 * Path: license_{licenseId}/devices/{deviceKey}/scannedinput
 */
function loadScannedInputSettings() {
  // Read directly from the already-loaded device data (loaded at startup from RTDB)
  const settings = kioskConfig.value?.device?.scannedinput || null;
  console.log('🔍 Scanning input settings from device:', settings);
  return settings;
}

/**
 * Test input against a rule using regex
 * @param input - The input string to test
 * @param rule - The rule pattern
 * @param ruleType - Array of rule types like ['startsWith'], ['endsWith'], ['contains'], ['exact']
 */
function testInputAgainstRule(input: string, rule: string, ruleType?: string[]): boolean {
  try {
    let pattern = rule;

    // If ruleType is specified, construct the appropriate regex
    if (ruleType && ruleType.length > 0) {
      const type = ruleType[0]; // Use first rule type

      switch (type) {
        case 'startsWith':
          pattern = `^${rule}`;
          break;
        case 'endsWith':
          pattern = `${rule}$`;
          break;
        case 'exact':
          pattern = `^${rule}$`;
          break;
        case 'contains':
          pattern = rule; // Default behavior
          break;
        default:
          pattern = rule;
      }
    }

    const regex = new RegExp(pattern, 'i');
    const result = regex.test(input);
    console.log(`🔍 Testing "${input}" against pattern "${pattern}" (type: ${ruleType?.[0] || 'regex'}): ${result}`);
    return result;
  } catch (error) {
    console.error('❌ Invalid regex rule:', rule, error);
    return false;
  }
}

/**
 * Find item in locker by item ID
 */
function findItemIDFromLocker(testedItemId: string, device: any) {
  for (let groupIndex in device.config.locker.groups) {
    for (let lockerIndex in device.config.locker.groups[groupIndex].lockers) {
      if (device.config.locker.groups[groupIndex].lockers[lockerIndex].itemId === testedItemId) {
        return device.config.locker.groups[groupIndex].lockers[lockerIndex];
      }
    }
  }
}

/**
 * ILS-based detection: is the barcode an item or a patron?
 * Uses Polaris item lookup, SIP2 itemInfo, or Symphony to determine barcode type.
 * @returns 'isItem' | 'isPatron' | null
 */
async function workflowILSForItemVsPatronDetection(barcode: string): Promise<'isItem' | 'isPatron' | null> {
  const branch = sessionBranch.value;
  const currentLicenseId = sessionLicenseId.value;
  const isPolaris = branch?.polarisSettings?.enabled;
  const isSip2 = branch?.sip2Settings?.enabled;
  const isSymphony = branch?.symphonySettings?.enabled;

  // Skip for license 1/2 simulation
  if (currentLicenseId === 1 || currentLicenseId === 2) {
    console.log(`🔍 workflowILSDetection: Demo mode, skipping ILS detection`);
    return null;
  }

  try {
    if (isPolaris) {
      const branchId = branch?.id;
      console.log(`🔍 workflowILSDetection: Polaris item lookup for ${barcode}`);
      const url = `${POLARIS_API_BASE}/${currentLicenseId}/${branchId}/items/lookup?itemBarcode=${encodeURIComponent(barcode)}`;
      const response = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
      const data = await response.json();
      console.log(`🔍 workflowILSDetection: Polaris lookup response:`, data);

      // If item found (PAPIErrorCode 0 or has bib data), it's an item; otherwise patron
      const isItemFound = response.ok && data && data.PAPIErrorCode === 0;
      if (isItemFound) {
        // Find label/value pairs from the response (e.g. { Label: "Title:", Value: "..." })
        const findByLabel = (obj: any, label: string): any => {
          if (!obj || typeof obj !== 'object') return undefined;
          // Check this object itself
          if (obj.Label === label && obj.Value !== undefined) return obj.Value;
          // Recurse into all children (array items or object values)
          const children = Array.isArray(obj) ? obj : Object.values(obj);
          for (const child of children) {
            const found = findByLabel(child, label);
            if (found !== undefined) return found;
          }
          return undefined;
        };

        // If SIP2 is also enabled, get circulation status from SIP2
        let circulationStatus: number | null = null;
        if (isSip2) {
          try {
            console.log(`🔍 workflowILSDetection: SIP2 itemInfo for circulation status of ${barcode}`);
            const sip2Result = await sip2ItemInfoDirect(barcode);
            console.log(`🔍 workflowILSDetection: SIP2 circulation status response:`, sip2Result);
            circulationStatus = sip2Result?.circulationStatus != null ? +sip2Result.circulationStatus : null;
          } catch (e) {
            console.warn(`⚠️ workflowILSDetection: SIP2 circulation status lookup failed`, e);
          }
        }

        lastILSItemLookup = {
          title: findByLabel(data, 'Title:') || null,
          holdsQueue: findByLabel(data, 'Current Holds:') ?? findByLabel(data, 'Current Holds') ?? null,
          itemId: barcode,
          circulationStatus,
          raw: data,
        };

        console.log(`✅ workflowILSDetection: Polaris identified as ITEM`, lastILSItemLookup);
        return 'isItem';
      } else {
        lastILSItemLookup = null;
        console.log(`✅ workflowILSDetection: Polaris identified as PATRON (item not found)`);
        return 'isPatron';
      }
    } else if (isSip2) {
      console.log(`🔍 workflowILSDetection: SIP2 itemInfo for ${barcode}`);
      const result = await sip2ItemInfoDirect(barcode);
      console.log(`🔍 workflowILSDetection: SIP2 itemInfo response:`, result);

      const titleId = result?.titleIdentifier || result?.AJ || '';
      const hasProperTitle = titleId && titleId.trim() !== '' && titleId.trim() !== barcode;
      const isValidItem = validateItemInfo(result, barcode)
        && hasProperTitle
        && !result?.screenMessage?.includes('Item not found in catalog')
        && !titleId?.includes('Invalid item')
        && !result?.AF?.includes('Item not found')
        && !result?.AF?.includes('Please press Request Help for assistance')
        && !result?.AG?.includes('The item does not exist');
      if (isValidItem) {
        let title = result?.titleIdentifier || result?.AJ || null;

        // If Polaris is also enabled, prefer Polaris title (more reliable)
        if (isPolaris) {
          try {
            const branchId = branch?.id;
            console.log(`🔍 workflowILSDetection: Polaris title lookup for ${barcode} (SIP2 item with Polaris enabled)`);
            const url = `${POLARIS_API_BASE}/${currentLicenseId}/${branchId}/items/lookup?itemBarcode=${encodeURIComponent(barcode)}`;
            const polarisRes = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
            const polarisData = await polarisRes.json();
            const isPolarisFound = polarisRes.ok && polarisData && polarisData.PAPIErrorCode === 0;
            if (isPolarisFound) {
              const findByLabel = (obj: any, label: string): any => {
                if (!obj || typeof obj !== 'object') return undefined;
                if (obj.Label === label && obj.Value !== undefined) return obj.Value;
                const children = Array.isArray(obj) ? obj : Object.values(obj);
                for (const child of children) {
                  const found = findByLabel(child, label);
                  if (found !== undefined) return found;
                }
                return undefined;
              };
              const polarisTitle = findByLabel(polarisData, 'Title:') || null;
              if (polarisTitle) {
                console.log(`✅ workflowILSDetection: Using Polaris title instead of SIP2:`, polarisTitle);
                title = polarisTitle;
              }
            }
          } catch (e) {
            console.warn(`⚠️ workflowILSDetection: Polaris title lookup failed, using SIP2 title`, e);
          }
        }

        lastILSItemLookup = {
          title,
          holdsQueue: result?.CF ? parseInt(result.CF, 10) : null,
          itemId: barcode,
          circulationStatus: result?.circulationStatus != null ? +result.circulationStatus : null,
          raw: result,
        };
        console.log(`✅ workflowILSDetection: SIP2 identified as ITEM`, lastILSItemLookup);
        return 'isItem';
      } else {
        lastILSItemLookup = null;
        console.log(`✅ workflowILSDetection: SIP2 identified as PATRON (item not found)`);
        return 'isPatron';
      }
    } else if (isSymphony) {
      console.log(`🔍 workflowILSDetection: Symphony detection — not yet implemented`);
      return null;
    }
  } catch (error) {
    console.error(`❌ workflowILSDetection: Error during ILS detection:`, error);
  }

  return null;
}

/**
 * Determines if a scanned barcode is an item, patron, staff card, or device return
 * by checking against Firebase rules, branch rules, and making SIP requests if needed
 *
 * @param cardNumber - The scanned barcode
 * @param branch - The current branch configuration
 * @param licenseId - The license ID
 * @param device - The current device configuration
 * @param callbacks - Optional callbacks for setting library group and processing login
 * @returns 'isItem', 'isPatron', 'isStaffCard', 'isDeviceReturn', or null
 */
export async function adminFeedHoldsMode(
  cardNumber: string,
  branch: any,
  licenseId: number,
  device: any,
  callbacks?: {
    setLibraryOfThingsGroup?: (group: { name: string; groupIndex: number | null }) => void;
    processLoginUser?: (patronId: string, password: string) => void;
  }
): Promise<'isItem' | 'isPatron' | 'isStaffCard' | 'isDeviceReturn' | null> {
  try {
    cardNumber = cardNumber.toUpperCase();
    allPendingReturnItems = {};

    // Load scanning input settings from Firebase
    const scannedInputSettings = await loadScannedInputSettings();

    // Cache admin card barcode from settings
    if (scannedInputSettings?.admincardEnabled && scannedInputSettings?.admincardBarcode) {
      cachedAdminCardBarcode = scannedInputSettings.admincardBarcode;
    }

    if (scannedInputSettings) {
      console.log('🔍 Testing input against Firebase scanning rules:', cardNumber);

      // Test 0: Admin card exact match (highest priority)
      if (cachedAdminCardBarcode && cardNumber === cachedAdminCardBarcode.toUpperCase()) {
        console.log('✅ Input matched admin card barcode');
        return 'isStaffCard';
      }

      // Test 1: Staff card (highest priority)
      if (scannedInputSettings.staffcardEnabled && scannedInputSettings.staffcardRule) {
        const isStaffCard = testInputAgainstRule(cardNumber, scannedInputSettings.staffcardRule, scannedInputSettings.staffcardRuleType);
        if (isStaffCard) {
          console.log('✅ Input matched staff card rule');
          return 'isStaffCard';
        }
      }

      // Test 2: Item
      if (scannedInputSettings.itemEnabled && scannedInputSettings.itemRule) {
        const isItem = testInputAgainstRule(cardNumber, scannedInputSettings.itemRule, scannedInputSettings.itemRuleType);
        if (isItem) {
          console.log('✅ Input matched item rule — performing ILS lookup for title and circulation status');
          await workflowILSForItemVsPatronDetection(cardNumber);
          return 'isItem';
        }
      }

      // Test 3: Patron (check before ILS fallback to avoid slow network call)
      if (scannedInputSettings.patronEnabled && scannedInputSettings.patronRule) {
        const isPatron = testInputAgainstRule(cardNumber, scannedInputSettings.patronRule, scannedInputSettings.patronRuleType);
        if (isPatron) {
          console.log('✅ Input matched patron rule');
          return 'isPatron';
        }
      }

      // Test 2b: If itemEnabled is false and patron rule didn't match, use ILS to detect item vs patron
      if (!scannedInputSettings.itemEnabled) {
        console.log('🔍 itemEnabled is false — using ILS detection for barcode:', cardNumber);
        const ilsResult = await workflowILSForItemVsPatronDetection(cardNumber);
        if (ilsResult) {
          console.log(`✅ ILS detection result: ${ilsResult}`);
          return ilsResult;
        }
      }

      console.log('⚠️  Input did not match any Firebase scanning rules, falling back to legacy rules');
    }

    // Legacy fallback rules
    if (device.config.locker.settings && device.config.locker.is_holdpickup) {
      let legacyIsItem = false;
      if (licenseId === 112) {
        console.log('Skip is isItem');
      } else {
        if (branch.checkin_rules?.apply_rules) {
          const itemIdLength = branch.checkin_rules.item_digits_length;
          for (let ruleItem of branch.checkin_rules.rules) {
            if (itemIdLength && cardNumber.length === itemIdLength) {
              if (!ruleItem.is_prefix) {
                if (cardNumber.includes(ruleItem.rule)) {
                  legacyIsItem = true; break;
                }
              } else {
                if (cardNumber.includes(ruleItem.rule) && cardNumber.slice(0, ruleItem.rule.length) === ruleItem.rule) {
                  legacyIsItem = true; break;
                }
              }
            } else if (!itemIdLength) {
              if (!ruleItem.is_prefix) {
                if (cardNumber.includes(ruleItem.rule)) {
                  legacyIsItem = true; break;
                }
              } else {
                const lengthStartsAt = ruleItem.rule.includes(':') ? ruleItem.rule.indexOf(':') : undefined;
                const prefix = lengthStartsAt ? ruleItem.rule.slice(0, lengthStartsAt) : ruleItem.rule;
                const postfix = lengthStartsAt ? ruleItem.rule.slice(lengthStartsAt + 1) : undefined;
                const isMultiTest = prefix && postfix;
                // licenseId === 114
                if (
                  licenseId &&
                  isMultiTest &&
                  cardNumber.length === +postfix &&
                  cardNumber.includes(prefix) &&
                  cardNumber.slice(0, prefix.length) === prefix
                ) {
                  // Only for King country 114
                  legacyIsItem = true; break;
                } else if (cardNumber.includes(ruleItem.rule) && cardNumber.slice(0, ruleItem.rule.length) === ruleItem.rule) {
                  legacyIsItem = true; break;
                }
              }
            }
          }
        }
      }

      if (legacyIsItem) {
        console.log('✅ Legacy checkin_rules matched item — performing ILS lookup for title and circulation status');
        await workflowILSForItemVsPatronDetection(cardNumber);
        return 'isItem';
      }

      if (branch.login_rules?.apply_rules) {
        const patronIdLength = branch.login_rules.patron_digits_length;

        for (let ruleItem of branch.login_rules.rules) {
          ruleItem.rule = ruleItem.rule.toUpperCase();

          if (patronIdLength && cardNumber.length === patronIdLength) {
            if (!ruleItem.is_prefix) {
              if (cardNumber.includes(ruleItem.rule)) {
                return 'isPatron';
              }
            } else {
              if (cardNumber.includes(ruleItem.rule) && cardNumber.slice(0, ruleItem.rule.length) === ruleItem.rule) {
                return 'isPatron';
              }
            }
          } else if (!patronIdLength) {
            if (!ruleItem.is_prefix) {
              if (cardNumber.includes(ruleItem.rule)) {
                return 'isPatron';
              }
            } else {
              const lengthStartsAt = ruleItem.rule.includes(':') ? ruleItem.rule.indexOf(':') : undefined;
              const prefix = lengthStartsAt ? ruleItem.rule.slice(0, lengthStartsAt) : ruleItem.rule;
              const postfix = lengthStartsAt ? ruleItem.rule.slice(lengthStartsAt + 1) : undefined;
              const isMultiTest = prefix && postfix;
              // licenseId === 114
              if (
                licenseId &&
                isMultiTest &&
                cardNumber.length === +postfix &&
                cardNumber.includes(prefix) &&
                cardNumber.slice(0, prefix.length) === prefix
              ) {
                // Only for King country 114
                // On May 14, 2022 20:13, Cynthia Rivette <ccrivette@kcls.org> wrote:
                // Patron barcodes starting with 9 are 10 digits long.  Item barcodes starting with 9 are 8 digits long.
                // Cynthia R
                return 'isPatron';
              } else if (cardNumber.includes(ruleItem.rule) && cardNumber.slice(0, ruleItem.rule.length) === ruleItem.rule) {
                return 'isPatron';
              }
            }
          }
        }

        if (licenseId === 112) {
          // if you came this far, and license is Neosho, just assume it's isItem
          await workflowILSForItemVsPatronDetection(cardNumber);
          return 'isItem';
        }
      }

      if (!branch.login_rules?.apply_rules && !branch.checkin_rules?.apply_rules && licenseId !== 7 && licenseId !== 1 && licenseId !== 2) {
        try {
          // If SIP2 is enabled, make a real itemInfo request to read circulation status
          if (branch?.sip2Settings?.enabled) {
            console.log(`🔍 Legacy fallback: SIP2 itemInfo for ${cardNumber}`);
            const sipItemInfo: any = await sip2ItemInfoDirect(cardNumber);
            console.log(`🔍 Legacy fallback: SIP2 itemInfo response:`, sipItemInfo);

            const isValidItem = validateItemInfo(sipItemInfo, cardNumber);

            if (
              isValidItem &&
              !sipItemInfo.screenMessage?.includes('Item not found in catalog') &&
              !sipItemInfo.titleIdentifier?.includes('Invalid item') &&
              !sipItemInfo.AF?.includes('Item not found') &&
              !sipItemInfo.AF?.includes('Please press Request Help for assistance') &&
              !sipItemInfo.AG?.includes('The item does not exist')
            ) {
              let title = sipItemInfo?.titleIdentifier || sipItemInfo?.AJ || null;

              // If Polaris is also enabled, prefer Polaris title
              if (branch?.polarisSettings?.enabled) {
                try {
                  const branchId = branch?.id;
                  console.log(`🔍 Legacy fallback: Polaris title lookup for ${cardNumber}`);
                  const url = `${POLARIS_API_BASE}/${licenseId}/${branchId}/items/lookup?itemBarcode=${encodeURIComponent(cardNumber)}`;
                  const polarisRes = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
                  const polarisData = await polarisRes.json();
                  if (polarisRes.ok && polarisData?.PAPIErrorCode === 0) {
                    const findByLabel = (obj: any, label: string): any => {
                      if (!obj || typeof obj !== 'object') return undefined;
                      if (obj.Label === label && obj.Value !== undefined) return obj.Value;
                      const children = Array.isArray(obj) ? obj : Object.values(obj);
                      for (const child of children) {
                        const found = findByLabel(child, label);
                        if (found !== undefined) return found;
                      }
                      return undefined;
                    };
                    const polarisTitle = findByLabel(polarisData, 'Title:') || null;
                    if (polarisTitle) {
                      console.log(`✅ Legacy fallback: Using Polaris title:`, polarisTitle);
                      title = polarisTitle;
                    }
                  }
                } catch (e) {
                  console.warn(`⚠️ Legacy fallback: Polaris title lookup failed, using SIP2 title`, e);
                }
              }

              lastILSItemLookup = {
                title,
                holdsQueue: sipItemInfo?.CF ? parseInt(sipItemInfo.CF, 10) : null,
                itemId: cardNumber,
                circulationStatus: sipItemInfo?.circulationStatus != null ? +sipItemInfo.circulationStatus : null,
                raw: sipItemInfo,
              };
              console.log(`✅ Legacy fallback: SIP2 identified as ITEM`, lastILSItemLookup);
              return 'isItem';
            } else {
              lastILSItemLookup = null;
              return 'isPatron';
            }
          } else {
            // No SIP2 — use hardcoded mock (always returns isPatron)
            return 'isPatron';
          }
        } catch (error) {
          console.log('Not an item, must be patron... let ILS to fail fo not');
        }
        return 'isPatron';
      }

      if (licenseId !== 7) {
        return 'isPatron';
      }
      return null;
    } else {
      // Device return mode
      if (device.config.locker.scan_to_return) {
        allPendingReturnItems = findItemIDFromLocker(cardNumber, device);

        if (!!allPendingReturnItems && allPendingReturnItems.patronId) {
          if (callbacks?.setLibraryOfThingsGroup) {
            callbacks.setLibraryOfThingsGroup({ name: 'RETURNS', groupIndex: null });
          }
          if (callbacks?.processLoginUser) {
            callbacks.processLoginUser(allPendingReturnItems.patronId, '');
          }
          return 'isDeviceReturn';
        } else {
          return 'isPatron';
        }
      } else {
        return 'isPatron';
      }
    }
  } catch (error) {
    return null;
  }
}
