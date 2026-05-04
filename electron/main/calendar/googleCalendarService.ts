import { BrowserWindow, ipcMain, safeStorage, shell } from 'electron';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  buildCalendarContext,
  buildScheduledCalendarItems,
  isCalendarEventBusy,
  isCalendarSourceActive,
} from '../../../src/calendar/calendarLogic';
import type {
  CalendarAccountView,
  CalendarContext,
  CalendarEventAnnotationPatch,
  CalendarEventAnnotationView,
  CalendarEventBlockLinkAction,
  CalendarSourceAccessRole,
  CalendarSourceMode,
  CalendarSourceView,
  CalendarStatePayload,
  CalendarSyncStatus,
  ExternalCalendarEventView,
} from '../../../src/calendar/types';
import { redactSensitiveText } from '../../../src/privacy/redaction';
import { getAppDataDirectoryPath } from '../appProfile';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const GOOGLE_CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';
const SYNC_INTERVAL_MS = 15 * 60 * 1000;
const INITIAL_SYNC_PAST_DAYS = 30;
const INITIAL_SYNC_FUTURE_DAYS = 90;
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_OAUTH_REDIRECT_PORT = 53682;

const GOOGLE_CALENDAR_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.readonly',
];

type StoredSecret = {
  value: string;
  encrypted: boolean;
};

type StoredCalendarSourceMode = CalendarSourceMode | 'task_context';

type StoredGoogleAccount = {
  id: string;
  email: string;
  displayName: string | null;
  connectedAt: string;
  refreshToken: StoredSecret;
  syncTokens: Record<string, string>;
  calendarSelections: Record<string, boolean>;
  calendarSourceModes?: Record<string, StoredCalendarSourceMode>;
};

type StoredCalendarIntegrations = {
  googleAccounts: StoredGoogleAccount[];
  eventAnnotations?: Record<string, CalendarEventAnnotationView>;
};

type CalendarCache = {
  sources: CalendarSourceView[];
  events: ExternalCalendarEventView[];
  updatedAt: string | null;
};

type CalendarEvents = {
  changed: [CalendarStatePayload];
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
};

type GoogleUserInfo = {
  sub?: string;
  email?: string;
  name?: string;
};

type GoogleCalendarListResponse = {
  items?: GoogleCalendarListEntry[];
  nextPageToken?: string;
};

type GoogleCalendarListEntry = {
  id?: string;
  summary?: string;
  description?: string;
  backgroundColor?: string;
  primary?: boolean;
  accessRole?: CalendarSourceAccessRole;
  deleted?: boolean;
};

type GoogleEventsResponse = {
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
};

type GoogleEvent = {
  id?: string;
  iCalUID?: string;
  status?: string;
  summary?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  transparency?: string;
  visibility?: string;
  eventType?: string;
  location?: string;
  attendees?: Array<{
    email?: string;
    displayName?: string;
    self?: boolean;
    responseStatus?: string;
  }>;
  conferenceData?: {
    entryPoints?: Array<{
      entryPointType?: string;
      uri?: string;
    }>;
  };
  hangoutLink?: string;
  htmlLink?: string;
  updated?: string;
};

function integrationsDirectoryPath(): string {
  return getAppDataDirectoryPath();
}

export function getCalendarIntegrationsFilePath(): string {
  return path.join(integrationsDirectoryPath(), 'calendar-integrations.json');
}

export function getCalendarCacheFilePath(): string {
  return path.join(integrationsDirectoryPath(), 'calendar-cache.json');
}

class GoogleCalendarService extends EventEmitter<CalendarEvents> {
  private stored: StoredCalendarIntegrations = {
    googleAccounts: [],
    eventAnnotations: {},
  };
  private cache: CalendarCache = { sources: [], events: [], updatedAt: null };
  private loaded = false;
  private syncStatus: CalendarSyncStatus = 'idle';
  private errorMessage: string | null = null;
  private syncTimer: NodeJS.Timeout | null = null;

  async hydrate() {
    if (this.loaded) return;
    await fs.mkdir(integrationsDirectoryPath(), { recursive: true });
    this.stored = await readJsonFile(getCalendarIntegrationsFilePath(), {
      googleAccounts: [],
      eventAnnotations: {},
    } satisfies StoredCalendarIntegrations);
    this.normalizeStoredIntegrations();
    this.cache = await readJsonFile(getCalendarCacheFilePath(), {
      sources: [],
      events: [],
      updatedAt: null,
    } satisfies CalendarCache);
    this.cache.sources = this.cache.sources.map(source =>
      normalizeCachedSource(source),
    );
    this.cache.events = this.cache.events.map(event =>
      reducePrivateCalendarEvent(event),
    );
    this.loaded = true;
    this.ensureSyncTimer();
    this.broadcast();
    if (this.stored.googleAccounts.length > 0 && this.oauthClientConfigured()) {
      this.syncNow().catch(() => {});
    }
  }

