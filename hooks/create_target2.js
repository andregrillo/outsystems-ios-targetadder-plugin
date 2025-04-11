"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const plist = require("plist");
const Q = require("q");
const AdmZip = require("adm-zip");
const { execSync } = require("child_process");

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

  const plistPath = path.join(context.opts.projectRoot, 'platforms', 'ios', 'www', 'decoded_profile.plist');

  if (!fs.existsSync(plistPath)) {
    console.error('❌ Decoded provisioning profile (decoded_profile.plist) not found at:', plistPath);
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

  const profile = extractProfileInfoFromPlist(plistPath);
  console.log(`📦 Parsed provisioning profile: ${profile.name} — UUID: ${profile.uuid} — Team ID: ${profile.teamId}`);

  // Step 1: Find and rename the original .mobileprovision file to match UUID
  const wwwPath = path.join(context.opts.projectRoot, 'platforms', 'ios', 'www');
  const provisioningFolder = path.join(wwwPath, 'provisioning-profiles');
  const allFiles = fs.readdirSync(provisioningFolder);
  const originalProvisionFile = allFiles.find(f => f.endsWith('.mobileprovision'));

  if (!originalProvisionFile) {
    console.warn(`⚠️ No .mobileprovision file found in: ${provisioningFolder}`);
  } else {
    const originalPath = path.join(provisioningFolder, originalProvisionFile);
    const renamedPath = path.join(wwwPath, `${profile.uuid}.mobileprovision`);

    fs.copyFileSync(originalPath, renamedPath);
    console.log(`✅ Copied and renamed ${originalProvisionFile} → ${profile.uuid}.mobileprovision`);

    const pluginProfileFolder = path.join(context.opts.plugin.dir, 'provisioning-profiles');
    const platformAppFolder = path.join(context.opts.projectRoot, 'platforms', platform, 'app');
    const macProvisioningFolder = path.join(os.homedir(), 'Library/MobileDevice/Provisioning Profiles');

    fs.mkdirSync(pluginProfileFolder, { recursive: true });
    fs.mkdirSync(platformAppFolder, { recursive: true });
    fs.mkdirSync(macProvisioningFolder, { recursive: true });

    fs.copyFileSync(renamedPath, path.join(pluginProfileFolder, `${profile.uuid}.mobileprovision`));
    console.log(`✅ Copied to plugin folder: ${pluginProfileFolder}`);

    fs.copyFileSync(renamedPath, path.join(platformAppFolder, `${profile.uuid}.mobileprovision`));
    console.log(`✅ Copied to iOS app folder: ${platformAppFolder}`);

    fs.copyFileSync(renamedPath, path.join(macProvisioningFolder, `${profile.uuid}.mobileprovision`));
    console.log(`✅ Copied to macOS system provisioning folder`);
  }

  const pluginVars = context.opts.plugin?.variables || {};
  let targetName = pluginVars.TARGET_NAME;
  let bundleId = pluginVars.BUNDLE_ID;

  const args = process.argv;
  args.forEach(arg => {
    if (arg.includes("TARGET_NAME=")) targetName ||= arg.split("=")[1];
    if (arg.includes("BUNDLE_ID=")) bundleId ||= arg.split("=")[1];
  });

  if (!targetName || !bundleId) {
    console.error("🚨 Missing required parameters: TARGET_NAME or BUNDLE_ID");
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

  console.log(`📡 Calling Ruby script to add target "${targetName}" with profile "${profile.name}"`);
  try {
    execSync(
      `ruby "${rubyScriptPath}" "${targetName}" "${bundleId}" "${xcodeprojPath}" "${context.opts.projectRoot}" "${profile.name}" "${profile.uuid}" "${profile.teamId}"`,
      { stdio: 'inherit' }
    );
    console.log('✅ Ruby target script executed successfully');
  } catch (error) {
    console.error('🚨 Failed to execute Ruby script:', error.message);
    defer.reject();
    return defer.promise;
  }

  defer.resolve(profile);
  return defer.promise;
};
