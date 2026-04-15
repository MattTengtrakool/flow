#import "ContextCaptureModule.h"

#import <ApplicationServices/ApplicationServices.h>
#import <CommonCrypto/CommonDigest.h>
#import <CoreGraphics/CGEventSource.h>
#import <CoreGraphics/CGWindow.h>
#import <React/RCTBridgeModule.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <Vision/Vision.h>

static const NSUInteger kMaxPreviewBytes = 524288;
static const CGFloat kInitialJPEGQuality = 0.85;
static const CGFloat kMinimumJPEGQuality = 0.1;
static const CGFloat kQualityStep = 0.05;
static const NSUInteger kMaxOCRTextLength = 4000;
static const size_t kDHashWidth = 9;
static const size_t kDHashHeight = 8;
static const CGFloat kPrivacyMaskPadding = 6.0;
static NSString *const kCapturePrivacyVersion = @"capture-privacy-v1";

@interface CapturePrivacyRedactionResult : NSObject

@property (nonatomic, assign, nullable) CGImageRef image;
@property (nonatomic, copy, nullable) NSString *ocrText;
@property (nonatomic, assign) BOOL checked;
@property (nonatomic, assign) BOOL applied;
@property (nonatomic, assign) NSUInteger matchCount;
@property (nonatomic, copy) NSArray<NSString *> *matchTypes;

- (instancetype)initWithImage:(nullable CGImageRef)image
                      ocrText:(nullable NSString *)ocrText
                      checked:(BOOL)checked
                      applied:(BOOL)applied
                   matchCount:(NSUInteger)matchCount
                   matchTypes:(NSArray<NSString *> *)matchTypes NS_DESIGNATED_INITIALIZER;
- (NSDictionary *)payload;

@end

@interface ContextCaptureModule () <RCTBridgeModule>

@property (nonatomic, assign) BOOL hasListeners;
@property (nonatomic, assign) BOOL monitoring;
@property (nonatomic, assign) BOOL preciseModeEnabled;
@property (nonatomic, assign) CFTimeInterval idleThresholdSeconds;
@property (nonatomic, strong, nullable) NSTimer *pollTimer;
@property (nonatomic, strong, nullable) id workspaceActivationObserver;
@property (nonatomic, strong, nullable) NSDictionary *lastSnapshot;
@property (nonatomic, strong, nullable) NSDictionary *lastExternalContextSeed;

@end

@implementation CapturePrivacyRedactionResult

- (instancetype)init
{
  return [self initWithImage:nil
                     ocrText:nil
                     checked:NO
                     applied:NO
                  matchCount:0
                  matchTypes:@[]];
}

- (instancetype)initWithImage:(nullable CGImageRef)image
                      ocrText:(nullable NSString *)ocrText
                      checked:(BOOL)checked
                      applied:(BOOL)applied
                   matchCount:(NSUInteger)matchCount
                   matchTypes:(NSArray<NSString *> *)matchTypes
{
  self = [super init];

  if (self != nil) {
    _image = image != nil ? CGImageRetain(image) : nil;
    _ocrText = [ocrText copy];
    _checked = checked;
    _applied = applied;
    _matchCount = matchCount;
    _matchTypes = [matchTypes copy];
  }

  return self;
}

- (void)dealloc
{
  if (_image != nil) {
    CGImageRelease(_image);
    _image = nil;
  }
}

- (NSDictionary *)payload
{
  return @{
    @"checked": @(self.checked),
    @"applied": @(self.applied),
    @"version": kCapturePrivacyVersion,
    @"matchCount": @(self.matchCount),
    @"matchTypes": self.matchTypes ?: @[]
  };
}

@end

@implementation ContextCaptureModule

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (dispatch_queue_t)methodQueue
{
  return dispatch_get_main_queue();
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[@"contextSnapshotDidChange"];
}

- (void)startObserving
{
  self.hasListeners = YES;
}

- (void)stopObserving
{
  self.hasListeners = NO;
}

- (instancetype)init
{
  self = [super init];

  if (self != nil) {
    _idleThresholdSeconds = 60.0;
    _preciseModeEnabled = NO;
    _monitoring = NO;
  }

  return self;
}

- (NSString *)currentTimestamp
{
  NSDateFormatter *formatter = [[NSDateFormatter alloc] init];
  formatter.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
  formatter.timeZone = [NSTimeZone timeZoneWithName:@"UTC"];
  formatter.dateFormat = @"yyyy-MM-dd'T'HH:mm:ss.SSS'Z'";

  return [formatter stringFromDate:NSDate.date];
}

- (id)nullableValue:(id)value
{
  return value != nil ? value : NSNull.null;
}

- (BOOL)isSelfApplication:(NSRunningApplication *)runningApplication
{
  return runningApplication.processIdentifier == NSProcessInfo.processInfo.processIdentifier;
}

- (NSDictionary *)permissionsStatusDictionary
{
  NSBundle *mainBundle = NSBundle.mainBundle;

  return @{
    @"accessibilityTrusted": @(AXIsProcessTrusted()),
    @"captureAccessGranted": @(CGPreflightScreenCaptureAccess()),
    @"hostBundleIdentifier": [self nullableValue:mainBundle.bundleIdentifier],
    @"hostBundlePath": [self nullableValue:mainBundle.bundlePath]
  };
}

- (NSString *)screenRecordingInactiveReason
{
  return @"Screen Recording access is not currently active. If you just granted it in System Settings, quit and relaunch Flow once, then try again.";
}

