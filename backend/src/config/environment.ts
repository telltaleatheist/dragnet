export const environment = {
  port: parseInt(process.env.PORT || '3100', 10),
  host: process.env.HOST || '0.0.0.0',
  isDevelopment: process.env.NODE_ENV !== 'production',
  frontendPath: process.env.FRONTEND_PATH || '',
};
