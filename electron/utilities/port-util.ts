import * as net from 'net';
import * as log from 'electron-log';

export class PortUtil {
  static async isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port);
    });
  }

  static async findAvailablePort(
    startPort: number,
    maxAttempts: number = 10,
  ): Promise<number | null> {
    for (let i = 0; i < maxAttempts; i++) {
      const port = startPort + i;
      const available = await this.isPortAvailable(port);
      if (available) {
        return port;
      }
      log.info(`Port ${port} is in use, trying next...`);
    }
    return null;
  }
}
