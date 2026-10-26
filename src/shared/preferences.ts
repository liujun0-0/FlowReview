import type { DiffStyle, Overflow } from './types';
import type { ThemeMode } from './useTheme';

const STORAGE_KEY = 'yadiff:preferences';

interface Preferences {
    version: 1;
    diffStyle?: DiffStyle;
    overflow?: Overflow;
    themeMode?: ThemeMode;
}

const DEFAULT_PREFERENCES: Preferences = { version: 1 };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value != null;
}

function parsePreferences(value: string | null): Preferences {
    if (value == null) return DEFAULT_PREFERENCES;
    try {
        const parsed: unknown = JSON.parse(value);
        if (!isRecord(parsed) || parsed.version !== 1) return DEFAULT_PREFERENCES;
        return {
            version: 1,
            diffStyle: parsed.diffStyle === 'split' || parsed.diffStyle === 'unified' ? parsed.diffStyle : undefined,
            overflow: parsed.overflow === 'scroll' || parsed.overflow === 'wrap' ? parsed.overflow : undefined,
            themeMode: parsed.themeMode === 'auto' || parsed.themeMode === 'light' || parsed.themeMode === 'dark' ? parsed.themeMode : undefined,
        };
    } catch {
        return DEFAULT_PREFERENCES;
    }
}

export function loadPreferences(): Preferences {
    try {
        return parsePreferences(localStorage.getItem(STORAGE_KEY));
    } catch {
        return DEFAULT_PREFERENCES;
    }
}

export function savePreferences(next: Partial<Omit<Preferences, 'version'>>) {
    try {
        const preferences = { ...loadPreferences(), ...next, version: 1 as const };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    } catch {
        // localStorage unavailable
    }
}
