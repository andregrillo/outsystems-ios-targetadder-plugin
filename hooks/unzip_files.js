#!/usr/bin/env node
var fs = require("fs");
var path = require("path");

// Require the prerequisites hook.
var installPrerequisites = require("./install_prerequisites.js");

module.exports = function(context) {
  // Return the promise from the prerequisites hook so Cordova waits for it.
  return installPrerequisites(context).then(function() {
    // Now that prerequisites are installed, require adm-zip.
    var AdmZip;
    try {
      AdmZip = require("adm-zip");
    } catch (e) {
      console.error("Error: 'adm-zip' module not found. Make sure to run 'npm install adm-zip' in your plugin folder.");
      process.exit(1);
    }
    
    const args = process.argv;
    var targetName;
    var bundleID;
    
    // Parse command-line arguments for TARGET_NAME and BUNDLE_ID.
    args.forEach(arg => {
      if (arg.includes('SECOND_TARGET_NAME=')) {
        var parts = arg.split("=");
        targetName = parts.slice(-1).pop();
      } else if (arg.includes('SECOND_TARGET_BUNDLE_ID=')) {
        var parts = arg.split("=");
        bundleID = parts.slice(-1).pop();
      }
    });
    
    // Build source file path and destination folder path.
    // The zip file is expected at: platforms/ios/www/<targetName>/<bundleID>.zip
    // It will be extracted to: projectRoot/<targetName>
    var sourceFilePath = path.join(context.opts.projectRoot, 'platforms/ios/www', targetName, bundleID + '.zip');
    var destFolderPath = path.join(context.opts.projectRoot, targetName);
        
    // Check if the zip file exists.
    if (!fs.existsSync(sourceFilePath)) {
      console.error("🚨 " + bundleID + ".zip file not found in platforms/ios/www/" + targetName);
      return;
    } 
    
    // Unzip the file into the destination folder.
    try {
      var zip = new AdmZip(sourceFilePath);
      // The second parameter 'true' indicates that existing files should be overwritten.
      zip.extractAllTo(destFolderPath, true);
      console.log("Zip file extracted successfully to: " + destFolderPath);
    } catch (error) {
      console.error("🚨 Error extracting zip file: " + error);
    }
    
    console.log("Unzip complete!");
  }).catch(function(err) {
    console.error("🚨 Prerequisites installation failed: ", err);
    process.exit(1);
  });
};