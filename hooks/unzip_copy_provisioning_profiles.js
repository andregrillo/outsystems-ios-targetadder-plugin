"use strict";

const path = require("path");
const AdmZip = require("adm-zip");
const fs = require("fs");
const os = require("os");
const forge = require("node-forge");
const plist = require("plist");
const Q = require("q");

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
  const raw = fs.readFileSync(filePath, 'binary');
  const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(raw));
  const xml = p7.content.toString();
  const parsed = plist.parse(xml);

  return {
    name: parsed.Name,
    uuid: parsed.UUID
  };
};

module.exports = function (context) {
  log("⭐️ Started provisioning profiles handling", "start");

  const defer = Q.defer();
  const platform = context.opts.plugin.platform;
  const platformConfig = getPlatformConfigs(platform);

  if (!platformConfig) {
    log("🚨 Invalid platform", "error");
    return defer.reject();
  }

  const wwwPath = getResourcesFolderPath(context, platform, platformConfig);
  const sourceFolderPath = path.join(context.opts.projectRoot, "www", constants.osTargetFolder);
  const provisioningProfilesZipFile = getZipFile(sourceFolderPath, constants.osTargetFolder);

  if (!provisioningProfilesZipFile) {
    log("🚨 No zip file found containing provisioning profiles", "error");
    return defer.reject();
  }

  const zip = new AdmZip(provisioningProfilesZipFile);
  const extractedPath = path.join(wwwPath, constants.osTargetFolder);
  zip.extractAllTo(extractedPath, true);

  const files = getFilesFromPath(extractedPath);
  const profileFiles = files.filter(name => name.endsWith(".mobileprovision"));

  if (!profileFiles.length) {
    log("🚨 No .mobileprovision files found", "error");
    return defer.reject();
  }

  const pluginProfileFolder = path.join(context.opts.plugin.dir, constants.osTargetFolder);
  fs.mkdirSync(pluginProfileFolder, { recursive: true });

  const profileDataList = [];

  profileFiles.forEach((fileName) => {
    const sourceFilePath = path.join(extractedPath, fileName);
    const { name, uuid } = extractProfileInfo(sourceFilePath);

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

    profileDataList.push({ name, uuid });
  });

  // Copy to macOS system Provisioning Profiles folder
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

  // You can optionally persist the profile data here or return it
  console.log("Provisioning profiles parsed:");
  profileDataList.forEach(p => console.log(`📦 ${p.name} — UUID: ${p.uuid}`));

  defer.resolve(profileDataList);
  return defer.promise;
};