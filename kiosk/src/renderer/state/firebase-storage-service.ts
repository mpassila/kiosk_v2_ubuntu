// Firebase Storage Service - Manages files from Firebase Storage
// Downloads files and syncs with localStorage

import { getFirebaseStorage } from './firebase-client';
import { ref, listAll, getDownloadURL, getMetadata } from 'firebase/storage';
import { fileService } from './file-service';

export interface FirebaseFileInfo {
  name: string;
  fullPath: string;
  url: string;
  size: number;
  contentType?: string;
  timeCreated: string;
  updated: string;
}

export class FirebaseStorageService {
  /**
   * List all files for a specific license from Firebase Storage
   * @param licenseId License ID
   * @returns Array of file information
   */
  static async listFilesForLicense(licenseId: string): Promise<FirebaseFileInfo[]> {
    try {
      const storage = getFirebaseStorage();
      console.log('🔍 Firebase Storage bucket:', storage.app.options.storageBucket);

      // Files are directly in license_{id} folder (not in /files subfolder)
      const filesPath = `license_${licenseId}`;
      console.log(`📂 Listing files from Firebase Storage path: ${filesPath}`);

      const listRef = ref(storage, filesPath);

      console.log('📋 Calling listAll() on storage reference...');
      const result = await listAll(listRef);
      console.log(`✅ listAll() successful - Found ${result.items.length} items`);

      const fileInfos: FirebaseFileInfo[] = [];

      if (result.items.length === 0) {
        console.warn('⚠️  No items found in listAll() result');
        console.warn('   This could mean:');
        console.warn(`   1. No files at path: ${filesPath}`);
        console.warn('   2. Files might be in a subfolder (e.g., license_2/files/)');
        console.warn('   3. Permission denied (check Storage rules)');
        console.warn('   4. Wrong storage bucket or path');
      }

      for (const itemRef of result.items) {
        try {
          console.log(`  📥 Processing item: ${itemRef.name}`);
          const [url, metadata] = await Promise.all([
            getDownloadURL(itemRef),
            getMetadata(itemRef)
          ]);

          fileInfos.push({
            name: itemRef.name,
            fullPath: itemRef.fullPath,
            url,
            size: metadata.size,
            contentType: metadata.contentType,
            timeCreated: metadata.timeCreated,
            updated: metadata.updated
          });

          console.log(`  ✓ Found: ${itemRef.name} (${(metadata.size / 1024).toFixed(2)} KB)`);
        } catch (error: any) {
          console.error(`  ✗ Error getting metadata for ${itemRef.name}:`, error);
          console.error(`     Error code: ${error.code}`);
          console.error(`     Error message: ${error.message}`);
        }
      }

      console.log(`📂 Total files found: ${fileInfos.length}`);
      return fileInfos;
    } catch (error: any) {
      console.error('❌ Error listing files from Firebase Storage:', error);
      console.error('   Error code:', error.code);
      console.error('   Error message:', error.message);
      console.error('   Path attempted:', `license_${licenseId}`);

      // Provide helpful debugging info
      if (error.code === 'storage/unauthorized') {
        console.error('   → Authentication issue: Make sure user is authenticated before calling loadFiles()');
        console.error('   → Check Firebase Storage rules allow authenticated read');
      } else if (error.code === 'storage/object-not-found') {
        console.error('   → Path not found: Check that files exist at gs://bucket/license_${licenseId}/');
      } else if (error.code === 'storage/bucket-not-found') {
        console.error('   → Bucket not found: Check storageBucket in firebase config');
      }

      return [];
    }
  }

  /**
   * Download a file from Firebase Storage and convert to base64
   * Uses Electron IPC to download in main process (no CORS restrictions)
   * @param downloadUrl Download URL from Firebase Storage
   * @param fileName File name (for logging)
   * @returns Base64 encoded string
   */
  static async downloadFileAsBase64(downloadUrl: string, fileName: string): Promise<string | null> {
    try {
      console.log(`  ⬇️  Downloading: ${fileName}`);
      console.log(`     URL: ${downloadUrl}`);

      // Check if running in Electron
      const electron = (window as any).electron;
      if (electron?.sideeventNative?.downloadFile) {
        // Download via Electron main process (no CORS restrictions)
        console.log(`     Using Electron IPC (no CORS)`);
        const base64 = await electron.sideeventNative.downloadFile(downloadUrl, fileName);
        console.log(`  ✅ Downloaded: ${fileName} via Electron IPC`);
        return base64;
      } else {
        // Fallback to fetch (for development in browser)
        console.log(`     Using fetch() (CORS may apply)`);
        const response = await fetch(downloadUrl);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        // Get the file as ArrayBuffer
        const arrayBuffer = await response.arrayBuffer();

        // Convert ArrayBuffer to base64
        const base64 = this.arrayBufferToBase64(arrayBuffer);

        console.log(`  ✅ Downloaded: ${fileName} (${(arrayBuffer.byteLength / 1024).toFixed(2)} KB)`);
        return base64;
      }
    } catch (error: any) {
      console.error(`  ❌ Error downloading ${fileName}:`, error);
      console.error(`     Error message: ${error.message}`);
      return null;
    }
  }

