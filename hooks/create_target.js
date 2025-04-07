#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
  // (Assuming the add_target.rb is located in the same folder as this hook.
  const rubyScriptPath = path.join(projectRoot, 'plugins', 'outsystems-ios-targetadder-plugin', 'add_target.rb');
  if (!fs.existsSync(rubyScriptPath)) {
    console.error('Ruby script add_target.rb not found!');
    process.exit(1);
  }

  // Execute the Ruby script passing the targetName and bundleID as arguments.
  console.log('Executing Ruby script to add target...');
  execSync(`ruby ${rubyScriptPath} ${targetName} ${bundleID}`, { stdio: 'inherit' });
  console.log('Target added successfully!');
};