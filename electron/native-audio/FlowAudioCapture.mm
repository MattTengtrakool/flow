#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <Speech/Speech.h>
#include <string.h>

static NSString *FlowTimestamp(void) {
  NSDateFormatter *formatter = [[NSDateFormatter alloc] init];
  formatter.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
  formatter.timeZone = [NSTimeZone timeZoneForSecondsFromGMT:0];
  formatter.dateFormat = @"yyyy-MM-dd'T'HH:mm:ss.SSS'Z'";
  return [formatter stringFromDate:[NSDate date]];
}

static void FlowWriteJSON(NSDictionary *payload) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:payload options:0 error:nil];
  if (data == nil) {
    fprintf(stdout, "{\"error\":\"Failed to encode JSON.\"}\n");
    fflush(stdout);
    return;
  }
  fwrite(data.bytes, 1, data.length, stdout);
  fprintf(stdout, "\n");
  fflush(stdout);
}

static NSDictionary *FlowError(NSString *message) {
  return @{@"error": message ?: @"Unknown audio helper error."};
}

static NSDictionary *FlowParseJSONArgument(const char *arg) {
  if (arg == NULL) return @{};
  NSData *data = [[NSString stringWithUTF8String:arg] dataUsingEncoding:NSUTF8StringEncoding];
  if (data == nil) return @{};
  id value = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  return [value isKindOfClass:NSDictionary.class] ? (NSDictionary *)value : @{};
}

static NSString *FlowPermissionState(AVAuthorizationStatus status) {
  switch (status) {
    case AVAuthorizationStatusAuthorized:
      return @"granted";
    case AVAuthorizationStatusDenied:
      return @"denied";
    case AVAuthorizationStatusNotDetermined:
      return @"not_determined";
    case AVAuthorizationStatusRestricted:
      return @"restricted";
  }
}

static NSDictionary *FlowPermissionPayload(void) {
  AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
  BOOL granted = status == AVAuthorizationStatusAuthorized;
  BOOL systemAudioAvailable = NO;
  if (@available(macOS 13.0, *)) {
    systemAudioAvailable = CGPreflightScreenCaptureAccess();
  }
  return @{
    @"microphone": FlowPermissionState(status),
    @"microphoneAccessGranted": @(granted),
    @"microphoneGranted": @(granted),
    @"systemAudioCaptureAvailable": @(systemAudioAvailable),
    @"screenCaptureGranted": @(systemAudioAvailable),
    @"checkedAt": FlowTimestamp(),
  };
}

@interface FlowAudioRecorder : NSObject
@property (nonatomic, strong) AVAudioRecorder *recorder;
@property (nonatomic, copy) NSString *outputPath;
@property (nonatomic, strong) NSDate *startedAt;
@property (nonatomic, assign) NSTimeInterval pausedDuration;
@property (nonatomic, strong, nullable) NSDate *pauseStartedAt;
- (instancetype)initWithOutputPath:(NSString *)outputPath;
- (BOOL)startWithError:(NSError **)error;
- (void)pause;
- (void)resume;
- (NSDictionary *)stop;
@end

@implementation FlowAudioRecorder

- (instancetype)initWithOutputPath:(NSString *)outputPath {
  self = [super init];
  if (self != nil) {
    _outputPath = [outputPath copy];
    _pausedDuration = 0;
  }
  return self;
}

- (BOOL)startWithError:(NSError **)error {
  NSString *directory = [self.outputPath stringByDeletingLastPathComponent];
  [[NSFileManager defaultManager] createDirectoryAtPath:directory
                            withIntermediateDirectories:YES
                                             attributes:nil
                                                  error:error];
  if (error != nil && *error != nil) return NO;

  NSDictionary *settings = @{
    AVFormatIDKey: @(kAudioFormatMPEG4AAC),
    AVSampleRateKey: @44100,
    AVNumberOfChannelsKey: @1,
    AVEncoderAudioQualityKey: @(AVAudioQualityHigh),
  };
  NSURL *url = [NSURL fileURLWithPath:self.outputPath];
  self.recorder = [[AVAudioRecorder alloc] initWithURL:url settings:settings error:error];
  if (self.recorder == nil) return NO;
  self.recorder.meteringEnabled = NO;
  self.startedAt = [NSDate date];
  return [self.recorder record];
}

