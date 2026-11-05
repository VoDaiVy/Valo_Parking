const isLocalDevelopmentOrigin = (origin) => {
  try {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const host = url.hostname;
    if (['localhost', '127.0.0.1', '[::1]'].includes(host)) return true;
    const octets = host.split('.').map(Number);
    if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) return false;
    return octets[0] === 10 ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31);
  } catch {
    return false;
  }
};

const createCorsOptions = (env = process.env) => {
  const allowedOrigins = (env.CLIENT_URL || 'http://localhost:5173')
    .split(',').map(origin => origin.trim()).filter(Boolean);
  return {
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.includes(origin) ||
        ((env.NODE_ENV || 'development') === 'development' && isLocalDevelopmentOrigin(origin)));
    },
    credentials: true,
  };
};

module.exports = { createCorsOptions };
