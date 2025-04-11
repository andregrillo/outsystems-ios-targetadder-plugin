const fs = require('fs');
const path = require('path');

module.exports = function (context) {
  const projectRoot = context.opts.projectRoot;
  const buildJsPath = path.join(projectRoot, 'platforms', 'ios', 'cordova', 'node_modules', 'cordova-ios', 'lib', 'build.js');

  if (!fs.existsSync(buildJsPath)) {
    console.error('❌ Could not find build.js at expected path:', buildJsPath);
    return;
  }

  let content = fs.readFileSync(buildJsPath, 'utf8');

  const matchLine = 'if (buildOpts.provisioningProfile && bundleIdentifier)';
  const logLine = 'console.log("📦 buildOpts ===> " + JSON.stringify(buildOpts, null, 2));\n';

  if (content.includes(logLine.trim())) {
    console.log('ℹ️ Log line already added. Skipping.');
    return;
  }

  const newContent = content.replace(
    matchLine,
    logLine + matchLine
  );

  if (newContent === content) {
    console.warn('⚠️ Could not find the target line to patch. No changes made.');
    return;
  }

  fs.writeFileSync(buildJsPath, newContent, 'utf8');
  console.log('✅ Successfully injected buildOpts log into build.js');
};