- (void)pause {
  if (self.recorder.isRecording) {
    [self.recorder pause];
    self.pauseStartedAt = [NSDate date];
  }
}

- (void)resume {
  if (self.pauseStartedAt != nil) {
    self.pausedDuration += [[NSDate date] timeIntervalSinceDate:self.pauseStartedAt];
    self.pauseStartedAt = nil;
  }
  [self.recorder record];
}

- (NSDictionary *)stop {
  if (self.pauseStartedAt != nil) {
    self.pausedDuration += [[NSDate date] timeIntervalSinceDate:self.pauseStartedAt];
    self.pauseStartedAt = nil;
  }
  [self.recorder stop];
  NSDate *stoppedAt = [NSDate date];
  NSTimeInterval duration = [stoppedAt timeIntervalSinceDate:self.startedAt] - self.pausedDuration;
  NSDictionary *attributes =
      [[NSFileManager defaultManager] attributesOfItemAtPath:self.outputPath error:nil] ?: @{};
  NSNumber *fileSize = attributes[NSFileSize] ?: @0;
  return @{
    @"status": @"stopped",
    @"stoppedAt": FlowTimestamp(),
    @"outputPath": self.outputPath,
    @"durationMs": @((NSInteger)llround(MAX(duration, 0) * 1000.0)),
    @"byteLength": fileSize,
  };
}

@end

@interface FlowStreamAudioRecorder : NSObject <SCStreamOutput>
@property (nonatomic, copy) NSString *outputPath;
@property (nonatomic, assign) BOOL includeSystemAudio;
@property (nonatomic, assign) BOOL includeMicrophone;
@property (nonatomic, strong, nullable) SCStream *stream API_AVAILABLE(macos(12.3));
@property (nonatomic, strong) AVAssetWriter *writer;
@property (nonatomic, strong) AVAssetWriterInput *systemInput;
@property (nonatomic, strong) AVAssetWriterInput *microphoneInput;
@property (nonatomic, assign) BOOL writerStarted;
@property (nonatomic, assign) CMTime startTime;
@property (nonatomic, strong) NSDate *startedAt;
@property (nonatomic, assign) NSTimeInterval pausedDuration;
@property (nonatomic, strong, nullable) NSDate *pauseStartedAt;
@property (nonatomic, strong) dispatch_queue_t sampleQueue;
- (instancetype)initWithOutputPath:(NSString *)outputPath
                includeSystemAudio:(BOOL)includeSystemAudio
                 includeMicrophone:(BOOL)includeMicrophone;
- (BOOL)startWithError:(NSError **)error;
- (void)pause;
- (void)resume;
- (NSDictionary *)stop;
@end

@implementation FlowStreamAudioRecorder

- (instancetype)initWithOutputPath:(NSString *)outputPath
                includeSystemAudio:(BOOL)includeSystemAudio
                 includeMicrophone:(BOOL)includeMicrophone {
  self = [super init];
  if (self != nil) {
    _outputPath = [outputPath copy];
    _includeSystemAudio = includeSystemAudio;
    _includeMicrophone = includeMicrophone;
    _writerStarted = NO;
    _startTime = kCMTimeInvalid;
    _pausedDuration = 0;
    _sampleQueue = dispatch_queue_create("com.flow.audio.sample-writer", DISPATCH_QUEUE_SERIAL);
  }
  return self;
}