- (NSString *)normalizedString:(NSString *)value
{
  return [[value lowercaseString]
      stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
}

- (BOOL)text:(NSString *)text matchesPattern:(NSString *)pattern
{
  NSError *error = nil;
  NSRegularExpression *expression =
      [NSRegularExpression regularExpressionWithPattern:pattern options:0 error:&error];

  if (expression == nil || error != nil) {
    return NO;
  }

  NSRange range = NSMakeRange(0, text.length);
  return [expression firstMatchInString:text options:0 range:range] != nil;
}

- (BOOL)string:(NSString *)value containsAnySubstring:(NSArray<NSString *> *)substrings
{
  for (NSString *substring in substrings) {
    if ([value containsString:substring]) {
      return YES;
    }
  }

  return NO;
}

- (nullable NSString *)privacyMatchTypeForText:(NSString *)text
                                  previousText:(nullable NSString *)previousText
                                      nextText:(nullable NSString *)nextText
{
  NSString *normalized = [self normalizedString:text];

  if (normalized.length == 0) {
    return nil;
  }

  NSArray<NSString *> *secretContextKeywords = @[
    @"password",
    @"passcode",
    @"verification code",
    @"one-time code",
    @"secret",
    @"token",
    @"api key",
    @"access key",
    @"private key",
    @"recovery code",
    @"backup code",
    @"otp",
    @"2fa",
    @"auth code"
  ];
  NSString *previousNormalized = previousText != nil ? [self normalizedString:previousText] : @"";
  NSString *nextNormalized = nextText != nil ? [self normalizedString:nextText] : @"";
  NSString *nearbyContext =
      [NSString stringWithFormat:@"%@ %@", previousNormalized, nextNormalized];

  if ([self string:normalized containsAnySubstring:secretContextKeywords]) {
    return @"secret_label";
  }

  if ([self string:nearbyContext containsAnySubstring:secretContextKeywords]) {
    return @"secret_value";
  }

  if ([self text:text matchesPattern:@"(?i)\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b"]) {
    return @"email";
  }

  if ([self text:text matchesPattern:@"\\b(?:\\d[ -]*?){13,19}\\b"]) {
    return @"payment_card";
  }

  if ([self text:text matchesPattern:@"(?:^|\\b)\\+?\\d[\\d\\s().-]{7,}\\d(?:$|\\b)"]) {
    return @"phone";
  }

  if ([self text:text matchesPattern:@"(?i)\\b(?:sk-[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z\\-_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\\b"]) {
    return @"access_token";
  }

  if ([normalized containsString:@"-----begin"] && [normalized containsString:@"private key"]) {
    return @"private_key";
  }

  if ([self text:text matchesPattern:@"\\b(?=.*[A-Za-z])(?=.*\\d)[A-Za-z0-9_\\-]{24,}\\b"]) {
    return @"high_entropy_secret";
  }

  return nil;
}

- (NSDictionary *)dictionaryForRect:(CGRect)rect
{
  return @{
    @"x": @(rect.origin.x),
    @"y": @(rect.origin.y),
    @"width": @(rect.size.width),
    @"height": @(rect.size.height)
  };
}

- (nullable NSDictionary *)rectDictionaryFromAXElement:(AXUIElementRef)element
{
  CGPoint position = CGPointZero;
  CGSize size = CGSizeZero;
  BOOL hasPosition = NO;
  BOOL hasSize = NO;
  CFTypeRef positionValue = nil;
  CFTypeRef sizeValue = nil;

  if (AXUIElementCopyAttributeValue(element, kAXPositionAttribute, &positionValue) == kAXErrorSuccess &&
      positionValue != nil &&
      CFGetTypeID(positionValue) == AXValueGetTypeID() &&
      AXValueGetType((AXValueRef)positionValue) == kAXValueCGPointType) {
    AXValueGetValue((AXValueRef)positionValue, (AXValueType)kAXValueCGPointType, &position);
    hasPosition = YES;
  }

  if (AXUIElementCopyAttributeValue(element, kAXSizeAttribute, &sizeValue) == kAXErrorSuccess &&
      sizeValue != nil &&
      CFGetTypeID(sizeValue) == AXValueGetTypeID() &&
      AXValueGetType((AXValueRef)sizeValue) == kAXValueCGSizeType) {
    AXValueGetValue((AXValueRef)sizeValue, (AXValueType)kAXValueCGSizeType, &size);
    hasSize = YES;
  }

  if (positionValue != nil) {
    CFRelease(positionValue);
  }

  if (sizeValue != nil) {
    CFRelease(sizeValue);
  }

  if (!hasPosition || !hasSize) {
    return nil;
  }

  return [self dictionaryForRect:CGRectMake(position.x, position.y, size.width, size.height)];
}

- (nullable NSDictionary *)focusedWindowInfoForRunningApplication:(NSRunningApplication *)runningApplication
{
  if (!self.preciseModeEnabled || !AXIsProcessTrusted()) {
    return nil;
  }

  AXUIElementRef applicationElement = AXUIElementCreateApplication(runningApplication.processIdentifier);

  if (applicationElement == nil) {
    return nil;
  }

  CFTypeRef focusedWindow = nil;
  AXError windowError =
      AXUIElementCopyAttributeValue(applicationElement, kAXFocusedWindowAttribute, &focusedWindow);

  if (windowError != kAXErrorSuccess || focusedWindow == nil) {
    CFRelease(applicationElement);
    return nil;
  }

  NSString *windowTitle = nil;
  CFTypeRef titleValue = nil;

  if (AXUIElementCopyAttributeValue((AXUIElementRef)focusedWindow, kAXTitleAttribute, &titleValue) ==
          kAXErrorSuccess &&
      titleValue != nil &&
      CFGetTypeID(titleValue) == CFStringGetTypeID()) {
    windowTitle = [(__bridge NSString *)titleValue copy];
  }

  NSDictionary *windowFrame = [self rectDictionaryFromAXElement:(AXUIElementRef)focusedWindow];

  if (titleValue != nil) {
    CFRelease(titleValue);
  }

  CFRelease(focusedWindow);
  CFRelease(applicationElement);

  return @{
    @"title": [self nullableValue:windowTitle],
    @"frame": [self nullableValue:windowFrame]
  };
}

- (NSDictionary *)seedDictionaryForRunningApplication:(nullable NSRunningApplication *)runningApplication
{
  if (runningApplication == nil || [self isSelfApplication:runningApplication]) {
    if (self.lastExternalContextSeed != nil) {
      return self.lastExternalContextSeed;
    }

    return @{
      @"appName": NSNull.null,
      @"bundleIdentifier": NSNull.null,
      @"processId": NSNull.null,
      @"windowTitle": NSNull.null,
      @"windowFrame": NSNull.null,
      @"source": @"app"
    };
  }

  NSMutableDictionary *seed = [@{
    @"appName": [self nullableValue:runningApplication.localizedName],
    @"bundleIdentifier": [self nullableValue:runningApplication.bundleIdentifier],
    @"processId": @(runningApplication.processIdentifier),
    @"windowTitle": NSNull.null,
    @"windowFrame": NSNull.null,
    @"source": @"app"
  } mutableCopy];

  NSDictionary *windowInfo = [self focusedWindowInfoForRunningApplication:runningApplication];

  if (windowInfo != nil) {
    if (windowInfo[@"title"] != nil) {
      seed[@"windowTitle"] = windowInfo[@"title"];
    }

    if (windowInfo[@"frame"] != nil) {
      seed[@"windowFrame"] = windowInfo[@"frame"];
    }

    if (windowInfo[@"title"] != nil || windowInfo[@"frame"] != nil) {
      seed[@"source"] = @"window";
    }
  }

  self.lastExternalContextSeed = [seed copy];
  return seed;
}

- (NSDictionary *)comparableSnapshotFromSnapshot:(NSDictionary *)snapshot
{
  return @{
    @"appName": snapshot[@"appName"] ?: NSNull.null,
    @"bundleIdentifier": snapshot[@"bundleIdentifier"] ?: NSNull.null,
    @"processId": snapshot[@"processId"] ?: NSNull.null,
    @"windowTitle": snapshot[@"windowTitle"] ?: NSNull.null,
    @"windowFrame": snapshot[@"windowFrame"] ?: NSNull.null,
    @"source": snapshot[@"source"] ?: @"app",
    @"preciseModeEnabled": snapshot[@"preciseModeEnabled"] ?: @NO,
    @"accessibilityTrusted": snapshot[@"accessibilityTrusted"] ?: @NO,
    @"captureAccessGranted": snapshot[@"captureAccessGranted"] ?: @NO,
    @"isIdle": snapshot[@"isIdle"] ?: @NO
  };
}

- (NSArray<NSString *> *)changeReasonsFromPreviousSnapshot:(nullable NSDictionary *)previousSnapshot
                                               nextSnapshot:(NSDictionary *)nextSnapshot
{
  if (previousSnapshot == nil) {
    return @[@"initial"];
  }

  NSMutableArray<NSString *> *reasons = [NSMutableArray array];
  NSDictionary *previous = [self comparableSnapshotFromSnapshot:previousSnapshot];
  NSDictionary *next = [self comparableSnapshotFromSnapshot:nextSnapshot];

  if (![previous[@"appName"] isEqual:next[@"appName"]] ||
      ![previous[@"bundleIdentifier"] isEqual:next[@"bundleIdentifier"]] ||
      ![previous[@"processId"] isEqual:next[@"processId"]]) {
    [reasons addObject:@"app"];
  }

  if (![previous[@"windowTitle"] isEqual:next[@"windowTitle"]] ||
      ![previous[@"windowFrame"] isEqual:next[@"windowFrame"]] ||
      ![previous[@"source"] isEqual:next[@"source"]]) {
    [reasons addObject:@"window"];
  }

  if (![previous[@"isIdle"] isEqual:next[@"isIdle"]]) {
    [reasons addObject:@"idle"];
  }

  if (![previous[@"preciseModeEnabled"] isEqual:next[@"preciseModeEnabled"]] ||
      ![previous[@"accessibilityTrusted"] isEqual:next[@"accessibilityTrusted"]]) {
    [reasons addObject:@"precision"];
  }

  if (![previous[@"captureAccessGranted"] isEqual:next[@"captureAccessGranted"]]) {
    [reasons addObject:@"capture_permission"];
  }

  if (reasons.count == 0) {
    [reasons addObject:@"tick"];
  }

  return reasons;
}

- (NSDictionary *)currentContextSnapshot
{
  NSRunningApplication *frontmostApplication = NSWorkspace.sharedWorkspace.frontmostApplication;
  NSBundle *mainBundle = NSBundle.mainBundle;
  NSDictionary *seed = [self seedDictionaryForRunningApplication:frontmostApplication];
  BOOL accessibilityTrusted = AXIsProcessTrusted();
  BOOL captureAccessGranted = CGPreflightScreenCaptureAccess();
  CFTimeInterval idleSeconds = CGEventSourceSecondsSinceLastEventType(
      kCGEventSourceStateCombinedSessionState,
      kCGAnyInputEventType);

  return @{
    @"hostBundleIdentifier": [self nullableValue:mainBundle.bundleIdentifier],
    @"hostBundlePath": [self nullableValue:mainBundle.bundlePath],
    @"appName": seed[@"appName"] ?: NSNull.null,
    @"bundleIdentifier": seed[@"bundleIdentifier"] ?: NSNull.null,
    @"processId": seed[@"processId"] ?: NSNull.null,
    @"windowTitle": seed[@"windowTitle"] ?: NSNull.null,
    @"windowFrame": seed[@"windowFrame"] ?: NSNull.null,
    @"source": seed[@"source"] ?: @"app",
    @"preciseModeEnabled": @(self.preciseModeEnabled),
    @"accessibilityTrusted": @(accessibilityTrusted),
    @"captureAccessGranted": @(captureAccessGranted),
    @"isIdle": @(idleSeconds >= self.idleThresholdSeconds),
    @"idleSeconds": @(idleSeconds),
    @"changeReasons": @[],
    @"recordedAt": [self currentTimestamp]
  };
}

- (void)refreshContextIfNeeded
{
  NSDictionary *snapshot = [self currentContextSnapshot];
  NSArray<NSString *> *changeReasons = [self changeReasonsFromPreviousSnapshot:self.lastSnapshot
                                                                  nextSnapshot:snapshot];
  NSMutableDictionary *emittedSnapshot = [snapshot mutableCopy];
  emittedSnapshot[@"changeReasons"] = changeReasons;

  BOOL didChange = self.lastSnapshot == nil ||
      ![[self comparableSnapshotFromSnapshot:self.lastSnapshot]
          isEqual:[self comparableSnapshotFromSnapshot:emittedSnapshot]];

  if (!didChange) {
    return;
  }

  self.lastSnapshot = [emittedSnapshot copy];

  if (self.hasListeners) {
    [self sendEventWithName:@"contextSnapshotDidChange" body:emittedSnapshot];
  }
}

- (void)installWorkspaceObserverIfNeeded
{
  if (self.workspaceActivationObserver != nil) {
    return;
  }

  __weak ContextCaptureModule *weakSelf = self;
  self.workspaceActivationObserver =
      [NSWorkspace.sharedWorkspace.notificationCenter
          addObserverForName:NSWorkspaceDidActivateApplicationNotification
                      object:nil
                       queue:NSOperationQueue.mainQueue
                  usingBlock:^(__unused NSNotification *notification) {
                    [weakSelf refreshContextIfNeeded];
                  }];
}

- (void)removeWorkspaceObserver
{
  if (self.workspaceActivationObserver != nil) {
    [NSWorkspace.sharedWorkspace.notificationCenter removeObserver:self.workspaceActivationObserver];
    self.workspaceActivationObserver = nil;
  }
}

- (void)installPollTimerIfNeeded
{
  if (self.pollTimer != nil) {
    return;
  }

  self.pollTimer = [NSTimer scheduledTimerWithTimeInterval:1.0
                                                    target:self
                                                  selector:@selector(handlePollTimer:)
                                                  userInfo:nil
                                                   repeats:YES];
}

- (void)removePollTimer
{
  [self.pollTimer invalidate];
  self.pollTimer = nil;
}

- (void)handlePollTimer:(__unused NSTimer *)timer
{
  [self refreshContextIfNeeded];
}

RCT_REMAP_METHOD(startMonitoring,
                 startMonitoringWithOptions:(NSDictionary *)options
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(__unused RCTPromiseRejectBlock)reject)
{
  NSNumber *preciseModeEnabled = options[@"preciseModeEnabled"];
  NSNumber *idleThresholdSeconds = options[@"idleThresholdSeconds"];

  self.preciseModeEnabled = preciseModeEnabled != nil ? preciseModeEnabled.boolValue : NO;
  self.idleThresholdSeconds = idleThresholdSeconds != nil ? idleThresholdSeconds.doubleValue : 60.0;
  self.monitoring = YES;

  [self installWorkspaceObserverIfNeeded];
  [self installPollTimerIfNeeded];

  NSDictionary *snapshot = [self currentContextSnapshot];
  NSMutableDictionary *initialSnapshot = [snapshot mutableCopy];
  initialSnapshot[@"changeReasons"] = @[@"initial"];
  self.lastSnapshot = [initialSnapshot copy];

  resolve(initialSnapshot);
}

RCT_REMAP_METHOD(stopMonitoring,
                 stopMonitoringWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(__unused RCTPromiseRejectBlock)reject)
{
  self.monitoring = NO;
  [self removePollTimer];
  [self removeWorkspaceObserver];
  resolve(nil);
}

RCT_REMAP_METHOD(setPreciseModeEnabled,
                 setPreciseModeEnabledValue:(BOOL)enabled
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(__unused RCTPromiseRejectBlock)reject)
{
  self.preciseModeEnabled = enabled;
  NSDictionary *snapshot = [self currentContextSnapshot];
  NSMutableDictionary *updatedSnapshot = [snapshot mutableCopy];
  updatedSnapshot[@"changeReasons"] = [self changeReasonsFromPreviousSnapshot:self.lastSnapshot
                                                                  nextSnapshot:snapshot];
  self.lastSnapshot = [updatedSnapshot copy];
  resolve(updatedSnapshot);
}

RCT_REMAP_METHOD(requestAccessibilityPrompt,
                 requestAccessibilityPromptWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(__unused RCTPromiseRejectBlock)reject)
{
  NSDictionary *options = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt: @YES};
  AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
  resolve([self permissionsStatusDictionary]);
}

