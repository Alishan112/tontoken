const webpack = require("webpack");

module.exports = function override(config) {
  const fallback = config.resolve.fallback || {};

  Object.assign(fallback, {
    buffer: require.resolve("buffer"),
  });

  config.resolve.fallback = fallback;

  // Ensure zod is properly resolved
  config.resolve.alias = {
    ...config.resolve.alias,
    zod: require.resolve("zod"),
  };

  config.plugins = (config.plugins || []).concat([
    new webpack.ProvidePlugin({
      Buffer: ["buffer", "Buffer"],
    }),
  ]);

  return config;
};