- (BOOL)startWithError:(NSError **)error {
  if (@available(macOS 13.0, *)) {
    if (!CGPreflightScreenCaptureAccess()) {
      CGRequestScreenCaptureAccess();
      if (!CGPreflightScreenCaptureAccess()) {
        if (error != nil) {
          *error = [NSError errorWithDomain:@"FlowAudioCapture"
                                       code:1
                                   userInfo:@{NSLocalizedDescriptionKey:
                                                @"Screen Recording permission is required to capture meeting output audio."}];
        }
        return NO;
      }
    }

    NSString *directory = [self.outputPath stringByDeletingLastPathComponent];
    [[NSFileManager defaultManager] createDirectoryAtPath:directory
                              withIntermediateDirectories:YES
                                               attributes:nil
                                                    error:error];
    if (error != nil && *error != nil) return NO;
    [[NSFileManager defaultManager] removeItemAtPath:self.outputPath error:nil];

    NSURL *url = [NSURL fileURLWithPath:self.outputPath];
    self.writer = [[AVAssetWriter alloc] initWithURL:url
                                            fileType:AVFileTypeAppleM4A
                                               error:error];
    if (self.writer == nil) return NO;

    NSDictionary *systemSettings = @{
      AVFormatIDKey: @(kAudioFormatMPEG4AAC),
      AVSampleRateKey: @48000,
      AVNumberOfChannelsKey: @2,
      AVEncoderAudioQualityKey: @(AVAudioQualityHigh),
    };
    NSDictionary *microphoneSettings = @{
      AVFormatIDKey: @(kAudioFormatMPEG4AAC),
      AVSampleRateKey: @44100,
      AVNumberOfChannelsKey: @1,
      AVEncoderAudioQualityKey: @(AVAudioQualityHigh),
    };
    if (self.includeSystemAudio) {
      self.systemInput = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeAudio
                                                            outputSettings:systemSettings];
      self.systemInput.expectsMediaDataInRealTime = YES;
      if ([self.writer canAddInput:self.systemInput]) {
        [self.writer addInput:self.systemInput];
      }
    }
    if (self.includeMicrophone) {
      if (@available(macOS 15.0, *)) {
      } else {
        if (error != nil) {
          *error = [NSError errorWithDomain:@"FlowAudioCapture"
                                       code:5
                                   userInfo:@{NSLocalizedDescriptionKey:
                                                @"Combined system and microphone capture requires macOS 15 or newer. Start system and microphone captures separately on this macOS version."}];
        }
        return NO;
      }
      self.microphoneInput = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeAudio
                                                                outputSettings:microphoneSettings];
      self.microphoneInput.expectsMediaDataInRealTime = YES;
      if ([self.writer canAddInput:self.microphoneInput]) {
        [self.writer addInput:self.microphoneInput];
      }
    }
    if (self.writer.inputs.count == 0) {
      if (error != nil) {
        *error = [NSError errorWithDomain:@"FlowAudioCapture"
                                     code:2
                                 userInfo:@{NSLocalizedDescriptionKey:
                                              @"No audio inputs could be configured for recording."}];
      }
      return NO;
    }

    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    __block SCShareableContent *content = nil;
    __block NSError *contentError = nil;
    [SCShareableContent getShareableContentExcludingDesktopWindows:YES
                                               onScreenWindowsOnly:NO
                                                 completionHandler:^(SCShareableContent * _Nullable shareableContent,
                                                                     NSError * _Nullable completionError) {
                                                   content = shareableContent;
                                                   contentError = completionError;
                                                   dispatch_semaphore_signal(semaphore);
                                                 }];
    dispatch_semaphore_wait(semaphore, DISPATCH_TIME_FOREVER);
    if (contentError != nil || content.displays.count == 0) {
      if (error != nil) {
        *error = contentError ?: [NSError errorWithDomain:@"FlowAudioCapture"
                                                     code:3
                                                 userInfo:@{NSLocalizedDescriptionKey:
                                                              @"No display was available for ScreenCaptureKit audio."}];
      }
      return NO;
    }

    SCDisplay *display = content.displays.firstObject;
    SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:display
                                                 excludingApplications:@[]
                                                      exceptingWindows:@[]];
    SCStreamConfiguration *configuration = [[SCStreamConfiguration alloc] init];
    configuration.width = 2;
    configuration.height = 2;
    configuration.minimumFrameInterval = CMTimeMake(1, 1);
    configuration.capturesAudio = self.includeSystemAudio;
    configuration.sampleRate = 48000;
    configuration.channelCount = 2;
    configuration.excludesCurrentProcessAudio = YES;
    if (self.includeMicrophone) {
      if (@available(macOS 15.0, *)) {
        configuration.captureMicrophone = YES;
      }
    }

    self.stream = [[SCStream alloc] initWithFilter:filter
                                     configuration:configuration
                                          delegate:nil];
    if (self.includeSystemAudio) {
      if (![self.stream addStreamOutput:self
                                   type:SCStreamOutputTypeAudio
                     sampleHandlerQueue:self.sampleQueue
                                  error:error]) {
        return NO;
      }
    }
    if (self.includeMicrophone) {
      if (@available(macOS 15.0, *)) {
        if (![self.stream addStreamOutput:self
                                     type:SCStreamOutputTypeMicrophone
                       sampleHandlerQueue:self.sampleQueue
                                    error:error]) {
          return NO;
        }
      }
    }

    dispatch_semaphore_t startSemaphore = dispatch_semaphore_create(0);
    __block NSError *startError = nil;
    [self.stream startCaptureWithCompletionHandler:^(NSError * _Nullable completionError) {
      startError = completionError;
      dispatch_semaphore_signal(startSemaphore);
    }];
    dispatch_semaphore_wait(startSemaphore, DISPATCH_TIME_FOREVER);
    if (startError != nil) {
      if (error != nil) *error = startError;
      return NO;
    }
    self.startedAt = [NSDate date];
    return YES;
  }

  if (error != nil) {
    *error = [NSError errorWithDomain:@"FlowAudioCapture"
                                 code:4
                             userInfo:@{NSLocalizedDescriptionKey:
                                          @"System audio capture requires macOS 13 or newer."}];
  }
  return NO;
}

