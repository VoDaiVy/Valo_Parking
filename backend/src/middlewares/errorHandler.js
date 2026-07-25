/**
 * Global error handler middleware
 * Catches all errors and returns a consistent JSON response
 */
const errorHandler = (err, req, res, next) => {
  console.error('❌ Error:', err.message);

  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation error';
    const errors = Object.entries(err.errors).map(([field, val]) => ({
      field,
      message: val.message,
    }));

    return res.status(statusCode).json({
      success: false,
      message,
      errors,
      ...(typeof err.code === 'string' && { code: err.code }),
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    statusCode = 409;
    const field = Object.keys(err.keyValue)[0];
    message = `${field} already exists.`;
  }

  // Mongoose bad ObjectId (CastError)
  if (err.name === 'CastError') {
    statusCode = 400;
    message = 'Validation error';
    return res.status(statusCode).json({
      success: false,
      message,
      errors: [
        {
          field: err.path,
          message: `Invalid ${err.path}: ${err.value}`,
        },
      ],
      ...(typeof err.code === 'string' && { code: err.code }),
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token.';
  }

  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired.';
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(typeof err.code === 'string' && { code: err.code }),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = errorHandler;
