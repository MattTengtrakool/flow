#import "ObservationLabStorage.h"

@implementation ObservationLabStorage

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (NSString *)appSupportDirectoryPath
{
  NSArray<NSURL *> *appSupportDirectories = [[NSFileManager defaultManager]
      URLsForDirectory:NSApplicationSupportDirectory
             inDomains:NSUserDomainMask];
  NSURL *appSupportDirectory = appSupportDirectories.firstObject;
  NSURL *directoryURL = [appSupportDirectory URLByAppendingPathComponent:@"Flow" isDirectory:YES];

  return directoryURL.path;
}

- (NSString *)fixturesDirectoryPath
{
  return [[self appSupportDirectoryPath] stringByAppendingPathComponent:@"observation-fixtures"];
}

- (NSString *)workflowRecordingsDirectoryPath
{
  return [[self appSupportDirectoryPath] stringByAppendingPathComponent:@"workflow-recordings"];
}

- (NSString *)settingsFilePath
{
  return [[self appSupportDirectoryPath] stringByAppendingPathComponent:@"observation-settings.json"];
}

- (BOOL)ensureDirectoryExistsAtPath:(NSString *)path error:(NSError **)error
{
  return [[NSFileManager defaultManager] createDirectoryAtPath:path
                                   withIntermediateDirectories:YES
                                                    attributes:nil
                                                         error:error];
}

- (BOOL)ensureStorageDirectoriesExist:(NSError **)error
{
  if (![self ensureDirectoryExistsAtPath:[self appSupportDirectoryPath] error:error]) {
    return NO;
  }

  if (![self ensureDirectoryExistsAtPath:[self fixturesDirectoryPath] error:error]) {
    return NO;
  }

  return [self ensureDirectoryExistsAtPath:[self workflowRecordingsDirectoryPath] error:error];
}

- (NSString *)timestampString
{
  NSDateFormatter *formatter = [[NSDateFormatter alloc] init];
  formatter.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
  formatter.timeZone = [NSTimeZone timeZoneWithName:@"UTC"];
  formatter.dateFormat = @"yyyy-MM-dd'T'HH:mm:ss.SSS'Z'";

  return [formatter stringFromDate:NSDate.date];
}

RCT_REMAP_METHOD(loadObservationSettings,
                 loadObservationSettingsWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSError *directoryError = nil;

  if (![self ensureStorageDirectoriesExist:&directoryError]) {
    reject(@"observation_storage_directory_error", directoryError.localizedDescription, directoryError);
    return;
  }

  NSString *filePath = [self settingsFilePath];

  if (![[NSFileManager defaultManager] fileExistsAtPath:filePath]) {
    resolve(@{
      @"settings": @{
        @"apiKey": @"",
        @"model": @"gpt-5-mini",
        @"savedAt": [NSNull null]
      },
      @"filePath": filePath
    });
    return;
  }

  NSError *readError = nil;
  NSData *fileData = [NSData dataWithContentsOfFile:filePath options:0 error:&readError];

  if (fileData == nil) {
    reject(@"observation_settings_read_error", readError.localizedDescription, readError);
    return;
  }

  NSError *jsonError = nil;
  id json = [NSJSONSerialization JSONObjectWithData:fileData options:0 error:&jsonError];

  if (jsonError != nil) {
    reject(@"observation_settings_json_error", jsonError.localizedDescription, jsonError);
    return;
  }

  if (![json isKindOfClass:[NSDictionary class]]) {
    NSError *shapeError = [NSError errorWithDomain:@"FlowObservationSettings"
                                              code:2001
                                          userInfo:@{
                                            NSLocalizedDescriptionKey: @"The observation settings file does not contain an object."
                                          }];
    reject(@"observation_settings_shape_error", shapeError.localizedDescription, shapeError);
    return;
  }

  resolve(@{
    @"settings": json,
    @"filePath": filePath
  });
}

