// File Service - Manages files from localStorage
// Replaces Firebase Storage and REST API file loading

export interface FileData {
  name: string;
  content: string; // base64 encoded
  mimeType?: string;
  updatedAt?: string;
}

export class FileService {
  private static STORAGE_KEY = 'files';

  /**
   * Load all files from localStorage
   * @returns Object with file names as keys and base64 content as values
   */
  static loadFilesFromLocalStorage(): Record<string, string> {
    try {
      const filesJson = localStorage.getItem(this.STORAGE_KEY);
      if (!filesJson) {
        console.log('No files found in localStorage');
        return {};
      }

      const files = JSON.parse(filesJson);
      console.log(`Loaded ${Object.keys(files).length} files from localStorage`);
      return files;
    } catch (error) {
      console.error('Error loading files from localStorage:', error);
      return {};
    }
  }

  /**
   * Save a single file to localStorage
   * @param name File name
   * @param base64Content Base64 encoded file content
   */
  static saveFile(name: string, base64Content: string): void {
    try {
      const files = this.loadFilesFromLocalStorage();
      files[name] = base64Content;
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(files));
      console.log(`File '${name}' saved to localStorage`);
    } catch (error) {
      console.error(`Error saving file '${name}' to localStorage:`, error);
    }
  }

  /**
   * Save multiple files to localStorage
   * @param files Object with file names as keys and base64 content as values
   */
  static saveFiles(files: Record<string, string>): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(files));
      console.log(`Saved ${Object.keys(files).length} files to localStorage`);
    } catch (error) {
      console.error('Error saving files to localStorage:', error);
    }
  }

  /**
   * Get a specific file from localStorage
   * @param name File name
   * @returns Base64 encoded file content or null if not found
   */
  static getFile(name: string): string | null {
    const files = this.loadFilesFromLocalStorage();
    return files[name] || null;
  }

  /**
   * Check if a file exists in localStorage
   * @param name File name
   * @returns True if file exists, false otherwise
   */
  static hasFile(name: string): boolean {
    const files = this.loadFilesFromLocalStorage();
    return name in files;
  }

  /**
   * Delete a file from localStorage
   * @param name File name
   */
  static deleteFile(name: string): void {
    try {
      const files = this.loadFilesFromLocalStorage();
      delete files[name];
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(files));
      console.log(`File '${name}' deleted from localStorage`);
    } catch (error) {
      console.error(`Error deleting file '${name}':`, error);
    }
  }

  /**
   * Clear all files from localStorage
   */
  static clearAllFiles(): void {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
      console.log('All files cleared from localStorage');
    } catch (error) {
      console.error('Error clearing files from localStorage:', error);
    }
  }

  /**
   * Get file as data URL for use in img src
   * @param name File name
   * @param mimeType MIME type (default: image/jpeg)
   * @returns Data URL string or null if file not found
   */
  static getFileAsDataUrl(name: string, mimeType: string = 'image/jpeg'): string | null {
    const content = this.getFile(name);
    if (!content) {
      return null;
    }
    return `data:${mimeType};base64,${content}`;
  }

  /**
   * Get all file names stored in localStorage
   * @returns Array of file names
   */
  static getFileNames(): string[] {
    const files = this.loadFilesFromLocalStorage();
    return Object.keys(files);
  }

  /**
   * Get total size of files in localStorage (approximate)
   * @returns Size in bytes
   */
  static getTotalSize(): number {
    const filesJson = localStorage.getItem(this.STORAGE_KEY);
    if (!filesJson) {
      return 0;
    }
    // Approximate size in bytes (each character is roughly 2 bytes in UTF-16)
    return filesJson.length * 2;
  }

  /**
   * Import files from an external source (e.g., REST API)
   * This is a helper method for one-time migration from old system
   * @param files Object with file names as keys and base64 content as values
   */
  static importFiles(files: Record<string, string>): void {
    console.log(`Importing ${Object.keys(files).length} files to localStorage`);
    this.saveFiles(files);
  }
}

// Export singleton instance for convenience
export const fileService = FileService;
