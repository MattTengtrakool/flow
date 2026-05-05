#!/bin/sh
set -eu

APP_DIR="electron/native-audio/build/FlowAudioCapture.app"
MACOS_DIR="$APP_DIR/Contents/MacOS"

rm -rf "$APP_DIR" electron/native-audio/build/FlowAudioCapture
mkdir -p "$MACOS_DIR"
cp electron/native-audio/Info.plist "$APP_DIR/Contents/Info.plist"

xcrun clang++ -std=c++17 -fobjc-arc \
  -framework Foundation \
  -framework AVFoundation \
  -framework CoreGraphics \
  -framework CoreMedia \
  -framework ScreenCaptureKit \
  -framework Speech \
  electron/native-audio/FlowAudioCapture.mm \
  -o "$MACOS_DIR/FlowAudioCapture"

codesign --force --deep --sign - \
  --identifier com.flow.worklog.native-audio \
  "$APP_DIR"