  async getState(): Promise<CalendarStatePayload> {
    await this.ensureLoaded();
    return this.publicState();
  }

  getContextForRange(
    windowStartAt: string,
    windowEndAt: string,
  ): CalendarContext {
    return buildCalendarContext({
      events: this.cache.events,
      sources: this.cache.sources,
      annotations: this.annotations(),
      windowStartAt,
      windowEndAt,
    });
  }

  async connectGoogleAccount(): Promise<CalendarStatePayload> {
    await this.ensureLoaded();
    const clientId = googleOAuthClientId();
    if (clientId == null) {
      this.errorMessage = 'GOOGLE_OAUTH_CLIENT_ID is not configured.';
      this.broadcast();
      return this.publicState();
    }

    this.syncStatus = 'syncing';
    this.errorMessage = null;
    this.broadcast();

    try {
      const auth = await runOAuthFlow({
        clientId,
        clientSecret: googleOAuthClientSecret(),
      });
      const userInfo = await fetchGoogleJson<GoogleUserInfo>(
        GOOGLE_USERINFO_URL,
        auth.accessToken,
      );
      const email = userInfo.email ?? 'unknown-google-account';
      const accountId = `google_${safeId(userInfo.sub ?? email)}`;
      const existing = this.stored.googleAccounts.find(
        account => account.id === accountId,
      );
      const nextAccount: StoredGoogleAccount = {
        id: accountId,
        email,
        displayName: userInfo.name ?? null,
        connectedAt: existing?.connectedAt ?? new Date().toISOString(),
        refreshToken: encryptSecret(auth.refreshToken),
        syncTokens: existing?.syncTokens ?? {},
        calendarSelections: existing?.calendarSelections ?? {},
        calendarSourceModes: existing?.calendarSourceModes ?? {},
      };

      this.stored.googleAccounts = [
        ...this.stored.googleAccounts.filter(
          account => account.id !== accountId,
        ),
        nextAccount,
      ];
      await this.persistStored();
      await this.syncAccount(nextAccount, auth.accessToken);
      this.syncStatus = 'idle';
      this.errorMessage = null;
    } catch (error) {
      this.syncStatus = 'error';
      this.errorMessage =
        error instanceof Error
          ? error.message
          : 'Google Calendar connection failed.';
    }

    this.broadcast();
    return this.publicState();
  }

  async disconnectGoogleAccount(
    accountId: string,
  ): Promise<CalendarStatePayload> {
    await this.ensureLoaded();
    this.stored.googleAccounts = this.stored.googleAccounts.filter(
      account => account.id !== accountId,
    );
    this.cache.sources = this.cache.sources.filter(
      source => source.accountId !== accountId,
    );
    this.cache.events = this.cache.events.filter(
      event => event.accountId !== accountId,
    );
    this.stored.eventAnnotations = Object.fromEntries(
      Object.entries(this.stored.eventAnnotations ?? {}).filter(
        ([, annotation]) => annotation.accountId !== accountId,
      ),
    );
    this.cache.updatedAt = new Date().toISOString();
    await this.persistStored();
    await this.persistCache();
    this.broadcast();
    return this.publicState();
  }

  async updateCalendarSelection(
    accountId: string,
    calendarId: string,
    enabled: boolean,
  ): Promise<CalendarStatePayload> {
    return this.updateCalendarSourceMode(
      accountId,
      calendarId,
      enabled ? 'scheduled' : 'ignored',
    );
  }

  async updateCalendarSourceMode(
    accountId: string,
    calendarId: string,
    mode: CalendarSourceMode,
  ): Promise<CalendarStatePayload> {
    await this.ensureLoaded();
    const account = this.stored.googleAccounts.find(
      item => item.id === accountId,
    );
    if (account == null) return this.publicState();
    account.calendarSelections[calendarId] = mode !== 'ignored';
    account.calendarSourceModes ??= {};
    account.calendarSourceModes[calendarId] = mode;
    this.cache.sources = this.cache.sources.map(source =>
      source.accountId === accountId && source.externalId === calendarId
        ? { ...source, enabled: mode !== 'ignored', mode }
        : source,
    );
    if (mode === 'ignored') {
      this.cache.events = this.cache.events.filter(
        event =>
          !(
            event.accountId === accountId &&
            this.cache.sources.find(source => source.id === event.sourceId)
              ?.externalId === calendarId
          ),
      );
      delete account.syncTokens[calendarId];
    }
    await this.persistStored();
    await this.persistCache();
    if (mode !== 'ignored') {
      await this.syncNow();
    } else {
      this.broadcast();
    }
    return this.publicState();
  }

