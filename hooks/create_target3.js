"use strict";

const path = require("path");
const fs = require("fs");
const os = require("os");
const plist = require("plist");
const Q = require("q");
const { execSync } = require("child_process");
const installPrerequisites = require("./install_prerequisites.js");

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

  // Step 0: Install prerequisites first
  installPrerequisites(context).then(() => {
    let AdmZip;
    try {
      AdmZip = require("adm-zip");
    } catch (e) {
      console.error("🚨 'adm-zip' module not found after installing prerequisites.");
      defer.reject();
      return;
    }

    // Get args
    const args = process.argv;
    let bundleId1, secondTargetName, bundleId2;

    args.forEach(arg => {
      if (arg.includes("FIRST_TARGET_BUNDLEID=")) bundleId1 ||= arg.split("=")[1];
      if (arg.includes("SECOND_TARGET_NAME=")) secondTargetName ||= arg.split("=")[1];
      if (arg.includes("SECOND_TARGET_BUNDLE_ID=")) bundleId2 ||= arg.split("=")[1];
    });

    if (!secondTargetName || !bundleId2 || !bundleId1) {
      console.error("🚨 Missing required parameters: TARGET_NAME, BUNDLE_ID or MAIN_TARGET_BUNDLEID");
      defer.reject();
      return;
    }

    const zipFolder = path.join(context.opts.projectRoot, 'platforms', 'ios', 'www', 'provisioning-profiles');
    const zipFile = path.join(zipFolder, 'provisioning-profiles.zip');

    if (fs.existsSync(zipFile)) {
      const zip = new AdmZip(zipFile);
      zip.extractAllTo(zipFolder, true);
      console.log(`✅ Zip file extracted successfully to: ${zipFolder}`);
    } else {
      console.warn(`⚠️ Expected zip file not found at: ${zipFile}`);
    }

    //Project Name
    const configXml = fs.readFileSync(path.join(context.opts.projectRoot, 'config.xml')).toString();
    const projectNameMatch = configXml.match(/<name>(.*?)<\/name>/);
    const projectName = projectNameMatch ? projectNameMatch[1].trim() : null;

    // Also unzip the second zip that may come from the plugin consumer
    const customZipPath = path.join(context.opts.projectRoot, 'platforms/ios/www', secondTargetName, bundleId2 + '.zip');
    const destFolderPath = path.join(context.opts.projectRoot, 'platforms/ios', projectName, secondTargetName);

    if (!fs.existsSync(customZipPath)) {
      console.error(`🚨 ${bundleId2}.zip file not found in platforms/ios/www/${secondTargetName}`);
      defer.reject();
      return;
    } else {
      const zip = new AdmZip(customZipPath);
      zip.extractAllTo(destFolderPath, true);
      console.log("✅ Second target zip extracted successfully to:", destFolderPath);
    }

    const plistPath1 = path.join(context.opts.projectRoot, 'platforms', 'ios', 'www', 'decoded_profile1.plist');
    const plistPath2 = path.join(context.opts.projectRoot, 'platforms', 'ios', 'www', 'decoded_profile2.plist');

    if (!fs.existsSync(plistPath1) || !fs.existsSync(plistPath2)) {
      console.error('❌ Missing one or both decoded provisioning profile plist files');
      defer.reject();
      return;
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

    console.log(`📦 Parsed profile 1: ${profile1.name} — ${profile1.uuid}`);
    console.log(`📦 Parsed profile 2: ${profile2.name} — ${profile2.uuid}`);

    // Rename and copy profile 2 
    const wwwPath = path.join(context.opts.projectRoot, 'platforms', 'ios', 'www');
    const provisioningFolder = path.join(wwwPath, 'provisioning-profiles');
    const allFiles = fs.readdirSync(provisioningFolder);
    const originalProvisionFile = allFiles.find(f => f.endsWith('.mobileprovision'));

    if (originalProvisionFile) {
      const originalPath = path.join(provisioningFolder, originalProvisionFile);
      const renamedFile = `${profile2.uuid}.mobileprovision`;
      const renamedPath = path.join(provisioningFolder, renamedFile);
      const targetPath = path.join(os.homedir(), 'Library/MobileDevice/Provisioning Profiles', renamedFile);

      console.log(`🔧 Attempting to rename: ${originalPath}`);
      console.log(`🔧 New path will be: ${renamedPath}`);
      fs.renameSync(originalPath, renamedPath);
      console.log(`✅ Renamed ${originalProvisionFile} → ${renamedFile}`);

      // Wait for file system to confirm existence
      let retries = 30;
      while (!fs.existsSync(renamedPath) && retries > 0) {
        console.warn(`⏳ Waiting for ${renamedPath} to appear...`);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200); // wait 200ms
        retries--;
      }

      if (!fs.existsSync(renamedPath)) {
        console.error(`❌ File still not found after rename: ${renamedPath}`);
        defer.reject();
        return;
      }

      console.log(`📦 Confirmed file exists. Preparing to copy to: ${targetPath}`);
      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
        console.log(`📁 Created target directory: ${targetDir}`);
      }

      fs.copyFileSync(renamedPath, targetPath);
      console.log(`✅ ${renamedFile} copied to macOS provisioning folder`);
    }

    // Patch build.js
    const buildJsPath = path.join(context.opts.projectRoot, 'node_modules', 'cordova-ios', 'lib', 'build.js');
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

    if (fs.existsSync(buildJsPath)) {
      let content = fs.readFileSync(buildJsPath, 'utf8');
      if (content.includes(searchLine)) {
        content = content.replace(searchLine, replacementBlock);
        fs.writeFileSync(buildJsPath, content, 'utf8');
        console.log('✅ build.js patched successfully.');
      } else {
        console.warn('❌ Target line not found in build.js');
      }
    } else {
      console.warn('❌ build.js not found');
    }

    // Add second target via Ruby script
    if (!projectName) {
      console.error("❌ Couldn't find project name in config.xml");
      defer.reject();
      return;
    }

    const projectPath = path.join(context.opts.projectRoot, 'platforms', 'ios', `${projectName}`);
    const xcodeprojPath = path.join(context.opts.projectRoot, 'platforms', 'ios', `${projectName}.xcodeproj`);
    const rubyScriptPath = path.join(context.opts.plugin.dir, 'hooks', 'add_target.rb');

    try {
      execSync('gem list xcodeproj -i', { stdio: 'ignore' });
    } catch (err) {
      console.log('📦 Installing missing xcodeproj gem...');
      execSync('gem install xcodeproj', { stdio: 'inherit' });
    }

    try {
      execSync(`ruby "${rubyScriptPath}" "${secondTargetName}" "${bundleId2}" "${xcodeprojPath}" "${projectPath}" "${context.opts.projectRoot}" "${profile2.name}" "${profile2.uuid}" "${profile2.teamId}"`, { stdio: 'inherit' });
      console.log('✅ Ruby target script executed successfully');
      defer.resolve(profile2);
    } catch (error) {
      console.error('🚨 Failed to execute Ruby script:', error.message);
      defer.reject();
    }
  });

  return defer.promise;
};
