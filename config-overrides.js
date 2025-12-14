const webpack = require("webpack");

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

  // Fix for axios CommonJS module issue
  // Add babel-loader for .cjs files in node_modules to properly transpile CommonJS modules
  const oneOfRule = config.module.rules.find((rule) => rule.oneOf);
  if (oneOfRule && Array.isArray(oneOfRule.oneOf)) {
    const loaders = oneOfRule.oneOf;

    // Find the babel-loader that handles node_modules (usually has include: /node_modules/)
    // or find any babel-loader and we'll configure it properly
    let babelLoaderConfig = loaders.find(
      (loader) =>
        loader.test &&
        loader.include &&
        typeof loader.include === "object" &&
        loader.include.toString().includes("node_modules"),
    );

    // If not found, find any babel-loader
    if (!babelLoaderConfig) {
      babelLoaderConfig = loaders.find(
        (loader) =>
          loader.test &&
          (loader.use || loader.loader) &&
          (Array.isArray(loader.use)
            ? loader.use.some((item) =>
                typeof item === "string"
                  ? item.includes("babel-loader")
                  : item?.loader?.includes("babel-loader"),
              )
            : loader.loader?.includes("babel-loader")),
      );
    }

    if (babelLoaderConfig) {
      // Find the last babel-loader position to insert right after it
      let insertIndex = -1;
      for (let i = loaders.length - 1; i >= 0; i--) {
        const loader = loaders[i];
        const isBabelLoader =
          loader.test &&
          (loader.use?.some?.((item) =>
            typeof item === "string"
              ? item.includes("babel-loader")
              : item?.loader?.includes("babel-loader"),
          ) ||
            loader.loader?.includes("babel-loader"));

        if (isBabelLoader && insertIndex === -1) {
          insertIndex = i + 1;
          break;
        }
      }

      // Fallback: insert before file-loader
      if (insertIndex === -1) {
        insertIndex = loaders.findIndex(
          (loader) =>
            loader.type === "asset/resource" ||
            (loader.loader && loader.loader.includes("file-loader")),
        );
        if (insertIndex === -1) {
          insertIndex = loaders.length - 1;
        }
      }

      // Create loader specifically for .cjs files in node_modules (like axios)
      const cjsLoader = {
        test: /\.cjs$/,
        include: /node_modules/,
        exclude: /@babel(?:\/|\\{1,2})runtime/,
        use: Array.isArray(babelLoaderConfig.use)
          ? babelLoaderConfig.use
          : babelLoaderConfig.loader
          ? [
              {
                loader: babelLoaderConfig.loader,
                options: babelLoaderConfig.options || {},
              },
            ]
          : [],
      };

      if (cjsLoader.use.length > 0) {
        loaders.splice(insertIndex, 0, cjsLoader);
      }
    }
  }

  config.plugins = (config.plugins || []).concat([
    new webpack.ProvidePlugin({
      Buffer: ["buffer", "Buffer"],
    }),
  ]);

  return config;
};