- (void)pause {
  self.pauseStartedAt = [NSDate date];
}

- (void)resume {
  if (self.pauseStartedAt != nil) {
    self.pausedDuration += [[NSDate date] timeIntervalSinceDate:self.pauseStartedAt];
    self.pauseStartedAt = nil;
  }
}

- (void)stream:(SCStream *)stream
didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer
        ofType:(SCStreamOutputType)type API_AVAILABLE(macos(12.3)) {
  if (self.pauseStartedAt != nil || !CMSampleBufferIsValid(sampleBuffer)) {
    return;
  }
  AVAssetWriterInput *input = nil;
  if (@available(macOS 13.0, *)) {
    if (type == SCStreamOutputTypeAudio) {
      input = self.systemInput;
    } else if (@available(macOS 15.0, *)) {
      if (type == SCStreamOutputTypeMicrophone) {
        input = self.microphoneInput;
      }
    }
  }
  if (input == nil || !input.readyForMoreMediaData) {
    return;
  }

  CMTime presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer);
  if (!self.writerStarted) {
    self.writerStarted = YES;
    self.startTime = presentationTime;
    [self.writer startWriting];
    [self.writer startSessionAtSourceTime:presentationTime];
  }
  [input appendSampleBuffer:sampleBuffer];
}

- (NSDictionary *)stop {
  if (@available(macOS 13.0, *)) {
    if (self.pauseStartedAt != nil) {
      self.pausedDuration += [[NSDate date] timeIntervalSinceDate:self.pauseStartedAt];
      self.pauseStartedAt = nil;
    }

    dispatch_semaphore_t stopSemaphore = dispatch_semaphore_create(0);
    [self.stream stopCaptureWithCompletionHandler:^(__unused NSError * _Nullable error) {
      dispatch_semaphore_signal(stopSemaphore);
    }];
    dispatch_semaphore_wait(stopSemaphore, DISPATCH_TIME_FOREVER);

    if (!self.writerStarted) {
      [self.writer cancelWriting];
      NSDate *stoppedAt = [NSDate date];
      NSTimeInterval duration = [stoppedAt timeIntervalSinceDate:self.startedAt] - self.pausedDuration;
      return @{
        @"status": @"stopped",
        @"stoppedAt": FlowTimestamp(),
        @"outputPath": self.outputPath,
        @"durationMs": @((NSInteger)llround(MAX(duration, 0) * 1000.0)),
        @"byteLength": @0,
      };
    }

    for (AVAssetWriterInput *input in self.writer.inputs) {
      [input markAsFinished];
    }

    dispatch_semaphore_t finishSemaphore = dispatch_semaphore_create(0);
    [self.writer finishWritingWithCompletionHandler:^{
      dispatch_semaphore_signal(finishSemaphore);
    }];
    dispatch_semaphore_wait(finishSemaphore, DISPATCH_TIME_FOREVER);

    NSDate *stoppedAt = [NSDate date];
    NSTimeInterval duration = [stoppedAt timeIntervalSinceDate:self.startedAt] - self.pausedDuration;
    NSDictionary *attributes =
        [[NSFileManager defaultManager] attributesOfItemAtPath:self.outputPath error:nil] ?: @{};
    NSNumber *fileSize = attributes[NSFileSize] ?: @0;
    return @{
      @"status": @"stopped",
      @"stoppedAt": FlowTimestamp(),
      @"outputPath": self.outputPath,
      @"durationMs": @((NSInteger)llround(MAX(duration, 0) * 1000.0)),
      @"byteLength": fileSize,
    };
  }
  return FlowError(@"System audio capture requires macOS 13 or newer.");
}

