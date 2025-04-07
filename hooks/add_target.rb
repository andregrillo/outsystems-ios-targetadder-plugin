#!/usr/bin/env ruby
require 'xcodeproj'

# Read arguments: target name, bundle identifier, and project path.
target_name = ARGV[0]
bundle_id = ARGV[1]
project_path = ARGV[2]

# Open the Xcode project at the given path.
project = Xcodeproj::Project.open(project_path)

# Create a new target using the provided variables.
new_target = project.new_target(:application, target_name, :ios, nil)

# Configure the new target with the provided bundle identifier by iterating over the build configurations.
new_target.build_configuration_list.build_configurations.each do |config|
  config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = bundle_id
end

# Save the changes to the project.
project.save
puts "New target '#{target_name}' with bundle identifier '#{bundle_id}' added successfully!"