  async updateEventAnnotation(
    eventId: string,
    patch: CalendarEventAnnotationPatch,
  ): Promise<CalendarStatePayload> {
    await this.ensureLoaded();
    const event = this.cache.events.find(item => item.id === eventId);
    if (event == null) return this.publicState();
    const previous = this.stored.eventAnnotations?.[eventId];
    const next: CalendarEventAnnotationView = {
      eventId,
      accountId: event.accountId,
      sourceId: event.sourceId,
      notes: patch.notes != null ? patch.notes.trim() : previous?.notes ?? '',
      outcome:
        patch.outcome != null ? patch.outcome.trim() : previous?.outcome ?? '',
      followUps:
        patch.followUps != null
          ? sanitizeFollowUps(patch.followUps)
          : previous?.followUps ?? [],
      modeOverride:
        patch.modeOverride !== undefined
          ? normalizeCalendarSourceMode(patch.modeOverride)
          : previous?.modeOverride ?? null,
      confirmedBlockIds: previous?.confirmedBlockIds ?? [],
      dismissedBlockIds: previous?.dismissedBlockIds ?? [],
      editedAt: new Date().toISOString(),
    };
    this.stored.eventAnnotations ??= {};
    if (isEmptyAnnotation(next)) {
      delete this.stored.eventAnnotations[eventId];
    } else {
      this.stored.eventAnnotations[eventId] = next;
    }
    await this.persistStored();
    this.broadcast();
    return this.publicState();
  }

  async updateEventBlockLink(
    eventId: string,
    blockId: string,
    action: CalendarEventBlockLinkAction,
  ): Promise<CalendarStatePayload> {
    await this.ensureLoaded();
    const event = this.cache.events.find(item => item.id === eventId);
    if (event == null || blockId.trim().length === 0) {
      return this.publicState();
    }
    const annotation = this.annotationForEvent(event);
    const confirmed = new Set(annotation.confirmedBlockIds);
    const dismissed = new Set(annotation.dismissedBlockIds);
    if (action === 'confirm') {
      confirmed.add(blockId);
      dismissed.delete(blockId);
    } else if (action === 'dismiss') {
      dismissed.add(blockId);
      confirmed.delete(blockId);
    } else {
      confirmed.delete(blockId);
      dismissed.delete(blockId);
    }
    const next: CalendarEventAnnotationView = {
      ...annotation,
      confirmedBlockIds: Array.from(confirmed),
      dismissedBlockIds: Array.from(dismissed),
      editedAt: new Date().toISOString(),
    };
    this.stored.eventAnnotations ??= {};
    if (isEmptyAnnotation(next)) {
      delete this.stored.eventAnnotations[eventId];
    } else {
      this.stored.eventAnnotations[eventId] = next;
    }
    await this.persistStored();
    this.broadcast();
    return this.publicState();
  }

  async syncNow(): Promise<CalendarStatePayload> {
    await this.ensureLoaded();
    if (this.syncStatus === 'syncing') return this.publicState();
    if (!this.oauthClientConfigured()) {
      this.errorMessage = 'GOOGLE_OAUTH_CLIENT_ID is not configured.';
      this.syncStatus = 'error';
      this.broadcast();
      return this.publicState();
    }

    this.syncStatus = 'syncing';
    this.errorMessage = null;
    this.broadcast();

    try {
      for (const account of this.stored.googleAccounts) {
        const accessToken = await this.refreshAccessToken(account);
        await this.syncAccount(account, accessToken);
      }
      this.pruneCacheWindow();
      this.cache.updatedAt = new Date().toISOString();
      this.syncStatus = 'idle';
      this.errorMessage = null;
      await this.persistStored();
      await this.persistCache();
    } catch (error) {
      this.syncStatus = 'error';
      this.errorMessage =
        error instanceof Error ? error.message : 'Google Calendar sync failed.';
    }

    this.broadcast();
    return this.publicState();
  }

  private async syncAccount(account: StoredGoogleAccount, accessToken: string) {
    const sources = await this.fetchCalendarSources(account, accessToken);
    this.replaceAccountSources(account.id, sources);
    for (const source of sources.filter(isCalendarSourceActive)) {
      await this.syncSourceEvents(account, source, accessToken);
    }
    await this.persistStored();
    await this.persistCache();
  }