@end

static void FlowRequestPermissions(NSDictionary *options) {
  BOOL requestMicrophone =
      options[@"microphone"] == nil || [options[@"microphone"] boolValue];
  BOOL requestSystem = [options[@"system"] boolValue];

  if (requestMicrophone) {
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio
                             completionHandler:^(__unused BOOL granted) {
                               dispatch_semaphore_signal(semaphore);
                             }];
    dispatch_semaphore_wait(semaphore, DISPATCH_TIME_FOREVER);
  }
  if (requestSystem) {
    if (@available(macOS 13.0, *)) {
      CGRequestScreenCaptureAccess();
    }
  }
  FlowWriteJSON(FlowPermissionPayload());
}

static void FlowTranscribe(NSDictionary *options) {
  NSString *filePath = [options[@"filePath"] isKindOfClass:NSString.class]
                           ? options[@"filePath"]
                           : nil;
  if (filePath.length == 0) {
    FlowWriteJSON(FlowError(@"Missing audio file path for transcription."));
    return;
  }
  if (![[NSFileManager defaultManager] fileExistsAtPath:filePath]) {
    FlowWriteJSON(FlowError(@"Audio file does not exist for transcription."));
    return;
  }

  SFSpeechRecognizerAuthorizationStatus auth = [SFSpeechRecognizer authorizationStatus];
  if (auth == SFSpeechRecognizerAuthorizationStatusNotDetermined) {
    dispatch_semaphore_t authSemaphore = dispatch_semaphore_create(0);
    [SFSpeechRecognizer requestAuthorization:^(__unused SFSpeechRecognizerAuthorizationStatus status) {
      dispatch_semaphore_signal(authSemaphore);
    }];
    dispatch_semaphore_wait(authSemaphore, DISPATCH_TIME_FOREVER);
    auth = [SFSpeechRecognizer authorizationStatus];
  }
  if (auth != SFSpeechRecognizerAuthorizationStatusAuthorized) {
    FlowWriteJSON(FlowError(@"Speech recognition permission is required to transcribe meeting audio."));
    return;
  }

  NSDate *startedAt = [NSDate date];
  SFSpeechRecognizer *recognizer =
      [[SFSpeechRecognizer alloc] initWithLocale:[NSLocale currentLocale]];
  if (recognizer == nil || !recognizer.available) {
    FlowWriteJSON(FlowError(@"Speech recognizer is not available."));
    return;
  }

  NSURL *url = [NSURL fileURLWithPath:filePath];
  SFSpeechURLRecognitionRequest *request =
      [[SFSpeechURLRecognitionRequest alloc] initWithURL:url];
  request.shouldReportPartialResults = NO;

  dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
  __block SFSpeechRecognitionResult *finalResult = nil;
  __block NSError *finalError = nil;
  __block SFSpeechRecognitionTask *task = nil;
  task = [recognizer recognitionTaskWithRequest:request
                                  resultHandler:^(SFSpeechRecognitionResult * _Nullable result,
                                                  NSError * _Nullable error) {
                                    if (result != nil && result.isFinal) {
                                      finalResult = result;
                                      dispatch_semaphore_signal(semaphore);
                                    } else if (error != nil) {
                                      finalError = error;
                                      dispatch_semaphore_signal(semaphore);
                                    }
                                  }];

  dispatch_time_t timeout =
      dispatch_time(DISPATCH_TIME_NOW, (int64_t)(120 * NSEC_PER_SEC));
  if (dispatch_semaphore_wait(semaphore, timeout) != 0) {
    [task cancel];
    FlowWriteJSON(FlowError(@"Speech transcription timed out."));
    return;
  }
  if (finalError != nil) {
    FlowWriteJSON(FlowError(finalError.localizedDescription ?: @"Speech transcription failed."));
    return;
  }
  if (finalResult == nil) {
    FlowWriteJSON(FlowError(@"Speech transcription produced no result."));
    return;
  }

  NSMutableArray *segments = [NSMutableArray array];
  for (SFTranscriptionSegment *segment in finalResult.bestTranscription.segments) {
    [segments addObject:@{
      @"startMs": @((NSInteger)llround(segment.timestamp * 1000.0)),
      @"endMs": @((NSInteger)llround((segment.timestamp + segment.duration) * 1000.0)),
      @"speaker": NSNull.null,
      @"text": segment.substring ?: @"",
    }];
  }
  NSTimeInterval duration = [[NSDate date] timeIntervalSinceDate:startedAt];
  FlowWriteJSON(@{
    @"transcript": finalResult.bestTranscription.formattedString ?: @"",
    @"generatedAt": FlowTimestamp(),
    @"durationMs": @((NSInteger)llround(duration * 1000.0)),
    @"segments": segments,
  });
}

