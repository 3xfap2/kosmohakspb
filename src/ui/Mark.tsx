// Знак контура: орбита с танкером на подлёте и заправленный узел в центре.
// Чертёжная графика вместо буквенной плашки — ближе к предметной области кейса.

export const Mark = () => (
  <svg className="mark" width="34" height="34" viewBox="0 0 40 40" aria-hidden="true">
    <g transform="rotate(-28 20 20)">
      <ellipse cx="20" cy="20" rx="17.2" ry="8.6" fill="none" stroke="currentColor" strokeOpacity="0.38" strokeWidth="1.3" />
      <circle cx="37.2" cy="20" r="2.4" fill="currentColor" />
    </g>
    <circle cx="20" cy="20" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
    {/* уровень топлива в узле */}
    <path d="M13.92 22A6.4 6.4 0 0 0 26.08 22Z" fill="currentColor" />
  </svg>
);
