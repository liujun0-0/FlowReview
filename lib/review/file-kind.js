// Classify by conventional test paths/names, never by business descriptions.
export function isTestSource(path) {
  const name = path.replaceAll('\\', '/');
  return /(?:^|\/)(?:tests?|__tests__|testFixtures|test-fixtures)(?:\/|$)/i.test(name)
    || /(?:^|\/)test_[^/]+\.py$/i.test(name)
    || /(?:^|\/)[^/]+(?:\.(?:test|spec)\.[cm]?[jt]sx?|_test\.go)$/i.test(name)
    || /(?:^|\/)[^/]+(?:Test(?:s|Case)?|IT)\.java$/.test(name);
}
