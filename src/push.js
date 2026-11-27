// Phone notifications (Web Push). Subscriptions are saved through RPCs; sending is done by a database trigger + the bntcg-push Worker.
import { state, rpc, toast } from './lib.js';

export const VAPID_PUBLIC = 'BJDZ-gN8YIlT-Ckl7bPDDJE3OHqfbtSQGBZ9T_OI6sKc1VKYbS-GavE0g8lVkmTavHBlsGkJbjRGaxrwmdu6HRM';
const b64uToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// 'unsupported' | 'denied' | 'on' | 'off'
export async function pushStatus() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

async function save(sub) {
  const j = sub.toJSON();
  await rpc('save_push_sub', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
}

export async function enablePush() {
  if (!state.user) throw new Error('Sign in first');
  if (!pushSupported()) throw new Error('This browser cannot show phone notifications. On iPhone, add the site to the Home Screen first.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are blocked. Allow them for this site in the browser settings, then try again.');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(VAPID_PUBLIC) }));
  await save(sub);
}

export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg && (await reg.pushManager.getSubscription());
  if (!sub) return;
  const ep = sub.endpoint;
  await sub.unsubscribe();
  try { await rpc('delete_push_sub', { p_endpoint: ep }); } catch (_) { /* already gone */ }
}

// Re-save this device for the signed-in person (a phone shared by two accounts follows whoever signed in last).
let synced = null;
export async function syncPush() {
  if (!state.user || !pushSupported() || Notification.permission !== 'granted' || synced === state.user.id) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await save(sub); synced = state.user.id; }
  } catch (_) { /* retry on next page */ }
}

// One-time bar asking signed-in people to turn alerts on (needs a tap: browsers block automatic prompts).
export function pushPrompt() {
  const bar = document.getElementById('pushbar');
  if (!state.user || !pushSupported() || Notification.permission !== 'default' || localStorage.getItem('push_dismiss')) { if (bar) bar.remove(); return; }
  if (bar) return;
  const el = document.createElement('div');
  el.id = 'pushbar';
  el.style.cssText = 'position:fixed;left:.6rem;right:.6rem;bottom:.6rem;z-index:50;background:#fff;border:1px solid #d9dee7;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.18);padding:.7rem .8rem;display:flex;gap:.6rem;align-items:center';
  el.innerHTML = '<span style="flex:1;font-size:.9rem">🔔 Get a phone alert when someone buys your card, or when your order is marked sold.</span><button class="btn" id="pb-on">Turn on</button><button class="btn sec" id="pb-no" aria-label="Not now">✕</button>';
  document.body.appendChild(el);
  el.querySelector('#pb-no').onclick = () => { localStorage.setItem('push_dismiss', '1'); el.remove(); };
  el.querySelector('#pb-on').onclick = async () => {
    try { await enablePush(); toast('Phone alerts are on'); el.remove(); }
    catch (e) { toast(e.message); if (Notification.permission === 'denied') el.remove(); }
  };
}