RCT_REMAP_METHOD(getPermissionsStatus,
                 getPermissionsStatusWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(__unused RCTPromiseRejectBlock)reject)
{
  resolve([self permissionsStatusDictionary]);
}

RCT_REMAP_METHOD(requestScreenCaptureAccess,
                 requestScreenCaptureAccessWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(__unused RCTPromiseRejectBlock)reject)
{
  CGRequestScreenCaptureAccess();
  resolve([self permissionsStatusDictionary]);
}

- (nullable NSDictionary *)rectDictionaryFromNullableValue:(id)value
{
  if (value == nil || value == NSNull.null || ![value isKindOfClass:[NSDictionary class]]) {
    return nil;
  }

  return (NSDictionary *)value;
}

- (CGRect)rectFromDictionary:(nullable NSDictionary *)dictionary
{
  if (dictionary == nil) {
    return CGRectNull;
  }

  return CGRectMake([dictionary[@"x"] doubleValue],
                    [dictionary[@"y"] doubleValue],
                    [dictionary[@"width"] doubleValue],
                    [dictionary[@"height"] doubleValue]);
}

- (nullable SCDisplay *)bestDisplayForContextFrame:(nullable NSDictionary *)windowFrame
                                          displays:(NSArray<SCDisplay *> *)displays
{
  if (displays.count == 0) {
    return nil;
  }

  CGRect targetFrame = [self rectFromDictionary:windowFrame];

  if (CGRectIsNull(targetFrame)) {
    CGDirectDisplayID mainDisplayID = CGMainDisplayID();

    for (SCDisplay *display in displays) {
      if (display.displayID == mainDisplayID) {
        return display;
      }
    }

    return displays.firstObject;
  }

  SCDisplay *bestDisplay = nil;
  CGFloat bestArea = 0;

  for (SCDisplay *display in displays) {
    CGRect intersection = CGRectIntersection(targetFrame, display.frame);
    CGFloat area = MAX(0, intersection.size.width) * MAX(0, intersection.size.height);

    if (bestDisplay == nil || area > bestArea) {
      bestDisplay = display;
      bestArea = area;
    }
  }

  return bestDisplay ?: displays.firstObject;
}

