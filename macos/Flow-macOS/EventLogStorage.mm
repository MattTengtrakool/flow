#import "EventLogStorage.h"

@implementation EventLogStorage

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (NSString *)eventLogDirectoryPath
{
  NSArray<NSURL *> *appSupportDirectories = [[NSFileManager defaultManager]
      URLsForDirectory:NSApplicationSupportDirectory
             inDomains:NSUserDomainMask];
  NSURL *appSupportDirectory = appSupportDirectories.firstObject;
  NSURL *directoryURL = [appSupportDirectory URLByAppendingPathComponent:@"Flow" isDirectory:YES];

  return directoryURL.path;
}

- (NSString *)eventLogFilePath
{
  return [[self eventLogDirectoryPath] stringByAppendingPathComponent:@"event-log.json"];
}

- (BOOL)ensureEventLogDirectoryExists:(NSError **)error
{
  return [[NSFileManager defaultManager] createDirectoryAtPath:[self eventLogDirectoryPath]
                                   withIntermediateDirectories:YES
                                                    attributes:nil
                                                         error:error];
}

RCT_REMAP_METHOD(loadEventLog,
                 loadEventLogWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSError *directoryError = nil;

  if (![self ensureEventLogDirectoryExists:&directoryError]) {
    reject(@"event_log_directory_error", directoryError.localizedDescription, directoryError);
    return;
  }

  NSString *filePath = [self eventLogFilePath];

  if (![[NSFileManager defaultManager] fileExistsAtPath:filePath]) {
    resolve(@{
      @"eventLog": @[],
      @"filePath": filePath
    });
    return;
  }

  NSError *readError = nil;
  NSData *fileData = [NSData dataWithContentsOfFile:filePath options:0 error:&readError];

  if (fileData == nil) {
    reject(@"event_log_read_error", readError.localizedDescription, readError);
    return;
  }

  NSError *jsonError = nil;
  id json = [NSJSONSerialization JSONObjectWithData:fileData options:0 error:&jsonError];

  if (jsonError != nil) {
    reject(@"event_log_json_error", jsonError.localizedDescription, jsonError);
    return;
  }

  if (![json isKindOfClass:[NSArray class]]) {
    NSError *shapeError = [NSError errorWithDomain:@"FlowEventLog"
                                              code:1001
                                          userInfo:@{
                                            NSLocalizedDescriptionKey: @"The event log file does not contain an array."
                                          }];
    reject(@"event_log_shape_error", shapeError.localizedDescription, shapeError);
    return;
  }

  resolve(@{
    @"eventLog": json,
    @"filePath": filePath
  });
}

RCT_REMAP_METHOD(saveEventLog,
                 saveEventLog:(NSArray *)eventLog
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSError *directoryError = nil;

  if (![self ensureEventLogDirectoryExists:&directoryError]) {
    reject(@"event_log_directory_error", directoryError.localizedDescription, directoryError);
    return;
  }

  if (![NSJSONSerialization isValidJSONObject:eventLog]) {
    NSError *serializationError = [NSError errorWithDomain:@"FlowEventLog"
                                                      code:1002
                                                  userInfo:@{
                                                    NSLocalizedDescriptionKey: @"The event log contains non-JSON values."
                                                  }];
    reject(@"event_log_serialization_error", serializationError.localizedDescription, serializationError);
    return;
  }

  NSError *jsonError = nil;
  NSData *fileData = [NSJSONSerialization dataWithJSONObject:eventLog
                                                     options:NSJSONWritingPrettyPrinted
                                                       error:&jsonError];

  if (fileData == nil) {
    reject(@"event_log_serialization_error", jsonError.localizedDescription, jsonError);
    return;
  }

  NSString *filePath = [self eventLogFilePath];
  NSError *writeError = nil;
  BOOL didWrite = [fileData writeToFile:filePath options:NSDataWritingAtomic error:&writeError];

  if (!didWrite) {
    reject(@"event_log_write_error", writeError.localizedDescription, writeError);
    return;
  }

  NSDateFormatter *formatter = [[NSDateFormatter alloc] init];
  formatter.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
  formatter.timeZone = [NSTimeZone timeZoneWithName:@"UTC"];
  formatter.dateFormat = @"yyyy-MM-dd'T'HH:mm:ss.SSS'Z'";

  resolve(@{
    @"filePath": filePath,
    @"savedAt": [formatter stringFromDate:NSDate.date]
  });
}

@end
