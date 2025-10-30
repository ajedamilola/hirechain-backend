// Centralized Express error handler
// Usage: app.use(errorHandler) after mounting routes

export function errorHandler(err, req, res, next) {
  console.error('[ERROR]', err);

  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';

  // Optional: include stack only in development
  const response = {
    message,
  };
  if (process.env.NODE_ENV !== 'production' && err.stack) {
    response.stack = err.stack;
  }

  res.status(status).json(response);
}
