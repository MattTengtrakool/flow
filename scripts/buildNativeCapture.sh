#!/bin/sh
set -eu

APP_DIR="electron/native-capture/build/FlowNativeCapture.app"
MACOS_DIR="$APP_DIR/Contents/MacOS"

rm -rf "$APP_DIR" electron/native-capture/build/FlowNativeCapture
mkdir -p "$MACOS_DIR"
cp electron/native-capture/Info.plist "$APP_DIR/Contents/Info.plist"

xcrun clang++ -std=c++17 -fobjc-arc \
  -framework Foundation \
  -framework AppKit \
  -framework ApplicationServices \
  -framework CoreGraphics \
  -framework ScreenCaptureKit \
  -framework Vision \
  electron/native-capture/FlowNativeCapture.mm \
  -o "$MACOS_DIR/FlowNativeCapture"

codesign --force --deep --sign - \
  --identifier com.flow.worklog.native-capture \
  "$APP_DIR"
