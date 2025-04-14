"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const plist = require("plist");
const Q = require("q");
const AdmZip = require("adm-zip");
const { execSync } = require("child_process");
//const installPrerequisites = require("./install_prerequisites.js");

const {
  isCordovaAbove,
  getPlatformConfigs,
  getResourcesFolderPath,
  log
} = require("./utils.js");

module.exports = function (context) {
  
  log("⭐️ Started provisioning profiles handling", "start");

  const defer = Q.defer();
  const platform = context.opts.plugin.platform;
  const platformConfig = getPlatformConfigs(platform);

  if (!platformConfig) {
    log("🚨 Invalid platform", "error");
    defer.reject();
    return defer.promise;
  }

  // Unzip the provisioning-profiles.zip file
  const zipFolder = path.join(context.opts.projectRoot, 'platforms', 'ios', 'www', 'provisioning-profiles');
  const zipFile = path.join(zipFolder, 'provisioning-profiles.zip');

  if (fs.existsSync(zipFile)) {
    const zip = new AdmZip(zipFile);
    zip.extractAllTo(zipFolder, true);
    console.log(`✅ Zip file extracted successfully to: ${zipFolder}`);
  } else {
    console.warn(`⚠️ Expected zip file not found at: ${zipFile}`);
  }

  const plistPath1 = path.join(context.opts.projectRoot, 'platforms', 'ios', 'www', 'decoded_profile1.plist');
  const plistPath2 = path.join(context.opts.projectRoot, 'platforms', 'ios', 'www', 'decoded_profile2.plist');

  if (!fs.existsSync(plistPath1)) {
    console.error('❌ Decoded provisioning profile (decoded_profile1.plist) not found at:', plistPath1);
    defer.reject();
    return defer.promise;
  }

  if (!fs.existsSync(plistPath2)) {
    console.error('❌ Decoded provisioning profile (decoded_profile2.plist) not found at:', plistPath2);
    defer.reject();
    return defer.promise;
  }

  const extractProfileInfoFromPlist = (plistFilePath) => {
    const xml = fs.readFileSync(plistFilePath, 'utf8');

    try {
      const parsed = plist.parse(xml);

      return {
        name: parsed.Name,
        uuid: parsed.UUID,
        teamId: parsed.TeamIdentifier?.[0] || parsed.Entitlements?.['com.apple.developer.team-identifier'] || ''
      };
    } catch (e) {
      console.error('❌ Failed to parse decoded plist file:', e.message);
      throw e;
    }
  };

  const profile1 = extractProfileInfoFromPlist(plistPath1);
  const profile2 = extractProfileInfoFromPlist(plistPath2);
  console.log(`📦 Parsed provisioning profile 1: ${profile1.name} — UUID: ${profile1.uuid} — Team ID: ${profile1.teamId}`);
  console.log(`📦 Parsed provisioning profile 2: ${profile2.name} — UUID: ${profile2.uuid} — Team ID: ${profile2.teamId}`);

  // Step 1: Find and rename the original .mobileprovision file to match UUID
  const wwwPath = path.join(context.opts.projectRoot, 'platforms', 'ios', 'www');
  const provisioningFolder = path.join(wwwPath, 'provisioning-profiles');
  const allFiles = fs.readdirSync(provisioningFolder);
  const originalProvisionFile = allFiles.find(f => f.endsWith('.mobileprovision'));

  if (!originalProvisionFile) {
    console.warn(`⚠️ No .mobileprovision file found in: ${provisioningFolder}`);
  } else {
    const originalPath = path.join(provisioningFolder, originalProvisionFile);
    const renamedPath = path.join(wwwPath, `${profile2.uuid}.mobileprovision`);

    fs.copyFileSync(originalPath, renamedPath);
    console.log(`✅ Copied and renamed ${originalProvisionFile} → ${profile2.uuid}.mobileprovision`);

    const pluginProfileFolder = path.join(context.opts.plugin.dir, 'provisioning-profiles');
    const platformAppFolder = path.join(context.opts.projectRoot, 'platforms', platform, 'app');
    const macProvisioningFolder = path.join(os.homedir(), 'Library/MobileDevice/Provisioning Profiles');

    fs.mkdirSync(pluginProfileFolder, { recursive: true });
    fs.mkdirSync(platformAppFolder, { recursive: true });
    fs.mkdirSync(macProvisioningFolder, { recursive: true });

    fs.copyFileSync(renamedPath, path.join(pluginProfileFolder, `${profile2.uuid}.mobileprovision`));
    console.log(`✅ Copied to plugin folder: ${pluginProfileFolder}`);

    fs.copyFileSync(renamedPath, path.join(platformAppFolder, `${profile2.uuid}.mobileprovision`));
    console.log(`✅ Copied to iOS app folder: ${platformAppFolder}`);

    fs.copyFileSync(renamedPath, path.join(macProvisioningFolder, `${profile2.uuid}.mobileprovision`));
    console.log(`✅ Copied to macOS system provisioning folder`);
  }

  //const pluginVars = context.opts.plugin?.variables || {};
  var bundleId1;
  var secondTargetName;// = pluginVars.TARGET_NAME;
  var bundleId2;// = pluginVars.BUNDLE_ID;

  const args = process.argv;
  args.forEach(arg => {
    if (arg.includes("FIRST_TARGET_BUNDLEID=")) bundleId1 ||= arg.split("=")[1];
    if (arg.includes("SECOND_TARGET_NAME=")) secondTargetName ||= arg.split("=")[1];
    if (arg.includes("SECOND_TARGET_BUNDLE_ID=")) bundleId2 ||= arg.split("=")[1];
  });

  if (!secondTargetName || !bundleId2 || !bundleId1) {
    console.error("🚨 Missing required parameters: TARGET_NAME, BUNDLE_ID or MAIN_TARGET_BUNDLEID");
    defer.reject();
    return defer.promise;
  }

  const configXml = fs.readFileSync(path.join(context.opts.projectRoot, 'config.xml')).toString();
  const projectNameMatch = configXml.match(/<name>(.*?)<\/name>/);
  const projectName = projectNameMatch ? projectNameMatch[1].trim() : null;

  if (!projectName) {
    console.error("❌ Couldn't find project name in config.xml");
    defer.reject();
    return defer.promise;
  }


  //////
  console.log('🛠️ Patching build.js to support multiple provisioning profiles...');
  const buildJsPath = path.join(context.opts.projectRoot, 'node_modules', 'cordova-ios', 'lib', 'build.js');

  if (!fs.existsSync(buildJsPath)) {
    console.error('❌ Could not find build.js at expected path:', buildJsPath);
    return;
  }

  let content = fs.readFileSync(buildJsPath, 'utf8');

  const searchLine = `if (buildOpts.provisioningProfile && bundleIdentifier) {`;

  const replacementBlock = `
const provisioningProfile = buildOpts.provisioningProfile;
console.log("provisioningProfile: " + provisioningProfile);
console.log("bundleIdentifier: " + bundleIdentifier);
console.log("📦 buildOpts ===> " + JSON.stringify(buildOpts, null, 2));

if (buildOpts.provisioningProfile && bundleIdentifier) {
    console.log("🔧 Patching buildOpts.provisioningProfile with multiple entries...");
    const originalProfile = buildOpts.provisioningProfile;

    buildOpts.provisioningProfile = {};
    buildOpts.provisioningProfile["${bundleId1}"] = "${profile1.uuid}";
    buildOpts.provisioningProfile["${bundleId2}"] = "${profile2.uuid}";

    console.log("✅ Final provisioningProfile map:");
    console.log(JSON.stringify(buildOpts.provisioningProfile, null, 2));
}
console.log("bundleIdentifier: " + bundleIdentifier);
console.log("provisioningProfile: " + provisioningProfile);
console.log("📦 buildOpts ===> " + JSON.stringify(buildOpts, null, 2));
console.log("📦 buildOpts.provisioningProfile ===> " + JSON.stringify(buildOpts.provisioningProfile, null, 2));
if (buildOpts.provisioningProfile && bundleIdentifier) {
`;

  if (content.includes(searchLine)) {
    content = content.replace(searchLine, replacementBlock);
    fs.writeFileSync(buildJsPath, content, 'utf-8');
    console.log('✅ build.js patched successfully.');
  } else {
    console.warn('❌ Could not find the target line to patch.');
  }
  //////



  const xcodeprojPath = path.join(context.opts.projectRoot, 'platforms', 'ios', `${projectName}.xcodeproj`);
  const rubyScriptPath = path.join(context.opts.plugin.dir, 'hooks', 'add_target.rb');

  try {
    execSync('gem list xcodeproj -i', { stdio: 'ignore' });
  } catch (err) {
    console.log('📦 Installing missing xcodeproj gem...');
    try {
      execSync('gem install xcodeproj', { stdio: 'inherit' });
    } catch (installErr) {
      console.error('🚨 Failed to install xcodeproj gem');
      defer.reject();
      return defer.promise;
    }
  }

  console.log(`📡 Calling Ruby script to add target "${secondTargetName}" with profile "${profile2.name}"`);
  try {
    execSync(
      `ruby "${rubyScriptPath}" "${secondTargetName}" "${bundleId2}" "${xcodeprojPath}" "${context.opts.projectRoot}" "${profile2.name}" "${profile2.uuid}" "${profile2.teamId}"`,
      { stdio: 'inherit' }
    );
    console.log('✅ Ruby target script executed successfully');
  } catch (error) {
    console.error('🚨 Failed to execute Ruby script:', error.message);
    defer.reject();
    return defer.promise;
  }

  // Store target bundle ID and UUID in a shared file for later use
  /*const exportPatchPath = path.join(context.opts.projectRoot, 'patch_export_options.json');
  try {
    fs.writeFileSync(exportPatchPath, JSON.stringify({ bundleId2, uuid: profile.uuid }, null, 2), 'utf8');
    console.log(`✅ Saved exportOptions patch info to: ${exportPatchPath}`);
  } catch (e) {
    console.warn("⚠️ Could not write exportOptions patch file:", e.message);
  }
  */

  defer.resolve(profile2);
  return defer.promise;

};