- (NSDictionary *)summaryForDisplay:(nullable SCDisplay *)display
{
  if (display == nil) {
    return @{
      @"displayId": NSNull.null,
      @"frame": NSNull.null
    };
  }

  return @{
    @"displayId": @(display.displayID),
    @"frame": [self dictionaryForRect:display.frame]
  };
}

- (NSInteger)scoreForWindow:(SCWindow *)window
                    context:(NSDictionary *)context
                 displayOut:(SCDisplay * __autoreleasing _Nullable *)displayOut
                   displays:(NSArray<SCDisplay *> *)displays
                    reasons:(NSMutableArray<NSString *> *)reasons
{
  NSInteger score = 0;
  NSNumber *contextProcessId = context[@"processId"];
  NSString *contextBundleIdentifier =
      [context[@"bundleIdentifier"] isKindOfClass:NSString.class] ? context[@"bundleIdentifier"] : nil;
  NSString *contextWindowTitle =
      [context[@"windowTitle"] isKindOfClass:NSString.class] ? context[@"windowTitle"] : nil;
  NSDictionary *contextWindowFrame = [self rectDictionaryFromNullableValue:context[@"windowFrame"]];

  if (window.owningApplication != nil) {
    if (contextProcessId != nil && contextProcessId != (id)NSNull.null &&
        window.owningApplication.processID == contextProcessId.intValue) {
      score += 60;
      [reasons addObject:@"pid_match"];
    }

    if (contextBundleIdentifier != nil &&
        [window.owningApplication.bundleIdentifier isEqualToString:contextBundleIdentifier]) {
      score += 24;
      [reasons addObject:@"bundle_match"];
    }
  }

  if (contextWindowTitle.length > 0 && window.title.length > 0) {
    NSString *normalizedContextTitle = [self normalizedString:contextWindowTitle];
    NSString *normalizedWindowTitle = [self normalizedString:window.title];

    if ([normalizedContextTitle isEqualToString:normalizedWindowTitle]) {
      score += 30;
      [reasons addObject:@"title_exact"];
    } else if ([normalizedWindowTitle containsString:normalizedContextTitle] ||
               [normalizedContextTitle containsString:normalizedWindowTitle]) {
      score += 18;
      [reasons addObject:@"title_partial"];
    }
  }

  if (contextWindowFrame != nil) {
    CGRect targetFrame = [self rectFromDictionary:contextWindowFrame];
    CGRect intersection = CGRectIntersection(targetFrame, window.frame);
    CGFloat intersectionArea = MAX(0, intersection.size.width) * MAX(0, intersection.size.height);
    CGFloat targetArea = MAX(1, targetFrame.size.width * targetFrame.size.height);
    CGFloat overlap = intersectionArea / targetArea;

    if (overlap > 0.85) {
      score += 15;
      [reasons addObject:@"frame_overlap_high"];
    } else if (overlap > 0.35) {
      score += 8;
      [reasons addObject:@"frame_overlap_partial"];
    }
  }

  if (window.isActive) {
    score += 10;
    [reasons addObject:@"active"];
  }

  if (window.isOnScreen) {
    score += 6;
    [reasons addObject:@"onscreen"];
  }

  if (window.windowLayer == 0) {
    score += 4;
    [reasons addObject:@"normal_layer"];
  }

  if (displayOut != NULL) {
    NSDictionary *windowFrame = [self dictionaryForRect:window.frame];
    *displayOut = [self bestDisplayForContextFrame:windowFrame displays:displays];
  }

  return score;
}

