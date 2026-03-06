// Firestore operations for Kiosk
import { getFirebaseFirestore, authenticateFirebase, getFirebaseApp, getFirebaseStorage, getFirebaseAuth } from './firebase-client';
import { collection, query, where, getDocs, doc, getDoc, updateDoc, addDoc, getFirestore, arrayUnion } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';

/**
 * Interface for patron data
 */
export interface Patron {
  patronId: string;
  sideevent_id: string;
  name?: string;
  keyword: string;
  email?: string | null;
  blocks?: Array<{
    active: boolean;
    timestamp: any;
    deviceId: string;
  }>;
  cooldown_until?: number;
  isAda?: boolean;
  side_events?: {
    lockers?: Array<{
      preference: string;
      timestamp: number;
      branch_code: string;
      name: string;
      id: string;
    }>;
  };
  [key: string]: any; // Allow additional fields
}

/**
 * Result from getting a patron
 */
export interface PatronResult {
  patron: Patron | null;
  patronKey: string | null;
}

/**
 * Get patron by identifier from Firestore
 * @param licenseId License ID
 * @param identifier Patron identifier (card number)
 * @returns PatronResult with patron data and document key
 */
export async function getPatronByIdentifier(
  licenseId: number | string,
  identifier: string
): Promise<PatronResult> {
  // Authenticate with Firebase before querying
  await authenticateFirebase(licenseId);

  // Query Firestore for patron by identifier
  const db = getFirebaseFirestore();
  const patronsRef = collection(db, `licenses/${licenseId}/patrons`);
  const patronQuery = query(patronsRef, where('patronId', '==', identifier));
  const snapshot = await getDocs(patronQuery);

  let patron: Patron | null = null;
  let patronKey: string | null = null;

  if (!snapshot.empty) {
    // Get first matching patron (should be only one)
    const firstDoc = snapshot.docs[0];
    patronKey = firstDoc.id;
    patron = firstDoc.data() as Patron;
  }

  return { patron, patronKey };
}

/**
 * Create a new patron in Firestore
 * @param licenseId License ID
 * @param patronData Patron data to create
 * @returns PatronResult with created patron data and document key
 */
export async function createPatron(
  licenseId: number | string,
  patronData: Partial<Patron>
): Promise<PatronResult> {
  // Authenticate with Firebase before creating
  await authenticateFirebase(licenseId);

  const db = getFirebaseFirestore();
  const patronsRef = collection(db, `licenses/${licenseId}/patrons`);

  // Create new patron in Firestore
  const newPatronRef = await addDoc(patronsRef, patronData);
  const patronKey = newPatronRef.id;

  return {
    patron: patronData as Patron,
    patronKey,
  };
}

/**
 * Update patron in Firestore
 * @param licenseId License ID
 * @param patronKey Patron document key
 * @param updates Patron fields to update
 */
export async function updatePatron(
  licenseId: number | string,
  patronKey: string,
  updates: Partial<Patron>
): Promise<void> {
  // Authenticate with Firebase before updating
  await authenticateFirebase(licenseId);

  const db = getFirebaseFirestore();
  const patronRef = doc(db, `licenses/${licenseId}/patrons`, patronKey);
  await updateDoc(patronRef, updates);
}

/**
 * Track new patron usage on a device.
 * If the patron's usedDevices array doesn't include the deviceId, adds it
 * and creates a new_patron transaction event.
 * Fire-and-forget — errors are logged but don't propagate.
 */
