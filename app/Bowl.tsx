import React from "react";
import Svg, {
  Defs,
  LinearGradient,
  Stop,
  Ellipse,
  Path,
} from "react-native-svg";
export function Bowl({ size = 156 }: { size?: number }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 180 180"
      accessibilityLabel="Brownbag bowl"
    >
      <Defs>
        <LinearGradient id="bowl" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#9CCEA0" />
          <Stop offset=".45" stopColor="#016630" />
          <Stop offset="1" stopColor="#044425" />
        </LinearGradient>
        <LinearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FFF4B5" />
          <Stop offset="1" stopColor="#F8D978" />
        </LinearGradient>
      </Defs>
      <Ellipse cx="92" cy="151" rx="53" ry="9" fill="#21352D" opacity=".08" />
      <Path d="M34 86 C39 165 143 165 149 86Z" fill="url(#bowl)" />
      <Ellipse cx="91" cy="86" rx="58" ry="24" fill="url(#rim)" />
      <Ellipse cx="91" cy="85" rx="49" ry="17" fill="#D68C49" />
      <Path
        d="M56 82Q72 66 88 83T124 80M58 89Q80 76 101 89T132 87M68 96Q82 86 107 97"
        stroke="#F8D978"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />
      <Ellipse
        cx="111"
        cy="80"
        rx="15"
        ry="10"
        fill="#FAFBF6"
        transform="rotate(-25 111 80)"
      />
      <Ellipse cx="111" cy="80" rx="7" ry="6" fill="#F8D978" />
      <Path
        d="M66 53Q55 42 65 29M88 50Q102 38 90 23"
        stroke="#D9EEDD"
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M60 108Q69 125 86 129"
        stroke="#A5D5AD"
        strokeWidth="5"
        opacity=".6"
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}
