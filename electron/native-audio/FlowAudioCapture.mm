#import <AVFoundation/AVFoundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#include <string.h>

static NSString *JsonEscape(NSString *value) {
  NSMutableString *escaped = [value mutableCopy];
  [escaped replaceOccurrencesOfString:@"\\"
                           withString:@"\\\\"
                              options:0
                                range:NSMakeRange(0, escaped.length)];
  [escaped replaceOccurrencesOfString:@"\""
                           withString:@"\\\""
                              options:0
                                range:NSMakeRange(0, escaped.length)];
  [escaped replaceOccurrencesOfString:@"\n"
                           withString:@"\\n"
                              options:0
                                range:NSMakeRange(0, escaped.length)];
  return escaped;
}

static void PrintLine(NSString *json) {
  fprintf(stdout, "%s\n", [json UTF8String]);
  fflush(stdout);
}

static NSString *NowIso8601() {
  NSISO8601DateFormatter *formatter = [[NSISO8601DateFormatter alloc] init];
  formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime |
                            NSISO8601DateFormatWithFractionalSeconds;
  return [formatter stringFromDate:[NSDate date]];
}

static BOOL HasArg(int argc, const char *argv[], const char *name) {
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], name) == 0) return YES;
  }
  return NO;
}

static NSString *ValueForArg(int argc,
                             const char *argv[],
                             const char *name,
                             NSString *fallback) {
  for (int i = 1; i < argc - 1; i++) {
    if (strcmp(argv[i], name) == 0) {
      return [NSString stringWithUTF8String:argv[i + 1]];
    }
  }
  return fallback;
}

static void PrintPermissionsStatus() {
  AVAuthorizationStatus micStatus =
      [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
  BOOL microphoneGranted = micStatus == AVAuthorizationStatusAuthorized;
  BOOL screenCaptureGranted = CGPreflightScreenCaptureAccess();
  PrintLine([NSString
      stringWithFormat:
          @"{\"type\":\"audio_permissions_status\",\"helperAvailable\":true,"
           "\"screenCaptureGranted\":%@,\"microphoneGranted\":%@}",
          screenCaptureGranted ? @"true" : @"false",
          microphoneGranted ? @"true" : @"false"]);
}

static void PrintStarted(int argc, const char *argv[]) {
  NSString *meetingId =
      ValueForArg(argc, argv, "--meeting-id", @"meeting_unknown");
  // Future streaming builds emit audio_chunk_ready lines every 15 seconds.
  PrintLine([NSString
      stringWithFormat:
          @"{\"type\":\"audio_capture_started\",\"meetingId\":\"%@\","
           "\"startedAt\":\"%@\"}",
          JsonEscape(meetingId), NowIso8601()]);
  PrintLine([NSString
      stringWithFormat:
          @"{\"type\":\"audio_capture_failed\",\"meetingId\":\"%@\","
           "\"message\":\"Native meeting audio capture is scaffolded but real "
           "audio streaming is not enabled in this build yet.\"}",
          JsonEscape(meetingId)]);
}

static void PrintStopped(int argc, const char *argv[]) {
  NSString *meetingId =
      ValueForArg(argc, argv, "--meeting-id", @"meeting_unknown");
  PrintLine([NSString
      stringWithFormat:
          @"{\"type\":\"audio_capture_stopped\",\"meetingId\":\"%@\","
           "\"stoppedAt\":\"%@\"}",
          JsonEscape(meetingId), NowIso8601()]);
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (HasArg(argc, argv, "getPermissionsStatus")) {
      PrintPermissionsStatus();
      return 0;
    }
    if (HasArg(argc, argv, "start")) {
      PrintStarted(argc, argv);
      return 0;
    }
    if (HasArg(argc, argv, "stop")) {
      PrintStopped(argc, argv);
      return 0;
    }
    PrintLine(@"{\"type\":\"audio_capture_failed\",\"message\":\"Unknown "
              @"FlowAudioCapture command.\"}");
    return 1;
  }
}
