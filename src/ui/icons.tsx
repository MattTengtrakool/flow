import React from 'react';
import {View} from 'react-native';

type IconProps = {
  size?: number;
  color?: string;
};

const DEFAULT_COLOR = '#6b6b6b';

export function CalendarIcon({size = 16, color = DEFAULT_COLOR}: IconProps) {
  const strokeWidth = Math.max(1, Math.round(size / 11));
  return (
    <View style={{width: size, height: size}}>
      <View
        style={{
          position: 'absolute',
          top: size * 0.22,
          left: 0,
          right: 0,
          bottom: 0,
          borderWidth: strokeWidth,
          borderColor: color,
          borderRadius: 2,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: size * 0.42,
          left: 0,
          right: 0,
          height: strokeWidth,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: size * 0.25,
          width: strokeWidth,
          height: size * 0.35,
          backgroundColor: color,
          borderRadius: 1,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: 0,
          right: size * 0.25,
          width: strokeWidth,
          height: size * 0.35,
          backgroundColor: color,
          borderRadius: 1,
        }}
      />
    </View>
  );
}

export function TodayIcon({size = 16, color = DEFAULT_COLOR}: IconProps) {
  const strokeWidth = Math.max(1, Math.round(size / 11));
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <View
        style={{
          width: size,
          height: size,
          borderWidth: strokeWidth,
          borderColor: color,
          borderRadius: size / 2,
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: size * 0.28,
          height: size * 0.28,
          borderRadius: size,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

export function ChatIcon({size = 16, color = DEFAULT_COLOR}: IconProps) {
  const strokeWidth = Math.max(1, Math.round(size / 11));
  return (
    <View style={{width: size, height: size}}>
      <View
        style={{
          position: 'absolute',
          top: size * 0.12,
          left: 0,
          right: 0,
          bottom: size * 0.28,
          borderWidth: strokeWidth,
          borderColor: color,
          borderRadius: size * 0.22,
        }}
      />
      <View
        style={{
          position: 'absolute',
          bottom: size * 0.1,
          left: size * 0.22,
          width: size * 0.18,
          height: size * 0.18,
          borderLeftWidth: strokeWidth,
          borderBottomWidth: strokeWidth,
          borderColor: color,
          transform: [{rotate: '45deg'}],
        }}
      />
    </View>
  );
}

export function SearchIcon({size = 16, color = DEFAULT_COLOR}: IconProps) {
  const strokeWidth = Math.max(1, Math.round(size / 11));
  const circleSize = size * 0.72;
  return (
    <View style={{width: size, height: size}}>
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: circleSize,
          height: circleSize,
          borderWidth: strokeWidth,
          borderColor: color,
          borderRadius: circleSize / 2,
        }}
      />
      <View
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          width: size * 0.45,
          height: strokeWidth,
          backgroundColor: color,
          transform: [{rotate: '45deg'}],
          borderRadius: 1,
        }}
      />
    </View>
  );
}

export function InsightsIcon({size = 16, color = DEFAULT_COLOR}: IconProps) {
  const barWidth = size * 0.22;
  return (
    <View
      style={{
        width: size,
        height: size,
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
      }}>
      <View
        style={{
          width: barWidth,
          height: size * 0.45,
          backgroundColor: color,
          borderRadius: 1,
        }}
      />
      <View
        style={{
          width: barWidth,
          height: size * 0.75,
          backgroundColor: color,
          borderRadius: 1,
        }}
      />
      <View
        style={{
          width: barWidth,
          height: size * 0.6,
          backgroundColor: color,
          borderRadius: 1,
        }}
      />
    </View>
  );
}

export function SettingsIcon({size = 16, color = DEFAULT_COLOR}: IconProps) {
  const strokeWidth = Math.max(1, Math.round(size / 11));
  const innerCircle = size * 0.32;
  const outerSize = size * 0.85;
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      {[0, 45, 90, 135].map(angle => (
        <View
          key={angle}
          style={{
            position: 'absolute',
            width: strokeWidth + 2,
            height: size,
            transform: [{rotate: `${angle}deg`}],
            alignItems: 'center',
          }}>
          <View
            style={{
              position: 'absolute',
              top: 0,
              width: strokeWidth + 1,
              height: size * 0.14,
              backgroundColor: color,
              borderRadius: 1,
            }}
          />
          <View
            style={{
              position: 'absolute',
              bottom: 0,
              width: strokeWidth + 1,
              height: size * 0.14,
              backgroundColor: color,
              borderRadius: 1,
            }}
          />
        </View>
      ))}
      <View
        style={{
          position: 'absolute',
          width: outerSize,
          height: outerSize,
          borderRadius: outerSize / 2,
          borderWidth: strokeWidth,
          borderColor: color,
          backgroundColor: '#faf8f3',
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: innerCircle,
          height: innerCircle,
          borderRadius: innerCircle / 2,
          borderWidth: strokeWidth,
          borderColor: color,
        }}
      />
    </View>
  );
}

