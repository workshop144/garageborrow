// Thin shim so existing route imports continue to work after the helper
// moved to lib/notify.ts. New code should import from notify.ts directly.

export { invokeNotifier } from "./notify.js";
export type { NotifierEvent, NotifierEventType } from "./notify.js";
