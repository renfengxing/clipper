Pod::Spec.new do |s|
  s.name           = 'ClipperMedia'
  s.version        = '1.0.0'
  s.summary        = '片段裁剪 / 合并 / 字幕烧录（AVFoundation）'
  s.description    = '把标记好的片段裁出来、可选烧录字幕与水印、写回系统相册'
  s.author         = ''
  s.homepage       = 'https://github.com/renfengxing/clipper'
  s.platforms      = { :ios => '13.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C 兼容
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
