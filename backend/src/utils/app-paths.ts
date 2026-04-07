import * as path from 'path';
import * as os from 'os';

export function getDataDir(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'dragnet');
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'dragnet',
    );
  }
  return path.join(os.homedir(), '.dragnet');
}

export function getLogsDir(): string {
  return process.env.DRAGNET_LOG_DIR || path.join(getDataDir(), 'logs');
}