export async function trackNewPatronUsage(
  licenseId: number | string,
  patronKey: string,
  deviceId: string,
  patronId: string,
  itemIds: string[],
  doorNumber: string | number,
  groupName?: string
): Promise<void> {
  try {
    await authenticateFirebase(licenseId);
    const db = getFirebaseFirestore();
    const patronRef = doc(db, `licenses/${licenseId}/patrons`, patronKey);
    const patronSnap = await getDoc(patronRef);

    if (!patronSnap.exists()) return;
    const patronData = patronSnap.data();
    const usedDevices: string[] = patronData.usedDevices || [];
    if (usedDevices.includes(deviceId)) return;

    await updateDoc(patronRef, { usedDevices: arrayUnion(deviceId) });

    const { createNewPatronEvent } = await import('./transaction-service');
    await createNewPatronEvent({
      itemIds,
      patronId,
      doorNumber,
      groupName,
      success: true,
      metadata: { createdVia: 'kiosk' }
    });
  } catch (err) {
    console.error('Failed to track new patron:', err);
  }
}

/**
 * Add a waiver approval to a patron's waivers array in Firestore.
 * Uploads the rendered waiver HTML to Firebase Storage, then saves
 * a proper PatronWaiver record (id, date, lockerName, fileUrl, fileName)
 * to the patron document — matching the sideevent admin flow.
 *
 * @param licenseId License ID
 * @param patronKey Patron document key (Firestore doc ID)
 * @param lockerName Name of the locker/device group
 * @param renderedHtml The waiver HTML with variables already substituted
 */
export async function addWaiverToPatron(
  licenseId: number | string,
  patronKey: string,
  lockerName: string,
  renderedHtml: string
): Promise<void> {
  console.log(`📋 addWaiverToPatron: START — license=${licenseId}, patronKey=${patronKey}, lockerName=${lockerName}, htmlLen=${renderedHtml?.length}`);

  console.log(`📋 Step 0: authenticating...`);
  await authenticateFirebase(licenseId);
  console.log(`✅ Step 0: authenticated`);

  const timestamp = Date.now();
  const fileName = `waiver_${lockerName.replace(/\s+/g, '_')}_${timestamp}.html`;
  let downloadUrl = '';

  // 1. Try to upload rendered waiver HTML to Firebase Storage
  try {
    const storage = getFirebaseStorage();
    const filePath = `license_${licenseId}/patrons/${patronKey}/${fileName}`;
    const fileRef = storageRef(storage, filePath);

    console.log(`📋 Step 1: uploading waiver to Storage at ${filePath}`);
    const blob = new Blob([renderedHtml], { type: 'text/html' });
    await uploadBytes(fileRef, blob, {
      contentType: 'text/html',
      customMetadata: {
        patronKey,
        lockerName,
        uploadedBy: getFirebaseAuth()?.currentUser?.email || 'kiosk',
      },
    });
    downloadUrl = await getDownloadURL(fileRef);
    console.log(`✅ Step 1: waiver uploaded to Storage, URL: ${downloadUrl}`);
  } catch (storageErr: any) {
    console.error(`⚠️ Step 1 FAILED (Storage upload) — will still save waiver to Firestore without file:`, storageErr?.message || storageErr);
  }

  // 2. Build PatronWaiver record (matches shared PatronWaiver type)
  const newWaiver = {
    id: `waiver_${timestamp}`,
    date: new Date().toISOString(),
    lockerName,
    fileUrl: downloadUrl,
    fileName: downloadUrl ? fileName : '',
  };
  console.log(`📋 Step 2: built waiver record:`, JSON.stringify(newWaiver));

  // 3. Read existing waivers, normalize dates, append new waiver
  console.log(`📋 Step 3: reading patron doc...`);
  const db = getFirebaseFirestore();
  const patronRef = doc(db, `licenses/${licenseId}/patrons`, patronKey);
  const patronDoc = await getDoc(patronRef);

  if (!patronDoc.exists()) {
    console.error(`❌ Step 3 FAILED: patron doc not found at licenses/${licenseId}/patrons/${patronKey}`);
    throw new Error(`Patron document not found: ${patronKey}`);
  }

  const patronData = patronDoc.data();
  console.log(`✅ Step 3: patron doc found, existing waivers: ${JSON.stringify(patronData?.waivers?.length || 0)}`);

  const existingWaivers = (patronData?.waivers || []).map((w: any) => ({
    ...w,
    date: w.date instanceof Date ? w.date.toISOString() : (w.date?.toDate ? w.date.toDate().toISOString() : w.date),
  }));
  const updatedWaivers = [...existingWaivers, newWaiver];

  // 4. Write full waivers array back to patron doc
  console.log(`📋 Step 4: updating Firestore doc with ${updatedWaivers.length} waivers...`);
  await updateDoc(patronRef, {
    waivers: updatedWaivers,
    updatedAt: new Date().toISOString(),
  });
  console.log(`✅ Step 4 DONE — waiver added to patron ${patronKey} for locker: ${lockerName}`);
}

