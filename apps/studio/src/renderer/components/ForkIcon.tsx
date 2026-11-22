/**
 * Icon Fork kiểu Claude: nằm ngang — chấm gốc bên trái, thân ngang, tách hai nhánh chéo lên / xuống
 * sang phải, đầu mỗi nhánh có mũi tên góc. Dùng chung cho "Fork từ đây" (tin user) và "Fork chat" (AI).
 */
export function ForkIcon(props: { size?: number; strokeWidth?: number }) {
  const size = props.size ?? 14;
  const sw = props.strokeWidth ?? 1.75;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="3.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <path d="M6 12h4.5" />
      <path d="M10.5 12 19.5 4.5" />
      <path d="M10.5 12 19.5 19.5" />
      <path d="M14.5 4.5h5v5" />
      <path d="M14.5 19.5h5v-5" />
    </svg>
  );
}
