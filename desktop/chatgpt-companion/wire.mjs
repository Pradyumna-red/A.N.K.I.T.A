// Generated from services/chatgpt-bridge/config.mjs; regenerate with scripts/build-chatgpt-companion.mjs.
export const wire = Object.freeze({
  "version": 1,
  "pollMs": 2000,
  "chatgptMatch": "https://chatgpt.com/*",
  "chatgptOrigin": "https://chatgpt.com",
  "routes": {
    "pair": "/pair",
    "tabs": "/tabs",
    "bind": "/bind",
    "poll": "/poll",
    "observe": "/observe",
    "disconnect": "/disconnect",
    "status": "/status"
  },
  "storageKey": "ankitaCompanionSession",
  "maxTabs": 50,
  "maxRequests": 200,
  "maxModels": 32,
  "maxIdChars": 200,
  "conversationPattern": "(?:^|\\/)c\\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?:\\/|$)",
  "readerGlobal": "AnkitaPageReaders",
  "maxTurns": 6,
  "maxPickers": 8,
  "modelTriggers": "button[aria-haspopup=\"menu\"], [data-codex-intelligence-trigger], [data-composer-navigation-target=\"reasoning\"]",
  "turns": "section[data-testid^=\"conversation-turn\"], [data-app-shell-main-surface] [data-thread-find-target=\"conversation\"] [data-turn-key], [data-chatgpt-search-unit-key$=\":user\"]",
  "hidden": "[hidden],[aria-hidden=\"true\"],[inert]",
  "loopbackHost": "127.0.0.1",
  "requestIdPattern": "^[a-z0-9_-]+$",
  "localProtocol": "http:",
  "bearerPrefix": "Bearer ",
  "jsonContentType": "application/json"
});