/**
 * Get or create patron by identifier
 * If patron doesn't exist, creates a new one with provided data
 * @param licenseId License ID
 * @param identifier Patron identifier
 * @param defaultPatronData Default patron data if creating new patron
 * @returns PatronResult with patron data and document key
 */
export async function getOrCreatePatron(
  licenseId: number | string,
  identifier: string,
  defaultPatronData: Partial<Patron>
): Promise<PatronResult> {
  // Try to get existing patron
  let result = await getPatronByIdentifier(licenseId, identifier);

  // If patron doesn't exist, create new one
  if (!result.patron) {
    result = await createPatron(licenseId, {
      patronId: identifier,
      license_id: licenseId,
      sideevent_id: `${licenseId}-${identifier}`,
      ...defaultPatronData,
    });
  }

  return result;
}

/**
 * Interface for branch data
 */
export interface Branch {
  id: string;
  branch_code: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  [key: string]: any; // Allow additional fields
}

/**
 * Get all branches from Firestore for a license
 * @param licenseId License ID
 * @returns Array of branches
 */
export async function getAllBranches(licenseId: number | string): Promise<Branch[]> {
  // Authenticate with Firebase before querying
  await authenticateFirebase(licenseId);

  const db = getFirebaseFirestore();
  const branchesRef = collection(db, `licenses/${licenseId}/branches`);
  const snapshot = await getDocs(branchesRef);

  const branches: Branch[] = [];
  snapshot.forEach((doc) => {
    branches.push({
      id: doc.id,
      ...doc.data()
    } as Branch);
  });

  return branches;
}

/**
 * Load branches from Firestore and save to localStorage
 * @param licenseId License ID
 * @returns Array of branches
 */
export async function loadAndCacheBranches(licenseId: number | string): Promise<Branch[]> {
  console.log('🔄 Loading branches from Firestore...');

  try {
    const branches = await getAllBranches(licenseId);

    console.log(`✅ Loaded ${branches.length} branches from Firestore`);

    // Save to localStorage
    localStorage.setItem('branches', JSON.stringify(branches));
    console.log('💾 Saved branches to localStorage');

    return branches;
  } catch (error) {
    console.error('❌ Error loading branches from Firestore:', error);

    // Try to load from localStorage as fallback
    const cachedBranches = localStorage.getItem('branches');
    if (cachedBranches) {
      console.log('⚠️  Using cached branches from localStorage');
      return JSON.parse(cachedBranches);
    }

    throw error;
  }
}

/**
 * Interface for license data
 */
export interface License {
  id: string;
  name: string;
  description?: string;
  address?: string;
  contact?: string;
  email?: string;
  isActive: boolean;
  databaseUrl: string;
  applications?: string[];
  createdAt?: Date;
  updatedAt?: Date;
  [key: string]: any; // Allow additional fields
}

/**
 * Get license by ID from Firestore
 * @param licenseId License ID
 * @returns License data or null if not found
 */