  private async fetchCalendarSources(
    account: StoredGoogleAccount,
    accessToken: string,
  ): Promise<CalendarSourceView[]> {
    const entries: GoogleCalendarListEntry[] = [];
    let pageToken: string | null = null;
    do {
      const url = new URL(`${GOOGLE_CALENDAR_BASE}/users/me/calendarList`);
      url.searchParams.set('maxResults', '250');
      url.searchParams.set('showHidden', 'true');
      if (pageToken != null) url.searchParams.set('pageToken', pageToken);
      const payload = await fetchGoogleJson<GoogleCalendarListResponse>(
        url.toString(),
        accessToken,
      );
      entries.push(...(payload.items ?? []));
      pageToken = payload.nextPageToken ?? null;
    } while (pageToken != null);

    for (const entry of entries) {
      if (entry.id == null || entry.deleted === true) continue;
      account.calendarSourceModes ??= {};
      if (account.calendarSourceModes[entry.id] == null) {
        account.calendarSourceModes[entry.id] =
          account.calendarSelections[entry.id] === true ||
          entry.primary === true
            ? 'scheduled'
            : 'ignored';
      }
      account.calendarSelections[entry.id] =
        normalizeCalendarSourceMode(account.calendarSourceModes[entry.id]) !==
        'ignored';
    }

    return entries
      .filter(entry => entry.id != null && entry.deleted !== true)
      .map(entry => ({
        id: sourceId(account.id, entry.id!),
        accountId: account.id,
        provider: 'google',
        externalId: entry.id!,
        summary: sanitizeCalendarSourceTitle(entry.summary) ?? 'Calendar',
        description: sanitizeCalendarText(entry.description),
        color: entry.backgroundColor ?? null,
        primary: entry.primary === true,
        accessRole: entry.accessRole ?? 'reader',
        mode: normalizeCalendarSourceMode(
          account.calendarSourceModes?.[entry.id!],
        ),
        enabled:
          normalizeCalendarSourceMode(
            account.calendarSourceModes?.[entry.id!],
          ) !== 'ignored',
      }));
  }

  private async syncSourceEvents(
    account: StoredGoogleAccount,
    source: CalendarSourceView,
    accessToken: string,
  ) {
    try {
      await this.syncSourceEventsOnce(account, source, accessToken, false);
    } catch (error) {
      if (error instanceof GoogleApiError && error.status === 410) {
        delete account.syncTokens[source.externalId];
        this.cache.events = this.cache.events.filter(
          event => event.sourceId !== source.id,
        );
        await this.syncSourceEventsOnce(account, source, accessToken, true);
        return;
      }
      throw error;
    }
  }

  private async syncSourceEventsOnce(
    account: StoredGoogleAccount,
    source: CalendarSourceView,
    accessToken: string,
    forceFullSync: boolean,
  ) {
    let pageToken: string | null = null;
    const syncToken = forceFullSync
      ? null
      : account.syncTokens[source.externalId] ?? null;
    do {
      const url = new URL(
        `${GOOGLE_CALENDAR_BASE}/calendars/${encodeURIComponent(
          source.externalId,
        )}/events`,
      );
      url.searchParams.set('maxResults', '2500');
      url.searchParams.set('singleEvents', 'true');
      url.searchParams.set('showDeleted', 'true');
      if (pageToken != null) url.searchParams.set('pageToken', pageToken);
      if (syncToken != null) {
        url.searchParams.set('syncToken', syncToken);
      } else {
        url.searchParams.set('timeMin', relativeIso(-INITIAL_SYNC_PAST_DAYS));
        url.searchParams.set('timeMax', relativeIso(INITIAL_SYNC_FUTURE_DAYS));
      }

      const payload = await fetchGoogleJson<GoogleEventsResponse>(
        url.toString(),
        accessToken,
      );
      const syncedAt = new Date().toISOString();
      for (const googleEvent of payload.items ?? []) {
        this.applyGoogleEvent(account, source, googleEvent, syncedAt);
      }
      pageToken = payload.nextPageToken ?? null;
      if (payload.nextSyncToken != null) {
        account.syncTokens[source.externalId] = payload.nextSyncToken;
      }
    } while (pageToken != null);
  }

