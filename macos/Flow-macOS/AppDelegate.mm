#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>

@interface AppDelegate ()

@property (nonatomic, strong) NSStatusItem *statusItem;
@property (nonatomic, strong, nullable) NSWindow *debugWindow;

@end

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification
{
  NSLog(@"[Flow] applicationDidFinishLaunching");
#if DEBUG
  // Point the packager at port 8082 so Flow does not clash with other RN/Expo
  // projects that run on the default 8081.
  [RCTBundleURLProvider sharedSettings].jsLocation = @"localhost:8082";
#endif
  self.automaticallyLoadReactNativeWindow = NO;
  self.moduleName = @"Flow";
  self.initialProps = @{};
  self.dependencyProvider = [RCTAppDependencyProvider new];

  [super applicationDidFinishLaunching:notification];

#if DEBUG
  [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
#else
  [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
#endif
  [self configureStatusItem];

#if DEBUG
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.4 * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
                   [self openDebugWindow:nil];
                 });
#endif
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender
{
  return NO;
}

- (void)configureStatusItem
{
  NSLog(@"[Flow] configureStatusItem");
  self.statusItem = [NSStatusBar.systemStatusBar statusItemWithLength:NSVariableStatusItemLength];
  self.statusItem.visible = YES;

  if (self.statusItem.button != nil) {
    NSImage *icon = [NSImage imageNamed:@"MenuBarIcon"];

    if (icon == nil) {
      icon = [NSImage imageWithSystemSymbolName:@"waveform.path" accessibilityDescription:@"Flow"];
    }

    if (icon != nil) {
      icon.size = NSMakeSize(18, 18);
      [icon setTemplate:YES];
      self.statusItem.button.image = icon;
    }

    self.statusItem.button.imagePosition = NSImageLeading;
    self.statusItem.button.title = @"Flow";
    self.statusItem.button.toolTip = @"Flow";
    NSLog(@"[Flow] status item button created with title %@", self.statusItem.button.title);
  } else {
    NSLog(@"[Flow] status item button is nil");
  }

  NSMenu *menu = [[NSMenu alloc] initWithTitle:@"Flow"];

  NSMenuItem *openDebugWindowItem = [[NSMenuItem alloc] initWithTitle:@"Open Debug Window"
                                                               action:@selector(openDebugWindow:)
                                                        keyEquivalent:@""];
  openDebugWindowItem.target = self;
  [menu addItem:openDebugWindowItem];
  [menu addItem:[NSMenuItem separatorItem]];

  NSMenuItem *quitItem = [[NSMenuItem alloc] initWithTitle:@"Quit"
                                                    action:@selector(quitApp:)
                                             keyEquivalent:@""];
  quitItem.target = self;
  [menu addItem:quitItem];

  self.statusItem.menu = menu;
}

- (void)openDebugWindow:(id)sender
{
  if (self.debugWindow == nil) {
    self.debugWindow = [self createDebugWindow];
    self.debugWindow.delegate = self;
  }

  [NSApp activateIgnoringOtherApps:YES];
  [self.debugWindow makeKeyAndOrderFront:nil];
}

- (void)quitApp:(id)sender
{
  [NSApp terminate:nil];
}

- (NSWindow *)createDebugWindow
{
  NSRect frame = NSMakeRect(0, 0, 1120, 860);
  NSWindow *window = [[NSWindow alloc] initWithContentRect:frame
                                                 styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];

  window.title = @"Flow Debug";
  window.releasedWhenClosed = NO;
  window.minSize = NSMakeSize(960, 720);
  window.contentView = [self createReactDebugContentView];
  [window center];

  return window;
}

- (NSView *)createReactDebugContentView
{
  NSDictionary *initialProperties = @{
    @"surface": @"debugWindow",
    @"title": @"React Native Debug Window"
  };

  NSView *reactRootView = [self.rootViewFactory viewWithModuleName:self.moduleName
                                                 initialProperties:initialProperties];
  reactRootView.frame = NSMakeRect(0, 0, 1120, 860);
  reactRootView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;

  return reactRootView;
}

- (void)windowWillClose:(NSNotification *)notification
{
  if (notification.object == self.debugWindow) {
    self.debugWindow = nil;
  }
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

/// This method controls whether the `concurrentRoot`feature of React18 is turned on or off.
///
/// @see: https://reactjs.org/blog/2022/03/29/react-v18.html
/// @note: This requires to be rendering on Fabric (i.e. on the New Architecture).
/// @return: `true` if the `concurrentRoot` feature is enabled. Otherwise, it returns `false`.
- (BOOL)concurrentRootEnabled
{
#ifdef RN_FABRIC_ENABLED
  return true;
#else
  return false;
#endif
}

@end