- (nullable SCRunningApplication *)matchingShareableApplicationForContext:(NSDictionary *)context
                                                             applications:(NSArray<SCRunningApplication *> *)applications
{
  NSNumber *contextProcessId = context[@"processId"];
  NSString *contextBundleIdentifier =
      [context[@"bundleIdentifier"] isKindOfClass:NSString.class] ? context[@"bundleIdentifier"] : nil;

  for (SCRunningApplication *application in applications) {
    if (contextProcessId != nil && contextProcessId != (id)NSNull.null &&
        application.processID == contextProcessId.intValue) {
      return application;
    }

    if (contextBundleIdentifier != nil &&
        [application.bundleIdentifier isEqualToString:contextBundleIdentifier]) {
      return application;
    }
  }

  return nil;
}

- (NSDictionary *)resolvedCaptureTargetForContent:(SCShareableContent *)shareableContent
                                          context:(NSDictionary *)context
                              captureAccessGranted:(BOOL)captureAccessGranted
{
  NSMutableArray<NSDictionary *> *rankedCandidates = [NSMutableArray array];

  for (SCWindow *window in shareableContent.windows) {
    NSMutableArray<NSString *> *reasons = [NSMutableArray array];
    SCDisplay *display = nil;
    NSInteger score = [self scoreForWindow:window
                                   context:context
                                displayOut:&display
                                  displays:shareableContent.displays
                                   reasons:reasons];

    if (score <= 0) {
      continue;
    }

    NSDictionary *displaySummary = [self summaryForDisplay:display];
    NSDictionary *candidateSummary = @{
      @"targetType": @"window",
      @"appName": [self nullableValue:window.owningApplication.applicationName],
      @"bundleIdentifier": [self nullableValue:window.owningApplication.bundleIdentifier],
      @"processId": window.owningApplication != nil ? @(window.owningApplication.processID) : NSNull.null,
      @"windowId": @(window.windowID),
      @"windowTitle": [self nullableValue:window.title],
      @"displayId": displaySummary[@"displayId"] ?: NSNull.null,
      @"frame": [self dictionaryForRect:window.frame],
      @"score": @(score),
      @"reasons": reasons,
      @"isOnScreen": @(window.isOnScreen),
      @"isActive": @(window.isActive)
    };

    [rankedCandidates addObject:@{
      @"score": @(score),
      @"window": window,
      @"display": [self nullableValue:display],
      @"summary": candidateSummary
    }];
  }

  [rankedCandidates sortUsingComparator:^NSComparisonResult(NSDictionary *left, NSDictionary *right) {
    return [right[@"score"] compare:left[@"score"]];
  }];

  NSArray<NSDictionary *> *candidateSummaries =
      [rankedCandidates valueForKey:@"summary"] ?: @[];

  SCWindow *chosenWindow = nil;
  SCDisplay *chosenDisplay = nil;
  NSString *chosenTargetType = @"none";
  double confidence = 0;
  NSString *fallbackReason = nil;
  NSDictionary *chosenTarget = nil;

  if (rankedCandidates.count > 0) {
    NSDictionary *topCandidate = rankedCandidates.firstObject;
    NSInteger topScore = [topCandidate[@"score"] integerValue];

    if (topScore >= 70) {
      chosenWindow = topCandidate[@"window"];
      id displayValue = topCandidate[@"display"];
      chosenDisplay = displayValue == NSNull.null ? nil : displayValue;
      chosenTargetType = @"window";
      confidence = MIN(1.0, ((double)topScore) / 120.0);
      chosenTarget = topCandidate[@"summary"];
    }
  }

  if (chosenWindow == nil) {
    SCRunningApplication *matchingApplication =
        [self matchingShareableApplicationForContext:context
                                         applications:shareableContent.applications];
    SCDisplay *display =
        [self bestDisplayForContextFrame:[self rectDictionaryFromNullableValue:context[@"windowFrame"]]
                                displays:shareableContent.displays];

    if (matchingApplication != nil && display != nil) {
      NSDictionary *displaySummary = [self summaryForDisplay:display];
      chosenDisplay = display;
      chosenTargetType = @"application";
      confidence = rankedCandidates.count > 0 ? 0.58 : 0.48;
      fallbackReason = rankedCandidates.count > 0
          ? @"Window matching was ambiguous, so the inspector fell back to app-level capture."
          : @"No trustworthy window match was found, so the inspector fell back to app-level capture.";
      chosenTarget = @{
        @"targetType": @"application",
        @"appName": [self nullableValue:matchingApplication.applicationName],
        @"bundleIdentifier": [self nullableValue:matchingApplication.bundleIdentifier],
        @"processId": @(matchingApplication.processID),
        @"windowId": NSNull.null,
        @"windowTitle": NSNull.null,
        @"displayId": displaySummary[@"displayId"] ?: NSNull.null,
        @"frame": displaySummary[@"frame"] ?: NSNull.null
      };
    } else if (candidateSummaries.count == 0) {
      fallbackReason = @"No ScreenCaptureKit window candidates matched the current context.";
    } else {
      fallbackReason = @"Window candidates were found, but none passed the confidence threshold.";
    }
  }

  NSDictionary *inspection = @{
    @"inspectedAt": [self currentTimestamp],
    @"context": context,
    @"captureAccessGranted": @(captureAccessGranted),
    @"chosenTargetType": chosenTargetType,
    @"confidence": @(confidence),
    @"fallbackReason": [self nullableValue:fallbackReason],
    @"chosenTarget": [self nullableValue:chosenTarget],
    @"candidates": candidateSummaries
  };

  return @{
    @"inspection": inspection,
    @"chosenTargetType": chosenTargetType,
    @"chosenWindow": [self nullableValue:chosenWindow],
    @"chosenDisplay": [self nullableValue:chosenDisplay]
  };
}

- (void)loadShareableContentWithCompletion:(void (^)(SCShareableContent * _Nullable content, NSError * _Nullable error))completion
{
  [SCShareableContent getShareableContentExcludingDesktopWindows:YES
                                             onScreenWindowsOnly:NO
                                               completionHandler:^(SCShareableContent * _Nullable content, NSError * _Nullable error) {
                                                 completion(content, error);
                                               }];
}

