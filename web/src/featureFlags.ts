// Build/runtime feature flags. B4 (map view) exists behind a flag so that,
// per Kill Table R14 (09-13까지 G4 미달성 또는 타일 약관 미확인 시 지도 폐기),
// disabling it is a ONE-LINE env change + redeploy — never a manual code
// removal exercise under deadline pressure.
//
// VITE_ENABLE_MAP defaults to "off" (undefined/anything other than "true"
// disables the feature) so a fresh checkout never accidentally ships the
// map before the flag is deliberately turned on.
export const MAP_ENABLED = import.meta.env.VITE_ENABLE_MAP === "true";
