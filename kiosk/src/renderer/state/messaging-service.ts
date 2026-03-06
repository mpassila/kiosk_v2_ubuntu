/**
 * Messaging service for the kiosk (Electron renderer).
 *
 * Resolves SMTP config at license level (with system-level fallback),
 * then calls the cloud-function endpoints directly.
 */
import { getFirebaseFirestore, authenticateFirebase } from './firebase-client'
import { doc, getDoc } from 'firebase/firestore'
import { sessionLicenseId } from './shared'

// ── Cloud-function base URL + API key ────────────────────────────────
const CF_BASE = 'https://us-central1-library-456310.cloudfunctions.net/messaging'
const CF_API_KEY = '@VittuSaatanaPerkele2025!'

// ── Types ────────────────────────────────────────────────────────────
interface SmtpConfig {
  host: string
  port: number
  user: string
  password: string
  fromEmail: string
  fromName: string
}

interface SendEmailParams {
  to: string
  subject: string
  text: string
  html?: string
  cc?: string
  bcc?: string
}

interface SendSMSParams {
  to: string
  body: string
}

interface MessageResult {
  success: boolean
  error?: string
}

// ── Helpers to read Firestore docs ───────────────────────────────────

/** Read system-level settings from sideevents/settings */
async function getSystemSettings(licenseId: number | string) {
  await authenticateFirebase(licenseId)
  const db = getFirebaseFirestore()
  const settingsRef = doc(db, 'sideevents', 'settings')
  const snap = await getDoc(settingsRef)

  const defaults = {
    smtpHost: '',
    smtpPort: 587,
    smtpUser: '',
    smtpPassword: '',
    smtpFromEmail: '',
    smtpFromName: '',
    smsPhoneNumber: '',
  }

  if (!snap.exists()) return defaults
  const d = snap.data()
  return {
    smtpHost: d.smtpHost ?? defaults.smtpHost,
    smtpPort: d.smtpPort ?? defaults.smtpPort,
    smtpUser: d.smtpUser ?? defaults.smtpUser,
    smtpPassword: d.smtpPassword ?? defaults.smtpPassword,
    smtpFromEmail: d.smtpFromEmail ?? defaults.smtpFromEmail,
    smtpFromName: d.smtpFromName ?? defaults.smtpFromName,
    smsPhoneNumber: d.smsPhoneNumber ?? defaults.smsPhoneNumber,
  }
}

/** Read a license doc and return its smtpSettings (if any). */
async function getLicenseSmtpSettings(licenseId: number | string) {
  await authenticateFirebase(licenseId)
  const db = getFirebaseFirestore()
  const licRef = doc(db, 'licenses', String(licenseId))
  const snap = await getDoc(licRef)
  if (!snap.exists()) return null
  return snap.data().smtpSettings || null
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Resolve SMTP config for the current license.
 * Uses license-level overrides when enabled, falling back to
 * system settings for any empty field.
 */
export async function getSmtpConfig(licenseId?: number | string): Promise<SmtpConfig> {
  const lid = licenseId ?? sessionLicenseId.value
  const sys = await getSystemSettings(lid)

  const systemConfig: SmtpConfig = {
    host: sys.smtpHost,
    port: sys.smtpPort,
    user: sys.smtpUser,
    password: sys.smtpPassword,
    fromEmail: sys.smtpFromEmail,
    fromName: sys.smtpFromName,
  }

  if (!lid) return systemConfig

  const ls = await getLicenseSmtpSettings(lid)
  if (!ls?.enabled) return systemConfig

  return {
    host: ls.host || systemConfig.host,
    port: ls.port || systemConfig.port,
    user: ls.user || systemConfig.user,
    password: ls.password || systemConfig.password,
    fromEmail: ls.fromEmail || systemConfig.fromEmail,
    fromName: ls.fromName || systemConfig.fromName,
  }
}

/**
 * Send an email using resolved SMTP config (license → system fallback).
 * Calls the cloud function directly.
 */
export async function sendEmail(params: SendEmailParams, licenseId?: number | string): Promise<MessageResult> {
  try {
    const config = await getSmtpConfig(licenseId)

    const payload = {
      smtp: {
        host: config.host,
        port: config.port,
        secure: false,
        auth: {
          email: config.user,
          user: config.user,
          pass: config.password,
        },
      },
      to: params.to,
      from: config.fromEmail || config.user,
      subject: params.subject,
      text: params.text,
      html: params.html || params.text,
      cc: params.cc || '',
      bcc: params.bcc || '',
    }

    const response = await fetch(`${CF_BASE}/email/smtp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': CF_API_KEY,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return { success: false, error: `${response.status} ${errorText}` }
    }

    return { success: true }
  } catch (error: any) {
    console.error('Error sending email:', error)
    return { success: false, error: error.message }
  }
}

/**
 * Send an SMS via Twilio cloud function.
 * Uses the system-level SMS phone number as the sender.
 */
export async function sendSMS(params: SendSMSParams, licenseId?: number | string): Promise<MessageResult> {
  try {
    const lid = licenseId ?? sessionLicenseId.value
    const sys = await getSystemSettings(lid)

    const payload = {
      from: sys.smsPhoneNumber,
      to: params.to,
      body: params.body,
    }

    const response = await fetch(`${CF_BASE}/sms/twilio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': CF_API_KEY,
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return { success: false, error: `${response.status} ${errorText}` }
    }

    return { success: true }
  } catch (error: any) {
    console.error('Error sending SMS:', error)
    return { success: false, error: error.message }
  }
}