  private applyGoogleEvent(
    account: StoredGoogleAccount,
    source: CalendarSourceView,
    googleEvent: GoogleEvent,
    syncedAt: string,
  ) {
    if (googleEvent.id == null) return;
    const id = eventId(account.id, source.externalId, googleEvent.id);
    if (googleEvent.status === 'cancelled') {
      this.cache.events = this.cache.events.filter(event => event.id !== id);
      return;
    }
    const mapped = mapGoogleEvent(account.id, source, googleEvent, syncedAt);
    if (mapped == null) return;
    this.cache.events = [
      ...this.cache.events.filter(event => event.id !== mapped.id),
      mapped,
    ].sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  private replaceAccountSources(
    accountId: string,
    sources: CalendarSourceView[],
  ) {
    const activeSourceIds = new Set(
      sources.filter(isCalendarSourceActive).map(source => source.id),
    );
    this.cache.sources = [
      ...this.cache.sources.filter(source => source.accountId !== accountId),
      ...sources,
    ].sort((a, b) => a.summary.localeCompare(b.summary));
    this.cache.events = this.cache.events.filter(event => {
      if (event.accountId !== accountId) return true;
      return activeSourceIds.has(event.sourceId);
    });
  }

  private pruneCacheWindow() {
    const minMs = Date.parse(relativeIso(-INITIAL_SYNC_PAST_DAYS));
    const maxMs = Date.parse(relativeIso(INITIAL_SYNC_FUTURE_DAYS));
    this.cache.events = this.cache.events.filter(event => {
      const endMs = Date.parse(event.endTime);
      const startMs = Date.parse(event.startTime);
      return Number.isFinite(startMs) && Number.isFinite(endMs)
        ? endMs >= minMs && startMs <= maxMs
        : false;
    });
  }

  private async refreshAccessToken(
    account: StoredGoogleAccount,
  ): Promise<string> {
    const clientId = googleOAuthClientId();
    if (clientId == null) {
      throw new Error('GOOGLE_OAUTH_CLIENT_ID is not configured.');
    }
    const body = new URLSearchParams({
      client_id: clientId,
      refresh_token: decryptSecret(account.refreshToken),
      grant_type: 'refresh_token',
    });
    const clientSecret = googleOAuthClientSecret();
    if (clientSecret != null) {
      body.set('client_secret', clientSecret);
    }
    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const payload = (await response.json()) as GoogleTokenResponse;
    if (!response.ok || payload.access_token == null) {
      throw new Error(
        payload.error_description ??
          payload.error ??
          `Google token refresh failed with status ${response.status}.`,
      );
    }
    return payload.access_token;
  }

  private publicState(): CalendarStatePayload {
    const annotations = this.annotations();
    const accounts: CalendarAccountView[] = this.stored.googleAccounts.map(
      account => ({
        id: account.id,
        provider: 'google',
        email: account.email,
        displayName: account.displayName,
        connectedAt: account.connectedAt,
        lastSyncedAt: latestSyncedAtForAccount(account.id, this.cache.events),
        syncStatus: this.syncStatus,
        syncError: this.errorMessage,
      }),
    );
    return {
      accounts,
      sources: this.cache.sources,
      events: this.cache.events,
      annotations,
      scheduledItems: buildScheduledCalendarItems({
        events: this.cache.events,
        sources: this.cache.sources,
        annotations,
      }),
      taskFitSuggestions: [],
      status: this.syncStatus,
      errorMessage: this.errorMessage,
      lastSyncedAt: this.cache.updatedAt,
      oauthClientConfigured: this.oauthClientConfigured(),
    };
  }

  private annotations(): CalendarEventAnnotationView[] {
    return Object.values(this.stored.eventAnnotations ?? {}).sort((a, b) =>
      a.eventId.localeCompare(b.eventId),
    );
  }

  private annotationForEvent(
    event: ExternalCalendarEventView,
  ): CalendarEventAnnotationView {
    return (
      this.stored.eventAnnotations?.[event.id] ?? {
        eventId: event.id,
        accountId: event.accountId,
        sourceId: event.sourceId,
        notes: '',
        outcome: '',
        followUps: [],
        modeOverride: null,
        confirmedBlockIds: [],
        dismissedBlockIds: [],
        editedAt: new Date().toISOString(),
      }
    );
  }

  private normalizeStoredIntegrations() {
    this.stored.eventAnnotations ??= {};
    this.stored.eventAnnotations = Object.fromEntries(
      Object.entries(this.stored.eventAnnotations).map(
        ([eventId, annotation]) => [
          eventId,
          normalizeStoredAnnotation(annotation),
        ],
      ),
    );
    this.stored.googleAccounts = this.stored.googleAccounts.map(account => {
      const calendarSourceModes: Record<string, CalendarSourceMode> = {};
      for (const [calendarId, mode] of Object.entries(
        account.calendarSourceModes ?? {},
      )) {
        calendarSourceModes[calendarId] = normalizeCalendarSourceMode(mode);
      }
      for (const [calendarId, enabled] of Object.entries(
        account.calendarSelections ?? {},
      )) {
        calendarSourceModes[calendarId] ??= enabled ? 'scheduled' : 'ignored';
      }
      return {
        ...account,
        syncTokens: account.syncTokens ?? {},
        calendarSelections: Object.fromEntries(
          Object.entries(calendarSourceModes).map(([calendarId, mode]) => [
            calendarId,
            mode !== 'ignored',
          ]),
        ),
        calendarSourceModes,
      };
    });
  }

  private broadcast() {
    const payload = this.publicState();
    this.emit('changed', payload);
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('flow:calendar:stateChanged', payload);
    }
  }