export async function getLicenseById(licenseId: number | string): Promise<License | null> {
  // Authenticate with Firebase before querying
  await authenticateFirebase(licenseId);

  const db = getFirebaseFirestore();
  const licenseRef = doc(db, 'licenses', String(licenseId));
  const licenseDoc = await getDoc(licenseRef);

  if (!licenseDoc.exists()) {
    console.error('❌ License not found:', licenseId);
    return null;
  }

  const data = licenseDoc.data();
  const license: License = {
    id: licenseDoc.id,
    name: data.name || '',
    description: data.description || '',
    address: data.address || '',
    contact: data.contact || '',
    email: data.email || '',
    isActive: data.isActive ?? true,
    databaseUrl: data.databaseUrl || '',
    applications: data.applications || [],
    createdAt: data.createdAt?.toDate() || new Date(),
    updatedAt: data.updatedAt?.toDate() || new Date(),
  };

  return license;
}

/**
 * Load license from Firestore and save to localStorage
 * @param licenseId License ID
 * @returns License data
 */
export async function loadAndCacheLicense(licenseId: number | string): Promise<License | null> {
  console.log('🔄 Loading license from Firestore...');

  try {
    const license = await getLicenseById(licenseId);

    if (!license) {
      console.error('❌ License not found:', licenseId);

      // Try to load from localStorage as fallback
      const cachedLicense = localStorage.getItem('license');
      if (cachedLicense) {
        console.log('⚠️  Using cached license from localStorage');
        return JSON.parse(cachedLicense);
      }

      return null;
    }

    console.log('✅ Loaded license from Firestore:', license.name);
    console.log('   Database URL:', license.databaseUrl);

    // Save to localStorage
    localStorage.setItem('license', JSON.stringify(license));
    console.log('💾 Saved license to localStorage');

    return license;
  } catch (error) {
    console.error('❌ Error loading license from Firestore:', error);

    // Try to load from localStorage as fallback
    const cachedLicense = localStorage.getItem('license');
    if (cachedLicense) {
      console.log('⚠️  Using cached license from localStorage');
      return JSON.parse(cachedLicense);
    }

    throw error;
  }
}

/**
 * Interface for integration data
 */
export interface Integration {
  id: string;
  name?: string;
  type?: string;
  macId?: string;
  ip?: string;
  bindDeviceId?: string;
  enabled?: boolean;
  [key: string]: any; // Allow additional fields
}

/**
 * Get all integrations from Firestore for a license
 * @param licenseId License ID
 * @returns Array of integrations
 */
export async function getAllIntegrations(licenseId: number | string): Promise<Integration[]> {
  // Authenticate with Firebase before querying
  await authenticateFirebase(licenseId);

  const db = getFirebaseFirestore();
  const integrationsRef = collection(db, `licenses/${licenseId}/integrations`);
  const snapshot = await getDocs(integrationsRef);

  const integrations: Integration[] = [];
  snapshot.forEach((doc) => {
    integrations.push({
      id: doc.id,
      ...doc.data()
    } as Integration);
  });

  return integrations;
}

/**
 * Get integration bound to a specific device
 * @param licenseId License ID
 * @param deviceId Device ID (the Firebase key like "1760724910566_xsnvrb0l5")
 * @returns Integration data or null if not found
 */
export async function getIntegrationForDevice(
  licenseId: number | string,
  deviceId: string
): Promise<Integration | null> {
  // Authenticate with Firebase before querying
  await authenticateFirebase(licenseId);

  const db = getFirebaseFirestore();
  const integrationsRef = collection(db, `licenses/${licenseId}/integrations`);
  const integrationQuery = query(integrationsRef, where('bindDeviceId', '==', deviceId));
  const snapshot = await getDocs(integrationQuery);

  if (snapshot.empty) {
    console.log(`No integration found for device: ${deviceId}`);
    return null;
  }

  // Get first matching integration (should be only one)
  const firstDoc = snapshot.docs[0];
  return {
    id: firstDoc.id,
    ...firstDoc.data()
  } as Integration;
}

/**
 * Load integrations from Firestore and save to localStorage
 * @param licenseId License ID
 * @param deviceId Optional device ID to filter integrations bound to this device
 * @returns Array of integrations (or single integration if deviceId provided)
 */