RCT_REMAP_METHOD(saveObservationSettings,
                 saveObservationSettings:(NSDictionary *)settings
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSError *directoryError = nil;

  if (![self ensureStorageDirectoriesExist:&directoryError]) {
    reject(@"observation_storage_directory_error", directoryError.localizedDescription, directoryError);
    return;
  }

  if (![NSJSONSerialization isValidJSONObject:settings]) {
    NSError *serializationError = [NSError errorWithDomain:@"FlowObservationSettings"
                                                      code:2002
                                                  userInfo:@{
                                                    NSLocalizedDescriptionKey: @"The observation settings contain non-JSON values."
                                                  }];
    reject(@"observation_settings_serialization_error", serializationError.localizedDescription, serializationError);
    return;
  }

  NSError *jsonError = nil;
  NSData *fileData = [NSJSONSerialization dataWithJSONObject:settings
                                                     options:NSJSONWritingPrettyPrinted
                                                       error:&jsonError];

  if (fileData == nil) {
    reject(@"observation_settings_serialization_error", jsonError.localizedDescription, jsonError);
    return;
  }

  NSString *filePath = [self settingsFilePath];
  NSError *writeError = nil;
  BOOL didWrite = [fileData writeToFile:filePath options:NSDataWritingAtomic error:&writeError];

  if (!didWrite) {
    reject(@"observation_settings_write_error", writeError.localizedDescription, writeError);
    return;
  }

  resolve(@{
    @"filePath": filePath,
    @"savedAt": [self timestampString]
  });
}

RCT_REMAP_METHOD(loadObservationFixtures,
                 loadObservationFixturesWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSError *directoryError = nil;

  if (![self ensureStorageDirectoriesExist:&directoryError]) {
    reject(@"observation_storage_directory_error", directoryError.localizedDescription, directoryError);
    return;
  }

  NSString *directoryPath = [self fixturesDirectoryPath];
  NSError *listingError = nil;
  NSArray<NSString *> *entries = [[NSFileManager defaultManager] contentsOfDirectoryAtPath:directoryPath
                                                                                      error:&listingError];

  if (entries == nil) {
    reject(@"observation_fixtures_list_error", listingError.localizedDescription, listingError);
    return;
  }

  NSMutableArray *fixtures = [NSMutableArray array];

  for (NSString *entry in entries) {
    if (![entry.pathExtension.lowercaseString isEqualToString:@"json"]) {
      continue;
    }

    NSString *filePath = [directoryPath stringByAppendingPathComponent:entry];
    NSError *readError = nil;
    NSData *fileData = [NSData dataWithContentsOfFile:filePath options:0 error:&readError];

    if (fileData == nil) {
      reject(@"observation_fixture_read_error", readError.localizedDescription, readError);
      return;
    }

    NSError *jsonError = nil;
    id json = [NSJSONSerialization JSONObjectWithData:fileData options:0 error:&jsonError];

    if (jsonError != nil) {
      reject(@"observation_fixture_json_error", jsonError.localizedDescription, jsonError);
      return;
    }

    if ([json isKindOfClass:[NSDictionary class]]) {
      [fixtures addObject:json];
    }
  }

  NSSortDescriptor *sortDescriptor = [NSSortDescriptor sortDescriptorWithKey:@"createdAt" ascending:NO];
  NSArray *sortedFixtures = [fixtures sortedArrayUsingDescriptors:@[sortDescriptor]];

  resolve(@{
    @"fixtures": sortedFixtures,
    @"directoryPath": directoryPath
  });
}

