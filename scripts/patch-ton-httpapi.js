#!/usr/bin/env node

/**
 * Patch script for @ton/ton HttpApi.js
 * Fixes the require('../../../package.json') issue that webpack can't resolve
 */

const fs = require("fs");
const path = require("path");

const httpApiPath = path.resolve(__dirname, "../node_modules/@ton/ton/dist/client/api/HttpApi.js");

if (fs.existsSync(httpApiPath)) {
  let content = fs.readFileSync(httpApiPath, "utf8");

  // Check if already patched with the correct format
  if (content.includes("require('@ton/ton/package.json')")) {
    console.log("✓ @ton/ton HttpApi.js is already patched correctly");
    return;
  }

  // First, replace any existing absolute path patches back to relative
  content = content.replace(
    /require\(['"][^'"]*node_modules\/@ton\/ton\/package\.json['"]\)/g,
    `require('../../../package.json')`,
  );

  // Use module-relative path that webpack can resolve
  // From HttpApi.js location: node_modules/@ton/ton/dist/client/api/
  // To package.json: node_modules/@ton/ton/package.json
  // So we use @ton/ton/package.json which webpack can resolve via node_modules
  const patchedContent = content.replace(
    /require\(['"]\.\.\/\.\.\/\.\.\/package\.json['"]\)/g,
    `require('@ton/ton/package.json')`,
  );

  if (content !== patchedContent) {
    fs.writeFileSync(httpApiPath, patchedContent, "utf8");
    console.log("✓ Patched @ton/ton HttpApi.js to fix webpack require issue");
  } else {
    console.log("⚠ Could not find require('../../../package.json') in HttpApi.js");
  }
} else {
  console.log("⚠ @ton/ton HttpApi.js not found, skipping patch");
}