  /**
   * Convert ArrayBuffer to base64 string
   * @param buffer ArrayBuffer
   * @returns Base64 string
   */
  private static arrayBufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  /**
   * Sync files from Firebase Storage to localStorage
   * - Downloads new/updated files from Firebase
   * - Deletes local files not present in Firebase
   * @param licenseId License ID
   * @returns Object with sync statistics
   */
  static async syncFilesWithLocalStorage(licenseId: string): Promise<{
    downloaded: number;
    deleted: number;
    total: number;
    errors: string[];
  }> {
    console.log('🔄 Starting Firebase Storage sync...');

    const stats = {
      downloaded: 0,
      deleted: 0,
      total: 0,
      errors: [] as string[]
    };

    try {
      // 1. List all files from Firebase Storage
      const firebaseFiles = await this.listFilesForLicense(licenseId);
      stats.total = firebaseFiles.length;

      console.log(`📊 Firebase Storage scan results:`);
      console.log(`   Path checked: license_${licenseId}`);
      console.log(`   Files found: ${firebaseFiles.length}`);

      if (firebaseFiles.length === 0) {
        console.warn('⚠️  No files found in Firebase Storage!');
        console.warn(`   Expected location: gs://library-456310.firebasestorage.app/license_${licenseId}/`);
        console.warn('   Check Firebase Console → Storage to verify files exist');
        return stats;
      }

      console.log(`   Files in Firebase Storage:`);
      firebaseFiles.forEach(file => {
        console.log(`     - ${file.name} (${(file.size / 1024).toFixed(2)} KB)`);
      });

      // 2. Get current local files
      const localFiles = fileService.loadFilesFromLocalStorage();
      const localFileNames = Object.keys(localFiles);

      // 3. Create a set of Firebase file names for quick lookup
      const firebaseFileNames = new Set(firebaseFiles.map(f => f.name));

      // 4. Delete local files not in Firebase
      console.log('🗑️  Checking for files to delete...');
      for (const localFileName of localFileNames) {
        if (!firebaseFileNames.has(localFileName)) {
          console.log(`  🗑️  Deleting: ${localFileName} (not in Firebase Storage)`);
          fileService.deleteFile(localFileName);
          stats.deleted++;
        }
      }

      // 5. Download only new or updated files from Firebase
      console.log('⬇️  Checking files from Firebase Storage...');

      // Load cached file timestamps to detect changes
      let fileTimestamps: Record<string, string> = {};
      try {
        const cached = localStorage.getItem('fileTimestamps');
        if (cached) fileTimestamps = JSON.parse(cached);
      } catch (e) { /* ignore */ }

      let skipped = 0;
      for (const fileInfo of firebaseFiles) {
        try {
          // Skip download if file exists locally and hasn't been updated in Firebase
          const cachedTimestamp = fileTimestamps[fileInfo.name];
          if (cachedTimestamp && cachedTimestamp === fileInfo.updated && localFiles[fileInfo.name]) {
            skipped++;
            continue;
          }

          console.log(`  📥 Downloading: ${fileInfo.name}${cachedTimestamp ? ' (updated)' : ' (new)'}`);

          const base64Content = await this.downloadFileAsBase64(fileInfo.url, fileInfo.name);

          if (base64Content) {
            fileService.saveFile(fileInfo.name, base64Content);
            fileTimestamps[fileInfo.name] = fileInfo.updated;
            stats.downloaded++;
          } else {
            stats.errors.push(`Failed to download ${fileInfo.name}`);
          }
        } catch (error) {
          const errorMsg = `Error processing ${fileInfo.name}: ${error}`;
          console.error(`  ❌ ${errorMsg}`);
          stats.errors.push(errorMsg);
        }
      }

      // Remove timestamps for deleted files and save
      for (const name of Object.keys(fileTimestamps)) {
        if (!firebaseFileNames.has(name)) delete fileTimestamps[name];
      }
      localStorage.setItem('fileTimestamps', JSON.stringify(fileTimestamps));

      if (skipped > 0) console.log(`  ⏭️  Skipped ${skipped} unchanged files`);

      console.log('✅ Firebase Storage sync completed:');
      console.log(`  - Total files in Firebase: ${stats.total}`);
      console.log(`  - Downloaded: ${stats.downloaded}`);
      console.log(`  - Deleted: ${stats.deleted}`);
      console.log(`  - Errors: ${stats.errors.length}`);

      if (stats.errors.length > 0) {
        console.error('Errors during sync:', stats.errors);
      }

      return stats;
    } catch (error) {
      console.error('❌ Critical error during Firebase Storage sync:', error);
      stats.errors.push(`Critical error: ${error}`);
      return stats;
    }
  }

