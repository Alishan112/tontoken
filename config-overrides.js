const webpack = require("webpack");
const getCacheIdentifier = require("react-dev-utils/getCacheIdentifier");

module.exports = function override(config, webpackEnv) {
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

  // Fix for axios CommonJS module issue
  // This ensures babel properly transpiles .cjs files like axios
  const isEnvDevelopment = webpackEnv === "development";
  const isEnvProduction = webpackEnv === "production";

  // Find the oneOf rule array
  const oneOfRule = config.module.rules.find((rule) => rule.oneOf);
  if (oneOfRule) {
    const loaders = oneOfRule.oneOf;

    // Add babel-loader for .cjs files before the file-loader
    loaders.splice(loaders.length - 1, 0, {
      test: /\.(js|mjs|cjs)$/,
      exclude: /@babel(?:\/|\\{1,2})runtime/,
      loader: require.resolve("babel-loader"),
      options: {
        babelrc: false,
        configFile: false,
        compact: false,
        presets: [[require.resolve("babel-preset-react-app/dependencies"), { helpers: true }]],
        cacheDirectory: true,
        cacheCompression: false,
        cacheIdentifier: getCacheIdentifier(
          isEnvProduction ? "production" : isEnvDevelopment && "development",
          [
            "babel-plugin-named-asset-import",
            "babel-preset-react-app",
            "react-dev-utils",
            "react-scripts",
          ],
        ),
        sourceMaps: false,
      },
    });
  }

  return config;
};
