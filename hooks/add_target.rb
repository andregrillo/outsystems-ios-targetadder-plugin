#!/usr/bin/env ruby
require 'xcodeproj'

# Captura os argumentos passados na linha de comando
# ARGV[0] -> targetName
# ARGV[1] -> bundleID
target_name = ARGV[0] || "DefaultTarget"
bundle_id = ARGV[1] || "com.default.bundle"

# Defina o caminho para o seu projeto Xcode
project_path = 'path/to/YourApp.xcodeproj'
project = Xcodeproj::Project.open(project_path)

# Cria um novo target utilizando as variáveis passadas
new_target = project.new_target(:application, target_name, :ios, nil)

# Configura o novo target com o bundle identifier fornecido
new_target.build_configuration_list.each do |config|
  config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = bundle_id
end

# Salva as alterações no projeto
project.save
puts "Novo target '#{target_name}' com bundle identifier '#{bundle_id}' adicionado com sucesso!"