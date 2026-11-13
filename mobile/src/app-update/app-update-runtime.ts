import Constants from 'expo-constants'
import * as Linking from 'expo-linking'
import { useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import {
  loadAppUpdatePreferences,
  saveAppUpdateCheck,
  saveDismissedAppUpdateVersion
} from '../storage/app-update-preferences'
import { createAppUpdateChecker, type AppUpdateState } from './app-update-checker'

// expoConfig is embedded binary manifest because app does not use expo-updates; SDK 55 removed nativeAppVersion. Revisit version source if adopting OTA updates.
export const installedAppVersion: string | null = Constants.expoConfig?.version ?? null

export const appUpdateChecker = createAppUpdateChecker({
  // Seal has no store listing or mobile release channel to check yet.
  source: null,
  installedVersion: installedAppVersion,
  now: () => Date.now(),
  setTimer: (run, delayMs) => setTimeout(run, delayMs),
  clearTimer: (handle) => clearTimeout(handle),
  subscribeForeground: (onForeground) => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        onForeground()
      }
    })
    return () => subscription.remove()
  },
  loadPreferences: loadAppUpdatePreferences,
  saveCheck: saveAppUpdateCheck,
  saveDismissedVersion: saveDismissedAppUpdateVersion
})

export function useAppUpdateState(): AppUpdateState {
  return useSyncExternalStore(appUpdateChecker.subscribe, appUpdateChecker.getSnapshot)
}

/** Opens the release page for the update. */
export function openAppUpdate(url: string): void {
  void Linking.openURL(url).catch(() => {})
}