RCT_REMAP_METHOD(saveObservationFixture,
                 saveObservationFixture:(NSDictionary *)fixture
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSError *directoryError = nil;

  if (![self ensureStorageDirectoriesExist:&directoryError]) {
    reject(@"observation_storage_directory_error", directoryError.localizedDescription, directoryError);
    return;
  }

  if (![NSJSONSerialization isValidJSONObject:fixture]) {
    NSError *serializationError = [NSError errorWithDomain:@"FlowObservationFixture"
                                                      code:2003
                                                  userInfo:@{
                                                    NSLocalizedDescriptionKey: @"The observation fixture contains non-JSON values."
                                                  }];
    reject(@"observation_fixture_serialization_error", serializationError.localizedDescription, serializationError);
    return;
  }

  NSString *fixtureId = fixture[@"id"];

  if (![fixtureId isKindOfClass:[NSString class]] || fixtureId.length == 0) {
    NSError *shapeError = [NSError errorWithDomain:@"FlowObservationFixture"
                                              code:2004
                                          userInfo:@{
                                            NSLocalizedDescriptionKey: @"The observation fixture must include a string id."
                                          }];
    reject(@"observation_fixture_shape_error", shapeError.localizedDescription, shapeError);
    return;
  }

  NSError *jsonError = nil;
  NSData *fileData = [NSJSONSerialization dataWithJSONObject:fixture
                                                     options:NSJSONWritingPrettyPrinted
                                                       error:&jsonError];

  if (fileData == nil) {
    reject(@"observation_fixture_serialization_error", jsonError.localizedDescription, jsonError);
    return;
  }

  NSString *filePath = [[self fixturesDirectoryPath] stringByAppendingPathComponent:[fixtureId stringByAppendingString:@".json"]];
  NSError *writeError = nil;
  BOOL didWrite = [fileData writeToFile:filePath options:NSDataWritingAtomic error:&writeError];

  if (!didWrite) {
    reject(@"observation_fixture_write_error", writeError.localizedDescription, writeError);
    return;
  }

  resolve(@{
    @"filePath": filePath,
    @"savedAt": [self timestampString]
  });
}

RCT_REMAP_METHOD(deleteObservationFixture,
                 deleteObservationFixture:(NSString *)fixtureId
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSError *directoryError = nil;

  if (![self ensureStorageDirectoriesExist:&directoryError]) {
    reject(@"observation_storage_directory_error", directoryError.localizedDescription, directoryError);
    return;
  }

  NSString *filePath = [[self fixturesDirectoryPath] stringByAppendingPathComponent:[fixtureId stringByAppendingString:@".json"]];

  if ([[NSFileManager defaultManager] fileExistsAtPath:filePath]) {
    NSError *removeError = nil;
    BOOL didRemove = [[NSFileManager defaultManager] removeItemAtPath:filePath error:&removeError];

    if (!didRemove) {
      reject(@"observation_fixture_delete_error", removeError.localizedDescription, removeError);
      return;
    }
  }

  resolve(@{
    @"directoryPath": [self fixturesDirectoryPath],
    @"deletedAt": [self timestampString]
  });
}

RCT_REMAP_METHOD(loadWorkflowRecordings,
                 loadWorkflowRecordingsWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSError *directoryError = nil;

  if (![self ensureStorageDirectoriesExist:&directoryError]) {
    reject(@"workflow_recordings_directory_error", directoryError.localizedDescription, directoryError);
    return;
  }

  NSString *directoryPath = [self workflowRecordingsDirectoryPath];
  NSError *listingError = nil;
  NSArray<NSString *> *entries = [[NSFileManager defaultManager] contentsOfDirectoryAtPath:directoryPath
                                                                                      error:&listingError];

  if (entries == nil) {
    reject(@"workflow_recordings_list_error", listingError.localizedDescription, listingError);
    return;
  }

  NSMutableArray *recordings = [NSMutableArray array];

  for (NSString *entry in entries) {
    if (![entry.pathExtension.lowercaseString isEqualToString:@"json"]) {
      continue;
    }

    NSString *filePath = [directoryPath stringByAppendingPathComponent:entry];
    NSError *readError = nil;
    NSData *fileData = [NSData dataWithContentsOfFile:filePath options:0 error:&readError];

    if (fileData == nil) {
      reject(@"workflow_recording_read_error", readError.localizedDescription, readError);
      return;
    }

    NSError *jsonError = nil;
    id json = [NSJSONSerialization JSONObjectWithData:fileData options:0 error:&jsonError];

    if (jsonError != nil) {
      reject(@"workflow_recording_json_error", jsonError.localizedDescription, jsonError);
      return;
    }

    if ([json isKindOfClass:[NSDictionary class]]) {
      [recordings addObject:json];
    }
  }

  NSSortDescriptor *sortDescriptor = [NSSortDescriptor sortDescriptorWithKey:@"createdAt" ascending:NO];
  NSArray *sortedRecordings = [recordings sortedArrayUsingDescriptors:@[sortDescriptor]];

  resolve(@{
    @"recordings": sortedRecordings,
    @"directoryPath": directoryPath
  });
}

