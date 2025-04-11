"use strict";

const path = require("path");
const AdmZip = require("adm-zip");
const fs = require("fs");
const os = require("os");
const forge = require("node-forge");
const plist = require("plist");
const Q = require("q");
const { execSync } = require("child_process");

const {
  isCordovaAbove,
  getPlatformConfigs,
  getResourcesFolderPath,
  getZipFile,
  getFilesFromPath,
  log,
  copyFromSourceToDestPath,
  checkIfFolderExists
} = require("./utils.js");

const constants = {
  osTargetFolder: "provisioning-profiles"
};

const copyFileSync = (source, target) => {
  let targetFile = fs.lstatSync(target).isDirectory()
    ? path.join(target, path.basename(source))
    : target;
  fs.writeFileSync(targetFile, fs.readFileSync(source));
};

const copyFolderRecursiveSync = (source, targetFolder) => {
  if (fs.lstatSync(source).isDirectory()) {
    const files = fs.readdirSync(source);
    files.forEach(file => {
      const curSource = path.join(source, file);
      if (fs.lstatSync(curSource).isDirectory()) {
        copyFolderRecursiveSync(curSource, targetFolder);
      } else {
        copyFileSync(curSource, targetFolder);
        const targetFile = path.join(targetFolder, path.basename(curSource));
        const exists = fs.existsSync(targetFile);
        log(`file ${targetFile} copied ${exists ? 'with success' : 'without success'}`, exists ? 'success' : 'error');
      }
    });
  }
};

const listDirectoryContents = directoryPath => {
  const files = fs.readdirSync(directoryPath);
  files.forEach(file => {
    const fullPath = path.join(directoryPath, file);
    const stats = fs.statSync(fullPath);
    console.log(`${stats.isDirectory() ? 'Directory' : 'File'}: ${fullPath}`);
    if (stats.isDirectory()) {
      listDirectoryContents(fullPath);
    }
  });
};

const extractProfileInfo = (filePath) => {
  let xml;

  try {
    // Primary attempt with node-forge
    const raw = fs.readFileSync(filePath, 'binary');
    const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(raw));
    xml = p7.content.toString();
    return parseProvisioning(xml);
  } catch (e) {
    console.warn('⚠️ node-forge failed, trying macOS security command...');
  }

  try {
    xml = execSync(`security cms -D -i "${filePath}"`).toString();
    return parseProvisioning(xml);
  } catch (err) {
    console.error('❌ Failed to extract profile using `security cms -D`:', err.message);
    throw err;
  }
};

function parseProvisioning(xml) {
  try {
    const parsed = plist.parse(xml);
    return {
      name: parsed.Name,
      uuid: parsed.UUID,
      teamId: parsed.TeamIdentifier?.[0] || parsed.Entitlements?.['com.apple.developer.team-identifier'] || ''
    };
  } catch (e) {
    console.error('❌ Failed to parse plist XML:', xml.substring(0, 500));
    throw e;
  }
}

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

  const wwwPath = getResourcesFolderPath(context, platform, platformConfig);
  const sourceFolderPath = path.join(context.opts.projectRoot, "platforms", "ios", "www", constants.osTargetFolder);
  const provisioningProfilesZipFile = getZipFile(sourceFolderPath, constants.osTargetFolder);

  if (!provisioningProfilesZipFile) {
    log("🚨 No zip file found containing provisioning profiles", "error");
    defer.reject();
    return defer.promise;
  }

  const zip = new AdmZip(provisioningProfilesZipFile);
  const extractedPath = path.join(wwwPath, constants.osTargetFolder);
  zip.extractAllTo(extractedPath, true);

  const files = getFilesFromPath(extractedPath);
  const profileFiles = files.filter(name => name.endsWith(".mobileprovision"));

  if (!profileFiles.length) {
    log("🚨 No .mobileprovision files found", "error");
    defer.reject();
    return defer.promise;
  }

  const pluginProfileFolder = path.join(context.opts.plugin.dir, constants.osTargetFolder);
  fs.mkdirSync(pluginProfileFolder, { recursive: true });

  const profileDataList = [];

  profileFiles.forEach((fileName) => {
    const sourceFilePath = path.join(extractedPath, fileName);
    const { name, uuid, teamId } = extractProfileInfo(sourceFilePath);

    const renamedFileName = `${uuid}.mobileprovision`;
    const renamedFilePath = path.join(extractedPath, renamedFileName);
    fs.renameSync(sourceFilePath, renamedFilePath);

    const pluginDestPath = path.join(pluginProfileFolder, renamedFileName);
    copyFromSourceToDestPath(defer, renamedFilePath, pluginDestPath);

    const platformAppFolder = path.join(context.opts.projectRoot, "platforms", platform, "app");
    if (checkIfFolderExists(platformAppFolder)) {
      const platformDestPath = path.join(platformAppFolder, renamedFileName);
      copyFromSourceToDestPath(defer, renamedFilePath, platformDestPath);
    }

    profileDataList.push({ name, uuid, teamId });
  });

  const macTargetFolder = path.join(os.homedir(), "Library/MobileDevice/Provisioning Profiles");
  if (!fs.existsSync(macTargetFolder)) {
    fs.mkdirSync(path.dirname(macTargetFolder), { recursive: true });
    fs.mkdirSync(macTargetFolder);
    console.log(`✅ Created macOS provisioning profiles folder: ${macTargetFolder}`);
  }

  console.log("👉 Listing macOS provisioning folder BEFORE copy:");
  listDirectoryContents(macTargetFolder);
  copyFolderRecursiveSync(pluginProfileFolder, macTargetFolder);
  console.log("👉 Listing macOS provisioning folder AFTER copy:");
  listDirectoryContents(macTargetFolder);

  log("✅ All provisioning profile steps completed successfully!", "success");
  console.log("Provisioning profiles parsed:");
  profileDataList.forEach(p => console.log(`📦 ${p.name} — UUID: ${p.uuid}`));

  // --- Handle Ruby script call ---
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

  const profile = profileDataList[0];
  const teamId = profile.teamId;

  console.log(`📡 Calling Ruby script to add target "${targetName}" with profile "${profile.name}"`);
  try {
    execSync(
      `ruby "${rubyScriptPath}" "${targetName}" "${bundleId}" "${xcodeprojPath}" "${context.opts.projectRoot}" "${profile.name}" "${teamId}"`,
      { stdio: 'inherit' }
    );
    console.log('✅ Ruby target script executed successfully');
  } catch (error) {
    console.error('🚨 Failed to execute Ruby script:', error.message);
    defer.reject();
    return defer.promise;
  }

  defer.resolve(profileDataList);
  return defer.promise;
};