RCT_REMAP_METHOD(inspectCaptureTarget,
                 inspectCaptureTargetWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSDictionary *context = [self currentContextSnapshot];
  BOOL captureAccessGranted = CGPreflightScreenCaptureAccess();

  if (!captureAccessGranted) {
    NSDictionary *inspection = @{
      @"inspectedAt": [self currentTimestamp],
      @"context": context,
      @"captureAccessGranted": @NO,
      @"chosenTargetType": @"none",
      @"confidence": @0,
      @"fallbackReason": [self screenRecordingInactiveReason],
      @"chosenTarget": NSNull.null,
      @"candidates": @[]
    };

    resolve(inspection);
    return;
  }

  [self loadShareableContentWithCompletion:^(SCShareableContent * _Nullable content, NSError * _Nullable error) {
    if (error != nil || content == nil) {
      NSDictionary *inspection = @{
        @"inspectedAt": [self currentTimestamp],
        @"context": context,
        @"captureAccessGranted": @(captureAccessGranted),
        @"chosenTargetType": @"none",
        @"confidence": @0,
        @"fallbackReason": [self nullableValue:error.localizedDescription ?: @"Failed to enumerate ScreenCaptureKit content."],
        @"chosenTarget": NSNull.null,
        @"candidates": @[]
      };

      if (content == nil && error != nil) {
        reject(@"shareable_content_error", error.localizedDescription, error);
        return;
      }

      resolve(inspection);
      return;
    }

    NSDictionary *resolvedTarget =
        [self resolvedCaptureTargetForContent:content
                                      context:context
                          captureAccessGranted:captureAccessGranted];
    resolve(resolvedTarget[@"inspection"]);
  }];
}

- (nullable SCContentFilter *)contentFilterForResolvedTarget:(NSDictionary *)resolvedTarget
                                                  shareableContent:(SCShareableContent *)shareableContent
{
  NSString *chosenTargetType = resolvedTarget[@"chosenTargetType"];

  if ([chosenTargetType isEqualToString:@"window"]) {
    id chosenWindowValue = resolvedTarget[@"chosenWindow"];

    if (chosenWindowValue == nil || chosenWindowValue == NSNull.null) {
      return nil;
    }

    return [[SCContentFilter alloc] initWithDesktopIndependentWindow:(SCWindow *)chosenWindowValue];
  }

  if ([chosenTargetType isEqualToString:@"application"]) {
    NSDictionary *inspection = resolvedTarget[@"inspection"];
    NSDictionary *chosenTarget = inspection[@"chosenTarget"];
    NSNumber *targetProcessId = chosenTarget[@"processId"];
    NSNumber *targetDisplayId = chosenTarget[@"displayId"];
    SCRunningApplication *matchingApplication = nil;
    SCDisplay *matchingDisplay = nil;

    for (SCRunningApplication *application in shareableContent.applications) {
      if (targetProcessId != nil && targetProcessId != (id)NSNull.null &&
          application.processID == targetProcessId.intValue) {
        matchingApplication = application;
        break;
      }
    }

    for (SCDisplay *display in shareableContent.displays) {
      if (targetDisplayId != nil && targetDisplayId != (id)NSNull.null &&
          display.displayID == targetDisplayId.unsignedIntValue) {
        matchingDisplay = display;
        break;
      }
    }

    if (matchingApplication != nil && matchingDisplay != nil) {
      return [[SCContentFilter alloc] initWithDisplay:matchingDisplay
                                includingApplications:@[ matchingApplication ]
                                     exceptingWindows:@[]];
    }
  }

  return nil;
}

- (NSString *)sha256ForData:(NSData *)data
{
  if (data == nil) {
    return @"";
  }

  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(data.bytes, (CC_LONG)data.length, digest);

  NSMutableString *hexString =
      [NSMutableString stringWithCapacity:CC_SHA256_DIGEST_LENGTH * 2];

  for (NSUInteger index = 0; index < CC_SHA256_DIGEST_LENGTH; index += 1) {
    [hexString appendFormat:@"%02x", digest[index]];
  }

  return hexString;
}

- (nullable NSString *)dHashForImage:(CGImageRef)image
{
  if (image == nil) {
    return nil;
  }

  CGColorSpaceRef graySpace = CGColorSpaceCreateDeviceGray();
  size_t bytesPerRow = kDHashWidth;
  uint8_t pixels[kDHashWidth * kDHashHeight];

  CGContextRef context = CGBitmapContextCreate(
      pixels,
      kDHashWidth,
      kDHashHeight,
      8,
      bytesPerRow,
      graySpace,
      kCGImageAlphaNone);

  CGColorSpaceRelease(graySpace);

  if (context == nil) {
    return nil;
  }

  CGContextSetInterpolationQuality(context, kCGInterpolationMedium);
  CGContextDrawImage(context, CGRectMake(0, 0, kDHashWidth, kDHashHeight), image);
  CGContextRelease(context);

  uint64_t hash = 0;

  for (size_t row = 0; row < kDHashHeight; row += 1) {
    for (size_t col = 0; col < kDHashWidth - 1; col += 1) {
      uint8_t left = pixels[row * kDHashWidth + col];
      uint8_t right = pixels[row * kDHashWidth + col + 1];

      hash <<= 1;

      if (left > right) {
        hash |= 1;
      }
    }
  }

  return [NSString stringWithFormat:@"%016llx", (unsigned long long)hash];
}

- (nullable NSData *)jpegDataForImage:(CGImageRef)image maxBytes:(NSUInteger)maxBytes
{
  if (image == nil) {
    return nil;
  }

  NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithCGImage:image];
  CGFloat quality = kInitialJPEGQuality;

  while (quality >= kMinimumJPEGQuality) {
    NSData *data = [bitmap representationUsingType:NSBitmapImageFileTypeJPEG
                                        properties:@{NSImageCompressionFactor: @(quality)}];

    if (data.length <= maxBytes || quality <= kMinimumJPEGQuality) {
      return data;
    }

    quality -= kQualityStep;
  }

  return [bitmap representationUsingType:NSBitmapImageFileTypeJPEG
                              properties:@{NSImageCompressionFactor: @(kMinimumJPEGQuality)}];
}

- (nullable NSArray<NSDictionary *> *)recognizedTextItemsInImage:(CGImageRef)image
                                                           error:(NSError **)error
{
  if (image == nil) {
    return @[];
  }

  VNImageRequestHandler *handler =
      [[VNImageRequestHandler alloc] initWithCGImage:image options:@{}];
  const NSUInteger imageWidth = CGImageGetWidth(image);
  const NSUInteger imageHeight = CGImageGetHeight(image);
  __block NSError *requestError = nil;
  __block NSMutableArray<NSDictionary *> *items = [NSMutableArray array];
  VNRecognizeTextRequest *request =
      [[VNRecognizeTextRequest alloc] initWithCompletionHandler:^(VNRequest *req, NSError *completionError) {
        if (completionError != nil) {
          requestError = completionError;
          return;
        }

        for (VNRecognizedTextObservation *observation in req.results) {
          VNRecognizedText *topCandidate = [[observation topCandidates:1] firstObject];

          if (topCandidate == nil || topCandidate.string.length == 0) {
            continue;
          }

          CGRect boundingBox =
              VNImageRectForNormalizedRect(observation.boundingBox, imageWidth, imageHeight);
          [items addObject:@{
            @"text": topCandidate.string,
            @"boundingBox": [NSValue valueWithRect:NSRectFromCGRect(boundingBox)]
          }];
        }
      }];

  request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
  request.usesLanguageCorrection = YES;

  NSError *performError = nil;
  [handler performRequests:@[request] error:&performError];

  if (performError != nil) {
    if (error != nil) {
      *error = performError;
    }
    return nil;
  }

  if (requestError != nil) {
    if (error != nil) {
      *error = requestError;
    }
    return nil;
  }

  return items;
}