  private async ensureLoaded() {
    if (!this.loaded) await this.hydrate();
  }

  private oauthClientConfigured(): boolean {
    return googleOAuthClientId() != null;
  }

  private ensureSyncTimer() {
    if (this.syncTimer != null) return;
    this.syncTimer = setInterval(() => {
      if (this.stored.googleAccounts.length > 0) {
        this.syncNow().catch(() => {});
      }
    }, SYNC_INTERVAL_MS);
  }

  private async persistStored() {
    await writeJsonAtomically(getCalendarIntegrationsFilePath(), this.stored);
  }

  private async persistCache() {
    await writeJsonAtomically(getCalendarCacheFilePath(), this.cache);
  }
}

export const calendarService = new GoogleCalendarService();

export function registerCalendarIpcHandlers() {
  ipcMain.handle('flow:calendar:getState', () => calendarService.getState());
  ipcMain.handle('flow:calendar:connectGoogleAccount', () =>
    calendarService.connectGoogleAccount(),
  );
  ipcMain.handle('flow:calendar:disconnectGoogleAccount', (_event, accountId) =>
    calendarService.disconnectGoogleAccount(accountId),
  );
  ipcMain.handle('flow:calendar:syncNow', () => calendarService.syncNow());
  ipcMain.handle(
    'flow:calendar:updateCalendarSelection',
    (_event, accountId, calendarId, enabled) =>
      calendarService.updateCalendarSelection(accountId, calendarId, enabled),
  );
  ipcMain.handle(
    'flow:calendar:updateCalendarSourceMode',
    (_event, accountId, calendarId, mode) =>
      calendarService.updateCalendarSourceMode(accountId, calendarId, mode),
  );
  ipcMain.handle(
    'flow:calendar:updateEventAnnotation',
    (_event, eventId, patch) =>
      calendarService.updateEventAnnotation(eventId, patch),
  );
  ipcMain.handle(
    'flow:calendar:updateEventBlockLink',
    (_event, eventId, blockId, action) =>
      calendarService.updateEventBlockLink(eventId, blockId, action),
  );
}

async function runOAuthFlow(args: {
  clientId: string;
  clientSecret: string | null;
}): Promise<{ accessToken: string; refreshToken: string }> {
  const verifier = base64Url(crypto.randomBytes(64));
  const challenge = base64Url(
    crypto.createHash('sha256').update(verifier).digest(),
  );
  const state = base64Url(crypto.randomBytes(24));

  return new Promise((resolve, reject) => {
    let timeout: NodeJS.Timeout | null = null;
    let oauthRedirectUri: string | null = null;
    let settled = false;
    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      const code = requestUrl.searchParams.get('code');
      const returnedState = requestUrl.searchParams.get('state');
      const error = requestUrl.searchParams.get('error');

      if (code == null && error == null) {
        response.writeHead(204);
        response.end();
        return;
      }

      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(
        '<html><body><h1>Flow calendar connection complete</h1><p>You can return to Flow.</p></body></html>',
      );

      if (error != null) {
        finishReject(new Error(`Google OAuth failed: ${error}`));
        return;
      }
      if (code == null || returnedState !== state || oauthRedirectUri == null) {
        finishReject(new Error('Google OAuth response was invalid.'));
        return;
      }

      exchangeAuthCode({
        clientId: args.clientId,
        clientSecret: args.clientSecret,
        code,
        codeVerifier: verifier,
        redirectUri: oauthRedirectUri,
      })
        .then(finishResolve)
        .catch(finishReject);
    });

    server.on('error', error => finishReject(error));
    server.listen(googleOAuthRedirectPort(), '127.0.0.1', () => {
      oauthRedirectUri = redirectUri(server);
      const authUrl = new URL(GOOGLE_AUTH_URL);
      authUrl.searchParams.set('client_id', args.clientId);
      authUrl.searchParams.set('redirect_uri', oauthRedirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', GOOGLE_CALENDAR_SCOPES.join(' '));
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'select_account consent');
      authUrl.searchParams.set('code_challenge', challenge);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('state', state);
      shell.openExternal(authUrl.toString()).catch(finishReject);
    });

    timeout = setTimeout(() => {
      finishReject(new Error('Google OAuth timed out.'));
    }, OAUTH_TIMEOUT_MS);

    function finishResolve(value: {
      accessToken: string;
      refreshToken: string;
    }) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    }

    function finishReject(error: Error) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    }

    function cleanup() {
      if (timeout != null) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (server.listening) {
        server.close();
      }
    }
  });
}