RCT_REMAP_METHOD(saveWorkflowRecording,
                 saveWorkflowRecording:(NSDictionary *)recording
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSError *directoryError = nil;

  if (![self ensureStorageDirectoriesExist:&directoryError]) {
    reject(@"workflow_recordings_directory_error", directoryError.localizedDescription, directoryError);
    return;
  }

  if (![NSJSONSerialization isValidJSONObject:recording]) {
    NSError *serializationError = [NSError errorWithDomain:@"FlowWorkflowRecording"
                                                      code:3001
                                                  userInfo:@{
                                                    NSLocalizedDescriptionKey: @"The workflow recording contains non-JSON values."
                                                  }];
    reject(@"workflow_recording_serialization_error", serializationError.localizedDescription, serializationError);
    return;
  }

  NSString *recordingId = recording[@"id"];

  if (![recordingId isKindOfClass:[NSString class]] || recordingId.length == 0) {
    NSError *shapeError = [NSError errorWithDomain:@"FlowWorkflowRecording"
                                              code:3002
                                          userInfo:@{
                                            NSLocalizedDescriptionKey: @"The workflow recording must include a string id."
                                          }];
    reject(@"workflow_recording_shape_error", shapeError.localizedDescription, shapeError);
    return;
  }

  NSError *jsonError = nil;
  NSData *fileData = [NSJSONSerialization dataWithJSONObject:recording
                                                     options:NSJSONWritingPrettyPrinted
                                                       error:&jsonError];

  if (fileData == nil) {
    reject(@"workflow_recording_serialization_error", jsonError.localizedDescription, jsonError);
    return;
  }

  NSString *filePath = [[self workflowRecordingsDirectoryPath] stringByAppendingPathComponent:[recordingId stringByAppendingString:@".json"]];
  NSError *writeError = nil;
  BOOL didWrite = [fileData writeToFile:filePath options:NSDataWritingAtomic error:&writeError];

  if (!didWrite) {
    reject(@"workflow_recording_write_error", writeError.localizedDescription, writeError);
    return;
  }

  resolve(@{
    @"filePath": filePath,
    @"savedAt": [self timestampString]
  });
}

RCT_REMAP_METHOD(deleteWorkflowRecording,
                 deleteWorkflowRecording:(NSString *)recordingId
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSError *directoryError = nil;

  if (![self ensureStorageDirectoriesExist:&directoryError]) {
    reject(@"workflow_recordings_directory_error", directoryError.localizedDescription, directoryError);
    return;
  }

  NSString *filePath = [[self workflowRecordingsDirectoryPath] stringByAppendingPathComponent:[recordingId stringByAppendingString:@".json"]];

  if ([[NSFileManager defaultManager] fileExistsAtPath:filePath]) {
    NSError *removeError = nil;
    BOOL didRemove = [[NSFileManager defaultManager] removeItemAtPath:filePath error:&removeError];

    if (!didRemove) {
      reject(@"workflow_recording_delete_error", removeError.localizedDescription, removeError);
      return;
    }
  }

  resolve(@{
    @"directoryPath": [self workflowRecordingsDirectoryPath],
    @"deletedAt": [self timestampString]
  });
}

@end
