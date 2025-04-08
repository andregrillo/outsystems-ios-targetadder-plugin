#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const parseString = require('xml2js').parseString;

/**
 * Retrieves the project name from config.xml.
 * @returns {string|null} - The project name.
 */
function getProjectName() {
  var config = fs.readFileSync('config.xml').toString();
  var name;
  parseString(config, function (err, result) {
    if (err) {
      throw new Error('Unable to parse config.xml: ' + err);
    }
    name = result.widget.name.toString();
    // Remove leading and trailing spaces.
    name = name.replace(/^\s+|\s+$/g, '');
  });
  return name || null;
}

module.exports = function(context) {
  // Retrieve the command-line arguments for plugin preferences.
  const args = process.argv;
  let targetName;
  let bundleID;

  // Loop through the arguments to extract TARGET_NAME and BUNDLE_ID values.
  args.forEach(arg => {
    if (arg.includes('TARGET_NAME=')) {
      const parts = arg.split('=');
      targetName = parts[parts.length - 1];
    } else if (arg.includes('BUNDLE_ID=')) {
      const parts = arg.split('=');
      bundleID = parts[parts.length - 1];
    }
  });

  // Log the project root obtained from the context.
  const projectRoot = context.opts.projectRoot;
  console.log(`Project root: ${projectRoot}`);
  
  // Get the project name from config.xml and build the xcodeproj path.
  var projectName = getProjectName();
  var xcodeprojPath = path.join(projectRoot, 'platforms', 'ios', projectName + ".xcodeproj");

  /**
   * Checks if a gem is installed.
   * @param {string} gemName - The name of the gem to check.
   * @returns {boolean} - True if the gem is installed, false otherwise.
   */
  function gemInstalled(gemName) {
    try {
      execSync(`gem list ${gemName} -i`, { stdio: 'ignore' });
      return true;
    } catch (error) {
      return false;
    }
  }

  // Check and install the xcodeproj gem if it's not already installed.
  if (!gemInstalled('xcodeproj')) {
    console.log('Installing gem xcodeproj...');
    execSync('gem install xcodeproj', { stdio: 'inherit' });
  }

  // Determine the path to the Ruby script that adds the target.
  // (Assuming the add_target.rb is located in the plugin's hooks directory.)
  const rubyScriptPath = path.join(projectRoot, 'plugins', 'TargetAdder', 'hooks', 'add_target.rb');
  if (!fs.existsSync(rubyScriptPath)) {
    console.error('Ruby script add_target.rb not found!');
    process.exit(1);
  }

  // Execute the Ruby script passing the targetName, bundleID and xcodeprojPath as arguments.
  // The quotes ensure that paths with spaces are treated as a single argument.
  console.log('Executing Ruby script to add target...');
  execSync(
    `ruby "${rubyScriptPath}" "${targetName}" "${bundleID}" "${xcodeprojPath}" "${projectRoot}"`,
    { stdio: 'inherit' }
  );
  console.log('Target added successfully!');
};