// Device service for Firebase Realtime Database (Kiosk)
import { ref, onValue, off, set, update, DataSnapshot, getDatabase } from 'firebase/database'
import { getFirebaseApp, getFirebaseDatabase, registerLicenseDatabase } from './firebase-client'
import type { Device, DeviceManifest, Locker, LockerGroup, LockerStatus } from '../../../../types/device-types'

// Re-export types for backward compatibility
export type { Device, DeviceManifest, Locker, LockerGroup, LockerStatus }

class KioskDeviceService {
  private currentLicenseDatabase: any = null
  private currentLicenseId: string | null = null

  /**
   * Set the database URL for the current license
   * This should be called after loading the license
   */
  setLicenseDatabaseUrl(licenseId: string, databaseUrl: string) {
    try {
      console.log('🔄 Setting license database URL:', licenseId, databaseUrl)

      const app = getFirebaseApp()
      this.currentLicenseDatabase = getDatabase(app, databaseUrl)
      this.currentLicenseId = licenseId

      // Register in shared cache so other services (transaction-service) can reuse it
      registerLicenseDatabase(licenseId, this.currentLicenseDatabase)

      console.log('✅ License database configured for:', licenseId)
    } catch (error) {
      console.error('❌ Error setting license database URL:', error)
      throw error
    }
  }

  /**
   * Get the database instance for the current license
   */
  private getDatabase(): any {
    if (this.currentLicenseDatabase) {
      return this.currentLicenseDatabase
    }

    // Fallback to default database
    console.warn('⚠️  Using default database, license-specific database not configured')
    return getFirebaseDatabase()
  }

  /**
   * Subscribe to device changes
   * deviceId is the Firebase document key (from localConfig.json)
   */
  subscribeToDevice(deviceId: string, callback: (device: Device | null) => void, licenseId?: string): () => void {
    try {
      const db = this.getDatabase()
      const effectiveLicenseId = licenseId || this.currentLicenseId

      if (!effectiveLicenseId) {
        throw new Error('License ID not configured')
      }

      const path = `license_${effectiveLicenseId}/devices/${deviceId}`
      const deviceRef = ref(db, path)

      console.log(`📡 Subscribing to device at: ${path}`)

      const unsubscribe = onValue(deviceRef, (snapshot: DataSnapshot) => {
        if (!snapshot.exists()) {
          console.log('❌ Device not found at path:', path)
          callback(null)
          return
        }

        const deviceData = snapshot.val()

        // Normalize thedoors: Firebase RTDB may return an object instead of an array
        let normalizedTheDoors: any[] = [];
        if (Array.isArray(deviceData.thedoors)) {
          normalizedTheDoors = deviceData.thedoors.filter(Boolean);
        } else if (deviceData.thedoors && typeof deviceData.thedoors === 'object') {
          normalizedTheDoors = Object.values(deviceData.thedoors).filter(Boolean);
          console.log(`📡 Normalized thedoors from object to array: ${normalizedTheDoors.length} doors`);
        }

        const device: Device = {
          id: deviceId,
          deviceId: deviceId, // device.id is now the only identifier
          settings: deviceData.settings || null,
          branchId: deviceData.branchId || undefined,
          deviceType: deviceData.deviceType || 'Unknown Type',
          enabled: deviceData.enabled !== false,
          status: deviceData.status || null, // Door status object: { "1": { isOpen: true }, "2": {...} }
          createdAt: deviceData.createdAt,
          licenseId: effectiveLicenseId,
          manifest: deviceData.manifest || null,
          thedoors: normalizedTheDoors,
          homescreen: deviceData.homescreen || null,
          posters: deviceData.posters || null,
          allowOfflineMode: deviceData.allowOfflineMode || false,
          deviceMaintenance: deviceData.deviceMaintenance || null,
          isHoldLocker: deviceData.isHoldLocker || false,
          isLoTLocker: deviceData.isLoTLocker || false,
          scannedinput: deviceData.scannedinput || null,
        }

        callback(device)
      }, (error) => {
        console.error('❌ Error in device subscription:', error)
        callback(null)
      })

      return () => {
        off(deviceRef, 'value', unsubscribe)
      }
    } catch (error) {
      console.error('❌ Error subscribing to device:', error)
      return () => {}
    }
  }

  /**
   * Update device door/locker status in RTDB
   * Status format: { MAC, doorNumber, hwIndex, integrationHwId, ip, isOpen }
   * Stores as: status/<doorNumber> = { isOpen, MAC, ip, ... }
   * This allows status.<doorNumber>.isOpen to be read by door grid
   */
  async updateDoorStatus(deviceId: string, status: any, licenseId?: string): Promise<void> {
    try {
      const db = this.getDatabase()
      const effectiveLicenseId = licenseId || this.currentLicenseId

      if (!effectiveLicenseId) {
        throw new Error('License ID not configured')
      }

      const doorNumber = status.doorNumber
      if (!doorNumber) {
        console.warn('⚠️ updateDoorStatus called without doorNumber, storing as generic status')
        const path = `license_${effectiveLicenseId}/devices/${deviceId}/status`
        const statusRef = ref(db, path)
        await set(statusRef, { ...status, updatedAt: new Date().toISOString() })
        return
      }

      // Store status per door number: status/<doorNumber> = { isOpen, ... }
      // This matches the expected format: device.status[doorNumber].isOpen
      const path = `license_${effectiveLicenseId}/devices/${deviceId}/status/${doorNumber}`
      const statusRef = ref(db, path)

      const statusData = {
        ...status,
        updatedAt: new Date().toISOString()
      }

      await set(statusRef, statusData)
      console.log(`✅ Door ${doorNumber} status updated in RTDB:`, statusData.isOpen ? 'OPEN' : 'CLOSED')
    } catch (error: any) {
      console.error('❌ Error updating door status:', error)
      throw new Error(`Failed to update door status: ${error.message || 'Unknown error'}`)
    }
  }
}

// Export singleton instance
export const deviceService = new KioskDeviceService()