  /**
   * Force re-download of all files from Firebase Storage
   * This will overwrite all local files
   * @param licenseId License ID
   * @returns Sync statistics
   */
  static async forceRedownloadAllFiles(licenseId: string): Promise<{
    downloaded: number;
    deleted: number;
    total: number;
    errors: string[];
  }> {
    console.log('🔄 Force re-downloading all files from Firebase Storage...');

    // Clear all local files first
    fileService.clearAllFiles();

    // Download all files
    return await this.syncFilesWithLocalStorage(licenseId);
  }

  /**
   * Debug helper: Try different path formats to find files
   * @param licenseId License ID
   * @returns Results from each path attempt
   */
  static async debugFindFiles(licenseId: string): Promise<{
    path: string;
    success: boolean;
    itemCount: number;
    error?: string;
  }[]> {
    console.log('🔍 DEBUG: Trying different Firebase Storage paths...');

    const storage = getFirebaseStorage();
    console.log('   Storage bucket:', storage.app.options.storageBucket);

    const pathsToTry = [
      `license_${licenseId}`,               // license_2 (files directly in folder)
      `license_${licenseId}/files`,        // license_2/files (files in subfolder)
      `license${licenseId}`,                // license2
      `license${licenseId}/files`,          // license2/files
      `licenses/${licenseId}`,              // licenses/2
      `licenses/${licenseId}/files`,        // licenses/2/files
      `${licenseId}`,                       // 2
      `${licenseId}/files`,                 // 2/files
      `files`,                              // files
      ``,                                   // root
    ];

    const results = [];

    for (const path of pathsToTry) {
      try {
        console.log(`   Testing path: "${path || "(root)"}"`);
        const listRef = ref(storage, path);
        const result = await listAll(listRef);

        console.log(`   ✅ Path "${path || "(root)"}" - Found ${result.items.length} items`);
        if (result.items.length > 0) {
          console.log(`      Items: ${result.items.map(i => i.name).join(', ')}`);
        }

        results.push({
          path: path || '(root)',
          success: true,
          itemCount: result.items.length
        });
      } catch (error: any) {
        console.log(`   ❌ Path "${path || "(root)"}" - Error: ${error.code || error.message}`);
        results.push({
          path: path || '(root)',
          success: false,
          itemCount: 0,
          error: error.code || error.message
        });
      }
    }

    console.log('🔍 DEBUG: Path search complete');
    console.log('   Results:', results.filter(r => r.success && r.itemCount > 0));

    return results;
  }

  /**
   * Get file statistics
   * @param licenseId License ID
   * @returns Statistics about files in Firebase vs localStorage
   */
  static async getFileStatistics(licenseId: string): Promise<{
    firebaseCount: number;
    localCount: number;
    localOnlyFiles: string[];
    firebaseOnlyFiles: string[];
    commonFiles: string[];
  }> {
    const firebaseFiles = await this.listFilesForLicense(licenseId);
    const localFiles = fileService.loadFilesFromLocalStorage();

    const firebaseFileNames = new Set(firebaseFiles.map(f => f.name));
    const localFileNames = new Set(Object.keys(localFiles));

    const localOnlyFiles = Array.from(localFileNames).filter(name => !firebaseFileNames.has(name));
    const firebaseOnlyFiles = Array.from(firebaseFileNames).filter(name => !localFileNames.has(name));
    const commonFiles = Array.from(localFileNames).filter(name => firebaseFileNames.has(name));

    return {
      firebaseCount: firebaseFiles.length,
      localCount: localFileNames.size,
      localOnlyFiles,
      firebaseOnlyFiles,
      commonFiles
    };
  }
}

// Export singleton instance for convenience
export const firebaseStorageService = FirebaseStorageService;
