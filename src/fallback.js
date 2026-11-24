// Backup pictures for the few cards that Yuyutei has no photo for yet (its image address returns 404).
// Prices and links still come from Yuyutei. Key = '<set>/<number>' (the same two parts as the Yuyutei picture address).
// 'photos/...' files are resized copies of the official Bandai card-list sample images (Bandai blocks hot-linking).
// A full address is another Yuyutei picture of the same art (used for the PRB01 stamped versions, which look the same without the stamp).
const BASE = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || './';
export const FALLBACK = {
  'op17/10156': ['photos/op17-10156.jpg', 'official Bandai sample image (Yuyutei has no photo yet)'],
  'op17/10177': ['photos/op17-10177.jpg', 'official Bandai sample image (Yuyutei has no photo yet)'],
  'op17/10029': ['photos/op17-10029.jpg', 'official Bandai sample image (Yuyutei has no photo yet)'],
  'op18/10151': ['photos/op18-10151.jpg', 'official Bandai sample image (Yuyutei has no photo yet)'],
  'op18/10155': ['photos/op18-10155.jpg', 'official Bandai sample image (Yuyutei has no photo yet)'],
  'op18/10084': ['photos/op18-10084.jpg', 'official Bandai sample image (Yuyutei has no photo yet)'],
  'op18/10106': ['photos/op18-10106.jpg', 'official Bandai sample image (Yuyutei has no photo yet)'],
  'op18/10075': ['photos/op18-10075.jpg', 'official Bandai sample image (Yuyutei has no photo yet)'],
  'eb02/10082': ['photos/eb02-10082.jpg', 'official Bandai sample image (Yuyutei has no photo yet)'],
  'prb01/10024': ['https://card.yuyu-tei.jp/opc/front/op01/10152.jpg', 'same art as the version without the PRB01 stamp (Yuyutei has no photo of this one yet)'],
  'prb01/10089': ['https://card.yuyu-tei.jp/opc/front/op04/10102.jpg', 'same art as the version without the PRB01 stamp (Yuyutei has no photo of this one yet)'],
  'prb01/10028': ['https://card.yuyu-tei.jp/opc/front/op02/10019.jpg', 'same art as the version without the PRB01 stamp (Yuyutei has no photo of this one yet)'],
};
const RE = /card\.yuyu-tei\.jp\/opc\/(?:\d+_\d+|front)\/([a-z0-9-]+)\/([A-Za-z0-9-]+)\.jpg/;
// backup picture address for a Yuyutei picture address, or null
export function fallbackFor(url) {
  const m = RE.exec(url || ''); const e = m && FALLBACK[`${m[1]}/${m[2]}`];
  return e ? (/^https?:/.test(e[0]) ? e[0] : BASE + e[0]) : null;
}
export const fallbackNote = (set, num) => FALLBACK[`${set}/${num}`]?.[1] || '';
