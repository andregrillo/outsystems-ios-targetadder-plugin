#!/usr/bin/env ruby
require 'xcodeproj'

# Read arguments
target_name    = ARGV[0]
bundle_id      = ARGV[1]
xcodeproj_path   = ARGV[2]
project_path = ARGV[3]
file_base_root = ARGV[4]
profile_name   = ARGV[5]
profile_uuid   = ARGV[6]
team_id        = ARGV[7]

puts "==>target_name : #{target_name}"
puts "==>bundle_id : #{bundle_id}"
puts "==>xcodeproj_path : #{xcodeproj_path}"
puts "==>project_path : #{project_path}"
puts "==>file_base_root : #{file_base_root}"
puts "==>profile_name : #{profile_name}"
puts "==>profile_uuid : #{profile_uuid}"
puts "==>team_id : #{team_id}"

# Open the Xcode project
project = Xcodeproj::Project.open(xcodeproj_path)

# Create new target
new_target = project.new_target(:app_extension, target_name, :ios, nil)

# Optional: uncomment to set product type explicitly
# new_target.product_type = "com.apple.product-type.app-extension.widgetkit"

# Set build settings for manual signing
new_target.build_configuration_list.build_configurations.each do |config|
  config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = bundle_id
  config.build_settings['CODE_SIGN_STYLE'] = 'Manual'
  config.build_settings['CODE_SIGN_IDENTITY'] = 'Apple Development'
  #config.build_settings['PROVISIONING_PROFILE_SPECIFIER'] = profile_name
  #config.build_settings['PROVISIONING_PROFILE'] = profile_name
  config.build_settings['PROVISIONING_PROFILE'] = profile_uuid
  config.build_settings['PROVISIONING_PROFILE_SPECIFIER'] = profile_name
  config.build_settings['DEVELOPMENT_TEAM'] = team_id unless team_id.nil? || team_id.strip.empty?
end

# Create or find target group
target_group = project.main_group[target_name]
target_group ||= project.main_group.new_group(target_name, nil)

# Base folder with files to add
#base_folder = File.join(file_base_root, target_name)

# Add resource files
copy_phase = new_target.new_copy_files_build_phase("Copy Resources")
copy_phase.dst_subfolder_spec = "resources"
copy_phase.dst_path = ""

Dir.glob(File.join(project_path, "Resources/**/*.*")).each do |file_path|
  puts "==>file_path : #{file_path}"
  next if File.directory?(file_path)
  file_ref = target_group.find_file_by_path(file_path) || target_group.new_file(file_path)
  copy_phase.add_file_reference(file_ref)
end

# Add source files
Dir.glob(File.join(project_path, "Sources/**/*.swift")).each do |file_path|
  puts "==>file_path Sources/Swift: #{file_path}"
  next if File.directory?(file_path)
  file_ref = target_group.find_file_by_path(file_path) || target_group.new_file(file_path)
  new_target.source_build_phase.add_file_reference(file_ref)
end

# Add frameworks
framework_files = Dir.glob(File.join(project_path, "Frameworks/**/*.framework"))
unless framework_files.empty?
  frameworks_phase = new_target.new_copy_files_build_phase("Embed Frameworks")
  frameworks_phase.dst_subfolder_spec = "frameworks"
  frameworks_phase.dst_path = ""
  framework_files.each do |file_path|
    next unless File.directory?(file_path)
    file_ref = target_group.find_file_by_path(file_path) || target_group.new_file(file_path)
    frameworks_phase.add_file_reference(file_ref)
    new_target.frameworks_build_phase.add_file_reference(file_ref)
  end
end

# Add Info.plist
plist_file_path = File.join(project_path, "Info.plist")
puts "==>plist_file_path : #{plist_file_path}"
if File.exist?(plist_file_path)
  plist_file_ref = target_group.find_file_by_path(plist_file_path) || target_group.new_file(plist_file_path)
  new_target.build_configuration_list.build_configurations.each do |config|
    config.build_settings["INFOPLIST_FILE"] = plist_file_path
  end
  puts "✅ Info.plist set for the target at: #{plist_file_path}"
else
  puts "⚠️ No Info.plist file found at: #{plist_file_path}"
end

# Save and finish
project.save
puts "✅ New target '#{target_name}' created with:"
puts "   - Bundle ID: #{bundle_id}"
puts "   - Provisioning Profile: #{profile_name}"
puts "   - Team ID: #{team_id.nil? || team_id.empty? ? 'Not set' : team_id}'"