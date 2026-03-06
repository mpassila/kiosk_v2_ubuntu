import os from 'os';
import path from 'path';

export const SIDE_EVENTS_DIR = process.platform === 'win32'
  ? 'C:\\SideEvents'
  : path.join(os.homedir(), 'SideEvents');

export const LOCAL_CONFIG_PATH = path.join(SIDE_EVENTS_DIR, 'localConfig.json');
export const SERVICE_CONFIG_PATH = path.join(SIDE_EVENTS_DIR, 'localServiceConfig.json');
export const LOGS_DIR = path.join(SIDE_EVENTS_DIR, 'logs');
export const CHECKOUT_MANIFEST_PATH = path.join(SIDE_EVENTS_DIR, 'checkoutManifest.json');
export const CHECKOUT_HISTORY_PATH = path.join(SIDE_EVENTS_DIR, 'historyOfCheckoutManifestLockers.json');
export const BACKUP_FILES_PATH = path.join(SIDE_EVENTS_DIR, 'bu_files.json');
export const BACKUP_LICENSE_PATH = path.join(SIDE_EVENTS_DIR, 'bu_license.json');
export const BACKUP_DEVICE_PATH = path.join(SIDE_EVENTS_DIR, 'bu_device.json');
export const BACKUP_INTEGRATIONS_PATH = path.join(SIDE_EVENTS_DIR, 'bu_integrations.json');
