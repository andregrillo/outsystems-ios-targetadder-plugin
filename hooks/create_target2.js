"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const plist = require("plist");
const Q = require("q");
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

  // Copy the .mobileprovision file to final destinations
  const mobileprovisionFile = path.join(context.opts.projectRoot, 'platforms', 'ios', 'www', `${profile.uuid}.mobileprovision`);
  if (!fs.existsSync(mobileprovisionFile)) {
    console.warn(`⚠️ Expected .mobileprovision file not found at: ${mobileprovisionFile}`);
  } else {
    const pluginProfileFolder = path.join(context.opts.plugin.dir, 'provisioning-profiles');
    const platformAppFolder = path.join(context.opts.projectRoot, 'platforms', platform, 'app');
    const macProvisioningFolder = path.join(os.homedir(), 'Library/MobileDevice/Provisioning Profiles');

    // Ensure folders exist
    fs.mkdirSync(pluginProfileFolder, { recursive: true });
    fs.mkdirSync(platformAppFolder, { recursive: true });
    fs.mkdirSync(macProvisioningFolder, { recursive: true });

    // Copy to plugin dir
    fs.copyFileSync(mobileprovisionFile, path.join(pluginProfileFolder, `${profile.uuid}.mobileprovision`));
    console.log(`✅ Copied to plugin folder: ${pluginProfileFolder}`);

    // Copy to platform/app
    fs.copyFileSync(mobileprovisionFile, path.join(platformAppFolder, `${profile.uuid}.mobileprovision`));
    console.log(`✅ Copied to iOS app folder: ${platformAppFolder}`);

    // Copy to macOS provisioning path
    fs.copyFileSync(mobileprovisionFile, path.join(macProvisioningFolder, `${profile.uuid}.mobileprovision`));
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
      `ruby "${rubyScriptPath}" "${targetName}" "${bundleId}" "${xcodeprojPath}" "${context.opts.projectRoot}" "${profile.name}" "${profile.teamId}"`,
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
