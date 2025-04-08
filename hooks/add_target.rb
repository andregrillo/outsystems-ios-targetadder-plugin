#!/usr/bin/env ruby
require 'xcodeproj'

# Read arguments: target name, bundle identifier, project path, and file base root.
target_name    = ARGV[0]
bundle_id      = ARGV[1]
project_path   = ARGV[2]
file_base_root = ARGV[3]

# Open the Xcode project at the given path.
project = Xcodeproj::Project.open(project_path)

# Create a new target using the provided variables.
new_target = project.new_target(:app_extension, target_name, :ios, nil)
# Override its product type to be a WidgetKit extension.
#new_target.product_type = "com.apple.product-type.app-extension.widgetkit"

# Configure the new target with the provided bundle identifier.
new_target.build_configuration_list.build_configurations.each do |config|
  config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = bundle_id
end

# ------------------------------------------------------------------------------
# Create or find a group in the project navigator to hold all new files.
# In this example, we name the group after the target.
# ------------------------------------------------------------------------------
target_group = project.main_group[ target_name ]
unless target_group
  # If the group doesn't exist, create it. 
  # The second parameter is the path (relative or absolute) on disk;
  # use nil or "" if you just want a logical group.
  target_group = project.main_group.new_group(target_name, nil)
end

# Define the base folder where the additional files are located.
# Files are expected to be found under: file_base_root/<target_name>
base_folder = File.join(file_base_root, target_name)

# ------------------------------
# Add Resource Files Using Wildcards
# ------------------------------
copy_phase = new_target.new_copy_files_build_phase("Copy Resources")
copy_phase.dst_subfolder_spec = "resources"  # Must be a string.
copy_phase.dst_path = ""                     # Optional: customize if needed.

resource_wildcard = File.join(base_folder, "Resources/**/*.*")
resource_files  = Dir.glob(resource_wildcard)

if resource_files.empty?
  puts "No resource files found matching #{resource_wildcard}"
else
  resource_files.each do |file_path|
    next if File.directory?(file_path)
    
    # Add to the target group instead of the main group.
    file_ref = target_group.find_file_by_path(file_path) ||
               target_group.new_file(file_path)
    
    copy_phase.add_file_reference(file_ref)
  end
end

# ------------------------------
# Add Source Files Using Wildcards
# ------------------------------
source_wildcard = File.join(base_folder, "Sources/**/*.swift")
source_files  = Dir.glob(source_wildcard)

if source_files.empty?
  puts "No source files found matching #{source_wildcard}"
else
  source_files.each do |file_path|
    next if File.directory?(file_path)
    
    file_ref = target_group.find_file_by_path(file_path) ||
               target_group.new_file(file_path)
    
    new_target.source_build_phase.add_file_reference(file_ref)
  end
end

# ------------------------------
# Add Frameworks Using Wildcards
# ------------------------------
frameworks_wildcard = File.join(base_folder, "Frameworks/**/*.framework")
framework_files  = Dir.glob(frameworks_wildcard)

if framework_files.empty?
  puts "No framework files found matching #{frameworks_wildcard}"
else
  frameworks_phase = new_target.new_copy_files_build_phase("Embed Frameworks")
  frameworks_phase.dst_subfolder_spec = "frameworks"
  frameworks_phase.dst_path = ""

  framework_files.each do |file_path|
    next unless File.directory?(file_path)
    
    file_ref = target_group.find_file_by_path(file_path) ||
               target_group.new_file(file_path)
    
    # Embed the framework...
    frameworks_phase.add_file_reference(file_ref)
    # ...and also link it.
    new_target.frameworks_build_phase.add_file_reference(file_ref)
  end
end

# ------------------------------
# Add and Configure Info.plist
# ------------------------------
plist_file_path = File.join(base_folder, "Info.plist")
if File.exist?(plist_file_path)
  plist_file_ref = target_group.find_file_by_path(plist_file_path) ||
                   target_group.new_file(plist_file_path)
  
  # Set the Info.plist path in build settings for this target.
  new_target.build_configuration_list.build_configurations.each do |config|
    config.build_settings["INFOPLIST_FILE"] = plist_file_path
  end

  puts "Info.plist found and set for the target at: #{plist_file_path}"
else
  puts "No Info.plist file found at: #{plist_file_path}"
end

# Save the changes to the project.
project.save
puts "New target '#{target_name}' with bundle identifier '#{bundle_id}' added successfully!"