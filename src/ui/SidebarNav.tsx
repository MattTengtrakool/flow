import React from 'react';
import {Pressable, StyleSheet, View} from 'react-native';
import {Text} from './Text';

import {
  BrandMark,
  CalendarIcon,
  ChatIcon,
  InsightsIcon,
  SettingsIcon,
  TodayIcon,
} from './icons';

export type SidebarKey = 'calendar' | 'today' | 'chat' | 'insights' | 'settings';

type SidebarNavProps = {
  activeKey: SidebarKey;
  onSelect: (key: SidebarKey) => void;
  recording: boolean;
  recordingStatusText: string;
  recordingHint?: string;
  onStartPress?: () => void;
  onStopPress?: () => void;
  startDisabled?: boolean;
};

type NavRowProps = {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onPress: () => void;
};

function NavRow({label, icon, active, onPress}: NavRowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({pressed}) => [
        styles.navRow,
        active ? styles.navRowActive : null,
        pressed ? styles.navRowPressed : null,
      ]}>
      <View style={styles.navIcon}>{icon}</View>
      <Text style={[styles.navLabel, active ? styles.navLabelActive : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

export function SidebarNav(props: SidebarNavProps) {
  const iconColor = '#6b6b6b';
  const iconColorActive = '#1a1a1a';

  function iconFor(key: SidebarKey) {
    const color = props.activeKey === key ? iconColorActive : iconColor;
    switch (key) {
      case 'calendar':
        return <CalendarIcon size={16} color={color} />;
      case 'today':
        return <TodayIcon size={16} color={color} />;
      case 'chat':
        return <ChatIcon size={16} color={color} />;
      case 'insights':
        return <InsightsIcon size={16} color={color} />;
      case 'settings':
        return <SettingsIcon size={16} color={color} />;
    }
  }

  return (
    <View style={styles.sidebar}>
      <View style={styles.brandRow}>
        <BrandMark size={18} color="#1a1a1a" />
        <Text style={styles.brandText}>flow</Text>
      </View>

      <View style={styles.nav}>
        <NavRow
          label="Calendar"
          icon={iconFor('calendar')}
          active={props.activeKey === 'calendar'}
          onPress={() => props.onSelect('calendar')}
        />
        <NavRow
          label="Today"
          icon={iconFor('today')}
          active={props.activeKey === 'today'}
          onPress={() => props.onSelect('today')}
        />
        <NavRow
          label="Chat"
          icon={iconFor('chat')}
          active={props.activeKey === 'chat'}
          onPress={() => props.onSelect('chat')}
        />
        <NavRow
          label="Insights"
          icon={iconFor('insights')}
          active={props.activeKey === 'insights'}
          onPress={() => props.onSelect('insights')}
        />
        <NavRow
          label="Settings"
          icon={iconFor('settings')}
          active={props.activeKey === 'settings'}
          onPress={() => props.onSelect('settings')}
        />
      </View>

      <View style={styles.footer}>
        <Pressable
          onPress={() => {
            if (props.recording) {
              props.onStopPress?.();
            } else {
              props.onStartPress?.();
            }
          }}
          disabled={!props.recording && props.startDisabled === true}
          style={({pressed}) => [
            styles.statusCard,
            props.recording ? styles.statusCardActive : null,
            pressed ? styles.statusCardPressed : null,
          ]}>
          <View style={styles.statusTopRow}>
            <View
              style={[
                styles.statusDot,
                props.recording ? styles.statusDotActive : null,
              ]}
            />
            <Text style={styles.statusLabel}>
              {props.recording ? 'Recording' : 'Idle'}
            </Text>
          </View>
          <Text style={styles.statusHint}>
            {props.recording
              ? (props.recordingHint ?? 'Click to stop')
              : (props.recordingStatusText ?? 'Click to start a session')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: 220,
    paddingHorizontal: 18,
    paddingVertical: 20,
    backgroundColor: '#faf8f3',
    borderRightWidth: 1,
    borderRightColor: '#ece7dd',
    gap: 22,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
  },
  brandText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1a1a1a',
    letterSpacing: -0.2,
  },
  nav: {
    gap: 2,
    flex: 1,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  navRowActive: {
    backgroundColor: '#f1ece1',
  },
  navRowPressed: {
    opacity: 0.75,
  },
  navIcon: {
    width: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navLabel: {
    fontSize: 13,
    color: '#5a5a5a',
    fontWeight: '500',
  },
  navLabelActive: {
    color: '#1a1a1a',
    fontWeight: '600',
  },
  footer: {
    gap: 10,
  },
  statusCard: {
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#ece7dd',
    gap: 4,
  },
  statusCardActive: {
    borderColor: '#d9d2ff',
    backgroundColor: '#f3f0ff',
  },
  statusCardPressed: {
    opacity: 0.85,
  },
  statusTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#c0b9a5',
  },
  statusDotActive: {
    backgroundColor: '#6f3bf5',
  },
  statusLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  statusHint: {
    fontSize: 11,
    color: '#8a8478',
  },
});
