// Firebase Client SDK configuration for Kiosk
import { initializeApp, getApps, FirebaseApp } from 'firebase/app'
import { getAuth, Auth, signInWithEmailAndPassword } from 'firebase/auth'
import { getFirestore, Firestore } from 'firebase/firestore'
import { getDatabase, Database } from 'firebase/database'
import { getStorage, FirebaseStorage } from 'firebase/storage'
import { getFirebaseAuthCredentials } from '../../../config'

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDkLFi9dmDS0jEfpTd-n1gO8I-kReGO9rg",
  authDomain: "library-456310.firebaseapp.com",
  databaseURL: "https://library-456310-default-rtdb.firebaseio.com",
  projectId: "library-456310",
  storageBucket: "library-456310.firebasestorage.app",
  messagingSenderId: "227749002819",
  appId: "1:227749002819:web:de5476d0afef0f6656def6",
  measurementId: "G-3VLTQ292MY"
}

// Initialize Firebase (only initialize once)
let app: FirebaseApp | null = null
let auth: Auth | null = null
let db: Firestore | null = null
let rtdb: Database | null = null
let storage: FirebaseStorage | null = null

export const getFirebaseApp = (): FirebaseApp => {
  if (app) {
    return app
  }

  try {
    // Check if already initialized
    const existingApps = getApps()
    if (existingApps.length > 0) {
      app = existingApps[0]
      console.log('Firebase Client: Using existing app')
      return app
    }

    // Check if we have valid configuration
    if (!firebaseConfig.apiKey) {
      throw new Error('Firebase API key not configured')
    }

    // Initialize Firebase
    app = initializeApp(firebaseConfig)
    console.log('Firebase Client initialized successfully')
    return app
  } catch (error) {
    console.error('Firebase Client initialization error:', error)
    throw error
  }
}

// Get Auth instance
export const getFirebaseAuth = (): Auth => {
  if (auth) {
    return auth
  }

  const firebaseApp = getFirebaseApp()
  auth = getAuth(firebaseApp)

  return auth
}

// Get Firestore instance
export const getFirebaseFirestore = (): Firestore => {
  if (db) {
    return db
  }

  const firebaseApp = getFirebaseApp()
  db = getFirestore(firebaseApp)

  return db
}

// Get Realtime Database instance (default)
export const getFirebaseDatabase = (): Database => {
  if (rtdb) {
    return rtdb
  }

  const firebaseApp = getFirebaseApp()
  rtdb = getDatabase(firebaseApp)

  return rtdb
}

// Cache for license-specific database instances
const licenseDatabases: Map<string, Database> = new Map()

/**
 * Get license-specific Realtime Database instance
 * @param licenseId The license ID
 * @returns Database instance for the license-specific database
 */
/**
 * Register an externally-created database instance so getLicenseDatabase can reuse it.
 * Call this from any service that calls getDatabase(app, url) directly
 * (e.g. device-service, firebase-pubsub-service) to prevent
 * "Database initialized multiple times" errors.
 */
export const registerLicenseDatabase = (licenseId: number | string, db: Database): void => {
  const licenseKey = String(licenseId)
  if (!licenseDatabases.has(licenseKey)) {
    console.log(`registerLicenseDatabase: registered DB for license ${licenseKey}`)
    licenseDatabases.set(licenseKey, db)
  }
}

export const getLicenseDatabase = (licenseId: number | string): Database => {
  const licenseKey = String(licenseId)

  // Return cached instance if exists
  if (licenseDatabases.has(licenseKey)) {
    return licenseDatabases.get(licenseKey)!
  }

  // Create new instance for this license
  const firebaseApp = getFirebaseApp()
  const databaseURL = `https://library-456310-license${licenseId}-rtdb.firebaseio.com`

  console.log(`getLicenseDatabase: creating DB for license ${licenseId}:`, databaseURL)

  const licenseDb = getDatabase(firebaseApp, databaseURL)
  licenseDatabases.set(licenseKey, licenseDb)

  return licenseDb
}

// Get Storage instance
export const getFirebaseStorage = (): FirebaseStorage => {
  if (storage) {
    return storage
  }

  const firebaseApp = getFirebaseApp()
  storage = getStorage(firebaseApp)

  return storage
}

// Initialize all Firebase services
export function initializeFirebaseClients() {
  try {
    if (!auth) auth = getFirebaseAuth()
    if (!db) db = getFirebaseFirestore()
    if (!rtdb) rtdb = getFirebaseDatabase()
    if (!storage) storage = getFirebaseStorage()
    console.log('All Firebase clients initialized')
  } catch (error) {
    console.error('Failed to initialize Firebase clients:', error)
  }
}

// Track authentication state
let isAuthenticated = false
let authenticationPromise: Promise<void> | null = null

/**
 * Authenticate with Firebase using credentials from config.ts
 * This function ensures only one authentication attempt is in progress at a time
 * @param licenseId Optional license ID to use for authentication
 * @returns Promise that resolves when authenticated
 */
export async function authenticateFirebase(licenseId?: number | string): Promise<void> {
  // If already authenticated, return immediately
  if (isAuthenticated) {
    return Promise.resolve()
  }

  // If authentication is in progress, return the existing promise
  if (authenticationPromise) {
    return authenticationPromise
  }

  // Start authentication
  authenticationPromise = (async () => {
    try {
      const authInstance = getFirebaseAuth()
      const credentials = getFirebaseAuthCredentials(licenseId)

      console.log('🔐 Authenticating with Firebase...', credentials.email)

      await signInWithEmailAndPassword(authInstance, credentials.email, credentials.password)

      isAuthenticated = true
      console.log('✅ Firebase authentication successful')
    } catch (error: any) {
      console.error('❌ Firebase authentication failed:', error)
      throw error
    } finally {
      authenticationPromise = null
    }
  })()

  return authenticationPromise
}

/**
 * Check if Firebase is currently authenticated
 */
export function isFirebaseAuthenticated(): boolean {
  return isAuthenticated
}

/**
 * Get the current Firebase auth token for REST API calls
 * @returns Promise with the ID token string
 */
export async function getFirebaseAuthToken(forceRefresh = false): Promise<string | null> {
  try {
    const authInstance = getFirebaseAuth()
    const user = authInstance.currentUser

    if (!user) {
      console.warn('No authenticated user found')
      return null
    }

    // Get ID token - force refresh if requested or if token might be stale
    const token = await user.getIdToken(forceRefresh)
    return token
  } catch (error) {
    console.error('Error getting Firebase auth token:', error)
    return null
  }
}

// Export instances
export { auth, db, rtdb, storage }