export async function loadAndCacheIntegrations(
  licenseId: number | string,
  deviceId?: string
): Promise<Integration[]> {
  console.log('🔄 Loading integrations from Firestore...');

  try {
    let integrations: Integration[];

    if (deviceId) {
      // Load only integration for specific device
      console.log(`   Filtering for device: ${deviceId}`);
      const integration = await getIntegrationForDevice(licenseId, deviceId);
      integrations = integration ? [integration] : [];
    } else {
      // Load all integrations
      integrations = await getAllIntegrations(licenseId);
    }

    console.log(`✅ Loaded ${integrations.length} integration(s) from Firestore`);

    if (integrations.length > 0) {
      integrations.forEach(int => {
        console.log(`   - ${int.name || int.id}: macId=${int.macId}, ip=${int.ip}, bindDeviceId=${int.bindDeviceId}`);
      });
    }

    // Save to localStorage
    localStorage.setItem('integrations', JSON.stringify(integrations));
    localStorage.setItem('integrations_licenseId', String(licenseId));
    localStorage.setItem('integrations_timestamp', new Date().toISOString());
    console.log('💾 Saved integrations to localStorage');

    return integrations;
  } catch (error) {
    console.error('❌ Error loading integrations from Firestore:', error);

    // Try to load from localStorage as fallback
    const cachedIntegrations = localStorage.getItem('integrations');
    if (cachedIntegrations) {
      console.log('⚠️  Using cached integrations from localStorage');
      return JSON.parse(cachedIntegrations);
    }

    throw error;
  }
}

/**
 * Interface for localization data
 * Each document in /localizations/ collection represents a language
 */
export interface Localization {
  id: string; // Document ID is the language code (e.g., 'en', 'es', 'fr')
  displayName?: string;
  iconUrl?: string;
  translations?: {
    [key: string]: any; // SAAS translations
  };
  [key: string]: any; // Allow additional fields
}

/**
 * Get all localizations from Firestore
 * Reads from root /localizations/ collection
 * @param licenseId License ID (for authentication)
 * @returns Object with language codes as keys and localization data as values
 */
export async function getAllLocalizations(licenseId: number | string): Promise<{ [langCode: string]: Localization }> {
  // Authenticate with Firebase before querying
  await authenticateFirebase(licenseId);

  const db = getFirebaseFirestore();
  const localizationsRef = collection(db, 'localizations');
  const snapshot = await getDocs(localizationsRef);

  const localizations: { [langCode: string]: Localization } = {};
  snapshot.forEach((doc) => {
    const langCode = doc.id;
    localizations[langCode] = {
      id: langCode,
      ...doc.data()
    } as Localization;
  });

  return localizations;
}

/**
 * Load localizations from Firestore and save to localStorage
 * @param licenseId License ID (for authentication)
 * @returns Object with language codes as keys and localization data as values
 */
export async function loadAndCacheLocalizations(licenseId: number | string): Promise<{ [langCode: string]: Localization }> {
  console.log('🌐 Loading localizations from Firestore...');

  try {
    const localizations = await getAllLocalizations(licenseId);
    const langCodes = Object.keys(localizations);

    console.log(`✅ Loaded ${langCodes.length} localizations from Firestore`);
    langCodes.forEach(code => {
      console.log(`   - ${code}: ${localizations[code].displayName || code}`);
    });

    // Save to localStorage
    localStorage.setItem('firestoreLocalizations', JSON.stringify(localizations));
    localStorage.setItem('firestoreLocalizations_timestamp', new Date().toISOString());
    console.log('💾 Saved localizations to localStorage');

    return localizations;
  } catch (error) {
    console.error('❌ Error loading localizations from Firestore:', error);

    // Try to load from localStorage as fallback
    const cachedLocalizations = localStorage.getItem('firestoreLocalizations');
    if (cachedLocalizations) {
      console.log('⚠️  Using cached localizations from localStorage');
      return JSON.parse(cachedLocalizations);
    }

    // Return empty object if no cache available
    return {};
  }
}
