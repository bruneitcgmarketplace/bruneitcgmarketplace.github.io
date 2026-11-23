// Cart = a saved list of buy-now listings (kept on this device, per account). Checkout reserves each card with the existing buy_now RPC.
import { state } from './lib.js';

const key = () => 'cart_' + (state.user?.id || 'guest');
export const cartIds = () => { try { return JSON.parse(localStorage.getItem(key()) || '[]'); } catch { return []; } };
const save = (a) => { localStorage.setItem(key(), JSON.stringify(a)); window.dispatchEvent(new Event('cart-changed')); };
export const inCart = (id) => cartIds().includes(id);
export const addToCart = (id) => { const a = cartIds(); if (!a.includes(id)) { a.push(id); save(a); } };
export const removeFromCart = (id) => save(cartIds().filter((x) => x !== id));
export const clearCart = () => save([]);
