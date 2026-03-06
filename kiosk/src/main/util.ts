/* eslint import/prefer-default-export: off, import/no-mutable-exports: off */
import { URL } from 'url';
import path from 'path';

export let resolveHtmlPath: (htmlFileName: string) => string;

if (process.env.NODE_ENV === 'development') {
  const port = process.env.PORT || 1212;
  resolveHtmlPath = (htmlFileName: string) => {
    const url = new URL(`http://localhost:${port}`);
    url.pathname = htmlFileName;
    return url.href;
  };
} else {
  resolveHtmlPath = (htmlFileName: string) => {
    // On Windows, path.resolve returns backslashes which don't work in file:// URLs
    // Convert to forward slashes for proper URL format
    // Use file:/// (3 slashes) for absolute Windows paths so relative assets resolve correctly
    const resolvedPath = path.resolve(__dirname, '../renderer/', htmlFileName);
    return `file:///${resolvedPath.replace(/\\/g, '/')}`;
  };
}