export function ChevronLeftIcon({size = 14, color = DEFAULT_COLOR}: IconProps) {
  const strokeWidth = Math.max(1, Math.round(size / 9));
  const dim = size * 0.55;
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <View
        style={{
          width: dim,
          height: dim,
          borderLeftWidth: strokeWidth,
          borderBottomWidth: strokeWidth,
          borderColor: color,
          transform: [{rotate: '45deg'}],
        }}
      />
    </View>
  );
}

export function ChevronRightIcon({size = 14, color = DEFAULT_COLOR}: IconProps) {
  const strokeWidth = Math.max(1, Math.round(size / 9));
  const dim = size * 0.55;
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <View
        style={{
          width: dim,
          height: dim,
          borderRightWidth: strokeWidth,
          borderTopWidth: strokeWidth,
          borderColor: color,
          transform: [{rotate: '45deg'}],
        }}
      />
    </View>
  );
}

export function ChevronDownIcon({size = 14, color = DEFAULT_COLOR}: IconProps) {
  const strokeWidth = Math.max(1, Math.round(size / 9));
  const dim = size * 0.5;
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <View
        style={{
          width: dim,
          height: dim,
          borderRightWidth: strokeWidth,
          borderBottomWidth: strokeWidth,
          borderColor: color,
          transform: [{rotate: '45deg'}],
          marginTop: -dim * 0.4,
        }}
      />
    </View>
  );
}

export function CloseIcon({size = 14, color = DEFAULT_COLOR}: IconProps) {
  const strokeWidth = Math.max(1, Math.round(size / 10));
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <View
        style={{
          position: 'absolute',
          width: size * 0.9,
          height: strokeWidth,
          backgroundColor: color,
          transform: [{rotate: '45deg'}],
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: size * 0.9,
          height: strokeWidth,
          backgroundColor: color,
          transform: [{rotate: '-45deg'}],
        }}
      />
    </View>
  );
}

export function SparkleIcon({size = 14, color = '#6f3bf5'}: IconProps) {
  const center = size / 2;
  return (
    <View style={{width: size, height: size}}>
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: center - 1,
          width: 2,
          height: size,
          backgroundColor: color,
          borderRadius: 1,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: center - 1,
          left: 0,
          width: size,
          height: 2,
          backgroundColor: color,
          borderRadius: 1,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: center - 1,
          left: center - 1,
          width: 2,
          height: 2,
          backgroundColor: color,
          transform: [{rotate: '45deg'}],
        }}
      />
    </View>
  );
}

export function PlayIcon({size = 14, color = '#ffffff'}: IconProps) {
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <View
        style={{
          width: 0,
          height: 0,
          borderTopWidth: size * 0.38,
          borderBottomWidth: size * 0.38,
          borderLeftWidth: size * 0.6,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
          borderLeftColor: color,
          marginLeft: size * 0.15,
        }}
      />
    </View>
  );
}

export function ShareIcon({size = 14, color = DEFAULT_COLOR}: IconProps) {
  const strokeWidth = Math.max(1, Math.round(size / 10));
  return (
    <View style={{width: size, height: size}}>
      <View
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: size * 0.55,
          borderLeftWidth: strokeWidth,
          borderRightWidth: strokeWidth,
          borderBottomWidth: strokeWidth,
          borderColor: color,
          borderRadius: 1,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: size / 2 - strokeWidth / 2,
          width: strokeWidth,
          height: size * 0.62,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: size * 0.1,
          left: size * 0.32,
          width: size * 0.22,
          height: size * 0.22,
          borderLeftWidth: strokeWidth,
          borderTopWidth: strokeWidth,
          borderColor: color,
          transform: [{rotate: '45deg'}],
        }}
      />
    </View>
  );
}

export function BrandMark({size = 20, color = '#1a1a1a'}: IconProps) {
  const strokeWidth = Math.max(1.5, size * 0.15);
  const delta = size * 0.3;
  const angleDeg = 38;
  const segLen = delta / Math.cos((angleDeg * Math.PI) / 180);
  const center = size / 2;

  const bar = (midX: number, angle: number, key: string) => (
    <View
      key={key}
      style={{
        position: 'absolute',
        left: midX - segLen / 2,
        top: center - strokeWidth / 2,
        width: segLen,
        height: strokeWidth,
        backgroundColor: color,
        borderRadius: strokeWidth / 2,
        transform: [{rotate: `${angle}deg`}],
      }}
    />
  );

  return (
    <View style={{width: size, height: size}}>
      {bar(center - delta, -angleDeg, 'a')}
      {bar(center, angleDeg, 'b')}
      {bar(center + delta, -angleDeg, 'c')}
    </View>
  );
}

