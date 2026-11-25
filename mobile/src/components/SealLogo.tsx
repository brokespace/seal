import Svg, { Path } from 'react-native-svg'
import { colors } from '../theme/mobile-theme'
import { useMobileColorScheme } from '../theme/use-mobile-color-scheme'

type Props = {
  size?: number
  color?: string
}

export function SealLogo({ size = 24, color = colors.textPrimary }: Props) {
  useMobileColorScheme()
  return (
    <Svg width={size} height={size} viewBox="0 0 256 256">
      <Path
        fill={color}
        fillRule="evenodd"
        d="M28 136 a100 92 0 1 0 200 0 a100 92 0 1 0 -200 0 Z M81 116 a13 13 0 1 0 26 0 a13 13 0 1 0 -26 0 Z M149 116 a13 13 0 1 0 26 0 a13 13 0 1 0 -26 0 Z M113 141 Q128 133 143 141 Q137 157 128 160 Q119 157 113 141 Z"
      />
      <Path
        d="M62 150 L14 138 M62 162 L12 166 M64 174 L20 194 M194 150 L242 138 M194 162 L244 166 M192 174 L236 194"
        fill="none"
        stroke={color}
        strokeWidth={6}
        strokeLinecap="round"
      />
    </Svg>
  )
}
