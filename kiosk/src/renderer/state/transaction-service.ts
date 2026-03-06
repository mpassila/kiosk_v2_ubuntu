// Transaction service for Kiosk - writes to Firebase Realtime Database
// Mirrors sideevent/lib/transactions-service.ts but uses kiosk Firebase client
import { ref, set } from 'firebase/database'
import { getLicenseDatabase, getFirebaseAuth } from './firebase-client'
import { sessionLicenseId, sessionDevice, kioskConfig } from './shared'
import type { TransactionType, TransactionCreateData } from '../../../types/transactions-types'

export type { TransactionType, TransactionCreateData }

/**
 * Create a transaction in Firebase RTDB
 * Path: license_{licenseId}/transactions/{type}/{timestamp}
 */
async function createTransaction(data: TransactionCreateData): Promise<string> {
  const auth = getFirebaseAuth()
  const currentUser = auth.currentUser

  if (!currentUser) {
    throw new Error('Not authenticated with Firebase')
  }

  const db = getLicenseDatabase(data.licenseId)
  const timestamp = Date.now()
  const transactionPath = `license_${data.licenseId}/transactions/${data.type}/${timestamp}`
  const transactionRef = ref(db, transactionPath)

  const transaction = {
    type: data.type,
    transactionType: data.transactionType || 'transaction',
    licenseId: data.licenseId,
    deviceId: data.deviceId,
    deviceName: data.deviceName || '',
    doorNumber: data.doorNumber || '',
    groupId: data.groupId || '',
    lockerKey: data.lockerKey || '',
    itemIds: data.itemIds || [],
    patronId: data.patronId,
    timestamp,
    createdBy: currentUser.uid,
    createdByEmail: currentUser.email,
    success: data.success !== undefined ? data.success : true,
    metadata: data.metadata || {}
  }

  await set(transactionRef, transaction)
  console.log(`✅ Transaction [${data.type}] created at ${transactionPath}`)
  return timestamp.toString()
}

// ---- Convenience methods for each action type ----
//
// transactionType rules:
//   'transaction' — checkin, checkout, hold
//   'event'       — everything else (add_item, remove_item, add_hold_item,
//                    remove_hold_item, expired_hold, return_item,
//                    enforce_checkin, cancelled_hold)

interface LockerTransactionParams {
  itemIds: string[]
  patronId: string
  doorNumber: string | number
  groupName?: string
  lockerKey?: string
  success?: boolean
  metadata?: Record<string, any>
}

function getBaseData(type: TransactionType, params: LockerTransactionParams): TransactionCreateData {
  const licenseId = String(sessionLicenseId.value || '')
  const deviceId = sessionDevice.value?.id || kioskConfig.value?.deviceId || ''
  const deviceName = sessionDevice.value?.settings?.name || ''

  return {
    type,
    licenseId,
    deviceId,
    deviceName,
    doorNumber: String(params.doorNumber),
    groupId: params.groupName || '',
    lockerKey: params.lockerKey || '',
    itemIds: params.itemIds,
    patronId: params.patronId,
    success: params.success !== undefined ? params.success : true,
    metadata: params.metadata
  }
}

// --- Transactions (transactionType: 'transaction') ---

async function createCheckoutTransaction(params: LockerTransactionParams): Promise<string> {
  return createTransaction({ ...getBaseData('checkout', params), transactionType: 'transaction' })
}

async function createCheckinTransaction(params: LockerTransactionParams): Promise<string> {
  return createTransaction({ ...getBaseData('checkin', params), transactionType: 'transaction' })
}

async function createHoldTransaction(params: LockerTransactionParams): Promise<string> {
  return createTransaction({ ...getBaseData('hold', params), transactionType: 'transaction' })
}

// --- Events (transactionType: 'event') ---

async function createAddItemEvent(params: LockerTransactionParams): Promise<string> {
  return createTransaction({ ...getBaseData('add_item', params), transactionType: 'event' })
}

async function createRemoveItemEvent(params: LockerTransactionParams): Promise<string> {
  return createTransaction({ ...getBaseData('remove_item', params), transactionType: 'event' })
}

async function createAddHoldItemEvent(params: LockerTransactionParams): Promise<string> {
  return createTransaction({ ...getBaseData('add_hold_item', params), transactionType: 'event' })
}

async function createRemoveHoldItemEvent(params: LockerTransactionParams): Promise<string> {
  return createTransaction({ ...getBaseData('remove_hold_item', params), transactionType: 'event' })
}

async function createReturnItemEvent(params: LockerTransactionParams): Promise<string> {
  return createTransaction({ ...getBaseData('return_item', params), transactionType: 'event' })
}

async function createEnforceCheckinEvent(params: LockerTransactionParams): Promise<string> {
  return createTransaction({ ...getBaseData('enforce_checkin', params), transactionType: 'event' })
}

async function createExpiredHoldEvent(params: LockerTransactionParams): Promise<string> {
  return createTransaction({ ...getBaseData('expired_hold', params), transactionType: 'event' })
}

async function createCancelledHoldEvent(params: LockerTransactionParams): Promise<string> {
  return createTransaction({ ...getBaseData('cancelled_hold', params), transactionType: 'event' })
}

async function createReturnEnforceCheckinEvent(params: LockerTransactionParams): Promise<string> {
  return createTransaction({ ...getBaseData('return_enforce_checkin', params), transactionType: 'event' })
}

async function createDoorIsOpenTestFailedEvent(params: LockerTransactionParams): Promise<string> {
  return createTransaction({ ...getBaseData('door_is_open_test_failed', params), transactionType: 'event' })
}

async function createItemLeftBehindEvent(params: LockerTransactionParams): Promise<string> {
  return createTransaction({ ...getBaseData('item_left_behind', params), transactionType: 'event' })
}

async function createNewPatronEvent(params: LockerTransactionParams): Promise<string> {
  return createTransaction({ ...getBaseData('new_patron', params), transactionType: 'event' })
}

export {
  createTransaction,
  createCheckoutTransaction,
  createCheckinTransaction,
  createHoldTransaction,
  createAddItemEvent,
  createRemoveItemEvent,
  createAddHoldItemEvent,
  createRemoveHoldItemEvent,
  createReturnItemEvent,
  createEnforceCheckinEvent,
  createExpiredHoldEvent,
  createCancelledHoldEvent,
  createReturnEnforceCheckinEvent,
  createDoorIsOpenTestFailedEvent,
  createItemLeftBehindEvent,
  createNewPatronEvent
}