async function exchangeAuthCode(args: {
  clientId: string;
  clientSecret: string | null;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<{ accessToken: string; refreshToken: string }> {
  const body = new URLSearchParams({
    client_id: args.clientId,
    code: args.code,
    code_verifier: args.codeVerifier,
    redirect_uri: args.redirectUri,
    grant_type: 'authorization_code',
  });
  if (args.clientSecret != null) {
    body.set('client_secret', args.clientSecret);
  }
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = (await response.json()) as GoogleTokenResponse;
  if (
    !response.ok ||
    payload.access_token == null ||
    payload.refresh_token == null
  ) {
    throw new Error(
      payload.error_description ??
        payload.error ??
        `Google OAuth token exchange failed with status ${response.status}.`,
    );
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
  };
}

function redirectUri(server: http.Server): string {
  const address = server.address();
  if (address == null || typeof address === 'string') {
    throw new Error('OAuth loopback server did not expose a port.');
  }
  return `http://127.0.0.1:${address.port}/`;
}

class GoogleApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'GoogleApiError';
    this.status = status;
  }
}

async function fetchGoogleJson<T>(
  url: string,
  accessToken: string,
): Promise<T> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const payload = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new GoogleApiError(
      payload.error?.message ??
        `Google API request failed (${response.status}).`,
      response.status,
    );
  }
  return payload;
}

function mapGoogleEvent(
  accountId: string,
  source: CalendarSourceView,
  googleEvent: GoogleEvent,
  syncedAt: string,
): ExternalCalendarEventView | null {
  if (googleEvent.id == null) return null;
  const start = mapGoogleEventTime(googleEvent.start);
  const end = mapGoogleEventTime(googleEvent.end);
  if (start == null || end == null) return null;
  const visibility =
    googleEvent.visibility === 'public' ||
    googleEvent.visibility === 'private' ||
    googleEvent.visibility === 'confidential'
      ? googleEvent.visibility
      : 'default';
  const privacyReduced =
    source.accessRole === 'freeBusyReader' ||
    visibility === 'private' ||
    visibility === 'confidential';
  const title = privacyReduced
    ? visibility === 'private' || visibility === 'confidential'
      ? 'Private event'
      : 'Busy'
    : sanitizeCalendarText(googleEvent.summary) ?? 'Untitled event';
  const event: ExternalCalendarEventView = {
    id: eventId(accountId, source.externalId, googleEvent.id),
    accountId,
    sourceId: source.id,
    provider: 'google',
    externalId: googleEvent.id,
    iCalUID: googleEvent.iCalUID ?? null,
    title,
    startTime: start.iso,
    endTime: end.iso,
    allDay: start.allDay || end.allDay,
    status:
      googleEvent.status === 'tentative' || googleEvent.status === 'cancelled'
        ? googleEvent.status
        : 'confirmed',
    transparency:
      googleEvent.transparency === 'transparent' ? 'transparent' : 'opaque',
    visibility,
    eventType: googleEvent.eventType ?? 'default',
    location: privacyReduced
      ? null
      : sanitizeCalendarText(googleEvent.location),
    attendees: privacyReduced
      ? []
      : sanitizeAttendees(googleEvent.attendees ?? []),
    conferenceUrl: privacyReduced
      ? null
      : sanitizeCalendarText(
          googleEvent.hangoutLink ??
            googleEvent.conferenceData?.entryPoints?.find(
              entry => entry.entryPointType === 'video' && entry.uri != null,
            )?.uri,
        ),
    htmlLink: privacyReduced
      ? null
      : sanitizeCalendarText(googleEvent.htmlLink),
    updatedAt: googleEvent.updated ?? null,
    syncedAt,
    busy: false,
  };
  return { ...event, busy: isCalendarEventBusy(event) };
}

function mapGoogleEventTime(
  time: GoogleEvent['start'],
): { iso: string; allDay: boolean } | null {
  if (time?.dateTime != null) {
    const parsed = new Date(time.dateTime);
    if (Number.isNaN(parsed.getTime())) return null;
    return { iso: parsed.toISOString(), allDay: false };
  }
  if (time?.date != null) {
    const parsed = new Date(`${time.date}T00:00:00.000`);
    if (Number.isNaN(parsed.getTime())) return null;
    return { iso: parsed.toISOString(), allDay: true };
  }
  return null;
}

