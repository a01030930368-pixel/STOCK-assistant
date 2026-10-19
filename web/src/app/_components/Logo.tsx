// LODESTAR(북극성) 표시. 원칙이 길잡이가 된다는 뜻입니다.
export default function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M24 4l3.5 16.5L44 24l-16.5 3.5L24 44l-3.5-16.5L4 24l16.5-3.5z" />
      <path d="M13 13l4 4M35 13l-4 4M13 35l4-4M35 35l-4-4" strokeOpacity="0.5" />
    </svg>
  );
}
