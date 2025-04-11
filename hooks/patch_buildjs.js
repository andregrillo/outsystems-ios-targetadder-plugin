const fs = require('fs');
const path = require('path');

module.exports = function (context) {
  const projectRoot = context.opts.projectRoot;
  const buildJsPath = path.join(projectRoot, 'node_modules', 'cordova-ios', 'lib', 'build.js');
  const patchInfoPath = path.join(projectRoot, 'patch_export_options.json');

  console.log(`🛠 Patching build.js to append provisioning profiles...`);
  console.log(`📄 Project Root: ${projectRoot}`);
  console.log(`📄 Path to build.js: ${buildJsPath}`);
  console.log(`📄 Path to patch_export_options.json: ${patchInfoPath}`);

  if (!fs.existsSync(patchInfoPath)) {
    console.warn('⚠️ patch_export_options.json not found. Skipping patch.');
    return;
  }

  if (!fs.existsSync(buildJsPath)) {
    console.error('❌ build.js not found. Cannot patch.');
    return;
  }

  const patchData = JSON.parse(fs.readFileSync(patchInfoPath, 'utf8'));

  if (!patchData.bundleId || !patchData.uuid) {
    console.error('❌ Invalid patch_export_options.json format. Expected { "bundleId": "...", "uuid": "..." }');
    return;
  }

  const buildJs = fs.readFileSync(buildJsPath, 'utf8');

  // Look for where MABS sets exportOptions.provisioningProfiles for main target
  const insertPoint = `exportOptions.provisioningProfiles = { [bundleIdentifier]: String(buildOpts.provisioningProfile)`;

  if (!buildJs.includes(insertPoint)) {
    console.warn('⚠️ Target line not found in build.js. Skipping patch.');
    return;
  }

  // Build the injection code
  const injectedCode = `, ${patchData.bundleId}: ${patchData.uuid}`;

  const modifiedBuildJs = buildJs.replace(insertPoint, `${insertPoint}${injectedCode}`);

  fs.writeFileSync(buildJsPath, modifiedBuildJs, 'utf8');

  console.log(`✅ build.js patched successfully with additional provisioning profile.`);
};