function sanitizeCalendarText(value: string | null | undefined): string | null {
  const sanitized = redactSensitiveText(value);
  if (sanitized == null) return null;
  const trimmed = sanitized.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeCalendarSourceTitle(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim();
  return trimmed != null && trimmed.length > 0 ? trimmed : null;
}

function normalizeCachedSource(source: CalendarSourceView): CalendarSourceView {
  const mode = normalizeCalendarSourceMode(
    source.mode ?? (source.enabled ? 'scheduled' : 'ignored'),
  );
  return {
    ...source,
    mode,
    enabled: mode !== 'ignored',
  };
}

function normalizeCalendarSourceMode(
  value: StoredCalendarSourceMode | null | undefined,
): CalendarSourceMode {
  if (value === 'task_context') return 'scheduled';
  if (value === 'scheduled' || value === 'context_only') return value;
  return 'ignored';
}

function normalizeStoredAnnotation(
  annotation: CalendarEventAnnotationView,
): CalendarEventAnnotationView {
  return {
    ...annotation,
    followUps: sanitizeFollowUps(annotation.followUps ?? []),
    modeOverride:
      annotation.modeOverride == null
        ? null
        : normalizeCalendarSourceMode(
            annotation.modeOverride as StoredCalendarSourceMode,
          ),
    confirmedBlockIds: annotation.confirmedBlockIds ?? [],
    dismissedBlockIds: annotation.dismissedBlockIds ?? [],
  };
}

function reducePrivateCalendarEvent(
  event: ExternalCalendarEventView,
): ExternalCalendarEventView {
  if (event.visibility !== 'private' && event.visibility !== 'confidential') {
    return event;
  }
  return {
    ...event,
    title: 'Private event',
    location: null,
    attendees: [],
    conferenceUrl: null,
    htmlLink: null,
  };
}

function sanitizeFollowUps(values: string[]): string[] {
  return values
    .map(value => value.trim())
    .filter(value => value.length > 0)
    .slice(0, 12);
}

function isEmptyAnnotation(annotation: CalendarEventAnnotationView): boolean {
  return (
    annotation.notes.trim().length === 0 &&
    annotation.outcome.trim().length === 0 &&
    annotation.followUps.length === 0 &&
    annotation.modeOverride == null &&
    annotation.confirmedBlockIds.length === 0 &&
    annotation.dismissedBlockIds.length === 0
  );
}

function sanitizeAttendees(attendees: NonNullable<GoogleEvent['attendees']>) {
  return attendees
    .map(attendee =>
      sanitizeCalendarText(attendee.displayName ?? attendee.email ?? null),
    )
    .filter((value): value is string => value != null)
    .slice(0, 12);
}

function encryptSecret(value: string): StoredSecret {
  if (safeStorage.isEncryptionAvailable()) {
    return {
      value: safeStorage.encryptString(value).toString('base64'),
      encrypted: true,
    };
  }
  return {
    value: Buffer.from(value, 'utf8').toString('base64'),
    encrypted: false,
  };
}

function decryptSecret(stored: StoredSecret): string {
  const buffer = Buffer.from(stored.value, 'base64');
  if (stored.encrypted) return safeStorage.decryptString(buffer);
  return buffer.toString('utf8');
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if (
      error != null &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return fallback;
    }
    throw error;
  }
}

async function writeJsonAtomically(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(temporaryPath, filePath);
}

function googleOAuthClientId(): string | null {
  const value = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  return value != null && value.length > 0 ? value : null;
}

function googleOAuthClientSecret(): string | null {
  const value =
    process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ??
    process.env.GOOGLE_CLIENT_SECRET?.trim() ??
    process.env.CLIENT_SECRET?.trim() ??
    process.env.client_secret?.trim();
  return value != null && value.length > 0 ? value : null;
}

function googleOAuthRedirectPort(): number {
  const raw = process.env.GOOGLE_OAUTH_REDIRECT_PORT?.trim();
  if (raw == null || raw.length === 0) return DEFAULT_OAUTH_REDIRECT_PORT;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535
    ? parsed
    : DEFAULT_OAUTH_REDIRECT_PORT;
}

function sourceId(accountId: string, calendarId: string): string {
  return `calendar_source_${safeId(accountId)}_${safeId(calendarId)}`;
}

function eventId(accountId: string, calendarId: string, googleEventId: string) {
  return `calendar_event_${safeId(accountId)}_${safeId(calendarId)}_${safeId(
    googleEventId,
  )}`;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 160);
}

function base64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function relativeIso(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function latestSyncedAtForAccount(
  accountId: string,
  events: ExternalCalendarEventView[],
): string | null {
  let latest: string | null = null;
  for (const event of events) {
    if (event.accountId !== accountId) continue;
    if (latest == null || event.syncedAt > latest) latest = event.syncedAt;
  }
  return latest;
}