- (nullable NSString *)joinedOCRTextFromRecognizedItems:(NSArray<NSDictionary *> *)items
{
  NSMutableArray<NSString *> *lines = [NSMutableArray array];

  for (NSDictionary *item in items) {
    NSString *text = item[@"text"];

    if (text.length > 0) {
      [lines addObject:text];
    }
  }

  if (lines.count == 0) {
    return nil;
  }

  NSString *joined = [lines componentsJoinedByString:@"\n"];

  if (joined.length > kMaxOCRTextLength) {
    return [joined substringToIndex:kMaxOCRTextLength];
  }

  return joined;
}

- (NSArray<NSDictionary *> *)sensitiveTextMatchesFromRecognizedItems:(NSArray<NSDictionary *> *)items
{
  NSMutableArray<NSDictionary *> *matches = [NSMutableArray array];

  for (NSUInteger index = 0; index < items.count; index += 1) {
    NSDictionary *item = items[index];
    NSString *text = item[@"text"];
    NSString *previousText = index > 0 ? items[index - 1][@"text"] : nil;
    NSString *nextText = index + 1 < items.count ? items[index + 1][@"text"] : nil;
    NSString *matchType =
        [self privacyMatchTypeForText:text previousText:previousText nextText:nextText];

    if (matchType == nil) {
      continue;
    }

    [matches addObject:@{
      @"matchType": matchType,
      @"boundingBox": item[@"boundingBox"]
    }];
  }

  return matches;
}

- (nullable CGImageRef)newImageByRedactingMatches:(NSArray<NSDictionary *> *)matches
                                          inImage:(CGImageRef)image
{
  if (image == nil) {
    return nil;
  }

  const size_t width = CGImageGetWidth(image);
  const size_t height = CGImageGetHeight(image);
  CGColorSpaceRef colorSpace = CGColorSpaceCreateDeviceRGB();
  CGContextRef context = CGBitmapContextCreate(
      NULL,
      width,
      height,
      8,
      0,
      colorSpace,
      (CGBitmapInfo)kCGImageAlphaPremultipliedLast);
  CGColorSpaceRelease(colorSpace);

  if (context == nil) {
    return nil;
  }

  CGContextDrawImage(context, CGRectMake(0, 0, width, height), image);
  CGContextSetRGBFillColor(context, 0, 0, 0, 1);
  CGRect imageBounds = CGRectMake(0, 0, width, height);

  for (NSDictionary *match in matches) {
    NSValue *rectValue = match[@"boundingBox"];
    CGRect rect = NSRectToCGRect(rectValue.rectValue);
    CGRect paddedRect = CGRectInset(rect, -kPrivacyMaskPadding, -kPrivacyMaskPadding);
    CGRect clippedRect = CGRectIntersection(imageBounds, paddedRect);

    if (!CGRectIsNull(clippedRect) && !CGRectIsEmpty(clippedRect)) {
      CGContextFillRect(context, clippedRect);
    }
  }

  CGImageRef redactedImage = CGBitmapContextCreateImage(context);
  CGContextRelease(context);
  return redactedImage;
}

- (CapturePrivacyRedactionResult *)privacyRedactionResultForImage:(CGImageRef)image
{
  if (image == nil) {
    return [[CapturePrivacyRedactionResult alloc] initWithImage:nil
                                                        ocrText:nil
                                                        checked:NO
                                                        applied:NO
                                                     matchCount:0
                                                     matchTypes:@[]];
  }

  NSError *recognitionError = nil;
  NSArray<NSDictionary *> *recognizedItems =
      [self recognizedTextItemsInImage:image error:&recognitionError];

  if (recognizedItems == nil) {
    return [[CapturePrivacyRedactionResult alloc] initWithImage:image
                                                        ocrText:nil
                                                        checked:NO
                                                        applied:NO
                                                     matchCount:0
                                                     matchTypes:@[]];
  }

  NSArray<NSDictionary *> *matches =
      [self sensitiveTextMatchesFromRecognizedItems:recognizedItems];

  if (matches.count == 0) {
    return [[CapturePrivacyRedactionResult alloc]
        initWithImage:image
              ocrText:[self joinedOCRTextFromRecognizedItems:recognizedItems]
              checked:YES
              applied:NO
           matchCount:0
           matchTypes:@[]];
  }

  CGImageRef redactedImage = [self newImageByRedactingMatches:matches inImage:image];

  if (redactedImage == nil) {
    return [[CapturePrivacyRedactionResult alloc] initWithImage:image
                                                        ocrText:nil
                                                        checked:NO
                                                        applied:NO
                                                     matchCount:0
                                                     matchTypes:@[]];
  }

  NSMutableOrderedSet<NSString *> *matchTypes = [NSMutableOrderedSet orderedSet];

  for (NSDictionary *match in matches) {
    NSString *matchType = match[@"matchType"];

    if (matchType.length > 0) {
      [matchTypes addObject:matchType];
    }
  }

  CapturePrivacyRedactionResult *result =
      [[CapturePrivacyRedactionResult alloc] initWithImage:redactedImage
                                                   ocrText:[self recognizeTextInImage:redactedImage]
                                                   checked:YES
                                                   applied:YES
                                                matchCount:matches.count
                                                matchTypes:matchTypes.array];
  CGImageRelease(redactedImage);
  return result;
}

- (nullable NSString *)recognizeTextInImage:(CGImageRef)image
{
  NSError *error = nil;
  NSArray<NSDictionary *> *items = [self recognizedTextItemsInImage:image error:&error];

  if (items == nil || items.count == 0) {
    return nil;
  }

  return [self joinedOCRTextFromRecognizedItems:items];
}

