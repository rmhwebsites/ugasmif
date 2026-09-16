// SMIF bull/bear mark as an inline component so it inherits sizing from
// className. Colors are fixed brand colors (bear gray, UGA red bull).
//
// The two crescents are the same shape rotated 180°, but the path is written
// out twice rather than shared through <defs>/<use>: a fixed id would collide
// whenever two marks render together (sidebar plus a spinner), and if the
// instance holding the <defs> unmounted, every other instance referencing it
// would lose its crescent.

const CRESCENT =
  "M 118 78 C 56 122 26 212 34 300 C 42 372 92 420 160 430 C 214 438 262 418 288 386 C 300 371 304 356 298 348 C 270 310 220 296 176 272 C 128 246 96 200 96 158 C 96 128 104 100 118 78 Z";

export function SmifLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      className={className}
      aria-label="SMIF"
      role="img"
    >
      {/* Bear */}
      <path fill="#808285" d={CRESCENT} />
      <path
        fill="#808285"
        d="M 208 332 C 206 302 218 282 236 276 C 238 264 252 260 258 270 C 262 266 268 266 272 270 C 292 272 316 284 330 298 C 336 304 338 310 334 312 C 324 314 314 318 310 324 C 316 330 318 336 312 340 C 300 350 282 352 268 350 C 244 350 218 344 208 332 Z"
      />
      {/* Bull */}
      <path
        fill="#ba0c2f"
        d={CRESCENT}
        transform="rotate(180 256 256)"
      />
      <path
        fill="#ba0c2f"
        d="M 302 182 C 304 212 292 228 274 234 C 258 240 240 236 228 226 C 216 218 208 206 210 198 C 220 200 228 196 226 188 C 220 176 224 166 236 162 C 248 156 262 158 270 164 C 288 166 300 170 302 182 Z"
      />
      <path
        fill="#ba0c2f"
        d="M 238 166 C 206 164 176 150 158 126 C 155 121 160 116 165 119 C 186 134 212 144 240 146 C 246 148 246 162 238 166 Z"
      />
      <path
        fill="#ba0c2f"
        d="M 258 154 C 240 130 230 102 230 76 C 230 70 237 68 240 73 C 250 96 266 116 286 130 C 291 134 288 144 282 146 Z"
      />
    </svg>
  );
}
