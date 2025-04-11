"use strict";

const fs = require("fs");
const path = require("path");
const plist = require("plist");

module.exports = function (context) {
  const projectRoot = context.opts.projectRoot;
  const patchFilePath = path.join(projectRoot, "patch_export_options.json");
  const exportPlistPath = path.join(projectRoot, "platforms", "ios", "exportOptions.plist");

  if (!fs.existsSync(patchFilePath)) {
    console.warn("⚠️ No patch_export_options.json file found. Skipping exportOptions.plist patch.");
    return;
  }

  if (!fs.existsSync(exportPlistPath)) {
    console.warn("⚠️ exportOptions.plist not found. Skipping exportOptions patch.");
    return;
  }

  const patchData = JSON.parse(fs.readFileSync(patchFilePath, "utf8"));
  const exportPlistRaw = fs.readFileSync(exportPlistPath, "utf8");
  const exportPlist = plist.parse(exportPlistRaw);

  if (!exportPlist.provisioningProfiles) exportPlist.provisioningProfiles = {};
  exportPlist.provisioningProfiles[patchData.bundleId] = patchData.uuid;
  exportPlist.signingStyle = "manual";

  fs.writeFileSync(exportPlistPath, plist.build(exportPlist), "utf8");

  console.log(`✅ exportOptions.plist updated with: ${patchData.bundleId} → ${patchData.uuid}`);
};