- (NSDictionary *)errorCaptureResultWithInspection:(NSDictionary *)inspection
                                             status:(NSString *)status
                                       errorMessage:(nullable NSString *)errorMessage
{
  NSDictionary *chosenTarget =
      [inspection[@"chosenTarget"] isKindOfClass:NSDictionary.class] ? inspection[@"chosenTarget"] : @{};

  return @{
    @"inspection": inspection,
    @"metadata": @{
      @"capturedAt": [self currentTimestamp],
      @"status": status,
      @"targetType": inspection[@"chosenTargetType"] ?: @"none",
      @"appName": [self nullableValue:chosenTarget[@"appName"]],
      @"bundleIdentifier": [self nullableValue:chosenTarget[@"bundleIdentifier"]],
      @"processId": chosenTarget[@"processId"] ?: NSNull.null,
      @"windowId": chosenTarget[@"windowId"] ?: NSNull.null,
      @"windowTitle": [self nullableValue:chosenTarget[@"windowTitle"]],
      @"displayId": chosenTarget[@"displayId"] ?: NSNull.null,
      @"confidence": inspection[@"confidence"] ?: @0,
      @"width": NSNull.null,
      @"height": NSNull.null,
      @"frameHash": NSNull.null,
      @"perceptualHash": NSNull.null,
      @"errorMessage": [self nullableValue:errorMessage],
      @"previewByteLength": @0,
      @"privacyRedaction": @{
        @"checked": @NO,
        @"applied": @NO,
        @"version": kCapturePrivacyVersion,
        @"matchCount": @0,
        @"matchTypes": @[]
      }
    },
    @"previewBase64": NSNull.null,
    @"previewMimeType": NSNull.null,
    @"ocrText": NSNull.null
  };
}

RCT_REMAP_METHOD(captureNow,
                 captureNowWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSDictionary *context = [self currentContextSnapshot];
  BOOL captureAccessGranted = CGPreflightScreenCaptureAccess();

  if (!captureAccessGranted) {
    CGRequestScreenCaptureAccess();
    captureAccessGranted = CGPreflightScreenCaptureAccess();

    if (!captureAccessGranted) {
      NSDictionary *inspection = @{
        @"inspectedAt": [self currentTimestamp],
        @"context": context,
        @"captureAccessGranted": @NO,
        @"chosenTargetType": @"none",
        @"confidence": @0,
        @"fallbackReason": [self screenRecordingInactiveReason],
        @"chosenTarget": NSNull.null,
        @"candidates": @[]
      };

      resolve([self errorCaptureResultWithInspection:inspection
                                              status:@"permission_required"
                                        errorMessage:[self screenRecordingInactiveReason]]);
      return;
    }
  }

  [self loadShareableContentWithCompletion:^(SCShareableContent * _Nullable content, NSError * _Nullable shareableContentError) {
    if (shareableContentError != nil || content == nil) {
      NSDictionary *inspection = @{
        @"inspectedAt": [self currentTimestamp],
        @"context": context,
        @"captureAccessGranted": @(captureAccessGranted),
        @"chosenTargetType": @"none",
        @"confidence": @0,
        @"fallbackReason": [self nullableValue:shareableContentError.localizedDescription ?: @"Failed to enumerate ScreenCaptureKit content."],
        @"chosenTarget": NSNull.null,
        @"candidates": @[]
      };

      resolve([self errorCaptureResultWithInspection:inspection
                                              status:@"error"
                                        errorMessage:shareableContentError.localizedDescription]);
      return;
    }

    NSDictionary *resolvedTarget =
        [self resolvedCaptureTargetForContent:content
                                      context:context
                          captureAccessGranted:captureAccessGranted];
    NSDictionary *inspection = resolvedTarget[@"inspection"];
    SCContentFilter *contentFilter =
        [self contentFilterForResolvedTarget:resolvedTarget shareableContent:content];

    if (contentFilter == nil) {
      resolve([self errorCaptureResultWithInspection:inspection
                                              status:@"error"
                                        errorMessage:@"No trustworthy capture target could be resolved."]);
      return;
    }

    SCShareableContentInfo *contentInfo = [SCShareableContent infoForFilter:contentFilter];
    float pointPixelScale = MAX(contentInfo.pointPixelScale, 1.0);
    CGRect contentRect = contentInfo.contentRect;
    size_t width = MAX((size_t)1, (size_t)llround(contentRect.size.width * pointPixelScale));
    size_t height = MAX((size_t)1, (size_t)llround(contentRect.size.height * pointPixelScale));

    SCStreamConfiguration *configuration = [[SCStreamConfiguration alloc] init];
    configuration.width = width;
    configuration.height = height;

    [SCScreenshotManager captureImageWithFilter:contentFilter
                                   configuration:configuration
                               completionHandler:^(CGImageRef _Nullable image, NSError * _Nullable captureError) {
                                 if (captureError != nil || image == nil) {
                                   resolve([self errorCaptureResultWithInspection:inspection
                                                                           status:@"error"
                                                                     errorMessage:captureError.localizedDescription ?: @"Capture returned no image."]);
                                   return;
                                 }

                                 CGImageRetain(image);
                                 size_t imageWidth = CGImageGetWidth(image);
                                 size_t imageHeight = CGImageGetHeight(image);

                                 dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
                                   CapturePrivacyRedactionResult *privacyResult =
                                       [self privacyRedactionResultForImage:image];
                                   CGImageRef captureImage =
                                       privacyResult.image != nil ? privacyResult.image : image;
                                   NSData *jpegData =
                                       [self jpegDataForImage:captureImage maxBytes:kMaxPreviewBytes];
                                   NSString *ocrText = privacyResult.ocrText;
                                   NSString *perceptualHash = [self dHashForImage:captureImage];

                                   CGImageRelease(image);

                                   NSString *base64 = jpegData != nil ? [jpegData base64EncodedStringWithOptions:0] : nil;
                                   NSString *frameHash = jpegData != nil ? [self sha256ForData:jpegData] : nil;
                                   NSDictionary *chosenTarget =
                                       [inspection[@"chosenTarget"] isKindOfClass:NSDictionary.class] ? inspection[@"chosenTarget"] : @{};

                                   resolve(@{
                                     @"inspection": inspection,
                                     @"metadata": @{
                                       @"capturedAt": [self currentTimestamp],
                                       @"status": @"captured",
                                       @"targetType": inspection[@"chosenTargetType"] ?: @"none",
                                       @"appName": [self nullableValue:chosenTarget[@"appName"]],
                                       @"bundleIdentifier": [self nullableValue:chosenTarget[@"bundleIdentifier"]],
                                       @"processId": chosenTarget[@"processId"] ?: NSNull.null,
                                       @"windowId": chosenTarget[@"windowId"] ?: NSNull.null,
                                       @"windowTitle": [self nullableValue:chosenTarget[@"windowTitle"]],
                                       @"displayId": chosenTarget[@"displayId"] ?: NSNull.null,
                                       @"confidence": inspection[@"confidence"] ?: @0,
                                       @"width": @(imageWidth),
                                       @"height": @(imageHeight),
                                       @"frameHash": [self nullableValue:frameHash],
                                       @"perceptualHash": [self nullableValue:perceptualHash],
                                       @"errorMessage": NSNull.null,
                                       @"previewByteLength": @(jpegData.length),
                                       @"privacyRedaction": [privacyResult payload]
                                     },
                                     @"previewBase64": [self nullableValue:base64],
                                     @"previewMimeType": base64 != nil ? @"image/jpeg" : NSNull.null,
                                     @"ocrText": [self nullableValue:ocrText]
                                   });
                                 });
                               }];
  }];
}

@end
