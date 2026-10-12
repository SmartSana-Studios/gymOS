// LOCAL QA ONLY (Expo Go). expo-notifications throws at import on Android Expo Go (remote push was
// removed in SDK 53), which takes the whole root layout down. Push is irrelevant to Epic 19, so
// metro.config.js swaps this stub in only when QA_EXPO_GO=1 (start-mobile.sh sets it). Never in a build.
const noop = () => {};
module.exports = {
  AndroidImportance: { DEFAULT: 3 },
  getExpoPushTokenAsync: async () => ({ data: '' }),
  getPermissionsAsync: async () => ({ status: 'denied' }),
  requestPermissionsAsync: async () => ({ status: 'denied' }),
  setNotificationChannelAsync: async () => null,
  addPushTokenListener: () => ({ remove: noop }),
  addNotificationReceivedListener: () => ({ remove: noop }),
  addNotificationResponseReceivedListener: () => ({ remove: noop }),
  setNotificationHandler: noop,
  getLastNotificationResponseAsync: async () => null,
};