static void FlowRunRecording(NSDictionary *options) {
  NSString *outputPath = [options[@"outputPath"] isKindOfClass:NSString.class]
                             ? options[@"outputPath"]
                             : nil;
  NSString *source = [options[@"source"] isKindOfClass:NSString.class]
                        ? options[@"source"]
                        : @"microphone";
  if (outputPath.length == 0) {
    FlowWriteJSON(FlowError(@"Missing audio output path."));
    return;
  }
  BOOL wantsMicrophone = [source isEqualToString:@"microphone"] || [source isEqualToString:@"combined"];
  BOOL wantsSystem = [source isEqualToString:@"system"] || [source isEqualToString:@"combined"];
  if (!wantsMicrophone && !wantsSystem) {
    FlowWriteJSON(FlowError(@"Unknown audio recording source."));
    return;
  }

  if (wantsSystem) {
    NSError *streamError = nil;
    FlowStreamAudioRecorder *streamRecorder =
        [[FlowStreamAudioRecorder alloc] initWithOutputPath:outputPath
                                         includeSystemAudio:YES
                                          includeMicrophone:wantsMicrophone];
    if (![streamRecorder startWithError:&streamError]) {
      FlowWriteJSON(FlowError(streamError.localizedDescription ?: @"Failed to start meeting audio recording."));
      return;
    }

    FlowWriteJSON(@{
      @"status": @"recording",
      @"startedAt": FlowTimestamp(),
      @"outputPath": outputPath,
    });

    char systemBuffer[128];
    while (fgets(systemBuffer, sizeof(systemBuffer), stdin) != NULL) {
      NSString *command = [[[NSString stringWithUTF8String:systemBuffer]
          stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet] lowercaseString];
      if ([command isEqualToString:@"pause"]) {
        [streamRecorder pause];
        FlowWriteJSON(@{@"status": @"paused", @"pausedAt": FlowTimestamp()});
      } else if ([command isEqualToString:@"resume"]) {
        [streamRecorder resume];
        FlowWriteJSON(@{@"status": @"recording", @"resumedAt": FlowTimestamp()});
      } else if ([command isEqualToString:@"stop"]) {
        FlowWriteJSON([streamRecorder stop]);
        return;
      }
    }

    FlowWriteJSON([streamRecorder stop]);
    return;
  }

  AVAuthorizationStatus auth = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
  if (auth == AVAuthorizationStatusNotDetermined) {
    FlowRequestPermissions(@{@"microphone": @YES});
    auth = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
  }
  if (auth != AVAuthorizationStatusAuthorized) {
    FlowWriteJSON(FlowError(@"Microphone permission is required to record meeting audio."));
    return;
  }

  NSError *error = nil;
  FlowAudioRecorder *recorder = [[FlowAudioRecorder alloc] initWithOutputPath:outputPath];
  if (![recorder startWithError:&error]) {
    FlowWriteJSON(FlowError(error.localizedDescription ?: @"Failed to start audio recording."));
    return;
  }

  FlowWriteJSON(@{
    @"status": @"recording",
    @"startedAt": FlowTimestamp(),
    @"outputPath": outputPath,
  });

  char buffer[128];
  while (fgets(buffer, sizeof(buffer), stdin) != NULL) {
    NSString *command = [[[NSString stringWithUTF8String:buffer]
        stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet] lowercaseString];
    if ([command isEqualToString:@"pause"]) {
      [recorder pause];
      FlowWriteJSON(@{@"status": @"paused", @"pausedAt": FlowTimestamp()});
    } else if ([command isEqualToString:@"resume"]) {
      [recorder resume];
      FlowWriteJSON(@{@"status": @"recording", @"resumedAt": FlowTimestamp()});
    } else if ([command isEqualToString:@"stop"]) {
      FlowWriteJSON([recorder stop]);
      return;
    }
  }

  FlowWriteJSON([recorder stop]);
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc < 2) {
      FlowWriteJSON(FlowError(@"Missing audio helper command."));
      return 1;
    }
    NSString *command = [NSString stringWithUTF8String:argv[1]];
    if ([command isEqualToString:@"getPermissionsStatus"]) {
      FlowWriteJSON(FlowPermissionPayload());
      return 0;
    }
    if ([command isEqualToString:@"requestPermissions"]) {
      FlowRequestPermissions(argc >= 3 ? FlowParseJSONArgument(argv[2]) : @{});
      return 0;
    }
    if ([command isEqualToString:@"record"]) {
      FlowRunRecording(argc >= 3 ? FlowParseJSONArgument(argv[2]) : @{});
      return 0;
    }
    if ([command isEqualToString:@"transcribe"]) {
      FlowTranscribe(argc >= 3 ? FlowParseJSONArgument(argv[2]) : @{});
      return 0;
    }
    FlowWriteJSON(FlowError(@"Unknown audio helper command."));
    return 1;
  }
}
